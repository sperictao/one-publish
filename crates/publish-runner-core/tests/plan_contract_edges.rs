//! 计划契约与尝试生命周期的防线边界测试。
//!
//! `PublishRuntime::start`/`start_prepared_*` 在执行任何副作用之前先运行
//! `validate_plan` 与 `preflight_adapter_contracts`：密封计划的结构不变量、
//! 绑定一致性与能力链在此失败关闭（ADR-0029/0040/0056）。这些测试直接构造
//! 并篡改 `PublishPlan`，钉住每条拒绝臂的错误语义；生命周期入口（resume /
//! synchronize / cancel）的身份与证据绑定同样必须拒绝漂移。

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
    DeliveryRoute, PlanNode, PlanNodeTemplate, PlanStage, PlanningInputSnapshot, PublishError,
    PublishPlan, PublishingCapability, ReleaseIdentity, SourceSnapshot,
    PLANNING_INPUT_SNAPSHOT_VERSION, RELEASE_ATTEMPT_VERSION,
};
use publish_runner_core::{
    AttemptExecutionContext, AttemptPersistencePort, PreparedPublishPlan, PublishRuntime,
    StartPublishAttempt,
};
use serde_json::Value;

const EDGE_PROVIDER_ID: &str = "edge-provider";
const EDGE_PROCESSOR_ID: &str = "edge-verifier";
const EDGE_ROUTE_ID: &str = "edge-route";

// ─── 最小可执行 Provider/Processor ───

struct EdgeProvider {
    descriptor: AdapterDescriptor,
}

impl EdgeProvider {
    fn new() -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ProjectProvider,
                EDGE_PROVIDER_ID,
                1,
                AdapterSchema::new(1),
                PublishingCapability {
                    provides: vec![Capability::new("artifact-candidate", 1)],
                    requires: vec![],
                },
            )
            .with_allowed_program("edge-provider:builder"),
        }
    }
}

impl AdapterContract for EdgeProvider {
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
            "edge-provider:builder",
            vec!["--release".to_string()],
        )
        .with_artifact_io(vec![], vec!["app".to_string()])])
    }

    fn execute_node(
        &self,
        _node: &PlanNode,
        _context: &AdapterExecutionContext<'_>,
    ) -> Result<AdapterExecutionOutput, PublishError> {
        Ok(AdapterExecutionOutput {
            artifacts: vec![ArtifactCandidate::new(
                "app",
                "app.bin",
                "application/octet-stream",
                "test-os",
                "test-arch",
                b"edge artifact\n".to_vec(),
            )],
            ..AdapterExecutionOutput::default()
        })
    }
}

impl ProjectProvider for EdgeProvider {}

struct EdgeProcessor {
    descriptor: AdapterDescriptor,
}

impl EdgeProcessor {
    fn new() -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ArtifactProcessor,
                EDGE_PROCESSOR_ID,
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

impl AdapterContract for EdgeProcessor {
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
            vec!["app".to_string()],
            vec!["app".to_string()],
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

impl ArtifactProcessor for EdgeProcessor {}

// ─── 夹具 ───

struct EdgeFixture {
    runtime: PublishRuntime,
    snapshot: PlanningInputSnapshot,
    _store_dir: tempfile::TempDir,
    _delivery_dir: tempfile::TempDir,
}

fn fixture() -> EdgeFixture {
    let store_dir = tempfile::tempdir().expect("temporary store");
    let delivery_dir = tempfile::tempdir().expect("delivery parent");
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
                AdapterIdentity::new(AdapterKind::ProjectProvider, EDGE_PROVIDER_ID, 1),
                empty.clone(),
            ),
            artifact_processors: vec![AdapterBinding::new(
                "processor",
                AdapterIdentity::new(AdapterKind::ArtifactProcessor, EDGE_PROCESSOR_ID, 1),
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
                        Value::String(store_dir.path().to_string_lossy().to_string()),
                    )
                    .with_value("retention_seconds", Value::from(604_800u64)),
            ),
            delivery_routes: vec![DeliveryRoute::required(AdapterBinding::new(
                EDGE_ROUTE_ID,
                AdapterIdentity::new(AdapterKind::DeliveryDestination, "local-directory", 1),
                AdapterSettings::new(1).with_value(
                    "directory",
                    Value::String(delivery_dir.path().to_string_lossy().to_string()),
                ),
            ))],
        },
    };

    let conformance = AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(Arc::new(EdgeProvider::new()), &conformance)
        .expect("register edge provider");
    registry
        .register_artifact_processor(Arc::new(EdgeProcessor::new()), &conformance)
        .expect("register edge processor");
    registry
        .register_execution_backend(Arc::new(LocalExecutionBackend::new()), &conformance)
        .expect("register local backend");
    registry
        .register_artifact_store(
            Arc::new(TemporaryArtifactStore::new(store_dir.path())),
            &conformance,
        )
        .expect("register temporary store");
    registry
        .register_delivery_destination(
            Arc::new(LocalDirectoryDestination::new(delivery_dir.path())),
            &conformance,
        )
        .expect("register local destination");

    EdgeFixture {
        runtime: PublishRuntime::new(registry),
        snapshot,
        _store_dir: store_dir,
        _delivery_dir: delivery_dir,
    }
}

fn start_request(attempt_id: &str, source: &SourceSnapshot) -> StartPublishAttempt {
    StartPublishAttempt::new(
        attempt_id.to_string(),
        format!("run-{attempt_id}"),
        ReleaseIdentity::new("edge:app", source.clone(), "1.0.0", "stable", None),
    )
}

// ─── validate_plan 矩阵（runtime.start 直驱密封计划）───

/// 计划被篡改后重算 digest，使版本与摘要么检通过、命中目标结构臂。
fn reseal(plan: &mut PublishPlan) {
    plan.digest = plan.recomputed_digest().expect("reseal tampered plan");
}

#[test]
fn start_rejects_a_plan_with_an_unsupported_version() {
    let fixture = fixture();
    let mut plan = fixture
        .runtime
        .prepare(&fixture.snapshot)
        .expect("prepare plan");
    plan.version += 1;
    let error = fixture
        .runtime
        .start(&plan, "attempt-version")
        .expect_err("an unsealed plan version must fail closed");
    assert_eq!(
        error,
        PublishError::UnsupportedPlanVersion {
            actual: plan.version,
            expected: publish_domain::PUBLISH_PLAN_VERSION,
        }
    );
}

