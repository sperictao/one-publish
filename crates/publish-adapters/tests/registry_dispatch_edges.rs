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

// ── 能力协商（ADR-0035）：requires 必须被 registry 内某 Adapter 的 provides 满足 ──

fn capability_adapter(
    kind: AdapterKind,
    id: &str,
    provides: Vec<publish_domain::Capability>,
    requires: Vec<publish_domain::CapabilityRequirement>,
) -> BareAdapter {
    BareAdapter {
        descriptor: AdapterDescriptor::new(
            kind,
            id,
            1,
            AdapterSchema::new(1),
            PublishingCapability { provides, requires },
        ),
    }
}

#[test]
fn capability_negotiation_accepts_satisfied_requirements_only() {
    use publish_domain::{Capability, CapabilityRequirement};

    let fixture = AdapterConformanceFixture::new(fixture_snapshot());
    let provider = capability_adapter(
        AdapterKind::ExecutionBackend,
        "provider",
        vec![Capability::new("evidence-store", 2)],
        vec![],
    );
    let consumer = capability_adapter(
        AdapterKind::DeliveryDestination,
        "consumer",
        vec![],
        vec![CapabilityRequirement {
            id: "evidence-store".to_string(),
            minimum_version: 1,
            maximum_version: 3,
        }],
    );

    let mut registry = AdapterRegistry::new();
    registry
        .register_execution_backend(Arc::new(provider), &fixture)
        .expect("register provider");
    registry
        .register_delivery_destination(Arc::new(consumer), &fixture)
        .expect("register consumer");

    let provider_id = AdapterIdentity::new(AdapterKind::ExecutionBackend, "provider", 1);
    let consumer_id = AdapterIdentity::new(AdapterKind::DeliveryDestination, "consumer", 1);
    registry
        .validate_capabilities([&provider_id, &consumer_id])
        .expect("a satisfied requirement negotiates cleanly");

    // 需求没有提供方 → MissingCapability。
    let mut registry = AdapterRegistry::new();
    let needy = capability_adapter(
        AdapterKind::DeliveryDestination,
        "needy",
        vec![],
        vec![CapabilityRequirement::exact("ghost", 1)],
    );
    registry
        .register_delivery_destination(Arc::new(needy), &fixture)
        .expect("register needy");
    let needy_id = AdapterIdentity::new(AdapterKind::DeliveryDestination, "needy", 1);
    let error = registry
        .validate_capabilities([&needy_id])
        .expect_err("requirements without a provider cannot negotiate");
    assert!(matches!(
        error,
        PublishError::MissingCapability { ref capability, .. } if capability == "ghost"
    ));

    // 提供方版本落在接受区间外 → IncompatibleCapability。
    let mut registry = AdapterRegistry::new();
    registry
        .register_execution_backend(
            Arc::new(capability_adapter(
                AdapterKind::ExecutionBackend,
                "provider",
                vec![Capability::new("evidence-store", 1)],
                vec![],
            )),
            &fixture,
        )
        .expect("register provider");
    registry
        .register_delivery_destination(
            Arc::new(capability_adapter(
                AdapterKind::DeliveryDestination,
                "consumer",
                vec![],
                vec![CapabilityRequirement {
                    id: "evidence-store".to_string(),
                    minimum_version: 5,
                    maximum_version: 9,
                }],
            )),
            &fixture,
        )
        .expect("register consumer");
    let error = registry
        .validate_capabilities([&provider_id, &consumer_id])
        .expect_err("out-of-range versions cannot negotiate");
    assert!(matches!(
        error,
        PublishError::IncompatibleCapability { ref capability, .. }
            if capability == "evidence-store"
    ));
}

