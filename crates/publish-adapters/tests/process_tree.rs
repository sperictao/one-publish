//! 进程树隔离/中断/终止的真实子进程测试（ADR-0041）：`sleep` 进程在独立
//! 进程组中被 SIGINT/SIGKILL 寻址，取消语义经 wait_or_cancel 观测。

#![cfg(unix)]

use std::process::Command;
use std::time::Instant;

use publish_adapters::process_tree::{interrupt, isolate, kill, wait_or_cancel};
use publish_adapters::CancellationSignal;

fn sleeping_child() -> std::process::Child {
    let mut command = Command::new("sleep");
    command.arg("60");
    isolate(&mut command);
    command.spawn().expect("spawn sleep child")
}

#[test]
fn uninterrupted_children_report_their_own_exit_status() {
    let mut child = Command::new("true").spawn().expect("spawn true");
    let (status, cancelled) =
        wait_or_cancel(&mut child, &CancellationSignal::new()).expect("wait for true");
    assert!(status.success());
    assert!(!cancelled);
}

#[test]
fn cancellation_interrupts_and_terminates_the_process_tree() {
    let mut child = sleeping_child();
    let cancellation = CancellationSignal::new();
    cancellation.request();

    let started = Instant::now();
    let (status, cancelled) = wait_or_cancel(&mut child, &cancellation).expect("cancel the sleep");
    assert!(cancelled);
    assert!(!status.success());
    assert!(
        started.elapsed() < std::time::Duration::from_secs(10),
        "cancellation must not wait out the grace period for a responsive process"
    );
}

#[test]
fn dead_or_invalid_process_groups_are_silent_successes() {
    // 已退出的 pid 与非法组号都不产生错误。
    interrupt(u32::MAX);
    kill(u32::MAX);
    interrupt(0);
    kill(0);

    let mut child = sleeping_child();
    let pid = child.id();
    child.kill().expect("kill the child");
    child.wait().expect("reap the child");
    interrupt(pid);
    kill(pid);
}
