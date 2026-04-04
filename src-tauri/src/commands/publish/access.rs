use super::output::{configured_output_dir, infer_output_dir};
use crate::spec::PublishSpec;
use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProtectedDirectoryLocation {
    Desktop,
    Documents,
    Downloads,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PublishOutputAccessStatus {
    NotApplicable,
    Granted,
    Denied,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PublishOutputPathCompatibilityStatus {
    NotApplicable,
    Compatible,
    Incompatible,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PublishOutputPathCompatibilityIssue {
    WindowsStylePathOnPosix,
    PosixAbsolutePathOnWindows,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishOutputAccessResult {
    pub status: PublishOutputAccessStatus,
    pub output_dir: String,
    pub configured_output_dir: Option<String>,
    pub path_compatibility_status: PublishOutputPathCompatibilityStatus,
    pub path_compatibility_issue: Option<PublishOutputPathCompatibilityIssue>,
    pub protected_location: Option<ProtectedDirectoryLocation>,
    pub protected_root: Option<String>,
    pub probe_directory: Option<String>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ProtectedRoot {
    location: ProtectedDirectoryLocation,
    path: PathBuf,
}

pub(crate) fn check_publish_output_access(spec: &PublishSpec) -> PublishOutputAccessResult {
    let output_dir = infer_output_dir(spec);
    let configured_output_dir = configured_output_dir(spec);
    let (path_compatibility_status, path_compatibility_issue) =
        evaluate_output_path_compatibility(configured_output_dir.as_deref(), &output_dir);

    #[cfg(target_os = "macos")]
    {
        let mut result = check_macos_publish_output_access(&output_dir);
        result.configured_output_dir = configured_output_dir;
        result.path_compatibility_status = path_compatibility_status;
        result.path_compatibility_issue = path_compatibility_issue;
        result
    }

    #[cfg(not(target_os = "macos"))]
    {
        PublishOutputAccessResult {
            status: PublishOutputAccessStatus::NotApplicable,
            output_dir,
            configured_output_dir,
            path_compatibility_status,
            path_compatibility_issue,
            protected_location: None,
            protected_root: None,
            probe_directory: None,
            detail: None,
        }
    }
}

#[cfg(target_os = "macos")]
fn check_macos_publish_output_access(output_dir: &str) -> PublishOutputAccessResult {
    let trimmed = output_dir.trim();
    if trimmed.is_empty() {
        return PublishOutputAccessResult {
            status: PublishOutputAccessStatus::NotApplicable,
            output_dir: String::new(),
            configured_output_dir: None,
            path_compatibility_status: PublishOutputPathCompatibilityStatus::NotApplicable,
            path_compatibility_issue: None,
            protected_location: None,
            protected_root: None,
            probe_directory: None,
            detail: None,
        };
    }

    let normalized_output_dir = normalize_lexical_path(Path::new(trimmed));
    let protected_roots = macos_protected_roots();
    let Some(protected_root) =
        find_protected_root_for_path(&normalized_output_dir, &protected_roots)
    else {
        return PublishOutputAccessResult {
            status: PublishOutputAccessStatus::NotApplicable,
            output_dir: normalized_output_dir.to_string_lossy().to_string(),
            configured_output_dir: None,
            path_compatibility_status: PublishOutputPathCompatibilityStatus::NotApplicable,
            path_compatibility_issue: None,
            protected_location: None,
            protected_root: None,
            probe_directory: None,
            detail: None,
        };
    };

    let probe_directory =
        resolve_existing_probe_directory(&normalized_output_dir, &protected_root.path);

    match probe_directory_write_access(&probe_directory) {
        Ok(()) => {
            log::info!(
                "macOS protected output directory access granted: output_dir={} probe_directory={}",
                normalized_output_dir.display(),
                probe_directory.display()
            );
            PublishOutputAccessResult {
                status: PublishOutputAccessStatus::Granted,
                output_dir: normalized_output_dir.to_string_lossy().to_string(),
                configured_output_dir: None,
                path_compatibility_status: PublishOutputPathCompatibilityStatus::NotApplicable,
                path_compatibility_issue: None,
                protected_location: Some(protected_root.location),
                protected_root: Some(protected_root.path.to_string_lossy().to_string()),
                probe_directory: Some(probe_directory.to_string_lossy().to_string()),
                detail: None,
            }
        }
        Err(error) => {
            log::warn!(
                "macOS protected output directory access denied: output_dir={} probe_directory={} error={}",
                normalized_output_dir.display(),
                probe_directory.display(),
                error
            );
            PublishOutputAccessResult {
                status: PublishOutputAccessStatus::Denied,
                output_dir: normalized_output_dir.to_string_lossy().to_string(),
                configured_output_dir: None,
                path_compatibility_status: PublishOutputPathCompatibilityStatus::NotApplicable,
                path_compatibility_issue: None,
                protected_location: Some(protected_root.location),
                protected_root: Some(protected_root.path.to_string_lossy().to_string()),
                probe_directory: Some(probe_directory.to_string_lossy().to_string()),
                detail: Some(error.to_string()),
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn macos_protected_roots() -> Vec<ProtectedRoot> {
    [
        (ProtectedDirectoryLocation::Desktop, dirs::desktop_dir()),
        (ProtectedDirectoryLocation::Documents, dirs::document_dir()),
        (ProtectedDirectoryLocation::Downloads, dirs::download_dir()),
    ]
    .into_iter()
    .filter_map(|(location, path)| path.map(|path| ProtectedRoot { location, path }))
    .collect()
}

fn find_protected_root_for_path<'a>(
    path: &Path,
    roots: &'a [ProtectedRoot],
) -> Option<&'a ProtectedRoot> {
    let normalized_path = normalize_lexical_path(path);

    roots.iter().find(|root| {
        let normalized_root = normalize_lexical_path(&root.path);
        normalized_path.starts_with(&normalized_root)
    })
}

fn resolve_existing_probe_directory(path: &Path, fallback_root: &Path) -> PathBuf {
    let normalized_path = normalize_lexical_path(path);

    if normalized_path.is_dir() {
        return normalized_path;
    }

    if normalized_path.is_file() {
        return normalized_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| normalize_lexical_path(fallback_root));
    }

    for ancestor in normalized_path.ancestors() {
        if ancestor.exists() {
            return ancestor.to_path_buf();
        }
    }

    normalize_lexical_path(fallback_root)
}

#[cfg(target_os = "macos")]
fn probe_directory_write_access(directory: &Path) -> std::io::Result<()> {
    let probe_file = build_probe_file_path(directory);
    let file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&probe_file)?;
    drop(file);
    let _ = fs::remove_file(&probe_file);
    Ok(())
}

#[cfg(target_os = "macos")]
fn build_probe_file_path(directory: &Path) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    directory.join(format!(
        ".one-publish-access-check-{}-{}",
        std::process::id(),
        timestamp
    ))
}

fn normalize_lexical_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::RootDir | Component::Prefix(_) => {
                normalized.push(component.as_os_str());
            }
            Component::Normal(segment) => {
                normalized.push(segment);
            }
        }
    }

    normalized
}

fn evaluate_output_path_compatibility(
    configured_output_dir: Option<&str>,
    inferred_output_dir: &str,
) -> (
    PublishOutputPathCompatibilityStatus,
    Option<PublishOutputPathCompatibilityIssue>,
) {
    let path_to_check = configured_output_dir.unwrap_or(inferred_output_dir).trim();
    if path_to_check.is_empty() {
        return (PublishOutputPathCompatibilityStatus::NotApplicable, None);
    }

    match detect_output_path_compatibility_issue(path_to_check) {
        Some(issue) => (
            PublishOutputPathCompatibilityStatus::Incompatible,
            Some(issue),
        ),
        None => (PublishOutputPathCompatibilityStatus::Compatible, None),
    }
}

fn detect_output_path_compatibility_issue(
    path: &str,
) -> Option<PublishOutputPathCompatibilityIssue> {
    #[cfg(target_os = "windows")]
    {
        if looks_like_posix_absolute_path(path) {
            return Some(PublishOutputPathCompatibilityIssue::PosixAbsolutePathOnWindows);
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if looks_like_windows_path(path) {
            return Some(PublishOutputPathCompatibilityIssue::WindowsStylePathOnPosix);
        }
    }

    None
}

fn looks_like_windows_path(path: &str) -> bool {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return false;
    }

    let bytes = trimmed.as_bytes();
    let has_drive_prefix = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/');

    has_drive_prefix || trimmed.starts_with("\\\\") || trimmed.contains('\\')
}

#[cfg(target_os = "windows")]
fn looks_like_posix_absolute_path(path: &str) -> bool {
    let trimmed = path.trim();
    trimmed.starts_with('/') && !trimmed.starts_with("//")
}

#[cfg(test)]
mod tests {
    use super::{
        evaluate_output_path_compatibility, find_protected_root_for_path, normalize_lexical_path,
        resolve_existing_probe_directory, ProtectedDirectoryLocation, ProtectedRoot,
        PublishOutputPathCompatibilityIssue, PublishOutputPathCompatibilityStatus,
    };
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn finds_nested_protected_root() {
        let roots = vec![ProtectedRoot {
            location: ProtectedDirectoryLocation::Downloads,
            path: "/Users/test/Downloads".into(),
        }];

        let match_root = find_protected_root_for_path(
            Path::new("/Users/test/Downloads/publish/App/Release"),
            &roots,
        )
        .expect("expected protected root");

        assert_eq!(match_root.location, ProtectedDirectoryLocation::Downloads);
    }

    #[test]
    fn normalizes_curdir_and_parent_segments() {
        let normalized = normalize_lexical_path(Path::new(
            "/Users/test/Downloads/publish/Debug/../Release/./artifacts",
        ));

        assert_eq!(
            normalized,
            PathBuf::from("/Users/test/Downloads/publish/Release/artifacts")
        );
    }

    #[test]
    fn resolves_probe_directory_to_existing_parent() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("one-publish-access-root-{stamp}"));
        let existing = root.join("publish");
        fs::create_dir_all(&existing).expect("create probe root");

        let probe = resolve_existing_probe_directory(&existing.join("App/Release"), &root);

        assert_eq!(probe, existing);

        fs::remove_dir_all(&root).ok();
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn marks_windows_style_output_path_incompatible_on_posix() {
        let (status, issue) = evaluate_output_path_compatibility(
            Some(r".\publish\win-x64"),
            "/tmp/demo-project/.\\publish\\win-x64",
        );

        assert_eq!(status, PublishOutputPathCompatibilityStatus::Incompatible);
        assert_eq!(
            issue,
            Some(PublishOutputPathCompatibilityIssue::WindowsStylePathOnPosix)
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn marks_posix_absolute_output_path_incompatible_on_windows() {
        let (status, issue) =
            evaluate_output_path_compatibility(Some("/Users/demo/publish"), "/Users/demo/publish");

        assert_eq!(status, PublishOutputPathCompatibilityStatus::Incompatible);
        assert_eq!(
            issue,
            Some(PublishOutputPathCompatibilityIssue::PosixAbsolutePathOnWindows)
        );
    }

    #[test]
    fn keeps_empty_output_path_not_applicable() {
        let (status, issue) = evaluate_output_path_compatibility(None, "");

        assert_eq!(status, PublishOutputPathCompatibilityStatus::NotApplicable);
        assert_eq!(issue, None);
    }
}
