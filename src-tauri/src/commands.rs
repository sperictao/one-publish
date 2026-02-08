// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use crate::artifact::{PackageFormat, PackageResult, SignMethod, SignResult};
use crate::command_parser::CommandParser;
use crate::config_export::{ConfigExport, ConfigProfile};
use crate::environment::{check_environment, FixAction, FixResult, FixType};
use crate::provider::registry::ProviderRegistry;
use crate::provider::ProviderManifest;
use crate::spec::{PublishSpec, SpecValue, SPEC_VERSION};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, OnceLock,
};
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::{Error as UpdaterError, UpdaterExt};
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, Mutex};
use tokio::time::{timeout, Duration};
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
/// Find project root by looking for .sln or .csproj files
fn find_project_root(start_path: &Path) -> Option<PathBuf> {
    let mut current = start_path.to_path_buf();
    // First check if start_path itself is a directory containing .sln
    if current.is_dir() {
        // Look for .sln files
        if let Ok(entries) = std::fs::read_dir(&current) {
            for entry in entries.flatten() {
                if let Some(ext) = entry.path().extension() {
                    if ext == "sln" {
                        return Some(current);
                    }
                }
            }
        }
    }
    // Walk up the directory tree
    while let Some(parent) = current.parent() {
        if let Ok(entries) = std::fs::read_dir(parent) {
            for entry in entries.flatten() {
                if let Some(ext) = entry.path().extension() {
                    if ext == "sln" {
                        return Some(parent.to_path_buf());
                    }
                }
            }
        }
        current = parent.to_path_buf();
    }
    None
}
/// Find .csproj file in UI directory or project root
fn find_project_file(root: &Path) -> Option<PathBuf> {
    // First try UI subdirectory
    let ui_dir = root.join("UI");
    if ui_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&ui_dir) {
            for entry in entries.flatten() {
                if let Some(ext) = entry.path().extension() {
                    if ext == "csproj" {
                        return Some(entry.path());
                    }
                }
            }
        }
    }
    // Then try root directory
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            if let Some(ext) = entry.path().extension() {
                if ext == "csproj" {
                    return Some(entry.path());
                }
            }
        }
    }
    // Try src directory
    let src_dir = root.join("src");
    if src_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&src_dir) {
            for entry in entries.flatten() {
                if let Some(ext) = entry.path().extension() {
                    if ext == "csproj" {
                        return Some(entry.path());
                    }
                }
            }
        }
    }
    None
}
/// Scan for publish profiles in Properties/PublishProfiles
fn scan_publish_profiles(project_file: &Path) -> Vec<String> {
    let mut profiles = Vec::new();
    if let Some(project_dir) = project_file.parent() {
        let profiles_dir = project_dir.join("Properties").join("PublishProfiles");
        if profiles_dir.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&profiles_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().map_or(false, |e| e == "pubxml") {
                        if let Some(stem) = path.file_stem() {
                            profiles.push(stem.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }
    }
    profiles.sort();
    profiles
}
#[tauri::command]
pub async fn scan_project(
    start_path: Option<String>,
) -> Result<ProjectInfo, crate::errors::AppError> {
    let search_path = match start_path {
        Some(p) => PathBuf::from(p),
        None => {
            std::env::current_dir().map_err(|e| crate::errors::AppError::unknown(e.to_string()))?
        }
    };
    let root_path = find_project_root(&search_path)
        .ok_or_else(|| crate::errors::AppError::unknown("cannot find project root (.sln)"))?;
    let project_file = find_project_file(&root_path)
        .ok_or_else(|| crate::errors::AppError::unknown("cannot find project file (.csproj)"))?;
    let publish_profiles = scan_publish_profiles(&project_file);
    Ok(ProjectInfo {
        root_path: root_path.to_string_lossy().to_string(),
        project_file: project_file.to_string_lossy().to_string(),
        publish_profiles,
    })
}
#[tauri::command]
pub async fn execute_publish(
    app: AppHandle,
    project_path: String,
    config: PublishConfig,
) -> Result<PublishResult, crate::errors::AppError> {
    let project_file = PathBuf::from(&project_path);
    if !project_file.exists() {
        return Err(crate::errors::AppError::unknown(format!(
            "project file does not exist: {}",
            project_path
        )));
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
        return Err(crate::errors::AppError::unknown(format!(
            "project path does not exist: {}",
            spec.project_path
        )));
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
        crate::errors::AppError::unknown(format!("failed to cancel publish: {}", err))
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
            return Err(crate::errors::AppError::unknown(
                "another publish execution is already running",
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
        crate::errors::AppError::unknown(format!("failed to spawn {}: {}", program, e))
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
                crate::errors::AppError::unknown(format!("failed to wait publish process: {}", err))
            })?
        };
        for reader in readers {
            let _ = reader.await;
        }
        let streamed_lines = collector.await.map_err(|err| {
            crate::errors::AppError::unknown(format!("failed to collect publish logs: {}", err))
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
    let first_step = plan
        .steps
        .first()
        .ok_or_else(|| crate::errors::AppError::unknown("execution plan has no step"))?;
    let mut parts = first_step.title.split_whitespace();
    let program = parts
        .next()
        .ok_or_else(|| crate::errors::AppError::unknown("execution step title is empty"))?
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
        return Err(crate::errors::AppError::unknown(
            "java provider requires a project directory",
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
    Err(crate::errors::AppError::unknown(format!(
        "gradle wrapper not found at {} and `gradle` is not available in PATH",
        wrapper_path.to_string_lossy()
    )))
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
/// 版本信息
#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub current_version: String,
    pub available_version: Option<String>,
    pub has_update: bool,
    pub release_notes: Option<String>,
    pub message: Option<String>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterHelpPaths {
    pub docs_path: String,
    pub template_path: String,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterConfigHealth {
    pub configured: bool,
    pub message: String,
}
fn no_update_info(message: Option<String>) -> UpdateInfo {
    UpdateInfo {
        current_version: env!("CARGO_PKG_VERSION").to_string(),
        available_version: None,
        has_update: false,
        release_notes: None,
        message,
    }
}
fn map_updater_error(err: UpdaterError) -> String {
    match err {
        UpdaterError::EmptyEndpoints => {
            "更新源未配置，请在 tauri.conf.json 中设置 updater 的 endpoints 与 pubkey".to_string()
        }
        UpdaterError::InsecureTransportProtocol => {
            "更新地址必须使用 https 协议（或在开发环境显式允许非安全协议）".to_string()
        }
        _ => err.to_string(),
    }
}
fn resolve_updater_help_paths() -> Result<(PathBuf, PathBuf), String> {
    let mut roots = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        roots.push(cwd);
    }
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            roots.push(parent.to_path_buf());
        }
    }
    for root in roots {
        let mut current = root;
        loop {
            let docs = current.join("docs").join("updater").join("SETUP.md");
            let template = current
                .join("src-tauri")
                .join("tauri.conf.updater.example.json");
            if docs.exists() && template.exists() {
                return Ok((docs, template));
            }
            if !current.pop() {
                break;
            }
        }
    }
    Err("未找到 updater 指南文件，请在源码仓库中运行该功能".to_string())
}
#[tauri::command]
pub fn get_updater_help_paths() -> Result<UpdaterHelpPaths, crate::errors::AppError> {
    let (docs, template) =
        resolve_updater_help_paths().map_err(crate::errors::AppError::unknown)?;
    Ok(UpdaterHelpPaths {
        docs_path: docs.to_string_lossy().to_string(),
        template_path: template.to_string_lossy().to_string(),
    })
}
#[tauri::command]
pub fn get_updater_config_health(app: AppHandle) -> UpdaterConfigHealth {
    match app.updater() {
        Ok(_) => UpdaterConfigHealth {
            configured: true,
            message: "updater 配置已就绪".to_string(),
        },
        Err(err) => UpdaterConfigHealth {
            configured: false,
            message: format!("更新源未配置或不可用: {}", map_updater_error(err)),
        },
    }
}
#[tauri::command]
pub fn open_updater_help(target: String) -> Result<String, crate::errors::AppError> {
    let (docs, template) =
        resolve_updater_help_paths().map_err(crate::errors::AppError::unknown)?;
    let path = match target.as_str() {
        "docs" => docs,
        "template" => template,
        _ => {
            return Err(crate::errors::AppError::unknown(format!(
                "unsupported updater help target: {}",
                target
            )))
        }
    };
    open::that(&path).map_err(|e| {
        crate::errors::AppError::unknown(format!("failed to open updater help file: {}", e))
    })?;
    Ok(path.to_string_lossy().to_string())
}
/// 检查更新
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<UpdateInfo, String> {
    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(err) => {
            return Ok(no_update_info(Some(format!(
                "更新源未配置或不可用: {}",
                map_updater_error(err)
            ))));
        }
    };
    match updater.check().await {
        Ok(Some(update)) => Ok(UpdateInfo {
            current_version: update.current_version,
            available_version: Some(update.version),
            has_update: true,
            release_notes: update.body,
            message: Some("发现可用更新".to_string()),
        }),
        Ok(None) => Ok(no_update_info(Some("当前已是最新版本".to_string()))),
        Err(err) => Ok(no_update_info(Some(format!(
            "检查更新失败: {}",
            map_updater_error(err)
        )))),
    }
}
/// 执行更新并重启
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<String, String> {
    let updater = app
        .updater()
        .map_err(|err| format!("更新源未配置或不可用: {}", map_updater_error(err)))?;
    let maybe_update = updater
        .check()
        .await
        .map_err(|err| format!("检查更新失败: {}", map_updater_error(err)))?;
    let Some(update) = maybe_update else {
        return Ok("当前已是最新版本，无需安装".to_string());
    };
    let target_version = update.version.clone();
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|err| format!("安装更新失败: {}", map_updater_error(err)))?;
    Ok(format!(
        "更新安装完成（v{}）。请重启应用以生效。",
        target_version
    ))
}
/// 获取当前版本
#[tauri::command]
pub fn get_current_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
/// 获取快捷键帮助
#[tauri::command]
pub fn get_shortcuts_help() -> Vec<crate::shortcuts::ShortcutHelp> {
    crate::shortcuts::get_shortcuts_help()
}
#[tauri::command]
pub fn list_providers() -> Vec<ProviderManifest> {
    let registry = ProviderRegistry::new();
    registry.manifests()
}
/// 获取 Provider 的参数 Schema
#[tauri::command]
pub async fn get_provider_schema(
    provider_id: String,
) -> Result<crate::parameter::ParameterSchema, crate::errors::AppError> {
    let registry = ProviderRegistry::new();
    let provider = registry
        .get(&provider_id)
        .map_err(crate::errors::AppError::from)?;
    let schema = provider
        .get_schema()
        .map_err(|e| crate::errors::AppError::unknown(format!("failed to load schema: {}", e)))?;
    Ok(schema)
}
/// 从命令导入配置
#[tauri::command]
pub async fn import_from_command(
    command: String,
    provider_id: String,
    project_path: String,
) -> Result<crate::spec::PublishSpec, crate::errors::AppError> {
    let registry = ProviderRegistry::new();
    let provider = registry
        .get(&provider_id)
        .map_err(crate::errors::AppError::from)?;
    let schema = provider
        .get_schema()
        .map_err(|e| crate::errors::AppError::unknown(format!("failed to load schema: {}", e)))?;
    let parser = CommandParser::new(provider_id);
    let spec = parser
        .parse_command(&command, project_path, &schema)
        .map_err(|e| crate::errors::AppError::unknown(format!("parse error: {}", e)))?;
    Ok(spec)
}
/// 导出配置到文件
#[tauri::command]
pub async fn export_config(
    profiles: Vec<ConfigProfile>,
    file_path: String,
) -> Result<String, crate::errors::AppError> {
    let config = ConfigExport {
        version: 1,
        exported_at: chrono::Utc::now(),
        profiles,
    };
    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| crate::errors::AppError::unknown(format!("serialization error: {}", e)))?;
    std::fs::write(&file_path, json)
        .map_err(|e| crate::errors::AppError::unknown(format!("write error: {}", e)))?;
    Ok(file_path)
}
fn render_preflight_markdown(report: &Value) -> Result<String, crate::errors::AppError> {
    let generated_at = report
        .get("generatedAt")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let summary = report.get("summary").and_then(Value::as_object);
    let passed = summary
        .and_then(|s| s.get("passed"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let warning = summary
        .and_then(|s| s.get("warning"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let failed = summary
        .and_then(|s| s.get("failed"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let blocking_ready = summary
        .and_then(|s| s.get("blockingReady"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let mut lines = vec![
        "# Preflight Report".to_string(),
        String::new(),
        format!("- Generated At: {}", generated_at),
        format!(
            "- Blocking Ready: {}",
            if blocking_ready { "yes" } else { "no" }
        ),
        format!("- Passed: {}", passed),
        format!("- Warnings: {}", warning),
        format!("- Failed: {}", failed),
        String::new(),
        "## Checklist".to_string(),
    ];
    let checklist = report
        .get("checklist")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if checklist.is_empty() {
        lines.push("- (no checklist items)".to_string());
    } else {
        for (idx, item) in checklist.iter().enumerate() {
            let title = item
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("untitled");
            let status = item
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let detail = item
                .get("detail")
                .and_then(Value::as_str)
                .unwrap_or("")
                .replace('\n', " ");
            lines.push(format!("- [{}] {} ({})", idx + 1, title, status));
            if !detail.trim().is_empty() {
                lines.push(format!("  - Detail: {}", detail.trim()));
            }
        }
    }
    let raw = serde_json::to_string_pretty(report)
        .map_err(|e| crate::errors::AppError::unknown(format!("serialization error: {}", e)))?;
    lines.extend([
        String::new(),
        "## Raw Snapshot".to_string(),
        String::new(),
        "```json".to_string(),
        raw,
        "```".to_string(),
    ]);
    Ok(lines.join("\n"))
}
#[tauri::command]
pub async fn export_preflight_report(
    report: Value,
    file_path: String,
) -> Result<String, crate::errors::AppError> {
    if !report.is_object() {
        return Err(crate::errors::AppError::unknown(
            "preflight report payload must be an object",
        ));
    }
    let ext = Path::new(&file_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_else(|| "json".to_string());
    let content = if ext == "md" || ext == "markdown" {
        render_preflight_markdown(&report)?
    } else {
        serde_json::to_string_pretty(&report)
            .map_err(|e| crate::errors::AppError::unknown(format!("serialization error: {}", e)))?
    };
    std::fs::write(&file_path, content)
        .map_err(|e| crate::errors::AppError::unknown(format!("write error: {}", e)))?;
    Ok(file_path)
}
fn render_execution_snapshot_markdown(snapshot: &Value) -> Result<String, crate::errors::AppError> {
    let generated_at = snapshot
        .get("generatedAt")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let provider_id = snapshot
        .get("providerId")
        .or_else(|| snapshot.get("provider_id"))
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let command_line = snapshot
        .get("command")
        .and_then(Value::as_object)
        .and_then(|command| command.get("line"))
        .and_then(Value::as_str)
        .unwrap_or("(not captured)");
    let result = snapshot.get("result").and_then(Value::as_object);
    let success = result
        .and_then(|value| value.get("success"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let cancelled = result
        .and_then(|value| value.get("cancelled"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let output_dir = result
        .and_then(|value| value.get("outputDir"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let file_count = result
        .and_then(|value| value.get("fileCount"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let environment = snapshot
        .get("environmentSummary")
        .and_then(Value::as_object);
    let checked_provider_count = environment
        .and_then(|value| value.get("providerIds"))
        .and_then(Value::as_array)
        .map(|items| items.len())
        .unwrap_or(0);
    let warning_count = environment
        .and_then(|value| value.get("warningCount"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let critical_count = environment
        .and_then(|value| value.get("criticalCount"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let spec_json = snapshot
        .get("spec")
        .map(serde_json::to_string_pretty)
        .transpose()
        .map_err(|e| crate::errors::AppError::unknown(format!("serialization error: {}", e)))?
        .unwrap_or_else(|| "{}".to_string());
    let result_json = snapshot
        .get("result")
        .map(serde_json::to_string_pretty)
        .transpose()
        .map_err(|e| crate::errors::AppError::unknown(format!("serialization error: {}", e)))?
        .unwrap_or_else(|| "{}".to_string());
    let mut lines = vec![
        "# Execution Snapshot".to_string(),
        String::new(),
        format!("- Generated At: {}", generated_at),
        format!("- Provider: {}", provider_id),
        format!(
            "- Status: {}",
            if success {
                "success"
            } else if cancelled {
                "cancelled"
            } else {
                "failed"
            }
        ),
        format!(
            "- Output Dir: {}",
            if output_dir.is_empty() {
                "(none)"
            } else {
                output_dir
            }
        ),
        format!("- File Count: {}", file_count),
        String::new(),
        "## Command".to_string(),
        String::new(),
        format!("- {}", command_line),
        String::new(),
        "## Environment Summary".to_string(),
        String::new(),
        format!("- Checked Providers: {}", checked_provider_count),
        format!("- Warnings: {}", warning_count),
        format!("- Critical: {}", critical_count),
        String::new(),
        "## Spec".to_string(),
        String::new(),
        "```json".to_string(),
        spec_json,
        "```".to_string(),
        String::new(),
        "## Result".to_string(),
        String::new(),
        "```json".to_string(),
        result_json,
        "```".to_string(),
    ];
    if let Some(log_text) = snapshot
        .get("output")
        .and_then(Value::as_object)
        .and_then(|value| value.get("log"))
        .and_then(Value::as_str)
    {
        lines.extend([
            String::new(),
            "## Log".to_string(),
            String::new(),
            "```text".to_string(),
            log_text.to_string(),
            "```".to_string(),
        ]);
    }
    Ok(lines.join("\n"))
}
#[tauri::command]
pub async fn export_execution_snapshot(
    snapshot: Value,
    file_path: String,
) -> Result<String, crate::errors::AppError> {
    if !snapshot.is_object() {
        return Err(crate::errors::AppError::unknown(
            "execution snapshot payload must be an object",
        ));
    }
    let ext = Path::new(&file_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_else(|| "json".to_string());
    let content = if ext == "md" || ext == "markdown" {
        render_execution_snapshot_markdown(&snapshot)?
    } else {
        serde_json::to_string_pretty(&snapshot)
            .map_err(|e| crate::errors::AppError::unknown(format!("serialization error: {}", e)))?
    };
    std::fs::write(&file_path, content)
        .map_err(|e| crate::errors::AppError::unknown(format!("write error: {}", e)))?;
    Ok(file_path)
}

fn find_latest_snapshot_in_output_dir(
    output_dir: &str,
) -> Result<PathBuf, crate::errors::AppError> {
    if output_dir.trim().is_empty() {
        return Err(crate::errors::AppError::unknown(
            "记录中没有可用的输出目录，请先导出快照",
        ));
    }

    let dir = PathBuf::from(output_dir);
    if !dir.is_dir() {
        return Err(crate::errors::AppError::unknown(format!(
            "输出目录不存在: {}",
            dir.to_string_lossy()
        )));
    }

    let mut latest: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in std::fs::read_dir(&dir)
        .map_err(|e| crate::errors::AppError::unknown(format!("读取输出目录失败: {}", e)))?
    {
        let entry = entry
            .map_err(|e| crate::errors::AppError::unknown(format!("读取目录项失败: {}", e)))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !name.starts_with("execution-snapshot-") {
            continue;
        }

        let Some(ext) = path.extension().and_then(|value| value.to_str()) else {
            continue;
        };
        let ext = ext.to_ascii_lowercase();
        if ext != "md" && ext != "markdown" && ext != "json" {
            continue;
        }

        let modified = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);

        match &latest {
            Some((current, _)) if modified <= *current => {}
            _ => latest = Some((modified, path)),
        }
    }

    latest.map(|(_, path)| path).ok_or_else(|| {
        crate::errors::AppError::unknown(format!(
            "未在输出目录找到执行快照，请先导出快照: {}",
            dir.to_string_lossy()
        ))
    })
}

#[tauri::command]
pub async fn open_execution_snapshot(
    snapshot_path: Option<String>,
    output_dir: Option<String>,
) -> Result<String, crate::errors::AppError> {
    let path = if let Some(snapshot_path) = snapshot_path {
        let trimmed = snapshot_path.trim();
        if trimmed.is_empty() {
            if let Some(output_dir) = output_dir {
                find_latest_snapshot_in_output_dir(&output_dir)?
            } else {
                return Err(crate::errors::AppError::unknown(
                    "记录中没有快照路径，请先导出快照",
                ));
            }
        } else {
            let candidate = PathBuf::from(trimmed);
            if candidate.is_file() {
                candidate
            } else if let Some(output_dir) = output_dir {
                find_latest_snapshot_in_output_dir(&output_dir)?
            } else {
                return Err(crate::errors::AppError::unknown(format!(
                    "快照文件不存在: {}",
                    trimmed
                )));
            }
        }
    } else if let Some(output_dir) = output_dir {
        find_latest_snapshot_in_output_dir(&output_dir)?
    } else {
        return Err(crate::errors::AppError::unknown(
            "记录中没有可用的快照路径和输出目录",
        ));
    };

    open::that(&path)
        .map_err(|e| crate::errors::AppError::unknown(format!("打开快照失败: {}", e)))?;

    Ok(path.to_string_lossy().to_string())
}

/// 导入配置从文件
#[tauri::command]
pub async fn import_config(file_path: String) -> Result<ConfigExport, crate::errors::AppError> {
    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| crate::errors::AppError::unknown(format!("read error: {}", e)))?;
    let config: ConfigExport = serde_json::from_str(&content)
        .map_err(|e| crate::errors::AppError::unknown(format!("parse error: {}", e)))?;
    // Validate the imported configuration
    crate::config_export::validate_import(&config)
        .map_err(|e| crate::errors::AppError::unknown(format!("validation error: {}", e)))?;
    Ok(config)
}
/// 应用导入的配置
#[tauri::command]
pub async fn apply_imported_config(
    profiles: Vec<ConfigProfile>,
) -> Result<(), crate::errors::AppError> {
    let mut state = crate::store::get_state();
    for profile in profiles {
        // 检查是否已存在同名配置文件
        if state.profiles.iter().any(|p| p.name == profile.name) {
            log::warn!("配置文件 '{}' 已存在，跳过导入", profile.name);
            continue;
        }
        // 转换 parameters: BTreeMap -> serde_json::Value::Object
        let parameters = serde_json::Value::Object(
            profile
                .parameters
                .into_iter()
                .map(|(k, v)| (k, v))
                .collect(),
        );
        // 转换为 store::ConfigProfile 格式
        let store_profile = crate::store::ConfigProfile {
            name: profile.name,
            provider_id: profile.provider_id,
            parameters,
            created_at: profile.created_at.to_rfc3339(),
            is_system_default: profile.is_system_default,
        };
        state.profiles.push(store_profile);
    }
    crate::store::update_state(state)
        .map_err(|e| crate::errors::AppError::unknown(format!("保存配置失败: {}", e)))?;
    Ok(())
}
/// Run environment check
#[tauri::command]
pub async fn run_environment_check(
    provider_ids: Option<Vec<String>>,
) -> Result<crate::environment::EnvironmentCheckResult, crate::errors::AppError> {
    check_environment(provider_ids)
        .await
        .map_err(|e| crate::errors::AppError::unknown(format!("environment check failed: {}", e)))
}
/// Apply a fix action
#[tauri::command]
pub async fn apply_fix(action: FixAction) -> Result<FixResult, crate::errors::AppError> {
    match action.action_type {
        FixType::OpenUrl => {
            let url = action.url.ok_or_else(|| {
                crate::errors::AppError::unknown("URL is required for OpenUrl fix")
            })?;
            // Use tauri_plugin_opener to open the URL
            open::that(&url).map_err(|e| {
                crate::errors::AppError::unknown(format!("failed to open URL: {}", e))
            })?;
            Ok(FixResult::OpenedUrl(url))
        }
        FixType::RunCommand => {
            let command_str = action.command.ok_or_else(|| {
                crate::errors::AppError::unknown("Command is required for RunCommand fix")
            })?;
            let (program, args) = validate_and_parse_fix_command(&command_str)?;
            log::info!("Applying fix via command: {} {}", program, args.join(" "));
            let output = timeout(
                Duration::from_secs(10 * 60),
                Command::new(&program).args(&args).output(),
            )
            .await
            .map_err(|_| crate::errors::AppError::unknown("command timed out"))?
            .map_err(|e| {
                crate::errors::AppError::unknown(format!("failed to run command: {}", e))
            })?;
            crate::environment::invalidate_environment_cache();
            Ok(FixResult::CommandExecuted {
                stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                exit_code: output.status.code().unwrap_or(-1),
            })
        }
        FixType::CopyCommand => {
            let command_str = action.command.ok_or_else(|| {
                crate::errors::AppError::unknown("Command is required for CopyCommand fix")
            })?;
            // TODO: Copy to clipboard using tauri_plugin_clipboard
            Ok(FixResult::CopiedToClipboard(command_str))
        }
        FixType::Manual => Ok(FixResult::Manual(action.label)),
    }
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
fn validate_and_parse_fix_command(
    command_str: &str,
) -> Result<(String, Vec<String>), crate::errors::AppError> {
    let trimmed = command_str.trim();
    if trimmed.is_empty() {
        return Err(crate::errors::AppError::unknown("command is empty"));
    }
    if trimmed.contains('\n')
        || trimmed.contains('\r')
        || trimmed.contains('|')
        || trimmed.contains('&')
        || trimmed.contains(';')
        || trimmed.contains('>')
        || trimmed.contains('<')
    {
        return Err(crate::errors::AppError::unknown(
            "unsupported command: contains unsafe shell characters",
        ));
    }
    if trimmed.contains('"') || trimmed.contains('\'') {
        return Err(crate::errors::AppError::unknown(
            "unsupported command: quoting is not allowed",
        ));
    }
    let parts: Vec<&str> = trimmed.split_whitespace().collect();
    let Some((program, args)) = parts.split_first() else {
        return Err(crate::errors::AppError::unknown("command is empty"));
    };
    if *program == "sudo" {
        return Err(crate::errors::AppError::unknown(
            "unsupported command: sudo is not allowed",
        ));
    }
    // Keep the allowlist intentionally small; only support built-in guided fixes.
    match *program {
        "brew" => {
            if args.first() != Some(&"install") {
                return Err(crate::errors::AppError::unknown(
                    "unsupported brew command (only `brew install ...` is allowed)",
                ));
            }
        }
        "winget" => {
            if args.first() != Some(&"install") {
                return Err(crate::errors::AppError::unknown(
                    "unsupported winget command (only `winget install ...` is allowed)",
                ));
            }
        }
        "rustup" => {
            if args.first() != Some(&"update") {
                return Err(crate::errors::AppError::unknown(
                    "unsupported rustup command (only `rustup update` is allowed)",
                ));
            }
        }
        _ => {
            return Err(crate::errors::AppError::unknown(format!(
                "unsupported command: `{}` is not allowed",
                program
            )));
        }
    }
    Ok((
        program.to_string(),
        args.iter().map(|s| s.to_string()).collect(),
    ))
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
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
    #[test]
    fn list_providers_includes_core_toolchains() {
        let ids: Vec<String> = list_providers().into_iter().map(|p| p.id).collect();
        assert!(ids.contains(&"dotnet".to_string()));
        assert!(ids.contains(&"cargo".to_string()));
        assert!(ids.contains(&"go".to_string()));
        assert!(ids.contains(&"java".to_string()));
    }
    #[test]
    fn preflight_markdown_contains_summary_and_checklist() {
        let report = json!({
            "generatedAt": "2026-02-07T10:00:00Z",
            "summary": {
                "passed": 3,
                "warning": 1,
                "failed": 0,
                "blockingReady": true
            },
            "checklist": [
                {
                    "title": "Environment",
                    "status": "pass",
                    "detail": "ready"
                },
                {
                    "title": "Updater",
                    "status": "warning",
                    "detail": "missing endpoints"
                }
            ]
        });
        let markdown = render_preflight_markdown(&report).expect("markdown");
        assert!(markdown.contains("# Preflight Report"));
        assert!(markdown.contains("- Blocking Ready: yes"));
        assert!(markdown.contains("- [1] Environment (pass)"));
        assert!(markdown.contains("- [2] Updater (warning)"));
        assert!(markdown.contains("## Raw Snapshot"));
    }
    #[test]
    fn execution_snapshot_markdown_contains_core_sections() {
        let snapshot = json!({
            "generatedAt": "2026-02-08T10:00:00Z",
            "providerId": "go",
            "command": {
                "line": "$ go build -o ./dist/app"
            },
            "environmentSummary": {
                "providerIds": ["go"],
                "warningCount": 1,
                "criticalCount": 0
            },
            "spec": {
                "provider_id": "go",
                "project_path": "/tmp/go.mod",
                "parameters": {
                    "output": "./dist/app"
                }
            },
            "result": {
                "success": true,
                "cancelled": false,
                "outputDir": "./dist",
                "fileCount": 1
            },
            "output": {
                "log": "$ go build -o ./dist/app\nbuild done"
            }
        });
        let markdown = render_execution_snapshot_markdown(&snapshot).expect("markdown");
        assert!(markdown.contains("# Execution Snapshot"));
        assert!(markdown.contains("- Provider: go"));
        assert!(markdown.contains("## Command"));
        assert!(markdown.contains("## Environment Summary"));
        assert!(markdown.contains("## Spec"));
        assert!(markdown.contains("## Result"));
        assert!(markdown.contains("## Log"));
    }
    #[test]
    fn updater_empty_endpoints_error_is_actionable() {
        let msg = map_updater_error(UpdaterError::EmptyEndpoints);
        assert!(msg.contains("updater"));
        assert!(msg.contains("endpoints"));
        assert!(msg.contains("pubkey"));
    }
    #[test]
    fn updater_insecure_transport_error_is_actionable() {
        let msg = map_updater_error(UpdaterError::InsecureTransportProtocol);
        assert!(msg.contains("https"));
    }
    #[test]
    fn fix_command_parsing_allows_brew_install() {
        let (program, args) =
            validate_and_parse_fix_command("brew install rustup").expect("brew install");
        assert_eq!(program, "brew");
        assert_eq!(args, vec!["install".to_string(), "rustup".to_string()]);
    }
    #[test]
    fn fix_command_parsing_rejects_unsafe_separator() {
        let err = validate_and_parse_fix_command("brew install rust; rm -rf /")
            .expect_err("unsafe command should fail");
        assert!(err.message.contains("unsafe shell characters"));
    }
}