#[test]
fn execute_plan_in_order_visits_nodes_and_propagates_failures() {
    use publish_adapters::execute_plan_in_order;

    let nodes = vec![
        node_with_adapter(AdapterIdentity::new(
            AdapterKind::DeliveryDestination,
            "a",
            1,
        )),
        node_with_adapter(AdapterIdentity::new(
            AdapterKind::DeliveryDestination,
            "b",
            1,
        )),
    ];
    let plan = publish_domain::PublishPlan {
        version: publish_domain::PUBLISH_PLAN_VERSION,
        snapshot_digest: "snapshot".to_string(),
        adapters: vec![],
        execution_backend: AdapterIdentity::new(AdapterKind::ExecutionBackend, "backend", 1),
        routes: vec![],
        nodes,
        digest: "plan".to_string(),
    };

    struct RecordingExecutor {
        visited: Vec<String>,
        fail_on: String,
    }
    impl PlanNodeExecutor for RecordingExecutor {
        fn execute_node(&mut self, node: &PlanNode) -> Result<(), PublishError> {
            if node.id == self.fail_on {
                return Err(PublishError::Execution(format!("{} failed", node.id)));
            }
            self.visited.push(node.id.clone());
            Ok(())
        }
    }

    let mut executor = RecordingExecutor {
        visited: Vec::new(),
        fail_on: "node".to_string(),
    };
    let error = execute_plan_in_order(&plan, &mut executor)
        .expect_err("executor failures propagate to the plan");
    assert!(error.to_string().contains("failed"));

    // 同 id 节点：第一个失败，无成功访问记录但顺序语义被遵守。
    executor.fail_on = String::new();
    let error = execute_plan_in_order(&plan, &mut executor);
    assert!(error.is_ok(), "identical nodes execute in order");
}

#[test]
fn builtin_delivery_namespaces_combine_adapter_and_locator() {
    use publish_adapters::builtin_delivery_namespace;

    // GitHub Release：locator 就是仓库 slug。
    assert_eq!(
        builtin_delivery_namespace("github-release", &Value::Null, "acme/demo").as_deref(),
        Some("github-release:acme/demo")
    );
    // SFTP：locator 是 host:remote_path。
    assert_eq!(
        builtin_delivery_namespace(
            "sftp",
            &serde_json::json!({"host": "files.example.com", "remote_path": "/srv/releases"}),
            "ignored",
        )
        .as_deref(),
        Some("sftp:files.example.com:/srv/releases")
    );
    // Local：locator 是目标目录。
    assert_eq!(
        builtin_delivery_namespace(
            "local-directory",
            &serde_json::json!({"directory": "/opt/releases"}),
            "ignored",
        )
        .as_deref(),
        Some("local-directory:/opt/releases")
    );
    // 未知 Adapter 与空 locator 都返回 None。
    assert!(builtin_delivery_namespace("unknown-adapter", &Value::Null, "x").is_none());
    assert!(builtin_delivery_namespace("github-release", &Value::Null, "").is_none());
    assert!(builtin_delivery_namespace("sftp", &serde_json::json!({}), "x").is_none());
}

#[test]
fn binding_credentials_resolve_through_the_execution_backend() {
    let fixture = AdapterConformanceFixture::new(fixture_snapshot());
    let backend = BareAdapter::new();
    let backend_id = backend.descriptor().identity();

    // Destination schema 声明一个凭据要求；binding 未绑定它 → CredentialNotBound。
    let mut schema = AdapterSchema::new(1);
    schema.credentials.insert(
        "github_token".to_string(),
        publish_domain::CredentialRequirement {
            kind: publish_domain::CredentialKind::Token,
            purpose: "release upload".to_string(),
        },
    );
    let destination = BareAdapter {
        descriptor: AdapterDescriptor::new(
            AdapterKind::DeliveryDestination,
            "dest",
            1,
            schema,
            PublishingCapability {
                provides: vec![],
                requires: vec![],
            },
        ),
    };
    let destination_id = destination.descriptor().identity();

    let mut registry = AdapterRegistry::new();
    registry
        .register_execution_backend(Arc::new(backend), &fixture)
        .expect("register backend");
    registry
        .register_delivery_destination(Arc::new(destination), &fixture)
        .expect("register destination");

    let binding = AdapterBinding::new("route", destination_id.clone(), AdapterSettings::new(1));
    let error = registry
        .resolve_binding_credentials(&backend_id, &binding)
        .expect_err("unbound requirements cannot resolve");
    assert!(matches!(
        error,
        PublishError::CredentialNotBound { ref requirement, .. }
            if requirement == "github_token"
    ));

    // 绑定存在但后端缺该引用 → CredentialReferenceMissing（默认实现是 Missing）。
    let mut bound = binding.clone();
    bound
        .credentials
        .insert("github_token".to_string(), "release-token".to_string());
    let error = registry
        .resolve_binding_credentials(&backend_id, &bound)
        .expect_err("missing references surface at the boundary");
    assert!(matches!(
        error,
        PublishError::CredentialReferenceMissing { ref requirement, .. }
            if requirement == "github_token"
    ));
}

