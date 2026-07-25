use std::collections::BTreeMap;
use std::fs;
use std::sync::Arc;

use publish_adapters::{
    AdapterConformanceFixture, AdapterContract, AdapterExecutionContext, AdapterExecutionOutput,
    AdapterRegistry, ArtifactProcessor, DeliveryDestination, LocalDirectoryDestination,
    LocalExecutionBackend, ProjectProvider, TemporaryArtifactStore,
};
use publish_domain::{
    sha256_hex, AdapterBinding, AdapterDescriptor, AdapterIdentity, AdapterKind, AdapterSchema,
    AdapterSelection, AdapterSettings, ArtifactCandidate, Capability, CapabilityRequirement,
    DeliveryReceipt, DeliveryRoute, DeliveryStatus, PlanNode, PlanNodeTemplate, PlanOperation,
    PlanRoute, PlanSideEffect, PlanStage, PlanningInputSnapshot, PublishAttemptStatus,
    PublishError, PublishEvent, PublishPlan, PublishingCapability, ReleaseIdentity, SourceSnapshot,
    ARTIFACT_MANIFEST_VERSION, DELIVERY_RECEIPT_VERSION, PLANNING_INPUT_SNAPSHOT_VERSION,
    PUBLISH_EVENT_VERSION,
};
use publish_runner_core::{reduce_publish_events, PublishRuntime, StartPublishAttempt};
use serde_json::Value;

fn required_routes(route_ids: &[&str]) -> Vec<PlanRoute> {
    route_ids
        .iter()
        .map(|route_id| PlanRoute {
            route_id: route_id.to_string(),
            required: true,
        })
        .collect()
}

const ARTIFACT_BYTES: &[u8] = b"one-publish fake artifact\n";

struct FakeProjectProvider {
    descriptor: AdapterDescriptor,
}

impl FakeProjectProvider {
    fn new(backend_requirement: CapabilityRequirement) -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ProjectProvider,
                "fake-project",
                1,
                AdapterSchema::new(1),
                PublishingCapability {
                    provides: vec![Capability::new("artifact-candidate", 1)],
                    requires: vec![backend_requirement],
                },
            )
            .with_allowed_program("fake-project:builder"),
        }
    }
}

impl AdapterContract for FakeProjectProvider {
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
        Ok(vec![PlanNodeTemplate::command(
            "build",
            PlanStage::Build,
            "fake-project:builder",
            vec!["--release".to_string()],
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

impl ProjectProvider for FakeProjectProvider {}

struct FakeArtifactProcessor {
    descriptor: AdapterDescriptor,
}

impl FakeArtifactProcessor {
    fn new() -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ArtifactProcessor,
                "fake-verifier",
                1,
                AdapterSchema::new(1),
                PublishingCapability {
                    provides: vec![Capability::new("artifact-verified", 1)],
                    requires: vec![CapabilityRequirement::exact("artifact-candidate", 1)],
                },
            ),
        }
    }
}

impl AdapterContract for FakeArtifactProcessor {
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
        _node: &PlanNode,
        _context: &AdapterExecutionContext<'_>,
    ) -> Result<AdapterExecutionOutput, publish_domain::PublishError> {
        Ok(AdapterExecutionOutput::default())
    }
}

impl ArtifactProcessor for FakeArtifactProcessor {}

struct InjectingExecutionBackend {
    descriptor: AdapterDescriptor,
}

impl InjectingExecutionBackend {
    fn new() -> Self {
        Self {
            descriptor: LocalExecutionBackend::new().descriptor().clone(),
        }
    }
}

impl AdapterContract for InjectingExecutionBackend {
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

    fn execute_plan(
        &self,
        plan: &PublishPlan,
        executor: &mut dyn publish_adapters::PlanNodeExecutor,
    ) -> Result<(), PublishError> {
        let mut injected = plan.nodes[0].clone();
        injected.id = "injected-node".to_string();
        injected.depends_on.clear();
        executor.execute_node(&injected)
    }
}

impl publish_adapters::ExecutionBackend for InjectingExecutionBackend {}

struct MalformedReceiptDestination {
    delegate: LocalDirectoryDestination,
    wrong_route: bool,
}

impl MalformedReceiptDestination {
    fn new(directory: &std::path::Path) -> Self {
        Self {
            delegate: LocalDirectoryDestination::new(directory),
            wrong_route: false,
        }
    }

    fn wrong_route(directory: &std::path::Path) -> Self {
        Self {
            delegate: LocalDirectoryDestination::new(directory),
            wrong_route: true,
        }
    }
}

