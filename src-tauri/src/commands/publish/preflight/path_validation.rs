use std::path::{Component, Path, PathBuf};

use super::{PublishOutputValidation, PublishOutputValidationIssue, PublishOutputValidationStatus};
use crate::output_target::{parse_output_target, MountKind, OutputTarget};

pub(super) fn normalize_lexical_path(path: &Path) -> PathBuf {
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

pub(super) fn evaluate_publish_output_validation(
    configured_output_dir: Option<&str>,
    inferred_output_dir: &str,
) -> PublishOutputValidation {
    let path_to_check = configured_output_dir.unwrap_or(inferred_output_dir).trim();
    if path_to_check.is_empty() {
        return PublishOutputValidation::new(PublishOutputValidationStatus::NotApplicable, None);
    }

    if matches!(
        parse_output_target(path_to_check),
        OutputTarget::MountedRemote {
            kind: MountKind::Unc,
            ..
        } | OutputTarget::Remote(_)
    ) {
        return PublishOutputValidation::new(PublishOutputValidationStatus::Compatible, None);
    }

    match detect_output_path_validation_issue(path_to_check) {
        Some(issue) => {
            PublishOutputValidation::new(PublishOutputValidationStatus::Incompatible, Some(issue))
        }
        None => PublishOutputValidation::new(PublishOutputValidationStatus::Compatible, None),
    }
}

pub(super) fn detect_output_path_validation_issue(
    path: &str,
) -> Option<PublishOutputValidationIssue> {
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
pub(super) fn detect_windows_output_path_validation_issue(
    path: &str,
) -> Option<PublishOutputValidationIssue> {
    if looks_like_posix_absolute_path(path) {
        return Some(PublishOutputValidationIssue::PosixAbsolutePathOnWindows);
    }

    if has_missing_windows_drive_root(path) {
        return Some(PublishOutputValidationIssue::WindowsDriveRootMissing);
    }

    None
}

pub(super) fn looks_like_unc_path(path: &str) -> bool {
    let trimmed = path.trim();
    trimmed.starts_with("\\\\") || trimmed.starts_with("//")
}

pub(super) fn looks_like_windows_path(path: &str) -> bool {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return false;
    }

    if looks_like_unc_path(trimmed) {
        return false;
    }

    let bytes = trimmed.as_bytes();
    let has_drive_prefix = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/');

    has_drive_prefix || trimmed.contains('\\')
}

#[cfg_attr(not(any(test, target_os = "windows")), allow(dead_code))]
pub(super) fn looks_like_windows_absolute_path(path: &str) -> bool {
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
pub(super) fn looks_like_posix_absolute_path(path: &str) -> bool {
    let trimmed = path.trim();
    trimmed.starts_with('/') && !trimmed.starts_with("//")
}

#[cfg(target_os = "windows")]
pub(super) fn has_missing_windows_drive_root(path: &str) -> bool {
    windows_absolute_root(Path::new(path)).is_some_and(|root| !root.exists())
}

#[cfg(target_os = "windows")]
pub(super) fn windows_absolute_root(path: &Path) -> Option<PathBuf> {
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
    use super::super::{PublishOutputValidationIssue, PublishOutputValidationStatus};
    use super::*;

    #[test]
    fn normalize_lexical_path_collapses_dot_and_parent_segments() {
        assert_eq!(
            normalize_lexical_path(Path::new("/a/./b/../c")),
            PathBuf::from("/a/c")
        );
        assert_eq!(
            normalize_lexical_path(Path::new("a/../b")),
            PathBuf::from("b")
        );
        assert_eq!(
            normalize_lexical_path(Path::new("/a/../../b")),
            PathBuf::from("/b")
        );
    }

    #[test]
    fn normalize_lexical_path_drops_unresolvable_parent_prefix() {
        assert_eq!(
            normalize_lexical_path(Path::new("../x")),
            PathBuf::from("x")
        );
        assert_eq!(normalize_lexical_path(Path::new("./x")), PathBuf::from("x"));
    }

    #[test]
    fn unc_path_detection_covers_backslash_and_forward_slash_forms() {
        for path in ["\\\\srv\\sh", "//srv/sh", "  //srv/sh  "] {
            assert!(looks_like_unc_path(path), "{path:?}");
        }
        for path in ["", "/single", "C:\\x", "relative\\x"] {
            assert!(!looks_like_unc_path(path), "{path:?}");
        }
    }

    #[test]
    fn windows_path_detection_covers_drive_and_backslash_forms() {
        for path in ["C:\\out", "C:/out", "z:\\x", "nested\\dir", "  C:\\out  "] {
            assert!(looks_like_windows_path(path), "{path:?}");
        }
    }

    #[test]
    fn windows_path_detection_rejects_posix_relative_and_unc_forms() {
        for path in [
            "",
            "   ",
            "/posix/out",
            "D:",
            "C:x",
            "\\\\srv\\sh",
            "//srv/sh",
        ] {
            assert!(!looks_like_windows_path(path), "{path:?}");
        }
    }

    #[test]
    fn windows_absolute_path_requires_drive_root_or_unc_backslashes() {
        for path in ["C:\\out", "C:/out", "\\\\srv\\sh"] {
            assert!(looks_like_windows_absolute_path(path), "{path:?}");
        }
        for path in ["", "   ", "nested\\dir", "//srv/sh", "/posix/out", "C:x"] {
            assert!(!looks_like_windows_absolute_path(path), "{path:?}");
        }
    }

    #[test]
    fn posix_absolute_path_excludes_forward_slash_unc() {
        for path in ["/abs", "/a/b/", " /spaced "] {
            assert!(looks_like_posix_absolute_path(path), "{path:?}");
        }
        for path in ["", "//remote", "relative", "\\\\srv"] {
            assert!(!looks_like_posix_absolute_path(path), "{path:?}");
        }
    }

    #[test]
    fn evaluate_validation_is_not_applicable_for_blank_output_dir() {
        assert_eq!(
            evaluate_publish_output_validation(None, "   ").status,
            PublishOutputValidationStatus::NotApplicable
        );
        // A blank configured dir overrides the inferred dir entirely.
        assert_eq!(
            evaluate_publish_output_validation(Some("  "), "/inferred/out").status,
            PublishOutputValidationStatus::NotApplicable
        );
    }

    #[test]
    fn evaluate_validation_prefers_configured_output_dir() {
        let result = evaluate_publish_output_validation(Some("/conf/out"), "/inferred");
        assert_eq!(result.status, PublishOutputValidationStatus::Compatible);
        assert_eq!(result.issue, None);

        #[cfg(not(target_os = "windows"))]
        {
            let result = evaluate_publish_output_validation(Some("C:\\out"), "/inferred");
            assert_eq!(result.status, PublishOutputValidationStatus::Incompatible);
            assert_eq!(
                result.issue,
                Some(PublishOutputValidationIssue::WindowsStylePathOnPosix)
            );
        }
    }

    #[test]
    fn evaluate_validation_accepts_remote_targets_without_local_checks() {
        for output_dir in ["\\\\nas\\share", "s3://bucket/prefix"] {
            let result = evaluate_publish_output_validation(None, output_dir);
            assert_eq!(
                result.status,
                PublishOutputValidationStatus::Compatible,
                "{output_dir:?}"
            );
            assert_eq!(result.issue, None);
        }
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn non_windows_detect_flags_windows_style_paths_only() {
        assert_eq!(
            detect_output_path_validation_issue("C:\\out"),
            Some(PublishOutputValidationIssue::WindowsStylePathOnPosix)
        );
        assert_eq!(
            detect_output_path_validation_issue("nested\\dir"),
            Some(PublishOutputValidationIssue::WindowsStylePathOnPosix)
        );
        assert_eq!(detect_output_path_validation_issue("/posix/out"), None);
        assert_eq!(detect_output_path_validation_issue("relative/out"), None);
    }
}
