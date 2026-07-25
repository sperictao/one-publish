use std::collections::{BTreeMap, VecDeque};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use publish_adapters::{
    AdapterConformanceFixture, AdapterContract, AdapterExecutionContext, AdapterExecutionOutput,
    AdapterRegistry, ArtifactProcessor, DeliveryDestination, DeliveryProbe, LocalExecutionBackend,
    ProjectProvider, TemporaryArtifactStore,
};
use publish_domain::{
    sha256_hex, AdapterBinding, AdapterDescriptor, AdapterIdentity, AdapterKind, AdapterSchema,
    AdapterSelection, AdapterSettings, ArtifactCandidate, Capability, CapabilityRequirement,
    DeliveryEnvelope, DeliveryIdempotencyIdentity, DeliveryReceipt, DeliveryRoute, DeliveryStatus,
    PlanNodeTemplate, PlanStage, PlanningInputSnapshot, PublishAttemptStatus, PublishError,
    PublishFailure, PublishFailureCategory, ReleaseIdentity, SourceSnapshot,
    PLANNING_INPUT_SNAPSHOT_VERSION, PUBLISH_FAILURE_VERSION,
};
use publish_runner_core::{AttemptExecutionContext, PublishRuntime, StartPublishAttempt};
use serde_json::Value;

const ARTIFACT_BYTES: &[u8] = b"one-publish classified retry artifact\n";
const DESTINATION_ID: &str = "classified-destination";

fn classified(
    category: PublishFailureCategory,
    native_code: &str,
    retry_safe: bool,
    retry_after_seconds: Option<u64>,
) -> PublishFailure {
    PublishFailure {
        version: PUBLISH_FAILURE_VERSION,
        category,
        native_code: native_code.to_string(),
        message: format!("simulated {native_code} delivery failure"),
        retry_safe,
        retry_after_seconds,
    }
}

/// 可控 Fake Destination 的共享状态：按路线键控失败注入、探测结果与调用计数。
#[derive(Default)]
struct DestinationState {
    publish_errors: Mutex<BTreeMap<String, VecDeque<PublishError>>>,
    probes: Mutex<BTreeMap<String, DeliveryProbe>>,
    probe_errors: Mutex<BTreeMap<String, PublishError>>,
    stage_calls: Mutex<BTreeMap<String, usize>>,
    publish_calls: Mutex<BTreeMap<String, usize>>,
    probe_calls: Mutex<BTreeMap<String, usize>>,
    observed_probe_identities: Mutex<Vec<DeliveryIdempotencyIdentity>>,
}

impl DestinationState {
    fn push_publish_error(&self, route_id: &str, error: PublishError) {
        self.publish_errors
            .lock()
            .expect("publish error queue")
            .entry(route_id.to_string())
            .or_default()
            .push_back(error);
    }

    fn set_probe(&self, route_id: &str, probe: DeliveryProbe) {
        self.probes
            .lock()
            .expect("probe map")
            .insert(route_id.to_string(), probe);
    }

    fn set_probe_error(&self, route_id: &str, error: PublishError) {
        self.probe_errors
            .lock()
            .expect("probe error map")
            .insert(route_id.to_string(), error);
    }

    fn count(map: &Mutex<BTreeMap<String, usize>>, route_id: &str) -> usize {
        map.lock()
            .expect("call counter")
            .get(route_id)
            .copied()
            .unwrap_or(0)
    }

    fn stage_calls(&self, route_id: &str) -> usize {
        Self::count(&self.stage_calls, route_id)
    }

    fn publish_calls(&self, route_id: &str) -> usize {
        Self::count(&self.publish_calls, route_id)
    }

    fn probe_calls(&self, route_id: &str) -> usize {
        Self::count(&self.probe_calls, route_id)
    }
}

fn record_call(map: &Mutex<BTreeMap<String, usize>>, route_id: &str) {
    *map.lock()
        .expect("call counter")
        .entry(route_id.to_string())
        .or_insert(0) += 1;
}

