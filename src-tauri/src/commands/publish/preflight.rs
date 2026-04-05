use super::output::{configured_output_dir, infer_output_dir};
use crate::spec::PublishSpec;
use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum ProtectedDirectoryLocation {
    Desktop,
    Documents,
    Downloads,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum PublishOutputAccessStatus {
    Skipped,
    NotApplicable,
    Granted,
    Denied,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum PublishOutputValidationStatus {
    NotApplicable,
    Compatible,
    Incompatible,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum PublishOutputValidationIssue {
    WindowsStylePathOnPosix,
    PosixAbsolutePathOnWindows,
    WindowsDriveRootMissing,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct PublishOutputValidation {
    pub status: PublishOutputValidationStatus,
    pub issue: Option<PublishOutputValidationIssue>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct PublishOutputAccess {
    pub status: PublishOutputAccessStatus,
    pub protected_location: Option<ProtectedDirectoryLocation>,
    pub protected_root: Option<String>,
    pub probe_directory: Option<String>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct PublishOutputPreflightResult {
    pub output_dir: String,
    pub configured_output_dir: Option<String>,
    pub validation: PublishOutputValidation,
    pub access: PublishOutputAccess,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ProtectedRoot {
    location: ProtectedDirectoryLocation,
    path: PathBuf,
}

#[derive(Debug, Clone)]
struct PublishOutputContext {
    output_dir: String,
    configured_output_dir: Option<String>,
}

impl PublishOutputValidation {
    fn new(
        status: PublishOutputValidationStatus,
        issue: Option<PublishOutputValidationIssue>,
    ) -> Self {
        Self { status, issue }
    }
}

impl PublishOutputAccess {
    fn skipped() -> Self {
        Self {
            status: PublishOutputAccessStatus::Skipped,
            protected_location: None,
            protected_root: None,
            probe_directory: None,
            detail: None,
        }
    }

    fn not_applicable() -> Self {
        Self {
            status: PublishOutputAccessStatus::NotApplicable,
            protected_location: None,
            protected_root: None,
            probe_directory: None,
            detail: None,
        }
    }

    fn granted(location: ProtectedDirectoryLocation, root: &Path, probe_directory: &Path) -> Self {
        Self {
            status: PublishOutputAccessStatus::Granted,
            protected_location: Some(location),
            protected_root: Some(root.to_string_lossy().to_string()),
            probe_directory: Some(probe_directory.to_string_lossy().to_string()),
            detail: None,
        }
    }

    fn denied(
        location: ProtectedDirectoryLocation,
        root: &Path,
        probe_directory: &Path,
        detail: impl Into<String>,
    ) -> Self {
        Self {
            status: PublishOutputAccessStatus::Denied,
            protected_location: Some(location),
            protected_root: Some(root.to_string_lossy().to_string()),
            probe_directory: Some(probe_directory.to_string_lossy().to_string()),
            detail: Some(detail.into()),
        }
    }
}

impl PublishOutputPreflightResult {
    fn new(
        output_dir: String,
        configured_output_dir: Option<String>,
        validation: PublishOutputValidation,
        access: PublishOutputAccess,
    ) -> Self {
        Self {
            output_dir,
            configured_output_dir,
            validation,
            access,
        }
    }
}

pub(crate) fn preflight_publish_output(spec: &PublishSpec) -> PublishOutputPreflightResult {
    let context = resolve_publish_output_context(spec);
    let validation = evaluate_publish_output_validation(
        context.configured_output_dir.as_deref(),
        &context.output_dir,
    );
    let access = if validation.status == PublishOutputValidationStatus::Incompatible {
        PublishOutputAccess::skipped()
    } else {
        evaluate_publish_output_access(&context.output_dir)
    };

    PublishOutputPreflightResult::new(
        context.output_dir,
        context.configured_output_dir,
        validation,
        access,
    )
}

fn resolve_publish_output_context(spec: &PublishSpec) -> PublishOutputContext {
    let output_dir = infer_output_dir(spec);
    let configured_output_dir = configured_output_dir(spec);

    PublishOutputContext {
        output_dir,
        configured_output_dir,
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

#[cfg(target_os = "macos")]
fn evaluate_publish_output_access(output_dir: &str) -> PublishOutputAccess {
    let protected_roots = macos_protected_roots();
    evaluate_publish_output_access_for_roots(
        output_dir,
        &protected_roots,
        probe_directory_write_access,
    )
}

#[cfg(not(target_os = "macos"))]
fn evaluate_publish_output_access(_output_dir: &str) -> PublishOutputAccess {
    PublishOutputAccess::not_applicable()
}

fn evaluate_publish_output_access_for_roots<F>(
    output_dir: &str,
    roots: &[ProtectedRoot],
    probe_write_access: F,
) -> PublishOutputAccess
where
    F: Fn(&Path) -> std::io::Result<()>,
{
    let trimmed = output_dir.trim();
    if trimmed.is_empty() {
        return PublishOutputAccess::not_applicable();
    }

    let normalized_output_dir = normalize_lexical_path(Path::new(trimmed));
    let Some(protected_root) = find_protected_root_for_path(&normalized_output_dir, roots) else {
        return PublishOutputAccess::not_applicable();
    };

    let probe_directory =
        resolve_existing_probe_directory(&normalized_output_dir, &protected_root.path);

    match probe_write_access(&probe_directory) {
        Ok(()) => {
            log::info!(
                "publish output access granted: output_dir={} probe_directory={}",
                normalized_output_dir.display(),
                probe_directory.display()
            );
            PublishOutputAccess::granted(
                protected_root.location,
                &protected_root.path,
                &probe_directory,
            )
        }
        Err(error) => {
            log::warn!(
                "publish output access denied: output_dir={} probe_directory={} error={}",
                normalized_output_dir.display(),
                probe_directory.display(),
                error
            );
            PublishOutputAccess::denied(
                protected_root.location,
                &protected_root.path,
                &probe_directory,
                error.to_string(),
            )
        }
    }
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

fn evaluate_publish_output_validation(
    configured_output_dir: Option<&str>,
    inferred_output_dir: &str,
) -> PublishOutputValidation {
    let path_to_check = configured_output_dir.unwrap_or(inferred_output_dir).trim();
    if path_to_check.is_empty() {
        return PublishOutputValidation::new(PublishOutputValidationStatus::NotApplicable, None);
    }

    match detect_output_path_validation_issue(path_to_check) {
        Some(issue) => {
            PublishOutputValidation::new(PublishOutputValidationStatus::Incompatible, Some(issue))
        }
        None => PublishOutputValidation::new(PublishOutputValidationStatus::Compatible, None),
    }
}

fn detect_output_path_validation_issue(path: &str) -> Option<PublishOutputValidationIssue> {
    #[cfg(target_os = "windows")]
    {
        detect_windows_output_path_validation_issue(path)
    }

    #[cfg(not(target_os = "windows"))]
    {
        looks_like_windows_path(path)
            .then_some(PublishOutputValidationIssue::WindowsStylePathOnPosix)
    }
}

#[cfg(target_os = "windows")]
fn detect_windows_output_path_validation_issue(path: &str) -> Option<PublishOutputValidationIssue> {
    if looks_like_posix_absolute_path(path) {
        return Some(PublishOutputValidationIssue::PosixAbsolutePathOnWindows);
    }

    if has_missing_windows_drive_root(path) {
        return Some(PublishOutputValidationIssue::WindowsDriveRootMissing);
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

#[cfg_attr(not(any(test, target_os = "windows")), allow(dead_code))]
fn looks_like_windows_absolute_path(path: &str) -> bool {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return false;
    }

    let bytes = trimmed.as_bytes();
    let has_drive_prefix = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/');

    has_drive_prefix || trimmed.starts_with("\\\\")
}

#[cfg_attr(not(any(test, target_os = "windows")), allow(dead_code))]
fn looks_like_posix_absolute_path(path: &str) -> bool {
    let trimmed = path.trim();
    trimmed.starts_with('/') && !trimmed.starts_with("//")
}

#[cfg(target_os = "windows")]
fn has_missing_windows_drive_root(path: &str) -> bool {
    windows_absolute_root(Path::new(path)).is_some_and(|root| !root.exists())
}

#[cfg(target_os = "windows")]
fn windows_absolute_root(path: &Path) -> Option<PathBuf> {
    let mut components = path.components();
    let prefix = match components.next()? {
        Component::Prefix(prefix) => prefix,
        _ => return None,
    };
    let Some(Component::RootDir) = components.next() else {
        return None;
    };

    let mut root = PathBuf::from(prefix.as_os_str());
    root.push(std::path::MAIN_SEPARATOR.to_string());
    Some(root)
}

#[cfg(test)]
mod tests {
    use super::{
        evaluate_publish_output_access_for_roots, find_protected_root_for_path,
        looks_like_posix_absolute_path, looks_like_windows_absolute_path, looks_like_windows_path,
        normalize_lexical_path, preflight_publish_output, resolve_existing_probe_directory,
        resolve_publish_output_context, ProtectedDirectoryLocation, ProtectedRoot,
        PublishOutputAccess, PublishOutputAccessStatus, PublishOutputPreflightResult,
        PublishOutputValidation, PublishOutputValidationIssue, PublishOutputValidationStatus,
    };
    use crate::spec::{PublishSpec, SpecValue, SPEC_VERSION};
    use std::collections::BTreeMap;
    use std::fs;
    use std::io::{self, ErrorKind};
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum TestPlatform {
        Windows,
        Macos,
        Posix,
    }

    fn evaluate_publish_output_validation_for_platform(
        platform: TestPlatform,
        configured_output_dir: Option<&str>,
        inferred_output_dir: &str,
        windows_drive_root_exists: bool,
    ) -> PublishOutputValidation {
        let path_to_check = configured_output_dir.unwrap_or(inferred_output_dir).trim();
        if path_to_check.is_empty() {
            return PublishOutputValidation::new(
                PublishOutputValidationStatus::NotApplicable,
                None,
            );
        }

        let issue = match platform {
            TestPlatform::Windows => {
                if looks_like_posix_absolute_path(path_to_check) {
                    Some(PublishOutputValidationIssue::PosixAbsolutePathOnWindows)
                } else if looks_like_windows_absolute_path(path_to_check)
                    && !windows_drive_root_exists
                {
                    Some(PublishOutputValidationIssue::WindowsDriveRootMissing)
                } else {
                    None
                }
            }
            TestPlatform::Macos | TestPlatform::Posix => looks_like_windows_path(path_to_check)
                .then_some(PublishOutputValidationIssue::WindowsStylePathOnPosix),
        };

        match issue {
            Some(issue) => PublishOutputValidation::new(
                PublishOutputValidationStatus::Incompatible,
                Some(issue),
            ),
            None => PublishOutputValidation::new(PublishOutputValidationStatus::Compatible, None),
        }
    }

    fn preflight_publish_output_for_test<F>(
        spec: &PublishSpec,
        platform: TestPlatform,
        windows_drive_root_exists: bool,
        evaluate_access: F,
    ) -> PublishOutputPreflightResult
    where
        F: FnOnce(&str) -> PublishOutputAccess,
    {
        let context = resolve_publish_output_context(spec);
        let validation = evaluate_publish_output_validation_for_platform(
            platform,
            context.configured_output_dir.as_deref(),
            &context.output_dir,
            windows_drive_root_exists,
        );
        let access = if validation.status == PublishOutputValidationStatus::Incompatible {
            PublishOutputAccess::skipped()
        } else {
            evaluate_access(&context.output_dir)
        };

        PublishOutputPreflightResult::new(
            context.output_dir,
            context.configured_output_dir,
            validation,
            access,
        )
    }

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

    #[test]
    fn preflight_publish_output_should_skip_access_when_output_path_is_windows_style_on_posix() {
        let mut parameters = BTreeMap::new();
        parameters.insert(
            "output".to_string(),
            SpecValue::String(r".\publish\win-x64".to_string()),
        );

        let result = preflight_publish_output_for_test(
            &PublishSpec {
                version: SPEC_VERSION,
                provider_id: "dotnet".to_string(),
                project_path: "repo/App.csproj".to_string(),
                parameters,
            },
            TestPlatform::Posix,
            true,
            |_output_dir| panic!("access check should be skipped for incompatible output path"),
        );

        assert_eq!(
            result.validation.status,
            PublishOutputValidationStatus::Incompatible
        );
        assert_eq!(
            result.validation.issue,
            Some(PublishOutputValidationIssue::WindowsStylePathOnPosix)
        );
        assert_eq!(result.access.status, PublishOutputAccessStatus::Skipped);
        assert_eq!(result.access.protected_location, None);
        assert_eq!(result.access.protected_root, None);
        assert_eq!(result.access.probe_directory, None);
        assert_eq!(result.access.detail, None);
    }

    #[test]
    fn preflight_publish_output_should_skip_access_when_output_path_is_posix_absolute_on_windows() {
        let mut parameters = BTreeMap::new();
        parameters.insert(
            "output".to_string(),
            SpecValue::String("/Users/demo/publish".to_string()),
        );

        let result = preflight_publish_output_for_test(
            &PublishSpec {
                version: SPEC_VERSION,
                provider_id: "dotnet".to_string(),
                project_path: "repo/App.csproj".to_string(),
                parameters,
            },
            TestPlatform::Windows,
            true,
            |_output_dir| panic!("access check should be skipped for incompatible output path"),
        );

        assert_eq!(
            result.validation.status,
            PublishOutputValidationStatus::Incompatible
        );
        assert_eq!(
            result.validation.issue,
            Some(PublishOutputValidationIssue::PosixAbsolutePathOnWindows)
        );
        assert_eq!(result.access.status, PublishOutputAccessStatus::Skipped);
        assert_eq!(result.access.protected_location, None);
        assert_eq!(result.access.protected_root, None);
        assert_eq!(result.access.probe_directory, None);
        assert_eq!(result.access.detail, None);
    }

    #[test]
    fn preflight_publish_output_should_return_not_applicable_access_for_valid_windows_output() {
        let mut parameters = BTreeMap::new();
        parameters.insert(
            "output".to_string(),
            SpecValue::String(r"D:\PRD".to_string()),
        );

        let result = preflight_publish_output_for_test(
            &PublishSpec {
                version: SPEC_VERSION,
                provider_id: "dotnet".to_string(),
                project_path: "repo/App.csproj".to_string(),
                parameters,
            },
            TestPlatform::Windows,
            true,
            |_output_dir| PublishOutputAccess::not_applicable(),
        );

        assert_eq!(
            result.validation.status,
            PublishOutputValidationStatus::Compatible
        );
        assert_eq!(result.validation.issue, None);
        assert_eq!(
            result.access.status,
            PublishOutputAccessStatus::NotApplicable
        );
        assert_eq!(result.access.protected_location, None);
        assert_eq!(result.access.protected_root, None);
        assert_eq!(result.access.probe_directory, None);
        assert_eq!(result.access.detail, None);
    }

    #[test]
    fn preflight_publish_output_should_skip_access_when_windows_drive_root_is_missing() {
        let mut parameters = BTreeMap::new();
        parameters.insert(
            "output".to_string(),
            SpecValue::String(r"D:\PRD".to_string()),
        );

        let result = preflight_publish_output_for_test(
            &PublishSpec {
                version: SPEC_VERSION,
                provider_id: "dotnet".to_string(),
                project_path: "repo/App.csproj".to_string(),
                parameters,
            },
            TestPlatform::Windows,
            false,
            |_output_dir| panic!("access check should be skipped for missing Windows drive root"),
        );

        assert_eq!(
            result.validation.status,
            PublishOutputValidationStatus::Incompatible
        );
        assert_eq!(
            result.validation.issue,
            Some(PublishOutputValidationIssue::WindowsDriveRootMissing)
        );
        assert_eq!(result.access.status, PublishOutputAccessStatus::Skipped);
        assert_eq!(result.access.protected_location, None);
        assert_eq!(result.access.protected_root, None);
        assert_eq!(result.access.probe_directory, None);
        assert_eq!(result.access.detail, None);
    }

    #[test]
    fn preflight_publish_output_should_return_not_applicable_access_for_valid_posix_output() {
        let mut parameters = BTreeMap::new();
        parameters.insert(
            "output".to_string(),
            SpecValue::String("./publish/linux-x64".to_string()),
        );

        let result = preflight_publish_output_for_test(
            &PublishSpec {
                version: SPEC_VERSION,
                provider_id: "dotnet".to_string(),
                project_path: "/repo/App.csproj".to_string(),
                parameters,
            },
            TestPlatform::Posix,
            true,
            |_output_dir| PublishOutputAccess::not_applicable(),
        );

        assert_eq!(
            result.validation.status,
            PublishOutputValidationStatus::Compatible
        );
        assert_eq!(result.validation.issue, None);
        assert_eq!(
            result.access.status,
            PublishOutputAccessStatus::NotApplicable
        );
        assert_eq!(result.access.protected_location, None);
        assert_eq!(result.access.protected_root, None);
        assert_eq!(result.access.probe_directory, None);
        assert_eq!(result.access.detail, None);
    }

    #[test]
    fn preflight_publish_output_should_return_denied_access_when_probe_fails_for_protected_root() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let protected_root =
            std::env::temp_dir().join(format!("one-publish-protected-root-{stamp}"));
        let output_dir = protected_root.join("publish").join("App").join("Release");
        fs::create_dir_all(protected_root.join("publish")).expect("create publish root");
        let roots = vec![ProtectedRoot {
            location: ProtectedDirectoryLocation::Downloads,
            path: protected_root.clone(),
        }];
        let mut parameters = BTreeMap::new();
        parameters.insert(
            "output".to_string(),
            SpecValue::String("publish/App/Release".to_string()),
        );

        let result = preflight_publish_output_for_test(
            &PublishSpec {
                version: SPEC_VERSION,
                provider_id: "dotnet".to_string(),
                project_path: protected_root
                    .join("App.csproj")
                    .to_string_lossy()
                    .to_string(),
                parameters,
            },
            TestPlatform::Macos,
            true,
            |resolved_output_dir| {
                evaluate_publish_output_access_for_roots(
                    resolved_output_dir,
                    &roots,
                    |_probe_directory| {
                        Err(io::Error::new(
                            ErrorKind::PermissionDenied,
                            "Operation not permitted",
                        ))
                    },
                )
            },
        );

        assert_eq!(
            result.validation.status,
            PublishOutputValidationStatus::Compatible
        );
        assert_eq!(result.output_dir, output_dir.to_string_lossy().to_string());
        assert_eq!(result.validation.issue, None);
        assert_eq!(result.access.status, PublishOutputAccessStatus::Denied);
        assert_eq!(
            result.access.protected_location,
            Some(ProtectedDirectoryLocation::Downloads)
        );
        assert_eq!(
            result.access.protected_root,
            Some(protected_root.to_string_lossy().to_string())
        );
        assert_eq!(
            result.access.probe_directory,
            Some(protected_root.join("publish").to_string_lossy().to_string())
        );
        assert_eq!(
            result.access.detail,
            Some("Operation not permitted".to_string())
        );

        fs::remove_dir_all(&protected_root).ok();
    }

    #[test]
    fn preflight_publish_output_should_keep_empty_output_not_applicable() {
        let result = preflight_publish_output(&PublishSpec {
            version: SPEC_VERSION,
            provider_id: "custom".to_string(),
            project_path: "repo/App.csproj".to_string(),
            parameters: BTreeMap::new(),
        });

        assert_eq!(
            result.validation.status,
            PublishOutputValidationStatus::NotApplicable
        );
        assert_eq!(result.validation.issue, None);
        assert_eq!(
            result.access.status,
            PublishOutputAccessStatus::NotApplicable
        );
        assert_eq!(result.output_dir, "");
        assert_eq!(result.configured_output_dir, None);
    }
}
