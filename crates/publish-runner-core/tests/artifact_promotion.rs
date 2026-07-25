use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use publish_adapters::{
    AdapterConformanceFixture, AdapterContract, AdapterExecutionContext, AdapterExecutionOutput,
    AdapterRegistry, ArtifactProcessor, DeliveryDestination, LocalDirectoryDestination,
    LocalExecutionBackend, ProjectProvider, TemporaryArtifactStore,
};
use publish_domain::{
    AdapterBinding, AdapterDescriptor, AdapterIdentity, AdapterKind, AdapterSchema,
    AdapterSelection, AdapterSettings, ArtifactCandidate, Capability, CapabilityRequirement,
    DeliveryRoute, DeliveryStatus, PlanNodeTemplate, PlanStage, PlanningInputSnapshot,
    PublishAttemptStatus, PublishError, PublishingCapability, ReleaseIdentity, SourceSnapshot,
    PLANNING_INPUT_SNAPSHOT_VERSION,
};
use publish_runner_core::{PublishRuntime, StartPublishAttempt};
use serde_json::Value;

const ARTIFACT_BYTES: &[u8] = b"one-publish promoted artifact\n";
const UNSATISFIABLE_DESTINATION_ID: &str = "unsatisfiable-destination";

/// 统计构建执行次数的 Provider：Promotion 期间构建调用必须为零（ADR-0040）。
struct CountingProjectProvider {
    descriptor: AdapterDescriptor,
    executions: Arc<AtomicUsize>,
}

impl CountingProjectProvider {
    fn new(executions: Arc<AtomicUsize>) -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ProjectProvider,
                "counting-project",
                1,
                AdapterSchema::new(1),
                PublishingCapability {
                    provides: vec![Capability::new("artifact-candidate", 1)],
                    requires: vec![CapabilityRequirement::exact("structured-plan-execution", 1)],
                },
            ),
            executions,
        }
    }
}

impl AdapterContract for CountingProjectProvider {
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
            "build",
            PlanStage::Build,
            "build_project",
            BTreeMap::new(),
        )
        .with_artifact_io(
            vec![],
            vec!["desktop-installer".to_string()],
        )])
    }

    fn execute_node(
        &self,
        _node: &publish_domain::PlanNode,
        _context: &AdapterExecutionContext<'_>,
    ) -> Result<AdapterExecutionOutput, PublishError> {
        self.executions.fetch_add(1, Ordering::SeqCst);
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

impl ProjectProvider for CountingProjectProvider {}

/// 统计执行次数的处理器：Promotion 必须跳过一切会改变产物的处理。
struct CountingArtifactProcessor {
    descriptor: AdapterDescriptor,
    executions: Arc<AtomicUsize>,
}

impl CountingArtifactProcessor {
    fn new(executions: Arc<AtomicUsize>) -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ArtifactProcessor,
                "counting-verifier",
                1,
                AdapterSchema::new(1),
                PublishingCapability {
                    provides: vec![Capability::new("artifact-verified", 1)],
                    requires: vec![CapabilityRequirement::exact("artifact-candidate", 1)],
                },
            ),
            executions,
        }
    }
}

impl AdapterContract for CountingArtifactProcessor {
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
            "verify",
            PlanStage::ProcessArtifacts,
            "verify_artifacts",
            BTreeMap::new(),
        )
        .with_artifact_io(
            vec!["desktop-installer".to_string()],
            vec!["desktop-installer".to_string()],
        )])
    }

    fn execute_node(
        &self,
        _node: &publish_domain::PlanNode,
        _context: &AdapterExecutionContext<'_>,
    ) -> Result<AdapterExecutionOutput, PublishError> {
        self.executions.fetch_add(1, Ordering::SeqCst);
        Ok(AdapterExecutionOutput::default())
    }
}

impl ArtifactProcessor for CountingArtifactProcessor {}

/// 要求一个从未被提供的能力：验证 Promotion 仍然执行路线能力协商。
struct UnsatisfiableDestination {
    descriptor: AdapterDescriptor,
}

