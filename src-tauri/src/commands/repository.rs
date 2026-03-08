use super::ProjectInfo;
use crate::store::Branch;
use serde::Serialize;
use std::io::ErrorKind as IoErrorKind;
use std::path::{Path, PathBuf};
use tokio::process::Command;
use tokio::time::{timeout, Duration};

fn format_git_command_failure(command: &str, stderr: &[u8]) -> String {
    let error = String::from_utf8_lossy(stderr).trim().to_string();

    if error.is_empty() {
        return format!("git {} command failed", command);
    }

    format!("git {} command failed: {}", command, error)
}

fn classify_repository_path_error(kind: IoErrorKind) -> &'static str {
    match kind {
        IoErrorKind::NotFound => "path_not_found",
        IoErrorKind::NotADirectory => "not_directory",
        IoErrorKind::PermissionDenied => "permission_denied",
        _ => "read_failed",
    }
}

fn classify_git_execution_error(kind: IoErrorKind) -> &'static str {
    match kind {
        IoErrorKind::NotFound => "git_missing",
        IoErrorKind::PermissionDenied => "permission_denied",
        _ => "unknown",
    }
}

fn classify_git_branch_scan_error(stderr: &str) -> &'static str {
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryBranchScanResult {
    pub branches: Vec<Branch>,
    pub current_branch: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryBranchConnectivityResult {
    pub can_connect: bool,
}

fn find_project_root(start_path: &Path) -> Option<PathBuf> {
    let mut current = start_path.to_path_buf();

    if current.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&current) {
            for entry in entries.flatten() {
                if let Some(ext) = entry.path().extension() {
                    if ext == "sln" {
                        return Some(current);
                    }
                }
            }
        }
    }

    while let Some(parent) = current.parent() {
        if let Ok(entries) = std::fs::read_dir(parent) {
            for entry in entries.flatten() {
                if let Some(ext) = entry.path().extension() {
                    if ext == "sln" {
                        return Some(parent.to_path_buf());
                    }
                }
            }
        }
        current = parent.to_path_buf();
    }

    None
}

fn find_project_file(root: &Path) -> Option<PathBuf> {
    let ui_dir = root.join("UI");
    if ui_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&ui_dir) {
            for entry in entries.flatten() {
                if let Some(ext) = entry.path().extension() {
                    if ext == "csproj" {
                        return Some(entry.path());
                    }
                }
            }
        }
    }

    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            if let Some(ext) = entry.path().extension() {
                if ext == "csproj" {
                    return Some(entry.path());
                }
            }
        }
    }

    let src_dir = root.join("src");
    if src_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&src_dir) {
            for entry in entries.flatten() {
                if let Some(ext) = entry.path().extension() {
                    if ext == "csproj" {
                        return Some(entry.path());
                    }
                }
            }
        }
    }

    None
}

fn scan_publish_profiles(project_file: &Path) -> Vec<String> {
    let mut profiles = Vec::new();
    if let Some(project_dir) = project_file.parent() {
        let profiles_dir = project_dir.join("Properties").join("PublishProfiles");
        if profiles_dir.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&profiles_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().map_or(false, |e| e == "pubxml") {
                        if let Some(stem) = path.file_stem() {
                            profiles.push(stem.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }
    }
    profiles.sort();
    profiles
}

fn has_extension_file(path: &Path, extension: &str) -> bool {
    let Ok(entries) = std::fs::read_dir(path) else {
        return false;
    };

    entries.flatten().any(|entry| {
        entry.path().is_file()
            && entry
                .path()
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case(extension))
                .unwrap_or(false)
    })
}

fn has_file(path: &Path, file_name: &str) -> bool {
    path.join(file_name).is_file()
}

fn detect_provider_from_path(path: &Path) -> Option<&'static str> {
    let dotnet_detected = has_extension_file(path, "sln")
        || has_extension_file(path, "csproj")
        || has_extension_file(&path.join("src"), "csproj")
        || has_extension_file(&path.join("UI"), "csproj");

    if dotnet_detected {
        return Some("dotnet");
    }

    if has_file(path, "Cargo.toml") {
        return Some("cargo");
    }

    if has_file(path, "go.mod") {
        return Some("go");
    }

    let java_markers = [
        "build.gradle",
        "build.gradle.kts",
        "settings.gradle",
        "settings.gradle.kts",
        "pom.xml",
        "gradlew",
    ];

    if java_markers.iter().any(|marker| has_file(path, marker)) {
        return Some("java");
    }

    None
}

