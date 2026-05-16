use crate::provider::registry::provider_registry;
use crate::provider::{
    ProviderProjectFileMatcher, ProviderRepositoryDiscovery, ProviderRepositoryMarker,
};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

use super::*;

const DOTNET_SOLUTION_EXTENSION: &str = "sln";
const DOTNET_PROJECT_EXTENSIONS: &[&str] = &["csproj", "fsproj", "vbproj"];
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

pub fn should_skip_walk_entry(entry: &walkdir::DirEntry, root: &Path) -> bool {
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

pub fn collect_files_recursively(root: &Path, matcher: impl Fn(&Path) -> bool) -> Vec<PathBuf> {
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

pub fn is_dotnet_project_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            DOTNET_PROJECT_EXTENSIONS
                .iter()
                .any(|candidate| ext.eq_ignore_ascii_case(candidate))
        })
        .unwrap_or(false)
}

pub fn is_dotnet_solution_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case(DOTNET_SOLUTION_EXTENSION))
        .unwrap_or(false)
}

pub fn collect_dotnet_project_files(root: &Path) -> Vec<PathBuf> {
    collect_files_recursively(root, is_dotnet_project_file)
}

pub fn collect_solution_files(root: &Path) -> Vec<PathBuf> {
    collect_files_recursively(root, is_dotnet_solution_file)
}

pub fn resolve_project_root_for_file(project_file: &Path) -> PathBuf {
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

pub fn project_scan_candidates_from_root(root: &Path) -> ProjectScanCandidates {
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

pub fn scan_project_candidates_from_path(
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

pub fn scan_publish_profiles(project_file: &Path) -> Vec<String> {
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

pub fn resolve_project_file_from_search_path(start_path: &Path) -> Option<PathBuf> {
    let root_path = normalize_scan_root(start_path).ok()?;
    let candidates = project_scan_candidates_from_root(&root_path);

    if let Some(project_file) = candidates.recommended_project_file {
        return Some(PathBuf::from(project_file));
    }

    None
}

pub fn extract_xml_tag_values(content: &str, tag_name: &str) -> Vec<String> {
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

pub fn extract_target_frameworks_from_project_xml(content: &str) -> Vec<String> {
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

pub fn read_target_frameworks(project_file: &Path) -> Result<Vec<String>, crate::errors::AppError> {
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

pub fn resolve_publish_profile_path(
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
    let _timer = crate::commands::middleware::CommandTimer::new("commands::repository::scanner::detect_repository_provider");
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

/// detected provider. Returns a sorted, deduplicated list of absolute paths.
/// An empty list is valid – it simply means nothing was found.
#[tauri::command]
pub async fn scan_project_files(path: String) -> Result<Vec<String>, crate::errors::AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new("commands::repository::scanner::scan_project_files");
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