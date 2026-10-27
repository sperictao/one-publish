use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;

use publish_adapters::tauri::ENABLED_TARGETS_SETTING;
use publish_adapters::{
    AdapterConformanceFixture, AdapterContract, AdapterRegistry, ProjectProvider, TauriBuildDriver,
    TauriProjectProvider, TauriRuntimeProvider, TauriVersionSourceKind, VersionMirrorKind,
    TAURI_PROVIDER_ID,
};
use publish_domain::{
    AdapterBinding, AdapterIdentity, AdapterKind, AdapterSelection, AdapterSettings, DeliveryRoute,
    PlanOperation, PlanStage, PlanningInputSnapshot, SourceSnapshot,
    PLANNING_INPUT_SNAPSHOT_VERSION,
};
use serde_json::{json, Value};

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

/// 远端绑定总是写入启用目标（决议 #85）：规划入口必须把它当作已声明的可选
/// 字符串列表，而不是未知设置；本地绑定缺省该键。
#[test]
fn enabled_targets_are_an_optional_string_list_setting() {
    let fixture = AdapterConformanceFixture::new(fixture_snapshot());
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(Arc::new(TauriProjectProvider::new()), &fixture)
        .expect("register tauri provider");
    let identity = AdapterIdentity::new(AdapterKind::ProjectProvider, TAURI_PROVIDER_ID, 1);
    let local = TauriProjectProvider::new().default_settings();

    registry
        .migrate_and_validate_settings(&identity, &local)
        .expect("local bindings omit enabled targets");
    registry
        .migrate_and_validate_settings(
            &identity,
            &local
                .clone()
                .with_value(ENABLED_TARGETS_SETTING, json!(["x86_64-unknown-linux-gnu"])),
        )
        .expect("remote bindings carry enabled targets");

    let error = registry
        .migrate_and_validate_settings(
            &identity,
            &local.with_value(ENABLED_TARGETS_SETTING, json!("x86_64-unknown-linux-gnu")),
        )
        .expect_err("a bare target string is not a target list");
    assert!(error.to_string().contains(ENABLED_TARGETS_SETTING));
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
        promoted_manifest_digest: None,
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

fn inspection_code(error: &publish_domain::PublishError) -> &str {
    match error {
        publish_domain::PublishError::ProjectInspection { code, .. } => code.as_str(),
        other => panic!("expected a project inspection failure, got {other}"),
    }
}

#[test]
fn inspect_rejects_non_portable_config_paths() {
    let repository = single_app_repository();
    let error = TauriProjectProvider::new()
        .inspect(repository.path(), "../outside/tauri.conf.json")
        .expect_err("relative paths cannot escape the repository");
    assert_eq!(inspection_code(&error), "tauri_config_path_invalid");
}

#[test]
fn inspect_rejects_unknown_package_managers() {
    let repository = tempfile::tempdir().expect("temp repository");
    write_file(
        &repository.path().join("src-tauri/tauri.conf.json"),
        r#"{"productName":"Demo","version":"1.2.3"}"#,
    );
    write_file(
        &repository.path().join("package.json"),
        r#"{"packageManager":"deno@2.0.0","version":"1.2.3"}"#,
    );
    write_file(
        &repository.path().join("src-tauri/Cargo.toml"),
        "[package]\nname = \"demo\"\nversion = \"1.2.3\"\n",
    );

    let error = TauriProjectProvider::new()
        .inspect(repository.path(), "src-tauri/tauri.conf.json")
        .expect_err("deno is not a supported Tauri package manager");
    assert_eq!(inspection_code(&error), "tauri_package_manager_unsupported");
}

fn runtime(repository: &tempfile::TempDir) -> TauriRuntimeProvider {
    TauriRuntimeProvider::new(
        "src-tauri/tauri.conf.json".to_string(),
        "pnpm".to_string(),
        repository.path().to_path_buf(),
        None,
    )
}

fn action_node(action: &str, settings: AdapterSettings) -> publish_domain::PlanNode {
    publish_domain::PlanNode {
        id: format!("project.{action}"),
        stage: PlanStage::InspectSource,
        adapter: AdapterIdentity::new(AdapterKind::ProjectProvider, TAURI_PROVIDER_ID, 1),
        binding_id: "project".to_string(),
        settings,
        operation: PlanOperation::AdapterAction {
            action: action.to_string(),
            inputs: BTreeMap::new(),
        },
        depends_on: Vec::new(),
        artifact_inputs: Vec::new(),
        artifact_outputs: Vec::new(),
        side_effects: Vec::new(),
        cancellable: true,
        cleanup_owned_staging: false,
        irreversible: false,
        platform: publish_domain::PlanNodePlatform::Any,
    }
}

fn inspect_settings(driver: &str) -> AdapterSettings {
    AdapterSettings::new(1)
        .with_value(
            "config_path",
            Value::String("src-tauri/tauri.conf.json".to_string()),
        )
        .with_value("build_driver", Value::String(driver.to_string()))
}

fn execute(
    provider: &TauriRuntimeProvider,
    node: &publish_domain::PlanNode,
) -> Result<publish_adapters::AdapterExecutionOutput, publish_domain::PublishError> {
    let credentials = BTreeMap::new();
    let context = publish_adapters::AdapterExecutionContext {
        attempt_id: "attempt-tauri",
        plan_digest: "plan-digest",
        snapshot_digest: "snapshot-digest",
        artifacts: &[],
        manifest: None,
        envelopes: &[],
        receipts: &[],
        credentials: &credentials,
        cancellation: publish_adapters::CancellationSignal::new(),
    };
    provider.execute_node(node, &context)
}

#[test]
fn inspect_action_fails_when_the_build_driver_drifts() {
    // 密封驱动与仓库实况不一致：计划过期，必须重新 prepare（防陈旧计划执行）。
    let repository = single_app_repository();
    let provider = runtime(&repository);
    let node = action_node(
        publish_adapters::TAURI_INSPECT_ACTION,
        inspect_settings("npm"),
    );

    let error = execute(&provider, &node).expect_err("npm sealed but the repository resolves pnpm");
    assert!(matches!(error, publish_domain::PublishError::Execution(_)));
    assert!(error.to_string().contains("drifted from npm to pnpm"));
}

#[test]
fn release_gate_rejects_un_sealed_or_empty_programs() {
    let repository = single_app_repository();
    let provider = runtime(&repository);

    // inputs 非 SealedReleaseGate 形状：计划污染是 InvalidPlan 而非执行失败。
    let mut malformed = action_node(
        publish_adapters::tauri::TAURI_RELEASE_GATE_ACTION,
        inspect_settings("pnpm"),
    );
    malformed.operation = PlanOperation::AdapterAction {
        action: publish_adapters::tauri::TAURI_RELEASE_GATE_ACTION.to_string(),
        inputs: BTreeMap::from([("bogus".to_string(), Value::Bool(true))]),
    };
    let error =
        execute(&provider, &malformed).expect_err("gate inputs must decode into SealedReleaseGate");
    assert!(matches!(
        error,
        publish_domain::PublishError::InvalidPlan(_)
    ));

    let mut empty_program = malformed.clone();
    empty_program.operation = PlanOperation::AdapterAction {
        action: publish_adapters::tauri::TAURI_RELEASE_GATE_ACTION.to_string(),
        inputs: BTreeMap::from([("program".to_string(), Value::String("   ".to_string()))]),
    };
    let error = execute(&provider, &empty_program).expect_err("an empty gate program cannot run");
    assert!(matches!(
        error,
        publish_domain::PublishError::InvalidPlan(_)
    ));
}

#[test]
fn release_gate_runs_the_sealed_program_and_reports_failures() {
    let repository = single_app_repository();
    let provider = runtime(&repository);
    let node = |program: &str| {
        let mut node = action_node(
            publish_adapters::tauri::TAURI_RELEASE_GATE_ACTION,
            inspect_settings("pnpm"),
        );
        node.operation = PlanOperation::AdapterAction {
            action: publish_adapters::tauri::TAURI_RELEASE_GATE_ACTION.to_string(),
            inputs: BTreeMap::from([("program".to_string(), Value::String(program.to_string()))]),
        };
        node
    };

    execute(&provider, &node("true")).expect("a passing gate returns cleanly");
    let error = execute(&provider, &node("definitely-not-a-real-program"))
        .expect_err("a missing gate program fails at spawn");
    assert!(matches!(error, publish_domain::PublishError::Execution(_)));

    let error =
        execute(&provider, &node("false")).expect_err("a failing gate surfaces its exit status");
    assert!(error.to_string().contains("release gate failed"));
}

#[test]
fn execute_rejects_operations_that_are_not_tauri_actions() {
    let repository = single_app_repository();
    let provider = runtime(&repository);
    let mut node = action_node("unrelated_action", inspect_settings("pnpm"));
    node.operation = PlanOperation::AdapterAction {
        action: "unrelated_action".to_string(),
        inputs: BTreeMap::new(),
    };

    let error = execute(&provider, &node)
        .expect_err("foreign actions cannot execute on the tauri provider");
    assert!(matches!(error, publish_domain::PublishError::Execution(_)));
}

#[test]
fn inspect_repository_reports_invalid_repository_roots() {
    let provider = TauriProjectProvider::new();
    let error = provider
        .inspect_repository(Path::new("/definitely/not/a/repository"))
        .expect_err("a missing repository root must fail loudly");
    assert_eq!(inspection_code(&error), "tauri_repository_path_invalid");

    let repository = single_app_repository();
    let candidates = provider
        .inspect_repository(repository.path())
        .expect("a valid repository reports its candidates");
    assert_eq!(candidates.len(), 1);
}

#[test]
fn inspect_reports_config_read_and_parse_failures() {
    let provider = TauriProjectProvider::new();
    let repository = tempfile::tempdir().expect("temp repository");
    std::fs::create_dir_all(repository.path().join("src-tauri")).expect("create src-tauri");

    let error = provider
        .inspect(repository.path(), "src-tauri/tauri.conf.json")
        .expect_err("a missing config cannot be read");
    assert_eq!(inspection_code(&error), "tauri_config_read_failed");

    write_file(
        &repository.path().join("src-tauri/tauri.conf.json"),
        "{not json",
    );
    let error = provider
        .inspect(repository.path(), "src-tauri/tauri.conf.json")
        .expect_err("an unparseable config cannot be inspected");
    assert_eq!(inspection_code(&error), "tauri_config_parse_failed");

    write_file(
        &repository.path().join("src-tauri/Tauri.toml"),
        "version = ",
    );
    let error = provider
        .inspect(repository.path(), "src-tauri/Tauri.toml")
        .expect_err("an unparseable Tauri.toml cannot be inspected");
    assert_eq!(inspection_code(&error), "tauri_config_parse_failed");
}

#[test]
fn inspect_reports_cargo_version_source_failures() {
    let provider = TauriProjectProvider::new();

    // 配置缺 version → 回落 Cargo.toml；缺文件/坏 TOML/缺字段分别报专属错误。
    let repository = tempfile::tempdir().expect("temp repository");
    write_file(
        &repository.path().join("src-tauri/tauri.conf.json"),
        r#"{"productName":"Demo"}"#,
    );
    write_file(&repository.path().join("pnpm-lock.yaml"), "");
    let error = provider
        .inspect(repository.path(), "src-tauri/tauri.conf.json")
        .expect_err("a missing Cargo.toml cannot supply a version");
    assert_eq!(inspection_code(&error), "tauri_cargo_toml_read_failed");

    write_file(
        &repository.path().join("src-tauri/Cargo.toml"),
        "[package\nname =",
    );
    let error = provider
        .inspect(repository.path(), "src-tauri/tauri.conf.json")
        .expect_err("a malformed Cargo.toml cannot supply a version");
    assert_eq!(inspection_code(&error), "tauri_cargo_toml_parse_failed");

    write_file(
        &repository.path().join("src-tauri/Cargo.toml"),
        "[package]\nname = \"demo\"\n",
    );
    let error = provider
        .inspect(repository.path(), "src-tauri/tauri.conf.json")
        .expect_err("a Cargo.toml without package.version cannot supply a version");
    assert_eq!(inspection_code(&error), "tauri_version_missing");

    write_file(
        &repository.path().join("src-tauri/Cargo.toml"),
        "[package]\nname = \"demo\"\nversion = \"not-semver\"\n",
    );
    let error = provider
        .inspect(repository.path(), "src-tauri/tauri.conf.json")
        .expect_err("a non-semver Cargo version is invalid");
    assert_eq!(inspection_code(&error), "tauri_version_invalid");

    write_file(
        &repository.path().join("src-tauri/Cargo.toml"),
        "[package]\nname = \"demo\"\nversion = \"1.0.0-beta.1\"\n",
    );
    let error = provider
        .inspect(repository.path(), "src-tauri/tauri.conf.json")
        .expect_err("a prerelease Cargo version is not stable");
    assert_eq!(inspection_code(&error), "tauri_version_not_stable");
}

#[test]
fn inspect_reports_referenced_version_file_failures() {
    let provider = TauriProjectProvider::new();
    let repository = tempfile::tempdir().expect("temp repository");
    write_file(
        &repository.path().join("src-tauri/tauri.conf.json"),
        r#"{"productName":"Demo","version":"pkg-version.json"}"#,
    );
    write_file(&repository.path().join("pnpm-lock.yaml"), "");
    write_file(
        &repository.path().join("src-tauri/Cargo.toml"),
        "[package]\nname = \"demo\"\nversion = \"1.2.3\"\n",
    );

    let error = provider
        .inspect(repository.path(), "src-tauri/tauri.conf.json")
        .expect_err("a missing referenced version file fails loudly");
    assert_eq!(inspection_code(&error), "tauri_version_file_read_failed");

    write_file(
        &repository.path().join("src-tauri/pkg-version.json"),
        "{not json",
    );
    let error = provider
        .inspect(repository.path(), "src-tauri/tauri.conf.json")
        .expect_err("a malformed referenced version file fails loudly");
    assert_eq!(inspection_code(&error), "tauri_version_file_parse_failed");

    write_file(
        &repository.path().join("src-tauri/pkg-version.json"),
        r#"{"name":"demo"}"#,
    );
    let error = provider
        .inspect(repository.path(), "src-tauri/tauri.conf.json")
        .expect_err("a referenced file without version fails loudly");
    assert_eq!(inspection_code(&error), "tauri_version_missing");
}

#[test]
fn invalid_package_json_blocks_build_driver_resolution() {
    let repository = tempfile::tempdir().expect("temp repository");
    write_file(
        &repository.path().join("src-tauri/tauri.conf.json"),
        r#"{"productName":"Demo","version":"1.2.3"}"#,
    );
    write_file(&repository.path().join("package.json"), "{not json");

    let error = TauriProjectProvider::new()
        .inspect(repository.path(), "src-tauri/tauri.conf.json")
        .expect_err("an unparseable package.json cannot resolve a build driver");
    assert_eq!(inspection_code(&error), "tauri_package_json_invalid");
}

#[test]
fn project_provider_default_constructs_a_usable_provider() {
    let provider = TauriProjectProvider::default();
    assert_eq!(provider.descriptor().identity().id, TAURI_PROVIDER_ID);
}

#[test]
fn validate_settings_rejects_non_portable_config_paths() {
    let provider = TauriProjectProvider::new();
    let settings = AdapterSettings::new(1)
        .with_value(
            "config_path",
            Value::String("/etc/absolute.conf".to_string()),
        )
        .with_value("build_driver", Value::String("pnpm".to_string()));
    let error = provider
        .validate_settings(&settings)
        .expect_err("absolute config paths are not portable");
    assert!(matches!(
        error,
        publish_domain::PublishError::InvalidAdapterSettings { .. }
    ));
}

#[test]
fn runtime_provider_delegates_discovery_descriptor_and_defaults() {
    let repository = single_app_repository();
    let provider = runtime(&repository);

    assert_eq!(provider.descriptor().identity().id, TAURI_PROVIDER_ID);
    let settings = provider.default_settings();
    assert_eq!(
        settings.values.get("config_path"),
        Some(&Value::String("src-tauri/tauri.conf.json".to_string()))
    );
    let candidates = provider
        .discover_candidates(repository.path())
        .expect("runtime provider delegates candidate discovery");
    assert_eq!(candidates.len(), 1);
}

#[test]
fn sealed_build_operations_are_validated_before_execution() {
    let repository = single_app_repository();
    let provider = runtime(&repository);
    let driver = TauriBuildDriver::Pnpm;
    let sealed_args = driver.build_command_args("src-tauri/tauri.conf.json");

    let build_node = |operation| publish_domain::PlanNode {
        operation,
        ..action_node("build", inspect_settings("pnpm"))
    };
    let program = |program: &str, args: Vec<String>| PlanOperation::RunProgram {
        program: program.to_string(),
        args,
        working_directory: None,
        environment_references: BTreeMap::new(),
    };
    let expect_invalid = |node: &publish_domain::PlanNode, marker: &str| {
        let error = execute(&provider, node).expect_err("tampered sealed builds are rejected");
        assert!(
            matches!(error, publish_domain::PublishError::InvalidPlan(_)),
            "expected InvalidPlan, got {error:?}"
        );
        assert!(error.to_string().contains(marker), "{error}");
    };

    expect_invalid(
        &build_node(program("tauri-driver:npm", sealed_args.clone())),
        "not the sealed tauri build operation",
    );
    expect_invalid(
        &build_node(program(
            &driver.program_id(),
            vec!["tauri".to_string(), "dev".to_string()],
        )),
        "not the sealed tauri build operation",
    );
    let mut tampered = program(&driver.program_id(), sealed_args.clone());
    if let PlanOperation::RunProgram {
        working_directory, ..
    } = &mut tampered
    {
        *working_directory = Some("/tmp".to_string());
    }
    expect_invalid(
        &build_node(tampered),
        "not the sealed tauri build operation",
    );
    let mut tampered = program(&driver.program_id(), sealed_args.clone());
    if let PlanOperation::RunProgram {
        environment_references,
        ..
    } = &mut tampered
    {
        environment_references.insert("SECRET".to_string(), "env:secret".to_string());
    }
    expect_invalid(
        &build_node(tampered),
        "not the sealed tauri build operation",
    );

    // 校验通过但无注入执行端口 → 明确拒绝而非猜测执行。
    let error = execute(
        &provider,
        &build_node(program(&driver.program_id(), sealed_args)),
    )
    .expect_err("a runtime provider without an execution port cannot build");
    assert!(error.to_string().contains("execution port"));
}

#[test]
fn release_gate_snapshots_must_decode_and_gates_need_programs() {
    let repository = single_app_repository();
    let provider = runtime(&repository);
    let settings = inspect_settings("pnpm");

    let mut snapshot = fixture_snapshot();
    snapshot
        .release_input
        .insert("release_gates".to_string(), json!({"program": 42}));
    let error = provider
        .plan_fragment(&snapshot, &settings)
        .expect_err("malformed sealed release gates cannot be decoded");
    assert!(
        matches!(error, publish_domain::PublishError::InvalidPlan(_)),
        "expected InvalidPlan, got {error:?}"
    );
    assert!(error.to_string().contains("decoded"), "{error}");

    let mut snapshot = fixture_snapshot();
    snapshot.release_input.insert(
        "release_gates".to_string(),
        json!([{"program": "   ", "args": []}]),
    );
    let error = provider
        .plan_fragment(&snapshot, &settings)
        .expect_err("an empty gate program is rejected");
    assert!(error.to_string().contains("cannot be empty"), "{error}");
}

// ── TauriRuntimeProvider 经注入执行端口的密封构建（无真实 tauri 调用）──

struct SealedBuildPort {
    files: &'static [(&'static str, &'static [u8])],
    outcome_error: Option<String>,
    cancelled: bool,
    fail: Option<String>,
    observed: std::sync::Mutex<Vec<publish_adapters::SealedBuildCommand>>,
}

impl publish_adapters::ProviderExecutionPort for SealedBuildPort {
    fn execute_spec(
        &self,
        _spec_json: &str,
        _cancellation: &publish_adapters::CancellationSignal,
    ) -> Result<publish_adapters::ProviderExecutionOutcome, publish_domain::PublishError> {
        unreachable!("the structured tauri path never issues spec builds")
    }

    fn execute_build(
        &self,
        request: publish_adapters::SealedBuildCommand,
        _cancellation: &publish_adapters::CancellationSignal,
    ) -> Result<publish_adapters::ProviderExecutionOutcome, publish_domain::PublishError> {
        self.observed
            .lock()
            .expect("observed commands")
            .push(request.clone());
        if let Some(error) = &self.fail {
            return Err(publish_domain::PublishError::Execution(error.clone()));
        }
        std::fs::create_dir_all(&request.output_directory).expect("create output dir");
        for (name, bytes) in self.files {
            std::fs::write(request.output_directory.join(name), bytes).expect("write artifact");
        }
        Ok(publish_adapters::ProviderExecutionOutcome {
            success: self.outcome_error.is_none(),
            cancelled: self.cancelled,
            error: self.outcome_error.clone(),
            output_dir: request.output_directory.to_string_lossy().to_string(),
        })
    }
}

fn runtime_with_port(
    repository: &tempfile::TempDir,
    output_directory: &std::path::Path,
    port: SealedBuildPort,
) -> (TauriRuntimeProvider, Arc<SealedBuildPort>) {
    let port = Arc::new(port);
    let provider = TauriRuntimeProvider::new(
        "src-tauri/tauri.conf.json".to_string(),
        "pnpm".to_string(),
        repository.path().to_path_buf(),
        Some(publish_adapters::ProviderExecution {
            port: port.clone(),
            output_directory: output_directory.to_path_buf(),
            artifact_filter: None,
            clear_stale_artifacts: false,
            source_guard: Arc::new(publish_adapters::CleanCheckoutGuard),
        }),
    );
    (provider, port)
}

fn sealed_build_node(args: Vec<String>) -> publish_domain::PlanNode {
    publish_domain::PlanNode {
        operation: PlanOperation::RunProgram {
            program: TauriBuildDriver::Pnpm.program_id(),
            args,
            working_directory: None,
            environment_references: BTreeMap::new(),
        },
        ..action_node("build", inspect_settings("pnpm"))
    }
}

#[test]
fn sealed_builds_collect_classified_artifacts_through_the_port() {
    let repository = single_app_repository();
    let output = tempfile::tempdir().expect("output dir");
    let (provider, port) = runtime_with_port(
        &repository,
        output.path(),
        SealedBuildPort {
            files: &[
                ("Demo.dmg", b"dmg"),
                ("Demo.dmg.sig", b"sig"),
                ("notes.txt", b"notes"),
            ],
            outcome_error: None,
            cancelled: false,
            fail: None,
            observed: std::sync::Mutex::new(Vec::new()),
        },
    );

    let node =
        sealed_build_node(TauriBuildDriver::Pnpm.build_command_args("src-tauri/tauri.conf.json"));
    let result = execute(&provider, &node).expect("sealed builds collect artifacts");
    let roles: BTreeMap<_, _> = result
        .artifacts
        .iter()
        .map(|artifact| (artifact.file_name.as_str(), artifact.role.as_str()))
        .collect();
    assert_eq!(roles.get("Demo.dmg"), Some(&"installer"));
    assert_eq!(roles.get("Demo.dmg.sig"), Some(&"updater-signature"));
    assert_eq!(roles.get("notes.txt"), Some(&"build-support"));

    let requests = port.observed.lock().expect("observed commands");
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].program, "pnpm");
    assert!(requests[0]
        .args
        .iter()
        .any(|arg| arg.ends_with("src-tauri/tauri.conf.json")));
}

