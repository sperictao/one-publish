//! Adapter 注册表分发与 trait 默认实现的 fail-closed 边界（Issue #223）：
//! 种类不匹配在查找之前拒绝、未注册/版本漂移显式报错、未声明能力的
//! Adapter 默认实现全部保守失败（ADR-0029/0035/0051）。

use std::collections::BTreeMap;
use std::sync::Arc;

use publish_adapters::{
    AdapterConformanceFixture, AdapterContract, AdapterExecutionContext, AdapterRegistry,
    CancellationSignal, CredentialResolveFailure, DeliveryDestination, ExecutionBackend,
    LocalDirectoryDestination, PlanNodeExecutor, ProjectProvider,
};
use publish_domain::{
    AdapterBinding, AdapterDescriptor, AdapterIdentity, AdapterKind, AdapterSchema,
    AdapterSelection, AdapterSettings, DeliveryEnvelope, DeliveryIdempotencyIdentity,
    DeliveryRoute, PlanNode, PlanNodePlatform, PlanOperation, PlanStage, PlanningInputSnapshot,
    PublishError, PublishingCapability, ReleaseIdentity, ResolvedCredential, SourceSnapshot,
    PLANNING_INPUT_SNAPSHOT_VERSION,
};
use serde_json::Value;
use tempfile::TempDir;

struct BareAdapter {
    descriptor: AdapterDescriptor,
}

impl BareAdapter {
    fn new() -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ExecutionBackend,
                "bare-backend",
                1,
                AdapterSchema::new(1),
                PublishingCapability {
                    provides: vec![],
                    requires: vec![],
                },
            ),
        }
    }
}

impl AdapterContract for BareAdapter {
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
    ) -> Result<Vec<publish_domain::PlanNodeTemplate>, PublishError> {
        Ok(vec![])
    }
}

impl ExecutionBackend for BareAdapter {}
impl DeliveryDestination for BareAdapter {}
impl ProjectProvider for BareAdapter {}

fn node_with_adapter(adapter: AdapterIdentity) -> PlanNode {
    PlanNode {
        id: "node".to_string(),
        stage: PlanStage::PublishRoutes,
        adapter,
        binding_id: "route-a".to_string(),
        settings: AdapterSettings::new(1),
        operation: PlanOperation::AdapterAction {
            action: "publish".to_string(),
            inputs: BTreeMap::new(),
        },
        depends_on: vec![],
        artifact_inputs: vec![],
        artifact_outputs: vec![],
        side_effects: vec![],
        cancellable: true,
        cleanup_owned_staging: false,
        irreversible: false,
        platform: PlanNodePlatform::Any,
    }
}

fn context<'a>(envelopes: &'a [DeliveryEnvelope]) -> AdapterExecutionContext<'a> {
    static EMPTY_CREDENTIALS: BTreeMap<String, ResolvedCredential> = BTreeMap::new();
    AdapterExecutionContext {
        attempt_id: "attempt",
        plan_digest: "plan",
        snapshot_digest: "snapshot",
        artifacts: &[],
        manifest: None,
        envelopes,
        receipts: &[],
        credentials: &EMPTY_CREDENTIALS,
        cancellation: CancellationSignal::new(),
    }
}

struct NoopExecutor;
impl PlanNodeExecutor for NoopExecutor {
    fn execute_node(&mut self, _node: &PlanNode) -> Result<(), PublishError> {
        Ok(())
    }
}

