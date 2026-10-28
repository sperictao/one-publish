use std::collections::BTreeMap;
use std::sync::Arc;

use publish_adapters::{
    AdapterConformanceFixture, AdapterContract, AdapterRegistry, ArtifactProcessor, ArtifactStore,
    DeliveryDestination, ExecutionBackend, ProjectProvider,
};
use publish_domain::{
    AdapterBinding, AdapterDescriptor, AdapterIdentity, AdapterKind, AdapterSchema,
    AdapterSelection, AdapterSettings, Capability, CapabilityRequirement, DeliveryRoute,
    PlanNodeTemplate, PlanStage, PlanningInputSnapshot, PublishError, PublishingCapability,
    SourceSnapshot, PLANNING_INPUT_SNAPSHOT_VERSION,
};
use publish_planner::PublishPlanner;

#[derive(Clone)]
struct FixtureAdapter {
    descriptor: AdapterDescriptor,
    nodes: Vec<PlanNodeTemplate>,
}

impl AdapterContract for FixtureAdapter {
    fn descriptor(&self) -> &AdapterDescriptor {
        &self.descriptor
    }

    fn default_settings(&self) -> AdapterSettings {
        AdapterSettings::new(self.descriptor.schema.version)
    }

    fn plan_fragment(
        &self,
        _snapshot: &PlanningInputSnapshot,
        _settings: &AdapterSettings,
    ) -> Result<Vec<PlanNodeTemplate>, PublishError> {
        Ok(self.nodes.clone())
    }
}

struct FixtureProjectProvider(FixtureAdapter);
struct FixtureArtifactProcessor(FixtureAdapter);
struct FixtureExecutionBackend(FixtureAdapter);
struct FixtureArtifactStore(FixtureAdapter);
struct FixtureDeliveryDestination(FixtureAdapter);

macro_rules! delegate_contract {
    ($type:ty) => {
        impl AdapterContract for $type {
            fn descriptor(&self) -> &AdapterDescriptor {
                self.0.descriptor()
            }

            fn default_settings(&self) -> AdapterSettings {
                self.0.default_settings()
            }

            fn plan_fragment(
                &self,
                snapshot: &PlanningInputSnapshot,
                settings: &AdapterSettings,
            ) -> Result<Vec<PlanNodeTemplate>, PublishError> {
                self.0.plan_fragment(snapshot, settings)
            }
        }
    };
}

delegate_contract!(FixtureProjectProvider);
delegate_contract!(FixtureArtifactProcessor);
delegate_contract!(FixtureExecutionBackend);
delegate_contract!(FixtureArtifactStore);
delegate_contract!(FixtureDeliveryDestination);

impl ProjectProvider for FixtureProjectProvider {}
impl ArtifactProcessor for FixtureArtifactProcessor {}
impl ExecutionBackend for FixtureExecutionBackend {}
impl DeliveryDestination for FixtureDeliveryDestination {}

/// 计划守卫 fixture 不落盘：保留与租约操作在这里不可达。
impl ArtifactStore for FixtureArtifactStore {
    fn acquire_artifact_set_lease(
        &self,
        _settings: &AdapterSettings,
        _attempt_id: &str,
        _manifest_digest: &str,
        _valid_until: &str,
    ) -> Result<(), PublishError> {
        Err(PublishError::Execution(
            "fixture artifact store does not manage leases".to_string(),
        ))
    }

    fn release_artifact_set_lease(
        &self,
        _settings: &AdapterSettings,
        _attempt_id: &str,
    ) -> Result<(), PublishError> {
        Err(PublishError::Execution(
            "fixture artifact store does not manage leases".to_string(),
        ))
    }

    fn enforce_retention(
        &self,
        _settings: &AdapterSettings,
        _now: &str,
    ) -> Result<publish_adapters::RetentionSweepReport, PublishError> {
        Err(PublishError::Execution(
            "fixture artifact store does not manage retention".to_string(),
        ))
    }
}

