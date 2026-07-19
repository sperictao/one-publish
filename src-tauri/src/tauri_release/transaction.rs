use super::{
    github, preflight, project, storage, versioning, ReleaseAttempt, ReleaseAttemptStage,
    StartTauriGithubReleaseRequest, TauriReleaseConfig,
};
use crate::errors::AppError;
use std::collections::BTreeSet;
use std::path::Path;
use std::process::Stdio;

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn attempt_id(repository_id: &str, tag: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("{repository_id}-{tag}-{nanos}")
}

fn update_stage(attempt: &mut ReleaseAttempt, stage: ReleaseAttemptStage) -> Result<(), AppError> {
    attempt.stage = stage;
    attempt.updated_at = now();
    storage::update_attempt(attempt.clone())?;
    Ok(())
}

fn fail_attempt(
    attempt: &mut ReleaseAttempt,
    message: impl Into<String>,
) -> Result<ReleaseAttempt, AppError> {
    attempt.stage = ReleaseAttemptStage::Failed;
    attempt.retry_reason = Some(message.into());
    attempt.updated_at = now();
    storage::update_attempt(attempt.clone())
}

fn cancellation_requested(attempt_id: &str) -> Result<bool, AppError> {
    Ok(storage::get_attempt(attempt_id)?
        .map(|attempt| attempt.stage == ReleaseAttemptStage::Cancelled)
        .unwrap_or(false))
}

fn record_attempt_failure(attempt: &mut ReleaseAttempt, message: impl Into<String>) {
    if let Err(error) = fail_attempt(attempt, message) {
        log::error!("failed to persist Tauri release attempt failure: {error}");
    }
}

