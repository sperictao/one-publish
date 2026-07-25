use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use publish_adapters::{
    AdapterConformanceFixture, AdapterContract, AdapterExecutionContext, AdapterExecutionOutput,
    AdapterRegistry, DeliveryDestination, LocalDirectoryDestination, LocalExecutionBackend,
    ProjectProvider, TemporaryArtifactStore,
};
use publish_domain::{
    sha256_hex, AdapterBinding, AdapterDescriptor, AdapterIdentity, AdapterKind, AdapterSchema,
    AdapterSelection, AdapterSettings, ArtifactCandidate, Capability, CapabilityRequirement,
    DeliveryEnvelope, DeliveryReceipt, DeliveryRoute, DeliveryStatus, PlanNode, PlanNodeTemplate,
    PlanRoute, PlanStage, PlanningInputSnapshot, PublishAttemptStatus, PublishError, PublishEvent,
    PublishResource, PublishResourceKind, ReleaseIdentity, SourceSnapshot,
    DELIVERY_RECEIPT_VERSION, PLANNING_INPUT_SNAPSHOT_VERSION, PUBLISH_EVENT_VERSION,
};
use publish_runner_core::{
    reduce_publish_events, AttemptExecutionContext, CancellationSignal, PublishRuntime,
    StartPublishAttempt,
};
use serde_json::Value;

const ARTIFACT_BYTES: &[u8] = b"one-publish cancellation artifact\n";
const CANCELLING_DESTINATION_ID: &str = "cancelling-destination";

/// 统计构建执行次数的 Provider：副作用前取消必须让计数保持为零。
/// 携带取消信号时在构建完成后请求取消，模拟共享阶段执行中的取消。
struct CountingProjectProvider {
    descriptor: AdapterDescriptor,
    executions: Arc<AtomicUsize>,
    cancel_after_build: Option<CancellationSignal>,
}

impl CountingProjectProvider {
    fn new(executions: Arc<AtomicUsize>, cancel_after_build: Option<CancellationSignal>) -> Self {
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
            cancel_after_build,
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
        if let Some(cancellation) = &self.cancel_after_build {
            cancellation.request();
        }
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

/// 直通处理器：只为满足 Artifact Store 的 artifact-verified 能力要求。
struct PassThroughProcessor {
    descriptor: AdapterDescriptor,
}

impl PassThroughProcessor {
    fn new() -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ArtifactProcessor,
                "pass-through-verifier",
                1,
                AdapterSchema::new(1),
                publish_domain::PublishingCapability {
                    provides: vec![Capability::new("artifact-verified", 1)],
                    requires: vec![CapabilityRequirement::exact("artifact-candidate", 1)],
                },
            ),
        }
    }
}

impl AdapterContract for PassThroughProcessor {
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
        Ok(AdapterExecutionOutput::default())
    }
}

impl publish_adapters::ArtifactProcessor for PassThroughProcessor {}

/// 在 publish 节点先完成不可逆远端交付、再请求取消的目标：
/// 模拟取消与不可逆远端边界的竞争（ADR-0011/0041）。
struct CancellingDestination {
    descriptor: AdapterDescriptor,
    cancellation: CancellationSignal,
}

impl CancellingDestination {
    fn new(cancellation: CancellationSignal) -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::DeliveryDestination,
                CANCELLING_DESTINATION_ID,
                1,
                AdapterSchema::new(1),
                publish_domain::PublishingCapability {
                    provides: vec![],
                    requires: vec![CapabilityRequirement::exact("stored-artifact", 1)],
                },
            ),
            cancellation,
        }
    }
}