impl AdapterContract for MalformedReceiptDestination {
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
        let PlanOperation::AdapterAction { action, .. } = &node.operation else {
            return Err(PublishError::Execution(
                "malformed receipt fixture expected an adapter action".to_string(),
            ));
        };
        if action == "stage_local_directory" {
            return Ok(AdapterExecutionOutput::default());
        }
        let manifest = context
            .manifest
            .ok_or(PublishError::MissingArtifactManifest)?;
        Ok(AdapterExecutionOutput {
            receipts: vec![DeliveryReceipt {
                version: DELIVERY_RECEIPT_VERSION,
                receipt_id: if self.wrong_route {
                    "receipt-wrong-route".to_string()
                } else {
                    String::new()
                },
                revision: 1,
                route_id: if self.wrong_route {
                    "another-route".to_string()
                } else {
                    node.binding_id.clone()
                },
                manifest_digest: manifest.digest.clone(),
                status: DeliveryStatus::Published,
                external_reference: "local://malformed".to_string(),
            }],
            ..AdapterExecutionOutput::default()
        })
    }
}

impl DeliveryDestination for MalformedReceiptDestination {}

#[test]
fn fake_adapters_execute_one_plan_into_manifest_events_and_receipt() {
    let store_dir = tempfile::tempdir().expect("create temporary store");
    let delivery_dir = tempfile::tempdir().expect("create local delivery directory");
    assert_ne!(store_dir.path(), delivery_dir.path());

    let (runtime, snapshot) = fixture_runtime(
        store_dir.path(),
        delivery_dir.path(),
        CapabilityRequirement::exact("structured-plan-execution", 1),
    );
    let plan = runtime.prepare(&snapshot).expect("prepare publish plan");

    let build = plan
        .nodes
        .iter()
        .find(|node| node.binding_id == "project")
        .expect("build node");
    assert_eq!(build.artifact_inputs, Vec::<String>::new());
    assert_eq!(build.artifact_outputs, vec!["desktop-installer"]);
    let persist = plan
        .nodes
        .iter()
        .find(|node| node.binding_id == "store")
        .expect("persist node");
    assert_eq!(persist.artifact_inputs, vec!["artifact:*"]);
    assert_eq!(persist.artifact_outputs, vec!["artifact-manifest"]);
    assert_eq!(persist.side_effects, vec![PlanSideEffect::FileSystem]);
    let publish = plan
        .nodes
        .iter()
        .find(|node| node.binding_id == "destination" && node.stage == PlanStage::PublishRoutes)
        .expect("publish node");
    assert_eq!(publish.artifact_inputs, vec!["artifact-manifest"]);
    assert_eq!(publish.side_effects, vec![PlanSideEffect::FileSystem]);
    assert!(publish.irreversible);

    let outcome = runtime
        .start(&plan, "attempt-001")
        .expect("execute publish plan");

    assert_eq!(outcome.manifest.version, ARTIFACT_MANIFEST_VERSION);
    assert_eq!(outcome.manifest.artifacts.len(), 1);
    let stored = &outcome.manifest.artifacts[0];
    assert_eq!(stored.digest, sha256_hex(ARTIFACT_BYTES));
    assert!(stored
        .locator
        .starts_with(store_dir.path().to_string_lossy().as_ref()));
    assert_eq!(
        fs::read(&stored.locator).expect("read stored artifact"),
        ARTIFACT_BYTES
    );

    let delivered_path = delivery_dir
        .path()
        .join(format!("attempt-{}", &sha256_hex(b"attempt-001")[..24]))
        .join("app.bin");
    assert_eq!(
        fs::read(delivered_path).expect("read delivered artifact"),
        ARTIFACT_BYTES
    );

    assert_eq!(
        outcome.events.len(),
        plan.nodes.len() + outcome.receipts.len()
    );
    for (index, event) in outcome.events.iter().enumerate() {
        assert_eq!(event.version, PUBLISH_EVENT_VERSION);
        assert_eq!(event.sequence, index as u64 + 1);
    }
    assert_eq!(
        outcome
            .events
            .iter()
            .find(|event| event.plan_node_id == persist.id)
            .and_then(|event| event.payload.get("manifest_digest"))
            .and_then(Value::as_str),
        Some(outcome.manifest.digest.as_str())
    );
    assert_eq!(
        outcome
            .events
            .iter()
            .find(|event| {
                event.plan_node_id == publish.id && event.kind == "delivery_receipt_observed"
            })
            .and_then(|event| event.payload.get("receipt"))
            .and_then(|receipt| receipt.get("status"))
            .and_then(Value::as_str),
        Some("published")
    );

    assert_eq!(outcome.receipts.len(), 1);
    let receipt = &outcome.receipts[0];
    assert_eq!(receipt.status, DeliveryStatus::Published);
    assert_eq!(receipt.manifest_digest, outcome.manifest.digest);
    assert_eq!(receipt.route_id, "destination");
}

