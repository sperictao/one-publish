mod access;
mod path_validation;

use access::evaluate_publish_output_access;
pub(crate) use access::{is_protected_root_output_dir, protected_location_for_output_dir};
use path_validation::evaluate_publish_output_validation;

use super::output::{configured_output_dir, infer_output_dir, should_delete_existing_files};
use crate::output_target::{parse_output_target, MountKind, OutputTarget, RemoteUri};
use crate::spec::PublishSpec;
use serde::Serialize;
use std::path::Path;
use ts_rs::TS;

const REMOTE_PROBE_PENDING_DETAIL: &str = "remote_probe_pending";

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum RemoteLocationKind {
    Unc,
    Mounted,
    Remote,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct RemoteLocationSummary {
    pub kind: RemoteLocationKind,
    pub display: String,
    pub host: Option<String>,
    pub scheme: Option<String>,
    pub fs_type: Option<String>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_location: Option<RemoteLocationSummary>,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PublishOutputAccessIntent {
    WriteOutput,
    WriteOutputParent,
    CleanExistingOutput,
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
            remote_location: None,
        }
    }

    fn not_applicable() -> Self {
        Self {
            status: PublishOutputAccessStatus::NotApplicable,
            protected_location: None,
            protected_root: None,
            probe_directory: None,
            detail: None,
            remote_location: None,
        }
    }

    fn granted(location: ProtectedDirectoryLocation, root: &Path, probe_directory: &Path) -> Self {
        Self {
            status: PublishOutputAccessStatus::Granted,
            protected_location: Some(location),
            protected_root: Some(root.to_string_lossy().to_string()),
            probe_directory: Some(probe_directory.to_string_lossy().to_string()),
            detail: None,
            remote_location: None,
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
            remote_location: None,
        }
    }

    fn mounted_remote_granted(summary: RemoteLocationSummary) -> Self {
        Self {
            status: PublishOutputAccessStatus::Granted,
            protected_location: None,
            protected_root: None,
            probe_directory: None,
            detail: None,
            remote_location: Some(summary),
        }
    }

    fn remote_skipped(summary: RemoteLocationSummary) -> Self {
        Self {
            status: PublishOutputAccessStatus::Skipped,
            protected_location: None,
            protected_root: None,
            probe_directory: None,
            detail: Some(REMOTE_PROBE_PENDING_DETAIL.to_string()),
            remote_location: Some(summary),
        }
    }
}

impl RemoteLocationSummary {
    fn from_mounted_remote(kind: MountKind, path: &Path, fs_type: Option<&str>) -> Self {
        let (location_kind, host) = match kind {
            MountKind::Unc => (
                RemoteLocationKind::Unc,
                extract_unc_host(&path.to_string_lossy()),
            ),
            MountKind::Mounted => (RemoteLocationKind::Mounted, None),
        };
        Self {
            kind: location_kind,
            display: path.to_string_lossy().to_string(),
            host,
            scheme: None,
            fs_type: fs_type.map(str::to_string),
        }
    }

    fn from_remote(uri: &RemoteUri) -> Self {
        let mut display = format!("{}://{}", uri.scheme, uri.host);
        if let Some(port) = uri.port {
            display.push_str(&format!(":{port}"));
        }
        if !uri.path.is_empty() {
            if !uri.path.starts_with('/') {
                display.push('/');
            }
            display.push_str(&uri.path);
        }
        Self {
            kind: RemoteLocationKind::Remote,
            display,
            host: Some(uri.host.clone()),
            scheme: Some(uri.scheme.clone()),
            fs_type: None,
        }
    }
}

