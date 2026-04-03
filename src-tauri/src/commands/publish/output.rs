use super::errors::publish_error;
use crate::spec::{PublishSpec, SpecValue};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

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

pub(crate) fn resolve_java_program(
    program: &str,
    working_dir: Option<&PathBuf>,
) -> Result<String, crate::errors::AppError> {
    if program != "./gradlew" && program != "gradlew" {
        return Ok(program.to_string());
    }

    let Some(dir) = working_dir else {
        return Err(publish_error(
            "java provider requires a project directory",
            "java_project_dir_required",
        ));
    };

    #[cfg(target_os = "windows")]
    let wrapper_name = "gradlew.bat";
    #[cfg(not(target_os = "windows"))]
    let wrapper_name = "gradlew";

    let wrapper_path = dir.join(wrapper_name);
    if wrapper_path.is_file() {
        return Ok(wrapper_path.to_string_lossy().to_string());
    }
    if crate::environment::command_exists("gradle") {
        return Ok("gradle".to_string());
    }

    Err(publish_error(
        format!(
            "gradle wrapper not found at {} and `gradle` is not available in PATH",
            wrapper_path.to_string_lossy()
        ),
        "java_gradle_not_found",
    ))
}

fn resolve_provider_project_dir(path: PathBuf, known_files: &[&str]) -> Option<PathBuf> {
    let looks_like_project_file = path
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| {
            known_files
                .iter()
                .any(|file| name.eq_ignore_ascii_case(file))
        })
        .unwrap_or(false)
        || (!path.is_dir() && path.extension().is_some());

    if looks_like_project_file {
        path.parent().map(|parent| parent.to_path_buf())
    } else {
        Some(path)
    }
}

pub(crate) fn resolve_working_dir(spec: &PublishSpec) -> Option<PathBuf> {
    let path = PathBuf::from(&spec.project_path);
    match spec.provider_id.as_str() {
        "dotnet" => path.parent().map(|parent| parent.to_path_buf()),
        "cargo" => resolve_provider_project_dir(path, &["Cargo.toml"]),
        "go" => resolve_provider_project_dir(path, &["go.mod"]),
        "java" => resolve_provider_project_dir(
            path,
            &[
                "build.gradle",
                "build.gradle.kts",
                "settings.gradle",
                "settings.gradle.kts",
                "pom.xml",
                "gradlew",
                "gradlew.bat",
            ],
        ),
        _ => resolve_provider_project_dir(path, &[]),
    }
}

fn resolve_output_path(path: String, base_dir: Option<PathBuf>) -> String {
    if path.is_empty() {
        return path;
    }

    let candidate = PathBuf::from(&path);
    if candidate.is_absolute() {
        return candidate.to_string_lossy().to_string();
    }

    base_dir
        .map(|dir| dir.join(candidate).to_string_lossy().to_string())
        .unwrap_or(path)
}

pub(crate) fn infer_output_dir(spec: &PublishSpec) -> String {
    match spec.provider_id.as_str() {
        "dotnet" => {
            if let Some(output) = read_parameter_string(&spec.parameters, "output") {
                return resolve_output_path(output, resolve_working_dir(spec));
            }
            if let Some(parent) = Path::new(&spec.project_path).parent() {
                let configuration = read_parameter_string(&spec.parameters, "configuration")
                    .unwrap_or_else(|| "Release".to_string());
                return parent
                    .join("bin")
                    .join(configuration)
                    .join("publish")
                    .to_string_lossy()
                    .to_string();
            }
            String::new()
        }
        "cargo" => {
            if let Some(target_dir) = read_parameter_string(&spec.parameters, "target_dir") {
                return resolve_output_path(target_dir, resolve_working_dir(spec));
            }
            if let Some(project_dir) = resolve_working_dir(spec) {
                let profile = if read_parameter_bool(&spec.parameters, "release") {
                    "release"
                } else {
                    "debug"
                };
                return project_dir
                    .join("target")
                    .join(profile)
                    .to_string_lossy()
                    .to_string();
            }
            String::new()
        }
        "go" => read_parameter_string(&spec.parameters, "output")
            .map(|output| resolve_output_path(output, resolve_working_dir(spec)))
            .unwrap_or_default(),
        "java" => resolve_working_dir(spec)
            .map(|dir| dir.join("build").join("libs").to_string_lossy().to_string())
            .unwrap_or_default(),
        _ => String::new(),
    }
}

fn read_parameter_string(parameters: &BTreeMap<String, SpecValue>, key: &str) -> Option<String> {
    match parameters.get(key) {
        Some(SpecValue::String(value)) if !value.is_empty() => Some(value.clone()),
        Some(SpecValue::Number(value)) => Some(value.to_string()),
        _ => None,
    }
}

fn read_parameter_bool(parameters: &BTreeMap<String, SpecValue>, key: &str) -> bool {
    matches!(parameters.get(key), Some(SpecValue::Bool(true)))
}

pub(crate) fn count_output_files(output_dir: &str) -> usize {
    if output_dir.is_empty() {
        return 0;
    }

    let path = Path::new(output_dir);
    if !path.is_dir() {
        return 0;
    }

    std::fs::read_dir(path)
        .map(|entries| entries.count())
        .unwrap_or(0)
}
