use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use publish_adapters::{
    AdapterContract, AdapterExecutionContext, ArtifactStore, RetentionHold, TemporaryArtifactStore,
};
use publish_domain::{
    AdapterIdentity, AdapterKind, AdapterSettings, ArtifactCandidate, PlanNode, PlanOperation,
    PlanStage, PublishError,
};
use serde_json::{json, Value};

const RETENTION_EXPIRED: u64 = 0;
/// 约 3170 年：无论测试何时运行，到期时刻都远晚于 SWEEP_NOW。
const RETENTION_LONG: u64 = 100_000_000_000;
/// 位于短保留到期之后、长保留到期之前的清理观察时刻；取远未来，
/// 让判定不依赖测试运行时的系统时间。
const SWEEP_NOW: &str = "2999-01-01T00:00:00Z";
/// 晚于 SWEEP_NOW 的租约有效期，以及租约过期后的第二次清理时刻。
const LEASE_VALID_UNTIL: &str = "3035-01-01T00:00:00Z";
const SWEEP_AFTER_LEASE_EXPIRY: &str = "3040-01-01T00:00:00Z";

static EMPTY_CREDENTIALS: BTreeMap<String, publish_domain::ResolvedCredential> = BTreeMap::new();

fn store_settings(root: &Path, retention_seconds: u64) -> AdapterSettings {
    AdapterSettings::new(1)
        .with_value(
            "root_directory",
            Value::String(root.to_string_lossy().to_string()),
        )
        .with_value("retention_seconds", json!(retention_seconds))
}

fn persist_node(settings: AdapterSettings) -> PlanNode {
    PlanNode {
        id: "store.persist".to_string(),
        stage: PlanStage::PersistManifest,
        adapter: AdapterIdentity::new(AdapterKind::ArtifactStore, "temporary-artifact-store", 1),
        binding_id: "store".to_string(),
        settings,
        operation: PlanOperation::AdapterAction {
            action: "persist_manifest".to_string(),
            inputs: BTreeMap::new(),
        },
        depends_on: vec![],
        artifact_inputs: vec!["artifact:*".to_string()],
        artifact_outputs: vec!["artifact-manifest".to_string()],
        side_effects: vec![],
        cancellable: true,
        cleanup_owned_staging: false,
        irreversible: false,
        platform: publish_domain::PlanNodePlatform::Any,
    }
}

fn artifact(file_name: &str, bytes: &[u8]) -> ArtifactCandidate {
    ArtifactCandidate::new(
        "desktop-installer",
        file_name,
        "application/octet-stream",
        "test-os",
        "test-arch",
        bytes.to_vec(),
    )
}

/// 以给定快照摘要执行一次 persist 节点，返回封存的 Manifest。
fn persist_artifacts(
    store: &TemporaryArtifactStore,
    root: &Path,
    retention_seconds: u64,
    snapshot_digest: &str,
    artifacts: &[ArtifactCandidate],
) -> Result<publish_domain::ArtifactManifest, PublishError> {
    let node = persist_node(store_settings(root, retention_seconds));
    let context = AdapterExecutionContext {
        attempt_id: "attempt-retention",
        plan_digest: "plan-digest",
        snapshot_digest,
        artifacts,
        manifest: None,
        envelopes: &[],
        receipts: &[],
        credentials: &EMPTY_CREDENTIALS,
    };
    let output = store.execute_node(&node, &context)?;
    Ok(output.manifest.expect("persist seals a manifest"))
}

#[test]
fn identical_digests_are_reused_without_rewriting_stored_sets() {
    let root = tempfile::tempdir().expect("store root");
    let store = TemporaryArtifactStore::new(root.path());
    let bytes = b"one-publish retention artifact\n";

    let first = persist_artifacts(
        &store,
        root.path(),
        RETENTION_LONG,
        "snapshot-1",
        &[artifact("app.bin", bytes)],
    )
    .expect("first persist succeeds");

    // 相同内容、相同快照：同一 Manifest digest 幂等复用，记录不被改写。
    let record_path = root
        .path()
        .join("manifests")
        .join(format!("{}.json", first.digest));
    let record_before = fs::read_to_string(&record_path).expect("stored set record exists");
    let second = persist_artifacts(
        &store,
        root.path(),
        RETENTION_LONG,
        "snapshot-1",
        &[artifact("app.bin", bytes)],
    )
    .expect("identical persist reuses the stored set");
    assert_eq!(first.digest, second.digest);
    assert_eq!(
        record_before,
        fs::read_to_string(&record_path).expect("record still readable"),
        "reused artifact sets must not rewrite their stored record"
    );

    // 相同内容、不同快照：产物文件按内容摘要共享，只有一份字节。
    let third = persist_artifacts(
        &store,
        root.path(),
        RETENTION_LONG,
        "snapshot-2",
        &[artifact("app.bin", bytes)],
    )
    .expect("content-addressed reuse across sets");
    assert_ne!(first.digest, third.digest);
    assert_eq!(first.artifacts[0].digest, third.artifacts[0].digest);
    assert_eq!(first.artifacts[0].locator, third.artifacts[0].locator);
}

