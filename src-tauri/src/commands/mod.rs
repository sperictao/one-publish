// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use crate::artifact::{PackageFormat, PackageResult, SignMethod, SignResult};
use crate::config_export::{ConfigExport, ConfigProfile};
use crate::environment::{check_environment, FixAction, FixResult, FixType};
use crate::provider::registry::ProviderRegistry;
use crate::spec::{PublishSpec, SpecValue, SPEC_VERSION};
use crate::store::Branch;
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
use tokio::time::{timeout, Duration};

mod export;
mod provider;
mod repository;
mod updater;
pub use export::{
    export_diagnostics_index, export_execution_history, export_execution_snapshot,
    export_failure_group_bundle, export_preflight_report, open_execution_snapshot,
};
pub use provider::{get_provider_schema, import_from_command, list_providers};
pub use repository::{detect_repository_provider, scan_project, scan_project_files};
pub use updater::{
    check_update, get_current_version, get_shortcuts_help, get_updater_config_health,
    get_updater_help_paths, install_update, open_updater_help, UpdateInfo,
    UpdaterConfigHealth, UpdaterHelpPaths,
};
pub(crate) use export::{
    __cmd__export_diagnostics_index, __cmd__export_execution_history,
    __cmd__export_execution_snapshot, __cmd__export_failure_group_bundle,
    __cmd__export_preflight_report, __cmd__open_execution_snapshot,
};
pub(crate) use provider::{
    __cmd__get_provider_schema, __cmd__import_from_command, __cmd__list_providers,
};
pub(crate) use repository::{
    __cmd__detect_repository_provider, __cmd__scan_project, __cmd__scan_project_files,
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

fn format_git_command_failure(command: &str, stderr: &[u8]) -> String {
    let error = String::from_utf8_lossy(stderr).trim().to_string();

    if error.is_empty() {
        return format!("git {} command failed", command);
    }

    format!("git {} command failed: {}", command, error)
}

fn classify_repository_path_error(kind: IoErrorKind) -> &'static str {
    match kind {
        IoErrorKind::NotFound => "path_not_found",
        IoErrorKind::NotADirectory => "not_directory",
        IoErrorKind::PermissionDenied => "permission_denied",
        _ => "read_failed",
    }
}

fn classify_git_execution_error(kind: IoErrorKind) -> &'static str {
    match kind {
        IoErrorKind::NotFound => "git_missing",
        IoErrorKind::PermissionDenied => "permission_denied",
        _ => "unknown",
    }
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

