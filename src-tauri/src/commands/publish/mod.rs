use crate::spec::PublishSpec;
use std::path::PathBuf;
use tauri::AppHandle;

mod contracts;
mod errors;
mod execution;
mod logs;
mod output;
mod preflight;
mod session;

pub use contracts::{PublishLogChunkEvent, PublishResult, RenderedPublishCommand};
pub use preflight::{
    ProtectedDirectoryLocation, PublishOutputAccess, PublishOutputAccessStatus,
    PublishOutputPreflightResult, PublishOutputValidation, PublishOutputValidationIssue,
    PublishOutputValidationStatus,
};

#[cfg(test)]
use self::errors::{publish_render_error, publish_schema_error};
use self::execution::{
    execute_publish_spec, render_publish_command,
};
#[cfg(test)]
use self::output::{infer_output_dir, resolve_plan_command, resolve_runtime_program};
use self::session::cancel_running_execution;
#[cfg(test)]
use self::session::{clear_running_execution, force_clear_running_execution, reserve_execution};

#[tauri::command]
pub async fn execute_provider_publish(
    app: AppHandle,
    spec: PublishSpec,
) -> Result<PublishResult, crate::errors::AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new("commands::publish::mod::execute_provider_publish");
    let project_path = PathBuf::from(&spec.project_path);
    if !project_path.exists() {
        return Err(errors::publish_error(
            format!("project path does not exist: {}", spec.project_path),
            "project_path_not_found",
        ));
    }

    execute_publish_spec(&app, spec).await
}

#[tauri::command]
pub fn render_provider_publish(
    spec: PublishSpec,
) -> Result<RenderedPublishCommand, crate::errors::AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new("commands::publish::mod::render_provider_publish");
    let project_path = PathBuf::from(&spec.project_path);
    if !project_path.exists() {
        return Err(errors::publish_error(
            format!("project path does not exist: {}", spec.project_path),
            "project_path_not_found",
        ));
    }

    render_publish_command(&spec)
}

#[tauri::command]
pub fn preflight_publish_output(spec: PublishSpec) -> PublishOutputPreflightResult {
    let _timer = crate::commands::middleware::CommandTimer::new("commands::publish::mod::preflight_publish_output");
    preflight::preflight_publish_output(&spec)
}

#[tauri::command]
pub async fn cancel_provider_publish() -> Result<bool, crate::errors::AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new("commands::publish::mod::cancel_provider_publish");
    cancel_running_execution().await
}

#[cfg(test)]
mod tests;