#[test]
fn sealed_builds_surface_port_failures_cancellation_and_failed_outcomes() {
    let repository = single_app_repository();
    let output = tempfile::tempdir().expect("output dir");
    let node =
        sealed_build_node(TauriBuildDriver::Pnpm.build_command_args("src-tauri/tauri.conf.json"));

    let (provider, _port) = runtime_with_port(
        &repository,
        output.path(),
        SealedBuildPort {
            files: &[],
            outcome_error: None,
            cancelled: false,
            fail: Some("spawn failed".to_string()),
            observed: std::sync::Mutex::new(Vec::new()),
        },
    );
    let error = execute(&provider, &node).expect_err("port failures surface");
    assert!(error.to_string().contains("spawn failed"));

    let (provider, _port) = runtime_with_port(
        &repository,
        output.path(),
        SealedBuildPort {
            files: &[],
            outcome_error: Some("linker exploded".to_string()),
            cancelled: false,
            fail: None,
            observed: std::sync::Mutex::new(Vec::new()),
        },
    );
    let error = execute(&provider, &node).expect_err("failed outcomes surface");
    assert!(error.to_string().contains("linker exploded"));

    let (provider, _port) = runtime_with_port(
        &repository,
        output.path(),
        SealedBuildPort {
            files: &[],
            outcome_error: Some("user aborted".to_string()),
            cancelled: true,
            fail: None,
            observed: std::sync::Mutex::new(Vec::new()),
        },
    );
    let error = execute(&provider, &node).expect_err("cancelled outcomes report Cancelled");
    assert!(matches!(error, publish_domain::PublishError::Cancelled(_)));
}