/// 可控 Fake Destination：publish 节点按注入队列失败，探测结果可编程（ADR-0051/0056）。
struct ClassifiedDestination {
    descriptor: AdapterDescriptor,
    state: Arc<DestinationState>,
}

impl ClassifiedDestination {
    fn new(state: Arc<DestinationState>) -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::DeliveryDestination,
                DESTINATION_ID,
                1,
                AdapterSchema::new(1),
                publish_domain::PublishingCapability {
                    provides: vec![],
                    requires: vec![CapabilityRequirement::exact("stored-artifact", 1)],
                },
            ),
            state,
        }
    }
}

impl AdapterContract for ClassifiedDestination {
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
        Ok(vec![
            PlanNodeTemplate::adapter_action(
                "stage",
                PlanStage::StageRoutes,
                "stage_classified",
                BTreeMap::new(),
            )
            .with_artifact_io(vec!["artifact-manifest".to_string()], vec![]),
            PlanNodeTemplate::adapter_action(
                "publish",
                PlanStage::PublishRoutes,
                "publish_classified",
                BTreeMap::new(),
            )
            .with_artifact_io(vec!["artifact-manifest".to_string()], vec![]),
        ])
    }

    fn execute_node(
        &self,
        node: &publish_domain::PlanNode,
        context: &AdapterExecutionContext<'_>,
    ) -> Result<AdapterExecutionOutput, PublishError> {
        let manifest = context
            .manifest
            .ok_or(PublishError::MissingArtifactManifest)?;
        let route_id = node.binding_id.as_str();
        if node.stage == PlanStage::StageRoutes {
            record_call(&self.state.stage_calls, route_id);
            return Ok(AdapterExecutionOutput {
                envelopes: vec![DeliveryEnvelope::new(
                    route_id.to_string(),
                    manifest.digest.clone(),
                )],
                ..AdapterExecutionOutput::default()
            });
        }

        record_call(&self.state.publish_calls, route_id);
        if let Some(error) = self
            .state
            .publish_errors
            .lock()
            .expect("publish error queue")
            .get_mut(route_id)
            .and_then(VecDeque::pop_front)
        {
            return Err(error);
        }

        let receipt_id = sha256_hex(
            format!(
                "{}:{}:{}:{}",
                context.attempt_id, node.id, route_id, manifest.digest
            )
            .as_bytes(),
        );
        Ok(AdapterExecutionOutput {
            receipts: vec![DeliveryReceipt::published(
                receipt_id,
                route_id.to_string(),
                manifest.digest.clone(),
                format!("fake://{route_id}/{}", context.attempt_id),
            )],
            ..AdapterExecutionOutput::default()
        })
    }
}

