use super::*;
use crate::errors::ErrorKind;
use crate::spec::{PublishSpec, SpecValue, SPEC_VERSION};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tokio::process::{Child, Command};
use tokio::sync::Mutex as AsyncMutex;

fn base_dotnet_config() -> PublishConfig {
    PublishConfig::default()
}

fn sample_rendered_command() -> RenderedPublishCommand {
    RenderedPublishCommand {
        program: "dotnet".to_string(),
        args: vec!["publish".to_string(), "/tmp/app.csproj".to_string()],
        working_dir: Some("/tmp".to_string()),
        display_command: "dotnet publish \"/tmp/app.csproj\"".to_string(),
    }
}

fn execution_test_lock() -> &'static AsyncMutex<()> {
    static TEST_LOCK: OnceLock<AsyncMutex<()>> = OnceLock::new();
    TEST_LOCK.get_or_init(|| AsyncMutex::new(()))
}

#[cfg(target_os = "windows")]
async fn spawn_test_sleep_child() -> Child {
    Command::new("cmd")
        .args(["/C", "ping", "127.0.0.1", "-n", "6"])
        .spawn()
        .expect("spawn windows sleep child")
}

#[cfg(not(target_os = "windows"))]
async fn spawn_test_sleep_child() -> Child {
    Command::new("sleep")
        .arg("5")
        .spawn()
        .expect("spawn sleep child")
}

#[test]
fn build_dotnet_spec_maps_profile_to_properties() {
    let mut config = base_dotnet_config();
    config.use_profile = true;
    config.profile_name = "FolderProfile".to_string();
    let spec = build_dotnet_spec_from_config("/tmp/app.csproj".to_string(), config);
    let properties = spec.parameters.get("properties").expect("properties");
    match properties {
        SpecValue::Map(map) => {
            assert_eq!(
                map.get("PublishProfile"),
                Some(&SpecValue::String("FolderProfile".to_string()))
            );
        }
        _ => panic!("expected properties map"),
    }
}

#[test]
fn publish_schema_error_uses_publish_kind_and_code() {
    let err = publish_schema_error(crate::parameter::RenderError::Schema(
        "failed to parse schema JSON: boom".to_string(),
    ));

    assert_eq!(err.kind, ErrorKind::Publish);
    assert_eq!(err.code.as_deref(), Some("publish_schema_load_failed"));
}

#[test]
fn publish_render_error_keeps_render_kind_and_specific_code() {
    let err = publish_render_error(crate::parameter::RenderError::InvalidType {
        parameter: "configuration".to_string(),
        expected: "string".to_string(),
    });

    assert_eq!(err.kind, ErrorKind::RenderError);
    assert_eq!(err.code.as_deref(), Some("publish_invalid_parameter_type"));
    assert!(err.details.as_deref().is_some());
}

#[test]
fn resolve_plan_command_uses_first_step_title() {
    let plan = crate::plan::ExecutionPlan {
        version: crate::plan::PLAN_VERSION,
        spec: PublishSpec {
            version: SPEC_VERSION,
            provider_id: "cargo".to_string(),
            project_path: "/tmp/demo".to_string(),
            parameters: BTreeMap::new(),
        },
        steps: vec![crate::plan::PlanStep {
            id: "cargo.build".to_string(),
            title: "cargo build".to_string(),
            kind: "process".to_string(),
            payload: BTreeMap::new(),
        }],
    };

    let (program, args) = resolve_plan_command(&plan).expect("command");
    assert_eq!(program, "cargo");
    assert_eq!(args, vec!["build".to_string()]);
}

#[test]
fn resolve_java_program_prefers_wrapper_script_when_present() {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("one-publish-java-wrapper-{stamp}"));
    std::fs::create_dir_all(&dir).expect("create temp dir");
    #[cfg(target_os = "windows")]
    let wrapper_name = "gradlew.bat";
    #[cfg(not(target_os = "windows"))]
    let wrapper_name = "gradlew";
    let wrapper = dir.join(wrapper_name);
    std::fs::write(&wrapper, "echo wrapper").expect("write wrapper");

    let resolved = resolve_java_program("./gradlew", Some(&dir)).expect("resolve wrapper");
    assert_eq!(resolved, wrapper.to_string_lossy().to_string());

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn resolve_java_program_requires_project_dir_for_wrapper_mode() {
    let err = resolve_java_program("./gradlew", None).expect_err("missing dir should fail");
    assert!(err.message.contains("project directory"));
}

#[test]
fn infer_output_dir_for_cargo_release_defaults_to_target_release() {
    let mut params = BTreeMap::new();
    params.insert("release".to_string(), SpecValue::Bool(true));
    let spec = PublishSpec {
        version: SPEC_VERSION,
        provider_id: "cargo".to_string(),
        project_path: "/tmp/demo-project".to_string(),
        parameters: params,
    };

    let output_dir = infer_output_dir(&spec);
    assert!(output_dir.ends_with("target/release") || output_dir.ends_with("target\\release"));
}

#[test]
fn infer_output_dir_for_dotnet_relative_output_resolves_from_project_dir() {
    let mut params = BTreeMap::new();
    params.insert(
        "output".to_string(),
        SpecValue::String("./publish/linux-x64".to_string()),
    );
    let spec = PublishSpec {
        version: SPEC_VERSION,
        provider_id: "dotnet".to_string(),
        project_path: "/tmp/demo-project/src/app.csproj".to_string(),
        parameters: params,
    };

    let output_dir = infer_output_dir(&spec);

    assert_eq!(
        PathBuf::from(output_dir),
        PathBuf::from("/tmp/demo-project/src").join("./publish/linux-x64")
    );
}