#[test]
fn targeted_builds_materialize_the_platform_bundle_into_staging() {
    let repository = tempfile::tempdir().expect("temp repository");
    // app_root = 仓库根（tauri.conf.json 不在 src-tauri 内时）。
    write_file(
        &repository.path().join("src-tauri/tauri.conf.json"),
        r#"{"productName":"Demo","version":"1.2.3"}"#,
    );
    // materialize_target_bundle 从 <app_root>/src-tauri/target/<triple>/release/bundle 收集。
    let bundle = repository
        .path()
        .join("src-tauri/target/aarch64-apple-darwin/release/bundle/dmg");
    std::fs::create_dir_all(&bundle).expect("create bundle");
    std::fs::write(bundle.join("Demo.dmg"), b"dmg").expect("write dmg");
    write_file(&repository.path().join("pnpm-lock.yaml"), "");

    let output = tempfile::tempdir().expect("output dir");
    let (provider, _port) = runtime_with_port(
        &repository,
        output.path(),
        SealedBuildPort {
            files: &[],
            outcome_error: None,
            cancelled: false,
            fail: None,
            observed: std::sync::Mutex::new(Vec::new()),
        },
    );

    let mut args = TauriBuildDriver::Pnpm.build_command_args("src-tauri/tauri.conf.json");
    args.push("--target".to_string());
    args.push("aarch64-apple-darwin".to_string());
    let node = sealed_build_node(args);
    let result = execute(&provider, &node).expect("targeted builds materialize bundles");
    assert!(result
        .artifacts
        .iter()
        .any(|artifact| artifact.file_name.ends_with("Demo.dmg") && artifact.role == "installer"));
}

