//! 本地 Adapter 的错误与探测分支（Issue #223）：Promotion 绑定在集合记录
//! 缺失/篡改时显式 Unresumable，租约与保留时钟拒绝畸形输入，交付探测按
//! 幂等身份区分 Absent/Matching/Conflicting（ADR-0038/0040/0051/0055）。

use std::collections::BTreeMap;
use std::fs;

use publish_adapters::{
    AdapterContract, AdapterExecutionContext, ArtifactStore, CancellationSignal,
    DeliveryDestination, DeliveryProbe, LocalDirectoryDestination, LocalExecutionBackend,
    TemporaryArtifactStore,
};
use publish_domain::{
    sha256_hex, AdapterIdentity, AdapterKind, AdapterSettings, ArtifactCandidate, ArtifactManifest,
    ArtifactManifestEntry, DeliveryEnvelope, DeliveryIdempotencyIdentity, PlanNode,
    PlanNodePlatform, PlanOperation, PlanStage, PublishError, ReleaseIdentity, SourceSnapshot,
};
use serde_json::Value;
use tempfile::TempDir;

static EMPTY_CREDENTIALS: BTreeMap<String, publish_domain::ResolvedCredential> = BTreeMap::new();

fn plan_node(
    adapter: &dyn AdapterContract,
    stage: PlanStage,
    settings: AdapterSettings,
    operation: PlanOperation,
) -> PlanNode {
    PlanNode {
        id: format!("{stage:?}"),
        stage,
        adapter: adapter.descriptor().identity(),
        binding_id: "route-a".to_string(),
        settings,
        operation,
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

fn action(name: &str) -> PlanOperation {
    PlanOperation::AdapterAction {
        action: name.to_string(),
        inputs: BTreeMap::new(),
    }
}

fn context<'a>(
    artifacts: &'a [ArtifactCandidate],
    manifest: Option<&'a ArtifactManifest>,
    envelopes: &'a [DeliveryEnvelope],
) -> AdapterExecutionContext<'a> {
    AdapterExecutionContext {
        attempt_id: "attempt-edges",
        plan_digest: "plan-digest",
        snapshot_digest: "snapshot-digest",
        artifacts,
        manifest,
        envelopes,
        receipts: &[],
        credentials: &EMPTY_CREDENTIALS,
        cancellation: CancellationSignal::new(),
    }
}

fn artifact(file_name: &str, bytes: &[u8]) -> ArtifactCandidate {
    ArtifactCandidate::new(
        "binary",
        file_name,
        "application/octet-stream",
        "darwin",
        "arm64",
        bytes.to_vec(),
    )
}

fn persist(store: &TemporaryArtifactStore, artifacts: &[ArtifactCandidate]) -> ArtifactManifest {
    let node = plan_node(
        store,
        PlanStage::PersistManifest,
        store.default_settings(),
        action("persist_manifest"),
    );
    store
        .execute_node(&node, &context(artifacts, None, &[]))
        .expect("persist the artifact set")
        .manifest
        .expect("persist seals a manifest")
}

fn bind_node(store: &TemporaryArtifactStore, manifest_digest: Option<&str>) -> PlanNode {
    let inputs = manifest_digest
        .map(|digest| {
            BTreeMap::from([(
                "manifest_digest".to_string(),
                Value::String(digest.to_string()),
            )])
        })
        .unwrap_or_default();
    plan_node(
        store,
        PlanStage::PersistManifest,
        store.default_settings(),
        PlanOperation::AdapterAction {
            action: "bind_promoted_manifest".to_string(),
            inputs,
        },
    )
}

#[test]
fn bind_promoted_manifest_rejects_non_action_nodes_and_missing_digest_input() {
    let temp = TempDir::new().expect("temp dir");
    let store = TemporaryArtifactStore::new(temp.path());

    let program_node = plan_node(
        &store,
        PlanStage::PersistManifest,
        store.default_settings(),
        PlanOperation::RunProgram {
            program: "ls".to_string(),
            args: vec![],
            working_directory: None,
            environment_references: BTreeMap::new(),
        },
    );
    assert!(store
        .execute_node(&program_node, &context(&[], None, &[]))
        .expect_err("run-program nodes are not adapter actions")
        .to_string()
        .contains("not an adapter action"));

    let missing_digest = bind_node(&store, None);
    assert!(store
        .execute_node(&missing_digest, &context(&[], None, &[]))
        .expect_err("binding requires the promoted digest")
        .to_string()
        .contains("does not declare the promoted manifest digest"));
}

