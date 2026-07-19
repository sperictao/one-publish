use super::{ManagedWorkflowPreview, WorkflowTakeoverResult, MANAGED_WORKFLOW_PATH};
use crate::errors::AppError;
use std::path::Path;
use std::process::Output;

fn git(repository_root: &Path, args: &[&str]) -> Result<Output, AppError> {
    crate::process_utils::new_std_command("git")
        .arg("-C")
        .arg(repository_root)
        .args(args)
        .output()
        .map_err(|error| {
            AppError::external_command_with_code(
                format!("failed to run git {}: {error}", args.join(" ")),
                "tauri_workflow_git_failed",
            )
        })
}

fn successful_git(repository_root: &Path, args: &[&str]) -> Result<String, AppError> {
    let output = git(repository_root, args)?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(AppError::external_command_with_code(
        if stderr.is_empty() {
            format!("git {} failed with {}", args.join(" "), output.status)
        } else {
            stderr
        },
        "tauri_workflow_git_failed",
    ))
}

fn ensure_clean(repository_root: &Path) -> Result<(), AppError> {
    let status = successful_git(repository_root, &["status", "--porcelain=v1"])?;
    if status.is_empty() {
        return Ok(());
    }
    Err(AppError::repository_with_code(
        format!("workflow onboarding requires a clean worktree:\n{status}"),
        "tauri_workflow_worktree_dirty",
    ))
}

fn current_branch(repository_root: &Path) -> Result<String, AppError> {
    successful_git(repository_root, &["branch", "--show-current"]).and_then(|branch| {
        if branch.is_empty() {
            Err(AppError::repository_with_code(
                "workflow onboarding cannot run from detached HEAD",
                "tauri_workflow_detached_head",
            ))
        } else {
            Ok(branch)
        }
    })
}

fn default_branch(repository_root: &Path) -> Result<String, AppError> {
    let symbolic = git(
        repository_root,
        &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    )?;
    if symbolic.status.success() {
        let value = String::from_utf8_lossy(&symbolic.stdout).trim().to_string();
        if let Some(branch) = value.strip_prefix("origin/") {
            if !branch.is_empty() {
                return Ok(branch.to_string());
            }
        }
    }

    let remote = successful_git(repository_root, &["remote", "show", "origin"])?;
    remote
        .lines()
        .find_map(|line| line.trim().strip_prefix("HEAD branch:").map(str::trim))
        .filter(|branch| !branch.is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            AppError::repository_with_code(
                "cannot determine the origin default branch",
                "tauri_workflow_default_branch_unknown",
            )
        })
}

fn ensure_synced_default_branch(
    repository_root: &Path,
    default_branch: &str,
) -> Result<(), AppError> {
    successful_git(repository_root, &["fetch", "origin", default_branch])?;
    let counts = successful_git(
        repository_root,
        &[
            "rev-list",
            "--left-right",
            "--count",
            &format!("HEAD...origin/{default_branch}"),
        ],
    )?;
    if counts.split_whitespace().eq(["0", "0"]) {
        return Ok(());
    }
    Err(AppError::repository_with_code(
        format!("default branch is not synchronized with origin/{default_branch}: {counts}"),
        "tauri_workflow_branch_not_synced",
    ))
}

pub(crate) fn apply_preview_files(
    repository_root: &Path,
    preview: &ManagedWorkflowPreview,
) -> Result<Vec<String>, AppError> {
    let workflow_path = repository_root.join(MANAGED_WORKFLOW_PATH);
    if let Some(parent) = workflow_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            AppError::repository_with_code(
                format!("failed to create {}: {error}", parent.display()),
                "tauri_workflow_write_failed",
            )
        })?;
    }
    std::fs::write(&workflow_path, &preview.expected_content).map_err(|error| {
        AppError::repository_with_code(
            format!("failed to write {}: {error}", workflow_path.display()),
            "tauri_workflow_write_failed",
        )
    })?;

    let removed = preview
        .conflicts
        .iter()
        .map(|conflict| conflict.path.clone())
        .collect::<Vec<_>>();
    for relative in &removed {
        let path = repository_root.join(relative);
        if path.is_file() {
            std::fs::remove_file(&path).map_err(|error| {
                AppError::repository_with_code(
                    format!(
                        "failed to remove conflicting workflow {}: {error}",
                        path.display()
                    ),
                    "tauri_workflow_remove_conflict_failed",
                )
            })?;
        }
    }
    Ok(removed)
}

pub fn apply(
    repository_root: &Path,
    preview: &ManagedWorkflowPreview,
) -> Result<WorkflowTakeoverResult, AppError> {
    ensure_clean(repository_root)?;
    let branch = current_branch(repository_root)?;
    let expected_branch = default_branch(repository_root)?;
    if branch != expected_branch {
        return Err(AppError::repository_with_code(
            format!(
                "workflow onboarding must run on origin default branch '{expected_branch}', current branch is '{branch}'"
            ),
            "tauri_workflow_default_branch_required",
        ));
    }
    ensure_synced_default_branch(repository_root, &expected_branch)?;

    let removed_conflicts = apply_preview_files(repository_root, preview)?;
    let mut paths = vec![MANAGED_WORKFLOW_PATH.to_string()];
    paths.extend(removed_conflicts.iter().cloned());
    let mut add_args = vec!["add", "--"];
    add_args.extend(paths.iter().map(String::as_str));
    successful_git(repository_root, &add_args)?;
    successful_git(
        repository_root,
        &[
            "commit",
            "-m",
            "chore(release): onboard One Publish Tauri workflow",
        ],
    )?;
    let commit_sha = successful_git(repository_root, &["rev-parse", "HEAD"])?;
    successful_git(
        repository_root,
        &["push", "origin", &format!("HEAD:{expected_branch}")],
    )?;

    Ok(WorkflowTakeoverResult {
        workflow_path: MANAGED_WORKFLOW_PATH.to_string(),
        removed_conflicts,
        commit_sha,
        pushed_branch: expected_branch,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tauri_release::{ManagedWorkflowStatus, WorkflowConflict};

    #[test]
    fn apply_preview_writes_managed_workflow_and_removes_only_confirmed_conflicts() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let workflow_dir = temp_dir.path().join(".github/workflows");
        std::fs::create_dir_all(&workflow_dir).expect("create workflows");
        std::fs::write(workflow_dir.join("legacy.yml"), "legacy").expect("write legacy");
        std::fs::write(workflow_dir.join("quality.yml"), "quality").expect("write quality");
        let preview = ManagedWorkflowPreview {
            preview_id: "preview".to_string(),
            path: MANAGED_WORKFLOW_PATH.to_string(),
            status: ManagedWorkflowStatus::Missing,
            expected_content: "name: managed\n".to_string(),
            current_content: None,
            diff: String::new(),
            conflicts: vec![WorkflowConflict {
                path: ".github/workflows/legacy.yml".to_string(),
                reason: "release conflict".to_string(),
            }],
        };

        let removed = apply_preview_files(temp_dir.path(), &preview).expect("apply files");

        assert_eq!(removed, vec![".github/workflows/legacy.yml"]);
        assert_eq!(
            std::fs::read_to_string(temp_dir.path().join(MANAGED_WORKFLOW_PATH))
                .expect("read managed"),
            "name: managed\n"
        );
        assert!(!workflow_dir.join("legacy.yml").exists());
        assert!(workflow_dir.join("quality.yml").exists());
    }
}