#[test]
fn trait_defaults_fail_closed_without_capability_implementations() {
    let adapter = BareAdapter::new();
    let node = node_with_adapter(adapter.descriptor().identity());
    let context = context(&[]);

    assert!(AdapterContract::execute_node(&adapter, &node, &context)
        .expect_err("default node execution is closed")
        .to_string()
        .contains("does not execute plan nodes"));

    let plan = publish_domain::PublishPlan {
        version: publish_domain::PUBLISH_PLAN_VERSION,
        snapshot_digest: "snapshot".to_string(),
        adapters: vec![],
        execution_backend: adapter.descriptor().identity(),
        routes: vec![],
        nodes: vec![],
        digest: "plan".to_string(),
    };
    let mut executor = NoopExecutor;
    assert!(
        AdapterContract::execute_plan(&adapter, &plan, &mut executor)
            .expect_err("default plan execution is closed")
            .to_string()
            .contains("is not an execution backend")
    );

    assert!(adapter
        .discover_candidates(std::path::Path::new("/repo"))
        .expect("default discovery reports no candidates")
        .is_empty());

    assert!(matches!(
        adapter.resolve_credential("secret-ref"),
        Err(CredentialResolveFailure::Missing)
    ));

    let missing = adapter
        .render_automation_bundle(&[])
        .expect_err("automation projection is an opt-in capability");
    assert!(
        matches!(missing, PublishError::MissingCapability { .. }),
        "{missing}"
    );

    let probe = adapter
        .probe_delivery(
            &AdapterSettings::new(1),
            &delivery_identity(),
            &BTreeMap::new(),
        )
        .expect("default probe does not fail");
    assert!(matches!(
        probe,
        publish_adapters::DeliveryProbe::Unprobeable { .. }
    ));

    assert!(adapter
        .validate_staged_envelope(
            &node,
            &context,
            &DeliveryEnvelope::new("route-a", "d".repeat(64))
        )
        .expect_err("envelope validation is opt-in")
        .to_string()
        .contains("does not validate synchronized"));

    assert!(!adapter
        .cleanup_owned_staging(&node, &context)
        .expect("default cleanup declines"));
}

fn delivery_identity() -> DeliveryIdempotencyIdentity {
    DeliveryIdempotencyIdentity {
        attempt_id: "attempt".to_string(),
        plan_node_id: "publish".to_string(),
        release_identity: ReleaseIdentity::new(
            "project:app",
            SourceSnapshot {
                revision: "0123456789abcdef".to_string(),
                workspace_digest: None,
                dirty: false,
                captured_at: "2026-10-27T10:00:00Z".to_string(),
                reproducible: true,
            },
            "1.0.0",
            "stable",
            None,
        ),
        manifest_digest: "d".repeat(64),
        route_id: "route-a".to_string(),
    }
}

#[test]
fn adapter_contract_default_migration_pins_the_current_schema() {
    let adapter = BareAdapter::new();
    let foreign = AdapterSettings::new(2);
    let error = adapter
        .migrate_settings(&foreign)
        .expect_err("foreign schema versions are rejected");
    assert!(
        matches!(
            error,
            PublishError::UnsupportedSchemaVersion {
                actual: 2,
                current: 1,
                ..
            }
        ),
        "{error}"
    );

    let current = AdapterSettings::new(1).with_value("k", Value::Bool(true));
    let migrated = adapter
        .migrate_settings(&current)
        .expect("current schema settings pass through");
    assert_eq!(migrated, current);
}

#[test]
fn registry_dispatch_enforces_adapter_kinds_before_lookup() {
    let registry = AdapterRegistry::new();
    let destination_kind = AdapterIdentity::new(AdapterKind::DeliveryDestination, "dest", 1);
    let store_kind = AdapterIdentity::new(AdapterKind::ArtifactStore, "store", 1);
    let backend_kind = AdapterIdentity::new(AdapterKind::ExecutionBackend, "backend", 1);

    // probe_delivery 只接受 DeliveryDestination 身份。
    assert!(matches!(
        registry
            .probe_delivery(
                &backend_kind,
                &AdapterSettings::new(1),
                &delivery_identity(),
                &BTreeMap::new()
            )
            .expect_err("probe dispatch rejects non-destination identities"),
        PublishError::AdapterKindMismatch {
            expected: AdapterKind::DeliveryDestination,
            actual: AdapterKind::ExecutionBackend,
            ..
        }
    ));

    // cleanup/validate_staged_envelope 只接受 Destination 节点。
    let non_destination_node = node_with_adapter(store_kind.clone());
    assert!(matches!(
        registry
            .cleanup_owned_staging(&non_destination_node, &context(&[]))
            .expect_err("cleanup dispatch rejects non-destination nodes"),
        PublishError::AdapterKindMismatch {
            expected: AdapterKind::DeliveryDestination,
            actual: AdapterKind::ArtifactStore,
            ..
        }
    ));
    assert!(matches!(
        registry
            .validate_staged_envelope(
                &non_destination_node,
                &context(&[]),
                &DeliveryEnvelope::new("route-a", "d".repeat(64)),
            )
            .expect_err("envelope validation dispatch rejects non-destination nodes"),
        PublishError::AdapterKindMismatch {
            expected: AdapterKind::DeliveryDestination,
            actual: AdapterKind::ArtifactStore,
            ..
        }
    ));

    // execute_plan 只接受 ExecutionBackend 身份。
    let plan = publish_domain::PublishPlan {
        version: publish_domain::PUBLISH_PLAN_VERSION,
        snapshot_digest: "snapshot".to_string(),
        adapters: vec![],
        execution_backend: backend_kind.clone(),
        routes: vec![],
        nodes: vec![],
        digest: "plan".to_string(),
    };
    let mut executor = NoopExecutor;
    assert!(matches!(
        registry
            .execute_plan(&destination_kind, &plan, &mut executor)
            .expect_err("plan execution dispatch rejects non-backend identities"),
        PublishError::AdapterKindMismatch {
            expected: AdapterKind::ExecutionBackend,
            actual: AdapterKind::DeliveryDestination,
            ..
        }
    ));
}

