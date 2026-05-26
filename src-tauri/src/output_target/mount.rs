use std::path::{Path, PathBuf};

use super::{MountKind, OutputTarget};

#[cfg(target_os = "macos")]
const MOUNT_PREFIXES: &[&str] = &["/Volumes/"];

#[cfg(target_os = "linux")]
const MOUNT_PREFIXES: &[&str] = &["/mnt/", "/media/", "/run/user/"];

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
const MOUNT_PREFIXES: &[&str] = &[];

pub(super) fn detect_mounted_remote(raw: &str) -> Option<OutputTarget> {
    detect_with_prefixes(raw, MOUNT_PREFIXES)
}

pub(super) fn detect_with_prefixes(raw: &str, prefixes: &[&str]) -> Option<OutputTarget> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let path = Path::new(trimmed);
    if !path.is_absolute() {
        return None;
    }

    let normalized = trimmed.replace('\\', "/");
    let matched = prefixes
        .iter()
        .any(|prefix| has_mount_prefix(&normalized, prefix));
    if !matched {
        return None;
    }

    Some(OutputTarget::MountedRemote {
        kind: MountKind::Mounted,
        path: PathBuf::from(trimmed),
        fs_type: None,
    })
}

fn has_mount_prefix(path: &str, prefix: &str) -> bool {
    if !path.starts_with(prefix) {
        return false;
    }
    let remainder = &path[prefix.len()..];
    let Some(first_segment_end) = remainder.find('/') else {
        return !remainder.is_empty();
    };
    first_segment_end > 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_macos_volumes_path() {
        let target = detect_with_prefixes("/Volumes/build-share/publish", &["/Volumes/"])
            .expect("mounted remote");
        match target {
            OutputTarget::MountedRemote { kind, path, fs_type } => {
                assert_eq!(kind, MountKind::Mounted);
                assert_eq!(path.to_string_lossy(), "/Volumes/build-share/publish");
                assert!(fs_type.is_none());
            }
            _ => panic!("expected MountedRemote, got {:?}", target),
        }
    }

    #[test]
    fn detects_linux_mnt_path() {
        let target =
            detect_with_prefixes("/mnt/nas/out", &["/mnt/", "/media/"]).expect("mounted remote");
        match target {
            OutputTarget::MountedRemote { kind, .. } => assert_eq!(kind, MountKind::Mounted),
            _ => panic!("expected MountedRemote"),
        }
    }

    #[test]
    fn rejects_volumes_root() {
        assert!(detect_with_prefixes("/Volumes/", &["/Volumes/"]).is_none());
    }

    #[test]
    fn rejects_volumes_with_empty_share() {
        assert!(detect_with_prefixes("/Volumes//foo", &["/Volumes/"]).is_none());
    }

    #[test]
    fn rejects_non_matching_prefix() {
        assert!(detect_with_prefixes("/Users/x/out", &["/Volumes/", "/mnt/"]).is_none());
    }

    #[test]
    fn rejects_relative_path() {
        assert!(detect_with_prefixes("Volumes/share/out", &["/Volumes/"]).is_none());
    }
}
