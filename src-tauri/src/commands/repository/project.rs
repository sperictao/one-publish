use serde_json::Value;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

use super::scanner::{normalize_path_key, normalize_scan_root, FileScanContext};
use super::*;

const DOTNET_SOLUTION_EXTENSION: &str = "sln";
const DOTNET_PROJECT_EXTENSIONS: &[&str] = &["csproj", "fsproj", "vbproj"];
const VISUAL_STUDIO_LAUNCH_EXTENSION: &str = "slnLaunch";

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

fn is_dotnet_solution_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case(DOTNET_SOLUTION_EXTENSION))
        .unwrap_or(false)
}

fn is_visual_studio_launch_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case(VISUAL_STUDIO_LAUNCH_EXTENSION))
        .unwrap_or(false)
}

pub fn collect_solution_files(root: &Path) -> Vec<PathBuf> {
    FileScanContext::new(root).collect_files(is_dotnet_solution_file)
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
    let solution_file_paths = context.collect_files(is_dotnet_solution_file);
    let project_file_paths = context.collect_files(is_dotnet_project_file);
    let launch_file_paths = context.collect_files(is_visual_studio_launch_file);
    let recommended_project_file = recommend_project_file_from_launch_files(
        context.root(),
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
        root_path: context.root().to_string_lossy().to_string(),
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

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
