use crate::spec::PublishSpec;
use std::path::PathBuf;
use tauri::AppHandle;

mod access;
mod contracts;
mod errors;
mod execution;
mod logs;
mod output;
mod session;

pub use access::{
    ProtectedDirectoryLocation, PublishOutputAccessResult, PublishOutputAccessStatus,
};
pub use contracts::{PublishConfig, PublishLogChunkEvent, PublishResult};

#[cfg(test)]
use self::errors::{publish_render_error, publish_schema_error};
use self::execution::{build_dotnet_spec_from_config, execute_publish_spec};
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
pub fn preflight_publish_output_access(spec: PublishSpec) -> PublishOutputAccessResult {
    access::check_publish_output_access(&spec)
}

#[tauri::command]
pub async fn cancel_provider_publish() -> Result<bool, crate::errors::AppError> {
    cancel_running_execution().await
}

#[cfg(test)]
mod tests;
