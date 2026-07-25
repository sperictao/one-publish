use std::collections::BTreeMap;
use std::sync::Arc;

use publish_adapters::{
    AdapterConformanceFixture, AdapterContract, AdapterExecutionContext, AdapterExecutionOutput,
    AdapterRegistry, ArtifactProcessor, DeliveryDestination, LocalDirectoryDestination,
    LocalExecutionBackend, ProjectProvider, TemporaryArtifactStore,
};
use publish_domain::{
    AdapterBinding, AdapterDescriptor, AdapterIdentity, AdapterKind, AdapterSchema,
    AdapterSelection, AdapterSettings, ArtifactCandidate, Capability, CapabilityRequirement,
    DeliveryRoute, DeliveryStatus, PlanNode, PlanNodeExecutionState, PlanNodeTemplate, PlanRoute,
    PlanStage, PlanningInputSnapshot, PublishAttemptStatus, PublishError, PublishEvent,
    PublishingCapability, ReleaseAttempt, ReleaseIdentity, SourceSnapshot,
    DELIVERY_RECEIPT_VERSION, PLANNING_INPUT_SNAPSHOT_VERSION, PUBLISH_EVENT_VERSION,
    PUBLISH_PLAN_VERSION, RELEASE_ATTEMPT_VERSION,
};
use publish_runner_core::{
    recover_attempt_view, AttemptEventLog, AttemptExecutionContext, PublishRuntime,
    StartPublishAttempt,
};
use serde_json::Value;

const LEDGER_ATTEMPT_ID: &str = "attempt-ledger";
const LEDGER_RUN_ID: &str = "run-ledger";
const LEDGER_PLAN_DIGEST: &str = "plan-ledger";
const FAILING_DESTINATION_ID: &str = "failing-destination";

fn ledger_source() -> SourceSnapshot {
    SourceSnapshot {
        revision: "0123456789abcdef".to_string(),
        workspace_digest: None,
        dirty: false,
        captured_at: "2026-07-25T10:00:00Z".to_string(),
        reproducible: true,
    }
}

fn ledger_attempt() -> ReleaseAttempt {
    ReleaseAttempt {
        version: RELEASE_ATTEMPT_VERSION,
        attempt_id: LEDGER_ATTEMPT_ID.to_string(),
        configuration_revision: "config-revision-1".to_string(),
        planning_snapshot_digest: "snapshot-ledger".to_string(),
        plan_version: PUBLISH_PLAN_VERSION,
        plan_digest: LEDGER_PLAN_DIGEST.to_string(),
        release_identity: ReleaseIdentity::new(
            "ledger-project:app",
            ledger_source(),
            "1.0.0",
            "stable",
            None,
        ),
        execution_backend: AdapterIdentity::new(
            AdapterKind::ExecutionBackend,
            "local-execution",
            1,
        ),
        runtime_revision: "runner-1".to_string(),
        backend_run_id: LEDGER_RUN_ID.to_string(),
        manifest_digest: None,
    }
}

fn ledger_routes() -> Vec<PlanRoute> {
    vec![PlanRoute {
        route_id: "primary".to_string(),
        required: true,
    }]
}

fn open_ledger() -> AttemptEventLog {
    AttemptEventLog::new(&ledger_attempt()).expect("open event ledger")
}

fn ledger_manifest_digest() -> String {
    "c".repeat(64)
}

fn ledger_event(
    sequence: u64,
    plan_node_id: &str,
    kind: &str,
    payload: BTreeMap<String, Value>,
) -> PublishEvent {
    PublishEvent {
        version: PUBLISH_EVENT_VERSION,
        event_id: format!("event-{sequence}"),
        attempt_id: LEDGER_ATTEMPT_ID.to_string(),
        backend_run_id: LEDGER_RUN_ID.to_string(),
        sequence,
        plan_digest: LEDGER_PLAN_DIGEST.to_string(),
        plan_node_id: plan_node_id.to_string(),
        kind: kind.to_string(),
        payload,
    }
}

fn node_completed_event(sequence: u64, plan_node_id: &str) -> PublishEvent {
    ledger_event(
        sequence,
        plan_node_id,
        "plan_node_completed",
        BTreeMap::new(),
    )
}

