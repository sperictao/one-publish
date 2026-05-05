use crate::provider::registry::provider_registry;
use crate::provider::{
    ProviderProjectFileMatcher, ProviderRepositoryDiscovery, ProviderRepositoryMarker,
};
use crate::store::Branch;
use serde::{Deserialize, Serialize};
use std::io::ErrorKind as IoErrorKind;
use std::path::{Path, PathBuf};
use tokio::time::{timeout, Duration};
use ts_rs::TS;
use walkdir::WalkDir;

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct ProjectInfo {
    pub root_path: String,
    pub project_file: String,
    pub publish_profiles: Vec<String>,
    pub target_frameworks: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ProjectPublishProfileFile {
    pub profile_name: String,
    pub file_path: String,
    pub content: String,
}

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

fn repository_error(
    message: impl Into<String>,
    code: impl Into<String>,
) -> crate::errors::AppError {
    crate::errors::AppError::repository_with_code(message, code)
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct RepositoryBranchScanResult {
    pub branches: Vec<Branch>,
    pub current_branch: String,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct RepositoryBranchConnectivityResult {
    pub can_connect: bool,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ProjectScanCandidates {
    pub root_path: String,
    pub solution_files: Vec<String>,
    pub project_files: Vec<String>,
    pub recommended_project_file: Option<String>,
}

const DOTNET_PROJECT_EXTENSIONS: &[&str] = &["csproj", "fsproj", "vbproj"];
const DOTNET_SOLUTION_EXTENSION: &str = "sln";
const SCAN_SKIP_DIRS: &[&str] = &[".git", "node_modules", "target", "bin", "obj", "dist"];

fn normalize_scan_root(start_path: &Path) -> Result<PathBuf, crate::errors::AppError> {
    if start_path.is_dir() {
        return Ok(start_path.to_path_buf());
    }

    if start_path.is_file() {
        return start_path
            .parent()
            .map(|parent| parent.to_path_buf())
            .ok_or_else(|| {
                repository_error(
                    format!(
                        "cannot resolve parent directory for {}",
                        start_path.display()
                    ),
                    "not_directory",
                )
            });
    }

    Err(repository_error(
        format!("path is not a directory: {}", start_path.display()),
        "not_directory",
    ))
}

fn should_skip_walk_entry(entry: &walkdir::DirEntry, root: &Path) -> bool {
    if entry.depth() == 0 {
        return false;
    }

    if !entry.file_type().is_dir() {
        return false;
    }

    entry
        .path()
        .strip_prefix(root)
        .ok()
        .and_then(|relative| relative.file_name())
        .and_then(|name| name.to_str())
        .map(|name| {
            SCAN_SKIP_DIRS
                .iter()
                .any(|dir| dir.eq_ignore_ascii_case(name))
        })
        .unwrap_or(false)
}

fn collect_files_recursively(root: &Path, matcher: impl Fn(&Path) -> bool) -> Vec<PathBuf> {
    let mut files = Vec::new();

    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| !should_skip_walk_entry(entry, root))
        .filter_map(Result::ok)
    {
        let path = entry.path();
        if !path.is_file() || !matcher(path) {
            continue;
        }

        files.push(path.to_path_buf());
    }

    files.sort();
    files.dedup();
    files
}

fn is_dotnet_project_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            DOTNET_PROJECT_EXTENSIONS
                .iter()
                .any(|candidate| ext.eq_ignore_ascii_case(candidate))
        })
        .unwrap_or(false)
}

fn is_dotnet_solution_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case(DOTNET_SOLUTION_EXTENSION))
        .unwrap_or(false)
}

fn collect_dotnet_project_files(root: &Path) -> Vec<PathBuf> {
    collect_files_recursively(root, is_dotnet_project_file)
}

fn collect_solution_files(root: &Path) -> Vec<PathBuf> {
    collect_files_recursively(root, is_dotnet_solution_file)
}

