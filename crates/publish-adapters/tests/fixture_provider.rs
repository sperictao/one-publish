use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;

use publish_adapters::{
    fixture_candidate_identity, AdapterConformanceFixture, AdapterContract, AdapterRegistry,
    FixtureAppProvider, ProjectProvider, FIXTURE_BUILD_PROGRAM, FIXTURE_BUNDLE_ROLE,
    FIXTURE_INSPECT_ACTION, FIXTURE_MANIFEST_FILE_NAME, FIXTURE_PROVIDER_ID,
};
use publish_domain::{
    AdapterBinding, AdapterIdentity, AdapterKind, AdapterSelection, AdapterSettings, DeliveryRoute,
    PlanOperation, PlanStage, PlanningInputSnapshot, PublishError, SourceSnapshot,
    PLANNING_INPUT_SNAPSHOT_VERSION,
};
use serde_json::Value;

fn write_file(path: &Path, content: &str) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("create parent directory");
    }
    std::fs::write(path, content).expect("write file");
}

fn fixture_manifest(name: &str, version: &str) -> String {
    format!(r#"{{"name":"{name}","version":"{version}"}}"#)
}

#[test]
fn discovery_reports_stable_candidates_with_evidence() {
    let repository = tempfile::tempdir().expect("temp repository");
    write_file(
        &repository
            .path()
            .join("apps/desktop")
            .join(FIXTURE_MANIFEST_FILE_NAME),
        &fixture_manifest("desktop", "1.0.0"),
    );
    write_file(
        &repository
            .path()
            .join("apps/kiosk")
            .join(FIXTURE_MANIFEST_FILE_NAME),
        &fixture_manifest("kiosk", "2.0.0"),
    );
    let provider = FixtureAppProvider::new(repository.path());

    let first = provider
        .discover_candidates(repository.path())
        .expect("discover candidates");
    let second = provider
        .discover_candidates(repository.path())
        .expect("discover candidates again");

    assert_eq!(first.len(), 2);
    let desktop = &first[0];
    assert_eq!(
        desktop.identity,
        fixture_candidate_identity("apps/desktop/fixture-app.json")
    );
    assert_eq!(desktop.provider_id, FIXTURE_PROVIDER_ID);
    assert_eq!(desktop.project_root, "apps/desktop");
    assert_eq!(desktop.evidence[0].path, "apps/desktop/fixture-app.json");
    assert_eq!(
        first[1].identity,
        fixture_candidate_identity("apps/kiosk/fixture-app.json")
    );
    // 候选身份在重复扫描间保持稳定，发现结果不隐含选择（ADR-0044）。
    assert_eq!(first, second);
}

#[test]
fn discovery_skips_dependency_and_build_directories() {
    let repository = tempfile::tempdir().expect("temp repository");
    for skipped in ["node_modules/pkg", "target/debug", "dist", ".git"] {
        write_file(
            &repository
                .path()
                .join(skipped)
                .join(FIXTURE_MANIFEST_FILE_NAME),
            &fixture_manifest("hidden", "1.0.0"),
        );
    }
    write_file(&repository.path().join("README.md"), "# no fixture app\n");

    let candidates = FixtureAppProvider::new(repository.path())
        .discover_candidates(repository.path())
        .expect("discover candidates");

    assert!(candidates.is_empty());
}

#[test]
fn inspection_resolves_fixture_version_semantics() {
    let repository = tempfile::tempdir().expect("temp repository");
    write_file(
        &repository.path().join(FIXTURE_MANIFEST_FILE_NAME),
        // 预发布版本是本 Provider 的合法版本策略；发布核心不约束版本格式（ADR-0028）。
        &fixture_manifest("demo-app", "2.0.0-nightly.7"),
    );
    let provider = FixtureAppProvider::new(repository.path());

    let inspection = provider
        .inspect(FIXTURE_MANIFEST_FILE_NAME)
        .expect("inspect fixture project");

    assert_eq!(inspection.manifest_path, FIXTURE_MANIFEST_FILE_NAME);
    assert_eq!(inspection.app_name, "demo-app");
    assert_eq!(inspection.version, "2.0.0-nightly.7");
    assert_eq!(
        inspection.candidate.identity,
        fixture_candidate_identity(FIXTURE_MANIFEST_FILE_NAME)
    );
    assert_eq!(inspection.candidate.project_root, ".");
}

#[test]
fn inspection_rejects_invalid_manifests() {
    let repository = tempfile::tempdir().expect("temp repository");
    let provider = FixtureAppProvider::new(repository.path());
    let inspect_error = |content: &str| {
        write_file(&repository.path().join(FIXTURE_MANIFEST_FILE_NAME), content);
        match provider.inspect(FIXTURE_MANIFEST_FILE_NAME) {
            Err(PublishError::ProjectInspection { code, .. }) => code,
            other => panic!("expected a project inspection failure, got {other:?}"),
        }
    };

    assert!(provider
        .inspect("missing/fixture-app.json")
        .expect_err("missing manifest must fail")
        .to_string()
        .contains("missing/fixture-app.json"));
    assert_eq!(
        inspect_error(r#"{"name":"demo","version":"not-a-version"}"#),
        "fixture_app_version_invalid"
    );
    assert_eq!(
        inspect_error(r#"{"version":"1.0.0"}"#),
        "fixture_app_name_invalid"
    );
    assert_eq!(
        inspect_error(r#"{"name":"bad name!","version":"1.0.0"}"#),
        "fixture_app_name_invalid"
    );
    assert_eq!(
        inspect_error("not json"),
        "fixture_app_manifest_parse_failed"
    );
}

#[test]
fn registration_passes_the_shared_adapter_conformance_suite() {
    let repository = tempfile::tempdir().expect("temp repository");
    let mut registry = AdapterRegistry::new();

    registry
        .register_project_provider(
            Arc::new(FixtureAppProvider::new(repository.path())),
            &AdapterConformanceFixture::new(fixture_snapshot()),
        )
        .expect("fixture provider passes shared conformance");
}

#[test]
fn settings_migrate_stepwise_from_schema_v1() {
    let repository = tempfile::tempdir().expect("temp repository");
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(
            Arc::new(FixtureAppProvider::new(repository.path())),
            &AdapterConformanceFixture::new(fixture_snapshot()),
        )
        .expect("register fixture provider");
    let identity = AdapterIdentity::new(AdapterKind::ProjectProvider, FIXTURE_PROVIDER_ID, 1);

    let migrated = registry
        .migrate_and_validate_settings(
            &identity,
            &AdapterSettings::new(1).with_value(
                "manifest",
                Value::String("apps/desktop/fixture-app.json".to_string()),
            ),
        )
        .expect("migrate schema v1 settings");
    assert_eq!(migrated.schema_version, 2);
    assert_eq!(
        migrated.values["manifest_path"],
        "apps/desktop/fixture-app.json"
    );

    assert!(matches!(
        registry.migrate_and_validate_settings(&identity, &AdapterSettings::new(1)),
        Err(PublishError::InvalidAdapterSettings { message, .. })
            if message.contains("manifest_path")
    ));
    assert!(matches!(
        registry.migrate_and_validate_settings(&identity, &AdapterSettings::new(99)),
        Err(PublishError::UnsupportedSchemaVersion { actual: 99, .. })
    ));
    assert!(matches!(
        registry.migrate_and_validate_settings(
            &identity,
            &AdapterSettings::new(2).with_value(
                "manifest_path",
                Value::String("../outside/fixture-app.json".to_string()),
            ),
        ),
        Err(PublishError::InvalidAdapterSettings { message, .. })
            if message.contains("portable repository-relative path")
    ));
}

#[test]
fn plan_fragment_declares_a_deterministic_inspect_and_build_pipeline() {
    let repository = tempfile::tempdir().expect("temp repository");
    let provider = FixtureAppProvider::new(repository.path());
    let settings = AdapterSettings::new(2).with_value(
        "manifest_path",
        Value::String("apps/desktop/fixture-app.json".to_string()),
    );

    let fragment = provider
        .plan_fragment(&fixture_snapshot(), &settings)
        .expect("plan fixture fragment");

    assert_eq!(fragment.len(), 2);
    let inspect = &fragment[0];
    assert_eq!(inspect.stage, PlanStage::InspectSource);
    match &inspect.operation {
        PlanOperation::AdapterAction { action, inputs } => {
            assert_eq!(action, FIXTURE_INSPECT_ACTION);
            assert_eq!(
                inputs.get("manifest_path").and_then(Value::as_str),
                Some("apps/desktop/fixture-app.json")
            );
        }
        other => panic!("expected an adapter action, got {other:?}"),
    }
    let build = &fragment[1];
    assert_eq!(build.stage, PlanStage::Build);
    assert_eq!(build.artifact_outputs, vec![FIXTURE_BUNDLE_ROLE]);
    match &build.operation {
        PlanOperation::RunProgram { program, args, .. } => {
            assert_eq!(program, FIXTURE_BUILD_PROGRAM);
            assert!(args.contains(&"apps/desktop/fixture-app.json".to_string()));
        }
        other => panic!("expected a build command, got {other:?}"),
    }
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
            captured_at: "2026-07-26T10:00:00Z".to_string(),
            reproducible: true,
        },
        external_preconditions: BTreeMap::new(),
        promoted_manifest_digest: None,
        adapters: AdapterSelection {
            project_provider: AdapterBinding::new(
                "project",
                AdapterIdentity::new(AdapterKind::ProjectProvider, FIXTURE_PROVIDER_ID, 1),
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
                AdapterIdentity::new(AdapterKind::DeliveryDestination, "destination", 1),
                empty,
            ))],
        },
    }
}
