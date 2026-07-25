use std::collections::BTreeMap;
use std::fs;
use std::sync::Arc;

use publish_adapters::{
    AdapterConformanceFixture, AdapterContract, AdapterExecutionContext, AdapterExecutionOutput,
    AdapterRegistry, ArtifactProcessor, ChecksumProcessor, DeliveryDestination,
    LocalDirectoryDestination, LocalExecutionBackend, ProjectProvider, TemporaryArtifactStore,
    ARTIFACT_CANDIDATE_CAPABILITY, ARTIFACT_VERIFIED_CAPABILITY, CHECKSUM_MANIFEST_ROLE,
    CHECKSUM_PROCESSOR_ID, STRUCTURED_PLAN_EXECUTION_CAPABILITY,
};
use publish_domain::{
    sha256_hex, AdapterBinding, AdapterDescriptor, AdapterIdentity, AdapterKind, AdapterSchema,
    AdapterSelection, AdapterSettings, ArtifactCandidate, ArtifactManifest, ArtifactManifestEntry,
    Capability, CapabilityRequirement, DeliveryEnvelope, DeliveryRoute, PlanNode, PlanNodeTemplate,
    PlanStage, PlanningInputSnapshot, PublishAttemptStatus, PublishError, PublishingCapability,
    ReleaseIdentity, SourceSnapshot, PLANNING_INPUT_SNAPSHOT_VERSION,
};
use publish_runner_core::{PublishRuntime, StartPublishAttempt};
use serde_json::Value;

const ARTIFACT_BYTES: &[u8] = b"one-publish processed artifact\n";

/// 可配置行为的 fixture processor：派生声明角色的产物，或按剧本产出违规输出。
struct ScriptedProcessor {
    descriptor: AdapterDescriptor,
    derived_role: String,
    behavior: ProcessorBehavior,
}

#[derive(Clone, Copy)]
enum ProcessorBehavior {
    DeriveDeclaredRole,
    Fail,
    EmitUndeclaredRole,
    SealManifest,
    EmitEnvelope,
    EmitReceipt,
}

impl ScriptedProcessor {
    fn new(id: &str, derived_role: &str, behavior: ProcessorBehavior) -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ArtifactProcessor,
                id,
                1,
                AdapterSchema::new(1),
                PublishingCapability {
                    provides: vec![Capability::new(ARTIFACT_VERIFIED_CAPABILITY, 1)],
                    requires: vec![CapabilityRequirement::exact(
                        ARTIFACT_CANDIDATE_CAPABILITY,
                        1,
                    )],
                },
            ),
            derived_role: derived_role.to_string(),
            behavior,
        }
    }

    fn with_capability_requirement(mut self, requirement: CapabilityRequirement) -> Self {
        self.descriptor.capabilities.requires = vec![requirement];
        self
    }
}

impl AdapterContract for ScriptedProcessor {
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
    ) -> Result<Vec<PlanNodeTemplate>, PublishError> {
        Ok(vec![PlanNodeTemplate::adapter_action(
            "process",
            PlanStage::ProcessArtifacts,
            "process_artifacts",
            BTreeMap::new(),
        )
        .with_artifact_io(
            vec!["artifact:*".to_string()],
            vec![self.derived_role.clone()],
        )])
    }

    fn execute_node(
        &self,
        node: &PlanNode,
        context: &AdapterExecutionContext<'_>,
    ) -> Result<AdapterExecutionOutput, PublishError> {
        let derive = |role: &str| {
            ArtifactCandidate::new(
                role,
                format!("{}.txt", self.descriptor.id),
                "text/plain",
                "any",
                "any",
                format!("{} report\n", self.descriptor.id).into_bytes(),
            )
        };
        match self.behavior {
            ProcessorBehavior::DeriveDeclaredRole => Ok(AdapterExecutionOutput {
                artifacts: vec![derive(&self.derived_role)],
                ..AdapterExecutionOutput::default()
            }),
            ProcessorBehavior::Fail => Err(PublishError::Execution(format!(
                "processor {} rejected the artifact set",
                self.descriptor.id
            ))),
            ProcessorBehavior::EmitUndeclaredRole => Ok(AdapterExecutionOutput {
                artifacts: vec![derive("undeclared-role")],
                ..AdapterExecutionOutput::default()
            }),
            ProcessorBehavior::SealManifest => Ok(AdapterExecutionOutput {
                manifest: Some(premature_manifest(context.snapshot_digest)?),
                ..AdapterExecutionOutput::default()
            }),
            ProcessorBehavior::EmitEnvelope => Ok(AdapterExecutionOutput {
                envelopes: vec![DeliveryEnvelope::new(
                    node.binding_id.clone(),
                    "0".repeat(64),
                )],
                ..AdapterExecutionOutput::default()
            }),
            ProcessorBehavior::EmitReceipt => Ok(AdapterExecutionOutput {
                receipts: vec![publish_domain::DeliveryReceipt::published(
                    "processor-receipt",
                    node.binding_id.clone(),
                    "0".repeat(64),
                    "local://processor",
                )],
                ..AdapterExecutionOutput::default()
            }),
        }
    }
}