fn manifest_sealed_event(sequence: u64) -> PublishEvent {
    ledger_event(
        sequence,
        "persist-manifest",
        "plan_node_completed",
        BTreeMap::from([(
            "manifest_digest".to_string(),
            Value::String(ledger_manifest_digest()),
        )]),
    )
}

fn receipt_observed_event(
    sequence: u64,
    receipt_id: &str,
    route_id: &str,
    revision: u32,
    status: DeliveryStatus,
) -> PublishEvent {
    ledger_event(
        sequence,
        &format!("{route_id}.publish"),
        "delivery_receipt_observed",
        BTreeMap::from([(
            "receipt".to_string(),
            serde_json::json!({
                "version": DELIVERY_RECEIPT_VERSION,
                "receipt_id": receipt_id,
                "revision": revision,
                "route_id": route_id,
                "manifest_digest": ledger_manifest_digest(),
                "status": status,
                "external_reference": format!("local://{receipt_id}"),
            }),
        )]),
    )
}

/// 完整因果历史：构建 → 封存 → staging → 发布节点完成 → Receipt 两次修订
/// （Staged → Published），与运行时事件顺序一致。
fn ledger_history() -> Vec<PublishEvent> {
    vec![
        node_completed_event(1, "build"),
        manifest_sealed_event(2),
        node_completed_event(3, "primary.stage"),
        node_completed_event(4, "primary.publish"),
        receipt_observed_event(5, "receipt-primary", "primary", 1, DeliveryStatus::Staged),
        receipt_observed_event(
            6,
            "receipt-primary",
            "primary",
            2,
            DeliveryStatus::Published,
        ),
    ]
}

#[test]
fn causally_out_of_order_events_reduce_to_the_known_sequence() {
    let history = ledger_history();
    let mut ordered = open_ledger();
    ordered.sync(&history).expect("sync ordered history");
    let expected = ordered.reduce(&ledger_routes()).expect("reduce ordered");

    let shuffled = vec![
        history[4].clone(),
        history[1].clone(),
        history[5].clone(),
        history[3].clone(),
        history[0].clone(),
        history[2].clone(),
    ];
    let mut log = open_ledger();
    let report = log.sync(&shuffled).expect("sync shuffled history");
    assert_eq!(report.accepted, 6);
    assert_eq!(report.duplicates, 0);
    assert!(report.missing.is_empty());

    let projection = log.reduce(&ledger_routes()).expect("reduce shuffled");
    assert_eq!(projection, expected);
    assert_eq!(projection.status, PublishAttemptStatus::Published);
    assert_eq!(
        log.events(),
        ledger_history(),
        "the ledger must expose one deduplicated causal sequence"
    );
}

#[test]
fn duplicate_events_change_neither_the_ledger_nor_the_reduction() {
    let history = ledger_history();
    let mut log = open_ledger();
    log.sync(&history).expect("sync history");
    let baseline = log.reduce(&ledger_routes()).expect("reduce baseline");

    let replay = log.sync(&history).expect("replay full history");
    assert_eq!(replay.accepted, 0);
    assert_eq!(replay.duplicates, history.len());

    let single = log.sync(&[history[3].clone()]).expect("replay one event");
    assert_eq!(single.accepted, 0);
    assert_eq!(single.duplicates, 1);

    assert_eq!(
        log.reduce(&ledger_routes()).expect("reduce replayed"),
        baseline
    );
    assert_eq!(log.events().len(), history.len());
}

#[test]
fn conflicting_evidence_for_one_sequence_is_rejected_atomically() {
    let history = ledger_history();
    let mut log = open_ledger();
    log.sync(&history).expect("sync history");
    let baseline = log.reduce(&ledger_routes()).expect("reduce baseline");

    // 同一序号出现不同证据：拒绝而不是 last-write-wins 覆盖。
    let mut forged = receipt_observed_event(
        5,
        "receipt-primary",
        "primary",
        1,
        DeliveryStatus::Published,
    );
    forged.event_id = history[4].event_id.clone();
    let error = log
        .sync(&[forged])
        .expect_err("conflicting evidence must block synchronization");
    assert!(
        error.to_string().contains("conflicting"),
        "unexpected error: {error}"
    );

    // 同一事件身份不能漂移到另一个序号。
    let mut moved = history[4].clone();
    moved.sequence = 7;
    assert!(log.sync(&[moved]).is_err());

    // 被拒绝的批次不留下任何痕迹。
    assert_eq!(
        log.reduce(&ledger_routes()).expect("reduce unchanged"),
        baseline
    );
    assert_eq!(log.events().len(), history.len());
}