#[test]
fn bind_promoted_manifest_is_unresumable_when_the_record_is_gone_or_tampered() {
    let temp = TempDir::new().expect("temp dir");
    let root = temp.path().join("store");
    let store = TemporaryArtifactStore::new(&root);
    let manifest = persist(&store, &[artifact("app.bin", b"app")]);

    let unknown_digest = "e".repeat(64);
    let error = store
        .execute_node(
            &bind_node(&store, Some(&unknown_digest)),
            &context(&[], None, &[]),
        )
        .expect_err("a missing set record cannot be rebound");
    assert!(
        matches!(error, PublishError::UnresumableDelivery { .. }),
        "missing records are unresumable, got {error}"
    );
    assert!(error.to_string().contains("no longer stored"));

    // 记录文件损坏：读取错误同样不可续传（ADR-0038/0040）。
    let corrupted_path = root
        .join("manifests")
        .join(format!("{}.json", "f".repeat(64)));
    fs::create_dir_all(corrupted_path.parent().expect("record parent")).expect("create record dir");
    fs::write(&corrupted_path, "{ not json").expect("write corrupted record");
    let error = store
        .execute_node(
            &bind_node(&store, Some(&"f".repeat(64))),
            &context(&[], None, &[]),
        )
        .expect_err("corrupted records cannot be rebound");
    assert!(matches!(error, PublishError::UnresumableDelivery { .. }));

    // 记录指向另一份集合：封存身份漂移同样不可续传。
    let foreign_record = root
        .join("manifests")
        .join(format!("{unknown_digest}.json"));
    fs::copy(
        root.join("manifests")
            .join(format!("{}.json", manifest.digest)),
        &foreign_record,
    )
    .expect("stage a mismatched record");
    let error = store
        .execute_node(
            &bind_node(&store, Some(&unknown_digest)),
            &context(&[], None, &[]),
        )
        .expect_err("a record sealing another set cannot be rebound");
    assert!(error.to_string().contains("seals a different artifact set"));

    // 完好绑定仍然通过。
    let bound = store
        .execute_node(
            &bind_node(&store, Some(&manifest.digest)),
            &context(&[], None, &[]),
        )
        .expect("binding the stored manifest succeeds")
        .manifest
        .expect("binding returns the stored manifest");
    assert_eq!(bound.digest, manifest.digest);
}

#[test]
fn artifact_set_leases_require_an_attempt_id_and_a_stored_set() {
    let temp = TempDir::new().expect("temp dir");
    let store = TemporaryArtifactStore::new(temp.path());
    let settings = store.default_settings();
    let digest = "a".repeat(64);

    assert!(store
        .acquire_artifact_set_lease(&settings, "  ", &digest, "2030-01-01T00:00:00Z")
        .expect_err("leases require an attempt id")
        .to_string()
        .contains("publish attempt id"));

    assert!(store
        .acquire_artifact_set_lease(&settings, "attempt-1", &digest, "not-a-time")
        .expect_err("lease deadlines must be RFC3339")
        .to_string()
        .contains("strict UTC RFC 3339"));

    assert!(store
        .acquire_artifact_set_lease(&settings, "attempt-1", &digest, "2030-01-01T00:00:00Z")
        .expect_err("only stored sets can be leased")
        .to_string()
        .contains("only stored sets can be leased"));

    // 释放不存在的租约是幂等无操作。
    store
        .release_artifact_set_lease(&settings, "attempt-never-leased")
        .expect("releasing an absent lease is a no-op");
}

#[test]
fn retention_sweeps_reject_malformed_clock_values() {
    let temp = TempDir::new().expect("temp dir");
    let store = TemporaryArtifactStore::new(temp.path());
    assert!(store
        .enforce_retention(&store.default_settings(), "not-a-time")
        .expect_err("retention requires an RFC3339 clock")
        .to_string()
        .contains("strict UTC RFC 3339"));
}

