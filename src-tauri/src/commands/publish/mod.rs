use crate::spec::PublishSpec;
use publish_adapters::CancellationSignal;
use std::path::PathBuf;
use tauri::AppHandle;

mod contracts;
mod errors;
mod execution;
mod logs;
mod output;
mod output_policy;
mod preflight;
mod session;

pub use contracts::{
    PublishLogChunkEvent, PublishResult, PublishSessionStartedEvent, RenderedPublishCommand,
};
pub use preflight::{
    ProtectedDirectoryLocation, PublishOutputAccess, PublishOutputAccessStatus,
    PublishOutputPreflightResult, PublishOutputValidation, PublishOutputValidationIssue,
    PublishOutputValidationStatus, RemoteLocationKind, RemoteLocationSummary,
};

#[cfg(test)]
use self::errors::{publish_render_error, publish_schema_error};
pub(crate) use self::execution::execute_publish_spec;
use self::execution::render_publish_command;
pub(crate) use self::execution::{execute_sealed_build, SealedBuildCommand};
#[cfg(test)]
use self::output::{infer_output_dir, resolve_plan_command, resolve_runtime_program};
#[cfg(test)]
use self::session::{clear_running_execution, force_clear_running_execution, reserve_execution};

/// 遗留 Provider 发布规格的执行入口：只由发布运行时的执行端口调用，
/// 取消信号来自该次 Attempt（ADR-0041）。
pub(crate) async fn execute_provider_publish(
    app: AppHandle,
    spec: PublishSpec,
    cancellation: &CancellationSignal,
) -> Result<PublishResult, crate::errors::AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new(
        "commands::publish::mod::execute_provider_publish",
    );
    let project_path = PathBuf::from(&spec.project_path);
    if !project_path.exists() {
        return Err(errors::publish_error(
            format!("project path does not exist: {}", spec.project_path),
            "project_path_not_found",
        ));
    }

    execute_publish_spec(&app, spec, cancellation).await
}

#[tauri::command]
pub fn render_provider_publish(
    spec: PublishSpec,
) -> Result<RenderedPublishCommand, crate::errors::AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new(
        "commands::publish::mod::render_provider_publish",
    );
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
    let _timer = crate::commands::middleware::CommandTimer::new(
        "commands::publish::mod::preflight_publish_output",
    );
    preflight::preflight_publish_output(&spec)
}

#[tauri::command]
pub fn describe_publish_output_target(raw: String) -> crate::output_target::OutputTargetDescriptor {
    let _timer = crate::commands::middleware::CommandTimer::new(
        "commands::publish::mod::describe_publish_output_target",
    );
    crate::output_target::describe_output_target(&raw)
}

#[cfg(test)]
mod tests;