#[cfg(unix)]
#[test]
fn inspection_rejects_app_roots_escaping_the_repository_via_symlink() {
    let outside = tempfile::tempdir().expect("outside dir");
    write_file(
        &outside.path().join("tauri.conf.json"),
        r#"{"productName":"Escaped","version":"1.2.3"}"#,
    );
    write_file(
        &outside.path().join("package.json"),
        r#"{"packageManager":"pnpm@10.0.0","version":"1.2.3"}"#,
    );
    write_file(&outside.path().join("pnpm-lock.yaml"), "");

    let repository = tempfile::tempdir().expect("temp repository");
    std::fs::create_dir_all(repository.path().join("apps")).expect("apps dir");
    std::os::unix::fs::symlink(outside.path(), repository.path().join("apps/desktop"))
        .expect("symlink app root");

    let error = TauriProjectProvider::new()
        .inspect(repository.path(), "apps/desktop/tauri.conf.json")
        .expect_err("an app root resolving outside the repository must be rejected");
    assert!(error.to_string().contains("tauri_app_outside_repository"));
}

#[cfg(unix)]
#[test]
fn mirrors_resolving_outside_the_repository_are_skipped_not_reported() {
    let outside = tempfile::tempdir().expect("outside dir");
    write_file(
        &outside.path().join("package.json"),
        r#"{"packageManager":"pnpm@10.0.0","version":"9.9.9"}"#,
    );

    let repository = tempfile::tempdir().expect("temp repository");
    write_file(
        &repository.path().join("src-tauri/tauri.conf.json"),
        r#"{"productName":"Demo","version":"1.2.3"}"#,
    );
    write_file(
        &repository.path().join("src-tauri/Cargo.toml"),
        "[package]\nname = \"demo\"\nversion = \"1.2.3\"\n",
    );
    write_file(&repository.path().join("pnpm-lock.yaml"), "");
    std::os::unix::fs::symlink(
        outside.path().join("package.json"),
        repository.path().join("package.json"),
    )
    .expect("symlink package.json");

    let inspection = TauriProjectProvider::new()
        .inspect(repository.path(), "src-tauri/tauri.conf.json")
        .expect("inspection succeeds while the escaping mirror is skipped");

    assert!(inspection
        .suggested_version_mirrors
        .iter()
        .all(|mirror| mirror.path != "package.json"));
    assert!(inspection
        .suggested_version_mirrors
        .iter()
        .any(|mirror| mirror.path == "src-tauri/Cargo.toml"));
}

