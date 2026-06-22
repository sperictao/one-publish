use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use ts_rs::TS;

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
    pub name: String,
    pub provider_id: String,
    pub parameters: serde_json::Value,
    #[serde(default)]
    pub profile_group: Option<String>,
    pub created_at: String,
    pub is_system_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ExecutionRecord {
    pub id: String,
    #[serde(default)]
    pub repo_id: Option<String>,
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
}

impl Default for RepoPublishConfig {
    fn default() -> Self {
        Self {
            selected_preset: default_preset(),
            is_custom_mode: false,
            custom_config: PublishConfigStore::default(),
            profiles: Vec::new(),
        }
    }
}

impl RepoPublishConfig {
    pub(crate) fn is_default(&self) -> bool {
        self.selected_preset == default_preset() && !self.is_custom_mode && self.profiles.is_empty()
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
