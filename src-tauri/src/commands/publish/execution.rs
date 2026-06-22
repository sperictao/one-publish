use super::errors::{
    classify_process_spawn_error, classify_process_wait_error, publish_error, publish_render_error,
    publish_schema_error,
};
use super::logs::{collect_log_chunks, emit_publish_log, read_stream_chunks};
use super::output::{
    build_display_command, count_output_files, resolve_plan_command, resolve_runtime_program,
    resolve_spawn_program, resolve_working_dir,
};
use super::output_policy::{self, PublishOutputCleanupDecision, PublishOutputPolicy};
use super::session::reserve_execution;
use super::{PublishResult, RenderedPublishCommand};
use crate::provider::registry::provider_registry;
use crate::spec::PublishSpec;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::{mpsc, Mutex};

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

fn prepare_publish_command(
    spec: &PublishSpec,
) -> Result<PreparedPublishCommand, crate::errors::AppError> {
    let plan = crate::compiler::compile(spec).map_err(crate::errors::AppError::from)?;
    let provider = provider_registry()
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
    let spawn_program = resolve_runtime_program(spec, &base_program, working_dir_path.as_ref())?;

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

fn clean_output_directory(output_dir: &str) -> Result<(), crate::errors::AppError> {
    let output_path = PathBuf::from(output_dir);
    std::fs::remove_dir_all(&output_path)
        .map_err(|error| output_policy::build_cleanup_remove_error(output_dir, &error))?;
    std::fs::create_dir_all(&output_path)
        .map_err(|error| output_policy::build_cleanup_recreate_error(output_dir, &error))?;

    Ok(())
}

fn apply_cleanup_policy(policy: &PublishOutputPolicy) -> Result<(), crate::errors::AppError> {
    match policy.cleanup() {
        PublishOutputCleanupDecision::NotRequested => Ok(()),
        PublishOutputCleanupDecision::SkippedMissingOutput { output_dir } => {
            log::info!(
                "[pre-publish] output directory does not exist or is empty, skipping cleanup: {}",
                output_dir
            );
            Ok(())
        }
        PublishOutputCleanupDecision::Clean { output_dir } => {
            clean_output_directory(output_dir)?;
            log::info!("[pre-publish] cleaned output directory: {}", output_dir);
            Ok(())
        }
    }
}

pub(crate) async fn execute_publish_spec(
    app: &AppHandle,
    spec: PublishSpec,
) -> Result<PublishResult, crate::errors::AppError> {
    let prepared = prepare_publish_command(&spec)?;
    let output_policy = output_policy::resolve_publish_output_policy(&spec)?;
    apply_cleanup_policy(&output_policy)?;

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
                warnings: None,
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

        let run_result: Result<(bool, bool, Option<String>, String, Vec<String>), crate::errors::AppError> =
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
                Ok((success, cancelled, error, log_summary.output, log_summary.warnings))
            }
            .await;

        let (success, cancelled, error, output_log, warnings) = run_result?;
        let output_dir = output_policy.output_dir().to_string();
        let file_count = if success {
            count_output_files(output_policy.output_dir())
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
            warnings: if warnings.is_empty() {
                None
            } else {
                Some(warnings)
            },
        })
    }
    .await;

    super::session::clear_running_execution(&session_id).await;
    execution_result
}