#[test]
fn start_rejects_a_plan_whose_sealed_content_drifted() {
    let fixture = fixture();
    let mut plan = fixture
        .runtime
        .prepare(&fixture.snapshot)
        .expect("prepare plan");
    plan.routes[0].required = false;
    let error = fixture
        .runtime
        .start(&plan, "attempt-digest")
        .expect_err("digest drift must fail closed");
    assert!(
        matches!(error, PublishError::PlanDigestMismatch { .. }),
        "unexpected error: {error}"
    );
}

#[test]
fn start_rejects_plans_without_routes_or_with_duplicate_route_ids() {
    let fixture = fixture();
    let plan = fixture
        .runtime
        .prepare(&fixture.snapshot)
        .expect("prepare plan");

    let mut empty_routes = plan.clone();
    empty_routes.routes.clear();
    reseal(&mut empty_routes);
    let error = fixture
        .runtime
        .start(&empty_routes, "attempt-no-routes")
        .expect_err("a sealed plan without routes must be rejected");
    assert!(
        error.to_string().contains("at least one delivery route"),
        "unexpected error: {error}"
    );

    let mut duplicate = plan.clone();
    duplicate.routes.push(duplicate.routes[0].clone());
    reseal(&mut duplicate);
    let error = fixture
        .runtime
        .start(&duplicate, "attempt-dup-routes")
        .expect_err("duplicate route ids must be rejected");
    assert!(
        error
            .to_string()
            .contains("route ids must be non-empty and unique"),
        "unexpected error: {error}"
    );
}

#[test]
fn start_rejects_a_route_that_references_no_destination_binding() {
    let fixture = fixture();
    let mut plan = fixture
        .runtime
        .prepare(&fixture.snapshot)
        .expect("prepare plan");
    plan.routes[0].route_id = "ghost-route".to_string();
    reseal(&mut plan);
    let error = fixture
        .runtime
        .start(&plan, "attempt-ghost-route")
        .expect_err("routes must reference a delivery destination binding");
    assert!(
        error
            .to_string()
            .contains("does not reference a delivery destination binding"),
        "unexpected error: {error}"
    );
}

#[test]
fn start_rejects_duplicate_or_empty_plan_node_ids() {
    let fixture = fixture();
    let plan = fixture
        .runtime
        .prepare(&fixture.snapshot)
        .expect("prepare plan");

    let mut duplicate = plan.clone();
    duplicate.nodes.push(duplicate.nodes[0].clone());
    reseal(&mut duplicate);
    let error = fixture
        .runtime
        .start(&duplicate, "attempt-dup-nodes")
        .expect_err("duplicate node ids must be rejected");
    assert!(
        error
            .to_string()
            .contains("node ids must be non-empty and unique"),
        "unexpected error: {error}"
    );

    let mut empty_id = plan.clone();
    empty_id.nodes[0].id = "  ".to_string();
    reseal(&mut empty_id);
    let error = fixture
        .runtime
        .start(&empty_id, "attempt-empty-node")
        .expect_err("empty node ids must be rejected");
    assert!(
        error
            .to_string()
            .contains("node ids must be non-empty and unique"),
        "unexpected error: {error}"
    );
}

#[test]
fn start_rejects_owned_staging_cleanup_outside_delivery_stage_nodes() {
    let fixture = fixture();
    let mut plan = fixture
        .runtime
        .prepare(&fixture.snapshot)
        .expect("prepare plan");
    // Build 节点声明 owned-staging 清理：清理能力只属于可取消的
    // DeliveryDestination StageRoutes 节点（ADR-0041）。
    plan.nodes[0].cleanup_owned_staging = true;
    reseal(&mut plan);
    let error = fixture
        .runtime
        .start(&plan, "attempt-cleanup")
        .expect_err("cleanup claims outside delivery staging must fail closed");
    assert!(
        error
            .to_string()
            .contains("may declare owned-staging cleanup only for a cancellable"),
        "unexpected error: {error}"
    );
}

#[test]
fn start_rejects_a_node_depending_on_an_unavailable_earlier_node() {
    let fixture = fixture();
    let mut plan = fixture
        .runtime
        .prepare(&fixture.snapshot)
        .expect("prepare plan");
    // depends_on 只能引用更早的节点：前向引用意味着执行顺序无法保证。
    plan.nodes[0].depends_on = vec!["later-node".to_string()];
    reseal(&mut plan);
    let error = fixture
        .runtime
        .start(&plan, "attempt-forward-dep")
        .expect_err("forward dependencies must fail closed");
    assert!(
        error
            .to_string()
            .contains("depends on unavailable earlier node"),
        "unexpected error: {error}"
    );
}

// ─── preflight_adapter_contracts 矩阵 ───

#[test]
fn start_rejects_an_unregistered_execution_backend() {
    let fixture = fixture();
    let mut plan = fixture
        .runtime
        .prepare(&fixture.snapshot)
        .expect("prepare plan");
    plan.execution_backend =
        AdapterIdentity::new(AdapterKind::ExecutionBackend, "ghost-backend", 1);
    reseal(&mut plan);
    let error = fixture
        .runtime
        .start(&plan, "attempt-ghost-backend")
        .expect_err("unregistered backends must fail closed");
    assert!(
        matches!(error, PublishError::AdapterNotRegistered { .. }),
        "unexpected error: {error}"
    );
}

#[test]
fn start_rejects_duplicate_binding_ids() {
    let fixture = fixture();
    let mut plan = fixture
        .runtime
        .prepare(&fixture.snapshot)
        .expect("prepare plan");
    plan.adapters.push(plan.adapters[0].clone());
    reseal(&mut plan);
    let error = fixture
        .runtime
        .start(&plan, "attempt-dup-binding")
        .expect_err("duplicate binding ids must fail closed");
    assert!(
        error
            .to_string()
            .contains("binding ids must be non-empty and unique"),
        "unexpected error: {error}"
    );
}

#[test]
fn start_rejects_a_plan_missing_its_execution_backend_binding() {
    let fixture = fixture();
    let mut plan = fixture
        .runtime
        .prepare(&fixture.snapshot)
        .expect("prepare plan");
    // 执行后端绑定不在计划绑定集里：凭据与凭据边界无从解析。
    plan.adapters
        .retain(|binding| binding.adapter != plan.execution_backend);
    reseal(&mut plan);
    let error = fixture
        .runtime
        .start(&plan, "attempt-no-backend")
        .expect_err("a plan without its backend binding must fail closed");
    assert!(
        error
            .to_string()
            .contains("execution backend is not present in planned adapter bindings"),
        "unexpected error: {error}"
    );
}