#[test]
fn validate_plan_node_dispatches_operation_validation() {
    let fixture = AdapterConformanceFixture::new(fixture_snapshot());
    let destination = capability_adapter(AdapterKind::DeliveryDestination, "dest", vec![], vec![]);
    let mut registry = AdapterRegistry::new();
    registry
        .register_delivery_destination(Arc::new(destination), &fixture)
        .expect("register destination");

    let node = node_with_adapter(AdapterIdentity::new(
        AdapterKind::DeliveryDestination,
        "dest",
        1,
    ));
    registry
        .validate_plan_node(&node)
        .expect("a valid adapter action validates");

    // RunProgram 不是 Destination 的可执行操作 → 校验拒绝。
    let mut foreign = node.clone();
    foreign.operation = PlanOperation::RunProgram {
        program: "opaque".to_string(),
        args: vec![],
        working_directory: None,
        environment_references: BTreeMap::new(),
    };
    assert!(registry.validate_plan_node(&foreign).is_err());
}

#[test]
fn registry_execute_node_dispatches_to_the_registered_adapter() {
    let fixture = AdapterConformanceFixture::new(fixture_snapshot());
    let destination = capability_adapter(AdapterKind::DeliveryDestination, "dest", vec![], vec![]);
    let mut registry = AdapterRegistry::new();
    registry
        .register_delivery_destination(Arc::new(destination), &fixture)
        .expect("register destination");

    let node = node_with_adapter(AdapterIdentity::new(
        AdapterKind::DeliveryDestination,
        "dest",
        1,
    ));
    let credentials = BTreeMap::new();
    let context = AdapterExecutionContext {
        attempt_id: "attempt",
        plan_digest: "plan",
        snapshot_digest: "snapshot",
        artifacts: &[],
        manifest: None,
        envelopes: &[],
        receipts: &[],
        credentials: &credentials,
        cancellation: CancellationSignal::new(),
    };
    // BareAdapter 未实现 execute_node → 默认 fail-closed 错误经分发传回。
    let error = registry
        .execute_node(&node, &context)
        .expect_err("dispatched execution reaches the adapter");
    assert!(error.to_string().contains("does not execute plan nodes"));
}