impl DeliveryDestination for ClassifiedDestination {
    fn probe_delivery(
        &self,
        _settings: &AdapterSettings,
        identity: &DeliveryIdempotencyIdentity,
    ) -> Result<DeliveryProbe, PublishError> {
        record_call(&self.state.probe_calls, &identity.route_id);
        self.state
            .observed_probe_identities
            .lock()
            .expect("probe identities")
            .push(identity.clone());
        if let Some(error) = self
            .state
            .probe_errors
            .lock()
            .expect("probe error map")
            .remove(&identity.route_id)
        {
            return Err(error);
        }
        Ok(self
            .state
            .probes
            .lock()
            .expect("probe map")
            .get(&identity.route_id)
            .cloned()
            .unwrap_or(DeliveryProbe::Unprobeable {
                reason: "no probe result configured".to_string(),
            }))
    }
}

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
                publish_domain::PublishingCapability {
                    provides: vec![Capability::new("artifact-candidate", 1)],
                    requires: vec![CapabilityRequirement::exact("structured-plan-execution", 1)],
                },
            )
            .with_allowed_program("counting-project:builder"),
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
        Ok(vec![PlanNodeTemplate::command(
            "build",
            PlanStage::Build,
            "counting-project:builder",
            vec!["--release".to_string()],
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
                publish_domain::PublishingCapability {
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

struct RetryFixture {
    runtime: PublishRuntime,
    snapshot: PlanningInputSnapshot,
    build_executions: Arc<AtomicUsize>,
    processor_executions: Arc<AtomicUsize>,
    destination: Arc<DestinationState>,
    _store_dir: tempfile::TempDir,
}

fn retry_fixture(routes: &[(&str, bool)]) -> RetryFixture {
    let store_dir = tempfile::tempdir().expect("create temporary store");
    let build_executions = Arc::new(AtomicUsize::new(0));
    let processor_executions = Arc::new(AtomicUsize::new(0));
    let destination = Arc::new(DestinationState::default());

    let delivery_routes = routes
        .iter()
        .map(|(route_id, required)| DeliveryRoute {
            binding: AdapterBinding::new(
                route_id.to_string(),
                AdapterIdentity::new(AdapterKind::DeliveryDestination, DESTINATION_ID, 1),
                AdapterSettings::new(1),
            ),
            required: *required,
        })
        .collect::<Vec<_>>();

    let empty = AdapterSettings::new(1);
    let snapshot = PlanningInputSnapshot {
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
            delivery_routes,
        },
    };

    let fixture = AdapterConformanceFixture::new(snapshot.clone());
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
            Arc::new(ClassifiedDestination::new(Arc::clone(&destination))),
            &fixture,
        )
        .expect("register classified destination");

    RetryFixture {
        runtime: PublishRuntime::new(registry),
        snapshot,
        build_executions,
        processor_executions,
        destination,
        _store_dir: store_dir,
    }
}

fn start_attempt(
    fixture: &RetryFixture,
    attempt_id: &str,
) -> (
    publish_runner_core::PreparedPublishPlan,
    publish_domain::PublishAttemptView,
) {
    let prepared = fixture
        .runtime
        .prepare_attempt(&fixture.snapshot)
        .expect("prepare attempt");
    let view = fixture
        .runtime
        .start_attempt(
            &prepared,
            StartPublishAttempt::new(
                attempt_id,
                format!("run-{attempt_id}"),
                ReleaseIdentity::new(
                    "counting-project:app",
                    fixture.snapshot.source.clone(),
                    "1.0.0",
                    "stable",
                    None,
                ),
            ),
            &AttemptExecutionContext::at(0),
        )
        .expect("start attempt");
    (prepared, view)
}

fn route_view<'a>(
    view: &'a publish_domain::PublishAttemptView,
    route_id: &str,
) -> &'a publish_domain::RouteDeliveryView {
    view.routes
        .iter()
        .find(|route| route.route_id == route_id)
        .unwrap_or_else(|| panic!("route view {route_id} missing"))
}

#[test]
fn classified_failures_surface_category_native_code_retry_safety_and_retry_after() {
    let categories = [
        (PublishFailureCategory::Transient, "ECONNRESET", true, None),
        (
            PublishFailureCategory::RateLimited,
            "HTTP-429",
            false,
            Some(30),
        ),
        (
            PublishFailureCategory::Authentication,
            "HTTP-401",
            true,
            None,
        ),
        (PublishFailureCategory::Conflict, "HTTP-409", true, None),
        (PublishFailureCategory::Unknown, "E-UNKNOWN", false, None),
    ];

    for (category, code, retry_safe, retry_after) in categories {
        let fixture = retry_fixture(&[("primary", true)]);
        let failure = classified(category, code, retry_safe, retry_after);
        fixture.destination.push_publish_error(
            "primary",
            PublishError::Classified {
                failure: failure.clone(),
            },
        );

        let (_, view) = start_attempt(&fixture, &format!("attempt-{code}"));

        assert_eq!(view.status, PublishAttemptStatus::Failed);
        let route = route_view(&view, "primary");
        assert_eq!(route.status, DeliveryStatus::Failed);
        assert_eq!(
            route.failure.as_ref(),
            Some(&failure),
            "route views must carry the structured classification for {code}"
        );
        // 分类作为结构化事件证据持久化，而不是靠错误字符串匹配（ADR-0056/0057）。
        let event_failure = view
            .events
            .iter()
            .find(|event| event.kind == "route_failed")
            .and_then(|event| event.payload.get("failure"))
            .cloned()
            .expect("route_failed event carries the structured failure");
        assert_eq!(
            serde_json::from_value::<PublishFailure>(event_failure).expect("valid failure"),
            failure
        );
    }
}