#[test]
fn registry_reports_unregistered_and_version_drifted_adapters() {
    let mut registry = AdapterRegistry::new();
    let temp = TempDir::new().expect("temp dir");
    let destination = LocalDirectoryDestination::new(temp.path());
    let fixture = AdapterConformanceFixture::new(fixture_snapshot());
    registry
        .register_delivery_destination(Arc::new(destination), &fixture)
        .expect("register the local destination");

    // 未注册的 Adapter id：明确 NotRegistered 而非空指针。
    let unknown = AdapterIdentity::new(AdapterKind::DeliveryDestination, "ghost", 1);
    let error = registry
        .probe_delivery(
            &unknown,
            &AdapterSettings::new(1),
            &delivery_identity(),
            &BTreeMap::new(),
        )
        .expect_err("unregistered adapters are explicit");
    assert!(
        matches!(error, PublishError::AdapterNotRegistered { .. }),
        "{error}"
    );

    // 同 id 异版本：报告可用版本而不是笼统 NotRegistered。
    let drifted = AdapterIdentity::new(AdapterKind::DeliveryDestination, "local-directory", 99);
    let error = registry
        .probe_delivery(
            &drifted,
            &AdapterSettings::new(1),
            &delivery_identity(),
            &BTreeMap::new(),
        )
        .expect_err("version drift is explicit");
    match error {
        PublishError::AdapterVersionMismatch {
            requested,
            available,
            ..
        } => {
            assert_eq!(requested, 99);
            assert_eq!(available, vec![1]);
        }
        other => panic!("expected version mismatch, got {other}"),
    }

    // 凭据解析在 schema 检查后要求 ExecutionBackend 身份。
    let binding = AdapterBinding::new(
        "route-a",
        AdapterIdentity::new(AdapterKind::DeliveryDestination, "local-directory", 1),
        AdapterSettings::new(1),
    );
    let wrong_backend = AdapterIdentity::new(AdapterKind::ArtifactStore, "store", 1);
    assert!(matches!(
        registry
            .resolve_binding_credentials(&wrong_backend, &binding)
            .expect_err("credential resolution requires a backend identity"),
        PublishError::AdapterKindMismatch {
            expected: AdapterKind::ExecutionBackend,
            actual: AdapterKind::ArtifactStore,
            ..
        }
    ));
}

fn fixture_snapshot() -> PlanningInputSnapshot {
    let empty = AdapterSettings::new(1);
    PlanningInputSnapshot {
        version: PLANNING_INPUT_SNAPSHOT_VERSION,
        configuration_revision: "revision-1".to_string(),
        runtime_revision: "runner-1".to_string(),
        release_input: BTreeMap::new(),
        source: SourceSnapshot {
            revision: "0123456789abcdef".to_string(),
            workspace_digest: None,
            dirty: false,
            captured_at: "2026-10-27T10:00:00Z".to_string(),
            reproducible: true,
        },
        external_preconditions: BTreeMap::new(),
        promoted_manifest_digest: None,
        adapters: AdapterSelection {
            project_provider: AdapterBinding::new(
                "project",
                AdapterIdentity::new(AdapterKind::ProjectProvider, "provider", 1),
                empty.clone(),
            ),
            artifact_processors: vec![],
            execution_backend: AdapterBinding::new(
                "backend",
                AdapterIdentity::new(AdapterKind::ExecutionBackend, "backend", 1),
                empty.clone(),
            ),
            artifact_store: AdapterBinding::new(
                "store",
                AdapterIdentity::new(AdapterKind::ArtifactStore, "store", 1),
                empty.clone(),
            ),
            delivery_routes: vec![DeliveryRoute::required(AdapterBinding::new(
                "destination",
                AdapterIdentity::new(AdapterKind::DeliveryDestination, "local-directory", 1),
                empty,
            ))],
        },
    }
}