#[test]
fn event_reducer_projects_every_receipt_revision_and_terminal_failure() {
    let manifest_digest = "a".repeat(64);
    let event = |sequence: u64, kind: &str, payload: BTreeMap<String, Value>| PublishEvent {
        version: PUBLISH_EVENT_VERSION,
        event_id: format!("event-{sequence}"),
        attempt_id: "attempt-events".to_string(),
        backend_run_id: "backend-events".to_string(),
        sequence,
        plan_digest: "plan-events".to_string(),
        plan_node_id: "publish-routes".to_string(),
        kind: kind.to_string(),
        payload,
    };
    let receipt_payload = |receipt_id: &str, revision: u32, status: DeliveryStatus| {
        BTreeMap::from([(
            "receipt".to_string(),
            serde_json::json!({
                "version": DELIVERY_RECEIPT_VERSION,
                "receipt_id": receipt_id,
                "revision": revision,
                "route_id": receipt_id.replace("receipt", "route"),
                "manifest_digest": manifest_digest,
                "status": status,
                "external_reference": format!("local://{receipt_id}"),
            }),
        )])
    };
    let events = vec![
        event(
            1,
            "plan_node_completed",
            BTreeMap::from([(
                "manifest_digest".to_string(),
                Value::String(manifest_digest.clone()),
            )]),
        ),
        event(
            2,
            "delivery_receipt_observed",
            receipt_payload("receipt-a", 1, DeliveryStatus::Submitted),
        ),
        event(
            3,
            "delivery_receipt_observed",
            receipt_payload("receipt-a", 2, DeliveryStatus::Published),
        ),
        event(
            4,
            "delivery_receipt_observed",
            receipt_payload("receipt-b", 1, DeliveryStatus::Rejected),
        ),
    ];

    let projection = reduce_publish_events(&events, &required_routes(&["route-a", "route-b"]))
        .expect("reduce standard publish events");

    assert_eq!(
        projection.manifest_digest.as_deref(),
        Some(manifest_digest.as_str())
    );
    assert_eq!(projection.receipts.len(), 2);
    assert_eq!(projection.receipts[0].receipt_id, "receipt-a");
    assert_eq!(projection.receipts[0].revision, 2);
    assert_eq!(projection.receipts[0].status, DeliveryStatus::Published);
    assert_eq!(projection.receipts[1].receipt_id, "receipt-b");
    assert_eq!(projection.receipts[1].status, DeliveryStatus::Rejected);
    // Required Route 终态失败，但 route-a 已发布：聚合为 Partial Delivery（ADR-0022）。
    assert_eq!(projection.status, PublishAttemptStatus::PartialDelivery);
    assert!(projection
        .error
        .as_deref()
        .is_some_and(|error| error.contains("receipt-b") && error.contains("rejected")));
    assert_eq!(projection.routes.len(), 2);
    assert_eq!(projection.routes[0].status, DeliveryStatus::Published);
    assert!(projection.routes[0].error.is_none());
    assert_eq!(projection.routes[1].status, DeliveryStatus::Rejected);
    assert!(projection.routes[1]
        .error
        .as_deref()
        .is_some_and(|error| error.contains("receipt-b")));
}

#[test]
fn event_reducer_rejects_invalid_receipt_revision_transitions() {
    let manifest_digest = "b".repeat(64);
    let receipt_event =
        |sequence: u64, revision: u32, route_id: &str, status: DeliveryStatus| PublishEvent {
            version: PUBLISH_EVENT_VERSION,
            event_id: format!("event-{sequence}"),
            attempt_id: "attempt-revisions".to_string(),
            backend_run_id: "backend-revisions".to_string(),
            sequence,
            plan_digest: "plan-revisions".to_string(),
            plan_node_id: "publish-routes".to_string(),
            kind: "delivery_receipt_observed".to_string(),
            payload: BTreeMap::from([(
                "receipt".to_string(),
                serde_json::json!({
                    "version": DELIVERY_RECEIPT_VERSION,
                    "receipt_id": "receipt-a",
                    "revision": revision,
                    "route_id": route_id,
                    "manifest_digest": manifest_digest,
                    "status": status,
                    "external_reference": "local://stable",
                }),
            )]),
        };
    let manifest_event = || PublishEvent {
        version: PUBLISH_EVENT_VERSION,
        event_id: "event-1".to_string(),
        attempt_id: "attempt-revisions".to_string(),
        backend_run_id: "backend-revisions".to_string(),
        sequence: 1,
        plan_digest: "plan-revisions".to_string(),
        plan_node_id: "persist-manifest".to_string(),
        kind: "plan_node_completed".to_string(),
        payload: BTreeMap::from([(
            "manifest_digest".to_string(),
            Value::String(manifest_digest.clone()),
        )]),
    };

    let revision_gap = vec![
        manifest_event(),
        receipt_event(2, 1, "route-a", DeliveryStatus::Pending),
        receipt_event(3, 3, "route-a", DeliveryStatus::Published),
    ];
    let invalid_initial_revision = vec![
        manifest_event(),
        receipt_event(2, 2, "route-a", DeliveryStatus::Submitted),
    ];
    let route_change = vec![
        manifest_event(),
        receipt_event(2, 1, "route-a", DeliveryStatus::Pending),
        receipt_event(3, 2, "route-b", DeliveryStatus::Published),
    ];
    let terminal_regression = vec![
        manifest_event(),
        receipt_event(2, 1, "route-a", DeliveryStatus::Published),
        receipt_event(3, 2, "route-a", DeliveryStatus::Pending),
    ];

    let routes = required_routes(&["route-a", "route-b"]);
    assert!(reduce_publish_events(&revision_gap, &routes)
        .expect_err("receipt revisions must be continuous")
        .to_string()
        .contains("revision"));
    assert!(reduce_publish_events(&invalid_initial_revision, &routes)
        .expect_err("receipt evidence must start at revision one")
        .to_string()
        .contains("start at revision 1"));
    assert!(reduce_publish_events(&route_change, &routes)
        .expect_err("receipt route identity must be stable")
        .to_string()
        .contains("identity"));
    assert!(reduce_publish_events(&terminal_regression, &routes)
        .expect_err("terminal receipt lifecycle cannot regress")
        .to_string()
        .contains("lifecycle"));
}