fn adapter(
    kind: AdapterKind,
    id: &str,
    requires: Vec<CapabilityRequirement>,
    provides: Vec<Capability>,
    nodes: Vec<PlanNodeTemplate>,
) -> FixtureAdapter {
    let mut descriptor = AdapterDescriptor::new(
        kind,
        id,
        1,
        AdapterSchema::new(1),
        PublishingCapability { provides, requires },
    );
    for node in &nodes {
        if let publish_domain::PlanOperation::RunProgram { program, .. } = &node.operation {
            descriptor = descriptor.with_allowed_program(program.clone());
        }
    }
    FixtureAdapter { descriptor, nodes }
}

fn base_snapshot() -> PlanningInputSnapshot {
    let settings = AdapterSettings::new(1);
    PlanningInputSnapshot {
        version: PLANNING_INPUT_SNAPSHOT_VERSION,
        configuration_revision: "config-revision-1".to_string(),
        runtime_revision: "runner-1".to_string(),
        release_input: BTreeMap::from([(
            "version".to_string(),
            serde_json::Value::String("1.0.0".to_string()),
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
                settings.clone(),
            ),
            artifact_processors: vec![],
            execution_backend: AdapterBinding::new(
                "backend",
                AdapterIdentity::new(AdapterKind::ExecutionBackend, "local-execution", 1),
                settings.clone(),
            ),
            artifact_store: AdapterBinding::new(
                "store",
                AdapterIdentity::new(AdapterKind::ArtifactStore, "temporary-store", 1),
                settings.clone(),
            ),
            delivery_routes: vec![DeliveryRoute::required(AdapterBinding::new(
                "destination",
                AdapterIdentity::new(AdapterKind::DeliveryDestination, "local-directory", 1),
                settings,
            ))],
        },
    }
}

/// 标准注册组：provider→store→destination 能力链 + 本地执行后端。
fn base_registry(snapshot: &PlanningInputSnapshot) -> AdapterRegistry {
    let fixture = AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(
            Arc::new(FixtureProjectProvider(adapter(
                AdapterKind::ProjectProvider,
                "fake-project",
                vec![CapabilityRequirement::exact("structured-plan-execution", 1)],
                vec![Capability::new("artifact-candidate", 1)],
                vec![PlanNodeTemplate::command(
                    "build",
                    PlanStage::Build,
                    "fixture:fake-build",
                    vec!["--release".to_string()],
                )],
            ))),
            &fixture,
        )
        .expect("register provider");
    registry
        .register_artifact_store(
            Arc::new(FixtureArtifactStore(adapter(
                AdapterKind::ArtifactStore,
                "temporary-store",
                vec![CapabilityRequirement::exact("artifact-candidate", 1)],
                vec![Capability::new("stored-artifact", 1)],
                vec![PlanNodeTemplate::adapter_action(
                    "persist",
                    PlanStage::PersistManifest,
                    "persist_manifest",
                    BTreeMap::new(),
                )],
            ))),
            &fixture,
        )
        .expect("register store");
    registry
        .register_execution_backend(
            Arc::new(FixtureExecutionBackend(adapter(
                AdapterKind::ExecutionBackend,
                "local-execution",
                vec![],
                vec![Capability::new("structured-plan-execution", 1)],
                vec![],
            ))),
            &fixture,
        )
        .expect("register backend");
    registry
        .register_delivery_destination(
            Arc::new(FixtureDeliveryDestination(adapter(
                AdapterKind::DeliveryDestination,
                "local-directory",
                vec![CapabilityRequirement::exact("stored-artifact", 1)],
                vec![],
                vec![PlanNodeTemplate::adapter_action(
                    "deliver",
                    PlanStage::PublishRoutes,
                    "publish_local_directory",
                    BTreeMap::new(),
                )],
            ))),
            &fixture,
        )
        .expect("register destination");
    registry
}

#[test]
fn unsupported_snapshot_version_is_rejected() {
    let mut snapshot = base_snapshot();
    snapshot.version = PLANNING_INPUT_SNAPSHOT_VERSION + 1;
    let registry = base_registry(&snapshot);
    let err = PublishPlanner::new(&registry)
        .prepare(&snapshot)
        .expect_err("must reject unsupported version");
    assert_eq!(
        err,
        PublishError::UnsupportedSnapshotVersion {
            actual: PLANNING_INPUT_SNAPSHOT_VERSION + 1,
            expected: PLANNING_INPUT_SNAPSHOT_VERSION,
        }
    );
}

#[test]
fn non_sha256_promoted_manifest_digest_is_rejected() {
    let mut snapshot = base_snapshot();
    snapshot.promoted_manifest_digest = Some("not-a-digest".to_string());
    let registry = base_registry(&snapshot);
    let err = PublishPlanner::new(&registry)
        .prepare(&snapshot)
        .expect_err("must reject malformed digest");
    match err {
        PublishError::InvalidPlan(message) => {
            assert!(message.contains("SHA-256"), "unexpected message: {message}");
        }
        other => panic!("expected InvalidPlan, got {other:?}"),
    }
}

#[test]
fn empty_delivery_routes_are_rejected() {
    let mut snapshot = base_snapshot();
    snapshot.adapters.delivery_routes.clear();
    let registry = base_registry(&snapshot);
    let err = PublishPlanner::new(&registry)
        .prepare(&snapshot)
        .expect_err("must reject empty routes");
    match err {
        PublishError::InvalidPlan(message) => {
            assert!(
                message.contains("delivery route"),
                "unexpected message: {message}"
            );
        }
        other => panic!("expected InvalidPlan, got {other:?}"),
    }
}

/// ADR-0040：promotion 复用既有 manifest 时 provider/processor 不贡献节点，
/// 但绑定仍须通过能力与设置校验。
#[test]
fn promotion_skips_provider_and_processor_nodes_but_keeps_routes() {
    let mut snapshot = base_snapshot();
    snapshot.promoted_manifest_digest = Some("a".repeat(64));

    // 追加一个 artifact processor 绑定与注册——它同样应在 promotion 下被跳过。
    let settings = AdapterSettings::new(1);
    snapshot.adapters.artifact_processors = vec![AdapterBinding::new(
        "processor",
        AdapterIdentity::new(AdapterKind::ArtifactProcessor, "fake-processor", 1),
        settings,
    )];

    let fixture = AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = base_registry(&snapshot);
    registry
        .register_artifact_processor(
            Arc::new(FixtureArtifactProcessor(adapter(
                AdapterKind::ArtifactProcessor,
                "fake-processor",
                vec![CapabilityRequirement::exact("artifact-candidate", 1)],
                vec![Capability::new("processed-artifact", 1)],
                vec![PlanNodeTemplate::adapter_action(
                    "sign",
                    PlanStage::ProcessArtifacts,
                    "sign_artifact",
                    BTreeMap::new(),
                )
                .with_artifact_io(
                    vec!["artifact:*".to_string()],
                    vec!["processed-artifact".to_string()],
                )],
            ))),
            &fixture,
        )
        .expect("register processor");

    let plan = PublishPlanner::new(&registry)
        .prepare(&snapshot)
        .expect("promotion plan must still seal");
    let ids = plan
        .nodes
        .iter()
        .map(|node| node.id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(ids, vec!["store.persist", "destination.deliver"]);
}

/// ADR-0022：路线节点只链接同一路线前驱或共享前缀末节点——
/// 一条路线的失败不得经依赖链阻断其它路线。
#[test]
fn multi_route_nodes_depend_on_shared_prefix_not_sibling_routes() {
    let mut snapshot = base_snapshot();
    let settings = AdapterSettings::new(1);
    snapshot.adapters.delivery_routes = vec![
        DeliveryRoute::required(AdapterBinding::new(
            "route-a",
            AdapterIdentity::new(AdapterKind::DeliveryDestination, "local-directory", 1),
            settings.clone(),
        )),
        DeliveryRoute::required(AdapterBinding::new(
            "route-b",
            AdapterIdentity::new(AdapterKind::DeliveryDestination, "local-directory", 1),
            settings,
        )),
    ];

    let registry = base_registry(&snapshot);
    let plan = PublishPlanner::new(&registry)
        .prepare(&snapshot)
        .expect("multi-route plan");

    let route_a = plan
        .nodes
        .iter()
        .find(|node| node.id == "route-a.deliver")
        .expect("route-a node");
    let route_b = plan
        .nodes
        .iter()
        .find(|node| node.id == "route-b.deliver")
        .expect("route-b node");

    // 两条路线的前驱都是共享链末节点 store.persist，互不依赖。
    assert_eq!(route_a.depends_on, vec!["store.persist".to_string()]);
    assert_eq!(route_b.depends_on, vec!["store.persist".to_string()]);
}

/// 节点 id 为 `{binding_id}.{local_id}`——两个不同 binding 复用同一
/// binding_id 且产出同 local_id 模板时，compose 期必然碰撞（注册期
/// conformance 只校验单 adapter 内模板唯一，跨 binding 冲突由 planner 拦下）。
#[test]
fn colliding_binding_ids_across_selection_are_rejected() {
    let mut snapshot = base_snapshot();
    // store 绑定复用 provider 的 binding_id，两个 "dup.build" 必然冲突。
    snapshot.adapters.artifact_store = AdapterBinding::new(
        "project",
        AdapterIdentity::new(AdapterKind::ArtifactStore, "temporary-store", 1),
        AdapterSettings::new(1),
    );
    // store adapter 也产出名为 build 的节点模板 → 与 project.build 撞 id。
    let snapshot = snapshot;
    let fixture = AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(
            Arc::new(FixtureProjectProvider(adapter(
                AdapterKind::ProjectProvider,
                "fake-project",
                vec![CapabilityRequirement::exact("structured-plan-execution", 1)],
                vec![Capability::new("artifact-candidate", 1)],
                vec![PlanNodeTemplate::command(
                    "build",
                    PlanStage::Build,
                    "fixture:fake-build",
                    vec![],
                )],
            ))),
            &fixture,
        )
        .expect("register provider");
    registry
        .register_artifact_store(
            Arc::new(FixtureArtifactStore(adapter(
                AdapterKind::ArtifactStore,
                "temporary-store",
                vec![CapabilityRequirement::exact("artifact-candidate", 1)],
                vec![Capability::new("stored-artifact", 1)],
                vec![PlanNodeTemplate::adapter_action(
                    "build",
                    PlanStage::PersistManifest,
                    "persist_manifest",
                    BTreeMap::new(),
                )],
            ))),
            &fixture,
        )
        .expect("register store");
    registry
        .register_execution_backend(
            Arc::new(FixtureExecutionBackend(adapter(
                AdapterKind::ExecutionBackend,
                "local-execution",
                vec![],
                vec![Capability::new("structured-plan-execution", 1)],
                vec![],
            ))),
            &fixture,
        )
        .expect("register backend");
    registry
        .register_delivery_destination(
            Arc::new(FixtureDeliveryDestination(adapter(
                AdapterKind::DeliveryDestination,
                "local-directory",
                vec![CapabilityRequirement::exact("stored-artifact", 1)],
                vec![],
                vec![PlanNodeTemplate::adapter_action(
                    "deliver",
                    PlanStage::PublishRoutes,
                    "publish_local_directory",
                    BTreeMap::new(),
                )],
            ))),
            &fixture,
        )
        .expect("register destination");

    let err = PublishPlanner::new(&registry)
        .prepare(&snapshot)
        .expect_err("colliding node ids must be rejected");
    match err {
        PublishError::InvalidPlan(message) => {
            assert!(
                message.contains("not unique"),
                "unexpected message: {message}"
            );
        }
        other => panic!("expected InvalidPlan, got {other:?}"),
    }
}