fn resolve_project_root_for_file(project_file: &Path) -> PathBuf {
    let project_dir = project_file
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| project_file.to_path_buf());

    for ancestor in project_dir.ancestors() {
        if collect_solution_files(ancestor)
            .into_iter()
            .any(|candidate| {
                candidate
                    .parent()
                    .map(|parent| parent == ancestor)
                    .unwrap_or(false)
            })
        {
            return ancestor.to_path_buf();
        }

        if ancestor.join(".git").exists() {
            return ancestor.to_path_buf();
        }
    }

    project_dir
}

fn project_scan_candidates_from_root(root: &Path) -> ProjectScanCandidates {
    let solution_files = collect_solution_files(root)
        .into_iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect::<Vec<_>>();
    let project_files = collect_dotnet_project_files(root)
        .into_iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect::<Vec<_>>();
    let recommended_project_file = match project_files.as_slice() {
        [only] => Some(only.clone()),
        _ => None,
    };

    ProjectScanCandidates {
        root_path: root.to_string_lossy().to_string(),
        solution_files,
        project_files,
        recommended_project_file,
    }
}

pub(crate) fn scan_project_candidates_from_path(
    start_path: &Path,
) -> Result<ProjectScanCandidates, crate::errors::AppError> {
    if !start_path.exists() {
        return Err(repository_error(
            format!("scan start path does not exist: {}", start_path.display()),
            "path_not_found",
        ));
    }

    let root_path = normalize_scan_root(start_path)?;
    Ok(project_scan_candidates_from_root(&root_path))
}

