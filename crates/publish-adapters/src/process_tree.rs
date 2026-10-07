//! 构建进程树的隔离与终止（ADR-0041）：Gradle、npm 等构建工具会继续派生
//! 子进程，取消必须停下整棵进程树，而不只是直接子进程。

use std::io;
use std::process::{Child, Command, ExitStatus};
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