#[test]
fn destination_dispatch_enforces_kind_and_registration() {
    let fixture = AdapterConformanceFixture::new(fixture_snapshot());
    let destination = capability_adapter(AdapterKind::DeliveryDestination, "dest", vec![], vec![]);
    let mut registry = AdapterRegistry::new();
    registry
        .register_delivery_destination(Arc::new(destination), &fixture)
        .expect("register destination");

    let destination_id = AdapterIdentity::new(AdapterKind::DeliveryDestination, "dest", 1);
    let wrong_kind = node_with_adapter(AdapterIdentity::new(
        AdapterKind::ExecutionBackend,
        "backend",
        1,
    ));
    let unknown = node_with_adapter(AdapterIdentity::new(
        AdapterKind::DeliveryDestination,
        "ghost",
        1,
    ));
    let node = node_with_adapter(destination_id.clone());

    let credentials = BTreeMap::new();
    let context = AdapterExecutionContext {
        attempt_id: "attempt",
        plan_digest: "plan",
        snapshot_digest: "snapshot",
        artifacts: &[],
        manifest: None,
        envelopes: &[],
        receipts: &[],
        credentials: &credentials,
        cancellation: CancellationSignal::new(),
    };
    let envelope = DeliveryEnvelope::new("route", "digest");

    // cleanup_owned_staging：kind 检查先于查找。
    assert!(matches!(
        registry
            .cleanup_owned_staging(&wrong_kind, &context)
            .expect_err("cleanup dispatch enforces the destination kind"),
        PublishError::AdapterKindMismatch {
            expected: AdapterKind::DeliveryDestination,
            actual: AdapterKind::ExecutionBackend,
            ..
        }
    ));
    // 未注册 destination → unresolved，而不是默认实现。
    assert!(registry.cleanup_owned_staging(&unknown, &context).is_err());
    // 已注册但未实现 cleanup → 默认 false，不伪装成回滚。
    assert!(!registry
        .cleanup_owned_staging(&node, &context)
        .expect("the default cleanup reports not-owned"));

    // validate_staged_envelope：kind 检查 + 未注册分发。
    assert!(matches!(
        registry
            .validate_staged_envelope(&wrong_kind, &context, &envelope)
            .expect_err("envelope validation enforces the destination kind"),
        PublishError::AdapterKindMismatch { .. }
    ));
    assert!(registry
        .validate_staged_envelope(&unknown, &context, &envelope)
        .is_err());

    // probe_delivery 分发：未注册 → unresolved；已注册默认 → Unprobeable。
    let identity = DeliveryIdempotencyIdentity {
        attempt_id: "attempt".to_string(),
        plan_node_id: "node".to_string(),
        release_identity: ReleaseIdentity::new(
            "project",
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
        manifest_digest: "digest".to_string(),
        route_id: "route".to_string(),
    };
    let credentials = BTreeMap::new();
    let ghost_id = AdapterIdentity::new(AdapterKind::DeliveryDestination, "ghost", 1);
    assert!(matches!(
        registry
            .probe_delivery(&ghost_id, &AdapterSettings::new(1), &identity, &credentials)
            .expect_err("unregistered destinations cannot be probed"),
        PublishError::AdapterNotRegistered { .. }
    ));
    // 未实现 probe 的 destination → 默认 Unprobeable。
    assert!(matches!(
        registry
            .probe_delivery(
                &destination_id,
                &AdapterSettings::new(1),
                &identity,
                &credentials
            )
            .expect("the default probe reports unprobeable"),
        publish_adapters::DeliveryProbe::Unprobeable { .. }
    ));

    // kind 检查先于注册查找。
    assert!(matches!(
        registry
            .probe_delivery(
                &AdapterIdentity::new(AdapterKind::ExecutionBackend, "backend", 1),
                &AdapterSettings::new(1),
                &identity,
                &credentials,
            )
            .expect_err("probe dispatch enforces the destination kind"),
        PublishError::AdapterKindMismatch {
            expected: AdapterKind::DeliveryDestination,
            actual: AdapterKind::ExecutionBackend,
            ..
        }
    ));
}

#[test]
fn fake_remote_backend_implements_the_shared_runner_contract() {
    use publish_adapters::{FakeRemoteBackend, StaticCredentialSource, FAKE_REMOTE_BACKEND_ID};

    let backend = FakeRemoteBackend::new(Arc::new(StaticCredentialSource::new().with_secret(
        "vault://token",
        publish_domain::CredentialKind::Token,
        "secret-value",
    )));
    assert_eq!(backend.descriptor().identity().id, FAKE_REMOTE_BACKEND_ID);
    assert_eq!(backend.default_settings(), AdapterSettings::new(1));
    assert!(backend
        .plan_fragment(&fixture_snapshot(), &AdapterSettings::new(1))
        .expect("the fake backend contributes no plan nodes")
        .is_empty());

    // Credential 委托给注入的来源：命中与未命中都保持分类语义。
    let resolved = backend
        .resolve_credential("vault://token")
        .expect("seeded credential resolves");
    assert_eq!(resolved.kind, publish_domain::CredentialKind::Token);
    assert!(matches!(
        backend
            .resolve_credential("vault://missing")
            .expect_err("missing credentials stay classified"),
        CredentialResolveFailure::Missing
    ));

    // execute_plan 按序委托给共享执行器。
    let plan = publish_domain::PublishPlan {
        version: publish_domain::PUBLISH_PLAN_VERSION,
        snapshot_digest: "snapshot".to_string(),
        adapters: vec![],
        execution_backend: backend.descriptor().identity(),
        routes: vec![],
        nodes: vec![node_with_adapter(AdapterIdentity::new(
            AdapterKind::DeliveryDestination,
            "dest",
            1,
        ))],
        digest: "plan".to_string(),
    };
    let mut executor = NoopExecutor;
    AdapterContract::execute_plan(&backend, &plan, &mut executor)
        .expect("the fake backend interprets plans through the shared executor");
}

/// 注册时一致性校验把契约违规挡在注册表之外（fail-closed）。每个替身只
/// 违反一条不变量，确保错误分类指向具体守卫而不是泛型失败。
struct MisbehavingAdapter {
    descriptor: AdapterDescriptor,
    migrate_drift: bool,
    blank_summary: bool,
    fragment: Vec<publish_domain::PlanNodeTemplate>,
    fragment_drift: bool,
}

impl MisbehavingAdapter {
    fn conformant() -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ExecutionBackend,
                "misbehaving",
                1,
                AdapterSchema::new(1),
                PublishingCapability {
                    provides: vec![],
                    requires: vec![],
                },
            ),
            migrate_drift: false,
            blank_summary: false,
            fragment: vec![],
            fragment_drift: false,
        }
    }
}

