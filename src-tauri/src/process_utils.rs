use std::ffi::OsStr;
use std::process::Command as StdCommand;

use tokio::process::Command as TokioCommand;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(windows)]
fn apply_windows_background_mode(command: &mut StdCommand) {
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn apply_windows_background_mode(_command: &mut StdCommand) {}

pub fn new_std_command(program: impl AsRef<OsStr>) -> StdCommand {
    let mut command = StdCommand::new(program);
    apply_windows_background_mode(&mut command);
    command
}

/// 所有调用方都以 `.output()` 等方式驱动有界子进程；超时或取消丢弃 future
/// 时必须连带回收子进程，否则挂起的工具（如等待 pinentry 的 gpg）会孤儿化。
/// 有意脱离生命周期的 spawn 不得走此构造器。
pub fn new_tokio_command(program: impl AsRef<OsStr>) -> TokioCommand {
    let mut command = TokioCommand::new(program);
    apply_windows_background_mode(command.as_std_mut());
    command.kill_on_drop(true);
    command
}

/// 单条管道保留输出的上限；与 MAX_REPO_FILE_BYTES 同量级。子进程输出随
/// 仓库元数据 / 远端状态 / 工具进度放大，不设上限时挂起或循环输出的工具
/// 可在超时窗口内耗尽内存（security hardening: 输出量而非代码执行风险）。
pub(crate) const MAX_CHILD_OUTPUT_BYTES: u64 = 32 * 1024 * 1024;

/// try_wait 轮询 + 超时 kill：同步链路没有 runtime 可用 tokio::time::timeout，
/// std Command 也不自带 wait_timeout。超时被 kill+wait 回收（不残留孤儿），
/// 返回 None 让调用方走既定回落。
///
/// 管道缓冲只有 ~64KB：若子进程 stdout/stderr 已接管且输出超过缓冲，子进程
/// 堵在 write、父进程堵在 try_wait 会死锁。两条管道各起一个 drain 线程并行
/// 消费，wait 循环独立推进；未接管的管道按空输出处理。
///
/// 保留字节按 MAX_CHILD_OUTPUT_BYTES 封顶：超限后仍继续读到 EOF 丢弃
/// （只 take 不 drain 会让子进程重新堵在满管道上），调用方拿到截断前缀。
pub(crate) fn wait_child_with_timeout(
    mut child: std::process::Child,
    timeout: std::time::Duration,
) -> Option<std::process::Output> {
    use std::io::Read;

    fn drain_pipe(pipe: Option<impl Read + Send + 'static>) -> std::thread::JoinHandle<Vec<u8>> {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut pipe) = pipe {
                let kept = pipe
                    .by_ref()
                    .take(MAX_CHILD_OUTPUT_BYTES)
                    .read_to_end(&mut buf);
                if kept.is_ok() {
                    // 余量读到 EOF 丢弃；返回值非零说明发生了截断。
                    match std::io::copy(&mut pipe, &mut std::io::sink()) {
                        Ok(discarded) if discarded > 0 => {
                            log::warn!(
                                "child process output truncated at {MAX_CHILD_OUTPUT_BYTES} bytes ({discarded} bytes discarded)"
                            );
                        }
                        _ => {}
                    }
                }
            }
            buf
        })
    }
    let stdout = drain_pipe(child.stdout.take());
    let stderr = drain_pipe(child.stderr.take());

    let deadline = std::time::Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                // 超时路径不再 join drain 线程：孙进程可能继续持有管道写端，
                // join 会阻塞到孙进程退出。detach 让其在管道 EOF 后自行退出。
                return None;
            }
        }
    };

    Some(std::process::Output {
        status,
        stdout: stdout.join().unwrap_or_default(),
        stderr: stderr.join().unwrap_or_default(),
    })
}

