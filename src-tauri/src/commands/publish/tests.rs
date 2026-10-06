use super::*;
use crate::errors::ErrorKind;
use crate::spec::{PublishSpec, SpecValue, SPEC_VERSION};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;
use tokio::process::Command;
use tokio::sync::Mutex as AsyncMutex;

fn base_java_spec(project_path: &str) -> PublishSpec {
    PublishSpec {
        version: SPEC_VERSION,
        provider_id: "java".to_string(),
        project_path: project_path.to_string(),
        parameters: BTreeMap::new(),
    }
}

fn sample_rendered_command() -> RenderedPublishCommand {
    RenderedPublishCommand {
        program: "dotnet".to_string(),
        args: vec!["publish".to_string(), "/tmp/app.csproj".to_string()],
        working_dir: Some("/tmp".to_string()),
        display_command: "dotnet publish \"/tmp/app.csproj\"".to_string(),
        env: Vec::new(),
    }
}

fn execution_test_lock() -> &'static AsyncMutex<()> {
    static TEST_LOCK: OnceLock<AsyncMutex<()>> = OnceLock::new();
    TEST_LOCK.get_or_init(|| AsyncMutex::new(()))
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

    let resolved = resolve_runtime_program(
        &base_java_spec(&dir.to_string_lossy()),
        "./gradlew",
        Some(&dir),
    )
    .expect("resolve wrapper");
    assert_eq!(resolved, wrapper.to_string_lossy().to_string());

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn resolve_java_program_requires_project_dir_for_wrapper_mode() {
    let err = resolve_runtime_program(&base_java_spec("/tmp/demo"), "./gradlew", None)
        .expect_err("missing dir should fail");
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
        SpecValue::String("artifacts".to_string()),
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
        PathBuf::from("/tmp/demo-project")
            .join("artifacts")
            .join("debug")
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
        warnings: None,
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

/// 能力真实性金测（ADR-0059）：dotnet 命令的逐字节形态。重构若改变实际
/// 执行的命令，必须显式更新本测试。
#[test]
fn dotnet_publish_args_are_byte_stable() {
    let mut parameters = BTreeMap::new();
    parameters.insert(
        "configuration".to_string(),
        SpecValue::String("Release".to_string()),
    );
    parameters.insert("self_contained".to_string(), SpecValue::Bool(true));
    parameters.insert("no_logo".to_string(), SpecValue::Bool(true));
    let mut properties = BTreeMap::new();
    properties.insert(
        "Version".to_string(),
        SpecValue::String("1.2.3".to_string()),
    );
    parameters.insert("properties".to_string(), SpecValue::Map(properties));
    let spec = PublishSpec {
        version: SPEC_VERSION,
        provider_id: "dotnet".to_string(),
        project_path: "/tmp/demo-project/src/App.csproj".to_string(),
        parameters,
    };

    let rendered = super::execution::render_publish_command(&spec).expect("render command");

    assert!(rendered.program.ends_with("dotnet"));
    assert_eq!(
        rendered.args,
        vec![
            "publish",
            "/tmp/demo-project/src/App.csproj",
            "--configuration",
            "Release",
            "--no-logo",
            "-p:Version=1.2.3",
            "--self-contained",
        ]
    );
}

fn render_with_provider_schema(
    provider_id: &str,
    parameters: BTreeMap<String, SpecValue>,
) -> crate::parameter::RenderedCommand {
    let provider = crate::provider::registry::provider_registry()
        .get(provider_id)
        .expect("provider");
    let schema = provider.get_schema().expect("schema");
    crate::parameter::ParameterRenderer::new(schema)
        .render(&parameters)
        .expect("render")
}

#[test]
fn go_schema_renders_target_arch_as_env_and_work_as_boolean_flag() {
    let mut parameters = BTreeMap::new();
    parameters.insert("target".to_string(), SpecValue::String("linux".to_string()));
    parameters.insert("arch".to_string(), SpecValue::String("amd64".to_string()));
    parameters.insert("work".to_string(), SpecValue::Bool(true));

    let rendered = render_with_provider_schema("go", parameters);

    assert_eq!(rendered.args, vec!["-work".to_string()]);
    assert!(!rendered.args.iter().any(|arg| arg.is_empty()));
    assert!(!rendered.args.iter().any(|arg| arg.contains("GOOS")));
    assert_eq!(
        rendered.env,
        vec![
            ("GOARCH".to_string(), "amd64".to_string()),
            ("GOOS".to_string(), "linux".to_string()),
        ]
    );
}

#[test]
fn java_schema_renders_task_configuration_and_rerun_tasks_without_empty_args() {
    let mut parameters = BTreeMap::new();
    parameters.insert("task".to_string(), SpecValue::String("build".to_string()));
    parameters.insert(
        "configuration".to_string(),
        SpecValue::String("release".to_string()),
    );
    parameters.insert("rerun_tasks".to_string(), SpecValue::Bool(true));

    let rendered = render_with_provider_schema("java", parameters);

    assert_eq!(
        rendered.args,
        vec![
            "-Drelease".to_string(),
            "--rerun-tasks".to_string(),
            "build".to_string(),
        ]
    );
    assert!(!rendered.args.iter().any(|arg| arg.is_empty()));
    assert!(rendered.env.is_empty());
}

#[test]
fn dotnet_schema_rendering_remains_byte_for_byte_unchanged() {
    let mut properties = BTreeMap::new();
    properties.insert(
        "Version".to_string(),
        SpecValue::String("1.2.3".to_string()),
    );

    let mut parameters = BTreeMap::new();
    parameters.insert(
        "configuration".to_string(),
        SpecValue::String("Release".to_string()),
    );
    parameters.insert("properties".to_string(), SpecValue::Map(properties));

    let rendered = render_with_provider_schema("dotnet", parameters);

    assert_eq!(
        rendered.args,
        vec![
            "--configuration".to_string(),
            "Release".to_string(),
            "-p:Version=1.2.3".to_string(),
        ]
    );
    assert!(rendered.env.is_empty());
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

    let error = super::output_policy::resolve_publish_output_policy(&spec)
        .expect_err("preflight should fail");

    assert_eq!(
        error.code.as_deref(),
        Some("publish_output_windows_style_path_on_posix")
    );
}

fn remote_spec(output: &str) -> PublishSpec {
    let mut parameters = BTreeMap::new();
    parameters.insert("output".to_string(), SpecValue::String(output.to_string()));
    PublishSpec {
        version: SPEC_VERSION,
        provider_id: "dotnet".to_string(),
        project_path: "/tmp/demo-project/src/App.csproj".to_string(),
        parameters,
    }
}

#[test]
fn execute_preflight_rejects_sftp_remote_output_until_upload_pipeline_lands() {
    let spec = remote_spec("sftp://deploy@nas01.example.com/var/www/publish-out");

    let error = super::output_policy::resolve_publish_output_policy(&spec)
        .expect_err("sftp remote target must be rejected at execution");

    assert_eq!(
        error.code.as_deref(),
        Some("publish_remote_target_not_implemented")
    );
    assert!(
        error.message.contains("sftp"),
        "error message should reference the scheme: {}",
        error.message
    );
}

#[test]
fn execute_preflight_rejects_s3_remote_output_until_upload_pipeline_lands() {
    let spec = remote_spec("s3://my-bucket/artifacts/release");

    let error = super::output_policy::resolve_publish_output_policy(&spec)
        .expect_err("s3 remote target must be rejected at execution");

    assert_eq!(
        error.code.as_deref(),
        Some("publish_remote_target_not_implemented")
    );
    assert!(
        error.message.contains("s3"),
        "error message should reference the scheme: {}",
        error.message
    );
}

#[test]
fn execute_preflight_rejects_webdav_remote_output_until_upload_pipeline_lands() {
    let spec = remote_spec("webdav://files.example.com/team/publish");

    let error = super::output_policy::resolve_publish_output_policy(&spec)
        .expect_err("webdav remote target must be rejected at execution");

    assert_eq!(
        error.code.as_deref(),
        Some("publish_remote_target_not_implemented")
    );
}

#[test]
fn execute_preflight_allows_local_output() {
    let spec = remote_spec("/tmp/op-publish-out-local");

    super::output_policy::resolve_publish_output_policy(&spec)
        .expect("local output should pass preflight");
}

#[cfg(target_os = "linux")]
#[test]
fn execute_preflight_allows_mounted_remote_output_on_linux() {
    let spec = remote_spec("/mnt/fake-nas/publish-out");

    super::output_policy::resolve_publish_output_policy(&spec)
        .expect("mounted /mnt/ output should pass preflight (granted)");
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

#[cfg(unix)]
#[tokio::test]
async fn build_that_exits_on_its_own_is_not_reported_cancelled() {
    let mut child = Command::new("true").spawn().expect("spawn build");

    let (status, cancelled) =
        super::execution::wait_for_build_exit(&mut child, &CancellationSignal::new())
            .await
            .expect("wait build");

    assert!(status.success());
    assert!(!cancelled);
}

/// 取消终止整棵构建进程树：前台子进程响应 SIGINT 退出，忽略 SIGINT 的后台
/// 孙进程在宽限期后被强制终止，返回时进程组内无任何存活进程。
#[cfg(unix)]
#[tokio::test]
async fn cancellation_terminates_the_whole_build_process_tree() {
    let mut command = Command::new("sh");
    command.args(["-c", "sleep 30 & sleep 30; wait"]);
    publish_adapters::process_tree::isolate(command.as_std_mut());
    let mut child = command.spawn().expect("spawn build process tree");
    let leader = child.id().expect("build leader pid");
    let descendants = wait_for_children(leader, 2).await;

    let cancellation = CancellationSignal::new();
    let started = std::time::Instant::now();
    let waiter = {
        let cancellation = cancellation.clone();
        tokio::spawn(async move {
            super::execution::wait_for_build_exit(&mut child, &cancellation).await
        })
    };
    cancellation.request();
    let (status, cancelled) = tokio::time::timeout(Duration::from_secs(10), waiter)
        .await
        .expect("cancelled build must stop within 10 s")
        .expect("join build waiter")
        .expect("wait cancelled build");

    assert!(cancelled);
    assert!(!status.success());
    assert!(started.elapsed() < Duration::from_secs(10));
    for pid in std::iter::once(leader).chain(descendants) {
        assert_process_gone(pid).await;
    }
}

/// 轮询直到 `parent` 派生出至少 `count` 个直接子进程，返回其 PID。
#[cfg(unix)]
async fn wait_for_children(parent: u32, count: usize) -> Vec<u32> {
    for _ in 0..50 {
        let output = std::process::Command::new("ps")
            .args(["-A", "-o", "pid=,ppid="])
            .output()
            .expect("list processes");
        let children = String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|line| {
                let mut fields = line.split_whitespace();
                let pid = fields.next()?.parse::<u32>().ok()?;
                let ppid = fields.next()?.parse::<u32>().ok()?;
                (ppid == parent).then_some(pid)
            })
            .collect::<Vec<_>>();
        if children.len() >= count {
            return children;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("process {parent} did not start {count} children");
}

/// 进程已退出（不存在或仅剩待回收的僵尸）；给信号投递留出短暂余量。
#[cfg(unix)]
async fn assert_process_gone(pid: u32) {
    for _ in 0..20 {
        let output = std::process::Command::new("ps")
            .args(["-o", "stat=", "-p", &pid.to_string()])
            .output()
            .expect("inspect process");
        let state = String::from_utf8_lossy(&output.stdout);
        if state.trim().is_empty() || state.trim_start().starts_with('Z') {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("process {pid} survived build cancellation");
}
