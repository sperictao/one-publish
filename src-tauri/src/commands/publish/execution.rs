use super::errors::{
    classify_process_spawn_error, classify_process_wait_error, publish_error, publish_render_error,
    publish_schema_error,
};
use super::logs::{collect_log_chunks, emit_publish_log, read_stream_chunks};
use super::output::{
    count_output_files, infer_output_dir, resolve_java_program, resolve_plan_command,
    resolve_spawn_program, resolve_working_dir,
};
use super::session::reserve_execution;
use super::{PublishConfig, PublishResult};
use crate::provider::registry::ProviderRegistry;
use crate::spec::{PublishSpec, SpecValue, SPEC_VERSION};
use std::collections::BTreeMap;
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

pub(crate) async fn execute_publish_spec(
    app: &AppHandle,
    spec: PublishSpec,
) -> Result<PublishResult, crate::errors::AppError> {
    let session_id = build_publish_session_id(&spec.provider_id);
    let permit = reserve_execution(session_id.clone()).await?;
    let execution_result: Result<PublishResult, crate::errors::AppError> = async {
        let plan = crate::compiler::compile(&spec).map_err(crate::errors::AppError::from)?;
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

        let working_dir = resolve_working_dir(&spec);
        let program = if spec.provider_id == "java" {
            resolve_java_program(&base_program, working_dir.as_ref())?
        } else {
            base_program
        };

        if permit.is_cancel_requested() {
            return Ok(PublishResult {
                provider_id: spec.provider_id.clone(),
                success: false,
                cancelled: true,
                error: Some("发布已取消".to_string()),
                output_dir: String::new(),
                file_count: 0,
            });
        }

        let program = resolve_spawn_program(&program);
        log::info!(
            "Executing provider plan: provider={} program={} args={}",
            spec.provider_id,
            program,
            args.join(" ")
        );

        let mut command = crate::process_utils::new_tokio_command(&program);
        command
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(dir) = &working_dir {
            command.current_dir(dir);
        }

        let mut child = command.spawn().map_err(|error| {
            publish_error(
                format!("failed to spawn {}: {}", program, error),
                classify_process_spawn_error(error.kind()),
            )
        })?;

        let command_line = if args.is_empty() {
            format!("$ {}", program)
        } else {
            format!("$ {} {}", program, args.join(" "))
        };
        emit_publish_log(app, &session_id, &format!("{}\n", command_line));

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let child = Arc::new(Mutex::new(child));
        let cancel_requested = Arc::clone(&permit.cancel_requested);
        permit.mark_running(Arc::clone(&child)).await;

        let run_result: Result<(bool, bool, Option<String>), crate::errors::AppError> = async {
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

            let log_summary = collector.await.map_err(|error| {
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
            }

            let success = status.success() && !cancelled;
            let error = if cancelled {
                Some("发布已取消".to_string())
            } else if success {
                None
            } else {
                Some(format!("发布失败，退出代码: {:?}", status.code()))
            };
            Ok((success, cancelled, error))
        }
        .await;

        let (success, cancelled, error) = run_result?;
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
            output_dir,
            file_count,
        })
    }
    .await;

    super::session::clear_running_execution(&session_id).await;
    execution_result
}