fn delivery_identity(manifest_digest: &str) -> DeliveryIdempotencyIdentity {
    DeliveryIdempotencyIdentity {
        attempt_id: "attempt-probe".to_string(),
        plan_node_id: "publish-routes".to_string(),
        release_identity: ReleaseIdentity::new(
            "edge-project:app",
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
        manifest_digest: manifest_digest.to_string(),
        route_id: "route-a".to_string(),
    }
}

#[test]
fn probe_delivery_distinguishes_absent_matching_and_conflicting_deliveries() {
    let temp = TempDir::new().expect("temp dir");
    let deliveries = temp.path().join("deliveries");
    let destination = LocalDirectoryDestination::new(&deliveries);
    let settings = destination.default_settings();
    let identity = delivery_identity(&"9".repeat(64));

    let attempt_dir = deliveries.join(format!("attempt-{}", &sha256_hex(b"attempt-probe")[..24]));

    let probe = destination
        .probe_delivery(&settings, &identity, &EMPTY_CREDENTIALS)
        .expect("probe an absent delivery");
    assert!(matches!(probe, DeliveryProbe::Absent), "{probe:?}");

    // 目录已存在但无交付标记：同名交付不是本 Attempt 的产物。
    fs::create_dir_all(&attempt_dir).expect("create attempt dir");
    let probe = destination
        .probe_delivery(&settings, &identity, &EMPTY_CREDENTIALS)
        .expect("probe an unmarked delivery");
    assert!(
        matches!(probe, DeliveryProbe::Conflicting { .. }),
        "{probe:?}"
    );

    fs::write(
        attempt_dir.join(".one-publish-manifest-digest"),
        "b".repeat(64),
    )
    .expect("write a foreign marker");
    let probe = destination
        .probe_delivery(&settings, &identity, &EMPTY_CREDENTIALS)
        .expect("probe a conflicting delivery");
    assert!(
        matches!(probe, DeliveryProbe::Conflicting { .. }),
        "{probe:?}"
    );

    fs::write(
        attempt_dir.join(".one-publish-manifest-digest"),
        "9".repeat(64),
    )
    .expect("write the matching marker");
    let probe = destination
        .probe_delivery(&settings, &identity, &EMPTY_CREDENTIALS)
        .expect("probe the sealed delivery");
    match probe {
        DeliveryProbe::Matching { external_reference } => {
            assert!(external_reference.contains("attempt-"));
        }
        other => panic!("expected a matching probe, got {other:?}"),
    }
}

fn destination_settings(destination: &LocalDirectoryDestination) -> AdapterSettings {
    destination.default_settings()
}

#[test]
fn destination_execution_requires_manifest_directory_and_staged_envelope() {
    let temp = TempDir::new().expect("temp dir");
    let destination = LocalDirectoryDestination::new(temp.path().join("deliveries"));
    let manifest = ArtifactManifest::seal(
        "snapshot-digest",
        vec![ArtifactManifestEntry {
            file_name: "app.bin".to_string(),
            role: "binary".to_string(),
            media_type: "application/octet-stream".to_string(),
            platform: "darwin".to_string(),
            architecture: "arm64".to_string(),
            size: 3,
            digest: sha256_hex(b"app"),
            locator: temp
                .path()
                .join("missing-source.bin")
                .to_string_lossy()
                .to_string(),
            retention: "keep".to_string(),
            executable: Some(false),
        }],
    )
    .expect("seal manifest");

    let publish_node = plan_node(
        &destination,
        PlanStage::PublishRoutes,
        destination_settings(&destination),
        action("publish_local_directory"),
    );
    assert!(destination
        .execute_node(&publish_node, &context(&[], None, &[]))
        .expect_err("publishing requires the sealed manifest")
        .to_string()
        .contains("manifest"));

    let stage_without_directory = plan_node(
        &destination,
        PlanStage::StageRoutes,
        AdapterSettings::new(1),
        action("stage_local_directory"),
    );
    assert!(destination
        .execute_node(
            &stage_without_directory,
            &context(&[], Some(&manifest), &[])
        )
        .expect_err("staging requires the sealed directory setting")
        .to_string()
        .contains("directory"));

    // 有 Manifest 但没有暂存 Envelope：交付目录无从恢复。
    assert!(destination
        .execute_node(&publish_node, &context(&[], Some(&manifest), &[]))
        .expect_err("publishing requires the staged envelope")
        .to_string()
        .contains("no staged delivery envelope"));

    // 暂存 → 发布走完时 locator 失效：交付按条目校验失败而不是落地坏文件。
    let stage_node = plan_node(
        &destination,
        PlanStage::StageRoutes,
        destination_settings(&destination),
        action("stage_local_directory"),
    );
    let staged = destination
        .execute_node(&stage_node, &context(&[], Some(&manifest), &[]))
        .expect("stage the route envelope")
        .envelopes;
    assert_eq!(staged.len(), 1);
    assert_eq!(staged[0].route_id, "route-a");
    let error = destination
        .execute_node(&publish_node, &context(&[], Some(&manifest), &staged))
        .expect_err("missing artifact sources cannot be delivered");
    assert!(error.to_string().contains("read artifact"), "{error}");
}

#[test]
fn local_execution_backend_default_constructs_a_usable_backend() {
    let backend = LocalExecutionBackend::default();
    assert_eq!(
        backend.descriptor().identity(),
        AdapterIdentity::new(AdapterKind::ExecutionBackend, "local-execution", 1)
    );
}