#[test]
fn unexplained_sequence_gaps_block_reduction_and_report_missing_ranges() {
    let history = ledger_history();
    let mut log = open_ledger();
    let report = log
        .sync(&[history[0].clone(), history[3].clone()])
        .expect("gapped batches are stored while state advance is blocked");
    assert_eq!(report.accepted, 2);
    assert_eq!(report.missing, vec![(2, 3)]);
    assert_eq!(log.missing_ranges(), vec![(2, 3)]);

    let error = log
        .reduce(&ledger_routes())
        .expect_err("gaps must block the deterministic reduction");
    assert_eq!(
        error,
        PublishError::EventSequenceGap {
            missing: vec![(2, 3)],
        }
    );

    // 补齐缺失范围后同步恢复，归约不再被阻断。
    let filled = log
        .sync(&[
            history[1].clone(),
            history[2].clone(),
            history[4].clone(),
            history[5].clone(),
        ])
        .expect("fill missing ranges");
    assert!(filled.missing.is_empty());
    assert!(log.missing_ranges().is_empty());
    let projection = log.reduce(&ledger_routes()).expect("reduce filled history");
    assert_eq!(projection.status, PublishAttemptStatus::Published);
}

#[test]
fn tail_truncation_is_detected_against_a_declared_high_watermark() {
    let history = ledger_history();
    let mut log = open_ledger();
    log.sync(&[history[0].clone(), history[1].clone(), history[3].clone()])
        .expect("sync truncated history");

    // 账本自身只能看到内部缺口；尾部截断需要对照外部声明的最高序号。
    assert_eq!(log.missing_ranges(), vec![(3, 3)]);
    assert_eq!(log.missing_ranges_through(6), vec![(3, 3), (5, 6)]);
    assert_eq!(log.missing_ranges_through(4), vec![(3, 3)]);

    // 补齐后对照同一高水位不再有缺口。
    log.sync(&[history[2].clone(), history[4].clone(), history[5].clone()])
        .expect("fill history");
    assert!(log.missing_ranges_through(6).is_empty());
}

#[test]
fn incompatible_receipt_revisions_block_the_reduction() {
    let mut incompatible = receipt_observed_event(
        2,
        "receipt-primary",
        "primary",
        1,
        DeliveryStatus::Published,
    );
    if let Some(receipt) = incompatible.payload.get_mut("receipt") {
        receipt["version"] = Value::from(DELIVERY_RECEIPT_VERSION + 1);
    }

    let mut log = open_ledger();
    log.sync(&[manifest_sealed_event(1), incompatible])
        .expect("sync events carrying an incompatible receipt revision");
    let error = log
        .reduce(&ledger_routes())
        .expect_err("incompatible receipt revisions must not be reduced");
    assert!(
        error
            .to_string()
            .contains("invalid immutable revision evidence"),
        "unexpected error: {error}"
    );
}

#[test]
fn incompatible_event_versions_reject_the_whole_batch() {
    let history = ledger_history();
    let mut log = open_ledger();
    log.sync(&history[..2]).expect("sync compatible prefix");

    let mut incompatible = history[2].clone();
    incompatible.version = PUBLISH_EVENT_VERSION + 1;
    let error = log
        .sync(&[history[3].clone(), incompatible])
        .expect_err("incompatible event versions must block synchronization");
    assert_eq!(
        error,
        PublishError::UnsupportedEventVersion {
            actual: PUBLISH_EVENT_VERSION + 1,
            expected: PUBLISH_EVENT_VERSION,
        }
    );
    // 同批的合法事件也不进入账本：同步是原子的。
    assert_eq!(log.events().len(), 2);
}

#[test]
fn foreign_attempt_identities_are_rejected() {
    let mut log = open_ledger();
    let mut foreign = ledger_history()[0].clone();
    foreign.attempt_id = "another-attempt".to_string();
    assert!(log.sync(&[foreign]).is_err());

    let mut foreign_run = ledger_history()[0].clone();
    foreign_run.backend_run_id = "another-run".to_string();
    assert!(log.sync(&[foreign_run]).is_err());

    let mut foreign_plan = ledger_history()[0].clone();
    foreign_plan.plan_digest = "another-plan".to_string();
    assert!(log.sync(&[foreign_plan]).is_err());
}