pub(crate) fn scan_publish_profiles(project_file: &Path) -> Vec<String> {
    let mut profiles = Vec::new();
    if let Some(project_dir) = project_file.parent() {
        let profiles_dir = project_dir.join("Properties").join("PublishProfiles");
        if profiles_dir.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&profiles_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().is_some_and(|e| e == "pubxml") {
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

pub(crate) fn resolve_project_file_from_search_path(start_path: &Path) -> Option<PathBuf> {
    let root_path = normalize_scan_root(start_path).ok()?;
    let candidates = project_scan_candidates_from_root(&root_path);

    if let Some(project_file) = candidates.recommended_project_file {
        return Some(PathBuf::from(project_file));
    }

    None
}

fn extract_xml_tag_values(content: &str, tag_name: &str) -> Vec<String> {
    let normalized_content = content.to_lowercase();
    let normalized_tag_name = tag_name.to_lowercase();
    let open_tag = format!("<{}", normalized_tag_name);
    let close_tag = format!("</{}>", normalized_tag_name);
    let mut cursor = 0usize;
    let mut values = Vec::new();

    while let Some(relative_start) = normalized_content[cursor..].find(&open_tag) {
        let tag_start = cursor + relative_start;
        let tag_boundary = normalized_content
            .as_bytes()
            .get(tag_start + open_tag.len())
            .copied();
        if matches!(
            tag_boundary,
            Some(b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_')
        ) {
            cursor = tag_start + open_tag.len();
            continue;
        }
        let Some(relative_open_end) = normalized_content[tag_start..].find('>') else {
            break;
        };
        let open_end = tag_start + relative_open_end;
        let content_start = open_end + 1;

        let Some(relative_close_start) = normalized_content[content_start..].find(&close_tag)
        else {
            break;
        };
        let close_start = content_start + relative_close_start;
        let value = content[content_start..close_start].trim();

        if !value.is_empty() {
            values.push(value.to_string());
        }

        cursor = close_start + close_tag.len();
    }

    values
}

fn extract_target_frameworks_from_project_xml(content: &str) -> Vec<String> {
    let mut frameworks = Vec::new();

    for tag_name in ["TargetFramework", "TargetFrameworks"] {
        for raw_value in extract_xml_tag_values(content, tag_name) {
            for framework in raw_value
                .split(';')
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                if !frameworks.iter().any(|item| item == framework) {
                    frameworks.push(framework.to_string());
                }
            }
        }
    }

    frameworks
}

fn read_target_frameworks(project_file: &Path) -> Result<Vec<String>, crate::errors::AppError> {
    let content = std::fs::read_to_string(project_file).map_err(|error| {
        repository_error(
            format!(
                "failed to read project file {}: {}",
                project_file.to_string_lossy(),
                error
            ),
            classify_repository_path_error(error.kind()),
        )
    })?;

    Ok(extract_target_frameworks_from_project_xml(&content))
}

fn resolve_publish_profile_path(
    project_file: &Path,
    profile_name: &str,
) -> Result<PathBuf, crate::errors::AppError> {
    let normalized_profile_name = profile_name.trim();
    if normalized_profile_name.is_empty() {
        return Err(repository_error(
            "publish profile name cannot be empty",
            "profile_name_empty",
        ));
    }

    if normalized_profile_name.contains("..")
        || normalized_profile_name.contains('/')
        || normalized_profile_name.contains('\\')
    {
        return Err(repository_error(
            format!("invalid publish profile name: {}", normalized_profile_name),
            "invalid_profile_name",
        ));
    }

    let project_dir = project_file.parent().ok_or_else(|| {
        repository_error(
            format!(
                "cannot resolve parent directory for project file: {}",
                project_file.display()
            ),
            "project_dir_not_found",
        )
    })?;

    let profile_path = project_dir
        .join("Properties")
        .join("PublishProfiles")
        .join(format!("{}.pubxml", normalized_profile_name));

    if !profile_path.is_file() {
        return Err(repository_error(
            format!(
                "publish profile does not exist: {}",
                profile_path.to_string_lossy()
            ),
            "profile_not_found",
        ));
    }

    Ok(profile_path)
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

fn has_extension_file_recursively(path: &Path, extension: &str) -> bool {
    if !path.is_dir() {
        return false;
    }

    WalkDir::new(path)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| !should_skip_walk_entry(entry, path))
        .filter_map(Result::ok)
        .any(|entry| {
            let entry_path = entry.path();
            entry_path.is_file()
                && entry_path
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .map(|ext| ext.eq_ignore_ascii_case(extension))
                    .unwrap_or(false)
        })
}

fn has_file(path: &Path, file_name: &str) -> bool {
    path.join(file_name).is_file()
}

fn matches_repository_marker(path: &Path, marker: &ProviderRepositoryMarker) -> bool {
    match marker {
        ProviderRepositoryMarker::FileName(file_name) => has_file(path, file_name.as_str()),
        ProviderRepositoryMarker::Extension(extension) => {
            has_extension_file(path, extension.as_str())
        }
        ProviderRepositoryMarker::NestedExtension {
            directory,
            extension,
        } => has_extension_file_recursively(&path.join(directory.as_str()), extension.as_str()),
    }
}

fn matches_project_file(path: &Path, matcher: &ProviderProjectFileMatcher) -> bool {
    match matcher {
        ProviderProjectFileMatcher::FileName(file_name) => path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.eq_ignore_ascii_case(file_name.as_str()))
            .unwrap_or(false),
        ProviderProjectFileMatcher::Extension(extension) => path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case(extension.as_str()))
            .unwrap_or(false),
    }
}

fn detect_provider_discovery_from_path(
    path: &Path,
) -> Option<&'static ProviderRepositoryDiscovery> {
    provider_registry()
        .repository_discoveries()
        .find(|discovery| {
            discovery
                .repository_markers
                .iter()
                .any(|marker| matches_repository_marker(path, marker))
        })
}

fn detect_provider_from_path(path: &Path) -> Option<String> {
    detect_provider_discovery_from_path(path).map(|discovery| discovery.provider_id.clone())
}