impl UnsatisfiableDestination {
    fn new() -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::DeliveryDestination,
                UNSATISFIABLE_DESTINATION_ID,
                1,
                AdapterSchema::new(1),
                PublishingCapability {
                    provides: vec![],
                    requires: vec![CapabilityRequirement::exact("never-provided-capability", 1)],
                },
            ),
        }
    }
}

impl AdapterContract for UnsatisfiableDestination {
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
        Ok(vec![])
    }
}

impl DeliveryDestination for UnsatisfiableDestination {}

struct PromotionFixture {
    runtime: PublishRuntime,
    build_snapshot: PlanningInputSnapshot,
    build_executions: Arc<AtomicUsize>,
    processor_executions: Arc<AtomicUsize>,
    _store_dir: tempfile::TempDir,
    delivery_dir: tempfile::TempDir,
}

fn local_route(route_id: &str, directory: &Path) -> DeliveryRoute {
    DeliveryRoute::required(AdapterBinding::new(
        route_id.to_string(),
        AdapterIdentity::new(AdapterKind::DeliveryDestination, "local-directory", 1),
        AdapterSettings::new(1).with_value(
            "directory",
            Value::String(directory.to_string_lossy().to_string()),
        ),
    ))
}

fn promotion_fixture() -> PromotionFixture {
    let store_dir = tempfile::tempdir().expect("create temporary store");
    let delivery_dir = tempfile::tempdir().expect("create delivery parent");
    let build_executions = Arc::new(AtomicUsize::new(0));
    let processor_executions = Arc::new(AtomicUsize::new(0));

    let empty = AdapterSettings::new(1);
    let build_snapshot = PlanningInputSnapshot {
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
        promoted_manifest_digest: None,
        adapters: AdapterSelection {
            project_provider: AdapterBinding::new(
                "project",
                AdapterIdentity::new(AdapterKind::ProjectProvider, "counting-project", 1),
                empty.clone(),
            ),
            artifact_processors: vec![AdapterBinding::new(
                "processor",
                AdapterIdentity::new(AdapterKind::ArtifactProcessor, "counting-verifier", 1),
                empty.clone(),
            )],
            execution_backend: AdapterBinding::new(
                "backend",
                AdapterIdentity::new(AdapterKind::ExecutionBackend, "local-execution", 1),
                empty,
            ),
            artifact_store: AdapterBinding::new(
                "store",
                AdapterIdentity::new(AdapterKind::ArtifactStore, "temporary-artifact-store", 1),
                AdapterSettings::new(1)
                    .with_value(
                        "root_directory",
                        Value::String(store_dir.path().to_string_lossy().to_string()),
                    )
                    .with_value("retention_seconds", Value::from(604_800u64)),
            ),
            delivery_routes: vec![local_route(
                "build-route",
                &delivery_dir.path().join("build"),
            )],
        },
    };

    let fixture = AdapterConformanceFixture::new(build_snapshot.clone());
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(
            Arc::new(CountingProjectProvider::new(Arc::clone(&build_executions))),
            &fixture,
        )
        .expect("register counting provider");
    registry
        .register_artifact_processor(
            Arc::new(CountingArtifactProcessor::new(Arc::clone(
                &processor_executions,
            ))),
            &fixture,
        )
        .expect("register counting processor");
    registry
        .register_execution_backend(Arc::new(LocalExecutionBackend::new()), &fixture)
        .expect("register local backend");
    registry
        .register_artifact_store(
            Arc::new(TemporaryArtifactStore::new(store_dir.path())),
            &fixture,
        )
        .expect("register temporary store");
    registry
        .register_delivery_destination(
            Arc::new(LocalDirectoryDestination::new(delivery_dir.path())),
            &fixture,
        )
        .expect("register local directory destination");
    registry
        .register_delivery_destination(Arc::new(UnsatisfiableDestination::new()), &fixture)
        .expect("register unsatisfiable destination");

    PromotionFixture {
        runtime: PublishRuntime::new(registry),
        build_snapshot,
        build_executions,
        processor_executions,
        _store_dir: store_dir,
        delivery_dir,
    }
}

