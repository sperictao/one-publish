use super::{github, storage, ReleaseAttempt, ReleaseAttemptStage, MANAGED_WORKFLOW_PATH};
use crate::errors::AppError;
use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkflowRun {
    database_id: u64,
    url: String,
    status: String,
    conclusion: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkflowJob {
    name: String,
    conclusion: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkflowRunView {
    url: String,
    status: String,
    conclusion: String,
    #[serde(default)]
    jobs: Vec<WorkflowJob>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseView {
    url: String,
    is_draft: bool,
    #[serde(default)]
    assets: Vec<ReleaseAsset>,
}

#[derive(Debug, Deserialize)]
struct ReleaseAsset {
    name: String,
}

fn attempt_not_found(attempt_id: &str) -> AppError {
    AppError::publish_with_code(
        format!("release attempt not found: {attempt_id}"),
        "tauri_release_attempt_not_found",
    )
}

fn repository_root(attempt: &ReleaseAttempt) -> Result<String, AppError> {
    crate::store::get_state()
        .repositories
        .iter()
        .find(|repository| repository.id == attempt.repository_id)
        .map(|repository| repository.path.clone())
        .ok_or_else(|| {
            AppError::validation_with_code(
                format!("repository not found: {}", attempt.repository_id),
                "repository_not_found",
            )
        })
}

fn parse_runs(json: &str) -> Result<Vec<WorkflowRun>, AppError> {
    serde_json::from_str(json).map_err(|error| {
        AppError::external_command_with_code(
            format!("failed to parse gh run list output: {error}"),
            "tauri_github_response_invalid",
        )
    })
}

fn discover_run(
    repository_root: &Path,
    attempt: &ReleaseAttempt,
) -> Result<Option<WorkflowRun>, AppError> {
    let commit_sha = attempt.release_commit_sha.as_deref().ok_or_else(|| {
        AppError::publish_with_code(
            "release attempt has no pushed commit to monitor",
            "tauri_release_commit_missing",
        )
    })?;
    let json = github::require_success(
        "gh",
        &[
            "run",
            "list",
            "--repo",
            &attempt.repository_identity,
            "--workflow",
            Path::new(MANAGED_WORKFLOW_PATH)
                .file_name()
                .and_then(|name| name.to_str())
                .expect("managed workflow has a file name"),
            "--commit",
            commit_sha,
            "--json",
            "databaseId,url,status,conclusion",
            "--limit",
            "20",
        ],
        repository_root,
    )?;
    Ok(parse_runs(&json)?.into_iter().next())
}

fn view_run(
    repository_root: &Path,
    attempt: &ReleaseAttempt,
    run_id: &str,
) -> Result<WorkflowRunView, AppError> {
    let json = github::require_success(
        "gh",
        &[
            "run",
            "view",
            run_id,
            "--repo",
            &attempt.repository_identity,
            "--json",
            "url,status,conclusion,jobs",
        ],
        repository_root,
    )?;
    serde_json::from_str(&json).map_err(|error| {
        AppError::external_command_with_code(
            format!("failed to parse gh run view output: {error}"),
            "tauri_github_response_invalid",
        )
    })
}

fn release_view(repository_root: &Path, attempt: &ReleaseAttempt) -> Result<ReleaseView, AppError> {
    let json = github::require_success(
        "gh",
        &[
            "release",
            "view",
            &attempt.tag,
            "--repo",
            &attempt.repository_identity,
            "--json",
            "url,isDraft,assets",
        ],
        repository_root,
    )?;
    let release: ReleaseView = serde_json::from_str(&json).map_err(|error| {
        AppError::external_command_with_code(
            format!("failed to parse gh release view output: {error}"),
            "tauri_github_response_invalid",
        )
    })?;
    if release.is_draft {
        return Err(AppError::publish_with_code(
            format!("GitHub Release {} is still a draft", attempt.tag),
            "tauri_release_not_published",
        ));
    }
    Ok(release)
}

fn failure_summary(run: &WorkflowRunView) -> String {
    let failed = run
        .jobs
        .iter()
        .filter(|job| !matches!(job.conclusion.as_str(), "success" | "skipped" | ""))
        .map(|job| format!("{} ({})", job.name, job.conclusion))
        .collect::<Vec<_>>();
    if failed.is_empty() {
        format!(
            "GitHub Actions finished with conclusion '{}'",
            run.conclusion
        )
    } else {
        format!("GitHub Actions failed: {}", failed.join(", "))
    }
}

pub(crate) fn refresh(attempt_id: &str) -> Result<ReleaseAttempt, AppError> {
    let mut attempt =
        storage::get_attempt(attempt_id)?.ok_or_else(|| attempt_not_found(attempt_id))?;
    if attempt.stage != ReleaseAttemptStage::MonitoringWorkflow {
        return Ok(attempt);
    }
    let repository_root = repository_root(&attempt)?;
    let repository_root = Path::new(&repository_root);

    if attempt.workflow_run_id.is_none() {
        let Some(run) = discover_run(repository_root, &attempt)? else {
            return Ok(attempt);
        };
        attempt.workflow_run_id = Some(run.database_id.to_string());
        attempt.actions_url = Some(run.url);
        if run.status == "completed" && run.conclusion != "success" {
            attempt.stage = ReleaseAttemptStage::Failed;
            attempt.retry_reason = Some(format!(
                "GitHub Actions finished with conclusion '{}'",
                run.conclusion
            ));
        }
    }

    if attempt.stage == ReleaseAttemptStage::MonitoringWorkflow {
        let run = view_run(
            repository_root,
            &attempt,
            attempt
                .workflow_run_id
                .as_deref()
                .expect("workflow run id was discovered"),
        )?;
        attempt.actions_url = Some(run.url.clone());
        if run.status == "completed" {
            if run.conclusion == "success" {
                let release = release_view(repository_root, &attempt)?;
                attempt.release_url = Some(release.url);
                attempt.release_asset_names =
                    release.assets.into_iter().map(|asset| asset.name).collect();
                attempt.stage = ReleaseAttemptStage::Published;
                attempt.retry_reason = None;
            } else {
                attempt.stage = ReleaseAttemptStage::Failed;
                attempt.retry_reason = Some(failure_summary(&run));
            }
        }
    }

    attempt.updated_at = chrono::Utc::now().to_rfc3339();
    storage::update_attempt(attempt)
}

pub(crate) fn cancel(attempt_id: &str) -> Result<ReleaseAttempt, AppError> {
    let mut attempt =
        storage::get_attempt(attempt_id)?.ok_or_else(|| attempt_not_found(attempt_id))?;
    if attempt.stage.is_terminal() {
        return Ok(attempt);
    }
    if attempt.stage == ReleaseAttemptStage::MonitoringWorkflow {
        attempt = refresh(attempt_id)?;
        if attempt.stage != ReleaseAttemptStage::MonitoringWorkflow {
            return Ok(attempt);
        }
        let run_id = attempt.workflow_run_id.clone().ok_or_else(|| {
            AppError::publish_with_code(
                "the pushed workflow run is not visible yet; refresh before cancelling",
                "tauri_release_workflow_run_pending",
            )
        })?;
        let repository_root = repository_root(&attempt)?;
        github::require_success(
            "gh",
            &[
                "run",
                "cancel",
                &run_id,
                "--repo",
                &attempt.repository_identity,
            ],
            Path::new(&repository_root),
        )?;
    }
    attempt.stage = ReleaseAttemptStage::Cancelled;
    attempt.updated_at = chrono::Utc::now().to_rfc3339();
    storage::update_attempt(attempt)
}

pub(crate) fn retry(attempt_id: &str) -> Result<ReleaseAttempt, AppError> {
    let mut attempt =
        storage::get_attempt(attempt_id)?.ok_or_else(|| attempt_not_found(attempt_id))?;
    if attempt.stage != ReleaseAttemptStage::Failed {
        return Err(AppError::publish_with_code(
            "only a failed GitHub Actions run can be retried",
            "tauri_release_retry_unavailable",
        ));
    }
    if storage::list_attempts(Some(&attempt.repository_id))?
        .iter()
        .any(|other| other.id != attempt.id && !other.stage.is_terminal())
    {
        return Err(AppError::publish_with_code(
            "another GitHub release attempt is already active for this repository",
            "tauri_release_attempt_active",
        ));
    }
    let run_id = attempt.workflow_run_id.clone().ok_or_else(|| {
        AppError::publish_with_code(
            "this release failed before GitHub Actions started and cannot be rerun",
            "tauri_release_retry_unavailable",
        )
    })?;
    let repository_root = repository_root(&attempt)?;
    github::require_success(
        "gh",
        &[
            "run",
            "rerun",
            &run_id,
            "--failed",
            "--repo",
            &attempt.repository_identity,
        ],
        Path::new(&repository_root),
    )?;
    attempt.stage = ReleaseAttemptStage::MonitoringWorkflow;
    attempt.retry_reason = None;
    attempt.updated_at = chrono::Utc::now().to_rfc3339();
    storage::update_attempt(attempt)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_run_list_for_cross_restart_discovery() {
        let runs = parse_runs(
            r#"[{"databaseId":42,"url":"https://github.com/acme/app/actions/runs/42","status":"in_progress","conclusion":""}]"#,
        )
        .expect("parse runs");

        assert_eq!(runs[0].database_id, 42);
        assert_eq!(runs[0].status, "in_progress");
    }

    #[test]
    fn summarizes_failed_jobs() {
        let run = WorkflowRunView {
            url: String::new(),
            status: "completed".to_string(),
            conclusion: "failure".to_string(),
            jobs: vec![WorkflowJob {
                name: "build (macos)".to_string(),
                conclusion: "failure".to_string(),
            }],
        };

        assert_eq!(
            failure_summary(&run),
            "GitHub Actions failed: build (macos) (failure)"
        );
    }
}