#[test]
fn infer_output_dir_for_cargo_relative_target_dir_resolves_from_project_dir() {
    let mut params = BTreeMap::new();
    params.insert(
        "target_dir".to_string(),
        SpecValue::String("artifacts/release".to_string()),
    );
    let spec = PublishSpec {
        version: SPEC_VERSION,
        provider_id: "cargo".to_string(),
        project_path: "/tmp/demo-project".to_string(),
        parameters: params,
    };

    let output_dir = infer_output_dir(&spec);

    assert_eq!(
        PathBuf::from(output_dir),
        PathBuf::from("/tmp/demo-project").join("artifacts/release")
    );
}

#[test]
fn publish_result_serialization_excludes_output_payload() {
    let serialized = serde_json::to_value(PublishResult {
        provider_id: "dotnet".to_string(),
        success: true,
        cancelled: false,
        error: None,
        command: sample_rendered_command(),
        output_log: "$ dotnet publish \"/tmp/app.csproj\"\n".to_string(),
        output_dir: "/tmp/out".to_string(),
        file_count: 3,
    })
    .expect("serialize publish result");

    assert_eq!(serialized.get("output"), None);
    assert_eq!(
        serialized
            .get("provider_id")
            .and_then(serde_json::Value::as_str),
        Some("dotnet")
    );
}

#[test]
fn build_display_command_quotes_path_like_arguments() {
    let display = super::output::build_display_command(
        "dotnet",
        &[
            "publish".to_string(),
            "/tmp/demo-project/src/App.csproj".to_string(),
            "-c".to_string(),
            "Release".to_string(),
            "-o".to_string(),
            "./publish/osx-arm64".to_string(),
        ],
    );

    assert_eq!(
        display,
        "dotnet publish \"/tmp/demo-project/src/App.csproj\" -c Release -o \"./publish/osx-arm64\""
    );
}

#[test]
fn recursive_file_count_includes_nested_output_files() {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("one-publish-file-count-{stamp}"));
    let nested = root.join("nested").join("inner");
    std::fs::create_dir_all(&nested).expect("create nested output");
    std::fs::write(root.join("app.dll"), "dll").expect("write root file");
    std::fs::write(nested.join("app.pdb"), "pdb").expect("write nested file");

    assert_eq!(
        super::output::count_output_files(&root.to_string_lossy()),
        2
    );

    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn render_publish_command_uses_backend_display_command() {
    let mut parameters = BTreeMap::new();
    parameters.insert(
        "configuration".to_string(),
        SpecValue::String("Release".to_string()),
    );
    parameters.insert(
        "output".to_string(),
        SpecValue::String("./publish/osx-arm64".to_string()),
    );
    let spec = PublishSpec {
        version: SPEC_VERSION,
        provider_id: "dotnet".to_string(),
        project_path: "/tmp/demo-project/src/App.csproj".to_string(),
        parameters,
    };

    let rendered = super::execution::render_publish_command(&spec).expect("render command");

    assert!(rendered.program.ends_with("dotnet"));
    assert_eq!(
        rendered.display_command,
        "dotnet publish \"/tmp/demo-project/src/App.csproj\" --configuration Release --output \"./publish/osx-arm64\""
    );
}

#[cfg(not(target_os = "windows"))]
#[test]
fn execute_path_preflight_rejects_windows_style_output_when_frontend_is_bypassed() {
    let mut parameters = BTreeMap::new();
    parameters.insert(
        "output".to_string(),
        SpecValue::String("D:\\PRD".to_string()),
    );
    let spec = PublishSpec {
        version: SPEC_VERSION,
        provider_id: "dotnet".to_string(),
        project_path: "/tmp/demo-project/src/App.csproj".to_string(),
        parameters,
    };

    let error = super::execution::ensure_publish_output_preflight(&spec)
        .expect_err("preflight should fail");

    assert_eq!(
        error.code.as_deref(),
        Some("publish_output_windows_style_path_on_posix")
    );
}

#[tokio::test]
async fn reserve_execution_blocks_second_start_while_starting() {
    let _guard = execution_test_lock().lock().await;
    force_clear_running_execution().await;

    let permit = reserve_execution("starting-session".to_string())
        .await
        .expect("reserve first execution");
    let error = reserve_execution("second-session".to_string())
        .await
        .expect_err("second execution should be blocked");

    assert_eq!(error.code.as_deref(), Some("publish_already_running"));

    clear_running_execution(&permit.session_id).await;
}

#[tokio::test]
async fn cancel_provider_publish_marks_starting_execution() {
    let _guard = execution_test_lock().lock().await;
    force_clear_running_execution().await;

    let permit = reserve_execution("starting-cancel".to_string())
        .await
        .expect("reserve execution");

    assert!(cancel_provider_publish().await.expect("cancel starting"));
    assert!(permit.is_cancel_requested());

    clear_running_execution(&permit.session_id).await;
}

#[tokio::test]
async fn cancel_provider_publish_kills_running_execution() {
    let _guard = execution_test_lock().lock().await;
    force_clear_running_execution().await;

    let permit = reserve_execution("running-cancel".to_string())
        .await
        .expect("reserve execution");
    let child = Arc::new(tokio::sync::Mutex::new(spawn_test_sleep_child().await));
    permit.mark_running(Arc::clone(&child)).await;

    assert!(cancel_provider_publish().await.expect("cancel running"));
    assert!(permit.is_cancel_requested());

    tokio::time::timeout(Duration::from_secs(2), async {
        let mut running_child = child.lock().await;
        running_child.wait().await.expect("wait child after cancel");
    })
    .await
    .expect("child should exit after cancellation");

    clear_running_execution(&permit.session_id).await;
}
