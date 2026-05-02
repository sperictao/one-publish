use super::errors::publish_error;
use crate::provider::registry::provider_registry;
use crate::spec::{PublishSpec, SpecValue};
use std::path::{Path, PathBuf};

fn should_quote_display_arg(arg: &str) -> bool {
    arg.is_empty()
        || arg.chars().any(char::is_whitespace)
        || arg.contains('/')
        || arg.contains('\\')
        || arg.starts_with('.')
}

fn display_arg(arg: &str) -> String {
    if !should_quote_display_arg(arg) {
        return arg.to_string();
    }

    format!("\"{}\"", arg.replace('\\', "\\\\").replace('"', "\\\""))
}

pub(crate) fn build_display_command(program: &str, args: &[String]) -> String {
    let mut parts = Vec::with_capacity(args.len() + 1);
    parts.push(display_arg(program));
    parts.extend(args.iter().map(|arg| display_arg(arg)));
    parts.join(" ")
}

pub(crate) fn resolve_plan_command(
    plan: &crate::plan::ExecutionPlan,
) -> Result<(String, Vec<String>), crate::errors::AppError> {
    let first_step = plan
        .steps
        .first()
        .ok_or_else(|| publish_error("execution plan has no step", "plan_missing_step"))?;
    let mut parts = first_step.title.split_whitespace();
    let program = parts
        .next()
        .ok_or_else(|| publish_error("execution step title is empty", "plan_invalid_step_title"))?
        .to_string();
    let args = parts.map(|item| item.to_string()).collect();
    Ok((program, args))
}

pub(crate) fn resolve_spawn_program(program: &str) -> String {
    if Path::new(program).is_absolute() || Path::new(program).components().count() > 1 {
        return program.to_string();
    }

    crate::environment::command_path(program).unwrap_or_else(|| program.to_string())
}

pub(crate) fn resolve_working_dir(spec: &PublishSpec) -> Option<PathBuf> {
    provider_registry()
        .get(&spec.provider_id)
        .ok()
        .and_then(|provider| provider.resolve_working_dir(spec))
}

pub(crate) fn infer_output_dir(spec: &PublishSpec) -> String {
    provider_registry()
        .get(&spec.provider_id)
        .map(|provider| provider.infer_output_dir(spec))
        .unwrap_or_default()
}

pub(crate) fn configured_output_dir(spec: &PublishSpec) -> Option<String> {
    provider_registry()
        .get(&spec.provider_id)
        .ok()
        .and_then(|provider| provider.configured_output_dir(spec))
}

pub(crate) fn should_delete_existing_files(spec: &PublishSpec) -> bool {
    matches!(
        spec.parameters.get("delete_existing_files"),
        Some(SpecValue::Bool(true))
    )
}

pub(crate) fn resolve_runtime_program(
    spec: &PublishSpec,
    program: &str,
    working_dir: Option<&PathBuf>,
) -> Result<String, crate::errors::AppError> {
    let provider = provider_registry()
        .get(&spec.provider_id)
        .map_err(crate::errors::AppError::from)?;
    provider.resolve_runtime_program(program, working_dir)
}

pub(crate) fn count_output_files(output_dir: &str) -> usize {
    if output_dir.is_empty() {
        return 0;
    }

    let path = Path::new(output_dir);
    if path.is_file() {
        return 1;
    }
    if !path.is_dir() {
        return 0;
    }

    let mut file_count = 0usize;
    let mut pending_dirs = vec![path.to_path_buf()];

    while let Some(current_dir) = pending_dirs.pop() {
        let Ok(entries) = std::fs::read_dir(&current_dir) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                pending_dirs.push(path);
            } else {
                file_count += 1;
            }
        }
    }

    file_count
}
