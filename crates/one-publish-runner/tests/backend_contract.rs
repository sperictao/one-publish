use std::collections::BTreeMap;
use std::sync::Arc;

use one_publish_runner::{
    current_runtime_revision, installed_registry, installed_runner, RunnerProjection,
    StandaloneRunner,
};
use publish_adapters::{
    AdapterConformanceFixture, AdapterContract, AdapterExecutionContext, AdapterExecutionOutput,
    AdapterRegistry, ExecutionBackend, FakeGitHubActionsBackend, FakeGitHubReleaseApi,
    FakeSftpServer, GitHubReleaseDestination, LocalDirectoryDestination, LocalExecutionBackend,
    ProjectProvider, SftpDeliveryDestination, StaticCredentialSource, TemporaryArtifactStore,
    ARTIFACT_CANDIDATE_CAPABILITY, ARTIFACT_VERIFIED_CAPABILITY, SFTP_DELIVERY_RECORD_NAME,
    STRUCTURED_PLAN_EXECUTION_CAPABILITY,
};
use publish_domain::{
    sha256_hex, AdapterBinding, AdapterDescriptor, AdapterIdentity, AdapterKind, AdapterSchema,
    AdapterSelection, AdapterSettings, ArtifactCandidate, AutomationRuntimeRevision, Capability,
    CapabilityRequirement, CredentialKind, DeliveryRoute, DeliveryStatus, PlanNode,
    PlanNodeTemplate, PlanStage, PlanningInputSnapshot, PublishOutcome, PublishingCapability,
    SourceSnapshot, PLANNING_INPUT_SNAPSHOT_VERSION,
};
use serde_json::Value;

const ARTIFACT_BYTES: &[u8] = b"same runner output";
const GITHUB_TOKEN_REFERENCE: &str = "ci-github-token";
const GITHUB_TOKEN_VALUE: &str = "contract-token-value";
const SFTP_KEY_REFERENCE: &str = "ci-sftp-key";
const SFTP_KEY_VALUE: &str =
    "-----BEGIN OPENSSH PRIVATE KEY-----\ncontract-key\n-----END OPENSSH PRIVATE KEY-----";

struct ContractProjectProvider {
    descriptor: AdapterDescriptor,
}

impl ContractProjectProvider {
    fn new() -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ProjectProvider,
                "contract-project",
                1,
                AdapterSchema::new(1),
                PublishingCapability {
                    provides: vec![
                        Capability::new(ARTIFACT_CANDIDATE_CAPABILITY, 1),
                        Capability::new(ARTIFACT_VERIFIED_CAPABILITY, 1),
                    ],
                    requires: vec![CapabilityRequirement::exact(
                        STRUCTURED_PLAN_EXECUTION_CAPABILITY,
                        1,
                    )],
                },
            ),
        }
    }
}

impl AdapterContract for ContractProjectProvider {
    fn descriptor(&self) -> &AdapterDescriptor {
        &self.descriptor
    }

    fn default_settings(&self) -> AdapterSettings {
        AdapterSettings::new(1)
    }

    fn plan_fragment(
        &self,
        _snapshot: &PlanningInputSnapshot,
        _settings: &AdapterSettings,
    ) -> Result<Vec<PlanNodeTemplate>, publish_domain::PublishError> {
        Ok(vec![PlanNodeTemplate::adapter_action(
            "build",
            PlanStage::Build,
            "build_contract_artifact",
            BTreeMap::new(),
        )
        .with_artifact_io(vec![], vec!["installer".to_string()])])
    }

    fn execute_node(
        &self,
        _node: &PlanNode,
        _context: &AdapterExecutionContext<'_>,
    ) -> Result<AdapterExecutionOutput, publish_domain::PublishError> {
        Ok(AdapterExecutionOutput {
            artifacts: vec![ArtifactCandidate::new(
                "installer",
                "app.bin",
                "application/octet-stream",
                "linux",
                "x86_64",
                ARTIFACT_BYTES.to_vec(),
            )],
            ..AdapterExecutionOutput::default()
        })
    }
}