#[test]
fn receipt_observations_form_immutable_revisions_with_a_current_state() {
    let mut log = open_ledger();
    log.sync(&ledger_history()).expect("sync history");
    let projection = log.reduce(&ledger_routes()).expect("reduce history");

    // 修订历史保留每一次观察；当前状态取最新修订而不覆盖旧修订。
    assert_eq!(
        projection
            .receipt_history
            .iter()
            .map(|receipt| (
                receipt.receipt_id.as_str(),
                receipt.revision,
                receipt.status
            ))
            .collect::<Vec<_>>(),
        vec![
            ("receipt-primary", 1, DeliveryStatus::Staged),
            ("receipt-primary", 2, DeliveryStatus::Published),
        ]
    );
    assert_eq!(projection.receipts.len(), 1);
    assert_eq!(projection.receipts[0].revision, 2);
    assert_eq!(projection.receipts[0].status, DeliveryStatus::Published);

    assert_eq!(
        projection.node_states,
        BTreeMap::from([
            ("build".to_string(), PlanNodeExecutionState::Completed),
            (
                "persist-manifest".to_string(),
                PlanNodeExecutionState::Completed
            ),
            (
                "primary.stage".to_string(),
                PlanNodeExecutionState::Completed
            ),
            (
                "primary.publish".to_string(),
                PlanNodeExecutionState::Completed
            ),
        ])
    );
}

#[test]
fn resynchronizing_older_observations_never_regresses_current_state() {
    let history = ledger_history();
    let mut log = open_ledger();
    log.sync(&history).expect("sync full history");

    // 远端重发只包含较旧 Staged 观察的批次：去重吸收，当前状态保持最新修订。
    let stale_batch = vec![history[4].clone()];
    let report = log.sync(&stale_batch).expect("resynchronize stale batch");
    assert_eq!(report.accepted, 0);
    assert_eq!(report.duplicates, 1);

    let projection = log.reduce(&ledger_routes()).expect("reduce after resync");
    assert_eq!(projection.receipts[0].revision, 2);
    assert_eq!(projection.receipts[0].status, DeliveryStatus::Published);
    assert_eq!(projection.receipt_history.len(), 2);
}

#[test]
fn recovery_rejects_incompatible_attempt_records_and_foreign_events() {
    let mut incompatible = ledger_attempt();
    incompatible.version = RELEASE_ATTEMPT_VERSION + 1;
    assert_eq!(
        recover_attempt_view(&incompatible, &ledger_routes(), &ledger_history())
            .expect_err("incompatible attempt records must not be reduced"),
        PublishError::UnsupportedAttemptVersion {
            actual: RELEASE_ATTEMPT_VERSION + 1,
            expected: RELEASE_ATTEMPT_VERSION,
        }
    );
    // 直接打开账本同样被版本门禁拦下。
    assert!(AttemptEventLog::new(&incompatible).is_err());

    let mut foreign = ledger_history();
    for event in &mut foreign {
        event.attempt_id = "another-attempt".to_string();
    }
    assert!(recover_attempt_view(&ledger_attempt(), &ledger_routes(), &foreign).is_err());
}

#[test]
fn recovery_enforces_the_write_once_manifest_binding() {
    // 持久化的 Attempt 已绑定另一份 Manifest：事件不得改写这一次性绑定（ADR-0040）。
    let mut promoted = ledger_attempt();
    promoted.manifest_digest = Some("d".repeat(64));
    let error = recover_attempt_view(&promoted, &ledger_routes(), &ledger_history())
        .expect_err("conflicting manifest bindings must fail recovery");
    assert!(
        error.to_string().contains("manifest"),
        "unexpected error: {error}"
    );

    // 一致的绑定正常恢复。
    let mut bound = ledger_attempt();
    bound.manifest_digest = Some(ledger_manifest_digest());
    let view = recover_attempt_view(&bound, &ledger_routes(), &ledger_history())
        .expect("recover with a consistent binding");
    assert_eq!(view.attempt.manifest_digest, Some(ledger_manifest_digest()));
}

