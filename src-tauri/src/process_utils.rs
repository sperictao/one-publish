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

pub fn new_tokio_command(program: impl AsRef<OsStr>) -> TokioCommand {
    let mut command = TokioCommand::new(program);
    apply_windows_background_mode(command.as_std_mut());
    command
}

/// try_wait 轮询 + 超时 kill：同步链路没有 runtime 可用 tokio::time::timeout，
/// std Command 也不自带 wait_timeout。超时被 kill+wait 回收（不残留孤儿），
/// 返回 None 让调用方走既定回落。
///
/// 管道缓冲只有 ~64KB：若子进程 stdout/stderr 已接管且输出超过缓冲，子进程
/// 堵在 write、父进程堵在 try_wait 会死锁。两条管道各起一个 drain 线程并行
/// 消费，wait 循环独立推进；未接管的管道按空输出处理。
pub(crate) fn wait_child_with_timeout(
    mut child: std::process::Child,
    timeout: std::time::Duration,
) -> Option<std::process::Output> {
    use std::io::Read;

    fn drain_pipe(pipe: Option<impl Read + Send + 'static>) -> std::thread::JoinHandle<Vec<u8>> {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut pipe) = pipe {
                let _ = pipe.read_to_end(&mut buf);
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
                let _ = stdout.join();
                let _ = stderr.join();
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
        let started = Instant::now();
        let output = wait_child_with_timeout(piped_sh("sleep 30"), Duration::from_millis(200));

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
}