#[test]
fn transient_and_rate_limited_failures_retry_only_after_probe_confirms_absent_remote() {
    for (category, code, retry_after) in [
        (PublishFailureCategory::Transient, "ECONNRESET", None),
        (PublishFailureCategory::RateLimited, "HTTP-429", Some(30)),
    ] {
        let fixture = retry_fixture(&[("primary", true)]);
        fixture.destination.push_publish_error(
            "primary",
            PublishError::Classified {
                failure: classified(category, code, false, retry_after),
            },
        );
        let (prepared, view) = start_attempt(&fixture, &format!("attempt-retry-{code}"));
        assert_eq!(view.status, PublishAttemptStatus::Failed);
        assert_eq!(fixture.destination.publish_calls("primary"), 1);

        fixture
            .destination
            .set_probe("primary", DeliveryProbe::Absent);
        let resumed = fixture
            .runtime
            .resume_attempt(&prepared, &view, &AttemptExecutionContext::at(0))
            .expect("resume eligible failure");

        assert_eq!(resumed.status, PublishAttemptStatus::Published);
        assert!(resumed.error.is_none());
        assert_eq!(
            route_view(&resumed, "primary").status,
            DeliveryStatus::Published
        );
        assert_eq!(fixture.destination.probe_calls("primary"), 1);
        assert_eq!(fixture.destination.publish_calls("primary"), 2);

        // 探测身份绑定发布尝试、计划节点、发布身份、Manifest 摘要与路线（ADR-0051）。
        let identities = fixture
            .destination
            .observed_probe_identities
            .lock()
            .expect("probe identities");
        let identity = identities.last().expect("probe identity recorded");
        assert_eq!(identity.attempt_id, view.attempt.attempt_id);
        assert_eq!(identity.plan_node_id, "primary.publish");
        assert_eq!(identity.release_identity, view.attempt.release_identity);
        assert_eq!(
            Some(identity.manifest_digest.as_str()),
            view.attempt.manifest_digest.as_deref()
        );
        assert_eq!(identity.route_id, "primary");
    }
}

#[test]
fn blocking_categories_and_unclassified_failures_never_retry_automatically() {
    let blocking = [
        classified(PublishFailureCategory::Validation, "E-VALID", true, None),
        classified(
            PublishFailureCategory::Authentication,
            "HTTP-401",
            true,
            None,
        ),
        classified(
            PublishFailureCategory::Authorization,
            "HTTP-403",
            true,
            None,
        ),
        classified(PublishFailureCategory::Conflict, "HTTP-409", true, None),
        classified(PublishFailureCategory::Policy, "E-POLICY", true, None),
        classified(PublishFailureCategory::Unsupported, "E-UNSUP", true, None),
        classified(PublishFailureCategory::Rejected, "E-REJECT", true, None),
        classified(PublishFailureCategory::Unknown, "E-UNKNOWN", true, None),
    ];

    for failure in blocking {
        let fixture = retry_fixture(&[("primary", true)]);
        let code = failure.native_code.clone();
        fixture
            .destination
            .push_publish_error("primary", PublishError::Classified { failure });
        // 即使远端可探测为不存在，分类不合格也不得自动重试（ADR-0056）。
        fixture
            .destination
            .set_probe("primary", DeliveryProbe::Absent);
        let (prepared, view) = start_attempt(&fixture, &format!("attempt-block-{code}"));

        let error = fixture
            .runtime
            .resume_attempt(&prepared, &view, &AttemptExecutionContext::at(0))
            .expect_err("blocking categories must not retry automatically");
        assert!(
            error.to_string().contains("blocked"),
            "resume error should explain the block for {code}: {error}"
        );
        assert_eq!(fixture.destination.publish_calls("primary"), 1);
        assert_eq!(fixture.destination.probe_calls("primary"), 0);
    }

    // 未分类失败等同于 Unknown：默认阻断，不解析错误字符串。
    let fixture = retry_fixture(&[("primary", true)]);
    fixture.destination.push_publish_error(
        "primary",
        PublishError::Execution("unclassified destination outage".to_string()),
    );
    fixture
        .destination
        .set_probe("primary", DeliveryProbe::Absent);
    let (prepared, view) = start_attempt(&fixture, "attempt-unclassified");
    assert!(route_view(&view, "primary").failure.is_none());

    let error = fixture
        .runtime
        .resume_attempt(&prepared, &view, &AttemptExecutionContext::at(0))
        .expect_err("unclassified failures must stay blocked");
    assert!(error.to_string().contains("blocked"));
    assert_eq!(fixture.destination.publish_calls("primary"), 1);
    assert_eq!(fixture.destination.probe_calls("primary"), 0);
}

