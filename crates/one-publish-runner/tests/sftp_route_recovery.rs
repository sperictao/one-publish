//! Issue T17 验收：SFTP 路线经 PublishRuntime 的分类失败、幂等探测与安全
//! 续传链路——网络中断后只重试失败路线且不重新构建；远端被另一份发布占用
//! 或失败分类不具备资格时，自动重试明确阻断（ADR-0051/0056）。

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use publish_adapters::{
    AdapterConformanceFixture, AdapterContract, AdapterExecutionContext, AdapterExecutionOutput,
    AdapterRegistry, FakeSftpServer, LocalExecutionBackend, ProjectProvider,
    SftpDeliveryDestination, StaticCredentialSource, TemporaryArtifactStore,
    ARTIFACT_CANDIDATE_CAPABILITY, ARTIFACT_VERIFIED_CAPABILITY, SFTP_DELIVERY_RECORD_NAME,
    STRUCTURED_PLAN_EXECUTION_CAPABILITY,
};
use publish_domain::{
    AdapterBinding, AdapterDescriptor, AdapterIdentity, AdapterKind, AdapterSchema,
    AdapterSelection, AdapterSettings, ArtifactCandidate, Capability, CapabilityRequirement,
    CredentialKind, DeliveryRoute, DeliveryStatus, PlanNode, PlanNodeTemplate, PlanStage,
    PlanningInputSnapshot, PublishAttemptStatus, PublishError, PublishFailureCategory,
    PublishingCapability, ReleaseIdentity, SourceSnapshot, PLANNING_INPUT_SNAPSHOT_VERSION,
};
use publish_runner_core::{AttemptExecutionContext, PublishRuntime, StartPublishAttempt};
use serde_json::Value;

const ARTIFACT_BYTES: &[u8] = b"sftp recovery artifact";
const KEY_REFERENCE: &str = "release-server-key";
const KEY_VALUE: &str =
    "-----BEGIN OPENSSH PRIVATE KEY-----\nrecovery-key\n-----END OPENSSH PRIVATE KEY-----";
const ROUTE_ID: &str = "sftp-release-route";

fn record_path() -> String {
    format!("srv/releases/1.0.0/{SFTP_DELIVERY_RECORD_NAME}")
}

/// 计数构建的最小 Provider：断言续传只重试失败路线、从不重新构建。
struct CountingProvider {
    descriptor: AdapterDescriptor,
    builds: Arc<AtomicUsize>,
}

impl CountingProvider {
    fn new(builds: Arc<AtomicUsize>) -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ProjectProvider,
                "counting-project",
                1,
                AdapterSchema::new(1),
                PublishingCapability {
                    provides: vec![
                        Capability::new(ARTIFACT_CANDIDATE_CAPABILITY, 1),
                        Capability::new(ARTIFACT_VERIFIED_CAPABILITY, 1),
                    ],
                    requires: vec![CapabilityRequirement::exact(
                        STRUCTURED_PLAN_EXECUTION_CAPABILITY,
                        1,
                    )],
                },
            ),
            builds,
        }
    }
}

impl AdapterContract for CountingProvider {
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
            "build",
            PlanStage::Build,
            "build_counting_artifact",
            BTreeMap::new(),
        )
        .with_artifact_io(vec![], vec!["installer".to_string()])])
    }

    fn execute_node(
        &self,
        _node: &PlanNode,
        _context: &AdapterExecutionContext<'_>,
    ) -> Result<AdapterExecutionOutput, PublishError> {
        self.builds.fetch_add(1, Ordering::SeqCst);
        Ok(AdapterExecutionOutput {
            artifacts: vec![ArtifactCandidate::new(
                "installer",
                "app.bin",
                "application/octet-stream",
                "linux",
                "x86_64",
                ARTIFACT_BYTES.to_vec(),
            )],
            ..AdapterExecutionOutput::default()
        })
    }
}

impl ProjectProvider for CountingProvider {}

struct RecoveryFixture {
    runtime: PublishRuntime,
    snapshot: PlanningInputSnapshot,
    server: Arc<FakeSftpServer>,
    builds: Arc<AtomicUsize>,
    _store: tempfile::TempDir,
}

