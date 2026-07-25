use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;

use publish_adapters::{
    AdapterConformanceFixture, AdapterContract, AdapterRegistry, ProjectProvider, TauriBuildDriver,
    TauriProjectProvider, TauriVersionSourceKind, VersionMirrorKind, TAURI_PROVIDER_ID,
};
use publish_domain::{
    AdapterBinding, AdapterIdentity, AdapterKind, AdapterSelection, AdapterSettings, DeliveryRoute,
    PlanOperation, PlanStage, PlanningInputSnapshot, SourceSnapshot,
    PLANNING_INPUT_SNAPSHOT_VERSION,
};
use serde_json::Value;

fn write_file(path: &Path, content: &str) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("create parent directory");
    }
    std::fs::write(path, content).expect("write file");
}

fn single_app_repository() -> tempfile::TempDir {
    let repository = tempfile::tempdir().expect("temp repository");
    write_file(
        &repository.path().join("src-tauri/tauri.conf.json"),
        r#"{"productName":"Demo","version":"1.2.3"}"#,
    );
    write_file(
        &repository.path().join("package.json"),
        r#"{"packageManager":"pnpm@10.0.0","version":"1.2.3"}"#,
    );
    write_file(&repository.path().join("pnpm-lock.yaml"), "");
    write_file(
        &repository.path().join("src-tauri/Cargo.toml"),
        "[package]\nname = \"demo\"\nversion = \"1.2.3\"\n",
    );
    repository
}

#[test]
fn single_project_repository_discovers_one_candidate_with_evidence() {
    let repository = single_app_repository();
    let provider = TauriProjectProvider::new();

    let candidates = provider
        .discover_candidates(repository.path())
        .expect("discover candidates");

    assert_eq!(candidates.len(), 1);
    let candidate = &candidates[0];
    assert_eq!(candidate.identity, "tauri:src-tauri/tauri.conf.json");
    assert_eq!(candidate.provider_id, TAURI_PROVIDER_ID);
    assert_eq!(candidate.project_root, ".");
    assert!(!candidate.evidence.is_empty());
    assert_eq!(candidate.evidence[0].path, "src-tauri/tauri.conf.json");
}

#[test]
fn multi_candidate_repository_reports_all_candidates_in_stable_order() {
    let repository = tempfile::tempdir().expect("temp repository");
    write_file(
        &repository
            .path()
            .join("apps/desktop/src-tauri/tauri.conf.json"),
        r#"{"version":"1.0.0"}"#,
    );
    write_file(
        &repository.path().join("apps/kiosk/src-tauri/Tauri.toml"),
        "version = \"2.0.0\"\n",
    );
    let provider = TauriProjectProvider::new();

    let first = provider
        .discover_candidates(repository.path())
        .expect("discover candidates");
    let second = provider
        .discover_candidates(repository.path())
        .expect("discover candidates again");

    assert_eq!(first.len(), 2);
    assert_eq!(
        first
            .iter()
            .map(|candidate| candidate.identity.as_str())
            .collect::<Vec<_>>(),
        vec![
            "tauri:apps/desktop/src-tauri/tauri.conf.json",
            "tauri:apps/kiosk/src-tauri/Tauri.toml",
        ]
    );
    // 候选身份在重复扫描间保持稳定，发现结果不隐含选择。
    assert_eq!(first, second);
}

#[test]
fn repository_without_tauri_markers_discovers_no_candidates() {
    let repository = tempfile::tempdir().expect("temp repository");
    write_file(&repository.path().join("README.md"), "# empty\n");

    let candidates = TauriProjectProvider::new()
        .discover_candidates(repository.path())
        .expect("discover candidates");

    assert!(candidates.is_empty());
}

#[test]
fn discovery_skips_dependency_and_build_directories() {
    let repository = tempfile::tempdir().expect("temp repository");
    write_file(
        &repository.path().join("node_modules/pkg/tauri.conf.json"),
        "{}",
    );
    write_file(
        &repository.path().join("target/debug/tauri.conf.json"),
        "{}",
    );
    write_file(&repository.path().join("dist/tauri.conf.json"), "{}");
    write_file(&repository.path().join(".git/tauri.conf.json"), "{}");

    let candidates = TauriProjectProvider::new()
        .discover_candidates(repository.path())
        .expect("discover candidates");

    assert!(candidates.is_empty());
}

