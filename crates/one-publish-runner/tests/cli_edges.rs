//! main.rs 的 CLI 边界：用法、命令分发与参数解析拒绝都必须以结构化
//! 失败呈现，而不是静默吞掉或 panic。

mod common;

use std::process::Command;

use common::{fixture_checkout, fixture_projection};
use one_publish_runner::{prepare_from_projection, TriggerContext, TriggerInput};

const BIN: &str = env!("CARGO_BIN_EXE_one-publish-runner");

fn run(args: &[&str]) -> std::process::Output {
    Command::new(BIN)
        .args(args)
        .output()
        .expect("start installed runner process")
}

fn assert_rejected(args: &[&str], expected: &str) {
    let output = run(args);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(!output.status.success(), "expected rejection for {args:?}");
    assert!(
        stderr.contains(expected),
        "expected {expected:?} in stderr: {stderr}"
    );
}

#[test]
fn cli_rejects_missing_and_unsupported_commands() {
    assert_rejected(&[], "usage: one-publish-runner");
    assert_rejected(&["verify"], "projection path is required");
    assert_rejected(&["bogus", "projection.json"], "unsupported command bogus");
}

#[test]
fn help_prints_full_usage_and_exits_successfully() {
    // --help / -h / help 均须以 0 退出并在 stdout 给出完整用法——
    // 独立分发的二进制不能要求使用者读源码才能发现子命令形状。
    for flag in ["--help", "-h", "help"] {
        let output = run(&[flag]);
        assert!(
            output.status.success(),
            "{flag} must exit successfully: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let stdout = String::from_utf8_lossy(&output.stdout);
        for needle in ["verify", "prepare-from-projection", "execute", "128+"] {
            assert!(stdout.contains(needle), "{flag} output missing {needle:?}");
        }
    }
}

#[test]
fn verify_rejects_extra_arguments_and_unreadable_projections() {
    assert_rejected(
        &["verify", "projection.json", "extra"],
        "verify accepts no additional arguments",
    );
    // 投影读取与解码错误经 CLI 边界原样上抛。
    let output = run(&["verify", "/definitely/missing/projection.json"]);
    assert!(
        !output.status.success(),
        "an unreadable projection must fail verify"
    );

    let corrupt = tempfile::NamedTempFile::new().expect("corrupt projection file");
    std::fs::write(corrupt.path(), "{not json").expect("write corrupt projection");
    let output = run(&["verify", &corrupt.path().to_string_lossy()]);
    assert!(
        !output.status.success(),
        "an undecodable projection must fail verify"
    );
}

#[test]
fn verify_accepts_an_installed_projection() {
    let projection_file = tempfile::NamedTempFile::new().expect("projection file");
    std::fs::write(
        projection_file.path(),
        serde_json::to_vec(&fixture_projection()).expect("serialize projection"),
    )
    .expect("write projection");
    let output = run(&["verify", &projection_file.path().to_string_lossy()]);
    assert!(
        output.status.success(),
        "an installed projection verifies: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn prepare_from_projection_validates_its_argument_shape() {
    assert_rejected(
        &["prepare-from-projection", "projection.json"],
        "requires the checkout root",
    );
    assert_rejected(
        &["prepare-from-projection", "projection.json", "."],
        "requires a trigger descriptor",
    );
    assert_rejected(
        &[
            "prepare-from-projection",
            "projection.json",
            ".",
            "tag:v1.2.3",
            "extra",
        ],
        "accepts a checkout root and a trigger descriptor",
    );
}

#[test]
fn execute_validates_its_argument_shape() {
    assert_rejected(
        &["execute", "attempt.json"],
        "execute requires an attempt id",
    );
    assert_rejected(
        &["execute", "attempt.json", "attempt-1", "macos", "extra"],
        "execute accepts an attempt id and an optional platform affinity",
    );

    // 平台亲和解析在读取与物化尝试之后：需要一份真实 PreparedAttempt。
    let checkout = fixture_checkout(&[]);
    let projection = fixture_projection();
    let attempt = prepare_from_projection(
        &projection,
        &TriggerContext {
            repository_root: checkout.path().to_path_buf(),
            trigger: TriggerInput::Tag("v1.2.3".to_string()),
        },
    )
    .expect("plan on site");
    let attempt_file = tempfile::NamedTempFile::new().expect("attempt file");
    std::fs::write(
        attempt_file.path(),
        serde_json::to_vec(&attempt).expect("serialize attempt"),
    )
    .expect("write attempt");
    let path = attempt_file.path().to_string_lossy().to_string();
    assert_rejected(
        &["execute", &path, "attempt-1", "beos"],
        "unsupported platform affinity beos",
    );
}

#[test]
fn prepare_from_projection_rejects_unknown_trigger_descriptors() {
    // 触发描述符解析先于 checkout 检查：非法前缀必须结构化拒绝。
    let projection_file = tempfile::NamedTempFile::new().expect("projection file");
    std::fs::write(
        projection_file.path(),
        serde_json::to_vec(&fixture_projection()).expect("serialize projection"),
    )
    .expect("write projection");
    let path = projection_file.path().to_string_lossy().to_string();
    assert_rejected(
        &["prepare-from-projection", &path, ".", "branch:main"],
        "unsupported trigger descriptor branch:main",
    );
}