#[test]
fn root_level_configs_resolve_the_repository_as_the_app_root() {
    let repository = tempfile::tempdir().expect("temp repository");
    write_file(
        &repository.path().join("tauri.conf.json"),
        r#"{"productName":"Rooted","version":"1.0.0"}"#,
    );
    write_file(
        &repository.path().join("package.json"),
        r#"{"packageManager":"pnpm@10.0.0"}"#,
    );
    write_file(&repository.path().join("pnpm-lock.yaml"), "");

    let inspection = TauriProjectProvider::new()
        .inspect(repository.path(), "tauri.conf.json")
        .expect("root-level config inspects");
    assert_eq!(inspection.app_root, ".");
}

#[test]
fn inspection_surfaces_conflicting_build_driver_markers() {
    let repository = tempfile::tempdir().expect("temp repository");
    write_file(
        &repository.path().join("src-tauri/tauri.conf.json"),
        r#"{"productName":"Demo","version":"1.2.3"}"#,
    );
    write_file(&repository.path().join("package-lock.json"), "{}");
    write_file(&repository.path().join("pnpm-lock.yaml"), "");

    let error = TauriProjectProvider::new()
        .inspect(repository.path(), "src-tauri/tauri.conf.json")
        .expect_err("conflicting lockfiles must not pick a driver");
    assert!(error.to_string().contains("lockfile") || error.to_string().contains("driver"));
}
