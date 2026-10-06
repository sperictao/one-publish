//! 远端分片构建回归（决议 #85）：桌面控制面为 GitHub Actions 绑定生成的投影
//! 总是携带 `enabled_targets`。runner 必须接受它现场规划，在目标平台族分片中
//! 执行 per-target 构建，并把驱动的 bundle 输出暂存给汇聚段。
//!
//! 假构建驱动是 shell 脚本，只有 Unix 能按程序名直接执行。
#![cfg(unix)]

mod common;

use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::Command;

use common::{fixture_checkout, fixture_projection};
use one_publish_runner::{
    load_staged_artifacts, prepare_from_projection, TriggerContext, TriggerInput,
    SHARD_STAGING_DIRECTORY,
};
use publish_adapters::tauri::{platform_for_build_target, ENABLED_TARGETS_SETTING};
use publish_runner_core::{platform_segment_name, ShardOutcome};
use serde_json::json;

const TARGET: &str = "x86_64-unknown-linux-gnu";
/// bundle 目录内的相对路径；暂存候选保留该子目录结构。
const BUNDLE_FILE: &str = "appimage/fixture_1.2.3_amd64.AppImage";
const BUNDLE_CONTENT: &str = "fixture bundle";

/// 假 `pnpm`：按 Tauri 布局把 bundle 写到 `src-tauri/target/<triple>/release/bundle/`。
/// 缺少密封的 `--target` 即失败，证明目标参数确实送达驱动；日志只写 stderr。
fn install_fake_pnpm(bin: &Path) {
    let script = bin.join("pnpm");
    std::fs::write(
        &script,
        format!(
            "#!/bin/sh\n\
             target=\n\
             while [ $# -gt 0 ]; do\n\
             [ \"$1\" = --target ] && target=\"$2\"\n\
             shift\n\
             done\n\
             [ -n \"$target\" ] || {{ echo 'fake pnpm: missing --target' >&2; exit 2; }}\n\
             out=\"src-tauri/target/$target/release/bundle/{BUNDLE_FILE}\"\n\
             mkdir -p \"$(dirname \"$out\")\"\n\
             printf '{BUNDLE_CONTENT}' > \"$out\"\n"
        ),
    )
    .expect("write fake pnpm");
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755))
        .expect("mark fake pnpm executable");
}

#[test]
fn desktop_generated_enabled_targets_plan_and_build_the_target_shard() {
    let checkout = fixture_checkout(&[
        ("pnpm-lock.yaml", "lockfileVersion: '9.0'\n"),
        (
            "src-tauri/tauri.conf.json",
            r#"{"productName":"fixture","version":"1.2.3"}"#,
        ),
    ]);
    // 与桌面 runner_projection 同形：GitHub Actions 绑定总是写入启用目标。
    let mut projection = fixture_projection();
    projection
        .adapters
        .project_provider
        .settings
        .values
        .insert(ENABLED_TARGETS_SETTING.to_string(), json!([TARGET]));
    let attempt = prepare_from_projection(
        &projection,
        &TriggerContext {
            repository_root: checkout.path().to_path_buf(),
            trigger: TriggerInput::Tag("v1.2.3".to_string()),
        },
    )
    .expect("projections carrying enabled targets plan on site");

    // 亲和由启用目标决定而不是执行宿主（决议 #85）。
    let platform = platform_for_build_target(TARGET);
    let build = attempt
        .prepared
        .plan
        .nodes
        .iter()
        .find(|node| node.id.ends_with(&format!("build-{TARGET}")))
        .expect("the plan expands a per-target build node");
    assert_eq!(build.platform, platform);

    std::fs::write(
        checkout.path().join("prepared-attempt.json"),
        serde_json::to_vec(&attempt).expect("serialize prepared attempt"),
    )
    .expect("write prepared attempt");
    let bin = tempfile::tempdir().expect("fake driver directory");
    install_fake_pnpm(bin.path());
    let path = std::env::join_paths(std::iter::once(bin.path().to_path_buf()).chain(
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()),
    ))
    .expect("put the fake driver first on PATH");

    // 按 workflow 分片步骤的形态运行已安装 runner。
    let execution = Command::new(env!("CARGO_BIN_EXE_one-publish-runner"))
        .current_dir(checkout.path())
        .env("PATH", path)
        .arg("execute")
        .arg("prepared-attempt.json")
        .arg("attempt-sharded-build")
        .arg(platform_segment_name(platform))
        .output()
        .expect("start installed runner process");
    let stderr = String::from_utf8_lossy(&execution.stderr);
    assert!(execution.status.success(), "runner failed: {stderr}");
    let segment: ShardOutcome =
        serde_json::from_slice(&execution.stdout).expect("stdout is exactly the segment JSON");
    assert!(
        segment
            .events
            .iter()
            .any(|event| event.plan_node_id == build.id && event.kind == "plan_node_completed"),
        "the target build node did not complete: {:?}",
        segment.events
    );

    // 段 JSON 只含证据；bundle 产物经暂存目录交给汇聚段。
    let staged = load_staged_artifacts(&checkout.path().join(SHARD_STAGING_DIRECTORY))
        .expect("load the staged shard candidates");
    let bundle = staged
        .iter()
        .find(|candidate| candidate.file_name == BUNDLE_FILE)
        .unwrap_or_else(|| panic!("the target bundle was not staged: {staged:?}"));
    assert_eq!(bundle.role, "installer");
    assert_eq!(bundle.bytes, BUNDLE_CONTENT.as_bytes());
}
