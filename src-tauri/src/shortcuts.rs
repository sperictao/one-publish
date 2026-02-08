//! 全局快捷键管理
//!
//! 处理应用的全局快捷键功能

use tauri::AppHandle;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

/// 注册全局快捷键
pub fn register_shortcuts(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // Cmd/Ctrl + R - 刷新项目
    let shortcut_r = if cfg!(target_os = "macos") {
        "Cmd+R"
    } else {
        "Ctrl+R"
    };

    app.global_shortcut().register(shortcut_r)?;
    log::debug!("已注册快捷键: {}", shortcut_r);

    // Cmd/Ctrl + P - 执行发布
    let shortcut_p = if cfg!(target_os = "macos") {
        "Cmd+P"
    } else {
        "Ctrl+P"
    };

    app.global_shortcut().register(shortcut_p)?;
    log::debug!("已注册快捷键: {}", shortcut_p);

    // Cmd/Ctrl + , - 打开设置
    let shortcut_comma = if cfg!(target_os = "macos") {
        "Cmd+,"
    } else {
        "Ctrl+,"
    };

    app.global_shortcut().register(shortcut_comma)?;
    log::debug!("已注册快捷键: {}", shortcut_comma);

    log::info!(
        "全局快捷键已注册: {} (刷新), {} (发布), {} (设置)",
        shortcut_r,
        shortcut_p,
        shortcut_comma
    );

    Ok(())
}

/// 获取快捷键帮助文本
pub fn get_shortcuts_help() -> Vec<ShortcutHelp> {
    vec![
        ShortcutHelp {
            key: if cfg!(target_os = "macos") {
                "⌘ R".to_string()
            } else {
                "Ctrl R".to_string()
            },
            description: "刷新项目".to_string(),
        },
        ShortcutHelp {
            key: if cfg!(target_os = "macos") {
                "⌘ P".to_string()
            } else {
                "Ctrl P".to_string()
            },
            description: "执行发布".to_string(),
        },
        ShortcutHelp {
            key: if cfg!(target_os = "macos") {
                "⌘ ,".to_string()
            } else {
                "Ctrl ,".to_string()
            },
            description: "打开设置".to_string(),
        },
    ]
}

#[derive(Debug, serde::Serialize)]
pub struct ShortcutHelp {
    pub key: String,
    pub description: String,
}