#[test]
fn uncertain_outcome_with_matching_remote_reuses_the_receipt_without_reexecution() {
    let fixture = retry_fixture(&[("primary", true)]);
    fixture.destination.push_publish_error(
        "primary",
        PublishError::Classified {
            failure: classified(PublishFailureCategory::Transient, "ETIMEDOUT", false, None),
        },
    );
    let (prepared, view) = start_attempt(&fixture, "attempt-reuse");
    assert_eq!(view.status, PublishAttemptStatus::Failed);

    fixture.destination.set_probe(
        "primary",
        DeliveryProbe::Matching {
            external_reference: "fake://primary/already-delivered".to_string(),
        },
    );
    let resumed = fixture
        .runtime
        .resume_attempt(&prepared, &view, &AttemptExecutionContext::at(0))
        .expect("resume with matching remote state");

    assert_eq!(resumed.status, PublishAttemptStatus::Published);
    let route = route_view(&resumed, "primary");
    assert_eq!(route.status, DeliveryStatus::Published);
    assert_eq!(
        route.external_reference.as_deref(),
        Some("fake://primary/already-delivered")
    );
    assert_eq!(resumed.receipts.len(), 1);
    assert_eq!(
        resumed.receipts[0].external_reference,
        "fake://primary/already-delivered"
    );
    // 摘要一致的远端交付被复用：publish 不再执行（ADR-0051）。
    assert_eq!(fixture.destination.publish_calls("primary"), 1);
    assert_eq!(fixture.destination.probe_calls("primary"), 1);
}

#[test]
fn conflicting_remote_state_blocks_resume_instead_of_overwriting() {
    let fixture = retry_fixture(&[("primary", true)]);
    fixture.destination.push_publish_error(
        "primary",
        PublishError::Classified {
            failure: classified(PublishFailureCategory::Transient, "ETIMEDOUT", false, None),
        },
    );
    let (prepared, view) = start_attempt(&fixture, "attempt-conflict");

    fixture.destination.set_probe(
        "primary",
        DeliveryProbe::Conflicting {
            external_reference: "fake://primary/foreign-release".to_string(),
        },
    );
    let error = fixture
        .runtime
        .resume_attempt(&prepared, &view, &AttemptExecutionContext::at(0))
        .expect_err("conflicting remote state must block resume");

    assert!(error.to_string().contains("conflict"));
    assert_eq!(fixture.destination.publish_calls("primary"), 1);
    assert_eq!(fixture.destination.probe_calls("primary"), 1);
}

#[test]
fn unprobeable_remote_state_blocks_automatic_retry() {
    let fixture = retry_fixture(&[("primary", true)]);
    fixture.destination.push_publish_error(
        "primary",
        PublishError::Classified {
            failure: classified(PublishFailureCategory::Transient, "ETIMEDOUT", false, None),
        },
    );
    let (prepared, view) = start_attempt(&fixture, "attempt-unprobeable");

    fixture.destination.set_probe(
        "primary",
        DeliveryProbe::Unprobeable {
            reason: "destination API is unreachable".to_string(),
        },
    );
    let error = fixture
        .runtime
        .resume_attempt(&prepared, &view, &AttemptExecutionContext::at(0))
        .expect_err("unprobeable remote state must block automatic retry");

    assert!(error.to_string().contains("blocked"));
    // 阻断是显式结构化状态，调用方按变体分派而不是解析字符串（ADR-0056）。
    assert!(matches!(
        error,
        PublishError::AutomaticRetryBlocked { ref reasons } if reasons.len() == 1
    ));
    assert_eq!(fixture.destination.publish_calls("primary"), 1);
    assert_eq!(fixture.destination.probe_calls("primary"), 1);
}

