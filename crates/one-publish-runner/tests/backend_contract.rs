use std::collections::BTreeMap;
use std::sync::Arc;

use one_publish_runner::{
    current_runtime_revision, installed_registry, installed_runner, RunnerProjection,
    StandaloneRunner,
};
use publish_adapters::{
    AdapterConformanceFixture, AdapterContract, AdapterExecutionContext, AdapterExecutionOutput,
    AdapterRegistry, ExecutionBackend, FakeGitHubActionsBackend, LocalDirectoryDestination,
    LocalExecutionBackend, ProjectProvider, StaticCredentialSource, TemporaryArtifactStore,
    ARTIFACT_CANDIDATE_CAPABILITY, ARTIFACT_VERIFIED_CAPABILITY,
    STRUCTURED_PLAN_EXECUTION_CAPABILITY,
};
use publish_domain::{
    sha256_hex, AdapterBinding, AdapterDescriptor, AdapterIdentity, AdapterKind, AdapterSchema,
    AdapterSelection, AdapterSettings, ArtifactCandidate, AutomationRuntimeRevision, Capability,
    CapabilityRequirement, DeliveryRoute, PlanNode, PlanNodeTemplate, PlanStage,
    PlanningInputSnapshot, PublishOutcome, PublishingCapability, SourceSnapshot,
    PLANNING_INPUT_SNAPSHOT_VERSION,
};
use serde_json::Value;

const ARTIFACT_BYTES: &[u8] = b"same runner output";

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
        .with_artifact_io(
            vec![],
            vec!["desktop-installer".to_string()],
        )])
    }

    fn execute_node(
        &self,
        _node: &PlanNode,
        _context: &AdapterExecutionContext<'_>,
    ) -> Result<AdapterExecutionOutput, publish_domain::PublishError> {
        Ok(AdapterExecutionOutput {
            artifacts: vec![ArtifactCandidate::new(
                "desktop-installer",
                "app.bin",
                "application/octet-stream",
                "test-os",
                "test-arch",
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
