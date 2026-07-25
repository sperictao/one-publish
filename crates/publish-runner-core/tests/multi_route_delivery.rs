use std::collections::BTreeMap;
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
    DeliveryRoute, DeliveryStatus, PlanNode, PlanNodeTemplate, PlanStage, PlanningInputSnapshot,
    PublishAttemptStatus, PublishError, ReleaseIdentity, SourceSnapshot,
    PLANNING_INPUT_SNAPSHOT_VERSION,
};
use publish_runner_core::{PublishRuntime, StartPublishAttempt};
use serde_json::Value;

const ARTIFACT_BYTES: &[u8] = b"one-publish multi-route artifact\n";
const FAILING_DESTINATION_ID: &str = "failing-destination";

/// 统计构建执行次数的 Provider：多路线交付必须复用同一次构建（ADR-0022）。
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
                PublishingCapabilityFixture::provider(),
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
        _node: &PlanNode,
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

/// 统计执行次数的处理器：处理阶段同样不因多路线而重复运行。
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
                PublishingCapabilityFixture::processor(),
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
        _node: &PlanNode,
        _context: &AdapterExecutionContext<'_>,
    ) -> Result<AdapterExecutionOutput, PublishError> {
        self.executions.fetch_add(1, Ordering::SeqCst);
        Ok(AdapterExecutionOutput::default())
    }
}

impl ArtifactProcessor for CountingArtifactProcessor {}

/// 在 StageRoutes 节点直接失败的交付目标：验证路线隔离与后续节点跳过。
struct FailingDestination {
    descriptor: AdapterDescriptor,
}

impl FailingDestination {
    fn new() -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::DeliveryDestination,
                FAILING_DESTINATION_ID,
                1,
                AdapterSchema::new(1),
                PublishingCapabilityFixture::destination(),
            ),
        }
    }
}

impl AdapterContract for FailingDestination {
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
                "stage_failing",
                BTreeMap::new(),
            )
            .with_artifact_io(vec!["artifact-manifest".to_string()], vec![]),
            PlanNodeTemplate::adapter_action(
                "publish",
                PlanStage::PublishRoutes,
                "publish_failing",
                BTreeMap::new(),
            )
            .with_artifact_io(vec!["artifact-manifest".to_string()], vec![]),
        ])
    }

    fn execute_node(
        &self,
        node: &PlanNode,
        _context: &AdapterExecutionContext<'_>,
    ) -> Result<AdapterExecutionOutput, PublishError> {
        Err(PublishError::Execution(format!(
            "simulated delivery failure at {}",
            node.id
        )))
    }
}

impl DeliveryDestination for FailingDestination {}

struct PublishingCapabilityFixture;

impl PublishingCapabilityFixture {
    fn provider() -> publish_domain::PublishingCapability {
        publish_domain::PublishingCapability {
            provides: vec![Capability::new("artifact-candidate", 1)],
            requires: vec![CapabilityRequirement::exact("structured-plan-execution", 1)],
        }
    }

    fn processor() -> publish_domain::PublishingCapability {
        publish_domain::PublishingCapability {
            provides: vec![Capability::new("artifact-verified", 1)],
            requires: vec![CapabilityRequirement::exact("artifact-candidate", 1)],
        }
    }

    fn destination() -> publish_domain::PublishingCapability {
        publish_domain::PublishingCapability {
            provides: vec![],
            requires: vec![CapabilityRequirement::exact("stored-artifact", 1)],
        }
    }
}

struct MultiRouteFixture {
    runtime: PublishRuntime,
    snapshot: PlanningInputSnapshot,
    build_executions: Arc<AtomicUsize>,
    processor_executions: Arc<AtomicUsize>,
    _store_dir: tempfile::TempDir,
    _delivery_dir: tempfile::TempDir,
}

