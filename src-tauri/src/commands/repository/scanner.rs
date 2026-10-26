use crate::provider::registry::provider_registry;
use crate::provider::{ProviderProjectFileMatcher, ProviderRepositoryMarker};
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use walkdir::WalkDir;

use super::*;

const SCAN_SKIP_DIRS: &[&str] = &[".git", "node_modules", "target", "bin", "obj", "dist"];

pub fn normalize_scan_root(start_path: &Path) -> Result<PathBuf, crate::errors::AppError> {
    if start_path.is_dir() {
        return Ok(start_path.to_path_buf());
    }

    if start_path.is_file() {
        return start_path
            .parent()
            .map(|parent| parent.to_path_buf())
            .ok_or_else(|| {
                repository_error("cannot resolve parent directory", "not_directory")
                    .with_details(start_path.display().to_string())
            });
    }

    Err(repository_error("path is not a directory", "not_directory")
        .with_details(start_path.display().to_string()))
}

fn normalized_path_components(path: &Path) -> Vec<String> {
    path.components()
        .fold(Vec::new(), |mut components, component| {
            match component {
                Component::CurDir => {}
                Component::ParentDir => {
                    components.pop();
                }
                _ => components.push(component.as_os_str().to_string_lossy().to_ascii_lowercase()),
            }
            components
        })
}

fn path_has_component_prefix(path: &Path, prefix: &Path) -> bool {
    let path_components = normalized_path_components(path);
    let prefix_components = normalized_path_components(prefix);

    path_components.len() >= prefix_components.len()
        && path_components
            .iter()
            .zip(prefix_components.iter())
            .all(|(path_component, prefix_component)| path_component == prefix_component)
}

fn path_is_nested_under_root(root: &Path, path: &Path) -> bool {
    let root_components = normalized_path_components(root);
    let path_components = normalized_path_components(path);

    path_components.len() > root_components.len()
        && path_components
            .iter()
            .zip(root_components.iter())
            .all(|(path_component, root_component)| path_component == root_component)
}

pub(super) fn normalize_path_key(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy().to_ascii_lowercase())
        .collect::<Vec<_>>()
        .join("/")
}

fn is_walk_entry_under_excluded_root(entry_path: &Path, excluded_roots: &[PathBuf]) -> bool {
    excluded_roots
        .iter()
        .any(|excluded_root| path_has_component_prefix(entry_path, excluded_root))
}

fn parse_git_worktree_porcelain_paths(output: &str) -> Vec<PathBuf> {
    output
        .lines()
        .filter_map(|line| line.strip_prefix("worktree "))
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .collect()
}

fn nested_worktree_roots_from_paths(root: &Path, worktree_paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut nested_roots = Vec::new();

    for worktree_path in worktree_paths {
        let normalized_worktree_path = if worktree_path.is_absolute() {
            worktree_path
        } else {
            root.join(worktree_path)
        };

        if !path_is_nested_under_root(root, &normalized_worktree_path) {
            continue;
        }

        if seen.insert(normalize_path_key(&normalized_worktree_path)) {
            nested_roots.push(normalized_worktree_path);
        }
    }

    nested_roots
}

