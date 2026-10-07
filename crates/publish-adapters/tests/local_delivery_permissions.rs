//! 本地交付保留执行位：Provider 原生输出中的可执行文件（Go/Rust 二进制等）
//! 经 Artifact Store 与本地目录交付后仍可直接运行；推广既有集合时同样如此。
#![cfg(unix)]

use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use publish_adapters::{
    AdapterContract, AdapterExecutionContext, CancellationSignal, CleanCheckoutGuard,
    LocalDirectoryDestination, ProviderExecution, ProviderExecutionOutcome, ProviderExecutionPort,
    SealedBuildCommand, SelectedProjectProvider, TemporaryArtifactStore, SELECTED_PROVIDER_PROGRAM,
};
use publish_domain::{
    sha256_hex, AdapterSettings, ArtifactCandidate, ArtifactManifest, ArtifactManifestEntry,
    DeliveryEnvelope, PlanNode, PlanOperation, PlanStage, PublishError,
    LEGACY_ARTIFACT_MANIFEST_VERSION,
};
use serde_json::{json, Value};

static EMPTY_CREDENTIALS: BTreeMap<String, publish_domain::ResolvedCredential> = BTreeMap::new();

/// 构建产物已在原生输出目录就位；端口只报告一次成功执行。
struct PrebuiltOutputPort {
    output_directory: PathBuf,
}

impl ProviderExecutionPort for PrebuiltOutputPort {
    fn execute_spec(
        &self,
        _spec_json: &str,
        _cancellation: &CancellationSignal,
    ) -> Result<ProviderExecutionOutcome, PublishError> {
        Ok(ProviderExecutionOutcome {
            success: true,
            cancelled: false,
            error: None,
            output_dir: self.output_directory.to_string_lossy().to_string(),
        })
    }

    fn execute_build(
        &self,
        _request: SealedBuildCommand,
        _cancellation: &CancellationSignal,
    ) -> Result<ProviderExecutionOutcome, PublishError> {
        unreachable!("the selected provider runs its sealed publish spec")
    }
}

fn plan_node(
    adapter: &dyn AdapterContract,
    stage: PlanStage,
    settings: AdapterSettings,
    operation: PlanOperation,
) -> PlanNode {
    PlanNode {
        id: format!("{stage:?}"),
        stage,
        adapter: adapter.descriptor().identity(),
        binding_id: "local".to_string(),
        settings,
        operation,
        depends_on: vec![],
        artifact_inputs: vec![],
        artifact_outputs: vec![],
        side_effects: vec![],
        cancellable: true,
        cleanup_owned_staging: false,
        irreversible: false,
        platform: publish_domain::PlanNodePlatform::Any,
    }
}

fn action(name: &str) -> PlanOperation {
    PlanOperation::AdapterAction {
        action: name.to_string(),
        inputs: BTreeMap::new(),
    }
}

fn context<'a>(
    artifacts: &'a [ArtifactCandidate],
    manifest: Option<&'a ArtifactManifest>,
    envelopes: &'a [DeliveryEnvelope],
) -> AdapterExecutionContext<'a> {
    AdapterExecutionContext {
        attempt_id: "attempt-permissions",
        plan_digest: "plan-digest",
        snapshot_digest: "snapshot-digest",
        artifacts,
        manifest,
        envelopes,
        receipts: &[],
        credentials: &EMPTY_CREDENTIALS,
        cancellation: CancellationSignal::new(),
    }
}

fn persist(store: &TemporaryArtifactStore, artifacts: &[ArtifactCandidate]) -> ArtifactManifest {
    let node = plan_node(
        store,
        PlanStage::PersistManifest,
        store.default_settings(),
        action("persist_manifest"),
    );
    store
        .execute_node(&node, &context(artifacts, None, &[]))
        .expect("persist the artifact set")
        .manifest
        .expect("persist seals a manifest")
}

fn write_with_mode(path: &Path, bytes: &[u8], mode: u32) {
    fs::write(path, bytes).expect("write provider output");
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).expect("set provider output mode");
}

fn mode(path: &Path) -> u32 {
    fs::metadata(path)
        .expect("inspect file mode")
        .permissions()
        .mode()
        & 0o777
}