impl AdapterContract for CancellingDestination {
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
                "stage_cancelling",
                BTreeMap::new(),
            )
            .with_artifact_io(vec!["artifact-manifest".to_string()], vec![]),
            PlanNodeTemplate::adapter_action(
                "publish",
                PlanStage::PublishRoutes,
                "publish_cancelling",
                BTreeMap::new(),
            )
            .with_artifact_io(vec!["artifact-manifest".to_string()], vec![])
            .irreversible(),
        ])
    }

    fn execute_node(
        &self,
        node: &PlanNode,
        context: &AdapterExecutionContext<'_>,
    ) -> Result<AdapterExecutionOutput, PublishError> {
        let manifest = context
            .manifest
            .ok_or(PublishError::MissingArtifactManifest)?;
        if node.stage == PlanStage::StageRoutes {
            return Ok(AdapterExecutionOutput {
                envelopes: vec![DeliveryEnvelope::new(
                    node.binding_id.clone(),
                    manifest.digest.clone(),
                )],
                ..AdapterExecutionOutput::default()
            });
        }
        // 不可逆远端提交已经发生，取消请求只能作用于其后的工作。
        self.cancellation.request();
        Ok(AdapterExecutionOutput {
            receipts: vec![DeliveryReceipt::published(
                sha256_hex(format!("{}:{}", context.attempt_id, node.binding_id).as_bytes()),
                node.binding_id.clone(),
                manifest.digest.clone(),
                format!("cancelling://{}", node.binding_id),
            )],
            ..AdapterExecutionOutput::default()
        })
    }
}

impl DeliveryDestination for CancellingDestination {}

struct CancellationFixture {
    runtime: PublishRuntime,
    snapshot: PlanningInputSnapshot,
    cancellation: CancellationSignal,
    build_executions: Arc<AtomicUsize>,
    _store_dir: tempfile::TempDir,
    _delivery_dir: tempfile::TempDir,
}

fn cancellation_fixture(routes: &[(&str, &str, bool)]) -> CancellationFixture {
    cancellation_fixture_with(routes, false)
}

fn cancellation_fixture_with(
    routes: &[(&str, &str, bool)],
    cancel_after_build: bool,
) -> CancellationFixture {
    let store_dir = tempfile::tempdir().expect("create temporary store");
    let delivery_dir = tempfile::tempdir().expect("create delivery parent");
    let build_executions = Arc::new(AtomicUsize::new(0));
    let cancellation = CancellationSignal::new();

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
            captured_at: "2026-07-25T10:00:00Z".to_string(),
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
                AdapterIdentity::new(AdapterKind::ArtifactProcessor, "pass-through-verifier", 1),
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
            Arc::new(CountingProjectProvider::new(
                Arc::clone(&build_executions),
                cancel_after_build.then(|| cancellation.clone()),
            )),
            &fixture,
        )
        .expect("register counting provider");
    registry
        .register_artifact_processor(Arc::new(PassThroughProcessor::new()), &fixture)
        .expect("register pass-through processor");
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
        .register_delivery_destination(
            Arc::new(CancellingDestination::new(cancellation.clone())),
            &fixture,
        )
        .expect("register cancelling destination");

    CancellationFixture {
        runtime: PublishRuntime::new(registry),
        snapshot,
        cancellation,
        build_executions,
        _store_dir: store_dir,
        _delivery_dir: delivery_dir,
    }
}

