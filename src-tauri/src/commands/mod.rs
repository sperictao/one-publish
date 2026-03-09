// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use crate::artifact::{PackageFormat, PackageResult, SignMethod, SignResult};
use crate::provider::registry::ProviderRegistry;
use crate::spec::{PublishSpec, SpecValue, SPEC_VERSION};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::ErrorKind as IoErrorKind;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, OnceLock,
};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, Mutex};

mod config;
mod environment;
mod export;
mod provider;
mod repository;
mod updater;
pub use config::{apply_imported_config, export_config, import_config};
pub use environment::{apply_fix, run_environment_check};
pub use export::{
    export_diagnostics_index, export_execution_history, export_execution_snapshot,
    export_failure_group_bundle, export_preflight_report, open_execution_snapshot,
};
pub use provider::{get_provider_schema, import_from_command, list_providers};
pub use repository::{
    check_repository_branch_connectivity, detect_repository_provider, scan_project,
    scan_project_files, scan_repository_branches,
};
pub use updater::{
    check_update, get_current_version, get_shortcuts_help, get_updater_config_health,
    get_updater_help_paths, install_update, open_updater_help, UpdateInfo,
    UpdaterConfigHealth, UpdaterHelpPaths,
};
pub(crate) use config::{
    __cmd__apply_imported_config, __cmd__export_config, __cmd__import_config,
};
pub(crate) use environment::{__cmd__apply_fix, __cmd__run_environment_check};
pub(crate) use export::{
    __cmd__export_diagnostics_index, __cmd__export_execution_history,
    __cmd__export_execution_snapshot, __cmd__export_failure_group_bundle,
    __cmd__export_preflight_report, __cmd__open_execution_snapshot,
};
pub(crate) use provider::{
    __cmd__get_provider_schema, __cmd__import_from_command, __cmd__list_providers,
};
pub(crate) use repository::{
    __cmd__check_repository_branch_connectivity, __cmd__detect_repository_provider,
    __cmd__scan_project, __cmd__scan_project_files, __cmd__scan_repository_branches,
};
pub(crate) use updater::{
    __cmd__check_update, __cmd__get_current_version, __cmd__get_shortcuts_help,
    __cmd__get_updater_config_health, __cmd__get_updater_help_paths,
    __cmd__install_update, __cmd__open_updater_help,
};

#[derive(Debug, Serialize, Deserialize)]
pub struct ProjectInfo {
    pub root_path: String,
    pub project_file: String,
    pub publish_profiles: Vec<String>,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct PublishConfig {
    pub configuration: String,
    pub runtime: String,
    pub self_contained: bool,
    pub output_dir: String,
    pub use_profile: bool,
    pub profile_name: String,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct PublishResult {
    pub provider_id: String,
    pub success: bool,
    pub cancelled: bool,
    pub output: String,
    pub error: Option<String>,
    pub output_dir: String,
    pub file_count: usize,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublishLogChunkEvent {
    session_id: String,
    line: String,
}
#[derive(Clone)]
struct RunningExecution {
    session_id: String,
    child: Arc<Mutex<Child>>,
    cancel_requested: Arc<AtomicBool>,
}
static RUNNING_EXECUTION: OnceLock<Mutex<Option<RunningExecution>>> = OnceLock::new();
fn running_execution_slot() -> &'static Mutex<Option<RunningExecution>> {
    RUNNING_EXECUTION.get_or_init(|| Mutex::new(None))
}

fn classify_process_spawn_error(kind: IoErrorKind) -> &'static str {
    match kind {
        IoErrorKind::NotFound => "tool_missing",
        IoErrorKind::PermissionDenied => "permission_denied",
        _ => "publish_spawn_failed",
    }
}

fn classify_process_wait_error(kind: IoErrorKind) -> &'static str {
    match kind {
        IoErrorKind::PermissionDenied => "permission_denied",
        _ => "publish_wait_failed",
    }
}

