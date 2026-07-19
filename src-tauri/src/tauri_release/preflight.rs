use super::{
    github, project, storage, versioning, workflow, GitHubRepositoryVisibility,
    ManagedWorkflowStatus, TauriReleaseConfig, TauriReleasePreflight,
};
use crate::errors::AppError;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::path::Path;

fn git(repository_root: &Path, args: &[&str]) -> Result<String, AppError> {
    github::require_success("git", args, repository_root)
}

fn validate_version(version: &str, current: &str) -> Result<String, AppError> {
    let candidate = semver::Version::parse(version).map_err(|error| {
        AppError::validation_with_code(
            format!("invalid stable release version '{version}': {error}"),
            "tauri_release_version_invalid",
        )
    })?;
    if !candidate.pre.is_empty() || !candidate.build.is_empty() {
        return Err(AppError::validation_with_code(
            "prerelease and build metadata versions are not supported",
            "tauri_release_version_not_stable",
        ));
    }
    let current = semver::Version::parse(current).map_err(|error| {
        AppError::validation_with_code(
            format!("invalid current Tauri version '{current}': {error}"),
            "tauri_version_invalid",
        )
    })?;
    if candidate <= current {
        return Err(AppError::validation_with_code(
            format!("release version {candidate} must be greater than current version {current}"),
            "tauri_release_version_not_newer",
        ));
    }
    Ok(candidate.to_string())
}

fn previous_stable_tag(repository_root: &Path, prefix: &str) -> Result<Option<String>, AppError> {
    let tags = git(
        repository_root,
        &[
            "tag",
            "--list",
            &format!("{prefix}*"),
            "--sort=-version:refname",
        ],
    )?;
    Ok(tags.lines().find_map(|tag| {
        let version = tag.strip_prefix(prefix)?;
        let parsed = semver::Version::parse(version).ok()?;
        (parsed.pre.is_empty() && parsed.build.is_empty()).then(|| tag.to_string())
    }))
}

fn ensure_newer_than_previous_tag(
    version: &str,
    previous_tag: Option<&str>,
    prefix: &str,
) -> Result<(), AppError> {
    let Some(previous_tag) = previous_tag else {
        return Ok(());
    };
    let previous_version = previous_tag
        .strip_prefix(prefix)
        .and_then(|value| semver::Version::parse(value).ok())
        .ok_or_else(|| {
            AppError::repository_with_code(
                format!("failed to parse previous stable tag: {previous_tag}"),
                "tauri_release_previous_tag_invalid",
            )
        })?;
    let candidate = semver::Version::parse(version).expect("validated release version");
    if candidate <= previous_version {
        return Err(AppError::validation_with_code(
            format!(
                "release version {candidate} must be greater than latest stable tag {previous_tag}"
            ),
            "tauri_release_version_not_newer_than_tag",
        ));
    }
    Ok(())
}

fn generate_release_notes(
    repository_root: &Path,
    previous_tag: Option<&str>,
) -> Result<String, AppError> {
    let range = previous_tag
        .map(|tag| format!("{tag}..HEAD"))
        .unwrap_or_else(|| "HEAD".to_string());
    let log = git(
        repository_root,
        &["log", "--no-merges", "--pretty=format:- %s", &range],
    )?;
    if log.trim().is_empty() {
        Ok("- No user-facing changes recorded.\n".to_string())
    } else {
        Ok(format!("{}\n", log.trim()))
    }
}