#[test]
fn conflicting_content_cannot_overwrite_an_existing_artifact() {
    let root = tempfile::tempdir().expect("store root");
    let store = TemporaryArtifactStore::new(root.path());
    let candidate = artifact("app.bin", b"authentic bytes\n");

    // store 中同一内容摘要位置已有不同内容：persist 必须失败且不得覆盖既有文件。
    let artifact_directory = root.path().join(&candidate.digest);
    fs::create_dir_all(&artifact_directory).expect("create artifact directory");
    let stored_path = artifact_directory.join("app.bin");
    fs::write(&stored_path, b"previously stored different bytes\n").expect("seed conflict");

    let error = persist_artifacts(
        &store,
        root.path(),
        RETENTION_LONG,
        "snapshot-1",
        &[candidate],
    )
    .expect_err("digest conflicts must be rejected");
    assert!(matches!(error, PublishError::ArtifactDigestMismatch { .. }));
    assert_eq!(
        fs::read(&stored_path).expect("existing artifact still present"),
        b"previously stored different bytes\n",
        "conflicting persists must never overwrite stored content"
    );
}

#[test]
fn corrupted_set_records_are_rejected_instead_of_overwritten() {
    let root = tempfile::tempdir().expect("store root");
    let store = TemporaryArtifactStore::new(root.path());
    let bytes = b"record conflict artifact\n";

    let manifest = persist_artifacts(
        &store,
        root.path(),
        RETENTION_LONG,
        "snapshot-1",
        &[artifact("app.bin", bytes)],
    )
    .expect("initial persist succeeds");

    let record_path = root
        .path()
        .join("manifests")
        .join(format!("{}.json", manifest.digest));
    fs::write(&record_path, "{\"not\":\"the stored manifest\"}").expect("corrupt record");

    let error = persist_artifacts(
        &store,
        root.path(),
        RETENTION_LONG,
        "snapshot-1",
        &[artifact("app.bin", bytes)],
    )
    .expect_err("corrupted records must surface instead of being overwritten");
    assert!(error.to_string().contains(&manifest.digest));
    assert_eq!(
        fs::read_to_string(&record_path).expect("record untouched"),
        "{\"not\":\"the stored manifest\"}",
        "persist must not silently repair a conflicting stored record"
    );
}

#[test]
fn retention_sweep_reports_expired_and_retained_sets() {
    let root = tempfile::tempdir().expect("store root");
    let store = TemporaryArtifactStore::new(root.path());

    let expired = persist_artifacts(
        &store,
        root.path(),
        RETENTION_EXPIRED,
        "snapshot-expired",
        &[artifact("expired.bin", b"expired artifact bytes\n")],
    )
    .expect("persist expired set");
    let retained = persist_artifacts(
        &store,
        root.path(),
        RETENTION_LONG,
        "snapshot-retained",
        &[artifact("retained.bin", b"retained artifact bytes\n")],
    )
    .expect("persist retained set");

    let report = store
        .enforce_retention(&store_settings(root.path(), RETENTION_LONG), SWEEP_NOW)
        .expect("retention sweep succeeds");

    assert_eq!(report.removed.len(), 1);
    assert_eq!(report.removed[0].manifest_digest, expired.digest);
    assert_eq!(
        report.removed[0].removed_artifacts,
        vec![expired.artifacts[0].digest.clone()]
    );
    assert!(!Path::new(&expired.artifacts[0].locator).exists());
    assert!(!root
        .path()
        .join("manifests")
        .join(format!("{}.json", expired.digest))
        .exists());

    assert_eq!(report.retained.len(), 1);
    assert_eq!(report.retained[0].manifest_digest, retained.digest);
    match &report.retained[0].reason {
        RetentionHold::WithinRetention { retain_until } => {
            assert!(
                retain_until.as_str() > SWEEP_NOW,
                "retention deadline is observable"
            );
        }
        other => panic!("expected WithinRetention, got {other:?}"),
    }
    assert!(Path::new(&retained.artifacts[0].locator).exists());
}

