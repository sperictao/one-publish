#[cfg(any(windows, test))]
mod local_git;

use crate::store::Branch;
use std::io::ErrorKind as IoErrorKind;
use std::path::PathBuf;
use tokio::time::{timeout, Duration};

use super::*;

/// Git 的 stderr 进 details：未分类（code = unknown）时前端仍能附加原始输出。
pub fn git_command_failure_error(command: &str, stderr: &[u8]) -> crate::errors::AppError {
    let stderr = String::from_utf8_lossy(stderr).trim().to_string();
    let error = repository_error(
        format!("git {command} command failed"),
        classify_git_branch_scan_error(&stderr),
    );

    if stderr.is_empty() {
        error
    } else {
        error.with_details(stderr)
    }
}

/// 启动 git 失败：message 保持静态，底层 IO 错误进 details。
fn git_execution_error(message: &'static str, error: std::io::Error) -> crate::errors::AppError {
    repository_error(message, classify_git_execution_error(error.kind()))
        .with_details(error.to_string())
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
    let _timer = crate::commands::middleware::CommandTimer::new(
        "commands::repository::connector::check_repository_branch_connectivity",
    );
    let repo_path = PathBuf::from(&path);

    if !repo_path.exists() || !repo_path.is_dir() {
        return RepositoryBranchConnectivityResult { can_connect: false };
    }

    // The repository list calls this passively for every repository during app
    // startup. On Windows, never spawn git.exe (or any child console process)
    // for that passive status path. Read HEAD/config directly instead.
    #[cfg(windows)]
    {
        return RepositoryBranchConnectivityResult {
            can_connect: local_git::branch_connectivity(&repo_path, current_branch.as_deref()),
        };
    }

    #[cfg(not(windows))]
    {
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
}

async fn scan_repository_branches_internal(
    path: String,
    refresh_remote: bool,
) -> Result<RepositoryBranchScanResult, crate::errors::AppError> {
    let repo_path = PathBuf::from(&path);

    if !repo_path.exists() {
        return Err(
            repository_error("repository path does not exist", "path_not_found").with_details(path),
        );
    }

    if !repo_path.is_dir() {
        return Err(
            repository_error("repository path is not a directory", "not_directory")
                .with_details(path),
        );
    }

    // `refresh_remote = false` is the passive path used by the repository list
    // on startup/focus and by lightweight add/edit scans. Avoid spawning Git on
    // Windows entirely so opening OnePublish cannot flash terminal windows.
    #[cfg(windows)]
    if !refresh_remote {
        return local_git::scan_repository_branches(&path, &repo_path);
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
    .map_err(|err| git_execution_error("failed to execute git remote", err))?;

    if !remote_output.status.success() {
        return Err(git_command_failure_error("remote", &remote_output.stderr));
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
        .map_err(|err| git_execution_error("failed to execute git fetch", err))?;

        if !fetch_output.status.success() {
            return Err(git_command_failure_error("fetch", &fetch_output.stderr));
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
    .map_err(|err| git_execution_error("failed to execute git branch", err))?;

    if !output.status.success() {
        return Err(git_command_failure_error("branch", &output.stderr));
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
        .map_err(|err| git_execution_error("failed to detect current branch", err))?;

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
    let _timer = crate::commands::middleware::CommandTimer::new(
        "commands::repository::connector::scan_repository_branches",
    );
    scan_repository_branches_internal(path, refresh_remote.unwrap_or(true)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::process::Command;
    use tempfile::TempDir;

    #[test]
    fn classify_repository_path_error_maps_io_kinds() {
        assert_eq!(
            classify_repository_path_error(IoErrorKind::NotFound),
            "path_not_found"
        );
        assert_eq!(
            classify_repository_path_error(IoErrorKind::NotADirectory),
            "not_directory"
        );
        assert_eq!(
            classify_repository_path_error(IoErrorKind::PermissionDenied),
            "permission_denied"
        );
        assert_eq!(
            classify_repository_path_error(IoErrorKind::Other),
            "read_failed"
        );
    }

    #[test]
    fn classify_git_execution_error_maps_spawn_failures() {
        assert_eq!(
            classify_git_execution_error(IoErrorKind::NotFound),
            "git_missing"
        );
        assert_eq!(
            classify_git_execution_error(IoErrorKind::PermissionDenied),
            "permission_denied"
        );
        assert_eq!(classify_git_execution_error(IoErrorKind::Other), "unknown");
    }

    #[test]
    fn classify_git_branch_scan_error_maps_known_stderr() {
        let cases = [
            ("fatal: not a git repository", "not_git_repo"),
            ("fatal: 不是一个git仓库", "not_git_repo"),
            (
                "fatal: detected dubious ownership in repository",
                "dubious_ownership",
            ),
            ("error: Permission denied", "permission_denied"),
            ("fatal: 权限不足", "permission_denied"),
            ("ssh: Could not resolve hostname x", "cannot_connect_repo"),
            ("fatal: connection timed out", "cannot_connect_repo"),
            (
                "fatal: authentication failed for 'x'",
                "cannot_connect_repo",
            ),
            (
                "fatal: publickey authentication required",
                "cannot_connect_repo",
            ),
            ("ERROR: Repository not found.", "cannot_connect_repo"),
            ("fatal: 无法解析主机名", "cannot_connect_repo"),
            ("fatal: 网络不可达", "cannot_connect_repo"),
            ("some unrelated git failure", "unknown"),
        ];
        for (stderr, expected) in cases {
            assert_eq!(
                classify_git_branch_scan_error(stderr),
                expected,
                "stderr: {stderr}"
            );
        }
    }

    #[test]
    fn git_command_failure_error_puts_stderr_in_details_only_when_present() {
        let with_stderr = git_command_failure_error(
            "remote",
            b"fatal: not a git repository (or any parent up to mount point)",
        );
        assert_eq!(with_stderr.code.as_deref(), Some("not_git_repo"));
        assert!(with_stderr
            .details
            .as_deref()
            .is_some_and(|details| details.contains("not a git repository")));

        let empty = git_command_failure_error("branch", b"  \n");
        assert_eq!(empty.code.as_deref(), Some("unknown"));
        assert!(empty.details.is_none());
    }

    fn git(dir: &Path, args: &[&str]) -> std::process::Output {
        Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .expect("spawn git")
    }

    fn commit_empty(repo: &Path) {
        let output = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(["-c", "user.email=test@test", "-c", "user.name=test"])
            .args(["commit", "--allow-empty", "-m", "init"])
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .output()
            .expect("spawn git commit");
        assert!(output.status.success(), "commit failed: {:?}", output);
    }

    /// 本地文件 remote：init bare → seed push → clone，获得一个带 upstream
    /// 追踪且 `ls-remote` 离线可达的工作副本。
    fn cloned_repo(temp: &TempDir) -> (PathBuf, PathBuf) {
        let remote = temp.path().join("remote.git");
        let seed = temp.path().join("seed");
        let work = temp.path().join("work");
        std::fs::create_dir_all(&seed).expect("create seed");

        let init = Command::new("git")
            .args(["init", "--bare"])
            .arg(&remote)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .output()
            .expect("spawn git init --bare");
        assert!(init.status.success());

        git(&seed, &["init", "-b", "main"]);
        commit_empty(&seed);
        git(
            &seed,
            &["remote", "add", "origin", remote.to_str().expect("utf8")],
        );
        git(&seed, &["push", "-u", "origin", "main"]);
        // init --bare 的 HEAD 默认指向 master：未出生的 remote HEAD 会让
        // clone 不带任何本地分支。
        git(&remote, &["symbolic-ref", "HEAD", "refs/heads/main"]);

        let clone = Command::new("git")
            .args(["clone"])
            .arg(&remote)
            .arg(&work)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .expect("spawn git clone");
        assert!(
            clone.status.success(),
            "clone failed: {}",
            String::from_utf8_lossy(&clone.stderr)
        );
        (remote, work)
    }

    #[tokio::test]
    async fn scan_repository_branches_rejects_missing_and_non_directory_paths() {
        let temp = TempDir::new().expect("temp dir");
        let missing = temp.path().join("missing");
        let err = scan_repository_branches_internal(missing.to_string_lossy().to_string(), false)
            .await
            .expect_err("missing path");
        assert_eq!(err.code.as_deref(), Some("path_not_found"));

        let file = temp.path().join("file.txt");
        std::fs::write(&file, "x").expect("write file");
        let err = scan_repository_branches_internal(file.to_string_lossy().to_string(), false)
            .await
            .expect_err("file path");
        assert_eq!(err.code.as_deref(), Some("not_directory"));
    }

    #[tokio::test]
    async fn scan_repository_branches_reports_not_git_repo_for_plain_directory() {
        let temp = TempDir::new().expect("temp dir");
        let err =
            scan_repository_branches_internal(temp.path().to_string_lossy().to_string(), false)
                .await
                .expect_err("plain directory");
        // `git remote` 失败的 stderr 经分类器落到 not_git_repo。
        assert_eq!(err.code.as_deref(), Some("not_git_repo"));
    }

    #[tokio::test]
    async fn scan_repository_branches_reports_no_branches_for_empty_repo() {
        let temp = TempDir::new().expect("temp dir");
        let repo = temp.path().join("repo");
        std::fs::create_dir_all(&repo).expect("create repo");
        git(&repo, &["init", "-b", "main"]);

        let err = scan_repository_branches_internal(repo.to_string_lossy().to_string(), false)
            .await
            .expect_err("empty repo");
        assert_eq!(err.code.as_deref(), Some("no_branches"));
    }

    #[tokio::test]
    async fn scan_repository_branches_lists_branches_with_current_and_main_flags() {
        let temp = TempDir::new().expect("temp dir");
        let (_remote, work) = cloned_repo(&temp);
        git(&work, &["branch", "feature/login"]);

        let result = scan_repository_branches(work.to_string_lossy().to_string(), Some(false))
            .await
            .expect("scan");

        assert_eq!(result.current_branch, "main");
        let main = result
            .branches
            .iter()
            .find(|branch| branch.name == "main")
            .expect("main branch");
        assert!(main.is_current && main.is_main);
        let feature = result
            .branches
            .iter()
            .find(|branch| branch.name == "feature/login")
            .expect("feature branch");
        assert!(!feature.is_current && !feature.is_main);
    }

    #[tokio::test]
    async fn scan_repository_branches_with_refresh_fetches_local_remote() {
        let temp = TempDir::new().expect("temp dir");
        let (_remote, work) = cloned_repo(&temp);

        // refresh_remote=true 会对本地 remote 跑 `git fetch --all --prune`（离线可行）。
        let result = scan_repository_branches(work.to_string_lossy().to_string(), Some(true))
            .await
            .expect("scan with refresh");
        assert_eq!(result.current_branch, "main");
    }

    #[tokio::test]
    async fn scan_repository_branches_detached_head_reports_head_as_current() {
        let temp = TempDir::new().expect("temp dir");
        let (_remote, work) = cloned_repo(&temp);
        git(&work, &["branch", "other"]);
        git(&work, &["checkout", "--detach", "HEAD"]);

        let result = scan_repository_branches(work.to_string_lossy().to_string(), Some(false))
            .await
            .expect("scan detached");

        // detached 态 `git branch` 输出 `* (HEAD detached at <oid>)`——
        // 伪分支名原样成为 current，不做特判。
        assert!(
            result.current_branch.starts_with("(HEAD detached"),
            "current_branch: {}",
            result.current_branch
        );
        assert!(result
            .branches
            .iter()
            .any(|branch| branch.is_current && branch.name == result.current_branch));
    }

    #[tokio::test]
    async fn connectivity_is_false_for_missing_file_and_no_upstream_paths() {
        let temp = TempDir::new().expect("temp dir");
        assert!(
            !check_repository_branch_connectivity(
                temp.path().join("missing").to_string_lossy().to_string(),
                None
            )
            .await
            .can_connect
        );

        let file = temp.path().join("file.txt");
        std::fs::write(&file, "x").expect("write file");
        assert!(
            !check_repository_branch_connectivity(file.to_string_lossy().to_string(), None)
                .await
                .can_connect
        );

        // 有分支但无 upstream 追踪 → rev-parse @{upstream} 失败 → false。
        let repo = temp.path().join("repo");
        std::fs::create_dir_all(&repo).expect("create repo");
        git(&repo, &["init", "-b", "main"]);
        commit_empty(&repo);
        assert!(
            !check_repository_branch_connectivity(
                repo.to_string_lossy().to_string(),
                Some("main".to_string())
            )
            .await
            .can_connect
        );
    }

    #[tokio::test]
    async fn connectivity_is_true_for_branch_tracking_a_reachable_local_remote() {
        let temp = TempDir::new().expect("temp dir");
        let (_remote, work) = cloned_repo(&temp);

        // 完整 happy path：upstream 解析 + `git ls-remote` 本地 remote。
        let result =
            check_repository_branch_connectivity(work.to_string_lossy().to_string(), None).await;
        assert!(result.can_connect);

        // 未知分支无法解析 upstream → false。
        let missing = check_repository_branch_connectivity(
            work.to_string_lossy().to_string(),
            Some("no-such-branch".to_string()),
        )
        .await;
        assert!(!missing.can_connect);

        // detached HEAD → branch_name 为空/"HEAD" → false。
        git(&work, &["checkout", "--detach", "HEAD"]);
        let detached =
            check_repository_branch_connectivity(work.to_string_lossy().to_string(), None).await;
        assert!(!detached.can_connect);
    }
}
