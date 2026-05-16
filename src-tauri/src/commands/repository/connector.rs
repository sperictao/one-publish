use crate::store::Branch;
use std::io::ErrorKind as IoErrorKind;
use std::path::PathBuf;
use tokio::time::{timeout, Duration};

use super::*;

pub fn format_git_command_failure(command: &str, stderr: &[u8]) -> String {
    let error = String::from_utf8_lossy(stderr).trim().to_string();

    if error.is_empty() {
        return format!("git {} command failed", command);
    }

    format!("git {} command failed: {}", command, error)
}

pub fn classify_repository_path_error(kind: IoErrorKind) -> &'static str {
    match kind {
        IoErrorKind::NotFound => "path_not_found",
        IoErrorKind::NotADirectory => "not_directory",
        IoErrorKind::PermissionDenied => "permission_denied",
        _ => "read_failed",
    }
}

pub fn classify_git_execution_error(kind: IoErrorKind) -> &'static str {
    match kind {
        IoErrorKind::NotFound => "git_missing",
        IoErrorKind::PermissionDenied => "permission_denied",
        _ => "unknown",
    }
}

pub fn classify_git_branch_scan_error(stderr: &str) -> &'static str {
    let normalized = stderr.to_lowercase();

    if normalized.contains("not a git repository")
        || normalized.contains("不是 git 仓库")
        || normalized.contains("不是一个git仓库")
    {
        return "not_git_repo";
    }

    if normalized.contains("detected dubious ownership") {
        return "dubious_ownership";
    }

    if normalized.contains("permission denied")
        || normalized.contains("operation not permitted")
        || normalized.contains("访问被拒绝")
        || normalized.contains("权限")
    {
        return "permission_denied";
    }

    if normalized.contains("unable to access")
        || normalized.contains("failed to connect")
        || normalized.contains("could not resolve host")
        || normalized.contains("connection timed out")
        || normalized.contains("connection refused")
        || normalized.contains("unable to connect")
        || normalized.contains("unable to look up")
        || normalized.contains("couldn't connect to server")
        || normalized.contains("network is unreachable")
        || normalized.contains("could not read from remote repository")
        || normalized.contains("could not read username")
        || normalized.contains("authentication failed")
        || normalized.contains("publickey")
        || normalized.contains("repository not found")
        || normalized.contains("proxy connect aborted")
        || normalized.contains("无法连接")
        || normalized.contains("连接超时")
        || normalized.contains("连接被拒绝")
        || normalized.contains("无法访问远程仓库")
        || normalized.contains("无法从远程仓库读取")
        || normalized.contains("无法解析主机")
        || normalized.contains("网络不可达")
    {
        return "cannot_connect_repo";
    }

    "unknown"
}

#[tauri::command]
pub async fn check_repository_branch_connectivity(
    path: String,
    current_branch: Option<String>,
) -> RepositoryBranchConnectivityResult {
    let _timer = crate::commands::middleware::CommandTimer::new("commands::repository::connector::check_repository_branch_connectivity");
    let repo_path = PathBuf::from(&path);

    if !repo_path.exists() || !repo_path.is_dir() {
        return RepositoryBranchConnectivityResult { can_connect: false };
    }

    let mut branch_name = current_branch
        .map(|branch| branch.trim().to_string())
        .unwrap_or_default();

    if branch_name.is_empty() {
        let head_output = match crate::process_utils::new_tokio_command("git")
            .arg("-C")
            .arg(&path)
            .arg("rev-parse")
            .arg("--abbrev-ref")
            .arg("HEAD")
            .output()
            .await
        {
            Ok(output) if output.status.success() => output,
            _ => return RepositoryBranchConnectivityResult { can_connect: false },
        };

        branch_name = String::from_utf8_lossy(&head_output.stdout)
            .trim()
            .to_string();
    }

    if branch_name.is_empty() || branch_name == "HEAD" {
        return RepositoryBranchConnectivityResult { can_connect: false };
    }

    let upstream_output = match crate::process_utils::new_tokio_command("git")
        .arg("-C")
        .arg(&path)
        .arg("rev-parse")
        .arg("--abbrev-ref")
        .arg("--symbolic-full-name")
        .arg(format!("{}@{{upstream}}", branch_name))
        .output()
        .await
    {
        Ok(output) if output.status.success() => output,
        _ => return RepositoryBranchConnectivityResult { can_connect: false },
    };

    let upstream = String::from_utf8_lossy(&upstream_output.stdout)
        .trim()
        .to_string();
    let Some((remote, remote_branch)) = upstream.split_once('/') else {
        return RepositoryBranchConnectivityResult { can_connect: false };
    };

    if remote.is_empty() || remote_branch.is_empty() {
        return RepositoryBranchConnectivityResult { can_connect: false };
    }

    let remote_branch_ref = format!("refs/heads/{}", remote_branch);
    let ls_remote_output = match timeout(
        Duration::from_secs(5),
        crate::process_utils::new_tokio_command("git")
            .arg("-C")
            .arg(&path)
            .arg("ls-remote")
            .arg("--exit-code")
            .arg("--heads")
            .arg(remote)
            .arg(&remote_branch_ref)
            .output(),
    )
    .await
    {
        Ok(Ok(output)) => output,
        _ => return RepositoryBranchConnectivityResult { can_connect: false },
    };

    RepositoryBranchConnectivityResult {
        can_connect: ls_remote_output.status.success() && !ls_remote_output.stdout.is_empty(),
    }
}