impl AdapterContract for MisbehavingAdapter {
    fn descriptor(&self) -> &AdapterDescriptor {
        &self.descriptor
    }

    fn default_settings(&self) -> AdapterSettings {
        AdapterSettings::new(1)
    }

    fn migrate_settings(
        &self,
        settings: &AdapterSettings,
    ) -> Result<AdapterSettings, PublishError> {
        let mut migrated = settings.clone();
        if self.migrate_drift {
            migrated.values.insert(
                "drift".to_string(),
                Value::String(std::process::id().to_string()),
            );
            // 同一次注册内两次迁移必须一致；用原子计数器制造漂移。
            static TICK: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            migrated.values.insert(
                "tick".to_string(),
                Value::from(TICK.fetch_add(1, std::sync::atomic::Ordering::SeqCst)),
            );
        }
        Ok(migrated)
    }

    fn summarize_settings(&self, _settings: &AdapterSettings) -> Result<String, PublishError> {
        Ok(if self.blank_summary {
            "   ".to_string()
        } else {
            self.descriptor.id.clone()
        })
    }

    fn plan_fragment(
        &self,
        _snapshot: &PlanningInputSnapshot,
        _settings: &AdapterSettings,
    ) -> Result<Vec<publish_domain::PlanNodeTemplate>, PublishError> {
        let mut fragment = self.fragment.clone();
        if self.fragment_drift {
            fragment.push(publish_domain::PlanNodeTemplate::command(
                format!("drift-{}", std::process::id()),
                PlanStage::Build,
                "program",
                Vec::new(),
            ));
            static TICK: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            fragment[0].local_id = format!(
                "node-{}",
                TICK.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
            );
        }
        Ok(fragment)
    }
}

impl ExecutionBackend for MisbehavingAdapter {}

#[test]
fn registration_rejects_kind_and_contract_violations() {
    let fixture = AdapterConformanceFixture::new(fixture_snapshot());
    let mut registry = AdapterRegistry::new();

    // Descriptor kind 与注册槽不匹配。
    let mut wrong_kind = MisbehavingAdapter::conformant();
    wrong_kind.descriptor.kind = AdapterKind::DeliveryDestination;
    assert!(matches!(
        registry
            .register_execution_backend(Arc::new(wrong_kind), &fixture)
            .expect_err("kind mismatches are rejected before lookup"),
        PublishError::AdapterKindMismatch {
            expected: AdapterKind::ExecutionBackend,
            actual: AdapterKind::DeliveryDestination,
            ..
        }
    ));

    // 契约版本漂移。
    let mut old_contract = MisbehavingAdapter::conformant();
    old_contract.descriptor.contract_version = 0;
    assert!(matches!(
        registry
            .register_execution_backend(Arc::new(old_contract), &fixture)
            .expect_err("foreign contract versions are rejected"),
        PublishError::UnsupportedAdapterContractVersion { .. }
    ));

    // 空 id。
    let mut blank_id = MisbehavingAdapter::conformant();
    blank_id.descriptor.id = "   ".to_string();
    assert!(matches!(
        registry
            .register_execution_backend(Arc::new(blank_id), &fixture)
            .expect_err("blank adapter ids are rejected"),
        PublishError::InvalidAdapter { .. }
    ));
}

#[test]
fn registration_rejects_nondeterministic_settings_and_fragments() {
    let fixture = AdapterConformanceFixture::new(fixture_snapshot());
    let mut registry = AdapterRegistry::new();

    let mut drifting = MisbehavingAdapter::conformant();
    drifting.migrate_drift = true;
    let error = registry
        .register_execution_backend(Arc::new(drifting), &fixture)
        .expect_err("non-deterministic migration is rejected");
    assert!(error
        .to_string()
        .contains("settings migration is not deterministic"));

    let mut blank_summary = MisbehavingAdapter::conformant();
    blank_summary.blank_summary = true;
    let error = registry
        .register_execution_backend(Arc::new(blank_summary), &fixture)
        .expect_err("empty settings summaries are rejected");
    assert!(error.to_string().contains("settings summary"));

    let mut drifting_fragment = MisbehavingAdapter::conformant();
    drifting_fragment.fragment = vec![publish_domain::PlanNodeTemplate::command(
        "node",
        PlanStage::Build,
        "program",
        Vec::new(),
    )];
    drifting_fragment.fragment_drift = true;
    let error = registry
        .register_execution_backend(Arc::new(drifting_fragment), &fixture)
        .expect_err("non-deterministic plan fragments are rejected");
    assert!(error
        .to_string()
        .contains("plan fragment is not deterministic"));
}