/// 组装一份双路线运行时：路线由 (destination adapter id, required) 描述，
/// local-directory 路线各自使用独立交付目录。
fn multi_route_fixture(routes: &[(&str, &str, bool)]) -> MultiRouteFixture {
    let store_dir = tempfile::tempdir().expect("create temporary store");
    let delivery_dir = tempfile::tempdir().expect("create delivery parent");
    let build_executions = Arc::new(AtomicUsize::new(0));
    let processor_executions = Arc::new(AtomicUsize::new(0));

    let delivery_routes = routes
        .iter()
        .map(|(route_id, adapter_id, required)| {
            let settings = if *adapter_id == "local-directory" {
                AdapterSettings::new(1).with_value(
                    "directory",
                    Value::String(
                        delivery_dir
                            .path()
                            .join(route_id)
                            .to_string_lossy()
                            .to_string(),
                    ),
                )
            } else {
                AdapterSettings::new(1)
            };
            DeliveryRoute {
                binding: AdapterBinding::new(
                    route_id.to_string(),
                    AdapterIdentity::new(AdapterKind::DeliveryDestination, *adapter_id, 1),
                    settings,
                ),
                required: *required,
            }
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
            Arc::new(LocalDirectoryDestination::new(delivery_dir.path())),
            &fixture,
        )
        .expect("register local directory destination");
    registry
        .register_delivery_destination(Arc::new(FailingDestination::new()), &fixture)
        .expect("register failing destination");

    MultiRouteFixture {
        runtime: PublishRuntime::new(registry),
        snapshot,
        build_executions,
        processor_executions,
        _store_dir: store_dir,
        _delivery_dir: delivery_dir,
    }
}

fn start_fixture_attempt(
    fixture: &MultiRouteFixture,
    attempt_id: &str,
) -> publish_domain::PublishAttemptView {
    let prepared = fixture
        .runtime
        .prepare_attempt(&fixture.snapshot)
        .expect("prepare multi-route attempt");
    fixture
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
        )
        .expect("start multi-route attempt")
}

fn route_view<'a>(
    attempt: &'a publish_domain::PublishAttemptView,
    route_id: &str,
) -> &'a publish_domain::RouteDeliveryView {
    attempt
        .routes
        .iter()
        .find(|view| view.route_id == route_id)
        .unwrap_or_else(|| panic!("route view {route_id} missing"))
}

#[test]
fn all_routes_published_share_one_build_and_one_sealed_manifest() {
    let fixture = multi_route_fixture(&[
        ("primary", "local-directory", true),
        ("mirror", "local-directory", false),
    ]);
    let prepared = fixture
        .runtime
        .prepare_attempt(&fixture.snapshot)
        .expect("prepare multi-route plan");

    // 计划层面：路线合同封存，且路线节点只依赖共享前缀与本路线前驱。
    assert_eq!(
        prepared
            .plan
            .routes
            .iter()
            .map(|route| (route.route_id.as_str(), route.required))
            .collect::<Vec<_>>(),
        vec![("primary", true), ("mirror", false)]
    );
    let persist_id = &prepared
        .plan
        .nodes
        .iter()
        .find(|node| node.stage == PlanStage::PersistManifest)
        .expect("persist node")
        .id;
    let node =
        |id: &str| -> &PlanNode { prepared.plan.nodes.iter().find(|n| n.id == id).expect(id) };
    assert_eq!(node("primary.stage").depends_on, vec![persist_id.clone()]);
    assert_eq!(node("mirror.stage").depends_on, vec![persist_id.clone()]);
    assert_eq!(
        node("primary.publish").depends_on,
        vec!["primary.stage".to_string()]
    );
    assert_eq!(
        node("mirror.publish").depends_on,
        vec!["mirror.stage".to_string()]
    );

    let attempt = start_fixture_attempt(&fixture, "attempt-all-published");

    assert_eq!(attempt.status, PublishAttemptStatus::Published);
    assert!(attempt.error.is_none());
    assert!(attempt.warnings.is_empty());

    // 多路线共享同一 Manifest digest，不触发重复构建或重复处理。
    let manifest_digest = attempt
        .manifest
        .as_ref()
        .expect("sealed manifest")
        .digest
        .clone();
    assert_eq!(attempt.receipts.len(), 2);
    assert!(attempt
        .receipts
        .iter()
        .all(|receipt| receipt.manifest_digest == manifest_digest
            && receipt.status == DeliveryStatus::Published));
    assert_eq!(fixture.build_executions.load(Ordering::SeqCst), 1);
    assert_eq!(fixture.processor_executions.load(Ordering::SeqCst), 1);
    assert_eq!(
        attempt
            .events
            .iter()
            .filter(|event| event.kind == "plan_node_completed"
                && event.payload.contains_key("manifest_digest"))
            .count(),
        1,
        "the artifact manifest must be sealed exactly once"
    );

    for route_id in ["primary", "mirror"] {
        let view = route_view(&attempt, route_id);
        assert_eq!(view.status, DeliveryStatus::Published);
        assert!(view.error.is_none());
        assert!(view
            .external_reference
            .as_deref()
            .is_some_and(|reference| reference.contains(route_id)));
    }
}