#[test]
fn recovery_validates_receipt_manifest_references_against_a_promoted_binding() {
    // 产物推广在创建时固定 Manifest：事件历史可以只包含交付观察，
    // 但 Receipt 引用的 Manifest 摘要必须与固定绑定一致（ADR-0040/0057）。
    let observation_only = vec![
        node_completed_event(1, "primary.stage"),
        node_completed_event(2, "primary.publish"),
        receipt_observed_event(
            3,
            "receipt-primary",
            "primary",
            1,
            DeliveryStatus::Published,
        ),
    ];

    let mut promoted = ledger_attempt();
    promoted.manifest_digest = Some(ledger_manifest_digest());
    let view = recover_attempt_view(&promoted, &ledger_routes(), &observation_only)
        .expect("recover a promoted attempt from delivery observations");
    assert_eq!(view.attempt.manifest_digest, Some(ledger_manifest_digest()));
    assert_eq!(view.status, PublishAttemptStatus::Published);

    let mut conflicting = ledger_attempt();
    conflicting.manifest_digest = Some("e".repeat(64));
    let error = recover_attempt_view(&conflicting, &ledger_routes(), &observation_only)
        .expect_err("receipts referencing another manifest must fail recovery");
    assert!(
        error.to_string().contains("manifest"),
        "unexpected error: {error}"
    );
}

/// 构建一次真实发布的 Provider：单个 build 节点输出一个安装包产物。
struct RecoveryProjectProvider {
    descriptor: AdapterDescriptor,
}

impl RecoveryProjectProvider {
    fn new() -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ProjectProvider,
                "recovery-project",
                1,
                AdapterSchema::new(1),
                PublishingCapability {
                    provides: vec![Capability::new("artifact-candidate", 1)],
                    requires: vec![CapabilityRequirement::exact("structured-plan-execution", 1)],
                },
            )
            .with_allowed_program("recovery-project:builder"),
        }
    }
}

impl AdapterContract for RecoveryProjectProvider {
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
            "recovery-project:builder",
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
                b"one-publish recovery artifact\n".to_vec(),
            )],
            ..AdapterExecutionOutput::default()
        })
    }
}

impl ProjectProvider for RecoveryProjectProvider {}

/// 满足产物存储 capability 链的最小验证处理器。
struct RecoveryArtifactProcessor {
    descriptor: AdapterDescriptor,
}