#[test]
fn partial_delivery_resume_executes_only_the_failed_route() {
    let fixture = retry_fixture(&[("primary", true), ("mirror", false)]);
    fixture.destination.push_publish_error(
        "primary",
        PublishError::Classified {
            failure: classified(PublishFailureCategory::Transient, "ECONNRESET", true, None),
        },
    );
    let (prepared, view) = start_attempt(&fixture, "attempt-partial");

    assert_eq!(view.status, PublishAttemptStatus::PartialDelivery);
    assert_eq!(fixture.build_executions.load(Ordering::SeqCst), 1);
    let mirror_receipt = view
        .receipts
        .iter()
        .find(|receipt| receipt.route_id == "mirror")
        .expect("mirror published in the first run")
        .clone();

    fixture
        .destination
        .set_probe("primary", DeliveryProbe::Absent);
    let resumed = fixture
        .runtime
        .resume_attempt(&prepared, &view, &AttemptExecutionContext::at(0))
        .expect("resume the failed route");

    assert_eq!(resumed.status, PublishAttemptStatus::Published);
    assert!(resumed.error.is_none());
    assert!(resumed.warnings.is_empty());
    assert_eq!(
        route_view(&resumed, "primary").status,
        DeliveryStatus::Published
    );
    assert_eq!(
        route_view(&resumed, "mirror").status,
        DeliveryStatus::Published
    );

    // 续传不重新构建、不重新处理、不触碰成功路线（ADR-0022/0040）。
    assert_eq!(fixture.build_executions.load(Ordering::SeqCst), 1);
    assert_eq!(fixture.processor_executions.load(Ordering::SeqCst), 1);
    assert_eq!(fixture.destination.stage_calls("mirror"), 1);
    assert_eq!(fixture.destination.publish_calls("mirror"), 1);
    assert_eq!(fixture.destination.publish_calls("primary"), 2);
    assert_eq!(fixture.destination.stage_calls("primary"), 2);

    // 成功路线的不可变 Receipt 原样保留；事件历史按因果顺序延续同一尝试。
    assert!(resumed.receipts.contains(&mirror_receipt));
    assert_eq!(resumed.attempt, view.attempt);
    assert!(resumed.events.len() > view.events.len());
    assert_eq!(resumed.events[..view.events.len()], view.events[..]);
    for (index, event) in resumed.events.iter().enumerate() {
        assert_eq!(event.sequence, index as u64 + 1);
        assert_eq!(event.attempt_id, view.attempt.attempt_id);
        assert_eq!(event.backend_run_id, view.attempt.backend_run_id);
    }
}

#[test]
fn resume_rejects_views_that_belong_to_a_different_plan() {
    let fixture = retry_fixture(&[("primary", true)]);
    fixture.destination.push_publish_error(
        "primary",
        PublishError::Classified {
            failure: classified(PublishFailureCategory::Transient, "ECONNRESET", true, None),
        },
    );
    let (_, view) = start_attempt(&fixture, "attempt-identity");

    let mut other_snapshot = fixture.snapshot.clone();
    other_snapshot
        .release_input
        .insert("version".to_string(), Value::String("2.0.0".to_string()));
    let other_prepared = fixture
        .runtime
        .prepare_attempt(&other_snapshot)
        .expect("prepare a different plan");

    let error = fixture
        .runtime
        .resume_attempt(&other_prepared, &view, &AttemptExecutionContext::at(0))
        .expect_err("resume must keep the attempt identity stable");
    assert!(error.to_string().contains("identity"));
    assert_eq!(fixture.destination.publish_calls("primary"), 1);
}

