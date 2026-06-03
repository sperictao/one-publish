use crate::provider::registry::provider_registry;
use crate::provider::{
    ProviderProjectFileMatcher, ProviderRepositoryDiscovery, ProviderRepositoryMarker,
};
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

pub fn detect_provider_discovery_from_path(
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

pub fn detect_provider_from_path(path: &Path) -> Option<String> {
    detect_provider_discovery_from_path(path).map(|discovery| discovery.provider_id.clone())
}

#[tauri::command]
pub async fn detect_repository_provider(path: String) -> Result<String, crate::errors::AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new(
        "commands::repository::scanner::detect_repository_provider",
    );
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

/// Scan project files for the detected provider.
#[tauri::command]
pub async fn scan_project_files(path: String) -> Result<Vec<String>, crate::errors::AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new(
        "commands::repository::scanner::scan_project_files",
    );
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
}
