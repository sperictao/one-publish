use std::collections::BTreeMap;
use std::sync::Arc;

use publish_adapters::{
    AdapterConformanceFixture, AdapterContract, AdapterRegistry, ArtifactStore,
    DeliveryDestination, ExecutionBackend, ProjectProvider,
};
use publish_domain::{
    AdapterBinding, AdapterDescriptor, AdapterIdentity, AdapterKind, AdapterSchema,
    AdapterSelection, AdapterSettings, Capability, CapabilityRequirement, DeliveryRoute,
    PlanNodeTemplate, PlanOperation, PlanStage, PlanningInputSnapshot, PublishingCapability,
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
    ) -> Result<Vec<PlanNodeTemplate>, publish_domain::PublishError> {
        Ok(self.nodes.clone())
    }
}

struct FixtureProjectProvider(FixtureAdapter);
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
            ) -> Result<Vec<PlanNodeTemplate>, publish_domain::PublishError> {
                self.0.plan_fragment(snapshot, settings)
            }
        }
    };
}

delegate_contract!(FixtureProjectProvider);
delegate_contract!(FixtureExecutionBackend);
delegate_contract!(FixtureArtifactStore);
delegate_contract!(FixtureDeliveryDestination);

impl ProjectProvider for FixtureProjectProvider {}
impl ExecutionBackend for FixtureExecutionBackend {}
impl ArtifactStore for FixtureArtifactStore {}
impl DeliveryDestination for FixtureDeliveryDestination {}

#[test]
fn same_snapshot_produces_identical_plan_digest_and_node_order() {
    let snapshot = fixture_snapshot();
    let fixture = AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = AdapterRegistry::new();

    registry
        .register_delivery_destination(
            Arc::new(FixtureDeliveryDestination(fixture_adapter(
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
        .register_project_provider(
            Arc::new(FixtureProjectProvider(fixture_adapter(
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
            Arc::new(FixtureArtifactStore(fixture_adapter(
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
            Arc::new(FixtureExecutionBackend(fixture_adapter(
                AdapterKind::ExecutionBackend,
                "local-execution",
                vec![],
                vec![Capability::new("structured-plan-execution", 1)],
                vec![],
            ))),
            &fixture,
        )
        .expect("register backend");

    let planner = PublishPlanner::new(&registry);
    let first = planner.prepare(&snapshot).expect("prepare first plan");
    let second = planner.prepare(&snapshot).expect("prepare second plan");

    assert_eq!(first, second);
    assert_eq!(
        first
            .nodes
            .iter()
            .map(|node| node.id.as_str())
            .collect::<Vec<_>>(),
        vec!["project.build", "store.persist", "destination.deliver"]
    );
    assert_eq!(first.digest.len(), 64);
}

fn fixture_adapter(
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
        if let PlanOperation::RunProgram { program, .. } = &node.operation {
            descriptor = descriptor.with_allowed_program(program.clone());
        }
    }
    FixtureAdapter { descriptor, nodes }
}

fn fixture_snapshot() -> PlanningInputSnapshot {
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