fn recovery_fixture() -> RecoveryFixture {
    let store = tempfile::tempdir().expect("store root");
    let server = Arc::new(FakeSftpServer::new());
    let builds = Arc::new(AtomicUsize::new(0));
    let snapshot = PlanningInputSnapshot {
        version: PLANNING_INPUT_SNAPSHOT_VERSION,
        configuration_revision: "configuration-revision-1".to_string(),
        runtime_revision: "runtime-revision-1".to_string(),
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
                AdapterIdentity::new(AdapterKind::ProjectProvider, "counting-project", 1),
                AdapterSettings::new(1),
            ),
            artifact_processors: vec![],
            execution_backend: AdapterBinding::new(
                "backend",
                AdapterIdentity::new(AdapterKind::ExecutionBackend, "local-execution", 1),
                AdapterSettings::new(1),
            ),
            artifact_store: AdapterBinding::new(
                "store",
                AdapterIdentity::new(AdapterKind::ArtifactStore, "temporary-artifact-store", 1),
                AdapterSettings::new(1)
                    .with_value(
                        "root_directory",
                        Value::String(store.path().to_string_lossy().to_string()),
                    )
                    .with_value("retention_seconds", Value::from(604_800u64)),
            ),
            delivery_routes: vec![DeliveryRoute::required(
                AdapterBinding::new(
                    ROUTE_ID,
                    AdapterIdentity::new(AdapterKind::DeliveryDestination, "sftp", 1),
                    AdapterSettings::new(1)
                        .with_value("host", Value::String("files.example.com".to_string()))
                        .with_value("port", Value::from(22u64))
                        .with_value("username", Value::String("deploy".to_string()))
                        .with_value("remote_path", Value::String("/srv/releases".to_string()))
                        .with_value(
                            "artifact_roles",
                            Value::Array(vec![Value::String("installer".to_string())]),
                        ),
                )
                .with_credential("ssh_private_key", KEY_REFERENCE),
            )],
        },
    };

    let fixture = AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(Arc::new(CountingProvider::new(builds.clone())), &fixture)
        .expect("register counting provider");
    registry
        .register_execution_backend(
            Arc::new(LocalExecutionBackend::with_credential_source(Arc::new(
                StaticCredentialSource::new().with_secret(
                    KEY_REFERENCE,
                    CredentialKind::SshPrivateKey,
                    KEY_VALUE,
                ),
            ))),
            &fixture,
        )
        .expect("register execution backend");
    registry
        .register_artifact_store(
            Arc::new(TemporaryArtifactStore::new(store.path())),
            &fixture,
        )
        .expect("register artifact store");
    registry
        .register_delivery_destination(
            Arc::new(SftpDeliveryDestination::new(server.clone())),
            &fixture,
        )
        .expect("register sftp destination");

    RecoveryFixture {
        runtime: PublishRuntime::new(registry),
        snapshot,
        server,
        builds,
        _store: store,
    }
}

fn start_attempt(
    fixture: &RecoveryFixture,
    attempt_id: &str,
) -> (
    publish_runner_core::PreparedPublishPlan,
    publish_domain::PublishAttemptView,
) {
    let prepared = fixture
        .runtime
        .prepare_attempt(&fixture.snapshot)
        .expect("prepare attempt");
    let view = fixture
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
            &AttemptExecutionContext::at(0),
        )
        .expect("start attempt");
    (prepared, view)
}

