use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::Serialize;
use ts_rs::TS;

mod mount;
mod scheme;
mod unc;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OutputTarget {
    Local(PathBuf),
    MountedRemote {
        kind: MountKind,
        path: PathBuf,
        fs_type: Option<String>,
    },
    Remote(RemoteUri),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MountKind {
    Unc,
    Mounted,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteUri {
    pub scheme: String,
    pub host: String,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub path: String,
    pub query: BTreeMap<String, String>,
}

pub fn parse_output_target(raw: &str) -> OutputTarget {
    let trimmed = raw.trim();

    if let Some(uri) = scheme::try_parse_remote(trimmed) {
        return OutputTarget::Remote(uri);
    }

    if let Some(unc_path) = unc::try_parse_unc(trimmed) {
        return OutputTarget::MountedRemote {
            kind: MountKind::Unc,
            path: unc_path,
            fs_type: None,
        };
    }

    if let Some(mounted) = mount::detect_mounted_remote(trimmed) {
        return mounted;
    }

    OutputTarget::Local(PathBuf::from(trimmed))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum OutputTargetKind {
    Local,
    MountedRemote,
    Remote,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum MountKindDescriptor {
    Unc,
    Mounted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct OutputTargetDescriptor {
    pub kind: OutputTargetKind,
    pub raw: String,
    pub path: Option<String>,
    pub mount_kind: Option<MountKindDescriptor>,
    pub fs_type: Option<String>,
    pub scheme: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub query: Option<BTreeMap<String, String>>,
}

impl OutputTargetDescriptor {
    pub fn from_target(raw: &str, target: &OutputTarget) -> Self {
        let raw_owned = raw.to_string();
        match target {
            OutputTarget::Local(path) => Self {
                kind: OutputTargetKind::Local,
                raw: raw_owned,
                path: Some(path.to_string_lossy().to_string()),
                mount_kind: None,
                fs_type: None,
                scheme: None,
                host: None,
                port: None,
                user: None,
                query: None,
            },
            OutputTarget::MountedRemote {
                kind,
                path,
                fs_type,
            } => Self {
                kind: OutputTargetKind::MountedRemote,
                raw: raw_owned,
                path: Some(path.to_string_lossy().to_string()),
                mount_kind: Some(match kind {
                    MountKind::Unc => MountKindDescriptor::Unc,
                    MountKind::Mounted => MountKindDescriptor::Mounted,
                }),
                fs_type: fs_type.clone(),
                scheme: None,
                host: None,
                port: None,
                user: None,
                query: None,
            },
            OutputTarget::Remote(uri) => Self {
                kind: OutputTargetKind::Remote,
                raw: raw_owned,
                path: Some(uri.path.clone()),
                mount_kind: None,
                fs_type: None,
                scheme: Some(uri.scheme.clone()),
                host: Some(uri.host.clone()),
                port: uri.port,
                user: uri.user.clone(),
                query: if uri.query.is_empty() {
                    None
                } else {
                    Some(uri.query.clone())
                },
            },
        }
    }
}

pub fn describe_output_target(raw: &str) -> OutputTargetDescriptor {
    let target = parse_output_target(raw);
    OutputTargetDescriptor::from_target(raw, &target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_posix_path_classified_as_local() {
        match parse_output_target("/Users/alice/build") {
            OutputTarget::Local(path) => {
                assert_eq!(path.to_string_lossy(), "/Users/alice/build");
            }
            other => panic!("expected Local, got {:?}", other),
        }
    }

    #[test]
    fn windows_drive_path_classified_as_local() {
        match parse_output_target("C:\\build\\out") {
            OutputTarget::Local(path) => {
                assert_eq!(path.to_string_lossy(), "C:\\build\\out");
            }
            other => panic!("expected Local, got {:?}", other),
        }
    }

    #[test]
    fn backslash_unc_classified_as_mounted_remote_unc() {
        match parse_output_target("\\\\nas01\\releases\\app") {
            OutputTarget::MountedRemote {
                kind,
                path,
                fs_type,
            } => {
                assert_eq!(kind, MountKind::Unc);
                assert_eq!(
                    path.to_string_lossy(),
                    "\\\\nas01\\releases\\app".to_string()
                );
                assert!(fs_type.is_none());
            }
            other => panic!("expected MountedRemote, got {:?}", other),
        }
    }

    #[test]
    fn forward_slash_unc_classified_as_mounted_remote_unc() {
        match parse_output_target("//nas01/releases/app") {
            OutputTarget::MountedRemote { kind, .. } => assert_eq!(kind, MountKind::Unc),
            other => panic!("expected MountedRemote, got {:?}", other),
        }
    }

    #[test]
    fn sftp_uri_classified_as_remote() {
        match parse_output_target("sftp://deploy@build.example.com:22/var/www/app") {
            OutputTarget::Remote(uri) => {
                assert_eq!(uri.scheme, "sftp");
                assert_eq!(uri.host, "build.example.com");
                assert_eq!(uri.port, Some(22));
                assert_eq!(uri.user.as_deref(), Some("deploy"));
                assert_eq!(uri.path, "/var/www/app");
            }
            other => panic!("expected Remote, got {:?}", other),
        }
    }

    #[test]
    fn s3_uri_preserves_query() {
        match parse_output_target("s3://bucket/prefix?region=ap-southeast-1") {
            OutputTarget::Remote(uri) => {
                assert_eq!(uri.scheme, "s3");
                assert_eq!(uri.host, "bucket");
                assert_eq!(
                    uri.query.get("region").map(String::as_str),
                    Some("ap-southeast-1")
                );
            }
            other => panic!("expected Remote, got {:?}", other),
        }
    }

    #[test]
    fn invalid_scheme_falls_back_to_local() {
        match parse_output_target("weird scheme://host") {
            OutputTarget::Local(_) => {}
            other => panic!("expected Local fallback, got {:?}", other),
        }
    }

    #[test]
    fn empty_string_classified_as_local() {
        match parse_output_target("") {
            OutputTarget::Local(path) => assert_eq!(path.to_string_lossy(), ""),
            other => panic!("expected Local, got {:?}", other),
        }
    }

    #[test]
    fn descriptor_uses_camel_case_fields() {
        let descriptor = describe_output_target("sftp://deploy@host/path");
        let json = serde_json::to_value(&descriptor).expect("serializes");
        let object = json.as_object().expect("object payload");
        assert!(object.contains_key("kind"));
        assert!(object.contains_key("mountKind"));
        assert!(object.contains_key("fsType"));
        assert!(object.contains_key("scheme"));
    }

    #[test]
    fn descriptor_kind_serializes_as_snake_case() {
        let local = describe_output_target("/Users/alice/build");
        let local_json = serde_json::to_value(&local).expect("local json");
        assert_eq!(local_json["kind"], "local");

        let unc = describe_output_target("\\\\nas01\\share\\out");
        let unc_json = serde_json::to_value(&unc).expect("unc json");
        assert_eq!(unc_json["kind"], "mounted_remote");
        assert_eq!(unc_json["mountKind"], "unc");

        let remote = describe_output_target("sftp://host/p");
        let remote_json = serde_json::to_value(&remote).expect("remote json");
        assert_eq!(remote_json["kind"], "remote");
    }

    #[test]
    fn whitespace_input_is_trimmed_before_parsing() {
        let descriptor = describe_output_target("  sftp://h/p  ");
        assert_eq!(descriptor.kind, OutputTargetKind::Remote);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_volumes_path_classified_as_mounted() {
        match parse_output_target("/Volumes/build-share/publish") {
            OutputTarget::MountedRemote { kind, .. } => assert_eq!(kind, MountKind::Mounted),
            other => panic!("expected MountedRemote on macOS, got {:?}", other),
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_mnt_path_classified_as_mounted() {
        match parse_output_target("/mnt/nas/out") {
            OutputTarget::MountedRemote { kind, .. } => assert_eq!(kind, MountKind::Mounted),
            other => panic!("expected MountedRemote on Linux, got {:?}", other),
        }
    }
}