fn ensure_clean_and_synced(
    repository_root: &Path,
    default_branch: &str,
) -> Result<(String, String), AppError> {
    let status = git(repository_root, &["status", "--porcelain=v1"])?;
    if !status.is_empty() {
        return Err(AppError::repository_with_code(
            format!("GitHub release requires a clean worktree:\n{status}"),
            "tauri_release_worktree_dirty",
        ));
    }
    let current_branch = git(repository_root, &["branch", "--show-current"])?;
    if current_branch != default_branch {
        return Err(AppError::repository_with_code(
            format!(
                "GitHub release must run on default branch '{default_branch}', current branch is '{current_branch}'"
            ),
            "tauri_release_default_branch_required",
        ));
    }
    git(
        repository_root,
        &["fetch", "origin", default_branch, "--tags"],
    )?;
    let counts = git(
        repository_root,
        &[
            "rev-list",
            "--left-right",
            "--count",
            &format!("HEAD...origin/{default_branch}"),
        ],
    )?;
    if counts.split_whitespace().collect::<Vec<_>>() != ["0", "0"] {
        return Err(AppError::repository_with_code(
            format!("default branch is not synchronized with origin/{default_branch}: {counts}"),
            "tauri_release_branch_not_synced",
        ));
    }
    let head_sha = git(repository_root, &["rev-parse", "HEAD"])?;
    Ok((current_branch, head_sha))
}

fn ensure_remote_identity_available(
    repository_root: &Path,
    tag: &str,
    identity: &str,
) -> Result<(), AppError> {
    let tag_output = github::run(
        "git",
        &[
            "ls-remote",
            "--exit-code",
            "--tags",
            "origin",
            &format!("refs/tags/{tag}"),
        ],
        repository_root,
    )?;
    if tag_output.status.success() {
        return Err(AppError::validation_with_code(
            format!("remote tag already exists and is immutable: {tag}"),
            "tauri_release_tag_exists",
        ));
    }
    if tag_output.status.code() != Some(2) {
        let stderr = String::from_utf8_lossy(&tag_output.stderr);
        return Err(AppError::external_command_with_code(
            format!("failed to check remote tag {tag}: {}", stderr.trim()),
            "tauri_release_tag_check_failed",
        ));
    }

    let release_output = github::run(
        "gh",
        &["release", "view", tag, "--repo", identity, "--json", "url"],
        repository_root,
    )?;
    if release_output.status.success() {
        return Err(AppError::validation_with_code(
            format!("GitHub Release already exists: {tag}"),
            "tauri_release_exists",
        ));
    }
    let release_error = String::from_utf8_lossy(&release_output.stderr);
    if !is_missing_release_error(&release_error) {
        return Err(AppError::external_command_with_code(
            format!(
                "failed to check GitHub Release {tag}: {}",
                release_error.trim()
            ),
            "tauri_release_check_failed",
        ));
    }
    Ok(())
}

fn is_missing_release_error(stderr: &str) -> bool {
    let normalized = stderr.to_ascii_lowercase();
    normalized.contains("release not found")
        || normalized.contains("http 404")
        || normalized.contains("could not resolve to a release")
}