#[test]
fn config_version_is_authoritative_and_matching_files_become_mirror_suggestions() {
    let repository = single_app_repository();
    let provider = TauriProjectProvider::new();

    let inspection = provider
        .inspect(repository.path(), "src-tauri/tauri.conf.json")
        .expect("inspect candidate");

    assert_eq!(
        inspection.version_source.kind,
        TauriVersionSourceKind::TauriConfig
    );
    assert_eq!(inspection.version_source.version, "1.2.3");
    assert_eq!(inspection.version_source.path, "src-tauri/tauri.conf.json");
    assert_eq!(inspection.build_driver, TauriBuildDriver::Pnpm);
    assert_eq!(inspection.app_name, "Demo");
    assert_eq!(
        inspection.candidate.identity,
        "tauri:src-tauri/tauri.conf.json"
    );
    let mirror_paths = inspection
        .suggested_version_mirrors
        .iter()
        .map(|mirror| (mirror.path.as_str(), mirror.kind))
        .collect::<Vec<_>>();
    assert_eq!(
        mirror_paths,
        vec![
            ("package.json", VersionMirrorKind::JsonPointer),
            ("src-tauri/Cargo.toml", VersionMirrorKind::TomlKey),
        ]
    );
}

#[test]
fn config_can_delegate_authoritative_version_to_referenced_package_json() {
    let repository = tempfile::tempdir().expect("temp repository");
    write_file(
        &repository.path().join("src-tauri/tauri.conf.json5"),
        "{ productName: 'Demo', version: '../package.json' }",
    );
    write_file(
        &repository.path().join("package.json"),
        r#"{"packageManager":"npm@10.0.0","version":"2.3.4"}"#,
    );
    write_file(&repository.path().join("package-lock.json"), "{}");

    let inspection = TauriProjectProvider::new()
        .inspect(repository.path(), "src-tauri/tauri.conf.json5")
        .expect("inspect candidate");

    assert_eq!(
        inspection.version_source.kind,
        TauriVersionSourceKind::ReferencedPackageJson
    );
    assert_eq!(inspection.version_source.path, "package.json");
    assert_eq!(inspection.version_source.version, "2.3.4");
    assert_eq!(inspection.build_driver, TauriBuildDriver::Npm);
}

#[test]
fn missing_config_version_falls_back_to_cargo_toml_source() {
    let repository = tempfile::tempdir().expect("temp repository");
    write_file(
        &repository.path().join("src-tauri/tauri.conf.json"),
        r#"{"productName":"Demo"}"#,
    );
    write_file(
        &repository.path().join("src-tauri/Cargo.toml"),
        "[package]\nname = \"demo\"\nversion = \"3.4.5\"\n",
    );

    let inspection = TauriProjectProvider::new()
        .inspect(repository.path(), "src-tauri/tauri.conf.json")
        .expect("inspect candidate");

    assert_eq!(
        inspection.version_source.kind,
        TauriVersionSourceKind::CargoToml
    );
    assert_eq!(inspection.version_source.version, "3.4.5");
    assert_eq!(inspection.build_driver, TauriBuildDriver::Cargo);
}

#[test]
fn prerelease_versions_are_rejected_by_the_tauri_provider_policy() {
    let repository = tempfile::tempdir().expect("temp repository");
    write_file(
        &repository.path().join("src-tauri/tauri.conf.json"),
        r#"{"version":"1.2.3-beta.1"}"#,
    );
    write_file(
        &repository.path().join("src-tauri/Cargo.toml"),
        "[package]\nname = \"demo\"\nversion = \"1.2.3\"\n",
    );

    let error = TauriProjectProvider::new()
        .inspect(repository.path(), "src-tauri/tauri.conf.json")
        .expect_err("reject prerelease version");

    assert!(error.to_string().contains("tauri_version_not_stable"));
}

#[test]
fn conflicting_lockfiles_block_build_driver_resolution() {
    let repository = tempfile::tempdir().expect("temp repository");
    write_file(
        &repository.path().join("src-tauri/tauri.conf.json"),
        r#"{"version":"1.0.0"}"#,
    );
    write_file(&repository.path().join("pnpm-lock.yaml"), "");
    write_file(&repository.path().join("yarn.lock"), "");

    let error = TauriProjectProvider::new()
        .inspect(repository.path(), "src-tauri/tauri.conf.json")
        .expect_err("reject conflicting lockfiles");

    assert!(error.to_string().contains("tauri_build_driver_conflict"));
}

#[test]
fn declared_package_manager_conflicting_with_lockfile_is_rejected() {
    let repository = tempfile::tempdir().expect("temp repository");
    write_file(
        &repository.path().join("src-tauri/tauri.conf.json"),
        r#"{"version":"1.0.0"}"#,
    );
    write_file(
        &repository.path().join("package.json"),
        r#"{"packageManager":"pnpm@10.0.0"}"#,
    );
    write_file(&repository.path().join("yarn.lock"), "");

    let error = TauriProjectProvider::new()
        .inspect(repository.path(), "src-tauri/tauri.conf.json")
        .expect_err("reject driver mismatch");

    assert!(error.to_string().contains("tauri_build_driver_conflict"));
}

#[test]
fn repository_without_any_driver_marker_is_blocked() {
    let repository = tempfile::tempdir().expect("temp repository");
    write_file(
        &repository.path().join("app/Tauri.toml"),
        "version = \"1.0.0\"\n",
    );

    let error = TauriProjectProvider::new()
        .inspect(repository.path(), "app/Tauri.toml")
        .expect_err("reject missing driver");

    assert!(error.to_string().contains("tauri_build_driver_missing"));
}