#[test]
fn registration_rejects_malformed_fragments_and_forbidden_values() {
    let mut fixture = AdapterConformanceFixture::new(fixture_snapshot());
    let mut registry = AdapterRegistry::new();

    // 空或重复 node id。
    for fragment in [
        vec![publish_domain::PlanNodeTemplate::command(
            "   ",
            PlanStage::Build,
            "test-provider:program",
            Vec::new(),
        )],
        vec![
            publish_domain::PlanNodeTemplate::command(
                "dup",
                PlanStage::Build,
                "test-provider:program",
                Vec::new(),
            ),
            publish_domain::PlanNodeTemplate::command(
                "dup",
                PlanStage::Build,
                "test-provider:program",
                Vec::new(),
            ),
        ],
    ] {
        let mut adapter = MisbehavingAdapter::conformant();
        adapter.descriptor = adapter
            .descriptor
            .with_allowed_program("test-provider:program");
        adapter.fragment = fragment;
        let error = registry
            .register_execution_backend(Arc::new(adapter), &fixture)
            .expect_err("malformed node ids are rejected");
        assert!(
            error.to_string().contains("plan node ids"),
            "unexpected error: {error}"
        );
    }

    // forbidden_values 命中 settings 序列化内容时拒绝。
    fixture.forbidden_values.push("hunter2".to_string());
    let mut leaking = MisbehavingAdapter::conformant();
    leaking.descriptor.schema = AdapterSchema::new(1).with_required_string("token");
    struct SecretAdapter {
        inner: MisbehavingAdapter,
    }
    impl AdapterContract for SecretAdapter {
        fn descriptor(&self) -> &AdapterDescriptor {
            &self.inner.descriptor
        }
        fn default_settings(&self) -> AdapterSettings {
            let mut settings = AdapterSettings::new(1);
            settings
                .values
                .insert("token".to_string(), Value::String("hunter2".to_string()));
            settings
        }
        fn plan_fragment(
            &self,
            _snapshot: &PlanningInputSnapshot,
            _settings: &AdapterSettings,
        ) -> Result<Vec<publish_domain::PlanNodeTemplate>, PublishError> {
            Ok(vec![])
        }
    }
    impl ExecutionBackend for SecretAdapter {}
    let error = registry
        .register_execution_backend(Arc::new(SecretAdapter { inner: leaking }), &fixture)
        .expect_err("settings leaking forbidden values are rejected");
    assert!(error.to_string().contains("forbidden value"));
}

/// 凭据解析绑定把三类失败精确分类：绑定缺失需求 → CredentialNotBound、
/// 来源查无引用 → CredentialReferenceMissing、来源拒绝 → CredentialAccessDenied。
struct CredentialedProvider {
    descriptor: AdapterDescriptor,
}

impl CredentialedProvider {
    fn new() -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ProjectProvider,
                "credentialed-provider",
                1,
                AdapterSchema::new(1).with_credential(
                    "deploy-token",
                    publish_domain::CredentialKind::Token,
                    "delivery token",
                ),
                PublishingCapability {
                    provides: vec![],
                    requires: vec![],
                },
            ),
        }
    }
}

