use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::sync::Arc;

use publish_adapters::{
    fixture_candidate_identity, AdapterConformanceFixture, AdapterRegistry, ChecksumProcessor,
    FixtureAppProvider, LocalDirectoryDestination, LocalExecutionBackend, ProjectProvider,
    TemporaryArtifactStore, CHECKSUM_MANIFEST_ROLE, CHECKSUM_PROCESSOR_ID, FIXTURE_BUNDLE_ROLE,
    FIXTURE_PROVIDER_ID,
};
use publish_domain::{
    AdapterBinding, AdapterIdentity, AdapterKind, AdapterSelection, AdapterSettings, DeliveryRoute,
    DeliveryStatus, PlanningInputSnapshot, PublishAttemptStatus, ReleaseIdentity, SourceSnapshot,
    PLANNING_INPUT_SNAPSHOT_VERSION,
};
use publish_runner_core::{AttemptExecutionContext, PublishRuntime, StartPublishAttempt};
use serde_json::Value;

const MANIFEST_RELATIVE_PATH: &str = "apps/desktop/fixture-app.json";

/// Issue T18 主验收缝：第二 Project Provider Fixture 只通过既有注册与
/// PublishRuntime 合同完成本地发布；Processor、Backend、Store 与 Destination
/// 全部复用现有实现，未做任何修改。
#[test]
fn fixture_provider_publishes_locally_through_existing_adapters() {
    let repository = tempfile::tempdir().expect("create fixture repository");
    let manifest_absolute = repository.path().join(MANIFEST_RELATIVE_PATH);
    fs::create_dir_all(manifest_absolute.parent().expect("manifest parent"))
        .expect("create project directory");
    // 预发布版本是 Fixture Provider 的版本策略；发布核心不约束版本格式（ADR-0028）。
    fs::write(
        &manifest_absolute,
        r#"{"name":"demo-app","version":"2.0.0-nightly.7"}"#,
    )
    .expect("write fixture manifest");
    let store_dir = tempfile::tempdir().expect("create temporary store");
    let delivery_dir = tempfile::tempdir().expect("create local delivery directory");

    let provider = FixtureAppProvider::new(repository.path());
    let candidates = provider
        .discover_candidates(repository.path())
        .expect("discover fixture candidates");
    assert_eq!(candidates.len(), 1);
    let candidate = &candidates[0];
    assert_eq!(
        candidate.identity,
        fixture_candidate_identity(MANIFEST_RELATIVE_PATH)
    );

    // Project Binding 显式选择发现的候选（ADR-0044）；沿用 v1 schema 的设置
    // 证明计划阶段执行显式 settings migration（ADR-0031）。
    let manifest_path = candidate.evidence[0].path.clone();
    let inspection = provider
        .inspect(&manifest_path)
        .expect("inspect the bound fixture candidate");
    assert_eq!(inspection.version, "2.0.0-nightly.7");

    let snapshot = fixture_snapshot(&manifest_path, store_dir.path(), delivery_dir.path());
    let runtime = fixture_runtime(
        &snapshot,
        repository.path(),
        store_dir.path(),
        delivery_dir.path(),
    );

    let prepared = runtime
        .prepare_attempt(&snapshot)
        .expect("prepare fixture publish attempt");
    let project_binding = prepared
        .plan
        .adapters
        .iter()
        .find(|binding| binding.binding_id == "project")
        .expect("sealed project binding");
    assert_eq!(project_binding.adapter.id, FIXTURE_PROVIDER_ID);
    assert_eq!(project_binding.settings.schema_version, 2);
    assert_eq!(
        project_binding.settings.values["manifest_path"],
        Value::String(manifest_path.clone())
    );

    let attempt = runtime
        .start_attempt(
            &prepared,
            StartPublishAttempt::new(
                "attempt-fixture-001",
                "local-run-fixture-001",
                ReleaseIdentity::new(
                    candidate.identity.clone(),
                    snapshot.source.clone(),
                    inspection.version.clone(),
                    "stable",
                    None,
                ),
            ),
            &AttemptExecutionContext::at(0),
        )
        .expect("start fixture publish attempt");

    assert_eq!(attempt.status, PublishAttemptStatus::Published);
    let manifest = attempt.manifest.as_ref().expect("sealed artifact manifest");
    let roles = manifest
        .artifacts
        .iter()
        .map(|entry| entry.role.as_str())
        .collect::<Vec<_>>();
    assert_eq!(roles, vec![FIXTURE_BUNDLE_ROLE, CHECKSUM_MANIFEST_ROLE]);
    let bundle = &manifest.artifacts[0];
    assert_eq!(
        bundle.file_name,
        "demo-app_2.0.0-nightly.7.fixture-bundle.json"
    );

    assert_eq!(attempt.receipts.len(), 1);
    let receipt = &attempt.receipts[0];
    assert_eq!(receipt.status, DeliveryStatus::Published);
    assert_eq!(receipt.route_id, "local-route");
    assert_eq!(receipt.manifest_digest, manifest.digest);

    let delivered_root = Path::new(receipt.external_reference.as_str());
    let delivered_bundle =
        fs::read(delivered_root.join(&bundle.file_name)).expect("read delivered fixture bundle");
    assert_eq!(
        delivered_bundle,
        br#"{"name":"demo-app","version":"2.0.0-nightly.7"}"#
    );
    let checksums = fs::read_to_string(delivered_root.join("SHA256SUMS"))
        .expect("read delivered checksum manifest");
    assert!(checksums.contains(&bundle.file_name));
}

fn fixture_runtime(
    snapshot: &PlanningInputSnapshot,
    repository_root: &Path,
    store_directory: &Path,
    delivery_directory: &Path,
) -> PublishRuntime {
    let fixture = AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(Arc::new(FixtureAppProvider::new(repository_root)), &fixture)
        .expect("register fixture provider");
    registry
        .register_artifact_processor(Arc::new(ChecksumProcessor::new()), &fixture)
        .expect("register checksum processor");
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
    PublishRuntime::new(registry)
}

fn fixture_snapshot(
    manifest_path: &str,
    store_directory: &Path,
    delivery_directory: &Path,
) -> PlanningInputSnapshot {
    PlanningInputSnapshot {
        version: PLANNING_INPUT_SNAPSHOT_VERSION,
        configuration_revision: "config-revision-1".to_string(),
        runtime_revision: "runner-1".to_string(),
        release_input: BTreeMap::from([(
            "version".to_string(),
            Value::String("2.0.0-nightly.7".to_string()),
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
                AdapterIdentity::new(AdapterKind::ProjectProvider, FIXTURE_PROVIDER_ID, 1),
                AdapterSettings::new(1)
                    .with_value("manifest", Value::String(manifest_path.to_string())),
            ),
            artifact_processors: vec![AdapterBinding::new(
                "checksums",
                AdapterIdentity::new(AdapterKind::ArtifactProcessor, CHECKSUM_PROCESSOR_ID, 1),
                AdapterSettings::new(1),
            )],
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
                        Value::String(store_directory.to_string_lossy().to_string()),
                    )
                    .with_value("retention_seconds", Value::from(604_800u64)),
            ),
            delivery_routes: vec![DeliveryRoute::required(AdapterBinding::new(
                "local-route",
                AdapterIdentity::new(AdapterKind::DeliveryDestination, "local-directory", 1),
                AdapterSettings::new(1).with_value(
                    "directory",
                    Value::String(delivery_directory.to_string_lossy().to_string()),
                ),
            ))],
        },
    }
}