#[tauri::command]
pub async fn detect_repository_provider(path: String) -> Result<String, crate::errors::AppError> {
    let repo_path = PathBuf::from(&path);

    if !repo_path.exists() {
        return Err(crate::errors::AppError::unknown_with_code(
            format!("repository path does not exist: {}", path),
            "path_not_found",
        ));
    }

    if !repo_path.is_dir() {
        return Err(crate::errors::AppError::unknown_with_code(
            format!("repository path is not a directory: {}", path),
            "not_directory",
        ));
    }

    if let Err(err) = std::fs::read_dir(&repo_path) {
        return Err(crate::errors::AppError::unknown_with_code(
            format!("failed to read repository directory: {}", err),
            classify_repository_path_error(err.kind()),
        ));
    }

    detect_provider_from_path(&repo_path)
        .map(ToString::to_string)
        .ok_or_else(|| {
            crate::errors::AppError::unknown_with_code(
                "cannot detect provider from repository path",
                "unsupported_provider",
            )
        })
}

#[tauri::command]
pub async fn check_repository_branch_connectivity(
    path: String,
    current_branch: Option<String>,
) -> RepositoryBranchConnectivityResult {
    let repo_path = PathBuf::from(&path);

    if !repo_path.exists() || !repo_path.is_dir() {
        return RepositoryBranchConnectivityResult { can_connect: false };
    }

    let mut branch_name = current_branch
        .map(|branch| branch.trim().to_string())
        .unwrap_or_default();

    if branch_name.is_empty() {
        let head_output = match Command::new("git")
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

    let upstream_output = match Command::new("git")
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
        Command::new("git")
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

#[tauri::command]
pub async fn scan_repository_branches(
    path: String,
) -> Result<RepositoryBranchScanResult, crate::errors::AppError> {
    let repo_path = PathBuf::from(&path);

    if !repo_path.exists() {
        return Err(crate::errors::AppError::unknown_with_code(
            format!("repository path does not exist: {}", path),
            "path_not_found",
        ));
    }

    if !repo_path.is_dir() {
        return Err(crate::errors::AppError::unknown_with_code(
            format!("repository path is not a directory: {}", path),
            "not_directory",
        ));
    }

    let remote_output = timeout(
        Duration::from_secs(5),
        Command::new("git").arg("-C").arg(&path).arg("remote").output(),
    )
    .await
    .map_err(|_| {
        crate::errors::AppError::unknown_with_code("git remote timed out after 5s", "timeout")
    })?
    .map_err(|err| {
        crate::errors::AppError::unknown_with_code(
            format!("failed to execute git remote: {}", err),
            classify_git_execution_error(err.kind()),
        )
    })?;

    if !remote_output.status.success() {
        let stderr = String::from_utf8_lossy(&remote_output.stderr).trim().to_string();
        return Err(crate::errors::AppError::unknown_with_code(
            format_git_command_failure("remote", &remote_output.stderr),
            classify_git_branch_scan_error(&stderr),
        ));
    }

    let has_remote = String::from_utf8_lossy(&remote_output.stdout)
        .lines()
        .any(|line| !line.trim().is_empty());

    if has_remote {
        let fetch_output = timeout(
            Duration::from_secs(5),
            Command::new("git")
                .arg("-C")
                .arg(&path)
                .arg("fetch")
                .arg("--all")
                .arg("--prune")
                .output(),
        )
        .await
        .map_err(|_| {
            crate::errors::AppError::unknown_with_code(
                "git fetch timed out after 5s",
                "timeout",
            )
        })?
        .map_err(|err| {
            crate::errors::AppError::unknown_with_code(
                format!("failed to execute git fetch: {}", err),
                classify_git_execution_error(err.kind()),
            )
        })?;

        if !fetch_output.status.success() {
            let stderr = String::from_utf8_lossy(&fetch_output.stderr).trim().to_string();
            return Err(crate::errors::AppError::unknown_with_code(
                format_git_command_failure("fetch", &fetch_output.stderr),
                classify_git_branch_scan_error(&stderr),
            ));
        }
    }

    let output = timeout(
        Duration::from_secs(5),
        Command::new("git")
            .arg("-C")
            .arg(&path)
            .arg("branch")
            .arg("--list")
            .arg("--no-color")
            .output(),
    )
    .await
    .map_err(|_| {
        crate::errors::AppError::unknown_with_code("git branch timed out after 5s", "timeout")
    })?
    .map_err(|err| {
        crate::errors::AppError::unknown_with_code(
            format!("failed to execute git branch: {}", err),
            classify_git_execution_error(err.kind()),
        )
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(crate::errors::AppError::unknown_with_code(
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
        return Err(crate::errors::AppError::unknown_with_code(
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
            Command::new("git")
                .arg("-C")
                .arg(&path)
                .arg("rev-parse")
                .arg("--abbrev-ref")
                .arg("HEAD")
                .output(),
        )
        .await
        .map_err(|_| {
            crate::errors::AppError::unknown_with_code(
                "git rev-parse timed out after 5s",
                "timeout",
            )
        })?
        .map_err(|err| {
            crate::errors::AppError::unknown_with_code(
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

/// Collect all recognizable project files under a repository root.
///
/// Scans well-known subdirectories (UI/, root, src/) for project files whose
/// extension matches the detected provider (e.g. `.csproj` for dotnet,
/// `Cargo.toml` for cargo). Returns a sorted, deduplicated list of absolute
/// paths. An empty list is valid – it simply means nothing was found.
#[tauri::command]
pub async fn scan_project_files(path: String) -> Result<Vec<String>, crate::errors::AppError> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(crate::errors::AppError::unknown_with_code(
            format!("path is not a directory: {}", path),
            "not_directory",
        ));
    }

    let provider = detect_provider_from_path(&root);
    let extensions: &[&str] = match provider {
        Some("dotnet") => &["csproj", "sln"],
        Some("cargo") => &["toml"],
        Some("go") => &["mod"],
        Some("java") => &["gradle", "kts", "xml"],
        _ => &[],
    };

    let exact_names: &[&str] = match provider {
        Some("cargo") => &["Cargo.toml"],
        Some("go") => &["go.mod"],
        Some("java") => &[
            "build.gradle",
            "build.gradle.kts",
            "settings.gradle",
            "settings.gradle.kts",
            "pom.xml",
        ],
        _ => &[],
    };

    let mut results: Vec<String> = Vec::new();

    let scan_dirs = [root.join("UI"), root.clone(), root.join("src")];

    for dir in &scan_dirs {
        if !dir.is_dir() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let entry_path = entry.path();
                if !entry_path.is_file() {
                    continue;
                }

                let matched = if !exact_names.is_empty() {
                    entry_path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .map(|name| exact_names.iter().any(|&en| name == en))
                        .unwrap_or(false)
                } else {
                    entry_path
                        .extension()
                        .and_then(|ext| ext.to_str())
                        .map(|ext| extensions.iter().any(|&e| ext.eq_ignore_ascii_case(e)))
                        .unwrap_or(false)
                };

                if matched {
                    results.push(entry_path.to_string_lossy().to_string());
                }
            }
        }
    }

    results.sort();
    results.dedup();
    Ok(results)
}

#[tauri::command]
pub async fn scan_project(
    start_path: Option<String>,
) -> Result<ProjectInfo, crate::errors::AppError> {
    let search_path = match start_path {
        Some(p) => PathBuf::from(p),
        None => std::env::current_dir().map_err(|e| {
            crate::errors::AppError::unknown_with_code(
                format!("failed to resolve current directory: {}", e),
                "current_dir_failed",
            )
        })?,
    };

    if !search_path.exists() {
        return Err(crate::errors::AppError::unknown_with_code(
            format!("scan start path does not exist: {}", search_path.display()),
            "path_not_found",
        ));
    }

    let root_path = find_project_root(&search_path).ok_or_else(|| {
        crate::errors::AppError::unknown_with_code(
            "cannot find project root (.sln)",
            "project_root_not_found",
        )
    })?;

    let project_file = find_project_file(&root_path).ok_or_else(|| {
        crate::errors::AppError::unknown_with_code(
            "cannot find project file (.csproj)",
            "project_file_not_found",
        )
    })?;

    let publish_profiles = scan_publish_profiles(&project_file);
    Ok(ProjectInfo {
        root_path: root_path.to_string_lossy().to_string(),
        project_file: project_file.to_string_lossy().to_string(),
        publish_profiles,
    })
}