#[test]
fn runtime_freezes_a_successful_local_attempt_and_reduces_its_published_result() {
    let store_dir = tempfile::tempdir().expect("create temporary store");
    let delivery_dir = tempfile::tempdir().expect("create local delivery directory");
    let (runtime, snapshot) = fixture_runtime(
        store_dir.path(),
        delivery_dir.path(),
        CapabilityRequirement::exact("structured-plan-execution", 1),
    );
    let prepared = runtime
        .prepare_attempt(&snapshot)
        .expect("prepare publish attempt");
    let release_identity = ReleaseIdentity::new(
        "fake-project:app",
        snapshot.source.clone(),
        "1.0.0",
        "stable",
        None,
    );

    let attempt = runtime
        .start_attempt(
            &prepared,
            StartPublishAttempt::new("attempt-001", "local-run-001", release_identity.clone()),
        )
        .expect("start publish attempt");

    assert_eq!(attempt.status, PublishAttemptStatus::Published);
    assert_eq!(attempt.attempt.attempt_id, "attempt-001");
    assert_eq!(attempt.attempt.backend_run_id, "local-run-001");
    assert_eq!(
        attempt.attempt.configuration_revision,
        snapshot.configuration_revision
    );
    assert_eq!(attempt.attempt.runtime_revision, snapshot.runtime_revision);
    assert_eq!(attempt.attempt.plan_digest, prepared.plan.digest);
    assert_eq!(attempt.attempt.release_identity, release_identity);
    assert_eq!(
        attempt.attempt.manifest_digest.as_deref(),
        attempt
            .manifest
            .as_ref()
            .map(|manifest| manifest.digest.as_str())
    );
    assert_eq!(attempt.receipts.len(), 1);
    assert_eq!(attempt.receipts[0].status, DeliveryStatus::Published);
    assert_eq!(
        attempt.receipts[0].manifest_digest,
        attempt
            .manifest
            .as_ref()
            .expect("sealed artifact manifest")
            .digest
    );
    assert!(attempt.error.is_none());
    assert!(attempt
        .events
        .iter()
        .all(|event| event.backend_run_id == "local-run-001"));
}

#[test]
fn runtime_preserves_a_failed_attempt_after_the_manifest_is_sealed() {
    let store_dir = tempfile::tempdir().expect("create temporary store");
    let delivery_parent = tempfile::tempdir().expect("create delivery parent");
    let blocked_delivery_path = delivery_parent.path().join("not-a-directory");
    fs::write(&blocked_delivery_path, b"occupied by a file").expect("create blocking file");
    let (runtime, snapshot) = fixture_runtime(
        store_dir.path(),
        &blocked_delivery_path,
        CapabilityRequirement::exact("structured-plan-execution", 1),
    );
    let prepared = runtime
        .prepare_attempt(&snapshot)
        .expect("prepare publish attempt");

    let attempt = runtime
        .start_attempt(
            &prepared,
            StartPublishAttempt::new(
                "attempt-failed-001",
                "local-run-failed-001",
                ReleaseIdentity::new(
                    "fake-project:app",
                    snapshot.source.clone(),
                    "1.0.0",
                    "stable",
                    None,
                ),
            ),
        )
        .expect("started failures are returned as attempt state");

    assert_eq!(attempt.status, PublishAttemptStatus::Failed);
    assert!(attempt
        .error
        .as_deref()
        .is_some_and(|error| error.contains("create directory")));
    assert!(attempt.manifest.is_some());
    assert_eq!(
        attempt.attempt.manifest_digest.as_deref(),
        attempt
            .manifest
            .as_ref()
            .map(|manifest| manifest.digest.as_str())
    );
    assert!(attempt.receipts.is_empty());
    // 唯一 Required Route 失败被隔离为 route_failed 证据，聚合结果仍是 Failed。
    assert_eq!(
        attempt.events.last().map(|event| event.kind.as_str()),
        Some("route_failed")
    );
    assert!(attempt
        .events
        .last()
        .and_then(|event| event.payload.get("error"))
        .and_then(Value::as_str)
        .is_some_and(|error| error.contains("create directory")));
    assert_eq!(attempt.routes.len(), 1);
    assert_eq!(attempt.routes[0].route_id, "destination");
    assert_eq!(attempt.routes[0].status, DeliveryStatus::Failed);
    assert!(attempt.routes[0]
        .error
        .as_deref()
        .is_some_and(|error| error.contains("create directory")));
}

