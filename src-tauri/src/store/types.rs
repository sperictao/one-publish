use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use ts_rs::TS;

pub const PUBLISH_CONFIGURATION_CONTRACT_VERSION: u32 = 1;
pub const CURRENT_SETTINGS_VERSION: u32 = 1;

static CONFIGURATION_ID_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub(crate) fn new_configuration_identity(kind: &str) -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let sequence = CONFIGURATION_ID_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("{kind}-{timestamp:x}-{:x}-{sequence:x}", std::process::id())
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct Branch {
    pub name: String,
    pub is_main: bool,
    pub is_current: bool,
    pub path: String,
    pub commit_count: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct Repository {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(default)]
    pub project_file: Option<String>,
    pub current_branch: String,
    pub branches: Vec<Branch>,
    #[serde(default)]
    pub is_main: bool,
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub publish_config: RepoPublishConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(rename_all = "camelCase")]
pub struct PublishConfigStore {
    pub configuration: String,
    pub runtime: String,
    pub framework: String,
    pub self_contained: bool,
    pub output_dir: String,
    pub no_build: bool,
    pub no_restore: bool,
    pub verbosity: String,
    pub no_logo: bool,
    pub delete_existing_files: bool,
    pub properties: BTreeMap<String, String>,
    pub use_profile: bool,
    pub profile_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ConfigProfile {
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub profile_group: Option<String>,
    pub created_at: String,
    pub is_system_default: bool,
    #[serde(default)]
    pub current_revision_id: String,
    #[serde(default)]
    pub revisions: Vec<PublishConfigurationRevision>,
    #[serde(default)]
    pub deleted_at: Option<String>,
    #[serde(default)]
    pub blocked_reason: Option<String>,
    #[serde(default, rename = "providerId", skip_serializing)]
    #[ts(skip)]
    pub(crate) legacy_provider_id: Option<String>,
    #[serde(default, rename = "parameters", skip_serializing)]
    #[ts(skip)]
    pub(crate) legacy_parameters: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct PublishConfigurationRevision {
    pub id: String,
    pub sequence: u32,
    pub created_at: String,
    #[serde(default = "default_configuration_contract_version")]
    pub contract_version: u32,
    pub provider_id: String,
    #[serde(default = "unknown_provider_version")]
    pub provider_version: String,
    #[serde(default = "default_settings_version")]
    pub settings_version: u32,
    pub parameters: serde_json::Value,
}

impl PublishConfigurationRevision {
    fn new_current(
        provider_id: String,
        parameters: serde_json::Value,
        created_at: String,
        sequence: u32,
    ) -> Self {
        let provider_version = crate::provider::registry::ProviderRegistry::new()
            .get(&provider_id)
            .map(|provider| provider.manifest().version.clone())
            .unwrap_or_else(|_| "unknown".to_string());

        Self {
            id: new_configuration_identity("configuration-revision"),
            sequence,
            created_at,
            contract_version: PUBLISH_CONFIGURATION_CONTRACT_VERSION,
            provider_id,
            provider_version,
            settings_version: CURRENT_SETTINGS_VERSION,
            parameters,
        }
    }

    fn new_imported(
        provider_id: String,
        parameters: serde_json::Value,
        created_at: String,
        contract_version: u32,
        provider_version: String,
        settings_version: u32,
    ) -> Self {
        Self {
            id: new_configuration_identity("configuration-revision"),
            sequence: 1,
            created_at,
            contract_version,
            provider_id,
            provider_version,
            settings_version,
            parameters,
        }
    }
}

fn default_configuration_contract_version() -> u32 {
    PUBLISH_CONFIGURATION_CONTRACT_VERSION
}

fn default_settings_version() -> u32 {
    CURRENT_SETTINGS_VERSION
}

fn unknown_provider_version() -> String {
    "unknown".to_string()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AutomationTriggerPolicy {
    #[serde(rename_all = "camelCase")]
    TagPush {
        tag_prefix: String,
    },
    Manual,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct AutomationBinding {
    pub id: String,
    pub configuration_id: String,
    pub configuration_revision_id: String,
    pub execution_backend_id: String,
    pub trigger_policy: AutomationTriggerPolicy,
    pub runtime_revision: String,
    pub external_identity: String,
    pub created_at: String,
    pub updated_at: String,
}

/// 每个执行后端最近一次成功应用的投影包状态，用于漂移检测与解除时的归属边界。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct AppliedProjectionBundle {
    pub backend_id: String,
    pub digest: String,
    pub files: Vec<String>,
    pub applied_at: String,
}

pub(crate) struct ConfigurationImport {
    pub name: String,
    pub provider_id: String,
    pub contract_version: u32,
    pub provider_version: String,
    pub settings_version: u32,
    pub parameters: serde_json::Value,
    pub profile_group: Option<String>,
    pub created_at: String,
    pub is_system_default: bool,
}

impl ConfigProfile {
    fn revision_blocked_reason(revision: &PublishConfigurationRevision) -> Option<String> {
        if revision.contract_version != PUBLISH_CONFIGURATION_CONTRACT_VERSION {
            return Some(format!(
                "configuration_contract_version_unsupported:{}",
                revision.contract_version
            ));
        }

        let registry = crate::provider::registry::ProviderRegistry::new();
        let provider = match registry.get(&revision.provider_id) {
            Ok(provider) => provider,
            Err(_) => return Some(format!("provider_unavailable:{}", revision.provider_id)),
        };

        if revision.provider_version != provider.manifest().version {
            return Some(format!(
                "provider_version_unsupported:{}",
                revision.provider_version
            ));
        }

        if revision.settings_version != CURRENT_SETTINGS_VERSION {
            return Some(format!(
                "settings_version_unsupported:{}",
                revision.settings_version
            ));
        }

        None
    }

    pub(crate) fn new(
        name: String,
        provider_id: String,
        parameters: serde_json::Value,
        profile_group: Option<String>,
        created_at: String,
        is_system_default: bool,
    ) -> Self {
        let id = new_configuration_identity("configuration");
        let revision = PublishConfigurationRevision::new_current(
            provider_id,
            parameters,
            created_at.clone(),
            1,
        );
        let revision_id = revision.id.clone();
        let blocked_reason = Self::revision_blocked_reason(&revision);

        Self {
            id,
            name,
            profile_group,
            created_at,
            is_system_default,
            current_revision_id: revision_id,
            revisions: vec![revision],
            deleted_at: None,
            blocked_reason,
            legacy_provider_id: None,
            legacy_parameters: None,
        }
    }

    pub(crate) fn new_imported(
        name: String,
        revision: PublishConfigurationRevision,
        profile_group: Option<String>,
        created_at: String,
        is_system_default: bool,
    ) -> Self {
        let current_revision_id = revision.id.clone();
        let blocked_reason = Self::revision_blocked_reason(&revision);

        Self {
            id: new_configuration_identity("configuration"),
            name,
            profile_group,
            created_at,
            is_system_default,
            current_revision_id,
            revisions: vec![revision],
            deleted_at: None,
            blocked_reason,
            legacy_provider_id: None,
            legacy_parameters: None,
        }
    }

    pub fn current_revision(&self) -> Option<&PublishConfigurationRevision> {
        self.revisions
            .iter()
            .find(|revision| revision.id == self.current_revision_id)
    }

    pub(crate) fn migrate_legacy_identity(&mut self) -> bool {
        let mut migrated = false;

        if self.id.is_empty() {
            self.id = new_configuration_identity("configuration");
            migrated = true;
        }

        if self.revisions.is_empty() {
            let provider_id = self
                .legacy_provider_id
                .take()
                .unwrap_or_else(|| "unknown".to_string());
            let parameters = self
                .legacy_parameters
                .take()
                .unwrap_or_else(|| serde_json::Value::Object(serde_json::Map::new()));
            let revision = PublishConfigurationRevision::new_current(
                provider_id,
                parameters,
                self.created_at.clone(),
                1,
            );
            self.current_revision_id = revision.id.clone();
            self.blocked_reason = Self::revision_blocked_reason(&revision);
            self.revisions.push(revision);
            migrated = true;
        } else {
            if self.current_revision().is_none() {
                if let Some(revision) = self
                    .revisions
                    .iter()
                    .max_by_key(|revision| revision.sequence)
                {
                    self.current_revision_id = revision.id.clone();
                    migrated = true;
                }
            }
            self.blocked_reason = self
                .current_revision()
                .and_then(Self::revision_blocked_reason);
            if self.legacy_provider_id.take().is_some() || self.legacy_parameters.take().is_some() {
                migrated = true;
            }
        }

        migrated
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ExecutionRecord {
    pub id: String,
    #[serde(default)]
    pub repo_id: Option<String>,
    #[serde(default)]
    pub configuration_id: Option<String>,
    #[serde(default)]
    pub configuration_revision_id: Option<String>,
    pub provider_id: String,
    pub project_path: String,
    pub started_at: String,
    pub finished_at: String,
    pub success: bool,
    #[serde(default)]
    pub cancelled: bool,
    pub output_dir: Option<String>,
    pub error: Option<String>,
    pub command_line: Option<String>,
    pub snapshot_path: Option<String>,
    pub failure_signature: Option<String>,
    #[serde(default)]
    pub output_excerpt: Option<String>,
    pub spec: Option<serde_json::Value>,
    #[serde(default)]
    pub file_count: usize,
    #[serde(default)]
    pub warnings: Option<Vec<String>>,
}

pub(crate) const DEFAULT_EXECUTION_HISTORY_LIMIT: usize = 20;
pub(crate) const MIN_EXECUTION_HISTORY_LIMIT: usize = 5;
pub(crate) const MAX_EXECUTION_HISTORY_LIMIT: usize = 200;
pub(crate) const MAX_RECENT_REPOSITORIES: usize = 6;
pub(crate) const MAX_RECENT_CONFIGS_PER_REPO: usize = 6;

pub(crate) fn default_execution_history_limit() -> usize {
    DEFAULT_EXECUTION_HISTORY_LIMIT
}

pub(crate) fn normalize_execution_history_limit(limit: usize) -> usize {
    limit.clamp(MIN_EXECUTION_HISTORY_LIMIT, MAX_EXECUTION_HISTORY_LIMIT)
}

pub(crate) fn trim_execution_history(history: &mut Vec<ExecutionRecord>, limit: usize) {
    let mut scoped_count: HashMap<String, usize> = HashMap::new();
    let mut retained = Vec::with_capacity(history.len());

    for record in history.iter() {
        let scope_key = record
            .repo_id
            .clone()
            .unwrap_or_else(|| "__legacy__".to_string());
        let count = scoped_count.entry(scope_key).or_insert(0);

        if *count >= limit {
            continue;
        }

        retained.push(record.clone());
        *count += 1;
    }

    *history = retained;
}

impl Default for PublishConfigStore {
    fn default() -> Self {
        Self {
            configuration: "Release".to_string(),
            runtime: String::new(),
            framework: String::new(),
            self_contained: false,
            output_dir: String::new(),
            no_build: false,
            no_restore: false,
            verbosity: String::new(),
            no_logo: false,
            delete_existing_files: false,
            properties: BTreeMap::new(),
            use_profile: false,
            profile_name: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct RepoPublishConfig {
    #[serde(default = "default_preset")]
    pub selected_preset: String,
    #[serde(default)]
    pub is_custom_mode: bool,
    #[serde(default)]
    pub custom_config: PublishConfigStore,
    #[serde(default)]
    pub profiles: Vec<ConfigProfile>,
    #[serde(default)]
    pub bindings: Vec<AutomationBinding>,
    #[serde(default)]
    pub applied_bundles: Vec<AppliedProjectionBundle>,
}

impl Default for RepoPublishConfig {
    fn default() -> Self {
        Self {
            selected_preset: default_preset(),
            is_custom_mode: false,
            custom_config: PublishConfigStore::default(),
            profiles: Vec::new(),
            bindings: Vec::new(),
            applied_bundles: Vec::new(),
        }
    }
}

impl RepoPublishConfig {
    pub(crate) fn is_default(&self) -> bool {
        self.selected_preset == default_preset() && !self.is_custom_mode && self.profiles.is_empty()
    }

    pub fn create_profile(
        &mut self,
        name: String,
        provider_id: String,
        parameters: serde_json::Value,
        profile_group: Option<String>,
        created_at: String,
    ) -> Result<&ConfigProfile, crate::errors::AppError> {
        if self
            .profiles
            .iter()
            .any(|profile| profile.deleted_at.is_none() && profile.name == name)
        {
            return Err(crate::errors::AppError::validation_with_code(
                format!("配置文件 '{}' 已存在", name),
                "profile_exists",
            ));
        }

        let profile = ConfigProfile::new(
            name,
            provider_id,
            parameters,
            profile_group
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            created_at,
            false,
        );
        self.profiles.push(profile);
        Ok(self.profiles.last().expect("profile was just appended"))
    }

    pub(crate) fn import_profile(
        &mut self,
        import: ConfigurationImport,
    ) -> Result<Option<&ConfigProfile>, crate::errors::AppError> {
        if self
            .profiles
            .iter()
            .any(|profile| profile.deleted_at.is_none() && profile.name == import.name)
        {
            return Ok(None);
        }

        let revision = PublishConfigurationRevision::new_imported(
            import.provider_id,
            import.parameters,
            import.created_at.clone(),
            import.contract_version,
            import.provider_version,
            import.settings_version,
        );
        let profile = ConfigProfile::new_imported(
            import.name,
            revision,
            import.profile_group,
            import.created_at,
            import.is_system_default,
        );
        self.profiles.push(profile);
        Ok(self.profiles.last())
    }

    pub fn profile(&self, profile_id: &str) -> Option<&ConfigProfile> {
        self.profiles
            .iter()
            .find(|profile| profile.id == profile_id)
    }

    pub fn active_profiles(&self) -> Vec<&ConfigProfile> {
        self.profiles
            .iter()
            .filter(|profile| profile.deleted_at.is_none())
            .collect()
    }

    pub fn reorder_profiles(
        &mut self,
        profiles: Vec<(String, Option<String>)>,
    ) -> Result<(), crate::errors::AppError> {
        let current_ids = self
            .active_profiles()
            .into_iter()
            .map(|profile| profile.id.clone())
            .collect::<Vec<_>>();
        let requested_ids = profiles
            .iter()
            .map(|(profile_id, _)| profile_id.clone())
            .collect::<Vec<_>>();
        let current_set = current_ids
            .iter()
            .cloned()
            .collect::<std::collections::BTreeSet<_>>();
        let requested_set = requested_ids
            .iter()
            .cloned()
            .collect::<std::collections::BTreeSet<_>>();
        if current_ids.len() != requested_ids.len() || current_set != requested_set {
            return Err(crate::errors::AppError::validation_with_code(
                "排序目标与当前配置列表不一致",
                "profile_order_mismatch",
            ));
        }

        let (active_profiles, tombstones): (Vec<_>, Vec<_>) = self
            .profiles
            .drain(..)
            .partition(|profile| profile.deleted_at.is_none());
        let mut active_by_id = active_profiles
            .into_iter()
            .map(|profile| (profile.id.clone(), profile))
            .collect::<BTreeMap<_, _>>();
        let mut reordered = profiles
            .into_iter()
            .filter_map(|(profile_id, profile_group)| {
                active_by_id.remove(&profile_id).map(|mut profile| {
                    profile.profile_group = profile_group
                        .map(|value| value.trim().to_string())
                        .filter(|value| !value.is_empty());
                    profile
                })
            })
            .collect::<Vec<_>>();
        reordered.extend(tombstones);
        self.profiles = reordered;
        Ok(())
    }

    pub fn select_profile(&mut self, profile_id: &str) -> Result<(), crate::errors::AppError> {
        if !self
            .profiles
            .iter()
            .any(|profile| profile.id == profile_id && profile.deleted_at.is_none())
        {
            return Err(crate::errors::AppError::validation_with_code(
                format!("未找到配置文件: {profile_id}"),
                "profile_not_found",
            ));
        }

        self.selected_preset = format!("userprofile:{profile_id}");
        self.is_custom_mode = true;
        Ok(())
    }

    pub fn delete_profile(
        &mut self,
        profile_id: &str,
        deleted_at: String,
    ) -> Result<(), crate::errors::AppError> {
        if self
            .bindings
            .iter()
            .any(|binding| binding.configuration_id == profile_id)
        {
            return Err(crate::errors::AppError::validation_with_code(
                "配置仍被外部自动化绑定引用，请先通过更新配置入口解除绑定",
                "profile_delete_blocked_by_binding",
            ));
        }

        let profile = self
            .profiles
            .iter_mut()
            .find(|profile| profile.id == profile_id && profile.deleted_at.is_none())
            .ok_or_else(|| {
                crate::errors::AppError::validation_with_code(
                    format!("未找到配置文件: {profile_id}"),
                    "profile_not_found",
                )
            })?;

        if profile.is_system_default {
            return Err(crate::errors::AppError::validation_with_code(
                "不能删除系统默认配置文件",
                "system_profile_immutable",
            ));
        }

        profile.deleted_at = Some(deleted_at);
        if self.selected_preset == format!("userprofile:{profile_id}") {
            self.selected_preset = default_preset();
        }
        Ok(())
    }

    pub fn update_profile(
        &mut self,
        profile_id: &str,
        name: String,
        provider_id: String,
        parameters: serde_json::Value,
        profile_group: Option<String>,
        updated_at: String,
    ) -> Result<(), crate::errors::AppError> {
        if self.profiles.iter().any(|profile| {
            profile.deleted_at.is_none() && profile.id != profile_id && profile.name == name
        }) {
            return Err(crate::errors::AppError::validation_with_code(
                format!("配置文件 '{}' 已存在", name),
                "profile_exists",
            ));
        }

        let profile = self
            .profiles
            .iter_mut()
            .find(|profile| profile.id == profile_id && profile.deleted_at.is_none())
            .ok_or_else(|| {
                crate::errors::AppError::validation_with_code(
                    format!("未找到配置文件: {profile_id}"),
                    "profile_not_found",
                )
            })?;

        if profile.is_system_default {
            return Err(crate::errors::AppError::validation_with_code(
                "不能编辑系统默认配置文件",
                "system_profile_immutable",
            ));
        }

        let current_revision = profile.current_revision().cloned().ok_or_else(|| {
            crate::errors::AppError::validation_with_code(
                format!("配置文件缺少当前修订: {profile_id}"),
                "profile_revision_not_found",
            )
        })?;
        let content_changed = current_revision.provider_id != provider_id
            || current_revision.parameters != parameters;

        profile.name = name;
        profile.profile_group = profile_group
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());

        if content_changed {
            let sequence = profile
                .revisions
                .iter()
                .map(|revision| revision.sequence)
                .max()
                .unwrap_or(0)
                + 1;
            let revision = PublishConfigurationRevision::new_current(
                provider_id,
                parameters,
                updated_at,
                sequence,
            );
            profile.current_revision_id = revision.id.clone();
            profile.blocked_reason = ConfigProfile::revision_blocked_reason(&revision);
            profile.revisions.push(revision);
        }

        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct AppState {
    #[serde(default)]
    pub repositories: Vec<Repository>,
    pub selected_repo_id: Option<String>,
    #[serde(default = "default_left_panel_width")]
    pub left_panel_width: i32,
    #[serde(default = "default_middle_panel_width")]
    pub middle_panel_width: i32,
    #[serde(default)]
    pub panel_widths_customized: bool,
    #[serde(default = "default_minimize_to_tray")]
    pub minimize_to_tray_on_close: bool,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default)]
    pub default_output_dir: String,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_execution_history_limit")]
    pub execution_history_limit: usize,
    #[serde(default = "default_environment_provider_ids")]
    pub environment_provider_ids: Vec<String>,
    #[serde(default)]
    pub recent_repo_ids: Vec<String>,
    #[serde(default)]
    pub recent_config_keys_by_repo: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    pub execution_history: Vec<ExecutionRecord>,
    #[serde(default)]
    pub startup_notice: Option<String>,
}

pub(crate) fn default_minimize_to_tray() -> bool {
    true
}

pub(crate) fn default_language() -> String {
    "zh".to_string()
}

pub(crate) fn default_theme() -> String {
    "auto".to_string()
}

pub(crate) fn default_environment_provider_ids() -> Vec<String> {
    vec!["dotnet".to_string()]
}

pub(crate) fn normalize_environment_provider_ids(provider_ids: Vec<String>) -> Vec<String> {
    let mut normalized = provider_ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect::<Vec<_>>();
    normalized.sort();
    normalized.dedup();

    if normalized.is_empty() {
        default_environment_provider_ids()
    } else {
        normalized
    }
}

pub(crate) fn default_left_panel_width() -> i32 {
    220
}

pub(crate) fn default_middle_panel_width() -> i32 {
    280
}

pub(crate) fn default_preset() -> String {
    "release-fd".to_string()
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            repositories: Vec::new(),
            selected_repo_id: None,
            left_panel_width: default_left_panel_width(),
            middle_panel_width: default_middle_panel_width(),
            panel_widths_customized: false,
            minimize_to_tray_on_close: default_minimize_to_tray(),
            language: default_language(),
            default_output_dir: String::new(),
            theme: default_theme(),
            execution_history_limit: default_execution_history_limit(),
            environment_provider_ids: default_environment_provider_ids(),
            recent_repo_ids: Vec::new(),
            recent_config_keys_by_repo: BTreeMap::new(),
            execution_history: Vec::new(),
            startup_notice: None,
        }
    }
}