#[test]
fn required_route_failure_with_one_success_is_partial_delivery() {
    let fixture = multi_route_fixture(&[
        ("primary", FAILING_DESTINATION_ID, true),
        ("mirror", "local-directory", false),
    ]);

    let attempt = start_fixture_attempt(&fixture, "attempt-partial");

    assert_eq!(attempt.status, PublishAttemptStatus::PartialDelivery);
    assert!(attempt
        .error
        .as_deref()
        .is_some_and(|error| error.contains("required delivery route primary")
            && error.contains("simulated delivery failure")));

    let failed = route_view(&attempt, "primary");
    assert_eq!(failed.status, DeliveryStatus::Failed);
    assert!(failed
        .error
        .as_deref()
        .is_some_and(|error| error.contains("simulated delivery failure at primary.stage")));
    assert!(failed.external_reference.is_none());

    // 已发布路线的不可变结果不被 Required 失败否定。
    let published = route_view(&attempt, "mirror");
    assert_eq!(published.status, DeliveryStatus::Published);
    assert!(published.error.is_none());
    assert_eq!(attempt.receipts.len(), 1);
    assert_eq!(attempt.receipts[0].route_id, "mirror");

    // 失败路线的后续节点被跳过：publish 节点不再执行、没有它的任何事件。
    assert!(attempt
        .events
        .iter()
        .all(|event| event.plan_node_id != "primary.publish"));
    assert!(attempt
        .events
        .iter()
        .any(|event| event.kind == "route_failed"
            && event.payload.get("route_id").and_then(Value::as_str) == Some("primary")));
    assert_eq!(fixture.build_executions.load(Ordering::SeqCst), 1);
}

#[test]
fn optional_route_failure_only_warns_and_keeps_published_result() {
    let fixture = multi_route_fixture(&[
        ("primary", "local-directory", true),
        ("mirror", FAILING_DESTINATION_ID, false),
    ]);

    let attempt = start_fixture_attempt(&fixture, "attempt-optional-failure");

    assert_eq!(attempt.status, PublishAttemptStatus::Published);
    assert!(attempt.error.is_none());
    assert_eq!(attempt.warnings.len(), 1);
    assert!(attempt.warnings[0].contains("optional delivery route mirror"));

    let published = route_view(&attempt, "primary");
    assert_eq!(published.status, DeliveryStatus::Published);
    let failed = route_view(&attempt, "mirror");
    assert_eq!(failed.status, DeliveryStatus::Failed);
    assert!(failed.error.is_some());
    assert_eq!(attempt.receipts.len(), 1);
    assert_eq!(attempt.receipts[0].route_id, "primary");
}