fn extract_unc_host(path: &str) -> Option<String> {
    let stripped = path
        .strip_prefix("\\\\")
        .or_else(|| path.strip_prefix("//"))?;
    let host: String = stripped
        .chars()
        .take_while(|c| *c != '\\' && *c != '/')
        .collect();
    if host.is_empty() {
        None
    } else {
        Some(host)
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
    let access_intent = resolve_publish_output_access_intent(spec);
    let validation = evaluate_publish_output_validation(
        context.configured_output_dir.as_deref(),
        &context.output_dir,
    );
    let access = if validation.status == PublishOutputValidationStatus::Incompatible {
        PublishOutputAccess::skipped()
    } else {
        let raw_output = context
            .configured_output_dir
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(context.output_dir.as_str());
        match parse_output_target(raw_output) {
            OutputTarget::MountedRemote {
                kind,
                path,
                fs_type,
            } => PublishOutputAccess::mounted_remote_granted(
                RemoteLocationSummary::from_mounted_remote(kind, &path, fs_type.as_deref()),
            ),
            OutputTarget::Remote(uri) => {
                PublishOutputAccess::remote_skipped(RemoteLocationSummary::from_remote(&uri))
            }
            OutputTarget::Local(_) => {
                evaluate_publish_output_access(&context.output_dir, access_intent)
            }
        }
    };

    PublishOutputPreflightResult::new(
        context.output_dir,
        context.configured_output_dir,
        validation,
        access,
    )
}

fn resolve_publish_output_access_intent(spec: &PublishSpec) -> PublishOutputAccessIntent {
    if should_delete_existing_files(spec) {
        return PublishOutputAccessIntent::CleanExistingOutput;
    }

    if spec.provider_id == "dotnet" {
        return PublishOutputAccessIntent::WriteOutputParent;
    }

    PublishOutputAccessIntent::WriteOutput
}

fn resolve_publish_output_context(spec: &PublishSpec) -> PublishOutputContext {
    let output_dir = infer_output_dir(spec);
    let configured_output_dir = configured_output_dir(spec);

    PublishOutputContext {
        output_dir,
        configured_output_dir,
    }
}

#[cfg(test)]
mod tests {
    use super::access::{
        evaluate_publish_output_access_for_roots, find_protected_root_for_path,
        is_protected_root_path, resolve_existing_probe_directory, resolve_probe_directory,
        ProtectedRoot,
    };
    use super::path_validation::{
        looks_like_posix_absolute_path, looks_like_windows_absolute_path, looks_like_windows_path,
        normalize_lexical_path,
    };
    use super::{
        preflight_publish_output, resolve_publish_output_context, ProtectedDirectoryLocation,
        PublishOutputAccess, PublishOutputAccessIntent, PublishOutputAccessStatus,
        PublishOutputPreflightResult, PublishOutputValidation, PublishOutputValidationIssue,
        PublishOutputValidationStatus, RemoteLocationKind, RemoteLocationSummary,
        REMOTE_PROBE_PENDING_DETAIL,
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

        use crate::output_target::{parse_output_target, MountKind, OutputTarget};
        if matches!(
            parse_output_target(path_to_check),
            OutputTarget::MountedRemote {
                kind: MountKind::Unc,
                ..
            } | OutputTarget::Remote(_)
        ) {
            return PublishOutputValidation::new(PublishOutputValidationStatus::Compatible, None);
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
        use crate::output_target::{parse_output_target, OutputTarget};
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
            let raw_output = context
                .configured_output_dir
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or(context.output_dir.as_str());
            match parse_output_target(raw_output) {
                OutputTarget::MountedRemote {
                    kind,
                    path,
                    fs_type,
                } => PublishOutputAccess::mounted_remote_granted(
                    RemoteLocationSummary::from_mounted_remote(kind, &path, fs_type.as_deref()),
                ),
                OutputTarget::Remote(uri) => {
                    PublishOutputAccess::remote_skipped(RemoteLocationSummary::from_remote(&uri))
                }
                OutputTarget::Local(_) => evaluate_access(&context.output_dir),
            }
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
    fn detects_exact_protected_root_path() {
        let roots = vec![ProtectedRoot {
            location: ProtectedDirectoryLocation::Downloads,
            path: "/Users/test/Downloads".into(),
        }];

        assert!(is_protected_root_path(
            Path::new("/Users/test/Downloads"),
            &roots
        ));
        assert!(!is_protected_root_path(
            Path::new("/Users/test/Downloads/publish/App"),
            &roots
        ));
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
    fn resolves_cleanup_probe_directory_to_output_parent_when_output_exists() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("one-publish-cleanup-probe-root-{stamp}"));
        let output_dir = root.join("publish").join("App").join("Debug");
        fs::create_dir_all(&output_dir).expect("create output dir");

        let probe = resolve_probe_directory(
            &output_dir,
            &root,
            PublishOutputAccessIntent::CleanExistingOutput,
        );

        assert_eq!(probe, output_dir.parent().expect("output parent"));

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn resolves_dotnet_publish_probe_directory_to_output_parent_when_output_exists() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("one-publish-dotnet-probe-root-{stamp}"));
        let output_dir = root.join("publish").join("App").join("Debug");
        fs::create_dir_all(&output_dir).expect("create output dir");

        let probe = resolve_probe_directory(
            &output_dir,
            &root,
            PublishOutputAccessIntent::WriteOutputParent,
        );

        assert_eq!(probe, output_dir.parent().expect("output parent"));

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
                    PublishOutputAccessIntent::WriteOutput,
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
    fn preflight_publish_output_should_probe_parent_when_cleanup_is_enabled() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let protected_root = std::env::temp_dir().join(format!("one-publish-cleanup-root-{stamp}"));
        let output_dir = protected_root.join("publish").join("App").join("Debug");
        fs::create_dir_all(&output_dir).expect("create output dir");
        let roots = vec![ProtectedRoot {
            location: ProtectedDirectoryLocation::Downloads,
            path: protected_root.clone(),
        }];

        let access = evaluate_publish_output_access_for_roots(
            &output_dir.to_string_lossy(),
            PublishOutputAccessIntent::CleanExistingOutput,
            &roots,
            |probe_directory| {
                assert_eq!(probe_directory, output_dir.parent().expect("output parent"));
                Err(io::Error::new(
                    ErrorKind::PermissionDenied,
                    "Operation not permitted",
                ))
            },
        );

        assert_eq!(access.status, PublishOutputAccessStatus::Denied);
        assert_eq!(
            access.probe_directory,
            Some(
                output_dir
                    .parent()
                    .expect("output parent")
                    .to_string_lossy()
                    .to_string()
            )
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

    #[test]
    fn looks_like_unc_path_recognises_windows_and_posix_unc() {
        use super::path_validation::looks_like_unc_path;
        assert!(looks_like_unc_path(r"\\nas01\share\publish"));
        assert!(looks_like_unc_path("//nas01/share/publish"));
        assert!(!looks_like_unc_path(r"C:\publish"));
        assert!(!looks_like_unc_path("/Users/demo/publish"));
        assert!(!looks_like_unc_path("./publish/win-x64"));
        assert!(!looks_like_unc_path("sftp://nas01/publish"));
    }

    #[test]
    fn looks_like_windows_path_no_longer_matches_unc() {
        assert!(!looks_like_windows_path(r"\\nas01\share\publish"));
        assert!(!looks_like_windows_path("//nas01/share/publish"));
        assert!(looks_like_windows_path(r"D:\publish"));
        assert!(looks_like_windows_path(r".\publish"));
    }

    #[test]
    fn preflight_publish_output_should_accept_unc_path_on_posix() {
        let mut parameters = BTreeMap::new();
        parameters.insert(
            "output".to_string(),
            SpecValue::String(r"\\nas01\share\publish".to_string()),
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
            |_output_dir| PublishOutputAccess::not_applicable(),
        );

        assert_eq!(
            result.validation.status,
            PublishOutputValidationStatus::Compatible
        );
        assert_eq!(result.validation.issue, None);
    }

    #[test]
    fn preflight_publish_output_should_accept_posix_style_unc_on_macos() {
        let mut parameters = BTreeMap::new();
        parameters.insert(
            "output".to_string(),
            SpecValue::String("//nas01/share/publish".to_string()),
        );

        let result = preflight_publish_output_for_test(
            &PublishSpec {
                version: SPEC_VERSION,
                provider_id: "dotnet".to_string(),
                project_path: "repo/App.csproj".to_string(),
                parameters,
            },
            TestPlatform::Macos,
            true,
            |_output_dir| PublishOutputAccess::not_applicable(),
        );

        assert_eq!(
            result.validation.status,
            PublishOutputValidationStatus::Compatible
        );
        assert_eq!(result.validation.issue, None);
    }

    #[test]
    fn preflight_publish_output_should_accept_unc_path_on_windows() {
        let mut parameters = BTreeMap::new();
        parameters.insert(
            "output".to_string(),
            SpecValue::String(r"\\nas01\share\publish".to_string()),
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
    }

    #[test]
    fn preflight_publish_output_should_accept_sftp_scheme_on_posix() {
        let mut parameters = BTreeMap::new();
        parameters.insert(
            "output".to_string(),
            SpecValue::String("sftp://deploy@nas01/srv/publish".to_string()),
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
            |_output_dir| PublishOutputAccess::not_applicable(),
        );

        assert_eq!(
            result.validation.status,
            PublishOutputValidationStatus::Compatible
        );
        assert_eq!(result.validation.issue, None);
    }

    #[test]
    fn preflight_publish_output_should_accept_s3_scheme_on_windows() {
        let mut parameters = BTreeMap::new();
        parameters.insert(
            "output".to_string(),
            SpecValue::String("s3://release-bucket/app/".to_string()),
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
    }

    #[test]
    fn preflight_publish_output_should_still_flag_windows_path_on_posix_for_relative() {
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
    }

    #[test]
    fn preflight_publish_output_grants_mounted_remote_for_unc_with_summary() {
        let mut parameters = BTreeMap::new();
        parameters.insert(
            "output".to_string(),
            SpecValue::String(r"\\nas01\releases\app".to_string()),
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
            |_output_dir| panic!("mounted remote should skip local access probe"),
        );

        assert_eq!(result.access.status, PublishOutputAccessStatus::Granted);
        assert_eq!(result.access.protected_location, None);
        assert_eq!(result.access.protected_root, None);
        assert_eq!(result.access.probe_directory, None);
        assert_eq!(result.access.detail, None);

        let summary = result
            .access
            .remote_location
            .expect("expected remote_location for UNC target");
        assert_eq!(summary.kind, RemoteLocationKind::Unc);
        assert_eq!(summary.host.as_deref(), Some("nas01"));
        assert_eq!(summary.scheme, None);
        assert_eq!(summary.fs_type, None);
        assert!(summary.display.starts_with(r"\\nas01"));
    }

    #[test]
    fn preflight_publish_output_skips_remote_target_with_summary() {
        let mut parameters = BTreeMap::new();
        parameters.insert(
            "output".to_string(),
            SpecValue::String("sftp://deploy@host:22/var/www".to_string()),
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
            |_output_dir| panic!("remote target should skip local access probe"),
        );

        assert_eq!(result.access.status, PublishOutputAccessStatus::Skipped);
        assert_eq!(
            result.access.detail.as_deref(),
            Some(REMOTE_PROBE_PENDING_DETAIL)
        );

        let summary = result
            .access
            .remote_location
            .expect("expected remote_location for sftp target");
        assert_eq!(summary.kind, RemoteLocationKind::Remote);
        assert_eq!(summary.scheme.as_deref(), Some("sftp"));
        assert_eq!(summary.host.as_deref(), Some("host"));
        assert_eq!(summary.display, "sftp://host:22/var/www");
    }

    #[test]
    fn remote_location_summary_strips_password_from_display() {
        use crate::output_target::{parse_output_target, OutputTarget};
        match parse_output_target("sftp://deploy:secret@host/path") {
            OutputTarget::Remote(uri) => {
                let summary = RemoteLocationSummary::from_remote(&uri);
                assert!(!summary.display.contains("secret"));
                assert!(!summary.display.contains("deploy"));
                assert_eq!(summary.host.as_deref(), Some("host"));
            }
            other => panic!("expected Remote, got {:?}", other),
        }
    }

    #[test]
    fn preflight_publish_output_local_path_keeps_remote_location_none() {
        let result = preflight_publish_output(&PublishSpec {
            version: SPEC_VERSION,
            provider_id: "custom".to_string(),
            project_path: "repo/App.csproj".to_string(),
            parameters: BTreeMap::new(),
        });
        assert!(result.access.remote_location.is_none());
    }
}