#[cfg(not(windows))]
fn discover_nested_worktree_roots(root: &Path) -> Vec<PathBuf> {
    let Ok(output) = crate::process_utils::new_std_command("git")
        .arg("-C")
        .arg(root)
        .arg("worktree")
        .arg("list")
        .arg("--porcelain")
        .output()
    else {
        return Vec::new();
    };

    if !output.status.success() {
        return Vec::new();
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    nested_worktree_roots_from_paths(root, parse_git_worktree_porcelain_paths(&stdout))
}

#[cfg(windows)]
fn discover_nested_worktree_roots(_root: &Path) -> Vec<PathBuf> {
    // FileScanContext is used during app startup to resolve the selected
    // repository/project. A single project-root lookup may construct several
    // contexts while walking ancestors, so invoking `git worktree list` here
    // can flash many console windows on Windows. Nested repositories/worktrees
    // already carry their own `.git` file or directory and `should_skip_entry`
    // prunes them without launching any process.
    Vec::new()
}

pub(super) struct FileScanContext {
    root: PathBuf,
    excluded_roots: Vec<PathBuf>,
}

impl FileScanContext {
    pub(super) fn new(root: &Path) -> Self {
        Self::with_excluded_roots(root, discover_nested_worktree_roots(root))
    }

    pub(super) fn root(&self) -> &Path {
        &self.root
    }

    #[cfg(test)]
    pub(super) fn with_excluded_roots(root: &Path, excluded_roots: Vec<PathBuf>) -> Self {
        Self {
            root: root.to_path_buf(),
            excluded_roots,
        }
    }

    #[cfg(not(test))]
    fn with_excluded_roots(root: &Path, excluded_roots: Vec<PathBuf>) -> Self {
        Self {
            root: root.to_path_buf(),
            excluded_roots,
        }
    }

    fn should_skip_entry(&self, entry: &walkdir::DirEntry) -> bool {
        if entry.depth() == 0 {
            return false;
        }

        if !entry.file_type().is_dir() {
            return false;
        }

        if is_walk_entry_under_excluded_root(entry.path(), &self.excluded_roots) {
            return true;
        }

        entry
            .path()
            .strip_prefix(&self.root)
            .ok()
            .and_then(|relative| relative.file_name())
            .and_then(|name| name.to_str())
            .map(|name| {
                SCAN_SKIP_DIRS
                    .iter()
                    .any(|dir| dir.eq_ignore_ascii_case(name))
                    || entry.path().join(".git").exists()
            })
            .unwrap_or(false)
    }

    pub(super) fn collect_files(&self, matcher: impl Fn(&Path) -> bool) -> Vec<PathBuf> {
        let mut files = Vec::new();

        for entry in WalkDir::new(&self.root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| !self.should_skip_entry(entry))
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
}

pub fn collect_files_recursively(root: &Path, matcher: impl Fn(&Path) -> bool) -> Vec<PathBuf> {
    FileScanContext::new(root).collect_files(matcher)
}

pub fn has_extension_file(path: &Path, extension: &str) -> bool {
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

pub fn has_extension_file_recursively(path: &Path, extension: &str) -> bool {
    if !path.is_dir() {
        return false;
    }

    !collect_files_recursively(path, |entry_path| {
        entry_path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case(extension))
            .unwrap_or(false)
    })
    .is_empty()
}

pub fn has_file(path: &Path, file_name: &str) -> bool {
    path.join(file_name).is_file()
}

pub fn matches_repository_marker(path: &Path, marker: &ProviderRepositoryMarker) -> bool {
    match marker {
        ProviderRepositoryMarker::FileName(file_name) => has_file(path, file_name.as_str()),
        ProviderRepositoryMarker::RecursiveFileName(file_name) => {
            !collect_files_recursively(path, |entry_path| {
                entry_path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.eq_ignore_ascii_case(file_name))
                    .unwrap_or(false)
            })
            .is_empty()
        }
        ProviderRepositoryMarker::Extension(extension) => {
            has_extension_file(path, extension.as_str())
        }
        ProviderRepositoryMarker::NestedExtension {
            directory,
            extension,
        } => has_extension_file_recursively(&path.join(directory.as_str()), extension.as_str()),
    }
}

pub fn matches_project_file(path: &Path, matcher: &ProviderProjectFileMatcher) -> bool {
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

fn describe_repository_marker(marker: &ProviderRepositoryMarker) -> String {
    match marker {
        ProviderRepositoryMarker::FileName(name) => name.clone(),
        ProviderRepositoryMarker::RecursiveFileName(name) => format!("**/{name}"),
        ProviderRepositoryMarker::Extension(extension) => format!("*.{extension}"),
        ProviderRepositoryMarker::NestedExtension {
            directory,
            extension,
        } => format!("{directory}/**/*.{extension}"),
    }
}

/// 收集全部命中的 Provider 候选（注册表顺序），各保留命中标记作为检测依据（ADR-0005）。
/// 首个命中即默认绑定；多命中由前端呈现给用户，检测顺序不吞掉其他候选。
pub fn detect_provider_candidates_from_path(path: &Path) -> Vec<RepositoryProviderCandidate> {
    provider_registry()
        .repository_discoveries()
        .filter_map(|discovery| {
            let matched_markers: Vec<String> = discovery
                .repository_markers
                .iter()
                .filter(|marker| matches_repository_marker(path, marker))
                .map(describe_repository_marker)
                .collect();
            if matched_markers.is_empty() {
                None
            } else {
                Some(RepositoryProviderCandidate {
                    provider_id: discovery.provider_id.clone(),
                    matched_markers,
                })
            }
        })
        .collect()
}

#[tauri::command]
pub async fn detect_repository_provider(
    path: String,
) -> Result<RepositoryProviderDetection, crate::errors::AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new(
        "commands::repository::scanner::detect_repository_provider",
    );
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

    if let Err(err) = std::fs::read_dir(&repo_path) {
        return Err(repository_error(
            "failed to read repository directory",
            classify_repository_path_error(err.kind()),
        )
        .with_details(err.to_string()));
    }

    let candidates = detect_provider_candidates_from_path(&repo_path);
    let Some(first) = candidates.first() else {
        return Err(repository_error(
            "cannot detect provider from repository path",
            "unsupported_provider",
        ));
    };
    Ok(RepositoryProviderDetection {
        provider_id: first.provider_id.clone(),
        candidates,
    })
}

/// Scan project files for the detected provider.
#[tauri::command]
pub async fn scan_project_files(path: String) -> Result<Vec<String>, crate::errors::AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new(
        "commands::repository::scanner::scan_project_files",
    );
    let root = PathBuf::from(&path);
    let root = normalize_scan_root(&root)?;

    let candidates = super::scan_project_candidates_from_path(&root)?;
    let mut results = candidates.project_files;
    results.extend(candidates.solution_files);
    results.sort();
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn parse_git_worktree_porcelain_paths_extracts_worktree_roots() {
        let temp_dir = TempDir::new().expect("temp dir");
        let repo_root = temp_dir.path().join("repo");
        let nested_worktree = repo_root.join("worktrees").join("feature");
        let sibling_worktree = temp_dir.path().join("feature");
        let output = format!(
            "\
worktree {}
HEAD 1111111111111111111111111111111111111111
branch refs/heads/main

worktree {}
HEAD 2222222222222222222222222222222222222222
branch refs/heads/feature

worktree {}
HEAD 3333333333333333333333333333333333333333
branch refs/heads/sibling
",
            repo_root.display(),
            nested_worktree.display(),
            sibling_worktree.display(),
        );

        let paths = parse_git_worktree_porcelain_paths(&output);

        assert_eq!(
            paths,
            vec![repo_root.clone(), nested_worktree.clone(), sibling_worktree,]
        );
        assert_eq!(
            nested_worktree_roots_from_paths(&repo_root, paths),
            vec![nested_worktree]
        );
    }

    #[test]
    fn filesystem_git_marker_prunes_nested_repository_without_excluded_roots() {
        let temp_dir = TempDir::new().expect("temp dir");
        let root = temp_dir.path().join("repo");
        let nested = root.join("worktrees").join("feature");
        let root_project = root.join("src").join("App.csproj");
        let nested_project = nested.join("Nested.csproj");

        std::fs::create_dir_all(root_project.parent().expect("root project parent"))
            .expect("create root project parent");
        std::fs::create_dir_all(&nested).expect("create nested worktree");
        std::fs::write(&root_project, "<Project />").expect("write root project");
        std::fs::write(&nested_project, "<Project />").expect("write nested project");
        std::fs::write(
            nested.join(".git"),
            "gitdir: ../../../.git/worktrees/feature\n",
        )
        .expect("write nested git marker");

        let context = FileScanContext::with_excluded_roots(&root, Vec::new());
        let files = context.collect_files(|path| {
            path.extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("csproj"))
        });

        assert_eq!(files, vec![root_project]);
    }
}