#[tauri::command]
pub async fn execute_publish(
    app: AppHandle,
    project_path: String,
    config: PublishConfig,
) -> Result<PublishResult, crate::errors::AppError> {
    let project_file = PathBuf::from(&project_path);
    if !project_file.exists() {
        return Err(crate::errors::AppError::unknown_with_code(
            format!("project file does not exist: {}", project_path),
            "project_path_not_found",
        ));
    }
    let spec = build_dotnet_spec_from_config(project_path, config);
    execute_publish_spec(&app, spec).await
}
#[tauri::command]
pub async fn execute_provider_publish(
    app: AppHandle,
    spec: PublishSpec,
) -> Result<PublishResult, crate::errors::AppError> {
    let project_path = PathBuf::from(&spec.project_path);
    if !project_path.exists() {
        return Err(crate::errors::AppError::unknown_with_code(
            format!("project path does not exist: {}", spec.project_path),
            "project_path_not_found",
        ));
    }
    execute_publish_spec(&app, spec).await
}
#[tauri::command]
pub async fn cancel_provider_publish() -> Result<bool, crate::errors::AppError> {
    let running = {
        let guard = running_execution_slot().lock().await;
        guard.clone()
    };
    let Some(running) = running else {
        return Ok(false);
    };
    running.cancel_requested.store(true, Ordering::SeqCst);
    let mut child = running.child.lock().await;
    child.start_kill().map_err(|err| {
        crate::errors::AppError::unknown_with_code(
            format!("failed to cancel publish: {}", err),
            "publish_cancel_failed",
        )
    })?;
    Ok(true)
}
fn build_dotnet_spec_from_config(project_path: String, config: PublishConfig) -> PublishSpec {
    let mut parameters = BTreeMap::<String, SpecValue>::new();
    if config.use_profile && !config.profile_name.is_empty() {
        let mut properties = BTreeMap::<String, SpecValue>::new();
        properties.insert(
            "PublishProfile".to_string(),
            SpecValue::String(config.profile_name),
        );
        parameters.insert("properties".to_string(), SpecValue::Map(properties));
    } else {
        parameters.insert(
            "configuration".to_string(),
            SpecValue::String(config.configuration),
        );
        if !config.runtime.is_empty() {
            parameters.insert("runtime".to_string(), SpecValue::String(config.runtime));
        }
        if config.self_contained {
            parameters.insert("self_contained".to_string(), SpecValue::Bool(true));
        }
        if !config.output_dir.is_empty() {
            parameters.insert("output".to_string(), SpecValue::String(config.output_dir));
        }
    }
    PublishSpec {
        version: SPEC_VERSION,
        provider_id: "dotnet".to_string(),
        project_path,
        parameters,
    }
}
async fn execute_publish_spec(
    app: &AppHandle,
    spec: PublishSpec,
) -> Result<PublishResult, crate::errors::AppError> {
    {
        let running = running_execution_slot().lock().await;
        if running.is_some() {
            return Err(crate::errors::AppError::unknown_with_code(
                "another publish execution is already running",
                "publish_already_running",
            ));
        }
    }
    let plan = crate::compiler::compile(&spec).map_err(crate::errors::AppError::from)?;
    let registry = ProviderRegistry::new();
    let provider = registry
        .get(&spec.provider_id)
        .map_err(crate::errors::AppError::from)?;
    let schema = provider
        .get_schema()
        .map_err(|e| crate::errors::AppError::from(crate::compiler::CompileError::from(e)))?;
    let renderer = crate::parameter::ParameterRenderer::new(schema);
    let rendered = renderer
        .render(&spec.parameters)
        .map_err(|e| crate::errors::AppError::from(crate::compiler::CompileError::from(e)))?;
    let (base_program, mut args) = resolve_plan_command(&plan)?;
    if spec.provider_id == "dotnet" {
        args.push(spec.project_path.clone());
    }
    args.extend(rendered.args);
    let working_dir = resolve_working_dir(&spec);
    let program = if spec.provider_id == "java" {
        resolve_java_program(&base_program, working_dir.as_ref())?
    } else {
        base_program
    };
    log::info!(
        "Executing provider plan: provider={} program={} args={}",
        spec.provider_id,
        program,
        args.join(" ")
    );
    let mut command = Command::new(&program);
    command
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = &working_dir {
        command.current_dir(dir);
    }
    let mut child = command.spawn().map_err(|e| {
        crate::errors::AppError::unknown_with_code(
            format!("failed to spawn {}: {}", program, e),
            classify_process_spawn_error(e.kind()),
        )
    })?;
    let command_line = if args.is_empty() {
        format!("$ {}", program)
    } else {
        format!("$ {} {}", program, args.join(" "))
    };
    let session_id = build_publish_session_id(&spec.provider_id);
    emit_publish_log(app, &session_id, &command_line);
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let child = Arc::new(Mutex::new(child));
    let cancel_requested = Arc::new(AtomicBool::new(false));
    {
        let mut slot = running_execution_slot().lock().await;
        *slot = Some(RunningExecution {
            session_id: session_id.clone(),
            child: Arc::clone(&child),
            cancel_requested: Arc::clone(&cancel_requested),
        });
    }
    let run_result: Result<(String, bool, bool, Option<String>), crate::errors::AppError> = async {
        let mut output_lines = vec![command_line];
        let (sender, receiver) = mpsc::unbounded_channel::<(String, String)>();
        let collector = tokio::spawn(collect_log_lines(app.clone(), session_id.clone(), receiver));
        let mut readers = Vec::new();
        if let Some(stdout) = stdout {
            readers.push(tokio::spawn(read_stream_lines(
                stdout,
                "stdout",
                sender.clone(),
            )));
        }
        if let Some(stderr) = stderr {
            readers.push(tokio::spawn(read_stream_lines(
                stderr,
                "stderr",
                sender.clone(),
            )));
        }
        drop(sender);
        let status = {
            let mut running_child = child.lock().await;
            running_child.wait().await.map_err(|err| {
                crate::errors::AppError::unknown_with_code(
                    format!("failed to wait publish process: {}", err),
                    classify_process_wait_error(err.kind()),
                )
            })?
        };
        for reader in readers {
            let _ = reader.await;
        }
        let streamed_lines = collector.await.map_err(|err| {
            crate::errors::AppError::unknown_with_code(
                format!("failed to collect publish logs: {}", err),
                "publish_log_collect_failed",
            )
        })?;
        output_lines.extend(streamed_lines);
        let cancelled = cancel_requested.load(Ordering::SeqCst);
        if cancelled {
            let cancelled_line = "[cancelled] 发布已取消".to_string();
            emit_publish_log(app, &session_id, &cancelled_line);
            output_lines.push(cancelled_line);
        }
        let success = status.success() && !cancelled;
        let error = if cancelled {
            Some("发布已取消".to_string())
        } else if success {
            None
        } else {
            Some(format!("发布失败，退出代码: {:?}", status.code()))
        };
        Ok((output_lines.join("\n"), success, cancelled, error))
    }
    .await;
    clear_running_execution(&session_id).await;
    let (output_text, success, cancelled, error) = run_result?;
    let output_dir = infer_output_dir(&spec);
    let file_count = if success {
        count_output_files(&output_dir)
    } else {
        0
    };
    Ok(PublishResult {
        provider_id: spec.provider_id,
        success,
        cancelled,
        output: output_text,
        error,
        output_dir,
        file_count,
    })
}
fn build_publish_session_id(provider_id: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    format!("{}-{}", provider_id, nanos)
}
fn emit_publish_log(app: &AppHandle, session_id: &str, line: &str) {
    let payload = PublishLogChunkEvent {
        session_id: session_id.to_string(),
        line: line.to_string(),
    };
    if let Err(err) = app.emit("provider-publish-log", payload) {
        log::warn!("failed to emit provider-publish-log: {}", err);
    }
}
async fn collect_log_lines(
    app: AppHandle,
    session_id: String,
    mut receiver: mpsc::UnboundedReceiver<(String, String)>,
) -> Vec<String> {
    let mut lines = Vec::new();
    while let Some((stream, line)) = receiver.recv().await {
        let rendered = if stream == "stderr" {
            format!("[stderr] {}", line)
        } else {
            line
        };
        emit_publish_log(&app, &session_id, &rendered);
        lines.push(rendered);
    }
    lines
}
async fn read_stream_lines<R>(
    stream: R,
    stream_name: &'static str,
    sender: mpsc::UnboundedSender<(String, String)>,
) where
    R: AsyncRead + Unpin + Send + 'static,
{
    let mut lines = BufReader::new(stream).lines();
    loop {
        match lines.next_line().await {
            Ok(Some(line)) => {
                if sender.send((stream_name.to_string(), line)).is_err() {
                    return;
                }
            }
            Ok(None) => return,
            Err(err) => {
                let message = format!("stream read error: {}", err);
                let _ = sender.send(("stderr".to_string(), message));
                return;
            }
        }
    }
}
async fn clear_running_execution(session_id: &str) {
    let mut slot = running_execution_slot().lock().await;
    let should_clear = slot
        .as_ref()
        .map(|running| running.session_id == session_id)
        .unwrap_or(false);
    if should_clear {
        *slot = None;
    }
}
fn resolve_plan_command(
    plan: &crate::plan::ExecutionPlan,
) -> Result<(String, Vec<String>), crate::errors::AppError> {
    let first_step = plan.steps.first().ok_or_else(|| {
        crate::errors::AppError::unknown_with_code(
            "execution plan has no step",
            "plan_missing_step",
        )
    })?;
    let mut parts = first_step.title.split_whitespace();
    let program = parts
        .next()
        .ok_or_else(|| {
            crate::errors::AppError::unknown_with_code(
                "execution step title is empty",
                "plan_invalid_step_title",
            )
        })?
        .to_string();
    let args = parts.map(|item| item.to_string()).collect();
    Ok((program, args))
}
fn resolve_java_program(
    program: &str,
    working_dir: Option<&PathBuf>,
) -> Result<String, crate::errors::AppError> {
    if program != "./gradlew" && program != "gradlew" {
        return Ok(program.to_string());
    }
    let Some(dir) = working_dir else {
        return Err(crate::errors::AppError::unknown_with_code(
            "java provider requires a project directory",
            "java_project_dir_required",
        ));
    };
    #[cfg(target_os = "windows")]
    let wrapper_name = "gradlew.bat";
    #[cfg(not(target_os = "windows"))]
    let wrapper_name = "gradlew";
    let wrapper_path = dir.join(wrapper_name);
    if wrapper_path.is_file() {
        return Ok(wrapper_path.to_string_lossy().to_string());
    }
    if crate::environment::command_exists("gradle") {
        return Ok("gradle".to_string());
    }
    Err(crate::errors::AppError::unknown_with_code(
        format!(
            "gradle wrapper not found at {} and `gradle` is not available in PATH",
            wrapper_path.to_string_lossy()
        ),
        "java_gradle_not_found",
    ))
}
fn resolve_working_dir(spec: &PublishSpec) -> Option<PathBuf> {
    let path = PathBuf::from(&spec.project_path);
    match spec.provider_id.as_str() {
        "dotnet" => path.parent().map(|p| p.to_path_buf()),
        _ => {
            if path.is_dir() {
                Some(path)
            } else {
                path.parent().map(|p| p.to_path_buf())
            }
        }
    }
}
fn infer_output_dir(spec: &PublishSpec) -> String {
    match spec.provider_id.as_str() {
        "dotnet" => {
            if let Some(output) = read_parameter_string(&spec.parameters, "output") {
                return output;
            }
            if let Some(parent) = Path::new(&spec.project_path).parent() {
                let configuration = read_parameter_string(&spec.parameters, "configuration")
                    .unwrap_or_else(|| "Release".to_string());
                return parent
                    .join("bin")
                    .join(configuration)
                    .join("publish")
                    .to_string_lossy()
                    .to_string();
            }
            String::new()
        }
        "cargo" => {
            if let Some(target_dir) = read_parameter_string(&spec.parameters, "target_dir") {
                return target_dir;
            }
            if let Some(project_dir) = resolve_working_dir(spec) {
                let profile = if read_parameter_bool(&spec.parameters, "release") {
                    "release"
                } else {
                    "debug"
                };
                return project_dir
                    .join("target")
                    .join(profile)
                    .to_string_lossy()
                    .to_string();
            }
            String::new()
        }
        "go" => read_parameter_string(&spec.parameters, "output").unwrap_or_default(),
        "java" => resolve_working_dir(spec)
            .map(|dir| dir.join("build").join("libs").to_string_lossy().to_string())
            .unwrap_or_default(),
        _ => String::new(),
    }
}
fn read_parameter_string(parameters: &BTreeMap<String, SpecValue>, key: &str) -> Option<String> {
    match parameters.get(key) {
        Some(SpecValue::String(value)) if !value.is_empty() => Some(value.clone()),
        Some(SpecValue::Number(value)) => Some(value.to_string()),
        _ => None,
    }
}
fn read_parameter_bool(parameters: &BTreeMap<String, SpecValue>, key: &str) -> bool {
    matches!(parameters.get(key), Some(SpecValue::Bool(true)))
}
fn count_output_files(output_dir: &str) -> usize {
    if output_dir.is_empty() {
        return 0;
    }
    let path = Path::new(output_dir);
    if !path.is_dir() {
        return 0;
    }
    std::fs::read_dir(path)
        .map(|entries| entries.count())
        .unwrap_or(0)
}
/// Package an output directory into a single artifact file.
#[tauri::command]
pub async fn package_artifact(
    input_dir: String,
    output_path: String,
    format: Option<PackageFormat>,
    include_root_dir: Option<bool>,
) -> Result<PackageResult, crate::errors::AppError> {
    let format = format.unwrap_or(PackageFormat::Zip);
    let include_root_dir = include_root_dir.unwrap_or(true);
    crate::artifact::package_directory(
        Path::new(&input_dir),
        Path::new(&output_path),
        format,
        include_root_dir,
    )
    .await
    .map_err(|e| crate::errors::AppError::unknown(format!("package failed: {}", e)))
}
/// Sign an artifact file using a supported signing method.
#[tauri::command]
pub async fn sign_artifact(
    artifact_path: String,
    method: SignMethod,
    output_path: Option<String>,
    key_id: Option<String>,
) -> Result<SignResult, crate::errors::AppError> {
    crate::artifact::sign_artifact(
        Path::new(&artifact_path),
        method,
        output_path.as_deref().map(Path::new),
        key_id.as_deref(),
    )
    .await
    .map_err(|e| crate::errors::AppError::unknown(format!("sign failed: {}", e)))
}
#[cfg(test)]
mod tests {
    use super::*;

    fn base_dotnet_config() -> PublishConfig {
        PublishConfig {
            configuration: "Release".to_string(),
            runtime: String::new(),
            self_contained: false,
            output_dir: String::new(),
            use_profile: false,
            profile_name: String::new(),
        }
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
}
