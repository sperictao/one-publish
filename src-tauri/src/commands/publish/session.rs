use super::errors::publish_error;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, OnceLock,
};
use tokio::sync::{Mutex, Notify};

#[derive(Clone)]
struct StartingExecution {
    session_id: String,
    cancel_requested: Arc<AtomicBool>,
    cancel_notify: Arc<Notify>,
}

#[derive(Clone)]
struct ActiveExecution {
    session_id: String,
    cancel_requested: Arc<AtomicBool>,
    cancel_notify: Arc<Notify>,
}

#[derive(Clone)]
enum RunningExecution {
    Starting(StartingExecution),
    Running(ActiveExecution),
}

impl RunningExecution {
    fn session_id(&self) -> &str {
        match self {
            Self::Starting(execution) => &execution.session_id,
            Self::Running(execution) => &execution.session_id,
        }
    }

    fn cancel_handles(&self) -> (Arc<AtomicBool>, Arc<Notify>) {
        match self {
            Self::Starting(execution) => (
                Arc::clone(&execution.cancel_requested),
                Arc::clone(&execution.cancel_notify),
            ),
            Self::Running(execution) => (
                Arc::clone(&execution.cancel_requested),
                Arc::clone(&execution.cancel_notify),
            ),
        }
    }
}

#[derive(Debug)]
pub(crate) struct ExecutionPermit {
    pub(crate) session_id: String,
    pub(crate) cancel_requested: Arc<AtomicBool>,
    pub(crate) cancel_notify: Arc<Notify>,
}

impl ExecutionPermit {
    pub(crate) fn is_cancel_requested(&self) -> bool {
        self.cancel_requested.load(Ordering::SeqCst)
    }

    pub(crate) async fn mark_running(&self) {
        let mut slot = running_execution_slot().lock().await;
        if matches!(
            slot.as_ref(),
            Some(RunningExecution::Starting(execution)) if execution.session_id == self.session_id
        ) {
            *slot = Some(RunningExecution::Running(ActiveExecution {
                session_id: self.session_id.clone(),
                cancel_requested: Arc::clone(&self.cancel_requested),
                cancel_notify: Arc::clone(&self.cancel_notify),
            }));
        }
    }
}

static RUNNING_EXECUTION: OnceLock<Mutex<Option<RunningExecution>>> = OnceLock::new();

fn running_execution_slot() -> &'static Mutex<Option<RunningExecution>> {
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

    let cancel_requested = Arc::new(AtomicBool::new(false));
    let cancel_notify = Arc::new(Notify::new());
    *slot = Some(RunningExecution::Starting(StartingExecution {
        session_id: session_id.clone(),
        cancel_requested: Arc::clone(&cancel_requested),
        cancel_notify: Arc::clone(&cancel_notify),
    }));

    Ok(ExecutionPermit {
        session_id,
        cancel_requested,
        cancel_notify,
    })
}

pub(crate) async fn cancel_running_execution() -> Result<bool, crate::errors::AppError> {
    let running = {
        let guard = running_execution_slot().lock().await;
        guard.clone()
    };

    let Some(running) = running else {
        return Ok(false);
    };

    let (cancel_requested, cancel_notify) = running.cancel_handles();
    cancel_requested.store(true, Ordering::SeqCst);
    cancel_notify.notify_one();
    Ok(true)
}

pub(crate) async fn clear_running_execution(session_id: &str) {
    let mut slot = running_execution_slot().lock().await;
    let should_clear = slot
        .as_ref()
        .map(|running| running.session_id() == session_id)
        .unwrap_or(false);

    if should_clear {
        *slot = None;
    }
}