#[test]
fn leased_sets_survive_retention_until_the_lease_expires() {
    let root = tempfile::tempdir().expect("store root");
    let store = TemporaryArtifactStore::new(root.path());
    let settings = store_settings(root.path(), RETENTION_EXPIRED);

    let manifest = persist_artifacts(
        &store,
        root.path(),
        RETENTION_EXPIRED,
        "snapshot-leased",
        &[artifact("leased.bin", b"leased artifact bytes\n")],
    )
    .expect("persist leased set");
    store
        .acquire_artifact_set_lease(
            &settings,
            "attempt-holder",
            &manifest.digest,
            LEASE_VALID_UNTIL,
        )
        .expect("acquire lease");

    // 保留期限已过，但有效租约仍保护产物集合。
    let report = store
        .enforce_retention(&settings, SWEEP_NOW)
        .expect("sweep with active lease");
    assert!(report.removed.is_empty());
    assert_eq!(report.retained.len(), 1);
    match &report.retained[0].reason {
        RetentionHold::LeasedByAttempt {
            attempt_id,
            valid_until,
        } => {
            assert_eq!(attempt_id, "attempt-holder");
            assert_eq!(valid_until, LEASE_VALID_UNTIL);
        }
        other => panic!("expected LeasedByAttempt, got {other:?}"),
    }
    assert!(Path::new(&manifest.artifacts[0].locator).exists());

    // 租约到期后同一集合可以被清理。
    let report = store
        .enforce_retention(&settings, SWEEP_AFTER_LEASE_EXPIRY)
        .expect("sweep after lease expiry");
    assert_eq!(report.removed.len(), 1);
    assert_eq!(report.removed[0].manifest_digest, manifest.digest);
    assert!(!Path::new(&manifest.artifacts[0].locator).exists());
}

#[test]
fn released_leases_no_longer_protect_expired_sets() {
    let root = tempfile::tempdir().expect("store root");
    let store = TemporaryArtifactStore::new(root.path());
    let settings = store_settings(root.path(), RETENTION_EXPIRED);

    let manifest = persist_artifacts(
        &store,
        root.path(),
        RETENTION_EXPIRED,
        "snapshot-released",
        &[artifact("released.bin", b"released artifact bytes\n")],
    )
    .expect("persist set");
    store
        .acquire_artifact_set_lease(
            &settings,
            "attempt-holder",
            &manifest.digest,
            LEASE_VALID_UNTIL,
        )
        .expect("acquire lease");
    store
        .release_artifact_set_lease(&settings, "attempt-holder")
        .expect("release lease");

    let report = store
        .enforce_retention(&settings, SWEEP_NOW)
        .expect("sweep after release");
    assert_eq!(report.removed.len(), 1);
    assert_eq!(report.removed[0].manifest_digest, manifest.digest);
}

#[test]
fn shared_artifacts_survive_while_only_expired_sets_are_removed() {
    let root = tempfile::tempdir().expect("store root");
    let store = TemporaryArtifactStore::new(root.path());
    let shared_bytes = b"shared artifact bytes\n";

    let expired = persist_artifacts(
        &store,
        root.path(),
        RETENTION_EXPIRED,
        "snapshot-expired",
        &[
            artifact("shared.bin", shared_bytes),
            artifact("only-expired.bin", b"bytes unique to the expired set\n"),
        ],
    )
    .expect("persist expired set");
    let retained = persist_artifacts(
        &store,
        root.path(),
        RETENTION_LONG,
        "snapshot-retained",
        &[artifact("shared.bin", shared_bytes)],
    )
    .expect("persist retained set");

    let report = store
        .enforce_retention(&store_settings(root.path(), RETENTION_LONG), SWEEP_NOW)
        .expect("sweep shared artifacts");

    // 过期集合被移除，但与保留集合共享的产物字节必须继续存在。
    assert_eq!(report.removed.len(), 1);
    let shared_digest = &retained.artifacts[0].digest;
    let unique_expired_digest = expired
        .artifacts
        .iter()
        .map(|entry| &entry.digest)
        .find(|digest| digest != &shared_digest)
        .expect("expired set has a unique artifact");
    assert_eq!(
        report.removed[0].removed_artifacts,
        vec![unique_expired_digest.clone()],
        "shared artifacts must not be listed as removed"
    );
    assert!(Path::new(&retained.artifacts[0].locator).exists());
    assert!(!root.path().join(unique_expired_digest).exists());
}

#[test]
fn leases_for_unknown_sets_are_rejected() {
    let root = tempfile::tempdir().expect("store root");
    let store = TemporaryArtifactStore::new(root.path());
    let settings = store_settings(root.path(), RETENTION_LONG);

    let error = store
        .acquire_artifact_set_lease(&settings, "attempt-x", &"a".repeat(64), LEASE_VALID_UNTIL)
        .expect_err("cannot lease an artifact set that was never stored");
    assert!(error.to_string().contains("artifact set"));
}
