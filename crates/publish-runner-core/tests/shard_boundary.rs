//! 分片执行入口的边界守卫（决议 #85/#88）：准备好的计划在分片启动前必须
//! 仍与其规划快照一致，尝试身份不得为空——两者都在交付副作用之前失败。

use std::collections::BTreeMap;
use std::sync::Arc;

use publish_adapters::{
    AdapterConformanceFixture, AdapterContract, AdapterExecutionContext, AdapterExecutionOutput,
    AdapterRegistry, ArtifactProcessor, LocalDirectoryDestination, LocalExecutionBackend,
    ProjectProvider, TemporaryArtifactStore,
};
use publish_domain::{
    AdapterBinding, AdapterDescriptor, AdapterIdentity, AdapterKind, AdapterSchema,
    AdapterSelection, AdapterSettings, ArtifactCandidate, Capability, CapabilityRequirement,
    DeliveryRoute, PlanNode, PlanNodePlatform, PlanNodeTemplate, PlanStage, PlanningInputSnapshot,
    PublishError, PublishingCapability, SourceSnapshot, PLANNING_INPUT_SNAPSHOT_VERSION,
};
use publish_runner_core::{PreparedPublishPlan, PublishRuntime, ShardHandoff};
use serde_json::Value;

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
    ) -> Result<Vec<PlanNodeTemplate>, PublishError> {
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
    ) -> Result<AdapterExecutionOutput, PublishError> {
        Ok(AdapterExecutionOutput {
            artifacts: vec![ArtifactCandidate::new(
                "desktop-installer",
                "app.bin",
                "application/octet-stream",
                "test-os",
                "test-arch",
                b"one-publish fake artifact\n".to_vec(),
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

impl ArtifactProcessor for FakeArtifactProcessor {}

fn fixture_runtime(
    store_directory: &std::path::Path,
    delivery_directory: &std::path::Path,
) -> (PublishRuntime, PlanningInputSnapshot) {
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
            captured_at: "2026-07-26T10:00:00Z".to_string(),
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
                empty.clone(),
            ),
            artifact_store: AdapterBinding::new(
                "store",
                AdapterIdentity::new(AdapterKind::ArtifactStore, "temporary-artifact-store", 1),
                AdapterSettings::new(1)
                    .with_value(
                        "root_directory",
                        Value::String(store_directory.to_string_lossy().to_string()),
                    )
                    .with_value("retention_seconds", Value::from(604_800u64)),
            ),
            delivery_routes: vec![DeliveryRoute::required(AdapterBinding::new(
                "destination",
                AdapterIdentity::new(AdapterKind::DeliveryDestination, "local-directory", 1),
                empty.with_value(
                    "directory",
                    Value::String(delivery_directory.to_string_lossy().to_string()),
                ),
            ))],
        },
    };
    let fixture = AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(
            Arc::new(FakeProjectProvider::new(CapabilityRequirement::exact(
                "structured-plan-execution",
                1,
            ))),
            &fixture,
        )
        .expect("register fake provider");
    registry
        .register_artifact_processor(Arc::new(FakeArtifactProcessor::new()), &fixture)
        .expect("register fake processor");
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
        .register_delivery_destination(
            Arc::new(LocalDirectoryDestination::new(delivery_directory)),
            &fixture,
        )
        .expect("register local directory destination");
    (PublishRuntime::new(registry), snapshot)
}

fn prepare(runtime: &PublishRuntime, snapshot: &PlanningInputSnapshot) -> PreparedPublishPlan {
    runtime.prepare_attempt(snapshot).expect("prepare attempt")
}

#[test]
fn shard_rejects_a_prepared_plan_that_no_longer_matches_its_snapshot() {
    let temp = tempfile::tempdir().expect("temp dirs");
    let (runtime, snapshot) = fixture_runtime(&temp.path().join("store"), &temp.path().join("out"));
    let mut prepared = prepare(&runtime, &snapshot);

    // 分片段只能执行与快照重算结果一致的计划；任何漂移（此处模拟被篡改的
    // 节点身份）都使计划在副作用发生前作废。
    prepared.plan.nodes[0].id = "tampered-node".to_string();

    let error = runtime
        .start_prepared_shard(
            &prepared,
            "attempt-shard",
            PlanNodePlatform::Any,
            ShardHandoff::default(),
        )
        .expect_err("a drifted prepared plan cannot start a shard");
    match error {
        PublishError::InvalidPlan(message) => {
            assert!(message.contains("no longer matches"))
        }
        other => panic!("expected InvalidPlan, got {other}"),
    }
}

#[test]
fn prepared_execution_rejects_a_plan_that_no_longer_matches_its_snapshot() {
    let temp = tempfile::tempdir().expect("temp dirs");
    let (runtime, snapshot) = fixture_runtime(&temp.path().join("store"), &temp.path().join("out"));
    let mut prepared = prepare(&runtime, &snapshot);
    prepared.plan.nodes[0].id = "tampered-node".to_string();

    let error = runtime
        .start_prepared(&prepared, "attempt-full")
        .expect_err("the non-sharded entry shares the drift guard");
    assert!(matches!(error, PublishError::InvalidPlan(_)));
}

#[test]
fn shard_rejects_an_empty_attempt_identity() {
    let temp = tempfile::tempdir().expect("temp dirs");
    let (runtime, snapshot) = fixture_runtime(&temp.path().join("store"), &temp.path().join("out"));
    let prepared = prepare(&runtime, &snapshot);

    let error = runtime
        .start_prepared_shard(
            &prepared,
            "   ",
            PlanNodePlatform::Any,
            ShardHandoff::default(),
        )
        .expect_err("an empty attempt id cannot own shard evidence");
    assert!(matches!(error, PublishError::Execution(_)));
}