#[test]
fn malformed_receipt_is_reduced_to_a_failed_attempt_without_invalid_evidence() {
    let store_dir = tempfile::tempdir().expect("create temporary store");
    let delivery_dir = tempfile::tempdir().expect("create local delivery directory");
    let (runtime, snapshot) = fixture_runtime_with_destination(
        store_dir.path(),
        delivery_dir.path(),
        Arc::new(MalformedReceiptDestination::new(delivery_dir.path())),
    );
    let prepared = runtime
        .prepare_attempt(&snapshot)
        .expect("prepare malformed receipt attempt");

    let attempt = runtime
        .start_attempt(
            &prepared,
            StartPublishAttempt::new(
                "attempt-malformed-receipt",
                "local-run-malformed-receipt",
                ReleaseIdentity::new(
                    "fake-project:app",
                    snapshot.source.clone(),
                    "1.0.0",
                    "stable",
                    None,
                ),
            ),
        )
        .expect("invalid adapter evidence must remain an inspectable failed attempt");

    assert_eq!(attempt.status, PublishAttemptStatus::Failed);
    assert!(attempt.manifest.is_some());
    assert!(attempt.receipts.is_empty());
    assert!(attempt
        .error
        .as_deref()
        .is_some_and(|error| error.contains("invalid immutable revision evidence")));
    assert!(!attempt
        .events
        .iter()
        .any(|event| event.kind == "delivery_receipt_observed"));
    // 无效证据让本路线失败；证据校验错误保留在 route_failed 事件里。
    assert_eq!(
        attempt.events.last().map(|event| event.kind.as_str()),
        Some("route_failed")
    );
}

#[test]
fn receipt_from_the_wrong_route_is_reduced_to_a_failed_attempt() {
    let store_dir = tempfile::tempdir().expect("create temporary store");
    let delivery_dir = tempfile::tempdir().expect("create local delivery directory");
    let (runtime, snapshot) = fixture_runtime_with_destination(
        store_dir.path(),
        delivery_dir.path(),
        Arc::new(MalformedReceiptDestination::wrong_route(
            delivery_dir.path(),
        )),
    );
    let prepared = runtime
        .prepare_attempt(&snapshot)
        .expect("prepare wrong-route receipt attempt");

    let attempt = runtime
        .start_attempt(
            &prepared,
            StartPublishAttempt::new(
                "attempt-wrong-route",
                "local-run-wrong-route",
                ReleaseIdentity::new(
                    "fake-project:app",
                    snapshot.source.clone(),
                    "1.0.0",
                    "stable",
                    None,
                ),
            ),
        )
        .expect("wrong-route evidence must remain an inspectable failed attempt");

    assert_eq!(attempt.status, PublishAttemptStatus::Failed);
    assert!(attempt.receipts.is_empty());
    assert!(attempt
        .error
        .as_deref()
        .is_some_and(|error| error.contains("another-route") && error.contains("destination")));
    assert!(!attempt
        .events
        .iter()
        .any(|event| event.kind == "delivery_receipt_observed"));
}

