use super::errors::{
    classify_process_spawn_error, classify_process_wait_error, publish_error, publish_render_error,
    publish_schema_error,
};
use super::logs::{collect_log_chunks, emit_publish_log, read_stream_chunks};
use super::output::{
    build_display_command, count_output_files, infer_output_dir, resolve_java_program,
    resolve_plan_command, resolve_spawn_program, resolve_working_dir,
};
use super::session::reserve_execution;
use super::{
    preflight::{self, ProtectedDirectoryLocation, PublishOutputValidationIssue},
    PublishConfig, PublishResult, RenderedPublishCommand,
};
use crate::provider::registry::ProviderRegistry;
use crate::spec::{PublishSpec, SpecValue, SPEC_VERSION};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::{mpsc, Mutex};

pub(crate) fn build_dotnet_spec_from_config(
    project_path: String,
    config: PublishConfig,
) -> PublishSpec {
    let mut parameters = BTreeMap::<String, SpecValue>::new();
    let mut properties = config
        .properties
        .into_iter()
        .map(|(key, value)| (key, SpecValue::String(value)))
        .collect::<BTreeMap<String, SpecValue>>();

    if config.use_profile && !config.profile_name.is_empty() {
        properties.insert(
            "PublishProfile".to_string(),
            SpecValue::String(config.profile_name),
        );
    } else {
        parameters.insert(
            "configuration".to_string(),
            SpecValue::String(config.configuration),
        );
        if !config.runtime.is_empty() {
            parameters.insert("runtime".to_string(), SpecValue::String(config.runtime));
        }
        if !config.framework.is_empty() {
            parameters.insert("framework".to_string(), SpecValue::String(config.framework));
        }
        if config.self_contained {
            parameters.insert("self_contained".to_string(), SpecValue::Bool(true));
        }
    }
    if !config.output_dir.is_empty() {
        parameters.insert("output".to_string(), SpecValue::String(config.output_dir));
    }
    if config.no_build {
        parameters.insert("no_build".to_string(), SpecValue::Bool(true));
    }
    if config.no_restore {
        parameters.insert("no_restore".to_string(), SpecValue::Bool(true));
    }
    if !config.verbosity.is_empty() {
        parameters.insert("verbosity".to_string(), SpecValue::String(config.verbosity));
    }
    if config.no_logo {
        parameters.insert("no_logo".to_string(), SpecValue::Bool(true));
    }
    if config.delete_existing_files {
        parameters.insert("delete_existing_files".to_string(), SpecValue::Bool(true));
    }
    if !config.define.is_empty() {
        parameters.insert(
            "define".to_string(),
            SpecValue::List(config.define.into_iter().map(SpecValue::String).collect()),
        );
    }
    if !properties.is_empty() {
        parameters.insert("properties".to_string(), SpecValue::Map(properties));
    }

    PublishSpec {
        version: SPEC_VERSION,
        provider_id: "dotnet".to_string(),
        project_path,
        parameters,
    }
}

fn build_publish_session_id(provider_id: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    format!("{}-{}", provider_id, nanos)
}

struct PreparedPublishCommand {
    command: RenderedPublishCommand,
    working_dir_path: Option<PathBuf>,
}

fn protected_location_label(location: ProtectedDirectoryLocation) -> &'static str {
    match location {
        ProtectedDirectoryLocation::Desktop => "Desktop",
        ProtectedDirectoryLocation::Documents => "Documents",
        ProtectedDirectoryLocation::Downloads => "Downloads",
    }
}

fn selected_output_path(result: &preflight::PublishOutputPreflightResult) -> &str {
    result
        .configured_output_dir
        .as_deref()
        .filter(|path| !path.trim().is_empty())
        .unwrap_or(result.output_dir.as_str())
}

fn build_preflight_validation_error(
    result: &preflight::PublishOutputPreflightResult,
) -> crate::errors::AppError {
    let path = selected_output_path(result);
    match result.validation.issue {
        Some(PublishOutputValidationIssue::WindowsStylePathOnPosix) => publish_error(
            format!(
                "publish output path is incompatible with this system because it looks like a Windows path: {}",
                path
            ),
            "publish_output_windows_style_path_on_posix",
        ),
        Some(PublishOutputValidationIssue::PosixAbsolutePathOnWindows) => publish_error(
            format!(
                "publish output path is incompatible with this system because it looks like a Unix absolute path: {}",
                path
            ),
            "publish_output_posix_absolute_path_on_windows",
        ),
        Some(PublishOutputValidationIssue::WindowsDriveRootMissing) => publish_error(
            format!(
                "publish output path points to a missing Windows drive or share root: {}",
                path
            ),
            "publish_output_windows_drive_root_missing",
        ),
        None => publish_error(
            format!("publish output path is incompatible with this system: {}", path),
            "publish_output_path_incompatible",
        ),
    }
}

