use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::AppHandle;
use tauri_plugin_updater::{Error as UpdaterError, UpdaterExt};

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

pub(crate) fn map_updater_error(err: UpdaterError) -> String {
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

#[cfg(test)]
mod tests {
    use super::map_updater_error;
    use tauri_plugin_updater::Error as UpdaterError;

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
}
