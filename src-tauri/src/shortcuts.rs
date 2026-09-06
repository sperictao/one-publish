//! 全局快捷键管理
//!
//! 处理应用的全局快捷键功能

use tauri::AppHandle;
use tauri::Emitter;
use tauri_plugin_global_shortcut::Error as ShortcutError;
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use tauri_plugin_global_shortcut::ShortcutState;
use ts_rs::TS;

/// 注册全局快捷键；按下时向前端广播对应事件
/// （useShortcuts 监听 shortcut-refresh / shortcut-publish / shortcut-settings）。
pub fn register_shortcuts(app: &AppHandle) -> Result<(), ShortcutError> {
    // Cmd/Ctrl + R - 刷新项目
    let shortcut_r = if cfg!(target_os = "macos") {
        "Cmd+R"
    } else {
        "Ctrl+R"
    };

    app.global_shortcut().on_shortcut(shortcut_r, |app, _, event| {
        if event.state == ShortcutState::Pressed {
            if let Err(err) = app.emit("shortcut-refresh", ()) {
                log::warn!("发送 shortcut-refresh 失败: {}", err);
            }
        }
    })?;
    log::debug!("已注册快捷键: {}", shortcut_r);

    // Cmd/Ctrl + P - 执行发布
    let shortcut_p = if cfg!(target_os = "macos") {
        "Cmd+P"
    } else {
        "Ctrl+P"
    };

    app.global_shortcut().on_shortcut(shortcut_p, |app, _, event| {
        if event.state == ShortcutState::Pressed {
            if let Err(err) = app.emit("shortcut-publish", ()) {
                log::warn!("发送 shortcut-publish 失败: {}", err);
            }
        }
    })?;
    log::debug!("已注册快捷键: {}", shortcut_p);

    // Cmd/Ctrl + , - 打开设置
    let shortcut_comma = if cfg!(target_os = "macos") {
        "Cmd+,"
    } else {
        "Ctrl+,"
    };

    app.global_shortcut()
        .on_shortcut(shortcut_comma, |app, _, event| {
            if event.state == ShortcutState::Pressed {
                if let Err(err) = app.emit("shortcut-settings", ()) {
                    log::warn!("发送 shortcut-settings 失败: {}", err);
                }
            }
        })?;
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

#[derive(Debug, serde::Serialize, TS)]
pub struct ShortcutHelp {
    pub key: String,
    pub description: String,
}
