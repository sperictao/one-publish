use super::errors::publish_error;
use crate::parameter::ParameterType;
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

/// 当 plan title 固化了某个 positional 参数的 schema 默认值，而 spec 又显式
/// 提供了该 positional 参数时，默认值只充当 fallback，不能与显式值同时执行。
/// 该规则完全由 schema 形态 + default 驱动，不包含 Provider 身份判断。
fn explicit_positional_overrides_default(spec: &PublishSpec, default_arg: &str) -> bool {
    let Ok(provider) = provider_registry().get(&spec.provider_id) else {
        return false;
    };
    let Ok(schema) = provider.get_schema() else {
        return false;
    };

    schema.parameters.iter().any(|(key, definition)| {
        matches!(definition.param_type, ParameterType::String)
            && definition.flag.is_empty()
            && definition.prefix.is_none()
            && definition.env.is_none()
            && definition
                .default
                .as_ref()
                .and_then(serde_json::Value::as_str)
                == Some(default_arg)
            && matches!(
                spec.parameters.get(key),
                Some(SpecValue::String(value)) if !value.is_empty()
            )
    })
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
    let mut args = parts.map(|item| item.to_string()).collect::<Vec<_>>();

    if args
        .last()
        .is_some_and(|default_arg| explicit_positional_overrides_default(&plan.spec, default_arg))
    {
        args.pop();
    }

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plan::{ExecutionPlan, PlanStep, PLAN_VERSION};
    use crate::spec::SPEC_VERSION;
    use std::collections::BTreeMap;

    fn java_plan(task: Option<&str>) -> ExecutionPlan {
        let mut parameters = BTreeMap::new();
        if let Some(task) = task {
            parameters.insert("task".to_string(), SpecValue::String(task.to_string()));
        }
        let spec = PublishSpec {
            version: SPEC_VERSION,
            provider_id: "java".to_string(),
            project_path: "/tmp/java-demo".to_string(),
            parameters,
        };
        ExecutionPlan {
            version: PLAN_VERSION,
            spec: spec.clone(),
            steps: vec![PlanStep {
                id: "gradle.build".to_string(),
                title: "./gradlew build".to_string(),
                kind: "process".to_string(),
                payload: BTreeMap::new(),
            }],
        }
    }

    #[test]
    fn plan_command_keeps_positional_default_when_not_overridden() {
        let (program, args) = resolve_plan_command(&java_plan(None)).expect("resolve command");
        assert_eq!(program, "./gradlew");
        assert_eq!(args, vec!["build"]);
    }

    #[test]
    fn plan_command_removes_positional_default_when_spec_has_explicit_value() {
        let (program, args) =
            resolve_plan_command(&java_plan(Some("test"))).expect("resolve command");
        assert_eq!(program, "./gradlew");
        assert!(args.is_empty());
    }
}
