//! 远端分片构建回归（决议 #85）：桌面控制面为 GitHub Actions 绑定生成的投影
//! 总是携带 `enabled_targets`。runner 必须接受它现场规划，在目标平台族分片中
//! 执行 per-target 构建，并把驱动的 bundle 输出暂存给汇聚段；汇聚段凭 build
//! 段的事件段证据满足跨段依赖，密封并交付暂存的 bundle。
//!
//! 假构建驱动是 shell 脚本，只有 Unix 能按程序名直接执行。
#![cfg(unix)]

mod common;

use std::ffi::OsString;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::{Command, Output};

use common::{fixture_checkout, fixture_projection};
use one_publish_runner::{
    load_staged_artifacts, prepare_from_projection, PreparedAttempt, TriggerContext, TriggerInput,
    SHARD_SEGMENTS_DIRECTORY, SHARD_STAGING_DIRECTORY,
};
use publish_adapters::tauri::{platform_for_build_target, ENABLED_TARGETS_SETTING};
use publish_domain::{
    sha256_hex, DeliveryStatus, PlanNode, PlanNodeExecutionState, PlanNodePlatform,
    PublishAttemptStatus,
};
use publish_runner_core::{platform_segment_name, reduce_publish_events, ShardOutcome};
use serde_json::json;

const TARGET: &str = "x86_64-unknown-linux-gnu";
const ATTEMPT_ID: &str = "attempt-sharded-build";
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

/// 已现场规划的分片 checkout：`prepared-attempt.json` 已落盘，假驱动在 PATH 首位。
struct ShardedCheckout {
    checkout: tempfile::TempDir,
    _bin: tempfile::TempDir,
    path: OsString,
    attempt: PreparedAttempt,
}

impl ShardedCheckout {
    fn prepare() -> Self {
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
        Self {
            checkout,
            _bin: bin,
            path,
            attempt,
        }
    }

    fn build_node(&self) -> &PlanNode {
        self.attempt
            .prepared
            .plan
            .nodes
            .iter()
            .find(|node| node.id.ends_with(&format!("build-{TARGET}")))
            .expect("the plan expands a per-target build node")
    }

    /// 按 workflow 分片步骤的形态运行已安装 runner。
    fn execute(&self, attempt_id: &str, platform: PlanNodePlatform) -> Output {
        Command::new(env!("CARGO_BIN_EXE_one-publish-runner"))
            .current_dir(self.checkout.path())
            .env("PATH", &self.path)
            .arg("execute")
            .arg("prepared-attempt.json")
            .arg(attempt_id)
            .arg(platform_segment_name(platform))
            .output()
            .expect("start installed runner process")
    }

    fn execute_segment(&self, attempt_id: &str, platform: PlanNodePlatform) -> ShardOutcome {
        let execution = self.execute(attempt_id, platform);
        let stderr = String::from_utf8_lossy(&execution.stderr);
        assert!(execution.status.success(), "runner failed: {stderr}");
        serde_json::from_slice(&execution.stdout).expect("stdout is exactly the segment JSON")
    }

    fn execute_failure(&self, attempt_id: &str, platform: PlanNodePlatform) -> String {
        let execution = self.execute(attempt_id, platform);
        assert!(
            !execution.status.success(),
            "the {} segment must fail closed",
            platform_segment_name(platform)
        );
        assert!(
            execution.stdout.is_empty(),
            "a failed segment emits no evidence"
        );
        String::from_utf8_lossy(&execution.stderr).into_owned()
    }
}

#[test]
fn desktop_generated_enabled_targets_plan_and_build_the_target_shard() {
    let sharded = ShardedCheckout::prepare();
    // 亲和由启用目标决定而不是执行宿主（决议 #85）。
    let platform = platform_for_build_target(TARGET);
    let build = sharded.build_node();
    assert_eq!(build.platform, platform);

    let segment = sharded.execute_segment(ATTEMPT_ID, platform);
    assert!(
        segment
            .events
            .iter()
            .any(|event| event.plan_node_id == build.id && event.kind == "plan_node_completed"),
        "the target build node did not complete: {:?}",
        segment.events
    );

    // 段 JSON 只含证据；bundle 产物经暂存目录交给汇聚段。
    let staged = load_staged_artifacts(&sharded.checkout.path().join(SHARD_STAGING_DIRECTORY))
        .expect("load the staged shard candidates");
    let bundle = staged
        .iter()
        .find(|candidate| candidate.file_name == BUNDLE_FILE)
        .unwrap_or_else(|| panic!("the target bundle was not staged: {staged:?}"));
    assert_eq!(bundle.role, "installer");
    assert_eq!(bundle.bytes, BUNDLE_CONTENT.as_bytes());
}

