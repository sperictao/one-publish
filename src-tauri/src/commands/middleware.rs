//! Tauri command 中间件层 — 统一日志、计时、错误分类
//!
//! 使用方式：在每个 #[tauri::command] 函数体开头添加：
//! ```ignore
//! let _timer = crate::commands::middleware::CommandTimer::new("function_name");
//! ```
//! CommandTimer 在 drop 时自动输出耗时日志。

use std::time::Instant;

/// RAII 计时器：构造时记录开始时间并打 DEBUG 日志，drop 时输出 INFO 日志。
///
/// 日志格式：
/// - 开始：`[CMD] {name} started` (DEBUG)
/// - 完成：`[CMD] {name} done in {duration}` (INFO)
pub struct CommandTimer {
    name: &'static str,
    start: Instant,
}

impl CommandTimer {
    /// 创建新的计时器，立即记录开始日志。
    ///
    /// `name` 应为函数名（通常用 `module_path!()` 拼接 `::function_name`）。
    pub fn new(name: &'static str) -> Self {
        log::debug!("[CMD] {name} started");
        Self {
            name,
            start: Instant::now(),
        }
    }
}

impl Drop for CommandTimer {
    fn drop(&mut self) {
        log::info!("[CMD] {} done in {:?}", self.name, self.start.elapsed());
    }
}