impl ProjectProvider for ContractProjectProvider {}

#[test]
fn local_and_fake_github_actions_share_runner_contract_semantics() {
    let local_root = tempfile::tempdir().expect("local fixture root");
    let github_root = tempfile::tempdir().expect("GitHub fixture root");
    let (local_runner, local_snapshot) = fixture_runner(
        Arc::new(LocalExecutionBackend::new()),
        "local-execution",
        local_root.path(),
    );
    let (github_runner, github_snapshot) = fixture_runner(
        Arc::new(FakeGitHubActionsBackend::new(Arc::new(
            StaticCredentialSource::new(),
        ))),
        "fake-github-actions",
        github_root.path(),
    );

    let local_projection = local_runner
        .prepare_projection(&local_snapshot)
        .expect("prepare local projection");
    let github_projection = github_runner
        .prepare_projection(&github_snapshot)
        .expect("prepare fake GitHub Actions projection");
    let local = local_runner
        .execute(&local_projection, "attempt-contract")
        .expect("execute locally");
    let github = github_runner
        .execute(&github_projection, "attempt-contract")
        .expect("execute through fake GitHub Actions");

    let node_contract = |projection: &RunnerProjection| {
        projection
            .prepared
            .plan
            .nodes
            .iter()
            .map(|node| {
                (
                    node.id.clone(),
                    node.stage,
                    node.depends_on.clone(),
                    node.artifact_inputs.clone(),
                    node.artifact_outputs.clone(),
                )
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(
        node_contract(&local_projection),
        node_contract(&github_projection)
    );
    assert_compatible_outcomes(&local, &github);
}

#[test]
fn fixed_projection_executes_after_the_control_plane_is_removed() {
    let control_plane_root = tempfile::tempdir().expect("control plane root");
    let installed_root = tempfile::tempdir().expect("installed automation root");
    let (control_plane_runner, snapshot) = fixture_runner(
        Arc::new(FakeGitHubActionsBackend::new(Arc::new(
            StaticCredentialSource::new(),
        ))),
        "fake-github-actions",
        installed_root.path(),
    );
    let seed_projection = control_plane_runner
        .prepare_projection(&snapshot)
        .expect("prepare seed projection");
    let seed = control_plane_runner
        .execute(&seed_projection, "attempt-seed")
        .expect("seed promoted artifact set");

    let store = installed_root.path().join("store");
    let delivery = installed_root.path().join("offline-delivery");
    let mut installed_snapshot = fixture_snapshot(
        "fake-github-actions",
        store.to_string_lossy().as_ref(),
        delivery.to_string_lossy().as_ref(),
    );
    let tauri = publish_adapters::TauriProjectProvider::new();
    installed_snapshot.adapters.project_provider = AdapterBinding::new(
        "project",
        tauri.descriptor().identity(),
        tauri.default_settings(),
    );
    installed_snapshot.promoted_manifest_digest = Some(seed.manifest.digest);
    let revision = runtime_revision(&installed_snapshot);
    installed_snapshot.runtime_revision = revision.identifier();
    let installed_control_plane = StandaloneRunner::new(
        installed_registry(&installed_snapshot).expect("assemble installed adapter host"),
        revision,
    )
    .expect("create installed runner");
    let projection = installed_control_plane
        .prepare_projection(&installed_snapshot)
        .expect("seal installed projection");
    let projection_path = installed_root.path().join("runner-projection.json");
    std::fs::write(
        &projection_path,
        serde_json::to_vec(&projection).expect("serialize installed projection"),
    )
    .expect("install runner projection");
    std::fs::write(control_plane_root.path().join("configuration.json"), "{}")
        .expect("write control-plane sentinel");
    drop(control_plane_runner);
    drop(installed_control_plane);
    std::fs::remove_dir_all(control_plane_root.path()).expect("turn control plane off");

    let execution = std::process::Command::new(env!("CARGO_BIN_EXE_one-publish-runner"))
        .arg("execute")
        .arg(&projection_path)
        .arg("attempt-offline")
        .output()
        .expect("start installed runner process");
    assert!(
        execution.status.success(),
        "installed runner rejected projection: {}",
        String::from_utf8_lossy(&execution.stderr)
    );
    let outcome: PublishOutcome =
        serde_json::from_slice(&execution.stdout).expect("decode installed runner outcome");

    assert_eq!(
        outcome.manifest.artifacts[0].digest,
        sha256_hex(ARTIFACT_BYTES)
    );
    assert!(!outcome.events.is_empty());
    assert_eq!(outcome.receipts.len(), 1);
}

#[test]
fn runner_rejects_missing_or_digest_mismatched_runtime_before_execution() {
    let root = tempfile::tempdir().expect("runner fixture root");
    let (runner, snapshot) = fixture_runner(
        Arc::new(LocalExecutionBackend::new()),
        "local-execution",
        root.path(),
    );

    let mut missing = snapshot.clone();
    missing.runtime_revision.clear();
    let missing_error = runner
        .prepare_projection(&missing)
        .expect_err("missing runtime pin must be rejected");
    assert!(missing_error.to_string().contains("missing"));

    let mut tampered = runner
        .prepare_projection(&snapshot)
        .expect("prepare sealed projection");
    tampered.runtime_revision.digest = "0".repeat(64);
    let mismatch = runner
        .execute(&tampered, "attempt-tampered")
        .expect_err("tampered runtime digest must be rejected");
    assert!(mismatch.to_string().contains("digest mismatch"));

    let current = runtime_revision(&snapshot);
    let foreign = AutomationRuntimeRevision::seal(
        publish_domain::RuntimeComponentRevision::new("9.9.9", current.runner.digest.clone()),
        current.plan_contract.clone(),
        current.adapters.clone(),
    )
    .expect("seal self-consistent foreign runtime");
    let mut foreign_snapshot = snapshot.clone();
    foreign_snapshot.runtime_revision = foreign.identifier();
    let foreign_registry = fixture_registry(
        Arc::new(LocalExecutionBackend::new()),
        &foreign_snapshot,
        root.path(),
    );
    let foreign_projection = StandaloneRunner::new(foreign_registry, foreign)
        .expect("create foreign runner fixture")
        .prepare_projection(&foreign_snapshot)
        .expect("prepare self-consistent foreign projection");
    let foreign_error = match installed_runner(&foreign_projection) {
        Ok(_) => panic!("installed binary must reject a different self-consistent runtime"),
        Err(error) => error,
    };
    assert!(foreign_error
        .to_string()
        .contains("installed runner provides"));
}

/// Issue T16 验收：Local 与 GitHub Actions Backend 使用同一配置修订向 GitHub
/// Release Route 交付，共享同一目标语义——节点合同、事件合同、Receipt 生命周期
///（Submitted 后由远端观察确认 Published）与远端最终状态完全一致。
#[test]
fn local_and_fake_github_actions_deliver_the_same_github_release_route() {
    let local_root = tempfile::tempdir().expect("local fixture root");
    let github_root = tempfile::tempdir().expect("GitHub fixture root");
    let credentials = || {
        Arc::new(StaticCredentialSource::new().with_secret(
            GITHUB_TOKEN_REFERENCE,
            CredentialKind::Token,
            GITHUB_TOKEN_VALUE,
        ))
    };
    let local_api = Arc::new(FakeGitHubReleaseApi::new());
    let github_api = Arc::new(FakeGitHubReleaseApi::new());
    let (local_runner, local_snapshot) = github_release_fixture_runner(
        Arc::new(LocalExecutionBackend::with_credential_source(credentials())),
        "local-execution",
        local_root.path(),
        local_api.clone(),
    );
    let (github_runner, github_snapshot) = github_release_fixture_runner(
        Arc::new(FakeGitHubActionsBackend::new(credentials())),
        "fake-github-actions",
        github_root.path(),
        github_api.clone(),
    );
    // 同一配置修订驱动两个后端：GitHub Release 路线绑定（设置与凭据引用）
    // 逐字一致，只有执行后端与本地存储位置属于后端环境。
    assert_eq!(
        local_snapshot.configuration_revision,
        github_snapshot.configuration_revision
    );
    assert_eq!(
        local_snapshot.adapters.delivery_routes,
        github_snapshot.adapters.delivery_routes
    );

    let local_projection = local_runner
        .prepare_projection(&local_snapshot)
        .expect("prepare local projection");
    let github_projection = github_runner
        .prepare_projection(&github_snapshot)
        .expect("prepare fake GitHub Actions projection");
    let local = local_runner
        .execute(&local_projection, "attempt-github-contract")
        .expect("deliver the github release locally");
    let github = github_runner
        .execute(&github_projection, "attempt-github-contract")
        .expect("deliver the github release through fake GitHub Actions");

    assert_compatible_outcomes(&local, &github);
    for (outcome, api) in [(&local, &local_api), (&github, &github_api)] {
        // 只有远端观察为 Published 的 Receipt 修订满足 Required Route。
        let last = outcome.receipts.last().expect("observed receipt");
        assert_eq!(last.status, DeliveryStatus::Published);
        assert_eq!(last.revision, 2);
        let release = api.release("v1.0.0").expect("remote release");
        assert!(!release.draft);
        let names: Vec<&str> = release
            .assets
            .iter()
            .map(|asset| asset.name.as_str())
            .collect();
        assert_eq!(names, vec!["app.bin"]);
        assert_eq!(release.assets[0].digest, sha256_hex(ARTIFACT_BYTES));
    }
}

/// Issue T17 验收：Local 与 GitHub Actions Backend 通过 PublishRuntime 使用
/// 同一配置修订向同一 SFTP 路线交付——节点合同、事件合同、Receipt 生命周期
/// （Submitted 后由远端观察确认 Published）与远端最终状态完全一致。
#[test]
fn local_and_fake_github_actions_deliver_the_same_sftp_route() {
    let local_root = tempfile::tempdir().expect("local fixture root");
    let github_root = tempfile::tempdir().expect("GitHub fixture root");
    let credentials = || {
        Arc::new(StaticCredentialSource::new().with_secret(
            SFTP_KEY_REFERENCE,
            CredentialKind::SshPrivateKey,
            SFTP_KEY_VALUE,
        ))
    };
    let local_server = Arc::new(FakeSftpServer::new());
    let github_server = Arc::new(FakeSftpServer::new());
    let (local_runner, local_snapshot) = sftp_fixture_runner(
        Arc::new(LocalExecutionBackend::with_credential_source(credentials())),
        "local-execution",
        local_root.path(),
        local_server.clone(),
    );
    let (github_runner, github_snapshot) = sftp_fixture_runner(
        Arc::new(FakeGitHubActionsBackend::new(credentials())),
        "fake-github-actions",
        github_root.path(),
        github_server.clone(),
    );
    // 同一配置修订驱动两个后端：SFTP 路线绑定（设置与凭据引用）逐字一致，
    // 只有执行后端与本地存储位置属于后端环境。
    assert_eq!(
        local_snapshot.configuration_revision,
        github_snapshot.configuration_revision
    );
    assert_eq!(
        local_snapshot.adapters.delivery_routes,
        github_snapshot.adapters.delivery_routes
    );

    let local_projection = local_runner
        .prepare_projection(&local_snapshot)
        .expect("prepare local projection");
    let github_projection = github_runner
        .prepare_projection(&github_snapshot)
        .expect("prepare fake GitHub Actions projection");
    let local = local_runner
        .execute(&local_projection, "attempt-sftp-contract")
        .expect("deliver the sftp route locally");
    let github = github_runner
        .execute(&github_projection, "attempt-sftp-contract")
        .expect("deliver the sftp route through fake GitHub Actions");

    assert_compatible_outcomes(&local, &github);
    for (outcome, server) in [(&local, &local_server), (&github, &github_server)] {
        // 只有远端观察为 Published 的 Receipt 修订满足 Required Route。
        let last = outcome.receipts.last().expect("observed receipt");
        assert_eq!(last.status, DeliveryStatus::Published);
        assert_eq!(last.revision, 2);
        assert_eq!(
            last.external_reference,
            "sftp://deploy@files.example.com:22/srv/releases/1.0.0"
        );
        assert_eq!(
            server.file("srv/releases/1.0.0/app.bin"),
            Some(ARTIFACT_BYTES.to_vec())
        );
        let record: Value = serde_json::from_slice(
            &server
                .file(&format!("srv/releases/1.0.0/{SFTP_DELIVERY_RECORD_NAME}"))
                .expect("committed delivery record"),
        )
        .expect("parse the delivery record");
        assert_eq!(
            record.get("manifest_digest").and_then(Value::as_str),
            Some(outcome.manifest.digest.as_str())
        );
        assert!(server.paths().iter().all(|path| !path.ends_with(".part")));
    }
}

/// 除执行后端外的完整 Adapter 选择：两个后端必须消费同一份配置修订内容。
fn sftp_fixture_runner(
    backend: Arc<dyn ExecutionBackend>,
    backend_id: &str,
    root: &std::path::Path,
    server: Arc<FakeSftpServer>,
) -> (StandaloneRunner, PlanningInputSnapshot) {
    let store = root.join("store");
    let mut snapshot = fixture_snapshot(
        backend_id,
        store.to_string_lossy().as_ref(),
        "unused-delivery-directory",
    );
    snapshot.adapters.delivery_routes = vec![DeliveryRoute::required(
        AdapterBinding::new(
            "sftp-release-route",
            AdapterIdentity::new(AdapterKind::DeliveryDestination, "sftp", 1),
            sftp_settings(),
        )
        .with_credential("ssh_private_key", SFTP_KEY_REFERENCE),
    )];
    let revision = runtime_revision(&snapshot);
    snapshot.runtime_revision = revision.identifier();

    let fixture = AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(Arc::new(ContractProjectProvider::new()), &fixture)
        .expect("register contract provider");
    registry
        .register_execution_backend(backend, &fixture)
        .expect("register execution backend");
    registry
        .register_artifact_store(Arc::new(TemporaryArtifactStore::new(&store)), &fixture)
        .expect("register artifact store");
    registry
        .register_delivery_destination(Arc::new(SftpDeliveryDestination::new(server)), &fixture)
        .expect("register sftp destination");
    (
        StandaloneRunner::new(registry, revision).expect("create runner"),
        snapshot,
    )
}

fn sftp_settings() -> AdapterSettings {
    AdapterSettings::new(1)
        .with_value("host", Value::String("files.example.com".to_string()))
        .with_value("port", Value::from(22u64))
        .with_value("username", Value::String("deploy".to_string()))
        .with_value("remote_path", Value::String("/srv/releases".to_string()))
        .with_value(
            "artifact_roles",
            Value::Array(vec![Value::String("installer".to_string())]),
        )
}

/// 除执行后端外的完整 Adapter 选择：两个后端必须消费同一份配置修订内容。
fn github_release_fixture_runner(
    backend: Arc<dyn ExecutionBackend>,
    backend_id: &str,
    root: &std::path::Path,
    api: Arc<FakeGitHubReleaseApi>,
) -> (StandaloneRunner, PlanningInputSnapshot) {
    let store = root.join("store");
    let mut snapshot = fixture_snapshot(
        backend_id,
        store.to_string_lossy().as_ref(),
        "unused-delivery-directory",
    );
    snapshot.release_input.insert(
        "platform_code_signing".to_string(),
        Value::String("signed".to_string()),
    );
    snapshot.adapters.delivery_routes = vec![DeliveryRoute::required(
        AdapterBinding::new(
            "github-release-route",
            AdapterIdentity::new(AdapterKind::DeliveryDestination, "github-release", 1),
            github_release_settings(),
        )
        .with_credential("github_token", GITHUB_TOKEN_REFERENCE),
    )];
    let revision = runtime_revision(&snapshot);
    snapshot.runtime_revision = revision.identifier();

    let fixture = AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(Arc::new(ContractProjectProvider::new()), &fixture)
        .expect("register contract provider");
    registry
        .register_execution_backend(backend, &fixture)
        .expect("register execution backend");
    registry
        .register_artifact_store(Arc::new(TemporaryArtifactStore::new(&store)), &fixture)
        .expect("register artifact store");
    registry
        .register_delivery_destination(Arc::new(GitHubReleaseDestination::new(api)), &fixture)
        .expect("register github release destination");
    (
        StandaloneRunner::new(registry, revision).expect("create runner"),
        snapshot,
    )
}

fn github_release_settings() -> AdapterSettings {
    AdapterSettings::new(1)
        .with_value("repository", Value::String("acme/demo".to_string()))
        .with_value("visibility", Value::String("public".to_string()))
        .with_value("tag_prefix", Value::String("v".to_string()))
        .with_value(
            "allowed_asset_roles",
            Value::Array(vec![Value::String("installer".to_string())]),
        )
        .with_value("updater_enabled", Value::Bool(false))
        .with_value(
            "enabled_platforms",
            Value::Array(vec![Value::String("linux-x86_64".to_string())]),
        )
        .with_value("unsigned_release_override", Value::Bool(false))
}

fn fixture_runner(
    backend: Arc<dyn ExecutionBackend>,
    backend_id: &str,
    root: &std::path::Path,
) -> (StandaloneRunner, PlanningInputSnapshot) {
    let store = root.join("store");
    let delivery = root.join("delivery");
    let mut snapshot = fixture_snapshot(
        backend_id,
        store.to_string_lossy().as_ref(),
        delivery.to_string_lossy().as_ref(),
    );
    let revision = runtime_revision(&snapshot);
    snapshot.runtime_revision = revision.identifier();
    let registry = fixture_registry(backend, &snapshot, root);
    (
        StandaloneRunner::new(registry, revision).expect("create runner"),
        snapshot,
    )
}

fn fixture_registry(
    backend: Arc<dyn ExecutionBackend>,
    snapshot: &PlanningInputSnapshot,
    root: &std::path::Path,
) -> AdapterRegistry {
    let store = root.join("store");
    let delivery = root.join("delivery");
    let fixture = AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(Arc::new(ContractProjectProvider::new()), &fixture)
        .expect("register contract provider");
    registry
        .register_execution_backend(backend, &fixture)
        .expect("register execution backend");
    registry
        .register_artifact_store(Arc::new(TemporaryArtifactStore::new(&store)), &fixture)
        .expect("register artifact store");
    registry
        .register_delivery_destination(
            Arc::new(LocalDirectoryDestination::new(&delivery)),
            &fixture,
        )
        .expect("register destination");
    registry
}

fn fixture_snapshot(
    backend_id: &str,
    store_directory: &str,
    delivery_directory: &str,
) -> PlanningInputSnapshot {
    let empty = AdapterSettings::new(1);
    PlanningInputSnapshot {
        version: PLANNING_INPUT_SNAPSHOT_VERSION,
        configuration_revision: "configuration-revision-1".to_string(),
        runtime_revision: String::new(),
        release_input: BTreeMap::from([(
            "version".to_string(),
            Value::String("1.0.0".to_string()),
        )]),
        source: SourceSnapshot {
            revision: "0123456789abcdef".to_string(),
            workspace_digest: None,
            dirty: false,
            captured_at: "2026-07-26T10:00:00Z".to_string(),
            reproducible: true,
        },
        external_preconditions: BTreeMap::new(),
        promoted_manifest_digest: None,
        adapters: AdapterSelection {
            project_provider: AdapterBinding::new(
                "project",
                AdapterIdentity::new(AdapterKind::ProjectProvider, "contract-project", 1),
                empty.clone(),
            ),
            artifact_processors: vec![],
            execution_backend: AdapterBinding::new(
                "backend",
                AdapterIdentity::new(AdapterKind::ExecutionBackend, backend_id, 1),
                empty,
            ),
            artifact_store: AdapterBinding::new(
                "store",
                AdapterIdentity::new(AdapterKind::ArtifactStore, "temporary-artifact-store", 1),
                AdapterSettings::new(1)
                    .with_value("root_directory", Value::String(store_directory.to_string()))
                    .with_value("retention_seconds", Value::from(604_800u64)),
            ),
            delivery_routes: vec![DeliveryRoute::required(AdapterBinding::new(
                "destination",
                AdapterIdentity::new(AdapterKind::DeliveryDestination, "local-directory", 1),
                AdapterSettings::new(1)
                    .with_value("directory", Value::String(delivery_directory.to_string())),
            ))],
        },
    }
}

fn runtime_revision(snapshot: &PlanningInputSnapshot) -> AutomationRuntimeRevision {
    let adapters: Vec<_> = snapshot
        .adapters
        .ordered_bindings()
        .into_iter()
        .map(|binding| binding.adapter.clone())
        .collect();
    current_runtime_revision(adapters).expect("seal fixture runtime revision")
}

fn assert_compatible_outcomes(local: &PublishOutcome, github: &PublishOutcome) {
    let artifacts = |outcome: &PublishOutcome| {
        outcome
            .manifest
            .artifacts
            .iter()
            .map(|artifact| {
                (
                    artifact.role.clone(),
                    artifact.file_name.clone(),
                    artifact.media_type.clone(),
                    artifact.platform.clone(),
                    artifact.architecture.clone(),
                    artifact.size,
                    artifact.digest.clone(),
                    artifact.retention.clone(),
                    std::path::Path::new(&artifact.locator)
                        .file_name()
                        .map(|name| name.to_string_lossy().to_string()),
                )
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(artifacts(local), artifacts(github));

    let event_contract = |outcome: &PublishOutcome| {
        outcome
            .events
            .iter()
            .map(|event| {
                (
                    event.sequence,
                    event.plan_node_id.clone(),
                    event.kind.clone(),
                    normalized_event_payload(&event.payload),
                )
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(event_contract(local), event_contract(github));

    let receipts = |outcome: &PublishOutcome| {
        outcome
            .receipts
            .iter()
            .map(|receipt| {
                (
                    receipt.version,
                    receipt.revision,
                    receipt.route_id.clone(),
                    receipt.status,
                )
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(receipts(local), receipts(github));
    assert!(local
        .receipts
        .iter()
        .all(|receipt| receipt.manifest_digest == local.manifest.digest));
    assert!(github
        .receipts
        .iter()
        .all(|receipt| receipt.manifest_digest == github.manifest.digest));
    assert!(local
        .receipts
        .iter()
        .chain(&github.receipts)
        .all(|receipt| !receipt.external_reference.trim().is_empty()));
}

fn normalized_event_payload(payload: &BTreeMap<String, Value>) -> BTreeMap<String, Value> {
    let mut payload = payload.clone();
    if payload
        .get("adapter")
        .and_then(Value::as_str)
        .is_some_and(|adapter| adapter.starts_with("ExecutionBackend/"))
    {
        payload.insert(
            "adapter".to_string(),
            Value::String("ExecutionBackend/<host>@1".to_string()),
        );
    }
    if payload.contains_key("manifest_digest") {
        payload.insert(
            "manifest_digest".to_string(),
            Value::String("<manifest>".to_string()),
        );
    }
    if let Some(receipt) = payload.get_mut("receipt").and_then(Value::as_object_mut) {
        for field in ["receipt_id", "manifest_digest", "external_reference"] {
            if receipt.contains_key(field) {
                receipt.insert(field.to_string(), Value::String(format!("<{field}>")));
            }
        }
    }
    payload
}
