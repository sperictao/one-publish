// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

use crate::command_parser::CommandParser;
use crate::artifact::{PackageFormat, PackageResult, SignMethod, SignResult};
use crate::config_export::{ConfigExport, ConfigProfile};
use crate::environment::{check_environment, FixAction, FixResult, FixType};
use crate::provider::registry::ProviderRegistry;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::AppHandle;
use tauri_plugin_updater::{Error as UpdaterError, UpdaterExt};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
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
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
    pub output_dir: String,
    pub file_count: usize,
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
pub async fn scan_project(start_path: Option<String>) -> Result<ProjectInfo, crate::errors::AppError> {
    let search_path = match start_path {
        Some(p) => PathBuf::from(p),
        None => std::env::current_dir().map_err(|e| crate::errors::AppError::unknown(e.to_string()))?,
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

    let plan = crate::publish::build_dotnet_publish_plan(&project_path, &config);

    log::info!("Executing: {} {}", plan.program, plan.args.join(" "));

    // Execute dotnet publish
    let mut child = Command::new(&plan.program)
        .args(&plan.args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| crate::errors::AppError::unknown(format!(
            "failed to spawn {}: {}",
            plan.program, e
        )))?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let mut output_lines = Vec::new();

    // Read stdout
    let stdout_reader = BufReader::new(stdout);
    let mut stdout_lines = stdout_reader.lines();
    while let Ok(Some(line)) = stdout_lines.next_line().await {
        output_lines.push(line);
    }

    // Read stderr
    let stderr_reader = BufReader::new(stderr);
    let mut stderr_lines = stderr_reader.lines();
    while let Ok(Some(line)) = stderr_lines.next_line().await {
        output_lines.push(format!("[stderr] {}", line));
    }

    let status = child
        .wait()
        .await
        .map_err(|e| crate::errors::AppError::unknown(e.to_string()))?;

    let output = output_lines.join("\n");

    // Determine output directory
    let output_dir = if !config.output_dir.is_empty() {
        config.output_dir.clone()
    } else if let Some(parent) = project_file.parent() {
        parent
            .join("bin")
            .join(&config.configuration)
            .join("publish")
            .to_string_lossy()
            .to_string()
    } else {
        String::new()
    };

    // Count files in output directory
    let file_count = if !output_dir.is_empty() && Path::new(&output_dir).exists() {
        std::fs::read_dir(&output_dir)
            .map(|entries| entries.count())
            .unwrap_or(0)
    } else {
        0
    };

    if status.success() {
        Ok(PublishResult {
            success: true,
            output,
            error: None,
            output_dir,
            file_count,
        })
    } else {
        Ok(PublishResult {
            success: false,
            output,
            error: Some(format!("发布失败，退出代码: {:?}", status.code())),
            output_dir,
            file_count: 0,
        })
    }
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

/// 获取 Provider 的参数 Schema
#[tauri::command]
pub async fn get_provider_schema(
    provider_id: String,
) -> Result<crate::parameter::ParameterSchema, crate::errors::AppError> {
    let registry = ProviderRegistry::new();
    let provider = registry
        .get(&provider_id)
        .map_err(|e| crate::errors::AppError::from(e))?;
    let schema = provider.get_schema().map_err(|e| {
        crate::errors::AppError::unknown(format!("failed to load schema: {}", e))
    })?;
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
        .map_err(|e| crate::errors::AppError::from(e))?;

    let schema = provider.get_schema().map_err(|e| {
        crate::errors::AppError::unknown(format!("failed to load schema: {}", e))
    })?;

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

/// 导入配置从文件
#[tauri::command]
pub async fn import_config(
    file_path: String,
) -> Result<ConfigExport, crate::errors::AppError> {
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
            profile.parameters.into_iter().map(|(k, v)| (k, v)).collect()
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
            let url = action
                .url
                .ok_or_else(|| crate::errors::AppError::unknown("URL is required for OpenUrl fix"))?;

            // Use tauri_plugin_opener to open the URL
            open::that(&url)
                .map_err(|e| crate::errors::AppError::unknown(format!("failed to open URL: {}", e)))?;

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
            .map_err(|e| crate::errors::AppError::unknown(format!("failed to run command: {}", e)))?;

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
        FixType::Manual => {
            Ok(FixResult::Manual(action.label))
        }
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