#[test]
fn start_rejects_nodes_that_drift_from_their_sealed_binding() {
    let fixture = fixture();
    let plan = fixture
        .runtime
        .prepare(&fixture.snapshot)
        .expect("prepare plan");

    let mut unknown = plan.clone();
    unknown.nodes[0].binding_id = "ghost-binding".to_string();
    reseal(&mut unknown);
    let error = fixture
        .runtime
        .start(&unknown, "attempt-unknown-binding")
        .expect_err("nodes must reference a sealed binding");
    assert!(
        error.to_string().contains("references unknown binding"),
        "unexpected error: {error}"
    );

    // 节点携带与绑定不同的合法设置：同一 Adapter 的设置漂移同样拒绝。
    let mut mismatched = plan.clone();
    let route_node = mismatched
        .nodes
        .iter_mut()
        .find(|node| node.binding_id == EDGE_ROUTE_ID)
        .expect("route node");
    route_node.settings = route_node.settings.clone().with_value(
        "directory",
        Value::String("/tmp/edge-drifted-directory".to_string()),
    );
    reseal(&mut mismatched);
    let error = fixture
        .runtime
        .start(&mismatched, "attempt-mismatched-node")
        .expect_err("nodes must match their sealed binding exactly");
    assert!(
        error
            .to_string()
            .contains("does not match its sealed adapter binding"),
        "unexpected error: {error}"
    );
}

// ─── 尝试生命周期防线 ───

#[test]
fn start_attempt_rejects_empty_attempt_and_backend_run_ids() {
    let fixture = fixture();
    let prepared = fixture
        .runtime
        .prepare_attempt(&fixture.snapshot)
        .expect("prepare attempt");

    let mut request = start_request("attempt-empty", &fixture.snapshot.source);
    request.attempt_id = "  ".to_string();
    let error = fixture
        .runtime
        .start_attempt(&prepared, request, &AttemptExecutionContext::at(0))
        .expect_err("empty attempt ids must fail closed");
    assert!(
        error.to_string().contains("cannot be empty"),
        "unexpected error: {error}"
    );

    let mut request = start_request("attempt-empty-run", &fixture.snapshot.source);
    request.backend_run_id = String::new();
    let error = fixture
        .runtime
        .start_attempt(&prepared, request, &AttemptExecutionContext::at(0))
        .expect_err("empty backend run ids must fail closed");
    assert!(
        error.to_string().contains("cannot be empty"),
        "unexpected error: {error}"
    );
}

#[test]
fn lifecycle_entries_reject_a_prepared_plan_that_no_longer_matches_its_snapshot() {
    let fixture = fixture();
    let mut prepared = fixture
        .runtime
        .prepare_attempt(&fixture.snapshot)
        .expect("prepare attempt");
    // 封存后的计划漂移：重新规划结果不一致即拒绝，不信任调用方的 Prepared 句柄。
    prepared.plan.routes[0].required = false;
    prepared.plan.digest = prepared
        .plan
        .recomputed_digest()
        .expect("reseal drifted plan");

    let expected = "no longer matches its planning input snapshot";

    let error = fixture
        .runtime
        .start_attempt(
            &prepared,
            start_request("attempt-stale", &fixture.snapshot.source),
            &AttemptExecutionContext::at(0),
        )
        .expect_err("start must reject a stale prepared plan");
    assert!(
        error.to_string().contains(expected),
        "unexpected error: {error}"
    );

    let attempt = publish_domain::ReleaseAttempt {
        version: RELEASE_ATTEMPT_VERSION,
        attempt_id: "attempt-stale".to_string(),
        configuration_revision: "config-revision-1".to_string(),
        planning_snapshot_digest: prepared.plan.snapshot_digest.clone(),
        plan_version: prepared.plan.version,
        plan_digest: prepared.plan.digest.clone(),
        release_identity: ReleaseIdentity::new(
            "edge:app",
            fixture.snapshot.source.clone(),
            "1.0.0",
            "stable",
            None,
        ),
        execution_backend: prepared.plan.execution_backend.clone(),
        runtime_revision: "runner-1".to_string(),
        backend_run_id: "run-attempt-stale".to_string(),
        manifest_digest: None,
    };
    let error = fixture
        .runtime
        .synchronize_attempt(&prepared, &attempt, &[], &[], None)
        .expect_err("synchronize must reject a stale prepared plan");
    assert!(
        error.to_string().contains(expected),
        "unexpected error: {error}"
    );
}

#[test]
fn start_attempt_releases_the_slot_when_header_persistence_fails() {
    struct FailingHeader;
    impl AttemptPersistencePort for FailingHeader {
        fn begin_attempt(
            &self,
            _attempt: &publish_domain::ReleaseAttempt,
        ) -> Result<(), PublishError> {
            Err(PublishError::Execution(
                "simulated header persistence failure".to_string(),
            ))
        }
        fn append_events(
            &self,
            _events: &[publish_domain::PublishEvent],
            _manifest: Option<&publish_domain::ArtifactManifest>,
        ) -> Result<(), PublishError> {
            panic!("event persistence must not run after header failure")
        }
    }

    let fixture = fixture();
    let prepared = fixture
        .runtime
        .prepare_attempt(&fixture.snapshot)
        .expect("prepare attempt");
    let context = AttemptExecutionContext::at(0).with_persistence(Arc::new(FailingHeader));

    let error = fixture
        .runtime
        .start_attempt(
            &prepared,
            start_request("attempt-header", &fixture.snapshot.source),
            &context,
        )
        .expect_err("header persistence failures must surface");
    assert!(
        error.to_string().contains("simulated header persistence"),
        "unexpected error: {error}"
    );

    // 失败已回滚占位：同一 attempt_id 可再次启动，而不是误报 AlreadyStarted。
    let error = fixture
        .runtime
        .start_attempt(
            &prepared,
            start_request("attempt-header", &fixture.snapshot.source),
            &context,
        )
        .expect_err("the retry must reach persistence again");
    assert!(
        error.to_string().contains("simulated header persistence"),
        "unexpected error: {error}"
    );
}