#[test]
fn runtime_does_not_restart_an_attempt_with_a_reselected_configuration() {
    let store_dir = tempfile::tempdir().expect("create temporary store");
    let delivery_dir = tempfile::tempdir().expect("create local delivery directory");
    let (runtime, snapshot_a) = fixture_runtime(
        store_dir.path(),
        delivery_dir.path(),
        CapabilityRequirement::exact("structured-plan-execution", 1),
    );
    let prepared_a = runtime
        .prepare_attempt(&snapshot_a)
        .expect("prepare revision A");
    let mut snapshot_b = snapshot_a.clone();
    snapshot_b.configuration_revision = "config-revision-2".to_string();
    snapshot_b
        .release_input
        .insert("version".to_string(), Value::String("2.0.0".to_string()));
    let prepared_b = runtime
        .prepare_attempt(&snapshot_b)
        .expect("prepare revision B");

    let attempt_a = runtime
        .start_attempt(
            &prepared_a,
            StartPublishAttempt::new(
                "attempt-fixed-001",
                "local-run-fixed-001",
                ReleaseIdentity::new(
                    "fake-project:app",
                    snapshot_a.source.clone(),
                    "1.0.0",
                    "stable",
                    None,
                ),
            ),
        )
        .expect("start revision A");

    let restart = runtime.start_attempt(
        &prepared_b,
        StartPublishAttempt::new(
            "attempt-fixed-001",
            "local-run-reselected-002",
            ReleaseIdentity::new(
                "fake-project:app",
                snapshot_b.source.clone(),
                "2.0.0",
                "stable",
                None,
            ),
        ),
    );

    assert!(matches!(
        restart,
        Err(PublishError::AttemptAlreadyStarted { attempt_id })
            if attempt_id == "attempt-fixed-001"
    ));
    assert_eq!(
        attempt_a.attempt.configuration_revision,
        snapshot_a.configuration_revision
    );
    assert_eq!(attempt_a.attempt.plan_digest, prepared_a.plan.digest);
    assert_ne!(attempt_a.attempt.plan_digest, prepared_b.plan.digest);
}

#[test]
fn unknown_plan_adapter_and_schema_versions_are_rejected_before_execution() {
    let store_dir = tempfile::tempdir().expect("create temporary store");
    let delivery_dir = tempfile::tempdir().expect("create local delivery directory");
    let (runtime, snapshot) = fixture_runtime(
        store_dir.path(),
        delivery_dir.path(),
        CapabilityRequirement::exact("structured-plan-execution", 1),
    );

    let mut unknown_adapter = snapshot.clone();
    unknown_adapter.adapters.project_provider.adapter.version = 99;
    assert!(matches!(
        runtime.prepare(&unknown_adapter),
        Err(PublishError::AdapterVersionMismatch {
            kind: AdapterKind::ProjectProvider,
            requested: 99,
            ..
        })
    ));

    let mut unknown_schema = snapshot.clone();
    unknown_schema
        .adapters
        .project_provider
        .settings
        .schema_version = 99;
    assert!(matches!(
        runtime.prepare(&unknown_schema),
        Err(PublishError::UnsupportedSchemaVersion { actual: 99, .. })
    ));

    let mut unknown_plan = runtime.prepare(&snapshot).expect("prepare known plan");
    unknown_plan.version = 99;
    assert!(matches!(
        runtime.start(&unknown_plan, "attempt-version-rejection"),
        Err(PublishError::UnsupportedPlanVersion { actual: 99, .. })
    ));
    assert!(delivery_dir
        .path()
        .read_dir()
        .expect("read delivery dir")
        .next()
        .is_none());
}

#[test]
fn runner_preflights_every_node_version_before_the_first_side_effect() {
    let adapter_store = tempfile::tempdir().expect("create adapter-version store");
    let adapter_delivery = tempfile::tempdir().expect("create adapter-version delivery");
    let (adapter_runtime, adapter_snapshot) = fixture_runtime(
        adapter_store.path(),
        adapter_delivery.path(),
        CapabilityRequirement::exact("structured-plan-execution", 1),
    );
    let mut unknown_adapter_plan = adapter_runtime
        .prepare(&adapter_snapshot)
        .expect("prepare adapter-version plan");
    let destination_node = unknown_adapter_plan
        .nodes
        .iter_mut()
        .find(|node| node.binding_id == "destination")
        .expect("destination node");
    destination_node.adapter.version = 99;
    unknown_adapter_plan.digest = unknown_adapter_plan
        .recomputed_digest()
        .expect("reseal adapter-version plan");
    assert!(matches!(
        adapter_runtime.start(&unknown_adapter_plan, "attempt-adapter-preflight"),
        Err(PublishError::AdapterVersionMismatch { requested: 99, .. })
    ));
    assert!(adapter_store
        .path()
        .read_dir()
        .expect("read adapter-version store")
        .next()
        .is_none());

    let schema_store = tempfile::tempdir().expect("create schema-version store");
    let schema_delivery = tempfile::tempdir().expect("create schema-version delivery");
    let (schema_runtime, schema_snapshot) = fixture_runtime(
        schema_store.path(),
        schema_delivery.path(),
        CapabilityRequirement::exact("structured-plan-execution", 1),
    );
    let mut unknown_schema_plan = schema_runtime
        .prepare(&schema_snapshot)
        .expect("prepare schema-version plan");
    let destination_node = unknown_schema_plan
        .nodes
        .iter_mut()
        .find(|node| node.binding_id == "destination")
        .expect("destination node");
    destination_node.settings.schema_version = 99;
    unknown_schema_plan.digest = unknown_schema_plan
        .recomputed_digest()
        .expect("reseal schema-version plan");
    assert!(matches!(
        schema_runtime.start(&unknown_schema_plan, "attempt-schema-preflight"),
        Err(PublishError::UnsupportedSchemaVersion { actual: 99, .. })
    ));
    assert!(schema_store
        .path()
        .read_dir()
        .expect("read schema-version store")
        .next()
        .is_none());
}