#[test]
fn all_routes_failing_is_a_failed_attempt_with_route_errors() {
    let fixture = multi_route_fixture(&[
        ("primary", FAILING_DESTINATION_ID, true),
        ("mirror", FAILING_DESTINATION_ID, false),
    ]);

    let attempt = start_fixture_attempt(&fixture, "attempt-all-failed");

    assert_eq!(attempt.status, PublishAttemptStatus::Failed);
    assert!(attempt
        .error
        .as_deref()
        .is_some_and(|error| error.contains("required delivery route primary")));
    assert!(attempt.receipts.is_empty());
    // 构建与封存仍然只发生一次，Manifest 保留供重试路线复用（ADR-0038）。
    assert!(attempt.manifest.is_some());
    assert_eq!(fixture.build_executions.load(Ordering::SeqCst), 1);
    assert!(attempt
        .routes
        .iter()
        .all(|view| view.status == DeliveryStatus::Failed && view.error.is_some()));
    assert_eq!(attempt.warnings.len(), 1);
    assert!(attempt.warnings[0].contains("optional delivery route mirror"));
}

/// 纯事件投影层的聚合边界：只有 Published 满足 Required Route（ADR-0039），
/// 而未完结的 Optional Route 不阻止已满足的 Required 结果聚合为 Published。
#[test]
fn staged_routes_never_satisfy_required_but_do_not_block_published_optionals() {
    use publish_domain::{PlanRoute, PublishEvent, DELIVERY_RECEIPT_VERSION};

    let manifest_digest = "c".repeat(64);
    let receipt_event =
        |sequence: u64, receipt_id: &str, route_id: &str, status: DeliveryStatus| PublishEvent {
            version: publish_domain::PUBLISH_EVENT_VERSION,
            event_id: format!("event-{sequence}"),
            attempt_id: "attempt-staged".to_string(),
            backend_run_id: "backend-staged".to_string(),
            sequence,
            plan_digest: "plan-staged".to_string(),
            plan_node_id: "publish-routes".to_string(),
            kind: "delivery_receipt_observed".to_string(),
            payload: BTreeMap::from([(
                "receipt".to_string(),
                serde_json::json!({
                    "version": DELIVERY_RECEIPT_VERSION,
                    "receipt_id": receipt_id,
                    "revision": 1,
                    "route_id": route_id,
                    "manifest_digest": manifest_digest,
                    "status": status,
                    "external_reference": format!("local://{receipt_id}"),
                }),
            )]),
        };
    let manifest_event = PublishEvent {
        version: publish_domain::PUBLISH_EVENT_VERSION,
        event_id: "event-1".to_string(),
        attempt_id: "attempt-staged".to_string(),
        backend_run_id: "backend-staged".to_string(),
        sequence: 1,
        plan_digest: "plan-staged".to_string(),
        plan_node_id: "persist-manifest".to_string(),
        kind: "plan_node_completed".to_string(),
        payload: BTreeMap::from([(
            "manifest_digest".to_string(),
            serde_json::Value::String(manifest_digest.clone()),
        )]),
    };
    let routes = vec![
        PlanRoute {
            route_id: "primary".to_string(),
            required: true,
        },
        PlanRoute {
            route_id: "mirror".to_string(),
            required: false,
        },
    ];

    // Required 停在 Staged：上传或 Staged 不等同于成功，聚合保持 Running。
    let required_staged = vec![
        manifest_event.clone(),
        receipt_event(2, "receipt-primary", "primary", DeliveryStatus::Staged),
        receipt_event(3, "receipt-mirror", "mirror", DeliveryStatus::Published),
    ];
    let projection = publish_runner_core::reduce_publish_events(&required_staged, &routes)
        .expect("reduce required-staged events");
    assert_eq!(projection.status, PublishAttemptStatus::Running);

    // Optional 停在 Staged：不阻止全部 Required 已发布的结果。
    let optional_staged = vec![
        manifest_event,
        receipt_event(2, "receipt-primary", "primary", DeliveryStatus::Published),
        receipt_event(3, "receipt-mirror", "mirror", DeliveryStatus::Staged),
    ];
    let projection = publish_runner_core::reduce_publish_events(&optional_staged, &routes)
        .expect("reduce optional-staged events");
    assert_eq!(projection.status, PublishAttemptStatus::Published);
    assert!(projection.warnings.is_empty());
    assert_eq!(projection.routes[1].status, DeliveryStatus::Staged);
}