#[test]
fn resume_rejects_identity_drift_and_missing_manifest_evidence() {
    let fixture = fixture();
    let prepared = fixture
        .runtime
        .prepare_attempt(&fixture.snapshot)
        .expect("prepare attempt");
    let mut view = fixture
        .runtime
        .start_attempt(
            &prepared,
            start_request("attempt-resume", &fixture.snapshot.source),
            &AttemptExecutionContext::at(0),
        )
        .expect("start attempt");

    // 尝试身份漂移：续传不得改写已封存计划的身份（ADR-0040）。
    let mut drifted = view.clone();
    drifted.attempt.plan_digest = "f".repeat(64);
    let error = fixture
        .runtime
        .resume_attempt(&prepared, &drifted, &AttemptExecutionContext::at(0))
        .expect_err("identity drift must fail closed");
    assert!(
        error
            .to_string()
            .contains("must keep the publish attempt identity stable"),
        "unexpected error: {error}"
    );

    let mut outdated = view.clone();
    outdated.attempt.version = RELEASE_ATTEMPT_VERSION + 1;
    let error = fixture
        .runtime
        .resume_attempt(&prepared, &outdated, &AttemptExecutionContext::at(0))
        .expect_err("unsupported attempt versions must fail closed");
    assert_eq!(
        error,
        PublishError::UnsupportedAttemptVersion {
            actual: RELEASE_ATTEMPT_VERSION + 1,
            expected: RELEASE_ATTEMPT_VERSION,
        }
    );

    // Manifest 证据缺失：没有封存集合就没有可续传的交付边界。
    view.manifest = None;
    let error = fixture
        .runtime
        .resume_attempt(&prepared, &view, &AttemptExecutionContext::at(0))
        .expect_err("resume without a manifest must fail closed");
    assert_eq!(error, PublishError::MissingArtifactManifest);
}

#[test]
fn resume_rejects_a_manifest_that_the_attempt_never_sealed() {
    let fixture = fixture();
    let prepared = fixture
        .runtime
        .prepare_attempt(&fixture.snapshot)
        .expect("prepare attempt");
    let mut view = fixture
        .runtime
        .start_attempt(
            &prepared,
            start_request("attempt-resume-manifest", &fixture.snapshot.source),
            &AttemptExecutionContext::at(0),
        )
        .expect("start attempt");

    // 视图宣称绑定了另一份 Manifest：续传不得接受不同的封存身份。
    let sealed = view.manifest.clone().expect("sealed manifest");
    view.attempt.manifest_digest = Some("0".repeat(64));
    let error = fixture
        .runtime
        .resume_attempt(&prepared, &view, &AttemptExecutionContext::at(0))
        .expect_err("a foreign manifest binding must fail closed");
    assert!(
        error
            .to_string()
            .contains("does not match the attempt's sealed manifest binding"),
        "unexpected error: {error}"
    );

    // 事件历史从未封存这份 Manifest：视图与归约不一致即拒绝（ADR-0057）。
    view.attempt.manifest_digest = Some(sealed.digest.clone());
    view.events.clear();
    let error = fixture
        .runtime
        .resume_attempt(&prepared, &view, &AttemptExecutionContext::at(0))
        .expect_err("events that never sealed the manifest must fail closed");
    assert!(
        error
            .to_string()
            .contains("did not bind the manifest offered for resume"),
        "unexpected error: {error}"
    );
}

#[test]
fn synchronize_rejects_identity_drift() {
    let fixture = fixture();
    let prepared = fixture
        .runtime
        .prepare_attempt(&fixture.snapshot)
        .expect("prepare attempt");
    let view = fixture
        .runtime
        .start_attempt(
            &prepared,
            start_request("attempt-sync", &fixture.snapshot.source),
            &AttemptExecutionContext::at(0),
        )
        .expect("start attempt");

    let mut drifted = view.attempt.clone();
    drifted.runtime_revision = "runner-2".to_string();
    let error = fixture
        .runtime
        .synchronize_attempt(&prepared, &drifted, &view.events, &[], None)
        .expect_err("synchronization must keep attempt identity stable");
    assert!(
        error
            .to_string()
            .contains("must keep the publish attempt identity stable"),
        "unexpected error: {error}"
    );
}

#[test]
fn cancel_rejects_a_stale_prepared_plan_before_touching_remote_state() {
    let fixture = fixture();
    let mut prepared = fixture
        .runtime
        .prepare_attempt(&fixture.snapshot)
        .expect("prepare attempt");
    let view = fixture
        .runtime
        .start_attempt(
            &prepared,
            start_request("attempt-cancel", &fixture.snapshot.source),
            &AttemptExecutionContext::at(0),
        )
        .expect("start attempt");

    // manifest=None 的视图走 cancel 专属分支；封存计划漂移即拒绝。
    let mut manifestless = view.clone();
    manifestless.manifest = None;
    manifestless.events.clear();
    prepared.plan.nodes.clear();
    prepared.plan.digest = prepared
        .plan
        .recomputed_digest()
        .expect("reseal drifted plan");
    let error = fixture
        .runtime
        .cancel_attempt(&prepared, &manifestless, &AttemptExecutionContext::at(0))
        .expect_err("cancel must reject a stale prepared plan");
    assert!(
        error
            .to_string()
            .contains("no longer matches its planning input snapshot"),
        "unexpected error: {error}"
    );
}

// ─── 输出合并防线：可编程 Destination 直驱 merge_output/admission ───

/// Destination 的输出由 `mode` 设置编程：staging 与 publish 节点各自返回
/// 定制证据，运行时必须在合并边界逐条拒绝漂移（ADR-0039/0056）。
struct ScriptedDestination {
    descriptor: AdapterDescriptor,
}

impl ScriptedDestination {
    const ID: &'static str = "scripted-destination";

    fn new() -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::DeliveryDestination,
                Self::ID,
                1,
                AdapterSchema::new(1)
                    .with_required_string("mode")
                    .with_required_string("directory"),
                PublishingCapability {
                    provides: vec![],
                    requires: vec![CapabilityRequirement::exact("stored-artifact", 1)],
                },
            ),
        }
    }
}

impl AdapterContract for ScriptedDestination {
    fn descriptor(&self) -> &AdapterDescriptor {
        &self.descriptor
    }

