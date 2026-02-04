// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

use crate::command_parser::CommandParser;
use crate::config_export::{ConfigExport, ConfigProfile};
use crate::provider::registry::ProviderRegistry;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

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
}

/// 检查更新
#[tauri::command]
pub async fn check_update(_app: AppHandle) -> Result<UpdateInfo, String> {
    // TODO: 实现 Tauri 2.x updater API 集成
    // 当前返回 mock 数据
    Ok(UpdateInfo {
        current_version: env!("CARGO_PKG_VERSION").to_string(),
        available_version: None,
        has_update: false,
        release_notes: None,
    })
}

/// 执行更新并重启
#[tauri::command]
pub async fn install_update(_app: AppHandle) -> Result<String, String> {
    Err("更新功能暂未实现，需要配置更新服务器".to_string())
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