/// 断线恢复：网络中断留下部分写入，分类为 Transient；续传先经幂等探测确认
/// 远端安全（Absent），随后只重试失败路线——构建与封存不再执行。
#[test]
fn network_interruptions_resume_the_sftp_route_without_rebuilding() {
    let fixture = recovery_fixture();
    fixture.server.fail_next_write_after(3);

    let (prepared, view) = start_attempt(&fixture, "attempt-sftp-recovery");
    assert_eq!(view.status, PublishAttemptStatus::Failed);
    let route = &view.routes[0];
    assert_eq!(
        route.failure.as_ref().expect("classified failure").category,
        PublishFailureCategory::Transient
    );
    assert_eq!(fixture.builds.load(Ordering::SeqCst), 1);

    let resumed = fixture
        .runtime
        .resume_attempt(&prepared, &view, &AttemptExecutionContext::at(0))
        .expect("resume the interrupted delivery");
    assert_eq!(resumed.status, PublishAttemptStatus::Published);
    let receipt = resumed.receipts.last().expect("observed receipt");
    assert_eq!(receipt.status, DeliveryStatus::Published);
    assert_eq!(
        receipt.external_reference,
        "sftp://deploy@files.example.com:22/srv/releases/1.0.0"
    );

    // 续传只重试失败路线：构建仍然只发生一次，远端交付完整且没有残留。
    assert_eq!(fixture.builds.load(Ordering::SeqCst), 1);
    assert_eq!(
        fixture.server.file("srv/releases/1.0.0/app.bin"),
        Some(ARTIFACT_BYTES.to_vec())
    );
    assert!(fixture
        .server
        .paths()
        .iter()
        .all(|path| !path.ends_with(".part")));

    // 事件、Receipt 与失败信息全程不携带解析后的私钥（ADR-0029）。
    for view in [&view, &resumed] {
        let events = serde_json::to_string(&view.events).expect("events serialize");
        assert!(!events.contains(KEY_VALUE));
        let receipts = serde_json::to_string(&view.receipt_history).expect("receipts serialize");
        assert!(!receipts.contains(KEY_VALUE));
        for route in &view.routes {
            if let Some(error) = &route.error {
                assert!(!error.contains(KEY_VALUE));
            }
        }
    }
}

/// 远端在中断后被另一份发布占用：幂等探测报告 Conflicting，自动重试阻断，
/// 已有远端内容不被覆盖。
#[test]
fn conflicting_remote_takeovers_block_the_resume_after_a_transient_failure() {
    let fixture = recovery_fixture();
    fixture.server.fail_next_write_after(3);
    let (prepared, view) = start_attempt(&fixture, "attempt-sftp-takeover");
    assert_eq!(view.status, PublishAttemptStatus::Failed);

    let foreign = b"{\"manifest_digest\":\"another-release\",\"files\":{}}";
    fixture.server.seed_file(&record_path(), foreign);

    let error = fixture
        .runtime
        .resume_attempt(&prepared, &view, &AttemptExecutionContext::at(0))
        .expect_err("conflicting remote state must block the resume");
    match &error {
        PublishError::AutomaticRetryBlocked { reasons } => {
            assert!(reasons.iter().any(|reason| reason.contains("conflicts")));
        }
        other => panic!("expected a blocked resume, got {other}"),
    }
    assert_eq!(fixture.server.file(&record_path()), Some(foreign.to_vec()));
}

/// 内容冲突分类没有自动重试资格：续传直接按分类阻断，无需触碰远端。
#[test]
fn conflict_classified_failures_are_not_eligible_for_automatic_retry() {
    let fixture = recovery_fixture();
    fixture
        .server
        .seed_file(&record_path(), b"not written by this delivery");

    let (prepared, view) = start_attempt(&fixture, "attempt-sftp-conflict");
    assert_eq!(view.status, PublishAttemptStatus::Failed);
    let route = &view.routes[0];
    assert_eq!(
        route.failure.as_ref().expect("classified failure").category,
        PublishFailureCategory::Conflict
    );

    let error = fixture
        .runtime
        .resume_attempt(&prepared, &view, &AttemptExecutionContext::at(0))
        .expect_err("conflict failures are not retry eligible");
    match &error {
        PublishError::AutomaticRetryBlocked { reasons } => {
            assert!(reasons
                .iter()
                .any(|reason| reason.contains("conflict failures are not eligible")));
        }
        other => panic!("expected a blocked resume, got {other}"),
    }
    // 远端内容原样保留；交付记录名保持被占用状态。
    assert_eq!(
        fixture.server.file(&record_path()),
        Some(b"not written by this delivery".to_vec())
    );
}
