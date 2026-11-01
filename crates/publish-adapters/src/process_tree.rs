//! 构建进程树的隔离与终止（ADR-0041）：Gradle、npm 等构建工具会继续派生
//! 子进程，取消必须停下整棵进程树，而不只是直接子进程。

use std::io::{self, Read, Write};
use std::process::{Child, Command, ExitStatus, Output};
use std::thread;
use std::time::{Duration, Instant};

use crate::CancellationSignal;

/// 请求中断后留给进程树自行收尾的宽限期；超时即强制终止。
pub const TERMINATION_GRACE: Duration = Duration::from_secs(5);
/// 观察取消信号与子进程退出的轮询间隔。
pub const POLL_INTERVAL: Duration = Duration::from_millis(100);

/// 让构建成为独立进程组的组长，使终止信号能寻址其全部后代（Unix）。
/// Windows 由 `taskkill /T` 沿父子关系终止进程树，无需额外隔离。
pub fn isolate(command: &mut Command) {
    #[cfg(unix)]
    std::os::unix::process::CommandExt::process_group(command, 0);
    #[cfg(not(unix))]
    let _ = command;
}

/// 请求进程树优雅退出：Unix 向进程组发送 SIGINT（等同终端 Ctrl+C，构建
/// 工具据此取消构建）。Windows 后台进程没有可投递 Ctrl+C 的控制台，直接强制终止。
pub fn interrupt(pid: u32) {
    #[cfg(unix)]
    signal_group(pid, libc::SIGINT);
    #[cfg(windows)]
    kill(pid);
}

/// 强制终止进程树；进程组已不存在时静默成功。
pub fn kill(pid: u32) {
    #[cfg(unix)]
    signal_group(pid, libc::SIGKILL);
    #[cfg(windows)]
    taskkill_tree(pid);
}

/// 同步等待经 [`isolate`] 启动的构建退出；取消请求到达时先中断、宽限期后
/// 强制终止整棵进程树。返回退出状态与是否因取消而终止。
pub fn wait_or_cancel(
    child: &mut Child,
    cancellation: &CancellationSignal,
) -> io::Result<(ExitStatus, bool)> {
    let pid = child.id();
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok((status, false));
        }
        if cancellation.is_requested() {
            break;
        }
        thread::sleep(POLL_INTERVAL);
    }
    interrupt(pid);
    let deadline = Instant::now() + TERMINATION_GRACE;
    while child.try_wait()?.is_none() && Instant::now() < deadline {
        thread::sleep(POLL_INTERVAL);
    }
    // 组长退出后进程组仍可能残留后代（如忽略 SIGINT 的后台任务），无条件强制终止。
    kill(pid);
    Ok((child.wait()?, true))
}

/// 有界等待已 spawn 的子进程并收集管道输出；`stdin` 载荷在独立写线程上
/// 流式送入，与子进程 stdout/stderr 的 drain 线程并行推进——三者缺一都会
/// 在 >64KB 管道缓冲处死锁（写方堵 stdin、读方堵 wait、子进程堵 stdout）。
/// 超时 kill+wait 回收子进程并返回 `Ok(None)`；drain/写线程不 join——孙
/// 进程可能继续持有管道写端，detach 让其在 EOF 后自行退出。
pub fn wait_piped_with_timeout(
    mut child: Child,
    stdin: Option<Vec<u8>>,
    timeout: Duration,
) -> io::Result<Option<Output>> {
    let writer = child
        .stdin
        .take()
        .zip(stdin)
        .map(|(mut pipe, bytes)| thread::spawn(move || pipe.write_all(&bytes)));
    fn drain(pipe: Option<impl Read + Send + 'static>) -> thread::JoinHandle<Vec<u8>> {
        thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut pipe) = pipe {
                let _ = pipe.read_to_end(&mut buf);
            }
            buf
        })
    }
    let stdout = drain(child.stdout.take());
    let stderr = drain(child.stderr.take());

    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait()? {
            Some(status) => break status,
            None if Instant::now() < deadline => thread::sleep(POLL_INTERVAL),
            None => {
                let _ = child.kill();
                let _ = child.wait();
                return Ok(None);
            }
        }
    };

    if let Some(writer) = writer {
        writer
            .join()
            .map_err(|_| io::Error::new(io::ErrorKind::BrokenPipe, "stdin writer panicked"))??;
    }
    Ok(Some(Output {
        status,
        stdout: stdout.join().unwrap_or_default(),
        stderr: stderr.join().unwrap_or_default(),
    }))
}

#[cfg(unix)]
fn signal_group(pid: u32, signal: libc::c_int) {
    // 进程组号即组长 PID；非正组号会指向调用者自身所在的进程组，绝不能发送。
    let Ok(group) = libc::pid_t::try_from(pid) else {
        return;
    };
    if group <= 0 {
        return;
    }
    // SAFETY: killpg 只向指定进程组投递信号，不触碰本进程内存；组已退出时
    // 返回 ESRCH，属于预期结果。
    unsafe {
        libc::killpg(group, signal);
    }
}

#[cfg(windows)]
fn taskkill_tree(pid: u32) {
    use std::os::windows::process::CommandExt;
    use std::process::Stdio;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(all(test, unix))]
mod wait_piped_tests {
    use super::*;
    use std::process::Stdio;

    fn sh(script: &str) -> Child {
        Command::new("sh")
            .arg("-c")
            .arg(script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn sh")
    }

    #[test]
    fn collects_output_from_fast_children() {
        let output = wait_piped_with_timeout(sh("printf hi"), None, Duration::from_secs(5))
            .expect("io")
            .expect("completed");
        assert_eq!(output.stdout, b"hi");
        assert!(output.status.success());
    }

    #[test]
    fn streams_large_stdin_without_deadlocking() {
        let payload = vec![b'x'; 256 * 1024];
        let output =
            wait_piped_with_timeout(sh("cat"), Some(payload.clone()), Duration::from_secs(10))
                .expect("io")
                .expect("completed");
        assert_eq!(output.stdout, payload);
    }

    #[test]
    fn drains_large_stdout_while_polling() {
        let output = wait_piped_with_timeout(
            sh("head -c 200000 /dev/zero | tr '\\0' y"),
            None,
            Duration::from_secs(10),
        )
        .expect("io")
        .expect("completed");
        assert_eq!(output.stdout.len(), 200_000);
    }

    #[test]
    fn kills_and_reaps_children_past_the_deadline() {
        let start = Instant::now();
        let output =
            wait_piped_with_timeout(sh("sleep 60"), None, Duration::from_millis(200)).expect("io");
        assert!(output.is_none());
        assert!(start.elapsed() < Duration::from_secs(5));
    }
}