fn build_preflight_access_error(
    result: &preflight::PublishOutputPreflightResult,
) -> crate::errors::AppError {
    let location = result
        .access
        .protected_location
        .map(protected_location_label)
        .unwrap_or("protected folder");
    let path = result
        .access
        .probe_directory
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .or(result.access.protected_root.as_deref())
        .or(Some(result.output_dir.as_str()))
        .unwrap_or("-");
    let detail = result.access.detail.as_deref().unwrap_or("access denied");

    publish_error(
        format!(
            "publish output directory requires macOS protected folder access ({location}): {path} | {detail}"
        ),
        "publish_protected_directory_access_denied",
    )
}

pub(crate) fn ensure_publish_output_preflight(
    spec: &PublishSpec,
) -> Result<(), crate::errors::AppError> {
    let result = preflight::preflight_publish_output(spec);

    if result.validation.status == preflight::PublishOutputValidationStatus::Incompatible {
        return Err(build_preflight_validation_error(&result));
    }

    if result.access.status == preflight::PublishOutputAccessStatus::Denied {
        return Err(build_preflight_access_error(&result));
    }

    Ok(())
}

fn prepare_publish_command(
    spec: &PublishSpec,
) -> Result<PreparedPublishCommand, crate::errors::AppError> {
    let plan = crate::compiler::compile(spec).map_err(crate::errors::AppError::from)?;
    let registry = ProviderRegistry::new();
    let provider = registry
        .get(&spec.provider_id)
        .map_err(crate::errors::AppError::from)?;
    let schema = provider.get_schema().map_err(publish_schema_error)?;
    let renderer = crate::parameter::ParameterRenderer::new(schema);
    let rendered = renderer
        .render(&spec.parameters)
        .map_err(publish_render_error)?;
    let (base_program, mut args) = resolve_plan_command(&plan)?;

    if spec.provider_id == "dotnet" {
        args.push(spec.project_path.clone());
    }
    args.extend(rendered.args);

    let working_dir_path = resolve_working_dir(spec);
    let display_command = build_display_command(&base_program, &args);

    let spawn_program = if spec.provider_id == "java" {
        resolve_java_program(&base_program, working_dir_path.as_ref())?
    } else {
        base_program
    };

    Ok(PreparedPublishCommand {
        command: RenderedPublishCommand {
            program: resolve_spawn_program(&spawn_program),
            args,
            working_dir: working_dir_path
                .as_ref()
                .map(|dir| dir.to_string_lossy().to_string()),
            display_command,
        },
        working_dir_path,
    })
}

pub(crate) fn render_publish_command(
    spec: &PublishSpec,
) -> Result<RenderedPublishCommand, crate::errors::AppError> {
    Ok(prepare_publish_command(spec)?.command)
}

fn should_delete_existing_files(spec: &PublishSpec) -> bool {
    matches!(
        spec.parameters.get("delete_existing_files"),
        Some(SpecValue::Bool(true))
    )
}

fn clean_output_directory(
    output_dir: &str,
    project_path: &str,
) -> Result<bool, crate::errors::AppError> {
    if output_dir.is_empty() {
        return Ok(false);
    }

    let output_path = PathBuf::from(output_dir);
    if !output_path.is_dir() {
        return Ok(false);
    }

    // Safety: never clean a directory that is (or contains) the project source
    let canonical_output = output_path
        .canonicalize()
        .unwrap_or_else(|_| output_path.clone());
    if !project_path.is_empty() {
        let project_dir = std::path::Path::new(project_path)
            .parent()
            .map(|dir| dir.to_path_buf())
            .unwrap_or_default();
        if !project_dir.as_os_str().is_empty() {
            let canonical_project_dir = project_dir
                .canonicalize()
                .unwrap_or_else(|_| project_dir.clone());
            // Reject if the output directory is a parent of (or equal to) the project directory
            if canonical_project_dir.starts_with(&canonical_output) {
                return Err(publish_error(
                    format!(
                        "refusing to clean output directory because it contains the project source: {}",
                        output_dir
                    ),
                    "delete_existing_files_safety_project_overlap",
                ));
            }
            // Reject if the output directory is inside the project source tree
            if canonical_output.starts_with(&canonical_project_dir) {
                // Allow only well-known build output subdirectories
                let relative = canonical_output
                    .strip_prefix(&canonical_project_dir)
                    .unwrap_or(std::path::Path::new(""));
                let first_component = relative
                    .components()
                    .next()
                    .map(|c| c.as_os_str().to_string_lossy().to_string())
                    .unwrap_or_default();
                if !matches!(first_component.as_str(), "bin" | "obj" | "publish" | "out" | "output" | "artifacts") {
                    return Err(publish_error(
                        format!(
                            "refusing to clean output directory inside the project source tree: {}",
                            output_dir
                        ),
                        "delete_existing_files_safety_inside_project",
                    ));
                }
            }
        }
    }

    // Safety: reject root-level directories (e.g. "/" or "C:\")
    if canonical_output.parent().is_none() {
        return Err(publish_error(
            format!(
                "refusing to clean a root-level directory: {}",
                output_dir
            ),
            "delete_existing_files_safety_root_directory",
        ));
    }

    std::fs::remove_dir_all(&output_path).map_err(|error| {
        publish_error(
            format!(
                "failed to clean output directory {}: {}",
                output_dir, error
            ),
            "delete_existing_files_remove_failed",
        )
    })?;
    std::fs::create_dir_all(&output_path).map_err(|error| {
        publish_error(
            format!(
                "failed to recreate output directory {}: {}",
                output_dir, error
            ),
            "delete_existing_files_recreate_failed",
        )
    })?;

    Ok(true)
}

