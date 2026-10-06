//! 快捷键帮助
//!
//! 快捷键本身由前端在窗口内监听（useShortcuts），此处仅提供帮助文本。

use ts_rs::TS;

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
