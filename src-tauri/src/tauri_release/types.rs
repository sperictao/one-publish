use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

pub const MANAGED_WORKFLOW_VERSION: u32 = 1;
pub const MANAGED_WORKFLOW_PATH: &str = ".github/workflows/one-publish-tauri-release.yml";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum TauriBuildDriver {
    Pnpm,
    Npm,
    Yarn,
    Bun,
    Cargo,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum TauriDesktopTarget {
    WindowsX64,
    LinuxX64,
    MacosX64,
    MacosArm64,
    MacosUniversal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ReleaseGate {
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum VersionMirrorKind {
    JsonPointer,
    TomlKey,
    CargoLockPackage,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct VersionMirror {
    pub path: String,
    pub kind: VersionMirrorKind,
    pub selector: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct TauriUpdaterSettings {
    pub enabled: bool,
    pub endpoint: Option<String>,
    pub public_key: Option<String>,
    pub private_key_secret_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct TauriReleaseConfig {
    pub app_config_path: String,
    pub app_name: String,
    pub build_driver: TauriBuildDriver,
    pub enabled_targets: Vec<TauriDesktopTarget>,
    pub release_asset_patterns: Vec<String>,
    pub updater: TauriUpdaterSettings,
    pub allow_unsigned_release: bool,
    pub required_actions_secret_names: Vec<String>,
    #[serde(default)]
    pub actions_secret_environment: BTreeMap<String, String>,
    pub tag_prefix: String,
    pub release_gates: Vec<ReleaseGate>,
    pub local_delivery_dir: String,
    pub version_mirrors: Vec<VersionMirror>,
    pub managed_workflow_version: u32,
}

impl Default for TauriReleaseConfig {
    fn default() -> Self {
        Self {
            app_config_path: "src-tauri/tauri.conf.json".to_string(),
            app_name: String::new(),
            build_driver: TauriBuildDriver::Pnpm,
            enabled_targets: vec![
                TauriDesktopTarget::WindowsX64,
                TauriDesktopTarget::LinuxX64,
                TauriDesktopTarget::MacosX64,
                TauriDesktopTarget::MacosArm64,
                TauriDesktopTarget::MacosUniversal,
            ],
            release_asset_patterns: vec![
                "*.dmg".to_string(),
                "*.msi".to_string(),
                "*-setup.exe".to_string(),
                "*.AppImage".to_string(),
                "*.deb".to_string(),
            ],
            updater: TauriUpdaterSettings::default(),
            allow_unsigned_release: false,
            required_actions_secret_names: Vec::new(),
            actions_secret_environment: BTreeMap::new(),
            tag_prefix: "v".to_string(),
            release_gates: Vec::new(),
            local_delivery_dir: "dist/one-publish".to_string(),
            version_mirrors: Vec::new(),
            managed_workflow_version: MANAGED_WORKFLOW_VERSION,
        }
    }
}