pub(crate) async fn execute_publish_spec(
    app: &AppHandle,
    spec: PublishSpec,
) -> Result<PublishResult, crate::errors::AppError> {
    let prepared = prepare_publish_command(&spec)?;
    ensure_publish_output_preflight(&spec)?;

    // Pre-publish: clean output directory if delete_existing_files is set
    if should_delete_existing_files(&spec) {
        let output_dir = infer_output_dir(&spec);
        match clean_output_directory(&output_dir, &spec.project_path) {
            Ok(true) => {
                log::info!(
                    "[pre-publish] cleaned output directory: {}",
                    output_dir
                );
            }
            Ok(false) => {
                log::info!(
                    "[pre-publish] output directory does not exist or is empty, skipping cleanup: {}",
                    output_dir
                );
            }
            Err(error) => {
                return Err(error);
            }
        }
    }

    let session_id = build_publish_session_id(&spec.provider_id);
    let permit = reserve_execution(session_id.clone()).await?;
    let execution_result: Result<PublishResult, crate::errors::AppError> = async {
        if permit.is_cancel_requested() {
            return Ok(PublishResult {
                provider_id: spec.provider_id.clone(),
                success: false,
                cancelled: true,
                error: Some("发布已取消".to_string()),
                command: prepared.command.clone(),
                output_log: String::new(),
                output_dir: String::new(),
                file_count: 0,
            });
        }

        log::info!(
            "Executing provider plan: provider={} program={} args={}",
            spec.provider_id,
            prepared.command.program,
            prepared.command.args.join(" ")
        );

        let mut command = crate::process_utils::new_tokio_command(&prepared.command.program);
        command
            .args(&prepared.command.args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(dir) = &prepared.working_dir_path {
            command.current_dir(dir);
        }

        let mut child = command.spawn().map_err(|error| {
            publish_error(
                format!("failed to spawn {}: {}", prepared.command.program, error),
                classify_process_spawn_error(error.kind()),
            )
        })?;

        let command_line = format!("$ {}", prepared.command.display_command);
        emit_publish_log(app, &session_id, &format!("{}\n", command_line));

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let child = Arc::new(Mutex::new(child));
        let cancel_requested = Arc::clone(&permit.cancel_requested);
        permit.mark_running(Arc::clone(&child)).await;

        let run_result: Result<(bool, bool, Option<String>, String), crate::errors::AppError> =
            async {
                let (sender, receiver) = mpsc::unbounded_channel::<(String, String)>();
                let collector = tokio::spawn(collect_log_chunks(
                    app.clone(),
                    session_id.clone(),
                    receiver,
                ));
                let mut readers = Vec::new();
                if let Some(stdout) = stdout {
                    readers.push(tokio::spawn(read_stream_chunks(
                        stdout,
                        "stdout",
                        sender.clone(),
                    )));
                }
                if let Some(stderr) = stderr {
                    readers.push(tokio::spawn(read_stream_chunks(
                        stderr,
                        "stderr",
                        sender.clone(),
                    )));
                }
                drop(sender);

                let status = {
                    let mut running_child = child.lock().await;
                    running_child.wait().await.map_err(|error| {
                        publish_error(
                            format!("failed to wait publish process: {}", error),
                            classify_process_wait_error(error.kind()),
                        )
                    })?
                };

                for reader in readers {
                    let _ = reader.await;
                }

                let mut log_summary = collector.await.map_err(|error| {
                    publish_error(
                        format!("failed to collect publish logs: {}", error),
                        "publish_log_collect_failed",
                    )
                })?;
                let cancelled = cancel_requested.load(std::sync::atomic::Ordering::SeqCst);
                if cancelled {
                    let cancelled_line = if log_summary.ends_with_newline {
                        "[cancelled] 发布已取消".to_string()
                    } else {
                        "\n[cancelled] 发布已取消".to_string()
                    };
                    emit_publish_log(app, &session_id, &cancelled_line);
                    log_summary.output.push_str(&cancelled_line);
                }

                let success = status.success() && !cancelled;
                let error = if cancelled {
                    Some("发布已取消".to_string())
                } else if success {
                    None
                } else {
                    Some(format!("发布失败，退出代码: {:?}", status.code()))
                };
                Ok((success, cancelled, error, log_summary.output))
            }
            .await;

        let (success, cancelled, error, output_log) = run_result?;
        let output_dir = infer_output_dir(&spec);
        let file_count = if success {
            count_output_files(&output_dir)
        } else {
            0
        };

        Ok(PublishResult {
            provider_id: spec.provider_id.clone(),
            success,
            cancelled,
            error,
            command: prepared.command.clone(),
            output_log,
            output_dir,
            file_count,
        })
    }
    .await;

    super::session::clear_running_execution(&session_id).await;
    execution_result
}