fn start_with_context(
    fixture: &CancellationFixture,
    attempt_id: &str,
    context: &AttemptExecutionContext,
) -> Result<publish_domain::PublishAttemptView, PublishError> {
    let prepared = fixture
        .runtime
        .prepare_attempt(&fixture.snapshot)
        .expect("prepare attempt");
    fixture.runtime.start_attempt(
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
        context,
    )
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

/// 副作用前取消：没有任何节点执行，全部路线 Cancelled，尝试整体 Cancelled。
#[test]
fn cancellation_before_side_effects_stops_all_work() {
    let fixture = cancellation_fixture(&[
        ("primary", "local-directory", true),
        ("mirror", "local-directory", false),
    ]);
    fixture.cancellation.request();
    let context = AttemptExecutionContext::at(100).with_cancellation(fixture.cancellation.clone());

    let attempt =
        start_with_context(&fixture, "attempt-cancel-early", &context).expect("finish cancelled");

    assert_eq!(attempt.status, PublishAttemptStatus::Cancelled);
    assert!(attempt.error.is_none());
    assert!(attempt.receipts.is_empty());
    assert!(attempt.manifest.is_none());
    assert_eq!(fixture.build_executions.load(Ordering::SeqCst), 0);
    for route_id in ["primary", "mirror"] {
        let view = route_view(&attempt, route_id);
        assert_eq!(view.status, DeliveryStatus::Cancelled);
        assert!(view.error.is_some());
    }
    assert!(attempt
        .events
        .iter()
        .any(|event| event.kind == "route_cancelled"));
}

/// 执行中取消：已 Published 的路线与其 Receipt 保持不变，
/// 未开始的 Required 路线被取消后按路线语义聚合为 Partial Delivery。
#[test]
fn cancellation_after_a_published_route_keeps_receipts_and_is_partial() {
    let fixture = cancellation_fixture(&[
        ("primary", CANCELLING_DESTINATION_ID, true),
        ("mirror", "local-directory", true),
    ]);
    let context = AttemptExecutionContext::at(100).with_cancellation(fixture.cancellation.clone());

    let attempt = start_with_context(&fixture, "attempt-cancel-partial", &context).expect("finish");

    assert_eq!(attempt.status, PublishAttemptStatus::PartialDelivery);
    let published = route_view(&attempt, "primary");
    assert_eq!(published.status, DeliveryStatus::Published);
    assert!(published.error.is_none());
    assert_eq!(attempt.receipts.len(), 1);
    assert_eq!(attempt.receipts[0].route_id, "primary");
    assert_eq!(attempt.receipts[0].status, DeliveryStatus::Published);

    let cancelled = route_view(&attempt, "mirror");
    assert_eq!(cancelled.status, DeliveryStatus::Cancelled);
    assert!(cancelled
        .error
        .as_deref()
        .is_some_and(|error| error.contains("cancelled")));
    assert!(attempt
        .error
        .as_deref()
        .is_some_and(|error| error.contains("required delivery route mirror")));
    assert_eq!(fixture.build_executions.load(Ordering::SeqCst), 1);
}

/// 全部 Required 路线已发布而 Optional 路线被取消：成功但带警告（ADR-0041）。
#[test]
fn cancelled_optional_routes_after_required_published_only_warn() {
    let fixture = cancellation_fixture(&[
        ("primary", CANCELLING_DESTINATION_ID, true),
        ("mirror", "local-directory", false),
    ]);
    let context = AttemptExecutionContext::at(100).with_cancellation(fixture.cancellation.clone());

    let attempt =
        start_with_context(&fixture, "attempt-cancel-optional", &context).expect("finish");

    assert_eq!(attempt.status, PublishAttemptStatus::Published);
    assert!(attempt.error.is_none());
    assert_eq!(attempt.warnings.len(), 1);
    assert!(attempt.warnings[0].contains("mirror"));
    assert_eq!(
        route_view(&attempt, "primary").status,
        DeliveryStatus::Published
    );
    assert_eq!(
        route_view(&attempt, "mirror").status,
        DeliveryStatus::Cancelled
    );
}

/// 取消与不可逆远端边界竞争：同步回来的交付证据在归约中覆盖取消证据，
/// 最终状态由事件归约确定（ADR-0011/0057）。
#[test]
fn late_delivery_evidence_overrides_cancellation_in_reduction() {
    let manifest_digest = "c".repeat(64);
    let event =
        |sequence: u64, plan_node_id: &str, kind: &str, payload: BTreeMap<String, Value>| {
            PublishEvent {
                version: PUBLISH_EVENT_VERSION,
                event_id: format!("event-{sequence}"),
                attempt_id: "attempt-race".to_string(),
                backend_run_id: "backend-race".to_string(),
                sequence,
                plan_digest: "plan-race".to_string(),
                plan_node_id: plan_node_id.to_string(),
                kind: kind.to_string(),
                payload,
            }
        };
    let events = vec![
        event(
            1,
            "persist-manifest",
            "plan_node_completed",
            BTreeMap::from([(
                "manifest_digest".to_string(),
                Value::String(manifest_digest.clone()),
            )]),
        ),
        // 控制面先观察到取消……
        event(
            2,
            "primary.publish",
            "route_cancelled",
            BTreeMap::from([
                ("route_id".to_string(), Value::String("primary".to_string())),
                (
                    "error".to_string(),
                    Value::String("delivery route primary was cancelled".to_string()),
                ),
            ]),
        ),
        // ……随后同步到不可逆边界之后的真实交付证据。
        event(
            3,
            "primary.publish",
            "delivery_receipt_observed",
            BTreeMap::from([(
                "receipt".to_string(),
                serde_json::json!({
                    "version": DELIVERY_RECEIPT_VERSION,
                    "receipt_id": "receipt-primary",
                    "revision": 1,
                    "route_id": "primary",
                    "manifest_digest": manifest_digest,
                    "status": "published",
                    "external_reference": "remote://primary",
                }),
            )]),
        ),
    ];
    let routes = vec![PlanRoute {
        route_id: "primary".to_string(),
        required: true,
    }];

    let projection = reduce_publish_events(&events, &routes).expect("reduce race events");
    assert_eq!(projection.status, PublishAttemptStatus::Published);
    assert_eq!(projection.routes[0].status, DeliveryStatus::Published);
    assert!(projection.routes[0].error.is_none());
    // 取消的节点没有执行，不产生节点执行状态。
    assert!(
        !projection.node_states.contains_key("primary.publish")
            || projection.node_states.get("primary.publish")
                != Some(&publish_domain::PlanNodeExecutionState::Failed)
    );
}

/// 共享阶段执行中取消：构建节点完成后请求取消，其后的封存与交付不再执行；
/// 无任何交付时尝试整体 Cancelled，而不是 Failed。
#[test]
fn cancellation_during_shared_stages_without_delivery_is_cancelled() {
    let fixture = cancellation_fixture_with(&[("primary", "local-directory", true)], true);
    let context = AttemptExecutionContext::at(100).with_cancellation(fixture.cancellation.clone());

    let attempt = start_with_context(&fixture, "attempt-cancel-shared", &context).expect("finish");
    assert_eq!(attempt.status, PublishAttemptStatus::Cancelled);
    assert!(attempt.manifest.is_none());
    assert!(attempt.receipts.is_empty());
    assert_eq!(fixture.build_executions.load(Ordering::SeqCst), 1);
    assert_eq!(
        route_view(&attempt, "primary").status,
        DeliveryStatus::Cancelled
    );
}

/// 单路线在不可逆边界后取消：交付证据已经存在，尝试仍是 Published。
#[test]
fn cancellation_after_the_only_route_published_is_still_published() {
    let fixture = cancellation_fixture(&[("primary", CANCELLING_DESTINATION_ID, true)]);
    let context = AttemptExecutionContext::at(100).with_cancellation(fixture.cancellation.clone());

    let attempt = start_with_context(&fixture, "attempt-cancel-late", &context).expect("finish");

    assert_eq!(attempt.status, PublishAttemptStatus::Published);
    assert!(attempt.warnings.is_empty());
    assert_eq!(attempt.receipts.len(), 1);
}

/// 租约过期的 Attempt 在任何副作用前明确失败（ADR-0042：租约丢失不得继续）。
#[test]
fn an_attempt_with_an_expired_lease_fails_before_side_effects() {
    let fixture = cancellation_fixture(&[("primary", "local-directory", true)]);
    fixture
        .runtime
        .leases()
        .acquire(
            "attempt-lease-lost",
            BTreeSet::from([PublishResource::new(
                PublishResourceKind::RepositoryWrite,
                "acme/app",
            )]),
            100,
            60,
        )
        .expect("acquire a short lease");

    let error = start_with_context(
        &fixture,
        "attempt-lease-lost",
        &AttemptExecutionContext::at(200),
    )
    .expect_err("expired ownership must fail explicitly");
    assert!(matches!(error, PublishError::LeaseLost { .. }));
    assert_eq!(fixture.build_executions.load(Ordering::SeqCst), 0);
}

/// 持有活跃租约的 Attempt 正常执行；完成后由调用方释放。
#[test]
fn an_attempt_with_an_active_lease_runs_to_completion() {
    let fixture = cancellation_fixture(&[("primary", "local-directory", true)]);
    fixture
        .runtime
        .leases()
        .acquire(
            "attempt-leased",
            BTreeSet::from([PublishResource::new(
                PublishResourceKind::RepositoryWrite,
                "acme/app",
            )]),
            100,
            600,
        )
        .expect("acquire");

    let attempt = start_with_context(
        &fixture,
        "attempt-leased",
        &AttemptExecutionContext::at(150),
    )
    .expect("run with an active lease");
    assert_eq!(attempt.status, PublishAttemptStatus::Published);
    fixture
        .runtime
        .leases()
        .release("attempt-leased")
        .expect("release after completion");
}