impl PromotionFixture {
    /// 以既有 Manifest digest 构造 Promotion 快照：同一 Artifact Store，新交付路线。
    fn promotion_snapshot(&self, manifest_digest: &str) -> PlanningInputSnapshot {
        let mut snapshot = self.build_snapshot.clone();
        snapshot.promoted_manifest_digest = Some(manifest_digest.to_string());
        snapshot.adapters.delivery_routes = vec![local_route(
            "promo-route",
            &self.delivery_dir.path().join("promo"),
        )];
        snapshot
    }

    fn run_build_attempt(&self) -> publish_domain::PublishAttemptView {
        let prepared = self
            .runtime
            .prepare_attempt(&self.build_snapshot)
            .expect("prepare build attempt");
        self.runtime
            .start_attempt(
                &prepared,
                StartPublishAttempt::new(
                    "attempt-build",
                    "run-build",
                    self.release_identity("stable"),
                ),
            )
            .expect("start build attempt")
    }

    fn release_identity(&self, channel: &str) -> ReleaseIdentity {
        ReleaseIdentity::new(
            "counting-project:app",
            self.build_snapshot.source.clone(),
            "1.0.0",
            channel,
            None,
        )
    }
}

#[test]
fn promotion_reuses_the_stored_manifest_without_rebuilding() {
    let fixture = promotion_fixture();
    let build = fixture.run_build_attempt();
    assert_eq!(build.status, PublishAttemptStatus::Published);
    let manifest_digest = build
        .manifest
        .as_ref()
        .expect("sealed manifest")
        .digest
        .clone();
    assert_eq!(fixture.build_executions.load(Ordering::SeqCst), 1);
    assert_eq!(fixture.processor_executions.load(Ordering::SeqCst), 1);

    let snapshot = fixture.promotion_snapshot(&manifest_digest);
    let prepared = fixture
        .runtime
        .prepare_attempt(&snapshot)
        .expect("prepare promotion attempt");

    // Promotion 计划跳过构建与全部会改变产物的处理阶段，但保留封存绑定与路线阶段。
    assert!(prepared.plan.nodes.iter().all(|node| !matches!(
        node.stage,
        PlanStage::Build | PlanStage::CollectArtifacts | PlanStage::ProcessArtifacts
    )));
    assert!(prepared
        .plan
        .nodes
        .iter()
        .any(|node| node.stage == PlanStage::PersistManifest));
    assert!(prepared
        .plan
        .nodes
        .iter()
        .any(|node| node.stage == PlanStage::StageRoutes));
    assert!(prepared
        .plan
        .nodes
        .iter()
        .any(|node| node.stage == PlanStage::PublishRoutes));

    let attempt = fixture
        .runtime
        .start_attempt(
            &prepared,
            StartPublishAttempt::new(
                "attempt-promo",
                "run-promo",
                fixture.release_identity("promo"),
            ),
        )
        .expect("start promotion attempt");

    // 复用同一 Manifest digest，构建与处理调用次数为零。
    assert_eq!(attempt.status, PublishAttemptStatus::Published);
    assert_eq!(
        attempt.manifest.as_ref().expect("bound manifest").digest,
        manifest_digest
    );
    assert_eq!(
        attempt.attempt.manifest_digest.as_deref(),
        Some(manifest_digest.as_str())
    );
    assert_eq!(fixture.build_executions.load(Ordering::SeqCst), 1);
    assert_eq!(fixture.processor_executions.load(Ordering::SeqCst), 1);

    // 目标路线仍生成 Delivery Envelope 并真实交付到新位置。
    assert_eq!(attempt.receipts.len(), 1);
    let receipt = &attempt.receipts[0];
    assert_eq!(receipt.route_id, "promo-route");
    assert_eq!(receipt.status, DeliveryStatus::Published);
    assert_eq!(receipt.manifest_digest, manifest_digest);
    let delivered = Path::new(&receipt.external_reference).join("app.bin");
    assert_eq!(
        fs::read(&delivered).expect("promoted artifact delivered"),
        ARTIFACT_BYTES
    );
}