#[test]
fn convergence_segment_delivers_staged_bundles_on_build_segment_evidence() {
    let sharded = ShardedCheckout::prepare();
    let plan = &sharded.attempt.prepared.plan;
    let build = sharded.build_node();
    let build_segment = sharded.execute_segment(ATTEMPT_ID, build.platform);

    // 只有暂存产物、没有事件段证据：汇聚段不能把跨段依赖当作已满足。
    let missing_evidence = sharded.execute_failure(ATTEMPT_ID, PlanNodePlatform::Any);
    assert!(
        missing_evidence.contains(&format!(
            "depends on {}, which has no completed evidence in the handed-off segments",
            build.id
        )),
        "unexpected failure: {missing_evidence}"
    );

    // 按 aggregate job 的 download-artifact 布局交付 build 事件段：每个
    // artifact 一层子目录。
    let affinity = platform_segment_name(build.platform);
    let segment_artifact = sharded
        .checkout
        .path()
        .join(SHARD_SEGMENTS_DIRECTORY)
        .join(format!("one-publish-events-1-1-{affinity}"));
    std::fs::create_dir_all(&segment_artifact).expect("create the segment artifact directory");
    std::fs::write(
        segment_artifact.join(format!("one-publish-events-{affinity}.json")),
        serde_json::to_vec(&build_segment).expect("serialize the build segment"),
    )
    .expect("write the downloaded build segment");

    // 其它 attempt 的证据不能满足本 attempt 的依赖。
    let foreign = sharded.execute_failure("attempt-foreign", PlanNodePlatform::Any);
    assert!(
        foreign.contains("belongs to attempt attempt-sharded-build"),
        "unexpected failure: {foreign}"
    );

    let convergence = sharded.execute_segment(ATTEMPT_ID, PlanNodePlatform::Any);
    // 汇聚段只输出本段事件，不转抄 build 段证据。
    let convergence_run = format!("{ATTEMPT_ID}/any");
    assert!(convergence
        .events
        .iter()
        .all(|event| event.backend_run_id == convergence_run));

    // 暂存的 bundle 进入密封 Manifest，并经本地目标原样交付。
    let manifest = convergence
        .manifest
        .as_ref()
        .expect("the convergence segment seals the artifact manifest");
    let entry = manifest
        .artifacts
        .iter()
        .find(|entry| entry.file_name == BUNDLE_FILE)
        .unwrap_or_else(|| panic!("the staged bundle is missing from the manifest: {manifest:?}"));
    assert_eq!(entry.role, "installer");
    assert_eq!(entry.digest, sha256_hex(BUNDLE_CONTENT.as_bytes()));
    let delivery_root = sharded.checkout.path().join(".one-publish-work/delivery");
    let attempt_directories = std::fs::read_dir(&delivery_root)
        .expect("read the local delivery root")
        .map(|entry| entry.expect("delivery entry").path())
        .collect::<Vec<_>>();
    assert_eq!(attempt_directories.len(), 1, "{attempt_directories:?}");
    assert_eq!(
        std::fs::read(attempt_directories[0].join(BUNDLE_FILE)).expect("read the delivered bundle"),
        BUNDLE_CONTENT.as_bytes()
    );

    // 两段合并归约即完整 attempt：全部节点完成、路线已发布、Manifest 一致。
    let reduced = reduce_publish_events(
        &[build_segment.events, convergence.events].concat(),
        &plan.routes,
    )
    .expect("reduce the build and convergence segments");
    for node in &plan.nodes {
        assert_eq!(
            reduced.node_states.get(&node.id),
            Some(&PlanNodeExecutionState::Completed),
            "plan node {} did not complete across segments",
            node.id
        );
    }
    assert_eq!(reduced.status, PublishAttemptStatus::Published);
    assert!(reduced
        .routes
        .iter()
        .all(|route| route.status == DeliveryStatus::Published));
    assert_eq!(
        reduced.manifest_digest.as_deref(),
        Some(manifest.digest.as_str())
    );
}