#[test]
fn inspecting_a_missing_candidate_reports_a_blocking_error() {
    let repository = tempfile::tempdir().expect("temp repository");

    let error = TauriProjectProvider::new()
        .inspect(repository.path(), "src-tauri/tauri.conf.json")
        .expect_err("reject missing config");

    assert!(error.to_string().contains("tauri_config_read_failed"));
}

#[test]
fn plan_fragment_renders_the_bound_build_driver_deterministically() {
    let provider = TauriProjectProvider::new();
    let snapshot = fixture_snapshot();
    let settings = AdapterSettings::new(1)
        .with_value(
            "config_path",
            Value::String("src-tauri/tauri.conf.json".to_string()),
        )
        .with_value("build_driver", Value::String("pnpm".to_string()));

    let first = provider
        .plan_fragment(&snapshot, &settings)
        .expect("plan fragment");
    let second = provider
        .plan_fragment(&snapshot, &settings)
        .expect("plan fragment again");

    assert_eq!(first, second);
    assert_eq!(first.len(), 2);
    assert_eq!(first[0].stage, PlanStage::InspectSource);
    let PlanOperation::AdapterAction { action, inputs } = &first[0].operation else {
        panic!("inspect node must be an adapter action");
    };
    assert_eq!(action, "inspect_tauri_project");
    assert_eq!(
        inputs.get("config_path"),
        Some(&Value::String("src-tauri/tauri.conf.json".to_string()))
    );
    assert_eq!(
        inputs.get("build_driver"),
        Some(&Value::String("pnpm".to_string()))
    );

    assert_eq!(first[1].stage, PlanStage::Build);
    let PlanOperation::RunProgram { program, args, .. } = &first[1].operation else {
        panic!("build node must run the build driver");
    };
    assert_eq!(program, "tauri-driver:pnpm");
    assert_eq!(
        args,
        &vec![
            "tauri".to_string(),
            "build".to_string(),
            "--config".to_string(),
            "src-tauri/tauri.conf.json".to_string(),
        ]
    );
    assert_eq!(
        first[1].artifact_outputs,
        vec!["provider-output:*".to_string()]
    );
}

#[test]
fn every_build_driver_maps_to_its_structured_command() {
    let provider = TauriProjectProvider::new();
    let snapshot = fixture_snapshot();
    let expected = [
        ("pnpm", "tauri-driver:pnpm", vec!["tauri", "build"]),
        (
            "npm",
            "tauri-driver:npm",
            vec!["run", "tauri", "--", "build"],
        ),
        ("yarn", "tauri-driver:yarn", vec!["tauri", "build"]),
        ("bun", "tauri-driver:bun", vec!["tauri", "build"]),
        ("cargo", "tauri-driver:cargo", vec!["tauri", "build"]),
    ];

    for (driver, expected_program, prefix) in expected {
        let settings = AdapterSettings::new(1)
            .with_value("config_path", Value::String("app/Tauri.toml".to_string()))
            .with_value("build_driver", Value::String(driver.to_string()));
        let fragment = provider
            .plan_fragment(&snapshot, &settings)
            .expect("plan fragment");
        let PlanOperation::RunProgram { program, args, .. } = &fragment[1].operation else {
            panic!("build node must run the build driver");
        };
        assert_eq!(program, expected_program);
        let mut expected_args = prefix.into_iter().map(str::to_string).collect::<Vec<_>>();
        expected_args.push("--config".to_string());
        expected_args.push("app/Tauri.toml".to_string());
        assert_eq!(args, &expected_args);
    }
}

#[test]
fn unknown_build_driver_settings_are_rejected() {
    let provider = TauriProjectProvider::new();
    let settings = AdapterSettings::new(1)
        .with_value(
            "config_path",
            Value::String("src-tauri/tauri.conf.json".to_string()),
        )
        .with_value("build_driver", Value::String("make".to_string()));

    let error = provider
        .validate_settings(&settings)
        .expect_err("reject unknown driver");

    assert!(error.to_string().contains("build_driver"));
}

#[test]
fn tauri_provider_passes_adapter_conformance_registration() {
    let fixture = AdapterConformanceFixture::new(fixture_snapshot());
    let mut registry = AdapterRegistry::new();

    registry
        .register_project_provider(Arc::new(TauriProjectProvider::new()), &fixture)
        .expect("register tauri provider");

    let identity = AdapterIdentity::new(AdapterKind::ProjectProvider, TAURI_PROVIDER_ID, 1);
    assert!(registry.descriptor(&identity).is_ok());
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
            captured_at: "2026-07-24T10:00:00Z".to_string(),
            reproducible: true,
        },
        external_preconditions: BTreeMap::new(),
        adapters: AdapterSelection {
            project_provider: AdapterBinding::new(
                "project",
                AdapterIdentity::new(AdapterKind::ProjectProvider, TAURI_PROVIDER_ID, 1),
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