    fn default_settings(&self) -> AdapterSettings {
        AdapterSettings::new(1)
            .with_value("mode", Value::String("ok".to_string()))
            .with_value("directory", Value::String("/tmp/scripted".to_string()))
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
                "scripted_stage",
                BTreeMap::new(),
            )
            .with_artifact_io(vec!["artifact-manifest".to_string()], vec![])
            .with_owned_staging_cleanup(),
            PlanNodeTemplate::adapter_action(
                "publish",
                PlanStage::PublishRoutes,
                "scripted_publish",
                BTreeMap::new(),
            )
            .with_artifact_io(vec!["artifact-manifest".to_string()], vec![]),
            PlanNodeTemplate::adapter_action(
                "observe",
                PlanStage::ObserveRoutes,
                "scripted_observe",
                BTreeMap::new(),
            )
            .with_artifact_io(vec!["artifact-manifest".to_string()], vec![]),
        ])
    }

    fn execute_node(
        &self,
        node: &PlanNode,
        context: &AdapterExecutionContext<'_>,
    ) -> Result<AdapterExecutionOutput, PublishError> {
        let manifest = context.manifest.expect("sealed manifest");
        let mode = node
            .settings
            .string("mode", "scripted-destination")
            .expect("declared mode setting")
            .to_string();
        let staged = node.stage == PlanStage::StageRoutes;
        let valid_envelope = || {
            publish_domain::DeliveryEnvelope::new(node.binding_id.clone(), manifest.digest.clone())
                .with_content("note", Value::String("staged".to_string()))
        };
        // ObserveRoutes：submitted-conflict 以分类失败留下 Submitted+error 证据，
        // 供 resume 走「可重试失败 + 幂等探测」分支。
        if node.stage == PlanStage::ObserveRoutes {
            if mode == "submitted-conflict" {
                return Err(PublishError::Classified {
                    failure: publish_domain::PublishFailure {
                        version: publish_domain::PUBLISH_FAILURE_VERSION,
                        category: publish_domain::PublishFailureCategory::Transient,
                        native_code: "transient-observe".to_string(),
                        message: "simulated transient observe failure".to_string(),
                        retry_safe: false,
                        retry_after_seconds: None,
                    },
                });
            }
            return Ok(AdapterExecutionOutput::default());
        }
        let receipt = |revision: u32, reference: &str| publish_domain::DeliveryReceipt {
            revision,
            ..publish_domain::DeliveryReceipt::published(
                "receipt-scripted",
                node.binding_id.clone(),
                manifest.digest.clone(),
                reference,
            )
        };
        let output = match (staged, mode.as_str()) {
            (true, "envelope-route-drift") => AdapterExecutionOutput {
                envelopes: vec![valid_envelope().pipe(|mut envelope| {
                    envelope.route_id = "other-route".to_string();
                    envelope
                })],
                ..AdapterExecutionOutput::default()
            },
            (true, "envelope-manifest-drift") => AdapterExecutionOutput {
                envelopes: vec![valid_envelope().pipe(|mut envelope| {
                    envelope.manifest_digest = "0".repeat(64);
                    envelope
                })],
                ..AdapterExecutionOutput::default()
            },
            (true, "artifacts-on-stage") => AdapterExecutionOutput {
                artifacts: vec![ArtifactCandidate::new(
                    "app",
                    "forged.bin",
                    "application/octet-stream",
                    "test-os",
                    "test-arch",
                    b"forged".to_vec(),
                )],
                envelopes: vec![valid_envelope()],
                ..AdapterExecutionOutput::default()
            },
            (true, "receipts-on-stage") => AdapterExecutionOutput {
                envelopes: vec![valid_envelope()],
                receipts: vec![receipt(1, "local://staged")],
                ..AdapterExecutionOutput::default()
            },
            (true, "cancel-in-stage") | (true, "cancel-in-stage-and-clean") => {
                context.cancellation.request();
                AdapterExecutionOutput {
                    envelopes: vec![valid_envelope()],
                    ..AdapterExecutionOutput::default()
                }
            }
            (true, _) => AdapterExecutionOutput {
                envelopes: vec![valid_envelope()],
                ..AdapterExecutionOutput::default()
            },
            (false, "envelopes-on-publish") => AdapterExecutionOutput {
                envelopes: vec![valid_envelope()],
                ..AdapterExecutionOutput::default()
            },
            (false, "receipt-route-drift") => AdapterExecutionOutput {
                receipts: vec![receipt(1, "local://a").pipe(|mut receipt| {
                    receipt.route_id = "other-route".to_string();
                    receipt
                })],
                ..AdapterExecutionOutput::default()
            },
            (false, "receipt-manifest-drift") => AdapterExecutionOutput {
                receipts: vec![receipt(1, "local://a").pipe(|mut receipt| {
                    receipt.manifest_digest = "0".repeat(64);
                    receipt
                })],
                ..AdapterExecutionOutput::default()
            },
            (false, "receipt-conflict") => AdapterExecutionOutput {
                receipts: vec![receipt(1, "local://a"), receipt(1, "local://conflicting")],
                ..AdapterExecutionOutput::default()
            },
            (false, "receipt-non-continuous") => AdapterExecutionOutput {
                receipts: vec![receipt(1, "local://a"), receipt(3, "local://b")],
                ..AdapterExecutionOutput::default()
            },
            (false, "receipt-initial-not-one") => AdapterExecutionOutput {
                receipts: vec![receipt(2, "local://a")],
                ..AdapterExecutionOutput::default()
            },
            (false, "submitted-conflict") => AdapterExecutionOutput {
                receipts: vec![publish_domain::DeliveryReceipt {
                    status: publish_domain::DeliveryStatus::Submitted,
                    ..receipt(1, "local://delivered-a")
                }],
                ..AdapterExecutionOutput::default()
            },
            (false, "submitted-then-cancel") => {
                context.cancellation.request();
                AdapterExecutionOutput {
                    receipts: vec![publish_domain::DeliveryReceipt {
                        status: publish_domain::DeliveryStatus::Submitted,
                        ..receipt(1, "local://submitted")
                    }],
                    ..AdapterExecutionOutput::default()
                }
            }
            (false, "publish-fails") => {
                return Err(PublishError::Execution(format!(
                    "simulated {} delivery outage",
                    node.binding_id
                )));
            }
            (false, _) => AdapterExecutionOutput {
                receipts: vec![receipt(1, "local://delivered")],
                ..AdapterExecutionOutput::default()
            },
        };
        Ok(output)
    }
}

impl publish_adapters::DeliveryDestination for ScriptedDestination {
    fn validate_staged_envelope(
        &self,
        _node: &PlanNode,
        _context: &AdapterExecutionContext<'_>,
        _envelope: &publish_domain::DeliveryEnvelope,
    ) -> Result<(), PublishError> {
        Ok(())
    }

    fn probe_delivery(
        &self,
        settings: &AdapterSettings,
        _identity: &publish_domain::DeliveryIdempotencyIdentity,
        _credentials: &BTreeMap<String, publish_domain::ResolvedCredential>,
    ) -> Result<publish_adapters::DeliveryProbe, PublishError> {
        // 探测回来的外部引用与已封存 Receipt 的引用不同：reuse 必须拒绝对
        // 另一份远端交付签发修订（ADR-0051）。
        if settings.string("mode", "scripted-destination").ok() == Some("submitted-conflict") {
            return Ok(publish_adapters::DeliveryProbe::Matching {
                external_reference: "local://delivered-b".to_string(),
            });
        }
        Ok(publish_adapters::DeliveryProbe::Unprobeable {
            reason: "scripted destination is not remotely probeable".to_string(),
        })
    }