async fn scan_repository_branches_internal(
    path: String,
    refresh_remote: bool,
) -> Result<RepositoryBranchScanResult, crate::errors::AppError> {
    let repo_path = PathBuf::from(&path);

    if !repo_path.exists() {
        return Err(repository_error(
            format!("repository path does not exist: {}", path),
            "path_not_found",
        ));
    }

    if !repo_path.is_dir() {
        return Err(repository_error(
            format!("repository path is not a directory: {}", path),
            "not_directory",
        ));
    }

    let remote_output = timeout(
        Duration::from_secs(5),
        crate::process_utils::new_tokio_command("git")
            .arg("-C")
            .arg(&path)
            .arg("remote")
            .output(),
    )
    .await
    .map_err(|_| repository_error("git remote timed out after 5s", "timeout"))?
    .map_err(|err| {
        repository_error(
            format!("failed to execute git remote: {}", err),
            classify_git_execution_error(err.kind()),
        )
    })?;

    if !remote_output.status.success() {
        let stderr = String::from_utf8_lossy(&remote_output.stderr)
            .trim()
            .to_string();
        return Err(repository_error(
            format_git_command_failure("remote", &remote_output.stderr),
            classify_git_branch_scan_error(&stderr),
        ));
    }

    let has_remote = String::from_utf8_lossy(&remote_output.stdout)
        .lines()
        .any(|line| !line.trim().is_empty());

    if refresh_remote && has_remote {
        let fetch_output = timeout(
            Duration::from_secs(5),
            crate::process_utils::new_tokio_command("git")
                .arg("-C")
                .arg(&path)
                .arg("fetch")
                .arg("--all")
                .arg("--prune")
                .output(),
        )
        .await
        .map_err(|_| repository_error("git fetch timed out after 5s", "timeout"))?
        .map_err(|err| {
            repository_error(
                format!("failed to execute git fetch: {}", err),
                classify_git_execution_error(err.kind()),
            )
        })?;

        if !fetch_output.status.success() {
            let stderr = String::from_utf8_lossy(&fetch_output.stderr)
                .trim()
                .to_string();
            return Err(repository_error(
                format_git_command_failure("fetch", &fetch_output.stderr),
                classify_git_branch_scan_error(&stderr),
            ));
        }
    }

    let output = timeout(
        Duration::from_secs(5),
        crate::process_utils::new_tokio_command("git")
            .arg("-C")
            .arg(&path)
            .arg("branch")
            .arg("--list")
            .arg("--no-color")
            .output(),
    )
    .await
    .map_err(|_| repository_error("git branch timed out after 5s", "timeout"))?
    .map_err(|err| {
        repository_error(
            format!("failed to execute git branch: {}", err),
            classify_git_execution_error(err.kind()),
        )
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(repository_error(
            format_git_command_failure("branch", &output.stderr),
            classify_git_branch_scan_error(&stderr),
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut branches: Vec<Branch> = stdout
        .lines()
        .filter_map(|line| {
            let raw = line.trim();
            if raw.is_empty() {
                return None;
            }

            let is_current = raw.starts_with('*');
            let name = raw.trim_start_matches('*').trim().to_string();
            if name.is_empty() {
                return None;
            }

            Some(Branch {
                is_main: matches!(name.as_str(), "main" | "master"),
                is_current,
                path: path.clone(),
                name,
                commit_count: None,
            })
        })
        .collect();

    if branches.is_empty() {
        return Err(repository_error(
            "no git branches found in repository",
            "no_branches",
        ));
    }

    let mut current_branch = branches
        .iter()
        .find(|branch| branch.is_current)
        .map(|branch| branch.name.clone())
        .unwrap_or_default();

    if current_branch.is_empty() {
        let head_output = timeout(
            Duration::from_secs(5),
            crate::process_utils::new_tokio_command("git")
                .arg("-C")
                .arg(&path)
                .arg("rev-parse")
                .arg("--abbrev-ref")
                .arg("HEAD")
                .output(),
        )
        .await
        .map_err(|_| repository_error("git rev-parse timed out after 5s", "timeout"))?
        .map_err(|err| {
            repository_error(
                format!("failed to detect current branch: {}", err),
                classify_git_execution_error(err.kind()),
            )
        })?;

        if head_output.status.success() {
            current_branch = String::from_utf8_lossy(&head_output.stdout)
                .trim()
                .to_string();
        }
    }

    if current_branch.is_empty() {
        current_branch = branches[0].name.clone();
    }

    for branch in branches.iter_mut() {
        branch.is_current = branch.name == current_branch;
    }

    Ok(RepositoryBranchScanResult {
        branches,
        current_branch,
    })
}

#[tauri::command]
pub async fn scan_repository_branches(
    path: String,
    refresh_remote: Option<bool>,
) -> Result<RepositoryBranchScanResult, crate::errors::AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new("commands::repository::connector::scan_repository_branches");
    scan_repository_branches_internal(path, refresh_remote.unwrap_or(true)).await
}