/// tokio 版 `.output()` 的有界等价：spawn 后 stdout/stderr 各起一个读取任务
/// 截断 drain（同 wait_child_with_timeout 的上限与「超限读到 EOF 丢弃」语义），
/// 与 wait 并行推进，避免无界缓冲。
///
/// 超时不属于本函数职责——调用方用 tokio::time::timeout 包住返回的 future：
/// new_tokio_command 的 kill_on_drop 保证丢弃 future 时回收子进程，读取任务
/// 在管道 EOF 后自行结束，不会泄漏。
pub async fn capture_child_output_bounded(
    command: &mut TokioCommand,
) -> std::io::Result<std::process::Output> {
    use tokio::io::AsyncReadExt;

    fn drain_pipe(
        pipe: Option<impl tokio::io::AsyncRead + Unpin + Send + 'static>,
    ) -> tokio::task::JoinHandle<Vec<u8>> {
        tokio::spawn(async move {
            let mut buf = Vec::new();
            if let Some(mut pipe) = pipe {
                let kept = (&mut pipe)
                    .take(MAX_CHILD_OUTPUT_BYTES)
                    .read_to_end(&mut buf)
                    .await;
                if kept.is_ok() {
                    // 余量读到 EOF 丢弃；返回值非零说明发生了截断。
                    match tokio::io::copy(&mut pipe, &mut tokio::io::sink()).await {
                        Ok(discarded) if discarded > 0 => {
                            log::warn!(
                                "child process output truncated at {MAX_CHILD_OUTPUT_BYTES} bytes ({discarded} bytes discarded)"
                            );
                        }
                        _ => {}
                    }
                }
            }
            buf
        })
    }

    let mut child = command
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()?;
    let stdout = drain_pipe(child.stdout.take());
    let stderr = drain_pipe(child.stderr.take());
    let status = child.wait().await?;

    Ok(std::process::Output {
        status,
        stdout: stdout.await.unwrap_or_default(),
        stderr: stderr.await.unwrap_or_default(),
    })
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::process::Stdio;
    use std::time::{Duration, Instant};

    fn piped_sh(script: &str) -> std::process::Child {
        new_std_command("sh")
            .arg("-c")
            .arg(script)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn sh")
    }

    #[test]
    fn fast_command_returns_output() {
        let output =
            wait_child_with_timeout(piped_sh("printf hi"), Duration::from_secs(5)).expect("output");

        assert!(output.status.success());
        assert_eq!(output.stdout, b"hi");
    }

    #[test]
    fn hung_command_is_killed_and_returns_none() {
        // 直接子进程：kill 即释放管道写端。经 sh 包装的孙进程不在此覆盖，
        // 超时路径按 detach 语义不等待其退出。
        let child = new_std_command("sleep")
            .arg("30")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn sleep");
        let started = Instant::now();
        let output = wait_child_with_timeout(child, Duration::from_millis(200));

        assert!(output.is_none());
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn large_piped_output_does_not_deadlock() {
        // stdout 超过 64KB 管道缓冲：drain 线程不工作时 try_wait 会死等。
        let output = wait_child_with_timeout(
            piped_sh("head -c 200000 /dev/zero"),
            Duration::from_secs(10),
        )
        .expect("large output");

        assert!(output.status.success());
        assert_eq!(output.stdout.len(), 200_000);
    }

    #[test]
    fn oversized_output_is_truncated_but_fully_drained() {
        // 超出上限的字节仍被消费（不写回管道导致子进程阻塞），
        // 返回的缓冲只保留前 MAX_CHILD_OUTPUT_BYTES 字节。
        let output = wait_child_with_timeout(
            piped_sh("head -c 33554433 /dev/zero"),
            Duration::from_secs(30),
        )
        .expect("oversized output");

        assert!(output.status.success());
        assert_eq!(output.stdout.len() as u64, MAX_CHILD_OUTPUT_BYTES);
    }

    #[tokio::test]
    async fn bounded_capture_collects_output_and_status() {
        let mut command = new_tokio_command("sh");
        command.arg("-c").arg("printf out; printf err >&2; exit 3");
        let output = capture_child_output_bounded(&mut command)
            .await
            .expect("bounded capture");

        assert_eq!(output.status.code(), Some(3));
        assert_eq!(output.stdout, b"out");
        assert_eq!(output.stderr, b"err");
    }

    #[tokio::test]
    async fn bounded_capture_truncates_but_drains_oversized_output() {
        let mut command = new_tokio_command("sh");
        command.arg("-c").arg("head -c 33554433 /dev/zero");
        let output = capture_child_output_bounded(&mut command)
            .await
            .expect("oversized capture");

        assert!(output.status.success());
        assert_eq!(output.stdout.len() as u64, MAX_CHILD_OUTPUT_BYTES);
    }
}