    fn cleanup_owned_staging(
        &self,
        node: &PlanNode,
        _context: &AdapterExecutionContext<'_>,
    ) -> Result<bool, PublishError> {
        Ok(node.settings.string("mode", "scripted-destination").ok() != Some("cancel-in-stage"))
    }
}

// 轻量函数式 pipe，避免每个臂重复样板。
trait Pipe: Sized {
    fn pipe(self, apply: impl FnOnce(Self) -> Self) -> Self {
        apply(self)
    }
}
impl<T> Pipe for T {}

/// `routes` 形状：(binding_id, mode, required)；路线即计划交付绑定。
fn scripted_fixture(routes: &[(&str, &str, bool)]) -> (EdgeFixture, PreparedPublishPlan) {
    let mut fixture = fixture();
    fixture.snapshot.adapters.delivery_routes = routes
        .iter()
        .map(|(route_id, mode, required)| DeliveryRoute {
            binding: AdapterBinding::new(
                route_id.to_string(),
                AdapterIdentity::new(AdapterKind::DeliveryDestination, ScriptedDestination::ID, 1),
                AdapterSettings::new(1)
                    .with_value("mode", Value::String(mode.to_string()))
                    .with_value(
                        "directory",
                        Value::String(format!("/tmp/scripted-{route_id}")),
                    ),
            ),
            required: *required,
        })
        .collect();
    let conformance = AdapterConformanceFixture::new(fixture.snapshot.clone());
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(Arc::new(EdgeProvider::new()), &conformance)
        .expect("register provider");
    registry
        .register_artifact_processor(Arc::new(EdgeProcessor::new()), &conformance)
        .expect("register processor");
    registry
        .register_execution_backend(Arc::new(LocalExecutionBackend::new()), &conformance)
        .expect("register backend");
    registry
        .register_artifact_store(
            Arc::new(TemporaryArtifactStore::new(fixture._store_dir.path())),
            &conformance,
        )
        .expect("register store");
    registry
        .register_delivery_destination(
            Arc::new(LocalDirectoryDestination::new(fixture._delivery_dir.path())),
            &conformance,
        )
        .expect("register local destination");
    registry
        .register_delivery_destination(Arc::new(ScriptedDestination::new()), &conformance)
        .expect("register scripted destination");
    fixture.runtime = PublishRuntime::new(registry);
    let prepared = fixture
        .runtime
        .prepare_attempt(&fixture.snapshot)
        .expect("prepare scripted attempt");
    (fixture, prepared)
}

fn scripted_route_error(view: &publish_domain::PublishAttemptView) -> String {
    view.routes
        .iter()
        .find(|route| route.route_id == "scripted")
        .and_then(|route| route.error.clone())
        .or_else(|| view.error.clone())
        .expect("scripted route reports its merge rejection")
}

/// 输出准入拒绝是尝试级失败：带 cleanup 声明的阶段节点升级为
/// AttemptStateUncertain，其余记为全局 plan_node_failed 并体现在视图错误。
fn scripted_rejection(mode: &str, attempt: &str) -> String {
    let (fixture, prepared) = scripted_fixture(&[("scripted", mode, true)]);
    match fixture.runtime.start_attempt(
        &prepared,
        start_request(attempt, &fixture.snapshot.source),
        &AttemptExecutionContext::at(0),
    ) {
        Ok(view) => scripted_route_error(&view),
        Err(error) => error.to_string(),
    }
}

#[test]
fn merge_rejects_envelopes_bound_to_other_routes_or_manifests() {
    let error = scripted_rejection("envelope-route-drift", "attempt-envelope-route");
    assert!(
        error.contains("references route other-route"),
        "unexpected error: {error}"
    );

    let error = scripted_rejection("envelope-manifest-drift", "attempt-envelope-manifest");
    assert!(
        error.contains("references manifest"),
        "unexpected error: {error}"
    );
}

#[test]
fn merge_rejects_outputs_the_stage_cannot_admit() {
    // StageRoutes 节点不得改写共享产物集（PersistManifest 之前已封存）。
    let error = scripted_rejection("artifacts-on-stage", "attempt-artifacts-stage");
    assert!(
        error.contains("cannot modify the artifact set"),
        "unexpected error: {error}"
    );

    // Receipt 只能由 PublishRoutes/ObserveRoutes 节点交出。
    let error = scripted_rejection("receipts-on-stage", "attempt-receipts-stage");
    assert!(
        error.contains("cannot emit delivery receipts"),
        "unexpected error: {error}"
    );

    // Envelope 只能由 StageRoutes 节点交出。
    let error = scripted_rejection("envelopes-on-publish", "attempt-envelopes-publish");
    assert!(
        error.contains("cannot stage delivery envelopes"),
        "unexpected error: {error}"
    );
}

#[test]
fn merge_rejects_receipts_bound_to_other_routes_or_manifests() {
    let error = scripted_rejection("receipt-route-drift", "attempt-receipt-route");
    assert!(
        error.contains("references route other-route"),
        "unexpected error: {error}"
    );

    let error = scripted_rejection("receipt-manifest-drift", "attempt-receipt-manifest");
    assert!(
        error.contains("references manifest"),
        "unexpected error: {error}"
    );
}

#[test]
fn merge_rejects_non_monotonic_or_conflicting_receipt_revisions() {
    let error = scripted_rejection("receipt-conflict", "attempt-receipt-conflict");
    assert!(
        error.contains("has conflicting evidence"),
        "unexpected error: {error}"
    );

    let error = scripted_rejection("receipt-non-continuous", "attempt-receipt-gap");
    assert!(
        error.contains("is not continuous after revision"),
        "unexpected error: {error}"
    );

    let error = scripted_rejection("receipt-initial-not-one", "attempt-receipt-initial");
    assert!(
        error.contains("must start at revision 1"),
        "unexpected error: {error}"
    );
}

// ─── 执行边界防线：RogueBackend 直驱 execute_node 防篡改臂 ───

/// 后端不按序执行密封计划而提交伪造节点：executor 必须在边界拒绝
/// （节点不属于计划 / 节点被修改 / 重复执行）。
struct RogueBackend {
    descriptor: AdapterDescriptor,
    mode: String,
}

impl RogueBackend {
    const ID: &'static str = "rogue-backend";

    fn new(mode: &str) -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ExecutionBackend,
                Self::ID,
                1,
                AdapterSchema::new(1),
                PublishingCapability {
                    provides: vec![Capability::new("structured-plan-execution", 1)],
                    requires: vec![],
                },
            ),
            mode: mode.to_string(),
        }
    }
}