#[tauri::command]
pub async fn detect_repository_provider(path: String) -> Result<String, crate::errors::AppError> {
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

    if let Err(err) = std::fs::read_dir(&repo_path) {
        return Err(repository_error(
            format!("failed to read repository directory: {}", err),
            classify_repository_path_error(err.kind()),
        ));
    }

    detect_provider_from_path(&repo_path).ok_or_else(|| {
        repository_error(
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
    scan_repository_branches_internal(path, refresh_remote.unwrap_or(true)).await
}

/// Collect all recognizable project files under a repository root.
///
/// Uses provider registry discovery metadata to match project files for the
/// detected provider. Returns a sorted, deduplicated list of absolute paths.
/// An empty list is valid – it simply means nothing was found.
#[tauri::command]
pub async fn scan_project_files(path: String) -> Result<Vec<String>, crate::errors::AppError> {
    let root = PathBuf::from(&path);
    let root = normalize_scan_root(&root)?;

    let results = detect_provider_discovery_from_path(&root)
        .map(|discovery| {
            collect_files_recursively(&root, |entry_path| {
                discovery
                    .project_file_matchers
                    .iter()
                    .any(|matcher| matches_project_file(entry_path, matcher))
            })
        })
        .unwrap_or_default()
        .into_iter()
        .map(|entry_path| entry_path.to_string_lossy().to_string())
        .collect();
    Ok(results)
}

#[tauri::command]
pub async fn scan_project_candidates(
    start_path: Option<String>,
) -> Result<ProjectScanCandidates, crate::errors::AppError> {
    let search_path = match start_path {
        Some(path) => PathBuf::from(path),
        None => std::env::current_dir().map_err(|error| {
            repository_error(
                format!("failed to resolve current directory: {}", error),
                "current_dir_failed",
            )
        })?,
    };
    scan_project_candidates_from_path(&search_path)
}

#[tauri::command]
pub async fn resolve_project_info(
    project_file: String,
) -> Result<ProjectInfo, crate::errors::AppError> {
    let project_file_path = PathBuf::from(&project_file);
    if !project_file_path.is_file() || !is_dotnet_project_file(&project_file_path) {
        return Err(repository_error(
            format!(
                "project file does not exist: {}",
                project_file_path.display()
            ),
            "project_file_not_found",
        ));
    }

    let publish_profiles = scan_publish_profiles(&project_file_path);
    let target_frameworks = read_target_frameworks(&project_file_path)?;
    let root_path = resolve_project_root_for_file(&project_file_path);

    Ok(ProjectInfo {
        root_path: root_path.to_string_lossy().to_string(),
        project_file: project_file_path.to_string_lossy().to_string(),
        publish_profiles,
        target_frameworks,
    })
}

#[tauri::command]
pub async fn scan_project(
    start_path: Option<String>,
) -> Result<ProjectInfo, crate::errors::AppError> {
    let candidates = scan_project_candidates(start_path).await?;

    match candidates.project_files.as_slice() {
        [] if candidates.solution_files.is_empty() => Err(repository_error(
            "cannot find project root (.sln or project file)",
            "project_root_not_found",
        )),
        [] => Err(repository_error(
            "cannot find project file (.csproj/.fsproj/.vbproj)",
            "project_file_not_found",
        )),
        [only_project] => resolve_project_info(only_project.clone()).await,
        _ => Err(repository_error(
            "multiple project files found; bind an explicit project file first",
            "multiple_project_files_found",
        )),
    }
}

#[tauri::command]
pub async fn read_project_publish_profile(
    project_file: String,
    profile_name: String,
) -> Result<ProjectPublishProfileFile, crate::errors::AppError> {
    let project_file_path = PathBuf::from(project_file);
    if !project_file_path.is_file() {
        return Err(repository_error(
            format!(
                "project file does not exist: {}",
                project_file_path.to_string_lossy()
            ),
            "project_file_not_found",
        ));
    }

    let profile_path = resolve_publish_profile_path(&project_file_path, &profile_name)?;
    let content = std::fs::read_to_string(&profile_path).map_err(|error| {
        repository_error(
            format!(
                "failed to read publish profile {}: {}",
                profile_path.to_string_lossy(),
                error
            ),
            classify_repository_path_error(error.kind()),
        )
    })?;

    Ok(ProjectPublishProfileFile {
        profile_name: profile_name.trim().to_string(),
        file_path: profile_path.to_string_lossy().to_string(),
        content,
    })
}

#[cfg(test)]
mod tests {
    use super::extract_target_frameworks_from_project_xml;
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn extracts_single_target_framework() {
        let frameworks = extract_target_frameworks_from_project_xml(
            r#"
            <Project>
              <PropertyGroup>
                <TargetFramework>net8.0</TargetFramework>
              </PropertyGroup>
            </Project>
            "#,
        );

        assert_eq!(frameworks, vec!["net8.0"]);
    }

    #[test]
    fn extracts_multiple_target_frameworks() {
        let frameworks = extract_target_frameworks_from_project_xml(
            r#"
            <Project>
              <PropertyGroup>
                <TargetFrameworks>net8.0; net9.0 ;net10.0</TargetFrameworks>
              </PropertyGroup>
            </Project>
            "#,
        );

        assert_eq!(frameworks, vec!["net8.0", "net9.0", "net10.0"]);
    }

    #[test]
    fn returns_empty_target_frameworks_when_missing() {
        let frameworks = extract_target_frameworks_from_project_xml(
            r#"
            <Project>
              <PropertyGroup>
                <Nullable>enable</Nullable>
              </PropertyGroup>
            </Project>
            "#,
        );

        assert!(frameworks.is_empty());
    }

    #[test]
    fn scan_project_candidates_finds_single_project_without_solution() {
        let temp_dir = TempDir::new().expect("temp dir");
        let project_file = temp_dir.path().join("src").join("App.csproj");
        fs::create_dir_all(project_file.parent().expect("project dir")).expect("create dir");
        fs::write(&project_file, "<Project />").expect("write project");

        let candidates = project_scan_candidates_from_root(temp_dir.path());

        assert_eq!(
            candidates.project_files,
            vec![project_file.to_string_lossy().to_string()]
        );
        assert_eq!(
            candidates.recommended_project_file.as_deref(),
            Some(project_file.to_string_lossy().as_ref())
        );
        assert!(candidates.solution_files.is_empty());
    }

    #[tokio::test]
    async fn scan_project_reports_multiple_candidates_when_more_than_one_project_exists() {
        let temp_dir = TempDir::new().expect("temp dir");
        let project_a = temp_dir.path().join("AppA.csproj");
        let project_b = temp_dir.path().join("AppB.csproj");
        fs::write(&project_a, "<Project />").expect("write project a");
        fs::write(&project_b, "<Project />").expect("write project b");

        let err = scan_project(Some(temp_dir.path().to_string_lossy().to_string()))
            .await
            .expect_err("multiple project files should fail");

        assert_eq!(err.code.as_deref(), Some("multiple_project_files_found"));
    }

    #[tokio::test]
    async fn resolve_project_info_uses_solution_root_when_available() {
        let temp_dir = TempDir::new().expect("temp dir");
        let solution = temp_dir.path().join("App.sln");
        let project_dir = temp_dir.path().join("src").join("App");
        let project_file = project_dir.join("App.csproj");
        let profiles_dir = project_dir.join("Properties").join("PublishProfiles");

        fs::create_dir_all(&profiles_dir).expect("create profiles dir");
        fs::write(&solution, "").expect("write solution");
        fs::write(
            &project_file,
            "<Project><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>",
        )
        .expect("write project");
        fs::write(profiles_dir.join("FolderProfile.pubxml"), "<Project />").expect("write profile");

        let info = resolve_project_info(project_file.to_string_lossy().to_string())
            .await
            .expect("resolve project info");

        assert_eq!(info.root_path, temp_dir.path().to_string_lossy());
        assert_eq!(info.project_file, project_file.to_string_lossy());
        assert_eq!(info.publish_profiles, vec!["FolderProfile".to_string()]);
        assert_eq!(info.target_frameworks, vec!["net8.0".to_string()]);
    }

    #[test]
    fn detect_provider_from_path_recognizes_gradle_repository() {
        let temp_dir = TempDir::new().expect("temp dir");
        fs::write(temp_dir.path().join("build.gradle.kts"), "plugins {}")
            .expect("write gradle build file");

        assert_eq!(
            detect_provider_from_path(temp_dir.path()),
            Some("java".to_string())
        );
    }

    #[test]
    fn detect_provider_from_path_rejects_maven_only_repository() {
        let temp_dir = TempDir::new().expect("temp dir");
        fs::write(temp_dir.path().join("pom.xml"), "<project />").expect("write pom");

        assert_eq!(detect_provider_from_path(temp_dir.path()), None);
    }

    #[test]
    fn detect_provider_from_path_uses_dotnet_discovery_metadata() {
        let temp_dir = TempDir::new().expect("temp dir");
        let project_dir = temp_dir.path().join("src").join("App");
        fs::create_dir_all(&project_dir).expect("create project dir");
        fs::write(project_dir.join("App.fsproj"), "<Project />").expect("write fsproj");

        assert_eq!(
            detect_provider_from_path(temp_dir.path()),
            Some("dotnet".to_string())
        );
    }

    #[tokio::test]
    async fn detect_repository_provider_returns_unsupported_for_maven_only_repository() {
        let temp_dir = TempDir::new().expect("temp dir");
        fs::write(temp_dir.path().join("pom.xml"), "<project />").expect("write pom");

        let error = detect_repository_provider(temp_dir.path().to_string_lossy().to_string())
            .await
            .expect_err("maven-only repository should be unsupported");

        assert_eq!(error.code.as_deref(), Some("unsupported_provider"));
    }

    #[tokio::test]
    async fn scan_project_files_for_java_returns_gradle_markers_only() {
        let temp_dir = TempDir::new().expect("temp dir");
        let gradle_file = temp_dir.path().join("build.gradle");
        let settings_file = temp_dir.path().join("settings.gradle.kts");
        let wrapper_file = temp_dir.path().join("gradlew");
        let pom_file = temp_dir.path().join("pom.xml");

        fs::write(&gradle_file, "plugins {}").expect("write gradle file");
        fs::write(&settings_file, "rootProject.name = \"demo\"").expect("write settings file");
        fs::write(&wrapper_file, "#!/bin/sh").expect("write wrapper file");
        fs::write(&pom_file, "<project />").expect("write pom file");

        let files = scan_project_files(temp_dir.path().to_string_lossy().to_string())
            .await
            .expect("scan project files");

        assert!(files.contains(&gradle_file.to_string_lossy().to_string()));
        assert!(files.contains(&settings_file.to_string_lossy().to_string()));
        assert!(files.contains(&wrapper_file.to_string_lossy().to_string()));
        assert!(!files.contains(&pom_file.to_string_lossy().to_string()));
    }

    #[tokio::test]
    async fn scan_project_files_for_dotnet_uses_discovery_metadata() {
        let temp_dir = TempDir::new().expect("temp dir");
        let project_dir = temp_dir.path().join("src").join("App");
        let project_file = project_dir.join("App.fsproj");
        fs::create_dir_all(&project_dir).expect("create project dir");
        fs::write(&project_file, "<Project />").expect("write fsproj");

        let files = scan_project_files(temp_dir.path().to_string_lossy().to_string())
            .await
            .expect("scan project files");

        assert_eq!(files, vec![project_file.to_string_lossy().to_string()]);
    }
}