#[test]
fn delivered_executables_keep_their_mode_and_run_directly() {
    let temp = tempfile::tempdir().expect("temp workspace");
    let output = temp.path().join("dist");
    fs::create_dir_all(&output).expect("create provider output");
    write_with_mode(
        &output.join("go-demo"),
        b"#!/bin/sh\necho delivered\n",
        0o755,
    );
    write_with_mode(&output.join("README.txt"), b"notes\n", 0o644);

    let provider = SelectedProjectProvider::with_execution(
        "{}".to_string(),
        Some(ProviderExecution {
            port: Arc::new(PrebuiltOutputPort {
                output_directory: output.clone(),
            }),
            output_directory: output,
            artifact_filter: None,
            clear_stale_artifacts: false,
            source_guard: Arc::new(CleanCheckoutGuard),
        }),
    );
    let build = plan_node(
        &provider,
        PlanStage::Build,
        provider.default_settings(),
        PlanOperation::RunProgram {
            program: SELECTED_PROVIDER_PROGRAM.to_string(),
            args: vec![],
            working_directory: None,
            environment_references: BTreeMap::new(),
        },
    );
    let artifacts = provider
        .execute_node(&build, &context(&[], None, &[]))
        .expect("collect provider output")
        .artifacts;

    let store = TemporaryArtifactStore::new(temp.path().join("store"));
    let manifest = persist(&store, &artifacts);
    let destination = LocalDirectoryDestination::new(temp.path().join("deliveries"));
    let delivered = deliver(&destination, &manifest);

    assert_eq!(mode(&delivered.join("go-demo")), 0o755);
    assert_eq!(mode(&delivered.join("README.txt")), 0o644);
    assert_runs(&delivered.join("go-demo"), b"delivered\n");
}

/// 执行位以封存清单为准：Store 副本按内容寻址、由同内容的多个集合共享，
/// 它的权限位（旧版本写下的 0644，或另一集合改写的权限）不影响交付。
#[test]
fn the_sealed_executable_flag_decides_the_delivered_mode() {
    let temp = tempfile::tempdir().expect("temp workspace");
    let store = TemporaryArtifactStore::new(temp.path().join("store"));
    let manifest = persist(
        &store,
        &[
            candidate("go-demo", b"#!/bin/sh\necho sealed\n").with_executable(true),
            // 内容像脚本但封存为不可执行：v2 清单不按内容猜测。
            candidate("notes.sh", b"#!/bin/sh\n# reference only\n"),
        ],
    );
    let stored = |name: &str| {
        let entry = manifest
            .artifacts
            .iter()
            .find(|entry| entry.file_name == name)
            .expect("sealed entry");
        PathBuf::from(&entry.locator)
    };
    fs::set_permissions(stored("go-demo"), fs::Permissions::from_mode(0o644))
        .expect("downgrade the shared store copy");
    fs::set_permissions(stored("notes.sh"), fs::Permissions::from_mode(0o755))
        .expect("upgrade the shared store copy");

    let destination = LocalDirectoryDestination::new(temp.path().join("deliveries"));
    let delivered = deliver(&destination, &manifest);
    assert_eq!(mode(&delivered.join("go-demo")), 0o755);
    assert_eq!(mode(&delivered.join("notes.sh")), 0o644);

    // 续传命中已存在的交付副本时同样按封存执行位校正。
    fs::set_permissions(delivered.join("go-demo"), fs::Permissions::from_mode(0o644))
        .expect("simulate a delivery copy without the executable bit");
    assert_eq!(deliver(&destination, &manifest), delivered);
    assert_eq!(mode(&delivered.join("go-demo")), 0o755);
    assert_runs(&delivered.join("go-demo"), b"sealed\n");
}