#[test]
fn runner_rejects_resealed_shell_operations_before_the_first_side_effect() {
    let store_dir = tempfile::tempdir().expect("create shell-rejection store");
    let delivery_dir = tempfile::tempdir().expect("create shell-rejection delivery");
    let (runtime, snapshot) = fixture_runtime(
        store_dir.path(),
        delivery_dir.path(),
        CapabilityRequirement::exact("structured-plan-execution", 1),
    );
    let mut plan = runtime.prepare(&snapshot).expect("prepare known plan");
    plan.nodes[0].operation = PlanOperation::RunProgram {
        program: "sh".to_string(),
        args: vec!["-c".to_string(), "echo hidden side effect".to_string()],
        working_directory: None,
        environment_references: BTreeMap::new(),
    };
    plan.digest = plan.recomputed_digest().expect("reseal shell plan");

    assert!(matches!(
        runtime.start(&plan, "attempt-shell-rejection"),
        Err(PublishError::InvalidPlan(message)) if message.contains("shell interpreter")
    ));
    assert!(store_dir
        .path()
        .read_dir()
        .expect("read shell-rejection store")
        .next()
        .is_none());
}

#[test]
fn runner_rejects_programs_not_declared_by_the_adapter() {
    let store_dir = tempfile::tempdir().expect("create executable-policy store");
    let delivery_dir = tempfile::tempdir().expect("create executable-policy delivery");
    let (runtime, snapshot) = fixture_runtime(
        store_dir.path(),
        delivery_dir.path(),
        CapabilityRequirement::exact("structured-plan-execution", 1),
    );
    let mut plan = runtime.prepare(&snapshot).expect("prepare known plan");
    plan.nodes[0].operation = PlanOperation::RunProgram {
        program: "/usr/bin/env".to_string(),
        args: vec!["-S".to_string(), "sh -c \"echo bypass\"".to_string()],
        working_directory: None,
        environment_references: BTreeMap::new(),
    };
    plan.digest = plan.recomputed_digest().expect("reseal executable plan");

    assert!(matches!(
        runtime.start(&plan, "attempt-executable-policy"),
        Err(PublishError::InvalidAdapter { message, .. })
            if message.contains("program /usr/bin/env is not declared")
    ));
    assert!(store_dir
        .path()
        .read_dir()
        .expect("read executable-policy store")
        .next()
        .is_none());
}

#[test]
fn missing_or_incompatible_capabilities_block_planning_without_fallback() {
    let store_dir = tempfile::tempdir().expect("create temporary store");
    let delivery_dir = tempfile::tempdir().expect("create local delivery directory");

    let (missing_runtime, missing_snapshot) = fixture_runtime(
        store_dir.path(),
        delivery_dir.path(),
        CapabilityRequirement::exact("unavailable-runner", 1),
    );
    assert!(matches!(
        missing_runtime.prepare(&missing_snapshot),
        Err(PublishError::MissingCapability { capability, .. })
            if capability == "unavailable-runner"
    ));

    let (incompatible_runtime, incompatible_snapshot) = fixture_runtime(
        store_dir.path(),
        delivery_dir.path(),
        CapabilityRequirement::exact("structured-plan-execution", 2),
    );
    assert!(matches!(
        incompatible_runtime.prepare(&incompatible_snapshot),
        Err(PublishError::IncompatibleCapability {
            minimum: 2,
            maximum: 2,
            provided,
            ..
        }) if provided == vec![1]
    ));
    assert!(store_dir
        .path()
        .read_dir()
        .expect("read store dir")
        .next()
        .is_none());
    assert!(delivery_dir
        .path()
        .read_dir()
        .expect("read delivery dir")
        .next()
        .is_none());
}