impl AdapterContract for CredentialedProvider {
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

impl ProjectProvider for CredentialedProvider {}

struct DenyingBackend;
impl AdapterContract for DenyingBackend {
    fn descriptor(&self) -> &AdapterDescriptor {
        static DESCRIPTOR: std::sync::OnceLock<AdapterDescriptor> = std::sync::OnceLock::new();
        DESCRIPTOR.get_or_init(|| {
            AdapterDescriptor::new(
                AdapterKind::ExecutionBackend,
                "denying-backend",
                1,
                AdapterSchema::new(1),
                PublishingCapability {
                    provides: vec![],
                    requires: vec![],
                },
            )
        })
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
impl ExecutionBackend for DenyingBackend {
    fn resolve_credential(
        &self,
        _reference: &str,
    ) -> Result<ResolvedCredential, CredentialResolveFailure> {
        Err(CredentialResolveFailure::AccessDenied)
    }
}

#[test]
fn binding_credential_resolution_stays_classified() {
    let fixture = AdapterConformanceFixture::new(fixture_snapshot());
    let mut registry = AdapterRegistry::new();
    let provider = CredentialedProvider::new();
    let provider_id = provider.descriptor().identity();
    registry
        .register_project_provider(Arc::new(provider), &fixture)
        .expect("register provider");
    let backend = DenyingBackend;
    let backend_id = backend.descriptor().identity();
    registry
        .register_execution_backend(Arc::new(backend), &fixture)
        .expect("register backend");
    registry
        .register_execution_backend(Arc::new(BareAdapter::new()), &fixture)
        .expect("register bare backend");

    // 绑定未声明 schema 要求的凭据。
    let unbound = AdapterBinding::new("provider", provider_id.clone(), AdapterSettings::new(1));
    assert!(matches!(
        registry
            .resolve_binding_credentials(&backend_id, &unbound)
            .expect_err("unbound requirements are rejected"),
        PublishError::CredentialNotBound { .. }
    ));

    // 后端身份必须是 ExecutionBackend。
    let missing = AdapterBinding::new("provider", provider_id.clone(), AdapterSettings::new(1))
        .with_credential("deploy-token", "vault://missing");
    assert!(matches!(
        registry
            .resolve_binding_credentials(&provider_id, &missing)
            .expect_err("non-backend identities cannot resolve credentials"),
        PublishError::AdapterKindMismatch {
            expected: AdapterKind::ExecutionBackend,
            actual: AdapterKind::ProjectProvider,
            ..
        }
    ));

    // 来源查无引用 → CredentialReferenceMissing（BareAdapter 默认 resolve → Missing）。
    let bare_id = AdapterIdentity::new(AdapterKind::ExecutionBackend, "bare-backend", 1);
    assert!(matches!(
        registry
            .resolve_binding_credentials(&bare_id, &missing)
            .expect_err("unresolvable references surface as missing"),
        PublishError::CredentialReferenceMissing { .. }
    ));

    // 来源拒绝 → CredentialAccessDenied。
    let denied = AdapterBinding::new("provider", provider_id, AdapterSettings::new(1))
        .with_credential("deploy-token", "vault://secret");
    assert!(matches!(
        registry
            .resolve_binding_credentials(&backend_id, &denied)
            .expect_err("denied references stay denied"),
        PublishError::CredentialAccessDenied { .. }
    ));
}

#[test]
fn registered_backends_execute_plans_through_the_registry() {
    use publish_adapters::{FakeRemoteBackend, StaticCredentialSource};

    let fixture = AdapterConformanceFixture::new(fixture_snapshot());
    let mut registry = AdapterRegistry::new();
    let backend = FakeRemoteBackend::new(Arc::new(StaticCredentialSource::new()));
    let backend_id = backend.descriptor().identity();
    registry
        .register_execution_backend(Arc::new(backend), &fixture)
        .expect("register backend");

    let plan = publish_domain::PublishPlan {
        version: publish_domain::PUBLISH_PLAN_VERSION,
        snapshot_digest: "snapshot".to_string(),
        adapters: vec![],
        execution_backend: backend_id.clone(),
        routes: vec![],
        nodes: vec![node_with_adapter(AdapterIdentity::new(
            AdapterKind::DeliveryDestination,
            "dest",
            1,
        ))],
        digest: "plan".to_string(),
    };
    let mut executor = NoopExecutor;
    registry
        .execute_plan(&backend_id, &plan, &mut executor)
        .expect("registered backends interpret plans in order");

    // schema 未声明的凭据名绑定也被拒绝，不得携带游离引用。
    let mut registry = AdapterRegistry::new();
    let provider = CredentialedProvider::new();
    let provider_id = provider.descriptor().identity();
    registry
        .register_project_provider(Arc::new(provider), &fixture)
        .expect("register provider");
    let foreign = AdapterBinding::new("provider", provider_id, AdapterSettings::new(1))
        .with_credential("undeclared", "vault://anything");
    assert!(matches!(
        registry
            .resolve_binding_credentials(
                &AdapterIdentity::new(AdapterKind::ExecutionBackend, "bare-backend", 1),
                &foreign,
            )
            .expect_err("undeclared credential names are rejected"),
        PublishError::CredentialNotDeclared { .. }
    ));
}
