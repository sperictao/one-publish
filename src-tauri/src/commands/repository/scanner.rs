use crate::provider::registry::provider_registry;
use crate::provider::{
    ProviderProjectFileMatcher, ProviderRepositoryDiscovery, ProviderRepositoryMarker,
};
use serde_json::Value;
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use walkdir::WalkDir;

use super::*;

const DOTNET_SOLUTION_EXTENSION: &str = "sln";
const DOTNET_PROJECT_EXTENSIONS: &[&str] = &["csproj", "fsproj", "vbproj"];
const VISUAL_STUDIO_LAUNCH_EXTENSION: &str = "slnLaunch";
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

struct FileScanContext {
    root: PathBuf,
    excluded_roots: Vec<PathBuf>,
}

impl FileScanContext {
    fn new(root: &Path) -> Self {
        Self::with_excluded_roots(root, discover_nested_worktree_roots(root))
    }

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

    fn collect_files(&self, matcher: impl Fn(&Path) -> bool) -> Vec<PathBuf> {
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

    fn collect_dotnet_project_files(&self) -> Vec<PathBuf> {
        self.collect_files(is_dotnet_project_file)
    }

    fn collect_solution_files(&self) -> Vec<PathBuf> {
        self.collect_files(is_dotnet_solution_file)
    }

    fn collect_visual_studio_launch_files(&self) -> Vec<PathBuf> {
        self.collect_files(is_visual_studio_launch_file)
    }
}

pub fn collect_files_recursively(root: &Path, matcher: impl Fn(&Path) -> bool) -> Vec<PathBuf> {
    FileScanContext::new(root).collect_files(matcher)
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

pub fn collect_solution_files(root: &Path) -> Vec<PathBuf> {
    FileScanContext::new(root).collect_solution_files()
}

pub fn is_visual_studio_launch_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case(VISUAL_STUDIO_LAUNCH_EXTENSION))
        .unwrap_or(false)
}

fn path_from_visual_studio_relative(base_dir: &Path, raw_path: &str) -> PathBuf {
    let normalized = raw_path.trim().replace('\\', "/");
    let candidate = PathBuf::from(&normalized);
    if candidate.is_absolute() {
        return candidate;
    }

    normalized
        .split('/')
        .filter(|segment| !segment.is_empty())
        .fold(base_dir.to_path_buf(), |path, segment| path.join(segment))
}

fn normalize_path_key(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy().to_ascii_lowercase())
        .collect::<Vec<_>>()
        .join("/")
}

fn parse_solution_project_paths(solution_file: &Path) -> Vec<PathBuf> {
    let Ok(content) = std::fs::read_to_string(solution_file) else {
        return Vec::new();
    };
    let solution_dir = solution_file.parent().unwrap_or_else(|| Path::new(""));
    let mut project_paths = Vec::new();

    for line in content.lines().map(str::trim) {
        if !line.starts_with("Project(") {
            continue;
        }

        let quoted_parts = line
            .split('"')
            .skip(1)
            .step_by(2)
            .map(str::trim)
            .collect::<Vec<_>>();
        let Some(relative_path) = quoted_parts.get(2) else {
            continue;
        };
        let project_path = path_from_visual_studio_relative(solution_dir, relative_path);
        if is_dotnet_project_file(&project_path) {
            project_paths.push(project_path);
        }
    }

    project_paths
}

fn solution_project_paths(solution_files: &[PathBuf]) -> Vec<PathBuf> {
    solution_files
        .iter()
        .flat_map(|solution_file| parse_solution_project_paths(solution_file))
        .collect()
}

fn collect_start_project_paths_from_launch_value(value: &Value, project_paths: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            let action = map
                .get("Action")
                .or_else(|| map.get("action"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let path = map
                .get("Path")
                .or_else(|| map.get("path"))
                .and_then(Value::as_str)
                .unwrap_or("");

            if matches!(
                action.to_ascii_lowercase().as_str(),
                "start" | "startwithoutdebugging"
            ) && !path.trim().is_empty()
            {
                project_paths.push(path.to_string());
            }

            for nested in map.values() {
                collect_start_project_paths_from_launch_value(nested, project_paths);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_start_project_paths_from_launch_value(item, project_paths);
            }
        }
        _ => {}
    }
}

