//! 本地交付保留执行位：Provider 原生输出中的可执行文件（Go/Rust 二进制等）
//! 经 Artifact Store 与本地目录交付后仍可直接运行。
#![cfg(unix)]

use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use publish_adapters::{
    AdapterContract, AdapterExecutionContext, CleanCheckoutGuard, LocalDirectoryDestination,
    ProviderExecution, ProviderExecutionOutcome, ProviderExecutionPort, SealedBuildCommand,
    SelectedProjectProvider, TemporaryArtifactStore, SELECTED_PROVIDER_PROGRAM,
};
use publish_domain::{
    AdapterSettings, ArtifactCandidate, ArtifactManifest, DeliveryEnvelope, PlanNode,
    PlanOperation, PlanStage, PublishError,
};

static EMPTY_CREDENTIALS: BTreeMap<String, publish_domain::ResolvedCredential> = BTreeMap::new();

/// 构建产物已在原生输出目录就位；端口只报告一次成功执行。
struct PrebuiltOutputPort {
    output_directory: PathBuf,
}

impl ProviderExecutionPort for PrebuiltOutputPort {
    fn execute_spec(&self, _spec_json: &str) -> Result<ProviderExecutionOutcome, PublishError> {
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
    let stage = plan_node(
        &destination,
        PlanStage::StageRoutes,
        destination.default_settings(),
        action("stage_local_directory"),
    );
    let envelopes = destination
        .execute_node(&stage, &context(&[], Some(&manifest), &[]))
        .expect("stage the local delivery")
        .envelopes;
    let publish = plan_node(
        &destination,
        PlanStage::PublishRoutes,
        destination.default_settings(),
        action("publish_local_directory"),
    );
    let receipts = destination
        .execute_node(&publish, &context(&[], Some(&manifest), &envelopes))
        .expect("publish the local delivery")
        .receipts;
    let delivered = PathBuf::from(&receipts[0].external_reference);

    assert_eq!(mode(&delivered.join("go-demo")), 0o755);
    assert_eq!(mode(&delivered.join("README.txt")), 0o644);
    let run = Command::new(delivered.join("go-demo"))
        .output()
        .expect("the delivered binary runs directly");
    assert!(run.status.success());
    assert_eq!(run.stdout, b"delivered\n");
}

#[test]
fn reused_store_copies_regain_the_executable_mode() {
    let root = tempfile::tempdir().expect("store root");
    let store = TemporaryArtifactStore::new(root.path());
    let binary = ArtifactCandidate::new(
        "provider-output",
        "go-demo",
        "application/octet-stream",
        "test-os",
        "test-arch",
        b"#!/bin/sh\n".to_vec(),
    )
    .with_executable(true);

    let manifest = persist(&store, std::slice::from_ref(&binary));
    let stored = Path::new(&manifest.artifacts[0].locator);
    assert_eq!(mode(stored), 0o755);

    // 模拟旧版本以默认权限写下的同内容副本：可复现构建会再次命中这个路径。
    fs::set_permissions(stored, fs::Permissions::from_mode(0o644)).expect("downgrade mode");
    persist(&store, &[binary]);
    assert_eq!(mode(stored), 0o755);
}