#[test]
fn promotion_still_negotiates_route_capabilities() {
    let fixture = promotion_fixture();
    let build = fixture.run_build_attempt();
    let manifest_digest = build
        .manifest
        .as_ref()
        .expect("sealed manifest")
        .digest
        .clone();

    let mut snapshot = fixture.promotion_snapshot(&manifest_digest);
    snapshot.adapters.delivery_routes = vec![DeliveryRoute::required(AdapterBinding::new(
        "unsatisfiable-route",
        AdapterIdentity::new(
            AdapterKind::DeliveryDestination,
            UNSATISFIABLE_DESTINATION_ID,
            1,
        ),
        AdapterSettings::new(1),
    ))];

    let error = fixture
        .runtime
        .prepare_attempt(&snapshot)
        .expect_err("promotion must still negotiate capabilities");
    assert!(matches!(
        error,
        PublishError::MissingCapability { capability, .. } if capability == "never-provided-capability"
    ));
}

#[test]
fn invalidated_artifacts_make_promotion_unresumable_without_rebuilding() {
    let fixture = promotion_fixture();
    let build = fixture.run_build_attempt();
    let manifest = build.manifest.as_ref().expect("sealed manifest");

    // 模拟保留清理或损坏：原产物字节从存储失效。
    fs::write(&manifest.artifacts[0].locator, b"corrupted bytes\n").expect("invalidate artifact");

    let snapshot = fixture.promotion_snapshot(&manifest.digest);
    let prepared = fixture
        .runtime
        .prepare_attempt(&snapshot)
        .expect("prepare promotion attempt");
    let attempt = fixture
        .runtime
        .start_attempt(
            &prepared,
            StartPublishAttempt::new(
                "attempt-promo-invalid",
                "run-promo-invalid",
                fixture.release_identity("promo"),
            ),
        )
        .expect("attempt view is returned even when binding fails");

    // 明确进入 Unresumable Delivery：要求新的构建尝试，而不是静默重建。
    assert_eq!(attempt.status, PublishAttemptStatus::Failed);
    let error = attempt.error.as_deref().expect("unresumable error");
    assert!(error.contains("unresumable"));
    assert!(error.contains("new build attempt"));
    assert!(error.contains(&manifest.digest));
    assert!(attempt.manifest.is_none());
    assert!(attempt.receipts.is_empty());
    assert_eq!(
        fixture.build_executions.load(Ordering::SeqCst),
        1,
        "invalidated promotions must never trigger an automatic rebuild"
    );
    assert_eq!(fixture.processor_executions.load(Ordering::SeqCst), 1);
}

#[test]
fn promoting_an_unknown_artifact_set_is_unresumable() {
    let fixture = promotion_fixture();
    fixture.run_build_attempt();

    let snapshot = fixture.promotion_snapshot(&"f".repeat(64));
    let prepared = fixture
        .runtime
        .prepare_attempt(&snapshot)
        .expect("prepare promotion attempt");
    let attempt = fixture
        .runtime
        .start_attempt(
            &prepared,
            StartPublishAttempt::new(
                "attempt-promo-unknown",
                "run-promo-unknown",
                fixture.release_identity("promo"),
            ),
        )
        .expect("attempt view is returned even when binding fails");

    assert_eq!(attempt.status, PublishAttemptStatus::Failed);
    let error = attempt.error.as_deref().expect("unresumable error");
    assert!(error.contains("unresumable"));
    assert_eq!(fixture.build_executions.load(Ordering::SeqCst), 1);
}

#[test]
fn malformed_promotion_digests_are_rejected_at_planning_time() {
    let fixture = promotion_fixture();
    fixture.run_build_attempt();

    let snapshot = fixture.promotion_snapshot("not-a-digest");
    let error = fixture
        .runtime
        .prepare_attempt(&snapshot)
        .expect_err("malformed digests must fail planning");
    assert!(matches!(error, PublishError::InvalidPlan(message) if message.contains("SHA-256")));
}
