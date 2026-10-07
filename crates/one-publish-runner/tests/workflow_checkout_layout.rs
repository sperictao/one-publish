//! 薄外壳 workflow 的现场规划前置条件（决议 #87）：prepare-from-projection
//! 要求干净 checkout。按 workflow 步骤顺序复现：安装 runner → 汇聚段下载/
//! 解包暂存 → shell 重定向先创建 prepared-attempt.json → 以已安装 runner
//! 进程现场规划。外壳自有文件落在 $RUNNER_TEMP；runner 运行时根下的未跟踪
//! 条目被豁免，其余未跟踪或已修改的文件仍使规划失败。

mod common;

use std::path::Path;
use std::process::{Command, Output};

use common::{fixture_checkout, fixture_projection};
use one_publish_runner::PreparedAttempt;

const RUNTIME_PATH: &str = ".one-publish/automation/runtime/binding-stable.json";

fn write(root: &Path, relative: &str, content: &[u8]) {
    let path = root.join(relative);
    std::fs::create_dir_all(path.parent().expect("workflow file parent"))
        .expect("create workflow directory");
    std::fs::write(path, content).expect("write workflow file");
}

/// 已提交运行时投影文件的 checkout；`files` 为额外提交的相对路径与内容。
fn projected_checkout(files: &[(&str, &str)]) -> tempfile::TempDir {
    let projection =
        serde_json::to_string_pretty(&fixture_projection()).expect("serialize projection");
    let mut committed = vec![(RUNTIME_PATH, projection.as_str())];
    committed.extend_from_slice(files);
    fixture_checkout(&committed)
}

/// 安装步骤：tarball 与解出的二进制写进 `install_root`。
fn install_runner(install_root: &Path) {
    write(
        install_root,
        "one-publish-runner-x86_64-unknown-linux-gnu.tar.gz",
        b"tarball",
    );
    write(install_root, "one-publish-runner", b"runner");
}

/// 汇聚段：事件段与暂存 tar 下载后解包进 runner 暂存根。
fn download_aggregate_inputs(checkout: &Path) {
    write(
        checkout,
        ".one-publish-work/segments/one-publish-events-1-1-linux/one-publish-events-linux.json",
        b"{}",
    );
    write(
        checkout,
        ".one-publish-work/staging-tars/one-publish-staging-1-1-linux/one-publish-staging-linux.tar",
        b"tar",
    );
    write(
        checkout,
        ".one-publish-work/staged/linux/manifest.json",
        b"[]",
    );
}

/// 按 shard 步骤的形态运行：`<runner> prepare-from-projection <runtime> . <trigger>
/// > <attempt>`，重定向目标在规划开始前已存在且为空。
fn prepare_like_the_shard_step(checkout: &Path, attempt_path: &Path) -> Output {
    let redirect = std::fs::File::create(attempt_path).expect("shell creates the redirect target");
    Command::new(env!("CARGO_BIN_EXE_one-publish-runner"))
        .current_dir(checkout)
        .arg("prepare-from-projection")
        .arg(RUNTIME_PATH)
        .arg(".")
        .arg("tag:v1.2.3")
        .stdout(redirect)
        .output()
        .expect("start installed runner process")
}

fn assert_rejected_as_dirty(output: &Output, listed: &[&str], tolerated: &[&str]) {
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(!output.status.success(), "dirty checkout was planned");
    assert!(
        stderr.contains("clean checkout"),
        "unexpected failure: {stderr}"
    );
    for path in listed {
        assert!(stderr.contains(path), "{path} is not reported: {stderr}");
    }
    for path in tolerated {
        assert!(!stderr.contains(path), "{path} is reported: {stderr}");
    }
}

#[test]
fn the_rendered_workflow_layout_plans_on_site() {
    let checkout = projected_checkout(&[]);
    let runner_temp = tempfile::tempdir().expect("runner temp directory");
    install_runner(runner_temp.path());
    download_aggregate_inputs(checkout.path());

    let attempt_path = runner_temp.path().join("prepared-attempt.json");
    let output = prepare_like_the_shard_step(checkout.path(), &attempt_path);
    assert!(
        output.status.success(),
        "runner failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let attempt: PreparedAttempt = serde_json::from_slice(
        &std::fs::read(&attempt_path).expect("read the redirected prepared attempt"),
    )
    .expect("the redirect target is exactly the prepared attempt JSON");
    assert!(!attempt.prepared.snapshot.source.dirty);
}

#[test]
fn only_untracked_runner_work_entries_are_exempt_from_the_clean_check() {
    // 外壳文件写进 checkout 根（修复前的布局）仍是脏 checkout。
    let checkout = projected_checkout(&[]);
    install_runner(checkout.path());
    download_aggregate_inputs(checkout.path());
    let output = prepare_like_the_shard_step(
        checkout.path(),
        &checkout.path().join("prepared-attempt.json"),
    );
    assert_rejected_as_dirty(
        &output,
        &[
            "one-publish-runner-x86_64-unknown-linux-gnu.tar.gz",
            "prepared-attempt.json",
        ],
        &[".one-publish-work/"],
    );

    // 运行时根下已跟踪文件的修改与同名前缀的兄弟路径都不豁免。
    let checkout = projected_checkout(&[(".one-publish-work/tracked.txt", "tracked\n")]);
    download_aggregate_inputs(checkout.path());
    write(
        checkout.path(),
        ".one-publish-work/tracked.txt",
        b"changed\n",
    );
    write(
        checkout.path(),
        ".one-publish-workspace/notes.txt",
        b"user\n",
    );
    let runner_temp = tempfile::tempdir().expect("runner temp directory");
    let output = prepare_like_the_shard_step(
        checkout.path(),
        &runner_temp.path().join("prepared-attempt.json"),
    );
    assert_rejected_as_dirty(
        &output,
        &[".one-publish-work/tracked.txt", ".one-publish-workspace/"],
        &[".one-publish-work/staged", ".one-publish-work/segments"],
    );
}
