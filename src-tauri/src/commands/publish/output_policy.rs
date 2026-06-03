use super::errors::publish_error;
use super::output::should_delete_existing_files;
use super::preflight::{
    self, ProtectedDirectoryLocation, PublishOutputValidationIssue, RemoteLocationKind,
    RemoteLocationSummary,
};
use crate::spec::PublishSpec;
use std::io::ErrorKind as IoErrorKind;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PublishOutputCleanupDecision {
    NotRequested,
    SkippedMissingOutput { output_dir: String },
    Clean { output_dir: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PublishOutputPolicy {
    output_dir: String,
    cleanup: PublishOutputCleanupDecision,
}

impl PublishOutputPolicy {
    pub(crate) fn output_dir(&self) -> &str {
        &self.output_dir
    }

    pub(crate) fn cleanup(&self) -> &PublishOutputCleanupDecision {
        &self.cleanup
    }
}

pub(crate) fn resolve_publish_output_policy(
    spec: &PublishSpec,
) -> Result<PublishOutputPolicy, crate::errors::AppError> {
    let preflight = preflight::preflight_publish_output(spec);
    ensure_preflight_allows_execution(&preflight)?;
    let cleanup = resolve_cleanup_decision(spec, &preflight.output_dir)?;

    Ok(PublishOutputPolicy {
        output_dir: preflight.output_dir,
        cleanup,
    })
}

pub(crate) fn build_cleanup_remove_error(
    output_dir: &str,
    error: &std::io::Error,
) -> crate::errors::AppError {
    if let Some(access_error) = build_cleanup_access_error(output_dir, error) {
        return access_error;
    }

    publish_error(
        format!("failed to clean output directory {}: {}", output_dir, error),
        "delete_existing_files_remove_failed",
    )
}

pub(crate) fn build_cleanup_recreate_error(
    output_dir: &str,
    error: &std::io::Error,
) -> crate::errors::AppError {
    if let Some(access_error) = build_cleanup_access_error(output_dir, error) {
        return access_error;
    }

    publish_error(
        format!(
            "failed to recreate output directory {}: {}",
            output_dir, error
        ),
        "delete_existing_files_recreate_failed",
    )
}

fn ensure_preflight_allows_execution(
    result: &preflight::PublishOutputPreflightResult,
) -> Result<(), crate::errors::AppError> {
    if result.validation.status == preflight::PublishOutputValidationStatus::Incompatible {
        return Err(build_preflight_validation_error(result));
    }

    if result.access.status == preflight::PublishOutputAccessStatus::Denied {
        return Err(build_preflight_access_error(result));
    }

    if let Some(summary) = result.access.remote_location.as_ref() {
        if summary.kind == RemoteLocationKind::Remote {
            return Err(build_remote_target_not_implemented_error(summary));
        }
    }

    Ok(())
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
    let Some(location) = result.access.protected_location else {
        return publish_error(
            format!(
                "publish output directory requires macOS protected folder access: {}",
                result.output_dir
            ),
            "publish_protected_directory_access_denied",
        );
    };
    let path = result
        .access
        .probe_directory
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .or(result.access.protected_root.as_deref())
        .or(Some(result.output_dir.as_str()))
        .unwrap_or("-");
    let detail = result.access.detail.as_deref().unwrap_or("access denied");

    build_protected_directory_access_error(location, path, detail)
}

fn build_remote_target_not_implemented_error(
    summary: &RemoteLocationSummary,
) -> crate::errors::AppError {
    let scheme = summary
        .scheme
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("remote");
    publish_error(
        format!(
            "remote publish target is not implemented yet: scheme={} target={}",
            scheme, summary.display
        ),
        "publish_remote_target_not_implemented",
    )
}

fn resolve_cleanup_decision(
    spec: &PublishSpec,
    output_dir: &str,
) -> Result<PublishOutputCleanupDecision, crate::errors::AppError> {
    if !should_delete_existing_files(spec) {
        return Ok(PublishOutputCleanupDecision::NotRequested);
    }

    if output_dir.is_empty() {
        return Ok(PublishOutputCleanupDecision::SkippedMissingOutput {
            output_dir: output_dir.to_string(),
        });
    }

    let output_path = PathBuf::from(output_dir);
    if !output_path.is_dir() {
        return Ok(PublishOutputCleanupDecision::SkippedMissingOutput {
            output_dir: output_dir.to_string(),
        });
    }

    validate_cleanup_target(&output_path, output_dir, &spec.project_path)?;

    Ok(PublishOutputCleanupDecision::Clean {
        output_dir: output_dir.to_string(),
    })
}

fn validate_cleanup_target(
    output_path: &Path,
    output_dir: &str,
    project_path: &str,
) -> Result<(), crate::errors::AppError> {
    let canonical_output = output_path
        .canonicalize()
        .unwrap_or_else(|_| output_path.to_path_buf());

    if !project_path.is_empty() {
        validate_cleanup_target_against_project(&canonical_output, output_dir, project_path)?;
    }

    if canonical_output.parent().is_none() {
        return Err(publish_error(
            format!("refusing to clean a root-level directory: {}", output_dir),
            "delete_existing_files_safety_root_directory",
        ));
    }

    if preflight::is_protected_root_output_dir(output_dir) {
        return Err(publish_error(
            format!(
                "refusing to clean a macOS protected root directory: {}",
                output_dir
            ),
            "delete_existing_files_safety_protected_root_directory",
        ));
    }

    Ok(())
}

fn validate_cleanup_target_against_project(
    canonical_output: &Path,
    output_dir: &str,
    project_path: &str,
) -> Result<(), crate::errors::AppError> {
    let project_dir = Path::new(project_path)
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_default();
    if project_dir.as_os_str().is_empty() {
        return Ok(());
    }

    let canonical_project_dir = project_dir
        .canonicalize()
        .unwrap_or_else(|_| project_dir.clone());

    if canonical_project_dir.starts_with(canonical_output) {
        return Err(publish_error(
            format!(
                "refusing to clean output directory because it contains the project source: {}",
                output_dir
            ),
            "delete_existing_files_safety_project_overlap",
        ));
    }

    if !canonical_output.starts_with(&canonical_project_dir) {
        return Ok(());
    }

    let relative = canonical_output
        .strip_prefix(&canonical_project_dir)
        .unwrap_or(Path::new(""));
    let first_component = relative
        .components()
        .next()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .unwrap_or_default();
    if matches!(
        first_component.as_str(),
        "bin" | "obj" | "publish" | "out" | "output" | "artifacts"
    ) {
        return Ok(());
    }

    Err(publish_error(
        format!(
            "refusing to clean output directory inside the project source tree: {}",
            output_dir
        ),
        "delete_existing_files_safety_inside_project",
    ))
}

fn protected_location_label(location: ProtectedDirectoryLocation) -> &'static str {
    match location {
        ProtectedDirectoryLocation::Desktop => "Desktop",
        ProtectedDirectoryLocation::Documents => "Documents",
        ProtectedDirectoryLocation::Downloads => "Downloads",
    }
}

fn build_protected_directory_access_error(
    location: ProtectedDirectoryLocation,
    path: &str,
    detail: &str,
) -> crate::errors::AppError {
    let location = protected_location_label(location);
    publish_error(
        format!(
            "publish output directory requires macOS protected folder access ({location}): {path} | {detail}"
        ),
        "publish_protected_directory_access_denied",
    )
}

fn build_cleanup_access_error(
    output_dir: &str,
    error: &std::io::Error,
) -> Option<crate::errors::AppError> {
    if error.kind() != IoErrorKind::PermissionDenied {
        return None;
    }

    let location = preflight::protected_location_for_output_dir(output_dir)?;
    Some(build_protected_directory_access_error(
        location,
        output_dir,
        &error.to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spec::{SpecValue, SPEC_VERSION};
    use std::collections::BTreeMap;

    fn cleanup_spec(project_path: &str) -> PublishSpec {
        let mut parameters = BTreeMap::new();
        parameters.insert("delete_existing_files".to_string(), SpecValue::Bool(true));

        PublishSpec {
            version: SPEC_VERSION,
            provider_id: "dotnet".to_string(),
            project_path: project_path.to_string(),
            parameters,
        }
    }

    #[test]
    fn cleanup_policy_skips_missing_output_directory() {
        let root = tempfile::tempdir().expect("create temp root");
        let spec = cleanup_spec(&root.path().join("src").join("App.csproj").to_string_lossy());
        let output_dir = root.path().join("publish").to_string_lossy().to_string();

        let decision = resolve_cleanup_decision(&spec, &output_dir).expect("cleanup decision");

        assert_eq!(
            decision,
            PublishOutputCleanupDecision::SkippedMissingOutput { output_dir }
        );
    }

    #[test]
    fn cleanup_policy_rejects_output_parent_that_contains_project_source() {
        let root = tempfile::tempdir().expect("create temp root");
        let project_dir = root.path().join("src");
        std::fs::create_dir_all(&project_dir).expect("create project dir");
        let spec = cleanup_spec(&project_dir.join("App.csproj").to_string_lossy());
        let output_dir = root.path().to_string_lossy().to_string();

        let error =
            resolve_cleanup_decision(&spec, &output_dir).expect_err("overlap should be rejected");

        assert_eq!(
            error.code.as_deref(),
            Some("delete_existing_files_safety_project_overlap")
        );
    }

    #[test]
    fn cleanup_policy_rejects_unapproved_project_subdirectory() {
        let root = tempfile::tempdir().expect("create temp root");
        let project_dir = root.path().join("src");
        let output_dir = project_dir.join("Properties");
        std::fs::create_dir_all(&output_dir).expect("create output dir");
        let spec = cleanup_spec(&project_dir.join("App.csproj").to_string_lossy());
        let output_dir_string = output_dir.to_string_lossy().to_string();

        let error = resolve_cleanup_decision(&spec, &output_dir_string)
            .expect_err("inside-project output should be rejected");

        assert_eq!(
            error.code.as_deref(),
            Some("delete_existing_files_safety_inside_project")
        );
    }

    #[test]
    fn cleanup_policy_allows_approved_project_output_subdirectory() {
        let root = tempfile::tempdir().expect("create temp root");
        let project_dir = root.path().join("src");
        let output_dir = project_dir.join("publish").join("release");
        std::fs::create_dir_all(&output_dir).expect("create output dir");
        let spec = cleanup_spec(&project_dir.join("App.csproj").to_string_lossy());
        let output_dir_string = output_dir.to_string_lossy().to_string();

        let decision =
            resolve_cleanup_decision(&spec, &output_dir_string).expect("cleanup decision");

        assert_eq!(
            decision,
            PublishOutputCleanupDecision::Clean {
                output_dir: output_dir_string
            }
        );
    }
}