#[test]
fn runner_revalidates_capabilities_before_the_first_side_effect() {
    let store_dir = tempfile::tempdir().expect("create capability-preflight store");
    let delivery_dir = tempfile::tempdir().expect("create capability-preflight delivery");
    let (preparing_runtime, snapshot) = fixture_runtime(
        store_dir.path(),
        delivery_dir.path(),
        CapabilityRequirement::exact("structured-plan-execution", 1),
    );
    let plan = preparing_runtime
        .prepare(&snapshot)
        .expect("prepare compatible plan");
    let (incompatible_runtime, _) = fixture_runtime(
        store_dir.path(),
        delivery_dir.path(),
        CapabilityRequirement::exact("structured-plan-execution", 2),
    );

    assert!(matches!(
        incompatible_runtime.start(&plan, "attempt-capability-preflight"),
        Err(PublishError::IncompatibleCapability { provided, .. }) if provided == vec![1]
    ));
    assert!(store_dir
        .path()
        .read_dir()
        .expect("read capability-preflight store")
        .next()
        .is_none());
    assert!(delivery_dir
        .path()
        .read_dir()
        .expect("read capability-preflight delivery")
        .next()
        .is_none());
}

#[test]
fn execution_backend_cannot_submit_nodes_outside_the_sealed_plan() {
    let store_dir = tempfile::tempdir().expect("create injected-node store");
    let delivery_dir = tempfile::tempdir().expect("create injected-node delivery");
    let (runtime, snapshot) = fixture_runtime_with_backend(
        store_dir.path(),
        delivery_dir.path(),
        CapabilityRequirement::exact("structured-plan-execution", 1),
        Arc::new(InjectingExecutionBackend::new()),
    );
    let plan = runtime.prepare(&snapshot).expect("prepare publish plan");

    assert!(matches!(
        runtime.start(&plan, "attempt-injected-node"),
        Err(PublishError::InvalidPlan(message))
            if message.contains("not part of the sealed plan")
    ));
    assert!(store_dir
        .path()
        .read_dir()
        .expect("read injected-node store")
        .next()
        .is_none());
}

fn fixture_runtime(
    store_directory: &std::path::Path,
    delivery_directory: &std::path::Path,
    backend_requirement: CapabilityRequirement,
) -> (PublishRuntime, PlanningInputSnapshot) {
    fixture_runtime_with_backend(
        store_directory,
        delivery_directory,
        backend_requirement,
        Arc::new(LocalExecutionBackend::new()),
    )
}

fn fixture_runtime_with_backend(
    store_directory: &std::path::Path,
    delivery_directory: &std::path::Path,
    backend_requirement: CapabilityRequirement,
    execution_backend: Arc<dyn publish_adapters::ExecutionBackend>,
) -> (PublishRuntime, PlanningInputSnapshot) {
    fixture_runtime_with_backend_and_destination(
        store_directory,
        delivery_directory,
        backend_requirement,
        execution_backend,
        Arc::new(LocalDirectoryDestination::new(delivery_directory)),
    )
}

fn fixture_runtime_with_destination(
    store_directory: &std::path::Path,
    delivery_directory: &std::path::Path,
    destination: Arc<dyn DeliveryDestination>,
) -> (PublishRuntime, PlanningInputSnapshot) {
    fixture_runtime_with_backend_and_destination(
        store_directory,
        delivery_directory,
        CapabilityRequirement::exact("structured-plan-execution", 1),
        Arc::new(LocalExecutionBackend::new()),
        destination,
    )
}

fn fixture_runtime_with_backend_and_destination(
    store_directory: &std::path::Path,
    delivery_directory: &std::path::Path,
    backend_requirement: CapabilityRequirement,
    execution_backend: Arc<dyn publish_adapters::ExecutionBackend>,
    destination: Arc<dyn DeliveryDestination>,
) -> (PublishRuntime, PlanningInputSnapshot) {
    let snapshot = fixture_snapshot(
        store_directory.to_string_lossy().as_ref(),
        delivery_directory.to_string_lossy().as_ref(),
    );
    let fixture = AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(
            Arc::new(FakeProjectProvider::new(backend_requirement)),
            &fixture,
        )
        .expect("register fake provider");
    registry
        .register_artifact_processor(Arc::new(FakeArtifactProcessor::new()), &fixture)
        .expect("register fake processor");
    registry
        .register_execution_backend(execution_backend, &fixture)
        .expect("register local backend");
    registry
        .register_artifact_store(
            Arc::new(TemporaryArtifactStore::new(store_directory)),
            &fixture,
        )
        .expect("register temporary store");
    registry
        .register_delivery_destination(destination, &fixture)
        .expect("register local directory destination");
    (PublishRuntime::new(registry), snapshot)
}

fn fixture_snapshot(store_directory: &str, delivery_directory: &str) -> PlanningInputSnapshot {
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
        promoted_manifest_digest: None,
        adapters: AdapterSelection {
            project_provider: AdapterBinding::new(
                "project",
                AdapterIdentity::new(AdapterKind::ProjectProvider, "fake-project", 1),
                empty.clone(),
            ),
            artifact_processors: vec![AdapterBinding::new(
                "processor",
                AdapterIdentity::new(AdapterKind::ArtifactProcessor, "fake-verifier", 1),
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