fn start_project_paths_from_launch_file(launch_file: &Path) -> Vec<PathBuf> {
    let Ok(content) = std::fs::read_to_string(launch_file) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<Value>(&content) else {
        return Vec::new();
    };
    let launch_dir = launch_file.parent().unwrap_or_else(|| Path::new(""));
    let mut raw_paths = Vec::new();
    collect_start_project_paths_from_launch_value(&value, &mut raw_paths);
    raw_paths
        .into_iter()
        .map(|path| path_from_visual_studio_relative(launch_dir, &path))
        .filter(|path| is_dotnet_project_file(path))
        .collect()
}

fn launch_start_project_paths(launch_files: &[PathBuf]) -> Vec<PathBuf> {
    launch_files
        .iter()
        .flat_map(|launch_file| start_project_paths_from_launch_file(launch_file))
        .collect()
}

fn dedupe_paths_by_key(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut deduped = Vec::new();

    for path in paths {
        if seen.insert(normalize_path_key(&path)) {
            deduped.push(path);
        }
    }

    deduped
}

fn ordered_path_bonus(project_file: &Path, ordered_paths: &[PathBuf], base_score: i32) -> i32 {
    let project_key = normalize_path_key(project_file);
    ordered_paths
        .iter()
        .position(|path| normalize_path_key(path) == project_key)
        .map(|index| base_score - (index as i32 * 10))
        .unwrap_or(0)
}

fn path_set_bonus(project_file: &Path, paths: &[PathBuf], score: i32) -> i32 {
    let project_key = normalize_path_key(project_file);
    if paths
        .iter()
        .any(|path| normalize_path_key(path) == project_key)
    {
        score
    } else {
        0
    }
}

fn normalize_identifier_key(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .map(|character| character.to_ascii_lowercase())
        .collect()
}

fn split_identifier_words(value: &str) -> Vec<String> {
    value
        .split(|character: char| !character.is_ascii_alphanumeric())
        .filter_map(|part| {
            let trimmed = part.trim().to_ascii_lowercase();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        })
        .collect()
}

fn path_file_stem_key(path: &Path) -> String {
    path.file_stem()
        .map(|stem| normalize_identifier_key(&stem.to_string_lossy()))
        .unwrap_or_default()
}

fn path_parent_name_key(path: &Path) -> String {
    path.parent()
        .and_then(Path::file_name)
        .map(|name| normalize_identifier_key(&name.to_string_lossy()))
        .unwrap_or_default()
}

fn name_key_matches(preferred: &str, candidate: &str) -> bool {
    if preferred.is_empty() || candidate.is_empty() {
        return false;
    }

    candidate == preferred
        || (preferred.len() >= 4 && candidate.contains(preferred))
        || (candidate.len() >= 4 && preferred.contains(candidate))
}

fn is_test_like_project_file(path: &Path) -> bool {
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy())
        .unwrap_or_default();
    let stem_key = normalize_identifier_key(&stem);
    let words = split_identifier_words(&stem);

    stem_key.ends_with("tests")
        || stem_key.ends_with("test")
        || stem_key.ends_with("specs")
        || stem_key.ends_with("spec")
        || words
            .iter()
            .any(|word| matches!(word.as_str(), "test" | "tests" | "spec" | "specs"))
        || path.ancestors().any(|ancestor| {
            ancestor
                .file_name()
                .map(|name| {
                    matches!(
                        name.to_string_lossy().to_ascii_lowercase().as_str(),
                        "test" | "tests" | "spec" | "specs"
                    )
                })
                .unwrap_or(false)
        })
}