fn classify_git_branch_scan_error(stderr: &str) -> &'static str {
    let normalized = stderr.to_lowercase();

    if normalized.contains("not a git repository")
        || normalized.contains("不是 git 仓库")
        || normalized.contains("不是一个git仓库")
    {
        return "not_git_repo";
    }

    if normalized.contains("detected dubious ownership") {
        return "dubious_ownership";
    }

    if normalized.contains("permission denied")
        || normalized.contains("operation not permitted")
        || normalized.contains("访问被拒绝")
        || normalized.contains("权限")
    {
        return "permission_denied";
    }

    if normalized.contains("unable to access")
        || normalized.contains("failed to connect")
        || normalized.contains("could not resolve host")
        || normalized.contains("connection timed out")
        || normalized.contains("connection refused")
        || normalized.contains("unable to connect")
        || normalized.contains("unable to look up")
        || normalized.contains("couldn't connect to server")
        || normalized.contains("network is unreachable")
        || normalized.contains("could not read from remote repository")
        || normalized.contains("could not read username")
        || normalized.contains("authentication failed")
        || normalized.contains("publickey")
        || normalized.contains("repository not found")
        || normalized.contains("proxy connect aborted")
        || normalized.contains("无法连接")
        || normalized.contains("连接超时")
        || normalized.contains("连接被拒绝")
        || normalized.contains("无法访问远程仓库")
        || normalized.contains("无法从远程仓库读取")
        || normalized.contains("无法解析主机")
        || normalized.contains("网络不可达")
    {
        return "cannot_connect_repo";
    }

    "unknown"
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryBranchScanResult {
    pub branches: Vec<Branch>,
    pub current_branch: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryBranchConnectivityResult {
    pub can_connect: bool,
}

#[tauri::command]
pub async fn check_repository_branch_connectivity(
    path: String,
    current_branch: Option<String>,
) -> RepositoryBranchConnectivityResult {
    let repo_path = PathBuf::from(&path);

    if !repo_path.exists() || !repo_path.is_dir() {
        return RepositoryBranchConnectivityResult { can_connect: false };
    }

    let mut branch_name = current_branch
        .map(|branch| branch.trim().to_string())
        .unwrap_or_default();

    if branch_name.is_empty() {
        let head_output = match Command::new("git")
            .arg("-C")
            .arg(&path)
            .arg("rev-parse")
            .arg("--abbrev-ref")
            .arg("HEAD")
            .output()
            .await
        {
            Ok(output) if output.status.success() => output,
            _ => return RepositoryBranchConnectivityResult { can_connect: false },
        };

        branch_name = String::from_utf8_lossy(&head_output.stdout)
            .trim()
            .to_string();
    }

    if branch_name.is_empty() || branch_name == "HEAD" {
        return RepositoryBranchConnectivityResult { can_connect: false };
    }

    let upstream_output = match Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("rev-parse")
        .arg("--abbrev-ref")
        .arg("--symbolic-full-name")
        .arg(format!("{}@{{upstream}}", branch_name))
        .output()
        .await
    {
        Ok(output) if output.status.success() => output,
        _ => return RepositoryBranchConnectivityResult { can_connect: false },
    };

    let upstream = String::from_utf8_lossy(&upstream_output.stdout)
        .trim()
        .to_string();
    let Some((remote, remote_branch)) = upstream.split_once('/') else {
        return RepositoryBranchConnectivityResult { can_connect: false };
    };

    if remote.is_empty() || remote_branch.is_empty() {
        return RepositoryBranchConnectivityResult { can_connect: false };
    }

    let remote_branch_ref = format!("refs/heads/{}", remote_branch);
    let ls_remote_output = match timeout(
        Duration::from_secs(5),
        Command::new("git")
            .arg("-C")
            .arg(&path)
            .arg("ls-remote")
            .arg("--exit-code")
            .arg("--heads")
            .arg(remote)
            .arg(&remote_branch_ref)
            .output(),
    )
    .await
    {
        Ok(Ok(output)) => output,
        _ => return RepositoryBranchConnectivityResult { can_connect: false },
    };

    RepositoryBranchConnectivityResult {
        can_connect: ls_remote_output.status.success() && !ls_remote_output.stdout.is_empty(),
    }
}

#[tauri::command]
pub async fn scan_repository_branches(
    path: String,
) -> Result<RepositoryBranchScanResult, crate::errors::AppError> {
    let repo_path = PathBuf::from(&path);

    if !repo_path.exists() {
        return Err(crate::errors::AppError::unknown_with_code(
            format!("repository path does not exist: {}", path),
            "path_not_found",
        ));
    }

    if !repo_path.is_dir() {
        return Err(crate::errors::AppError::unknown_with_code(
            format!("repository path is not a directory: {}", path),
            "not_directory",
        ));
    }

    let remote_output = timeout(
        Duration::from_secs(5),
        Command::new("git")
            .arg("-C")
            .arg(&path)
            .arg("remote")
            .output(),
    )
    .await
    .map_err(|_| {
        crate::errors::AppError::unknown_with_code(
            "git remote timed out after 5s",
            "timeout",
        )
    })?
    .map_err(|err| {
        crate::errors::AppError::unknown_with_code(
            format!("failed to execute git remote: {}", err),
            classify_git_execution_error(err.kind()),
        )
    })?;

    if !remote_output.status.success() {
        let stderr = String::from_utf8_lossy(&remote_output.stderr).trim().to_string();
        return Err(crate::errors::AppError::unknown_with_code(
            format_git_command_failure("remote", &remote_output.stderr),
            classify_git_branch_scan_error(&stderr),
        ));
    }

    let has_remote = String::from_utf8_lossy(&remote_output.stdout)
        .lines()
        .any(|line| !line.trim().is_empty());

    if has_remote {
        let fetch_output = timeout(
            Duration::from_secs(5),
            Command::new("git")
                .arg("-C")
                .arg(&path)
                .arg("fetch")
                .arg("--all")
                .arg("--prune")
                .output(),
        )
        .await
        .map_err(|_| {
            crate::errors::AppError::unknown_with_code(
                "git fetch timed out after 5s",
                "timeout",
            )
        })?
        .map_err(|err| {
            crate::errors::AppError::unknown_with_code(
                format!("failed to execute git fetch: {}", err),
                classify_git_execution_error(err.kind()),
            )
        })?;

        if !fetch_output.status.success() {
            let stderr = String::from_utf8_lossy(&fetch_output.stderr).trim().to_string();
            return Err(crate::errors::AppError::unknown_with_code(
                format_git_command_failure("fetch", &fetch_output.stderr),
                classify_git_branch_scan_error(&stderr),
            ));
        }
    }

    let output = timeout(
        Duration::from_secs(5),
        Command::new("git")
            .arg("-C")
            .arg(&path)
            .arg("branch")
            .arg("--list")
            .arg("--no-color")
            .output(),
    )
    .await
    .map_err(|_| {
        crate::errors::AppError::unknown_with_code(
            "git branch timed out after 5s",
            "timeout",
        )
    })?
    .map_err(|err| {
        crate::errors::AppError::unknown_with_code(
            format!("failed to execute git branch: {}", err),
            classify_git_execution_error(err.kind()),
        )
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(crate::errors::AppError::unknown_with_code(
            format_git_command_failure("branch", &output.stderr),
            classify_git_branch_scan_error(&stderr),
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut branches: Vec<Branch> = stdout
        .lines()
        .filter_map(|line| {
            let raw = line.trim();
            if raw.is_empty() {
                return None;
            }

            let is_current = raw.starts_with('*');
            let name = raw.trim_start_matches('*').trim().to_string();
            if name.is_empty() {
                return None;
            }

            Some(Branch {
                is_main: matches!(name.as_str(), "main" | "master"),
                is_current,
                path: path.clone(),
                name,
                commit_count: None,
            })
        })
        .collect();

    if branches.is_empty() {
        return Err(crate::errors::AppError::unknown_with_code(
            "no git branches found in repository",
            "no_branches",
        ));
    }

    let mut current_branch = branches
        .iter()
        .find(|branch| branch.is_current)
        .map(|branch| branch.name.clone())
        .unwrap_or_default();

    if current_branch.is_empty() {
        let head_output = timeout(
            Duration::from_secs(5),
            Command::new("git")
                .arg("-C")
                .arg(&path)
                .arg("rev-parse")
                .arg("--abbrev-ref")
                .arg("HEAD")
                .output(),
        )
        .await
        .map_err(|_| {
            crate::errors::AppError::unknown_with_code(
                "git rev-parse timed out after 5s",
                "timeout",
            )
        })?
        .map_err(|err| {
            crate::errors::AppError::unknown_with_code(
                format!("failed to detect current branch: {}", err),
                classify_git_execution_error(err.kind()),
            )
        })?;

        if head_output.status.success() {
            current_branch = String::from_utf8_lossy(&head_output.stdout)
                .trim()
                .to_string();
        }
    }

    if current_branch.is_empty() {
        current_branch = branches[0].name.clone();
    }

    for branch in branches.iter_mut() {
        branch.is_current = branch.name == current_branch;
    }

    Ok(RepositoryBranchScanResult {
        branches,
        current_branch,
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
/// 应用导入的配置（按仓库隔离）
#[tauri::command]
pub async fn apply_imported_config(
    repo_id: String,
    profiles: Vec<ConfigProfile>,
) -> Result<(), crate::errors::AppError> {
    let mut state = crate::store::get_state();
    let repo = state
        .repositories
        .iter_mut()
        .find(|r| r.id == repo_id)
        .ok_or_else(|| {
            crate::errors::AppError::unknown(format!("未找到仓库: {}", repo_id))
        })?;

    for profile in profiles {
        // 检查是否已存在同名配置文件
        if repo.publish_config.profiles.iter().any(|p| p.name == profile.name) {
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
            profile_group: profile.profile_group,
            created_at: profile.created_at.to_rfc3339(),
            is_system_default: profile.is_system_default,
        };
        repo.publish_config.profiles.push(store_profile);
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
    check_environment(provider_ids).await.map_err(|e| {
        crate::errors::AppError::unknown_with_code(
            format!("environment check failed: {}", e),
            "environment_check_failed",
        )
    })
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
