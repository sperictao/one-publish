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

pub use contracts::{PublishConfig, PublishLogChunkEvent, PublishResult, RenderedPublishCommand};
pub use preflight::{
    ProtectedDirectoryLocation, PublishOutputAccess, PublishOutputAccessStatus,
    PublishOutputPreflightResult, PublishOutputValidation, PublishOutputValidationIssue,
    PublishOutputValidationStatus,
};

#[cfg(test)]
use self::errors::{publish_render_error, publish_schema_error};
use self::execution::{
    build_dotnet_spec_from_config, execute_publish_spec, render_publish_command,
};
#[cfg(test)]
use self::output::{infer_output_dir, resolve_java_program, resolve_plan_command};
use self::session::cancel_running_execution;
#[cfg(test)]
use self::session::{clear_running_execution, force_clear_running_execution, reserve_execution};

#[tauri::command]
pub async fn execute_publish(
    app: AppHandle,
    project_path: String,
    config: PublishConfig,
) -> Result<PublishResult, crate::errors::AppError> {
    let project_file = PathBuf::from(&project_path);
    if !project_file.exists() {
        return Err(errors::publish_error(
            format!("project file does not exist: {}", project_path),
            "project_path_not_found",
        ));
    }

    let spec = build_dotnet_spec_from_config(project_path, config);
    execute_publish_spec(&app, spec).await
}

#[tauri::command]
pub async fn execute_provider_publish(
    app: AppHandle,
    spec: PublishSpec,
) -> Result<PublishResult, crate::errors::AppError> {
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
    preflight::preflight_publish_output(&spec)
}

#[tauri::command]
pub async fn cancel_provider_publish() -> Result<bool, crate::errors::AppError> {
    cancel_running_execution().await
}

#[cfg(test)]
mod tests;
