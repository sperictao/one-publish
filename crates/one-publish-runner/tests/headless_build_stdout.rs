//! Headless 构建输出隔离：workflow 分片步骤把 `execute` 的 stdout 重定向为
//! 事件段文件，控制面按 `ShardOutcome` 解析。密封构建写到 stdout 的内容必须
//! 转入 stderr——仍留在 CI 日志中，但不得混入段 JSON。
//!
//! 假构建驱动是 shell 脚本，只有 Unix 能按程序名直接执行。
#![cfg(unix)]

mod common;

use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::{Command, Output};

use common::{fixture_checkout, fixture_projection};
use one_publish_runner::{prepare_from_projection, TriggerContext, TriggerInput};
use publish_domain::PlanNodePlatform;
use publish_runner_core::{platform_segment_name, ShardOutcome};

const BUILD_LOG: &str = "fake-pnpm build log";

/// 假 `pnpm`：先向 stdout 打印构建日志，再把一个产物写进 headless runner 的
/// Provider 输出目录，最后以给定退出码结束。
fn install_fake_pnpm(bin: &Path, exit_code: i32) {
    let script = bin.join("pnpm");
    std::fs::write(
        &script,
        format!(
            "#!/bin/sh\n\
             echo \"{BUILD_LOG}: $*\"\n\
             mkdir -p .one-publish-work/provider-output\n\
             printf bundle > .one-publish-work/provider-output/fixture.bin\n\
             exit {exit_code}\n"
        ),
    )
    .expect("write fake pnpm");
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755))
        .expect("mark fake pnpm executable");
}

/// 按 workflow 分片步骤的形态运行已安装 runner：在 checkout 根以宿主平台族
/// 执行 `execute prepared-attempt.json <attempt> <affinity>`，PATH 首位是假驱动。
fn execute_host_shard(build_exit_code: i32) -> Output {
    let checkout = fixture_checkout(&[
        ("pnpm-lock.yaml", "lockfileVersion: '9.0'\n"),
        (
            "src-tauri/tauri.conf.json",
            r#"{"productName":"fixture","version":"1.2.3"}"#,
        ),
    ]);
    let attempt = prepare_from_projection(
        &fixture_projection(),
        &TriggerContext {
            repository_root: checkout.path().to_path_buf(),
            trigger: TriggerInput::Tag("v1.2.3".to_string()),
        },
    )
    .expect("plan on site");
    std::fs::write(
        checkout.path().join("prepared-attempt.json"),
        serde_json::to_vec(&attempt).expect("serialize prepared attempt"),
    )
    .expect("write prepared attempt");

    let bin = tempfile::tempdir().expect("fake driver directory");
    install_fake_pnpm(bin.path(), build_exit_code);
    let path = std::env::join_paths(std::iter::once(bin.path().to_path_buf()).chain(
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()),
    ))
    .expect("put the fake driver first on PATH");

    Command::new(env!("CARGO_BIN_EXE_one-publish-runner"))
        .current_dir(checkout.path())
        .env("PATH", path)
        .arg("execute")
        .arg("prepared-attempt.json")
        .arg("attempt-build-stdout")
        .arg(platform_segment_name(PlanNodePlatform::host()))
        .output()
        .expect("start installed runner process")
}

/// 构建日志只出现在 stderr：不混入段 JSON，也不被丢弃（CI 日志仍可追溯构建过程）。
fn assert_build_log_only_on_stderr(execution: &Output) {
    let stdout = String::from_utf8_lossy(&execution.stdout);
    let stderr = String::from_utf8_lossy(&execution.stderr);
    assert!(
        !stdout.contains(BUILD_LOG),
        "build output leaked into the event segment: {stdout}"
    );
    assert!(
        stderr.contains(BUILD_LOG),
        "build output was not forwarded to stderr: {stderr}"
    );
}

#[test]
fn successful_build_output_stays_out_of_the_event_segment() {
    let execution = execute_host_shard(0);
    assert!(
        execution.status.success(),
        "runner failed: {}",
        String::from_utf8_lossy(&execution.stderr)
    );
    assert_build_log_only_on_stderr(&execution);
    let segment: ShardOutcome =
        serde_json::from_slice(&execution.stdout).expect("stdout is exactly the segment JSON");
    assert!(!segment.events.is_empty());
}

#[test]
fn failed_build_output_stays_out_of_the_event_segment() {
    let execution = execute_host_shard(3);
    assert!(
        !execution.status.success(),
        "a failed build must fail the shard"
    );
    assert_build_log_only_on_stderr(&execution);
    let stderr = String::from_utf8_lossy(&execution.stderr);
    assert!(
        stderr.contains("sealed build exited"),
        "runner error must keep the build root cause: {stderr}"
    );
}