async fn run_gate(repository_root: &Path, gate: &super::ReleaseGate) -> Result<(), AppError> {
    let output = crate::process_utils::new_tokio_command(&gate.program)
        .args(&gate.args)
        .current_dir(repository_root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|error| {
            AppError::external_command_with_code(
                format!("failed to start release gate '{}': {error}", gate.program),
                "tauri_release_gate_spawn_failed",
            )
        })?;
    if output.status.success() {
        return Ok(());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(AppError::publish_with_code(
        format!(
            "release gate failed: {} {}\n{}{}",
            gate.program,
            gate.args.join(" "),
            stdout,
            stderr
        ),
        "tauri_release_gate_failed",
    ))
}

fn changed_paths(repository_root: &Path) -> Result<BTreeSet<String>, AppError> {
    let output = github::run(
        "git",
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        repository_root,
    )?;
    if !output.status.success() {
        return Err(AppError::external_command_with_code(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
            "tauri_release_external_command_failed",
        ));
    }
    let status = String::from_utf8_lossy(&output.stdout);
    let mut entries = status.split('\0').filter(|entry| !entry.is_empty());
    let mut paths = BTreeSet::new();
    while let Some(entry) = entries.next() {
        let code = entry.get(..2).unwrap_or("");
        if let Some(path) = entry.get(3..) {
            paths.insert(path.to_string());
        }
        if code.contains('R') || code.contains('C') {
            let _original_path = entries.next();
        }
    }
    Ok(paths)
}

fn rollback_before_push(
    repository_root: &Path,
    original_head: &str,
    tag: &str,
    mutations: &[versioning::FileMutation],
) {
    if let Ok(output) = github::run("git", &["tag", "--delete", tag], repository_root) {
        if !output.status.success() {
            log::debug!("release rollback did not delete tag {tag}; it was not created locally");
        }
    }
    let current_head = match github::require_success("git", &["rev-parse", "HEAD"], repository_root)
    {
        Ok(current_head) => current_head,
        Err(error) => {
            log::error!("failed to inspect HEAD during Tauri release rollback: {error}");
            String::new()
        }
    };
    if !current_head.is_empty() && current_head != original_head {
        if let Err(error) =
            github::require_success("git", &["reset", "--mixed", original_head], repository_root)
        {
            log::error!("failed to reset release commit during rollback: {error}");
        }
    }
    let paths = mutations
        .iter()
        .map(|mutation| mutation.relative_path.as_str())
        .collect::<Vec<_>>();
    if !paths.is_empty() {
        let mut args = vec!["reset", "--"];
        args.extend(paths);
        if let Err(error) = github::require_success("git", &args, repository_root) {
            log::error!("failed to unstage release files during rollback: {error}");
        }
    }
    if let Err(error) = versioning::restore_unchanged(mutations) {
        log::error!("failed to restore release files during rollback: {error}");
    }
}

pub async fn start(
    repository_id: &str,
    repository_root: &Path,
    config: &TauriReleaseConfig,
    request: StartTauriGithubReleaseRequest,
) -> Result<ReleaseAttempt, AppError> {
    let checked = preflight::prepare(repository_id, repository_root, config, &request.version)?;
    if checked.preflight_id != request.preflight_id {
        return Err(AppError::validation_with_code(
            "repository state changed after release preflight; run preflight again",
            "tauri_release_preflight_stale",
        ));
    }
    if config.allow_unsigned_release && !request.confirm_unsigned_release {
        return Err(AppError::validation_with_code(
            "unsigned release risk must be confirmed for this repository",
            "tauri_release_unsigned_confirmation_required",
        ));
    }
    if request.release_notes.trim().is_empty() {
        return Err(AppError::validation_with_code(
            "release notes cannot be empty",
            "tauri_release_notes_empty",
        ));
    }

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

    let timestamp = now();
    let mut attempt = ReleaseAttempt {
        id: attempt_id(repository_id, &checked.tag),
        repository_id: repository_id.to_string(),
        repository_identity: checked.repository_identity.name_with_owner.clone(),
        app_config_path: config.app_config_path.clone(),
        version: checked.version.clone(),
        tag: checked.tag.clone(),
        release_commit_sha: None,
        stage: ReleaseAttemptStage::Preparing,
        workflow_run_id: None,
        actions_url: None,
        release_url: None,
        release_asset_names: Vec::new(),
        signing_summary: if config.allow_unsigned_release {
            "unsigned platform release explicitly authorized".to_string()
        } else {
            "platform signing secrets verified by name".to_string()
        },
        updater_summary: if config.updater.enabled {
            "updater enabled; signing secret verified by name".to_string()
        } else {
            "updater disabled".to_string()
        },
        retry_reason: None,
        created_at: timestamp.clone(),
        updated_at: timestamp,
    };
    storage::begin_attempt(attempt.clone())?;
    update_stage(&mut attempt, ReleaseAttemptStage::RunningGates)?;
    let mutations = match versioning::apply(
        repository_root,
        config,
        &app.version_source,
        &checked.current_version,
        &checked.version,
        &checked.tag,
        &request.release_notes,
    ) {
        Ok(mutations) => mutations,
        Err(error) => {
            record_attempt_failure(&mut attempt, error.to_string());
            return Err(error);
        }
    };

    for gate in &config.release_gates {
        if cancellation_requested(&attempt.id)? {
            versioning::restore_unchanged(&mutations)?;
            attempt.stage = ReleaseAttemptStage::Cancelled;
            attempt.updated_at = now();
            return storage::update_attempt(attempt);
        }
        if let Err(error) = run_gate(repository_root, gate).await {
            versioning::restore_unchanged(&mutations)?;
            record_attempt_failure(&mut attempt, error.to_string());
            return Err(error);
        }
    }

    let allowlist = mutations
        .iter()
        .map(|mutation| mutation.relative_path.clone())
        .collect::<BTreeSet<_>>();
    let changed = changed_paths(repository_root)?;
    let unexpected = changed.difference(&allowlist).cloned().collect::<Vec<_>>();
    if !unexpected.is_empty() {
        let message = format!(
            "release gates changed files outside the release commit allowlist: {}",
            unexpected.join(", ")
        );
        record_attempt_failure(&mut attempt, &message);
        return Err(AppError::repository_with_code(
            message,
            "tauri_release_gate_changed_extra_files",
        ));
    }
    if changed != allowlist {
        let missing = allowlist.difference(&changed).cloned().collect::<Vec<_>>();
        versioning::restore_unchanged(&mutations)?;
        let message = format!(
            "release change set is incomplete after gates: {}",
            missing.join(", ")
        );
        record_attempt_failure(&mut attempt, &message);
        return Err(AppError::repository_with_code(
            message,
            "tauri_release_change_set_incomplete",
        ));
    }

    if cancellation_requested(&attempt.id)? {
        versioning::restore_unchanged(&mutations)?;
        attempt.stage = ReleaseAttemptStage::Cancelled;
        attempt.updated_at = now();
        return storage::update_attempt(attempt);
    }
    update_stage(&mut attempt, ReleaseAttemptStage::ReadyToPush)?;

    let paths = allowlist.iter().map(String::as_str).collect::<Vec<_>>();
    let mut add_args = vec!["add", "--"];
    add_args.extend(paths.iter().copied());
    if let Err(error) = github::require_success("git", &add_args, repository_root) {
        rollback_before_push(repository_root, &checked.head_sha, &checked.tag, &mutations);
        record_attempt_failure(&mut attempt, error.to_string());
        return Err(error);
    }
    if let Err(error) = github::require_success(
        "git",
        &[
            "commit",
            "-m",
            &format!("chore(release): publish {}", checked.tag),
        ],
        repository_root,
    ) {
        rollback_before_push(repository_root, &checked.head_sha, &checked.tag, &mutations);
        record_attempt_failure(&mut attempt, error.to_string());
        return Err(error);
    }
    let commit_sha = github::require_success("git", &["rev-parse", "HEAD"], repository_root)?;
    attempt.release_commit_sha = Some(commit_sha.clone());
    if let Err(error) = storage::update_attempt(attempt.clone()) {
        rollback_before_push(repository_root, &checked.head_sha, &checked.tag, &mutations);
        return Err(error);
    }
    if let Err(error) =
        github::require_success("git", &["tag", &checked.tag, &commit_sha], repository_root)
    {
        rollback_before_push(repository_root, &checked.head_sha, &checked.tag, &mutations);
        record_attempt_failure(&mut attempt, error.to_string());
        return Err(error);
    }

    if cancellation_requested(&attempt.id)? {
        rollback_before_push(repository_root, &checked.head_sha, &checked.tag, &mutations);
        attempt.stage = ReleaseAttemptStage::Cancelled;
        attempt.updated_at = now();
        return storage::update_attempt(attempt);
    }

    let push = github::require_success(
        "git",
        &[
            "push",
            "--atomic",
            "origin",
            &format!("HEAD:{}", checked.repository_identity.default_branch),
            &format!("refs/tags/{}", checked.tag),
        ],
        repository_root,
    );
    if let Err(error) = push {
        record_attempt_failure(
            &mut attempt,
            format!(
                "atomic push returned an error; local release commit and tag were retained for diagnosis: {error}"
            ),
        );
        return Err(error);
    }

    update_stage(&mut attempt, ReleaseAttemptStage::MonitoringWorkflow)?;
    Ok(attempt)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn changed_path_parser_preserves_spaces() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        github::require_success("git", &["init"], temp_dir.path()).expect("git init");
        std::fs::write(temp_dir.path().join("release notes.md"), "notes").expect("write file");

        let paths = changed_paths(temp_dir.path()).expect("changed paths");

        assert!(paths.contains("release notes.md"));
    }
}