/// 推广 v1.0.3 存下的集合（`<temp>/one-publish/artifacts/` 下的 0644 副本、
/// 没有执行位的 v1 清单）：不重新构建，交付出的二进制恢复执行位并可直接运行。
#[test]
fn promoting_a_legacy_set_restores_the_executable_mode() {
    let temp = tempfile::tempdir().expect("temp workspace");
    let root = temp.path().join("store");
    let entries = [
        ("go-demo", &b"#!/bin/sh\necho promoted\n"[..]),
        ("README.txt", &b"release notes\n"[..]),
    ]
    .map(|(file_name, bytes)| {
        let digest = sha256_hex(bytes);
        let stored = root.join(&digest).join(file_name);
        fs::create_dir_all(stored.parent().expect("artifact directory"))
            .expect("create artifact directory");
        write_with_mode(&stored, bytes, 0o644);
        ArtifactManifestEntry {
            role: "provider-output".to_string(),
            file_name: file_name.to_string(),
            media_type: "application/octet-stream".to_string(),
            platform: "macos".to_string(),
            architecture: "aarch64".to_string(),
            size: bytes.len() as u64,
            digest,
            locator: stored.to_string_lossy().to_string(),
            retention: "604800s".to_string(),
            executable: None,
        }
    });
    let mut legacy = ArtifactManifest {
        version: LEGACY_ARTIFACT_MANIFEST_VERSION,
        planning_snapshot_digest: "snapshot-v1.0.3".to_string(),
        artifacts: entries.to_vec(),
        digest: String::new(),
    };
    legacy.digest = legacy.recomputed_digest().expect("legacy digest");
    // v1.0.3 的集合记录布局：`<root>/manifests/<manifest digest>.json`。
    let records = root.join("manifests");
    fs::create_dir_all(&records).expect("create set record directory");
    fs::write(
        records.join(format!("{}.json", legacy.digest)),
        serde_json::to_vec_pretty(&json!({
            "manifest": legacy,
            "stored_at": "2026-10-01T00:00:00Z",
            "retain_until": "2099-01-01T00:00:00Z",
        }))
        .expect("encode the legacy set record"),
    )
    .expect("write the legacy set record");

    let store = TemporaryArtifactStore::new(&root);
    let bind = plan_node(
        &store,
        PlanStage::PersistManifest,
        store.default_settings(),
        PlanOperation::AdapterAction {
            action: "bind_promoted_manifest".to_string(),
            inputs: BTreeMap::from([(
                "manifest_digest".to_string(),
                Value::String(legacy.digest.clone()),
            )]),
        },
    );
    let promoted = store
        .execute_node(&bind, &context(&[], None, &[]))
        .expect("promote the legacy set")
        .manifest
        .expect("promotion binds the stored manifest");
    assert_eq!(promoted, legacy, "promotion keeps the sealed identity");

    let destination = LocalDirectoryDestination::new(temp.path().join("deliveries"));
    let delivered = deliver(&destination, &promoted);
    assert_eq!(mode(&delivered.join("go-demo")), 0o755);
    assert_eq!(mode(&delivered.join("README.txt")), 0o644);
    assert_runs(&delivered.join("go-demo"), b"promoted\n");
}

fn candidate(file_name: &str, bytes: &[u8]) -> ArtifactCandidate {
    ArtifactCandidate::new(
        "provider-output",
        file_name,
        "application/octet-stream",
        "test-os",
        "test-arch",
        bytes.to_vec(),
    )
}

/// 依次执行本地目录路线的 stage 与 publish，返回交付目录；同一尝试重复
/// 交付即续传同一目录。
fn deliver(destination: &LocalDirectoryDestination, manifest: &ArtifactManifest) -> PathBuf {
    let stage = plan_node(
        destination,
        PlanStage::StageRoutes,
        destination.default_settings(),
        action("stage_local_directory"),
    );
    let envelopes = destination
        .execute_node(&stage, &context(&[], Some(manifest), &[]))
        .expect("stage the local delivery")
        .envelopes;
    let publish = plan_node(
        destination,
        PlanStage::PublishRoutes,
        destination.default_settings(),
        action("publish_local_directory"),
    );
    let receipts = destination
        .execute_node(&publish, &context(&[], Some(manifest), &envelopes))
        .expect("publish the local delivery")
        .receipts;
    PathBuf::from(&receipts[0].external_reference)
}

fn assert_runs(executable: &Path, expected_stdout: &[u8]) {
    let run = Command::new(executable)
        .output()
        .expect("the delivered binary runs directly");
    assert!(run.status.success());
    assert_eq!(run.stdout, expected_stdout);
}