#[test]
fn resume_requires_the_sealed_manifest_of_the_attempt() {
    let fixture = retry_fixture(&[("primary", true)]);
    fixture.destination.push_publish_error(
        "primary",
        PublishError::Classified {
            failure: classified(PublishFailureCategory::Transient, "ECONNRESET", true, None),
        },
    );
    fixture
        .destination
        .set_probe("primary", DeliveryProbe::Absent);
    let (prepared, mut view) = start_attempt(&fixture, "attempt-manifest");

    view.manifest = None;
    let error = fixture
        .runtime
        .resume_attempt(&prepared, &view, &AttemptExecutionContext::at(0))
        .expect_err("resume requires the sealed artifact manifest");
    assert_eq!(error, PublishError::MissingArtifactManifest);
}

#[test]
fn probe_transport_errors_block_only_their_own_route() {
    let fixture = retry_fixture(&[("primary", true), ("mirror", true)]);
    for route_id in ["primary", "mirror"] {
        fixture.destination.push_publish_error(
            route_id,
            PublishError::Classified {
                failure: classified(PublishFailureCategory::Transient, "ECONNRESET", true, None),
            },
        );
    }
    let (prepared, view) = start_attempt(&fixture, "attempt-probe-error");
    assert_eq!(view.status, PublishAttemptStatus::Failed);

    // primary 的探测本身失败；mirror 探测远端不存在。探测错误按路线隔离（ADR-0022）。
    fixture.destination.set_probe_error(
        "primary",
        PublishError::Execution("probe transport failed".to_string()),
    );
    fixture
        .destination
        .set_probe("mirror", DeliveryProbe::Absent);

    let resumed = fixture
        .runtime
        .resume_attempt(&prepared, &view, &AttemptExecutionContext::at(0))
        .expect("resume must continue with the probeable route");

    assert_eq!(resumed.status, PublishAttemptStatus::PartialDelivery);
    assert_eq!(
        route_view(&resumed, "mirror").status,
        DeliveryStatus::Published
    );
    assert_eq!(
        route_view(&resumed, "primary").status,
        DeliveryStatus::Failed
    );
    assert_eq!(fixture.destination.publish_calls("mirror"), 2);
    assert_eq!(fixture.destination.publish_calls("primary"), 1);
}

#[test]
fn reduce_rejects_corrupt_or_unversioned_failure_evidence() {
    use publish_domain::{PlanRoute, PublishEvent, PUBLISH_EVENT_VERSION};

    let routes = vec![PlanRoute {
        route_id: "primary".to_string(),
        required: true,
    }];
    let route_failed_event = |failure_payload: Value| PublishEvent {
        version: PUBLISH_EVENT_VERSION,
        event_id: "event-1".to_string(),
        attempt_id: "attempt-corrupt".to_string(),
        backend_run_id: "run-corrupt".to_string(),
        sequence: 1,
        plan_digest: "plan-corrupt".to_string(),
        plan_node_id: "primary.publish".to_string(),
        kind: "route_failed".to_string(),
        payload: BTreeMap::from([
            ("route_id".to_string(), Value::String("primary".to_string())),
            ("error".to_string(), Value::String("boom".to_string())),
            ("failure".to_string(), failure_payload),
        ]),
    };

    // 畸形分类证据必须显式报错，而不是静默降级为未分类（ADR-0056）。
    let corrupt = publish_runner_core::reduce_publish_events(
        &[route_failed_event(Value::String(
            "not-a-failure".to_string(),
        ))],
        &routes,
    )
    .expect_err("corrupt failure evidence must be rejected");
    assert!(corrupt
        .to_string()
        .contains("invalid failure classification"));

    let mut unversioned = classified(PublishFailureCategory::Transient, "ECONNRESET", true, None);
    unversioned.version = 99;
    let error = publish_runner_core::reduce_publish_events(
        &[route_failed_event(
            serde_json::to_value(&unversioned).expect("serialize failure"),
        )],
        &routes,
    )
    .expect_err("unsupported failure classification versions must be rejected");
    assert_eq!(
        error,
        PublishError::UnsupportedFailureVersion {
            actual: 99,
            expected: PUBLISH_FAILURE_VERSION,
        }
    );
}