impl RecoveryArtifactProcessor {
    fn new() -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ArtifactProcessor,
                "recovery-verifier",
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

impl AdapterContract for RecoveryArtifactProcessor {
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

impl ArtifactProcessor for RecoveryArtifactProcessor {}

/// 在 StageRoutes 节点直接失败的交付目标：恢复必须重建路线隔离结果。
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
                PublishingCapability {
                    provides: vec![],
                    requires: vec![CapabilityRequirement::exact("stored-artifact", 1)],
                },
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

struct RecoveryFixture {
    runtime: PublishRuntime,
    snapshot: PlanningInputSnapshot,
    _store_dir: tempfile::TempDir,
    _delivery_dir: tempfile::TempDir,
}

fn recovery_fixture(routes: &[(&str, &str, bool)]) -> RecoveryFixture {
    let store_dir = tempfile::tempdir().expect("create temporary store");
    let delivery_dir = tempfile::tempdir().expect("create delivery parent");

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
        source: ledger_source(),
        external_preconditions: BTreeMap::new(),
        promoted_manifest_digest: None,
        adapters: AdapterSelection {
            project_provider: AdapterBinding::new(
                "project",
                AdapterIdentity::new(AdapterKind::ProjectProvider, "recovery-project", 1),
                empty.clone(),
            ),
            artifact_processors: vec![AdapterBinding::new(
                "processor",
                AdapterIdentity::new(AdapterKind::ArtifactProcessor, "recovery-verifier", 1),
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
        .register_project_provider(Arc::new(RecoveryProjectProvider::new()), &fixture)
        .expect("register recovery provider");
    registry
        .register_artifact_processor(Arc::new(RecoveryArtifactProcessor::new()), &fixture)
        .expect("register recovery processor");
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

    RecoveryFixture {
        runtime: PublishRuntime::new(registry),
        snapshot,
        _store_dir: store_dir,
        _delivery_dir: delivery_dir,
    }
}

/// 跨重启恢复：运行一次真实发布，然后仅凭首个不可逆操作前持久化的
/// Attempt 记录与事件历史重建当前状态（PublishRuntime 主验收缝）。
fn run_and_recover(
    routes: &[(&str, &str, bool)],
    attempt_id: &str,
) -> (
    publish_domain::PublishAttemptView,
    publish_domain::PublishAttemptView,
) {
    let fixture = recovery_fixture(routes);
    let prepared = fixture
        .runtime
        .prepare_attempt(&fixture.snapshot)
        .expect("prepare recovery attempt");
    let view = fixture
        .runtime
        .start_attempt(
            &prepared,
            StartPublishAttempt::new(
                attempt_id,
                format!("run-{attempt_id}"),
                ReleaseIdentity::new(
                    "recovery-project:app",
                    fixture.snapshot.source.clone(),
                    "1.0.0",
                    "stable",
                    None,
                ),
            ),
            &AttemptExecutionContext::at(0),
        )
        .expect("start recovery attempt");

    // 重启前持久化的 Attempt 记录：Manifest 绑定开始为空（ADR-0010/0040）。
    let persisted = ReleaseAttempt {
        manifest_digest: None,
        ..view.attempt.clone()
    };
    let recovered = recover_attempt_view(&persisted, &prepared.plan.routes, &view.events)
        .expect("recover attempt after control-plane restart");
    (view, recovered)
}

fn assert_recovered_matches(
    view: &publish_domain::PublishAttemptView,
    recovered: &publish_domain::PublishAttemptView,
) {
    assert_eq!(recovered.attempt, view.attempt);
    assert_eq!(recovered.status, view.status);
    assert_eq!(recovered.events, view.events);
    assert_eq!(recovered.receipts, view.receipts);
    assert_eq!(recovered.receipt_history, view.receipt_history);
    assert_eq!(recovered.node_states, view.node_states);
    assert_eq!(recovered.routes, view.routes);
    assert_eq!(recovered.warnings, view.warnings);
    assert_eq!(recovered.error, view.error);
    // Manifest 本体不在事件里；恢复后按 digest 由产物存储另行验证（ADR-0057）。
    assert!(recovered.manifest.is_none());
}

#[test]
fn control_plane_restart_recovers_a_published_attempt_from_events() {
    let (view, recovered) = run_and_recover(
        &[
            ("primary", "local-directory", true),
            ("mirror", "local-directory", false),
        ],
        "attempt-restart-published",
    );

    assert_eq!(view.status, PublishAttemptStatus::Published);
    assert_recovered_matches(&view, &recovered);

    let manifest_digest = view
        .manifest
        .as_ref()
        .expect("sealed manifest")
        .digest
        .clone();
    assert_eq!(recovered.attempt.manifest_digest, Some(manifest_digest));
    assert_eq!(recovered.receipts.len(), 2);
    // 事件观察到的节点全部恢复为已完成。
    assert!(recovered
        .node_states
        .values()
        .all(|state| *state == PlanNodeExecutionState::Completed));
    assert!(recovered.node_states.contains_key("project.build"));
    assert!(recovered.node_states.contains_key("primary.publish"));
    assert!(recovered.node_states.contains_key("mirror.publish"));
}

#[test]
fn control_plane_restart_recovers_partial_delivery_from_events() {
    let (view, recovered) = run_and_recover(
        &[
            ("primary", FAILING_DESTINATION_ID, true),
            ("mirror", "local-directory", false),
        ],
        "attempt-restart-partial",
    );

    assert_eq!(view.status, PublishAttemptStatus::PartialDelivery);
    assert_recovered_matches(&view, &recovered);

    assert_eq!(
        recovered.node_states.get("primary.stage"),
        Some(&PlanNodeExecutionState::Failed)
    );
    let failed_route = recovered
        .routes
        .iter()
        .find(|route| route.route_id == "primary")
        .expect("failed route view");
    assert_eq!(failed_route.status, DeliveryStatus::Failed);
    assert!(failed_route
        .error
        .as_deref()
        .is_some_and(|error| error.contains("simulated delivery failure")));
}
