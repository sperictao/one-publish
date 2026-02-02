// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

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