impl AdapterContract for RogueBackend {
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

    fn execute_node(
        &self,
        _node: &PlanNode,
        _context: &AdapterExecutionContext<'_>,
    ) -> Result<AdapterExecutionOutput, PublishError> {
        unreachable!("the backend dispatches sealed nodes, it never runs them")
    }

    fn execute_plan(
        &self,
        plan: &PublishPlan,
        executor: &mut dyn publish_adapters::PlanNodeExecutor,
    ) -> Result<(), PublishError> {
        match self.mode.as_str() {
            "foreign-node" => {
                let mut forged = plan.nodes[0].clone();
                forged.id = "forged-node".to_string();
                executor.execute_node(&forged)
            }
            "tampered-node" => {
                let mut tampered = plan.nodes[0].clone();
                tampered.cancellable = !tampered.cancellable;
                executor.execute_node(&tampered)
            }
            "duplicate-node" => {
                executor.execute_node(&plan.nodes[0])?;
                executor.execute_node(&plan.nodes[0])
            }
            _ => publish_adapters::execute_plan_in_order(plan, executor),
        }
    }
}

impl publish_adapters::ExecutionBackend for RogueBackend {}

fn rogue_fixture(mode: &str) -> (EdgeFixture, PublishPlan) {
    let mut fixture = fixture();
    fixture.snapshot.adapters.execution_backend = AdapterBinding::new(
        "backend",
        AdapterIdentity::new(AdapterKind::ExecutionBackend, RogueBackend::ID, 1),
        AdapterSettings::new(1),
    );
    let conformance = AdapterConformanceFixture::new(fixture.snapshot.clone());
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(Arc::new(EdgeProvider::new()), &conformance)
        .expect("register provider");
    registry
        .register_artifact_processor(Arc::new(EdgeProcessor::new()), &conformance)
        .expect("register processor");
    registry
        .register_execution_backend(Arc::new(RogueBackend::new(mode)), &conformance)
        .expect("register rogue backend");
    registry
        .register_artifact_store(
            Arc::new(TemporaryArtifactStore::new(fixture._store_dir.path())),
            &conformance,
        )
        .expect("register store");
    registry
        .register_delivery_destination(
            Arc::new(LocalDirectoryDestination::new(fixture._delivery_dir.path())),
            &conformance,
        )
        .expect("register local destination");
    fixture.runtime = PublishRuntime::new(registry);
    let plan = fixture
        .runtime
        .prepare(&fixture.snapshot)
        .expect("prepare rogue plan");
    (fixture, plan)
}

#[test]
fn executor_rejects_nodes_the_backend_forged_or_replayed() {
    let (fixture, plan) = rogue_fixture("foreign-node");
    let error = fixture
        .runtime
        .start(&plan, "attempt-foreign")
        .expect_err("forged nodes must fail closed");
    assert!(
        error.to_string().contains("is not part of the sealed plan"),
        "unexpected error: {error}"
    );

    let (fixture, plan) = rogue_fixture("tampered-node");
    let error = fixture
        .runtime
        .start(&plan, "attempt-tampered")
        .expect_err("tampered nodes must fail closed");
    assert!(
        error
            .to_string()
            .contains("backend modified sealed plan node"),
        "unexpected error: {error}"
    );

    let (fixture, plan) = rogue_fixture("duplicate-node");
    let error = fixture
        .runtime
        .start(&plan, "attempt-duplicate")
        .expect_err("replayed nodes must fail closed");
    assert!(
        error.to_string().contains("executed more than once"),
        "unexpected error: {error}"
    );
}

// ─── 租约维护端口：成功回调与失败的 AttemptStateUncertain 分类 ───

struct RecordingLeasePort {
    maintained: std::sync::Mutex<Vec<String>>,
    fail_at: Option<usize>,
}

impl publish_runner_core::AttemptLeaseMaintenancePort for RecordingLeasePort {
    fn maintain(&self, attempt_id: &str) -> Result<(), PublishError> {
        let mut calls = self.maintained.lock().expect("lease port lock");
        calls.push(attempt_id.to_string());
        if self.fail_at == Some(calls.len()) {
            return Err(PublishError::Execution(
                "simulated lease maintenance outage".to_string(),
            ));
        }
        Ok(())
    }
}

#[test]
fn lease_maintenance_runs_alongside_execution_and_failures_are_uncertain() {
    // 维护端口随节点执行被调用：证据追加前续约，保证未完成尝试租约不过期。
    let port = Arc::new(RecordingLeasePort {
        maintained: std::sync::Mutex::new(Vec::new()),
        fail_at: None,
    });
    let (fixture, prepared) = scripted_fixture(&[("scripted", "ok", true)]);
    let context = AttemptExecutionContext::at(0).with_lease_maintenance(port.clone());
    let view = fixture
        .runtime
        .start_attempt(
            &prepared,
            start_request("attempt-lease", &fixture.snapshot.source),
            &context,
        )
        .expect("lease-maintained attempt publishes");
    assert_eq!(view.status, publish_domain::PublishAttemptStatus::Published);
    assert!(
        !port.maintained.lock().expect("lock").is_empty(),
        "the maintenance port must be invoked during execution"
    );

    // 维护失败不可伪装成普通路线失败：结果不确定，保护租约不释放。
    let port = Arc::new(RecordingLeasePort {
        maintained: std::sync::Mutex::new(Vec::new()),
        fail_at: Some(1),
    });
    let (fixture, prepared) = scripted_fixture(&[("scripted", "ok", true)]);
    let context = AttemptExecutionContext::at(0).with_lease_maintenance(port);
    let error = fixture
        .runtime
        .start_attempt(
            &prepared,
            start_request("attempt-lease-fail", &fixture.snapshot.source),
            &context,
        )
        .expect_err("lease maintenance failures must be classified uncertain");
    assert!(
        matches!(error, PublishError::AttemptStateUncertain { .. }),
        "unexpected error: {error}"
    );
}

// ─── 取消收尾：owned-staging 清理契约与聚合状态 ───

