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
            .with_artifact_io(vec!["artifact-manifest".to_string()], vec![]),
            PlanNodeTemplate::adapter_action(
                "publish",
                PlanStage::PublishRoutes,
                "scripted_publish",
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
            (false, _) => AdapterExecutionOutput {
                receipts: vec![receipt(1, "local://delivered")],
                ..AdapterExecutionOutput::default()
            },
        };
        Ok(output)
    }
}

impl publish_adapters::DeliveryDestination for ScriptedDestination {}

// 轻量函数式 pipe，避免每个臂重复样板。
trait Pipe: Sized {
    fn pipe(self, apply: impl FnOnce(Self) -> Self) -> Self {
        apply(self)
    }
}
impl<T> Pipe for T {}

fn scripted_fixture(mode: &str) -> (EdgeFixture, PreparedPublishPlan) {
    let mut fixture = fixture();
    fixture
        .snapshot
        .adapters
        .delivery_routes
        .push(DeliveryRoute::required(AdapterBinding::new(
            "scripted",
            AdapterIdentity::new(AdapterKind::DeliveryDestination, ScriptedDestination::ID, 1),
            AdapterSettings::new(1)
                .with_value("mode", Value::String(mode.to_string()))
                .with_value(
                    "directory",
                    Value::String("/tmp/scripted-delivery".to_string()),
                ),
        )));
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

fn run_scripted(mode: &str, attempt: &str) -> publish_domain::PublishAttemptView {
    let (fixture, prepared) = scripted_fixture(mode);
    fixture
        .runtime
        .start_attempt(
            &prepared,
            start_request(attempt, &fixture.snapshot.source),
            &AttemptExecutionContext::at(0),
        )
        .expect("scripted attempt completes with route-level failure")
}

fn scripted_route_error(view: &publish_domain::PublishAttemptView) -> String {
    view.routes
        .iter()
        .find(|route| route.route_id == "scripted")
        .and_then(|route| route.error.clone())
        .or_else(|| view.error.clone())
        .expect("scripted route reports its merge rejection")
}

#[test]
fn merge_rejects_envelopes_bound_to_other_routes_or_manifests() {
    let view = run_scripted("envelope-route-drift", "attempt-envelope-route");
    assert!(
        scripted_route_error(&view).contains("references route other-route"),
        "unexpected view: {view:?}"
    );

    let view = run_scripted("envelope-manifest-drift", "attempt-envelope-manifest");
    assert!(
        scripted_route_error(&view).contains("references manifest"),
        "unexpected view: {view:?}"
    );
}

#[test]
fn merge_rejects_outputs_the_stage_cannot_admit() {
    // StageRoutes 节点不得改写共享产物集（PersistManifest 之前已封存）。
    let view = run_scripted("artifacts-on-stage", "attempt-artifacts-stage");
    assert!(
        scripted_route_error(&view).contains("cannot modify the artifact set"),
        "unexpected view: {view:?}"
    );

    // Receipt 只能由 PublishRoutes/ObserveRoutes 节点交出。
    let view = run_scripted("receipts-on-stage", "attempt-receipts-stage");
    assert!(
        scripted_route_error(&view).contains("cannot emit delivery receipts"),
        "unexpected view: {view:?}"
    );

    // Envelope 只能由 StageRoutes 节点交出。
    let view = run_scripted("envelopes-on-publish", "attempt-envelopes-publish");
    assert!(
        scripted_route_error(&view).contains("cannot stage delivery envelopes"),
        "unexpected view: {view:?}"
    );
}

#[test]
fn merge_rejects_receipts_bound_to_other_routes_or_manifests() {
    let view = run_scripted("receipt-route-drift", "attempt-receipt-route");
    assert!(
        scripted_route_error(&view).contains("references route other-route"),
        "unexpected view: {view:?}"
    );

    let view = run_scripted("receipt-manifest-drift", "attempt-receipt-manifest");
    assert!(
        scripted_route_error(&view).contains("references manifest"),
        "unexpected view: {view:?}"
    );
}

#[test]
fn merge_rejects_non_monotonic_or_conflicting_receipt_revisions() {
    let view = run_scripted("receipt-conflict", "attempt-receipt-conflict");
    assert!(
        scripted_route_error(&view).contains("has conflicting evidence"),
        "unexpected view: {view:?}"
    );

    let view = run_scripted("receipt-non-continuous", "attempt-receipt-gap");
    assert!(
        scripted_route_error(&view).contains("is not continuous after revision"),
        "unexpected view: {view:?}"
    );

    let view = run_scripted("receipt-initial-not-one", "attempt-receipt-initial");
    assert!(
        scripted_route_error(&view).contains("must start at revision 1"),
        "unexpected view: {view:?}"
    );
}
