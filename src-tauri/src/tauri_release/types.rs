use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

pub const RELEASE_STATE_VERSION: u32 = 1;
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

impl TauriBuildDriver {
    pub(crate) fn command(self) -> (&'static str, &'static [&'static str]) {
        match self {
            Self::Pnpm => ("pnpm", &["tauri", "build"]),
            Self::Npm => ("npm", &["run", "tauri", "--", "build"]),
            Self::Yarn => ("yarn", &["tauri", "build"]),
            Self::Bun => ("bun", &["tauri", "build"]),
            Self::Cargo => ("cargo", &["tauri", "build"]),
        }
    }

    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Pnpm => "pnpm",
            Self::Npm => "npm",
            Self::Yarn => "yarn",
            Self::Bun => "bun",
            Self::Cargo => "cargo",
        }
    }
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum TauriVersionSourceKind {
    TauriConfig,
    ReferencedPackageJson,
    CargoToml,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct TauriVersionSource {
    pub kind: TauriVersionSourceKind,
    pub path: String,
    pub selector: String,
    pub version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct TauriAppInspection {
    pub config_path: String,
    pub app_root: String,
    pub app_name: String,
    pub build_driver: TauriBuildDriver,
    pub version_source: TauriVersionSource,
    pub updater_enabled: bool,
    pub suggested_version_mirrors: Vec<VersionMirror>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct TauriRepositoryInspection {
    pub repository_path: String,
    pub apps: Vec<TauriAppInspection>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct VersionMirror {
    pub path: String,
    pub kind: VersionMirrorKind,
    pub selector: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct TauriUpdaterSettings {
    pub enabled: bool,
    pub endpoint: Option<String>,
    pub public_key: Option<String>,
    pub private_key_secret_name: Option<String>,
}

impl Default for TauriUpdaterSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            endpoint: None,
            public_key: None,
            private_key_secret_name: None,
        }
    }
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum ManagedWorkflowStatus {
    Missing,
    Current,
    Drifted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct WorkflowConflict {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ManagedWorkflowPreview {
    pub preview_id: String,
    pub path: String,
    pub status: ManagedWorkflowStatus,
    pub expected_content: String,
    pub current_content: Option<String>,
    pub diff: String,
    pub conflicts: Vec<WorkflowConflict>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct WorkflowTakeoverResult {
    pub workflow_path: String,
    pub removed_conflicts: Vec<String>,
    pub commit_sha: String,
    pub pushed_branch: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum PlatformSigningStatus {
    NotRequired,
    Unverified,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct TauriLocalBuildResult {
    pub publish: crate::commands::PublishResult,
    pub delivery_dir: String,
    pub assets: Vec<String>,
    pub git_head: String,
    pub worktree_dirty: bool,
    pub reproducible: bool,
    pub platform: String,
    pub architecture: String,
    pub platform_signing: PlatformSigningStatus,
    pub distribution_ready: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum GitHubRepositoryVisibility {
    Public,
    Private,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct GitHubRepositoryIdentity {
    pub owner: String,
    pub name: String,
    pub name_with_owner: String,
    pub origin_url: String,
    pub default_branch: String,
    pub visibility: GitHubRepositoryVisibility,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct TauriReleasePreflight {
    pub preflight_id: String,
    pub repository_id: String,
    pub repository_identity: GitHubRepositoryIdentity,
    pub head_sha: String,
    pub current_branch: String,
    pub current_version: String,
    pub version: String,
    pub tag: String,
    pub previous_tag: Option<String>,
    pub release_notes: String,
    pub workflow_status: ManagedWorkflowStatus,
    pub missing_secret_names: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct StartTauriGithubReleaseRequest {
    pub repository_id: String,
    pub preflight_id: String,
    pub version: String,
    pub release_notes: String,
    pub confirm_unsigned_release: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum ReleaseAttemptStage {
    Preparing,
    RunningGates,
    ReadyToPush,
    MonitoringWorkflow,
    Published,
    Failed,
    Cancelled,
}

impl ReleaseAttemptStage {
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Published | Self::Failed | Self::Cancelled)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ReleaseAttempt {
    pub id: String,
    pub repository_id: String,
    pub repository_identity: String,
    pub app_config_path: String,
    pub version: String,
    pub tag: String,
    pub release_commit_sha: Option<String>,
    pub stage: ReleaseAttemptStage,
    pub workflow_run_id: Option<String>,
    pub actions_url: Option<String>,
    pub release_url: Option<String>,
    #[serde(default)]
    pub release_asset_names: Vec<String>,
    pub signing_summary: String,
    pub updater_summary: String,
    pub retry_reason: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct TauriReleaseBackup {
    pub version: u32,
    pub exported_at: String,
    pub config: TauriReleaseConfig,
}
