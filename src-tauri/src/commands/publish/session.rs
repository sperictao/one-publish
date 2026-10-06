use super::errors::publish_error;
use std::sync::OnceLock;
use tokio::sync::Mutex;

/// 本机同一时刻只运行一个 Provider 构建进程。取消不经这里登记：发布运行时
/// 的取消信号随执行端口直接传入构建执行（ADR-0041）。
#[derive(Debug)]
pub(crate) struct ExecutionPermit {
    pub(crate) session_id: String,
}

static RUNNING_EXECUTION: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn running_execution_slot() -> &'static Mutex<Option<String>> {
    RUNNING_EXECUTION.get_or_init(|| Mutex::new(None))
}

#[cfg(test)]
pub(crate) async fn force_clear_running_execution() {
    let mut slot = running_execution_slot().lock().await;
    *slot = None;
}

pub(crate) async fn reserve_execution(
    session_id: String,
) -> Result<ExecutionPermit, crate::errors::AppError> {
    let mut slot = running_execution_slot().lock().await;
    if slot.is_some() {
        return Err(publish_error(
            "another publish execution is already running",
            "publish_already_running",
        ));
    }

    *slot = Some(session_id.clone());
    Ok(ExecutionPermit { session_id })
}

pub(crate) async fn clear_running_execution(session_id: &str) {
    let mut slot = running_execution_slot().lock().await;
    if slot.as_deref() == Some(session_id) {
        *slot = None;
    }
}