fn project_file_recommendation_score(
    root: &Path,
    solution_files: &[PathBuf],
    launch_start_project_paths: &[PathBuf],
    solution_project_paths: &[PathBuf],
    project_files: &[PathBuf],
    project_file: &Path,
) -> i32 {
    let mut preferred_keys = Vec::new();
    if let Some(root_name) = root.file_name() {
        let root_key = normalize_identifier_key(&root_name.to_string_lossy());
        if !root_key.is_empty() {
            preferred_keys.push(root_key);
        }
    }

    for solution_file in solution_files {
        let solution_key = path_file_stem_key(solution_file);
        if !solution_key.is_empty() && !preferred_keys.iter().any(|key| key == &solution_key) {
            preferred_keys.push(solution_key);
        }
    }

    let stem_key = path_file_stem_key(project_file);
    let parent_key = path_parent_name_key(project_file);
    let has_test_like_candidate = project_files
        .iter()
        .any(|path| is_test_like_project_file(path));
    let mut score = 0;

    score += ordered_path_bonus(project_file, launch_start_project_paths, 30_000);
    score += path_set_bonus(project_file, solution_project_paths, 20_000);

    for preferred_key in &preferred_keys {
        if name_key_matches(preferred_key, &stem_key) {
            score += 100;
        }
        if name_key_matches(preferred_key, &parent_key) {
            score += 80;
        }
    }

    if has_test_like_candidate {
        if is_test_like_project_file(project_file) {
            score -= 60;
        } else {
            score += 20;
        }
    }

    score
}

fn recommend_project_file_from_launch_files(
    root: &Path,
    solution_files: &[PathBuf],
    launch_file_paths: &[PathBuf],
    project_files: &[PathBuf],
) -> Option<PathBuf> {
    if let [only] = project_files {
        return Some(only.clone());
    }

    let launch_start_project_paths =
        dedupe_paths_by_key(launch_start_project_paths(launch_file_paths));
    let solution_declared_project_paths =
        dedupe_paths_by_key(solution_project_paths(solution_files));
    let mut best_score = i32::MIN;
    let mut best_project_file: Option<&PathBuf> = None;
    let mut best_score_count = 0usize;

    for project_file in project_files {
        let score = project_file_recommendation_score(
            root,
            solution_files,
            &launch_start_project_paths,
            &solution_declared_project_paths,
            project_files,
            project_file,
        );

        if score > best_score {
            best_score = score;
            best_project_file = Some(project_file);
            best_score_count = 1;
        } else if score == best_score {
            best_score_count += 1;
        }
    }

    if best_score <= 0 || best_score_count != 1 {
        return None;
    }

    best_project_file.cloned()
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
    project_scan_candidates_from_context(&FileScanContext::new(root))
}

fn project_scan_candidates_from_context(context: &FileScanContext) -> ProjectScanCandidates {
    let solution_file_paths = context.collect_solution_files();
    let project_file_paths = context.collect_dotnet_project_files();
    let launch_file_paths = context.collect_visual_studio_launch_files();
    let recommended_project_file = recommend_project_file_from_launch_files(
        &context.root,
        &solution_file_paths,
        &launch_file_paths,
        &project_file_paths,
    )
    .map(|path| path.to_string_lossy().to_string());
    let solution_files = solution_file_paths
        .into_iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect::<Vec<_>>();
    let project_files = project_file_paths
        .into_iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect::<Vec<_>>();

    ProjectScanCandidates {
        root_path: context.root.to_string_lossy().to_string(),
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

/// detected provider. Returns a sorted, deduplicated list of absolute paths.
/// An empty list is valid – it simply means nothing was found.
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
    use std::fs;
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
    fn project_scan_candidates_skips_nested_worktree_root_without_git_file() {
        let temp_dir = TempDir::new().expect("temp dir");
        let app_project = temp_dir.path().join("src").join("App").join("App.csproj");
        let nested_worktree_root = temp_dir.path().join("linked-worktrees").join("feature");
        let nested_worktree_project = nested_worktree_root.join("Other").join("Other.csproj");
        fs::create_dir_all(app_project.parent().expect("app project dir")).expect("create app dir");
        fs::create_dir_all(
            nested_worktree_project
                .parent()
                .expect("nested worktree project dir"),
        )
        .expect("create nested worktree dir");
        fs::write(&app_project, "<Project />").expect("write app project");
        fs::write(&nested_worktree_project, "<Project />").expect("write worktree project");

        let context = FileScanContext::with_excluded_roots(
            temp_dir.path(),
            vec![nested_worktree_root.clone()],
        );
        let candidates = project_scan_candidates_from_context(&context);

        assert!(!nested_worktree_root.join(".git").exists());
        assert_eq!(
            candidates.project_files,
            vec![app_project.to_string_lossy().to_string()]
        );
        assert_eq!(
            candidates.recommended_project_file.as_deref(),
            Some(app_project.to_string_lossy().as_ref())
        );
    }
}