pub fn prepare(
    repository_id: &str,
    repository_root: &Path,
    config: &TauriReleaseConfig,
    requested_version: &str,
) -> Result<TauriReleasePreflight, AppError> {
    if storage::list_attempts(Some(repository_id))?
        .iter()
        .any(|attempt| !attempt.stage.is_terminal())
    {
        return Err(AppError::publish_with_code(
            "this repository already has an active GitHub release attempt",
            "tauri_release_attempt_active",
        ));
    }
    let workflow_preview = workflow::preview(repository_root, config)?;
    if workflow_preview.status != ManagedWorkflowStatus::Current
        || !workflow_preview.conflicts.is_empty()
    {
        return Err(AppError::validation_with_code(
            "managed workflow is missing, drifted, or conflicts with another release workflow",
            "tauri_release_workflow_not_current",
        ));
    }
    let repository_identity = github::inspect_repository(repository_root)?;
    if repository_identity.visibility == GitHubRepositoryVisibility::Private
        && config.updater.enabled
    {
        return Err(AppError::validation_with_code(
            "Tauri Updater is not supported for private repositories in this release",
            "tauri_private_repository_updater_unsupported",
        ));
    }
    let (current_branch, head_sha) =
        ensure_clean_and_synced(repository_root, &repository_identity.default_branch)?;
    let inspection = project::inspect_repository(repository_root)?;
    let app = inspection
        .apps
        .iter()
        .find(|app| app.config_path == config.app_config_path)
        .ok_or_else(|| {
            AppError::provider_with_code(
                format!("bound Tauri app not found: {}", config.app_config_path),
                "tauri_app_binding_missing",
            )
        })?;
    if app.build_driver != config.build_driver {
        return Err(AppError::provider_with_code(
            "configured Tauri build driver has drifted",
            "tauri_build_driver_drift",
        ));
    }
    versioning::validate_current_versions(
        repository_root,
        config,
        &app.version_source,
        &app.version_source.version,
    )?;
    let version = validate_version(requested_version, &app.version_source.version)?;
    let tag = format!("{}{}", config.tag_prefix, version);
    ensure_remote_identity_available(repository_root, &tag, &repository_identity.name_with_owner)?;
    let previous_tag = previous_stable_tag(repository_root, &config.tag_prefix)?;
    ensure_newer_than_previous_tag(&version, previous_tag.as_deref(), &config.tag_prefix)?;
    let release_notes = generate_release_notes(repository_root, previous_tag.as_deref())?;

    let available_secrets =
        github::actions_secret_names(repository_root, &repository_identity.name_with_owner)?
            .into_iter()
            .collect::<BTreeSet<_>>();
    let mut required_secrets = config
        .required_actions_secret_names
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    if let Some(secret) = config.updater.private_key_secret_name.as_ref() {
        required_secrets.insert(secret.clone());
    }
    required_secrets.extend(config.actions_secret_environment.values().cloned());
    let missing_secret_names = required_secrets
        .difference(&available_secrets)
        .cloned()
        .collect::<Vec<_>>();
    if !missing_secret_names.is_empty() {
        return Err(AppError::validation_with_code(
            format!(
                "missing GitHub Actions secrets: {}",
                missing_secret_names.join(", ")
            ),
            "tauri_release_secrets_missing",
        ));
    }

    let mut warnings = Vec::new();
    if config.allow_unsigned_release {
        warnings.push(
            "This repository explicitly allows releases without verified platform code signing."
                .to_string(),
        );
    }
    let mut identity = Sha256::new();
    identity.update(repository_id.as_bytes());
    identity.update(head_sha.as_bytes());
    identity.update(workflow_preview.preview_id.as_bytes());
    identity.update(version.as_bytes());
    identity.update(release_notes.as_bytes());

    Ok(TauriReleasePreflight {
        preflight_id: hex::encode(identity.finalize()),
        repository_id: repository_id.to_string(),
        repository_identity,
        head_sha,
        current_branch,
        current_version: app.version_source.version.clone(),
        version,
        tag,
        previous_tag,
        release_notes,
        workflow_status: workflow_preview.status,
        missing_secret_names,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_version_must_advance_current_version() {
        let error = validate_version("1.2.3", "1.2.3").expect_err("same version");
        assert_eq!(
            error.code.as_deref(),
            Some("tauri_release_version_not_newer")
        );
        let error = validate_version("1.3.0-beta.1", "1.2.3").expect_err("prerelease");
        assert_eq!(
            error.code.as_deref(),
            Some("tauri_release_version_not_stable")
        );
        assert_eq!(validate_version("1.3.0", "1.2.3").expect("newer"), "1.3.0");
    }

    #[test]
    fn only_known_not_found_responses_mean_release_is_available() {
        assert!(is_missing_release_error("release not found"));
        assert!(is_missing_release_error("GraphQL: HTTP 404"));
        assert!(is_missing_release_error(
            "Could not resolve to a Release with the name 'v1.2.3'"
        ));
        assert!(!is_missing_release_error(
            "HTTP 403: Resource not accessible"
        ));
        assert!(!is_missing_release_error("network connection reset"));
    }

    #[test]
    fn release_version_must_advance_latest_stable_tag() {
        let error = ensure_newer_than_previous_tag("1.3.0", Some("v2.0.0"), "v")
            .expect_err("older than latest tag");
        assert_eq!(
            error.code.as_deref(),
            Some("tauri_release_version_not_newer_than_tag")
        );
        ensure_newer_than_previous_tag("2.0.1", Some("v2.0.0"), "v")
            .expect("newer than latest tag");
    }
}
