use super::ProjectInfo;
use std::path::{Path, PathBuf};

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
            super::classify_repository_path_error(err.kind()),
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