impl ArtifactProcessor for ScriptedProcessor {}

fn premature_manifest(snapshot_digest: &str) -> Result<ArtifactManifest, PublishError> {
    ArtifactManifest::seal(
        snapshot_digest,
        vec![ArtifactManifestEntry {
            role: "desktop-installer".to_string(),
            file_name: "app.bin".to_string(),
            media_type: "application/octet-stream".to_string(),
            platform: "test-os".to_string(),
            architecture: "test-arch".to_string(),
            size: ARTIFACT_BYTES.len() as u64,
            digest: sha256_hex(ARTIFACT_BYTES),
            locator: "/tmp/premature/app.bin".to_string(),
            retention: "temporary".to_string(),
        }],
    )
}

struct FixtureProvider {
    descriptor: AdapterDescriptor,
}

impl FixtureProvider {
    fn new() -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ProjectProvider,
                "fixture-project",
                1,
                AdapterSchema::new(1),
                PublishingCapability {
                    provides: vec![Capability::new(ARTIFACT_CANDIDATE_CAPABILITY, 1)],
                    requires: vec![CapabilityRequirement::exact(
                        STRUCTURED_PLAN_EXECUTION_CAPABILITY,
                        1,
                    )],
                },
            ),
        }
    }
}

impl AdapterContract for FixtureProvider {
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
    ) -> Result<Vec<PlanNodeTemplate>, PublishError> {
        Ok(vec![PlanNodeTemplate::adapter_action(
            "collect",
            PlanStage::CollectArtifacts,
            "collect_artifacts",
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
    ) -> Result<AdapterExecutionOutput, PublishError> {
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

impl ProjectProvider for FixtureProvider {}

/// 在 StageRoutes 阶段试图回写共享产物或 Manifest 的交付目标。
struct ManifestRewritingDestination {
    delegate: LocalDirectoryDestination,
    emit: StagedOutput,
}

#[derive(Clone, Copy)]
enum StagedOutput {
    ReplacementManifest,
    SharedArtifact,
    ForeignRouteEnvelope,
}

impl ManifestRewritingDestination {
    fn new(directory: &std::path::Path, emit: StagedOutput) -> Self {
        Self {
            delegate: LocalDirectoryDestination::new(directory),
            emit,
        }
    }
}

impl AdapterContract for ManifestRewritingDestination {
    fn descriptor(&self) -> &AdapterDescriptor {
        self.delegate.descriptor()
    }

    fn default_settings(&self) -> AdapterSettings {
        self.delegate.default_settings()
    }

    fn plan_fragment(
        &self,
        snapshot: &PlanningInputSnapshot,
        settings: &AdapterSettings,
    ) -> Result<Vec<PlanNodeTemplate>, PublishError> {
        self.delegate.plan_fragment(snapshot, settings)
    }

    fn execute_node(
        &self,
        node: &PlanNode,
        context: &AdapterExecutionContext<'_>,
    ) -> Result<AdapterExecutionOutput, PublishError> {
        if node.stage != PlanStage::StageRoutes {
            return self.delegate.execute_node(node, context);
        }
        match self.emit {
            StagedOutput::ReplacementManifest => Ok(AdapterExecutionOutput {
                manifest: Some(premature_manifest(context.snapshot_digest)?),
                ..AdapterExecutionOutput::default()
            }),
            StagedOutput::SharedArtifact => Ok(AdapterExecutionOutput {
                artifacts: vec![ArtifactCandidate::new(
                    "desktop-installer",
                    "late.bin",
                    "application/octet-stream",
                    "test-os",
                    "test-arch",
                    b"late mutation".to_vec(),
                )],
                ..AdapterExecutionOutput::default()
            }),
            StagedOutput::ForeignRouteEnvelope => Ok(AdapterExecutionOutput {
                envelopes: vec![DeliveryEnvelope::new(
                    "another-route",
                    context
                        .manifest
                        .map(|manifest| manifest.digest.clone())
                        .unwrap_or_default(),
                )],
                ..AdapterExecutionOutput::default()
            }),
        }
    }
}

impl DeliveryDestination for ManifestRewritingDestination {}

#[test]
fn processors_run_in_configured_order_and_seal_derived_roles_into_one_manifest() {
    let store_dir = tempfile::tempdir().expect("create store");
    let delivery_dir = tempfile::tempdir().expect("create delivery");
    let processors = vec![
        ("alpha-processor", ProcessorBehavior::DeriveDeclaredRole),
        ("beta-processor", ProcessorBehavior::DeriveDeclaredRole),
    ];
    let (runtime, snapshot) = fixture_runtime(store_dir.path(), delivery_dir.path(), &processors);

    let prepared = runtime.prepare_attempt(&snapshot).expect("prepare attempt");
    let processor_nodes = prepared
        .plan
        .nodes
        .iter()
        .filter(|node| node.stage == PlanStage::ProcessArtifacts)
        .map(|node| node.binding_id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        processor_nodes,
        vec!["processor-alpha-processor", "processor-beta-processor"],
        "processors must be planned in their configured order"
    );

    let attempt = runtime
        .start_attempt(
            &prepared,
            StartPublishAttempt::new("attempt-order", "run-order", release_identity(&snapshot)),
        )
        .expect("run ordered processors");

    assert_eq!(attempt.status, PublishAttemptStatus::Published);
    let manifest = attempt.manifest.as_ref().expect("sealed manifest");
    let roles = manifest
        .artifacts
        .iter()
        .map(|artifact| artifact.role.as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        roles,
        vec!["desktop-installer", "alpha-report", "beta-report"],
        "derived artifacts enter the manifest in processor execution order"
    );

    let ordered_events = attempt
        .events
        .iter()
        .filter(|event| event.kind == "plan_node_completed")
        .map(|event| event.plan_node_id.as_str())
        .collect::<Vec<_>>();
    let alpha_position = ordered_events
        .iter()
        .position(|id| id.contains("alpha-processor"))
        .expect("alpha processor event");
    let beta_position = ordered_events
        .iter()
        .position(|id| id.contains("beta-processor"))
        .expect("beta processor event");
    assert!(alpha_position < beta_position);
}

#[test]
fn processor_failure_blocks_every_route_and_leaves_no_sealed_manifest() {
    let store_dir = tempfile::tempdir().expect("create store");
    let delivery_dir = tempfile::tempdir().expect("create delivery");
    let processors = vec![
        ("alpha-processor", ProcessorBehavior::DeriveDeclaredRole),
        ("failing-processor", ProcessorBehavior::Fail),
    ];
    let (runtime, snapshot) = fixture_runtime(store_dir.path(), delivery_dir.path(), &processors);
    let prepared = runtime.prepare_attempt(&snapshot).expect("prepare attempt");

    let attempt = runtime
        .start_attempt(
            &prepared,
            StartPublishAttempt::new(
                "attempt-processor-failure",
                "run-processor-failure",
                release_identity(&snapshot),
            ),
        )
        .expect("processor failures stay inspectable attempts");

    assert_eq!(attempt.status, PublishAttemptStatus::Failed);
    assert!(
        attempt.manifest.is_none(),
        "a failed processing pipeline must not leave a sealed manifest"
    );
    assert!(attempt.attempt.manifest_digest.is_none());
    assert!(attempt.receipts.is_empty());
    assert!(attempt
        .error
        .as_deref()
        .is_some_and(|error| error.contains("failing-processor")));
    assert!(
        store_dir
            .path()
            .read_dir()
            .expect("read store")
            .next()
            .is_none(),
        "processing failures must not persist artifacts"
    );
    assert!(
        delivery_dir
            .path()
            .read_dir()
            .expect("read delivery")
            .next()
            .is_none(),
        "processing failures must block every delivery route"
    );
}

#[test]
fn undeclared_processor_outputs_never_reach_the_manifest() {
    let store_dir = tempfile::tempdir().expect("create store");
    let delivery_dir = tempfile::tempdir().expect("create delivery");
    let processors = vec![("sneaky-processor", ProcessorBehavior::EmitUndeclaredRole)];
    let (runtime, snapshot) = fixture_runtime(store_dir.path(), delivery_dir.path(), &processors);
    let prepared = runtime.prepare_attempt(&snapshot).expect("prepare attempt");

    let attempt = runtime
        .start_attempt(
            &prepared,
            StartPublishAttempt::new(
                "attempt-undeclared-output",
                "run-undeclared-output",
                release_identity(&snapshot),
            ),
        )
        .expect("undeclared outputs stay inspectable attempts");

    assert_eq!(attempt.status, PublishAttemptStatus::Failed);
    assert!(attempt.manifest.is_none());
    assert!(attempt
        .error
        .as_deref()
        .is_some_and(|error| error.contains("undeclared-role")));
    assert!(store_dir
        .path()
        .read_dir()
        .expect("read store")
        .next()
        .is_none());
}

#[test]
fn only_the_artifact_store_seals_the_manifest_after_processing() {
    let store_dir = tempfile::tempdir().expect("create store");
    let delivery_dir = tempfile::tempdir().expect("create delivery");
    let processors = vec![("sealing-processor", ProcessorBehavior::SealManifest)];
    let (runtime, snapshot) = fixture_runtime(store_dir.path(), delivery_dir.path(), &processors);
    let prepared = runtime.prepare_attempt(&snapshot).expect("prepare attempt");

    let attempt = runtime
        .start_attempt(
            &prepared,
            StartPublishAttempt::new(
                "attempt-processor-seal",
                "run-processor-seal",
                release_identity(&snapshot),
            ),
        )
        .expect("premature seals stay inspectable attempts");

    assert_eq!(attempt.status, PublishAttemptStatus::Failed);
    assert!(attempt.manifest.is_none());
    assert!(attempt
        .error
        .as_deref()
        .is_some_and(|error| error.contains("persist_manifest")));
}

#[test]
fn processors_cannot_emit_delivery_envelopes_or_receipts() {
    for (behavior, attempt_id) in [
        (
            ProcessorBehavior::EmitEnvelope,
            "attempt-processor-envelope",
        ),
        (ProcessorBehavior::EmitReceipt, "attempt-processor-receipt"),
    ] {
        let store_dir = tempfile::tempdir().expect("create store");
        let delivery_dir = tempfile::tempdir().expect("create delivery");
        let processors = vec![("delivering-processor", behavior)];
        let (runtime, snapshot) =
            fixture_runtime(store_dir.path(), delivery_dir.path(), &processors);
        let prepared = runtime.prepare_attempt(&snapshot).expect("prepare attempt");

        let attempt = runtime
            .start_attempt(
                &prepared,
                StartPublishAttempt::new(attempt_id, attempt_id, release_identity(&snapshot)),
            )
            .expect("delivering processors stay inspectable attempts");

        assert_eq!(attempt.status, PublishAttemptStatus::Failed);
        assert!(attempt.receipts.is_empty());
        assert!(
            delivery_dir
                .path()
                .read_dir()
                .expect("read delivery")
                .next()
                .is_none(),
            "processors must never reach a delivery destination"
        );
    }
}

#[test]
fn incompatible_processor_capabilities_block_planning_without_fallback() {
    let store_dir = tempfile::tempdir().expect("create store");
    let delivery_dir = tempfile::tempdir().expect("create delivery");
    let incompatible = ScriptedProcessor::new(
        "alpha-processor",
        "alpha-report",
        ProcessorBehavior::DeriveDeclaredRole,
    )
    .with_capability_requirement(CapabilityRequirement::exact(
        ARTIFACT_CANDIDATE_CAPABILITY,
        2,
    ));
    let (runtime, snapshot) = build_runtime(
        store_dir.path(),
        delivery_dir.path(),
        vec![Arc::new(incompatible)],
        vec!["alpha-processor".to_string()],
        Arc::new(LocalDirectoryDestination::new(delivery_dir.path())),
    );

    assert!(matches!(
        runtime.prepare(&snapshot),
        Err(PublishError::IncompatibleCapability {
            capability,
            minimum: 2,
            maximum: 2,
            provided,
            ..
        }) if capability == ARTIFACT_CANDIDATE_CAPABILITY && provided == vec![1]
    ));

    let missing = ScriptedProcessor::new(
        "alpha-processor",
        "alpha-report",
        ProcessorBehavior::DeriveDeclaredRole,
    )
    .with_capability_requirement(CapabilityRequirement::exact("notarization-service", 1));
    let (runtime, snapshot) = build_runtime(
        store_dir.path(),
        delivery_dir.path(),
        vec![Arc::new(missing)],
        vec!["alpha-processor".to_string()],
        Arc::new(LocalDirectoryDestination::new(delivery_dir.path())),
    );

    assert!(matches!(
        runtime.prepare(&snapshot),
        Err(PublishError::MissingCapability { capability, .. })
            if capability == "notarization-service"
    ));
    assert!(store_dir
        .path()
        .read_dir()
        .expect("read store")
        .next()
        .is_none());
}

#[test]
fn staged_routes_cannot_rewrite_the_sealed_manifest_or_shared_artifacts() {
    for (emit, attempt_id, expected_error) in [
        (
            StagedOutput::ReplacementManifest,
            "attempt-envelope-manifest",
            "persist_manifest",
        ),
        (
            StagedOutput::SharedArtifact,
            "attempt-envelope-artifact",
            "sealed",
        ),
        (
            StagedOutput::ForeignRouteEnvelope,
            "attempt-envelope-foreign",
            "another-route",
        ),
    ] {
        let store_dir = tempfile::tempdir().expect("create store");
        let delivery_dir = tempfile::tempdir().expect("create delivery");
        let (runtime, snapshot) = fixture_runtime_with_destination(
            store_dir.path(),
            delivery_dir.path(),
            Arc::new(ManifestRewritingDestination::new(delivery_dir.path(), emit)),
        );
        let prepared = runtime.prepare_attempt(&snapshot).expect("prepare attempt");

        let attempt = runtime
            .start_attempt(
                &prepared,
                StartPublishAttempt::new(attempt_id, attempt_id, release_identity(&snapshot)),
            )
            .expect("rewriting destinations stay inspectable attempts");

        assert_eq!(attempt.status, PublishAttemptStatus::Failed, "{attempt_id}");
        assert!(
            attempt
                .error
                .as_deref()
                .is_some_and(|error| error.contains(expected_error)),
            "{attempt_id}: unexpected error {:?}",
            attempt.error
        );
        assert!(
            attempt
                .manifest
                .as_ref()
                .map_or(true, |manifest| manifest.validate().is_ok()),
            "{attempt_id}: the sealed manifest must stay intact"
        );
        assert!(attempt.receipts.is_empty());
    }
}

#[test]
fn checksum_processor_derives_a_sealed_checksum_manifest_end_to_end() {
    let store_dir = tempfile::tempdir().expect("create store");
    let delivery_dir = tempfile::tempdir().expect("create delivery");
    let (runtime, snapshot) = fixture_runtime_with_checksum(store_dir.path(), delivery_dir.path());
    let prepared = runtime.prepare_attempt(&snapshot).expect("prepare attempt");

    let attempt = runtime
        .start_attempt(
            &prepared,
            StartPublishAttempt::new(
                "attempt-checksum",
                "run-checksum",
                release_identity(&snapshot),
            ),
        )
        .expect("run checksum pipeline");

    assert_eq!(attempt.status, PublishAttemptStatus::Published);
    let manifest = attempt.manifest.as_ref().expect("sealed manifest");
    let checksum_entry = manifest
        .artifacts
        .iter()
        .find(|artifact| artifact.role == CHECKSUM_MANIFEST_ROLE)
        .expect("checksum manifest artifact is sealed alongside build outputs");
    assert_eq!(checksum_entry.file_name, "SHA256SUMS");

    let delivered_checksums = delivery_dir
        .path()
        .join(format!(
            "attempt-{}",
            &sha256_hex(b"attempt-checksum")[..24]
        ))
        .join("SHA256SUMS");
    let content = fs::read_to_string(delivered_checksums).expect("delivered checksum manifest");
    assert_eq!(
        content,
        format!("{}  app.bin\n", sha256_hex(ARTIFACT_BYTES))
    );
}

fn release_identity(snapshot: &PlanningInputSnapshot) -> ReleaseIdentity {
    ReleaseIdentity::new(
        "fixture-project:app",
        snapshot.source.clone(),
        "1.0.0",
        "stable",
        None,
    )
}

fn fixture_runtime(
    store_directory: &std::path::Path,
    delivery_directory: &std::path::Path,
    processors: &[(&str, ProcessorBehavior)],
) -> (PublishRuntime, PlanningInputSnapshot) {
    let processor_adapters = processors
        .iter()
        .map(|(id, behavior)| {
            let role = id.split('-').next().unwrap_or(id);
            Arc::new(ScriptedProcessor::new(
                id,
                &format!("{role}-report"),
                *behavior,
            )) as Arc<dyn ArtifactProcessor>
        })
        .collect::<Vec<_>>();
    build_runtime(
        store_directory,
        delivery_directory,
        processor_adapters,
        processors.iter().map(|(id, _)| (*id).to_string()).collect(),
        Arc::new(LocalDirectoryDestination::new(delivery_directory)),
    )
}

fn fixture_runtime_with_destination(
    store_directory: &std::path::Path,
    delivery_directory: &std::path::Path,
    destination: Arc<dyn DeliveryDestination>,
) -> (PublishRuntime, PlanningInputSnapshot) {
    build_runtime(
        store_directory,
        delivery_directory,
        vec![Arc::new(ScriptedProcessor::new(
            "alpha-processor",
            "alpha-report",
            ProcessorBehavior::DeriveDeclaredRole,
        ))],
        vec!["alpha-processor".to_string()],
        destination,
    )
}

fn fixture_runtime_with_checksum(
    store_directory: &std::path::Path,
    delivery_directory: &std::path::Path,
) -> (PublishRuntime, PlanningInputSnapshot) {
    build_runtime(
        store_directory,
        delivery_directory,
        vec![Arc::new(ChecksumProcessor::new())],
        vec![CHECKSUM_PROCESSOR_ID.to_string()],
        Arc::new(LocalDirectoryDestination::new(delivery_directory)),
    )
}

fn build_runtime(
    store_directory: &std::path::Path,
    delivery_directory: &std::path::Path,
    processor_adapters: Vec<Arc<dyn ArtifactProcessor>>,
    processor_ids: Vec<String>,
    destination: Arc<dyn DeliveryDestination>,
) -> (PublishRuntime, PlanningInputSnapshot) {
    let snapshot = fixture_snapshot(
        store_directory.to_string_lossy().as_ref(),
        delivery_directory.to_string_lossy().as_ref(),
        &processor_ids,
    );
    let fixture = AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(Arc::new(FixtureProvider::new()), &fixture)
        .expect("register fixture provider");
    for adapter in processor_adapters {
        registry
            .register_artifact_processor(adapter, &fixture)
            .expect("register fixture processor");
    }
    registry
        .register_execution_backend(Arc::new(LocalExecutionBackend::new()), &fixture)
        .expect("register local backend");
    registry
        .register_artifact_store(
            Arc::new(TemporaryArtifactStore::new(store_directory)),
            &fixture,
        )
        .expect("register temporary store");
    registry
        .register_delivery_destination(destination, &fixture)
        .expect("register destination");
    (PublishRuntime::new(registry), snapshot)
}

fn fixture_snapshot(
    store_directory: &str,
    delivery_directory: &str,
    processor_ids: &[String],
) -> PlanningInputSnapshot {
    let empty = AdapterSettings::new(1);
    PlanningInputSnapshot {
        version: PLANNING_INPUT_SNAPSHOT_VERSION,
        configuration_revision: "config-revision-1".to_string(),
        runtime_revision: "runner-1".to_string(),
        release_input: BTreeMap::from([(
            "version".to_string(),
            Value::String("1.0.0".to_string()),
        )]),
        source: SourceSnapshot {
            revision: "0123456789abcdef".to_string(),
            workspace_digest: None,
            dirty: false,
            captured_at: "2026-07-21T10:00:00Z".to_string(),
            reproducible: true,
        },
        external_preconditions: BTreeMap::new(),
        adapters: AdapterSelection {
            project_provider: AdapterBinding::new(
                "project",
                AdapterIdentity::new(AdapterKind::ProjectProvider, "fixture-project", 1),
                empty.clone(),
            ),
            artifact_processors: processor_ids
                .iter()
                .map(|id| {
                    AdapterBinding::new(
                        format!("processor-{id}"),
                        AdapterIdentity::new(AdapterKind::ArtifactProcessor, id.clone(), 1),
                        empty.clone(),
                    )
                })
                .collect(),
            execution_backend: AdapterBinding::new(
                "backend",
                AdapterIdentity::new(AdapterKind::ExecutionBackend, "local-execution", 1),
                empty.clone(),
            ),
            artifact_store: AdapterBinding::new(
                "store",
                AdapterIdentity::new(AdapterKind::ArtifactStore, "temporary-artifact-store", 1),
                AdapterSettings::new(1)
                    .with_value("root_directory", Value::String(store_directory.to_string())),
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
