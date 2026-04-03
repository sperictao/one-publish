use super::errors::publish_error;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, OnceLock,
};
use tokio::process::Child;
use tokio::sync::Mutex;

#[derive(Clone)]
struct StartingExecution {
    session_id: String,
    cancel_requested: Arc<AtomicBool>,
}

#[derive(Clone)]
struct ActiveExecution {
    session_id: String,
    child: Arc<Mutex<Child>>,
    cancel_requested: Arc<AtomicBool>,
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
}

#[derive(Debug)]
pub(crate) struct ExecutionPermit {
    pub(crate) session_id: String,
    pub(crate) cancel_requested: Arc<AtomicBool>,
}

impl ExecutionPermit {
    pub(crate) fn is_cancel_requested(&self) -> bool {
        self.cancel_requested.load(Ordering::SeqCst)
    }

    pub(crate) async fn mark_running(&self, child: Arc<Mutex<Child>>) {
        let mut slot = running_execution_slot().lock().await;
        if matches!(
            slot.as_ref(),
            Some(RunningExecution::Starting(execution)) if execution.session_id == self.session_id
        ) {
            *slot = Some(RunningExecution::Running(ActiveExecution {
                session_id: self.session_id.clone(),
                child,
                cancel_requested: Arc::clone(&self.cancel_requested),
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
    *slot = Some(RunningExecution::Starting(StartingExecution {
        session_id: session_id.clone(),
        cancel_requested: Arc::clone(&cancel_requested),
    }));

    Ok(ExecutionPermit {
        session_id,
        cancel_requested,
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

    match running {
        RunningExecution::Starting(execution) => {
            execution.cancel_requested.store(true, Ordering::SeqCst);
            Ok(true)
        }
        RunningExecution::Running(execution) => {
            execution.cancel_requested.store(true, Ordering::SeqCst);
            let mut child = execution.child.lock().await;
            child.start_kill().map_err(|error| {
                publish_error(
                    format!("failed to cancel publish: {}", error),
                    "publish_cancel_failed",
                )
            })?;
            Ok(true)
        }
    }
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