#[test]
fn cancelled_attempts_require_destinations_to_honor_owned_staging_cleanup() {
    // Stage 节点声明了清理能力：取消收尾必须清理 adapter-owned staging，
    // 返回 false 的目标明确违约（ADR-0041）。
    let (fixture, prepared) = scripted_fixture(&[("scripted", "cancel-in-stage", true)]);
    let error = fixture
        .runtime
        .start_attempt(
            &prepared,
            start_request("attempt-cleanup-breach", &fixture.snapshot.source),
            &AttemptExecutionContext::at(0),
        )
        .expect_err("destinations that refuse cleanup must fail the attempt");
    assert!(
        error
            .to_string()
            .contains("did not honor the sealed owned-staging cleanup capability"),
        "unexpected error: {error}"
    );

    // 履约清理的路线产生 route_staging_cleaned 证据，尝试按取消收尾。
    let (fixture, prepared) = scripted_fixture(&[("scripted", "cancel-in-stage-and-clean", true)]);
    let view = fixture
        .runtime
        .start_attempt(
            &prepared,
            start_request("attempt-cleanup-honored", &fixture.snapshot.source),
            &AttemptExecutionContext::at(0),
        )
        .expect("honored cleanup still settles the cancelled attempt");
    assert_eq!(view.status, publish_domain::PublishAttemptStatus::Cancelled);
    assert!(view
        .events
        .iter()
        .any(|event| event.kind == "route_staging_cleaned"));
}

#[test]
fn a_cancelled_required_route_with_a_submitted_optional_route_aggregates_to_cancelled() {
    // 可选路线已 Submitted（无错误、非 Published），必需路线被取消：
    // 未完成的全部来自取消，聚合状态是 Cancelled 而非 Failed（ADR-0041）。
    let (fixture, prepared) = scripted_fixture(&[
        ("optional-remote", "submitted-then-cancel", false),
        ("required-victim", "ok", true),
    ]);
    let view = fixture
        .runtime
        .start_attempt(
            &prepared,
            start_request("attempt-aggregate-cancel", &fixture.snapshot.source),
            &AttemptExecutionContext::at(0),
        )
        .expect("cancelled attempt settles deterministically");
    assert_eq!(
        view.status,
        publish_domain::PublishAttemptStatus::Cancelled,
        "unexpected view: {view:?}"
    );
}

#[test]
fn attempts_with_only_optional_routes_report_their_failures() {
    // 全部失败但没有必需路线：错误仍须汇总为可诊断的失败清单，
    // 而不是吞掉可选路线的失败原因。
    let (fixture, prepared) = scripted_fixture(&[
        ("first", "publish-fails", false),
        ("second", "publish-fails", false),
    ]);
    let view = fixture
        .runtime
        .start_attempt(
            &prepared,
            start_request("attempt-optional-failures", &fixture.snapshot.source),
            &AttemptExecutionContext::at(0),
        )
        .expect("optional-only attempts still produce a verdict");
    assert_eq!(view.status, publish_domain::PublishAttemptStatus::Failed);
    let error = view.error.expect("aggregated failure message");
    assert!(
        error.contains("first") && error.contains("second"),
        "both optional failures must be listed: {error}"
    );
}

// ─── 续传决策：事件裁剪驱动的 evaluate_failed_routes/reuse_receipt ───

fn completed_view(
    routes: &[(&str, &str, bool)],
    attempt_id: &str,
) -> (
    EdgeFixture,
    PreparedPublishPlan,
    publish_domain::PublishAttemptView,
) {
    let (fixture, prepared) = scripted_fixture(routes);
    let view = fixture
        .runtime
        .start_attempt(
            &prepared,
            start_request(attempt_id, &fixture.snapshot.source),
            &AttemptExecutionContext::at(0),
        )
        .expect("seed attempt completes");
    (fixture, prepared, view)
}

#[test]
fn resume_retries_routes_that_are_pending_without_remote_evidence() {
    // 裁掉 publish/observe 事件与 Receipt：路线 Pending 且无 started publish
    // 证据，意图从未越过外部边界，可安全重试（ADR-0051）。
    let (fixture, prepared, mut view) =
        completed_view(&[("scripted", "ok", true)], "attempt-pending-retry");
    view.events.retain(|event| {
        !event.plan_node_id.starts_with("scripted.publish")
            && !event.plan_node_id.starts_with("scripted.observe")
    });
    view.receipts.clear();
    view.receipt_history.clear();

    let resumed = fixture
        .runtime
        .resume_attempt(&prepared, &view, &AttemptExecutionContext::at(0))
        .expect("a pending route without remote evidence retries safely");
    assert_eq!(
        resumed.status,
        publish_domain::PublishAttemptStatus::Published,
        "unexpected view: {resumed:?}"
    );
    assert!(resumed
        .receipts
        .iter()
        .any(|receipt| receipt.route_id == "scripted"
            && receipt.status == publish_domain::DeliveryStatus::Published));
}

#[test]
fn resume_rejects_nodes_without_completed_evidence() {
    // 裁掉共享处理节点的完成证据但保留可重试路线：续传不得假装该节点
    // 已经执行过——缺失证据即拒绝（ADR-0040）。
    let (fixture, prepared, mut view) =
        completed_view(&[("scripted", "ok", true)], "attempt-missing-evidence");
    view.events.retain(|event| {
        !event.plan_node_id.starts_with("scripted.publish")
            && !event.plan_node_id.starts_with("scripted.observe")
            && event.plan_node_id != "processor.verify"
    });
    // 因果序号必须连续：裁掉中间证据后重排，保持合法事件流。
    for (index, event) in view.events.iter_mut().enumerate() {
        event.sequence = index as u64 + 1;
    }
    view.receipts.clear();
    view.receipt_history.clear();

    let error = fixture
        .runtime
        .resume_attempt(&prepared, &view, &AttemptExecutionContext::at(0))
        .expect_err("nodes without evidence must block resume");
    assert!(
        error
            .to_string()
            .contains("has no completed evidence in the attempt history"),
        "unexpected error: {error}"
    );
}

#[test]
fn resume_rejects_reused_deliveries_bound_to_other_remote_references() {
    // 上次交付的 Receipt 绑定 local://delivered-a；幂等探测回来的远端身份
    // 是 local://delivered-b——reuse 不得把别人的交付当成自己的（ADR-0051）。
    let (fixture, prepared) = scripted_fixture(&[("scripted", "submitted-conflict", true)]);
    let view = fixture
        .runtime
        .start_attempt(
            &prepared,
            start_request("attempt-reuse-mismatch", &fixture.snapshot.source),
            &AttemptExecutionContext::at(0),
        )
        .expect("the seeded attempt completes with a submitted route");
    assert_eq!(view.status, publish_domain::PublishAttemptStatus::Failed);

    let error = fixture
        .runtime
        .resume_attempt(&prepared, &view, &AttemptExecutionContext::at(0))
        .expect_err("a mismatched remote reference must fail closed");
    assert!(
        error
            .to_string()
            .contains("cannot reuse remote delivery local://delivered-b"),
        "unexpected error: {error}"
    );
}
