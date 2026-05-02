use super::recent::sanitize_recent_publish_state;
use super::types::{
    default_environment_provider_ids, default_execution_history_limit, default_language,
    default_left_panel_width, default_middle_panel_width, default_minimize_to_tray, default_preset,
    default_theme, normalize_environment_provider_ids, normalize_execution_history_limit,
    trim_execution_history, AppState, ConfigProfile, ExecutionRecord, PublishConfigStore,
    RepoPublishConfig, Repository,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredAppState {
    #[serde(default)]
    pub(crate) repositories: Vec<Repository>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) selected_repo_id: Option<String>,
    #[serde(default = "default_left_panel_width")]
    pub(crate) left_panel_width: i32,
    #[serde(default = "default_middle_panel_width")]
    pub(crate) middle_panel_width: i32,
    #[serde(default)]
    pub(crate) panel_widths_customized: bool,
    #[serde(default = "default_minimize_to_tray")]
    pub(crate) minimize_to_tray_on_close: bool,
    #[serde(default = "default_language")]
    pub(crate) language: String,
    #[serde(default)]
    pub(crate) default_output_dir: String,
    #[serde(default = "default_theme")]
    pub(crate) theme: String,
    #[serde(default = "default_execution_history_limit")]
    pub(crate) execution_history_limit: usize,
    #[serde(default = "default_environment_provider_ids")]
    pub(crate) environment_provider_ids: Vec<String>,
    #[serde(default)]
    pub(crate) recent_repo_ids: Vec<String>,
    #[serde(default)]
    pub(crate) recent_config_keys_by_repo: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    pub(crate) execution_history: Vec<ExecutionRecord>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LegacyStoredAppState {
    #[serde(default)]
    pub(crate) repositories: Vec<Repository>,
    #[serde(default)]
    pub(crate) selected_repo_id: Option<String>,
    #[serde(default = "default_left_panel_width")]
    pub(crate) left_panel_width: i32,
    #[serde(default = "default_middle_panel_width")]
    pub(crate) middle_panel_width: i32,
    #[serde(default)]
    pub(crate) panel_widths_customized: bool,
    #[serde(default = "default_preset")]
    pub(crate) selected_preset: String,
    #[serde(default)]
    pub(crate) is_custom_mode: bool,
    #[serde(default)]
    pub(crate) custom_config: PublishConfigStore,
    #[serde(default = "default_minimize_to_tray")]
    pub(crate) minimize_to_tray_on_close: bool,
    #[serde(default = "default_language")]
    pub(crate) language: String,
    #[serde(default)]
    pub(crate) default_output_dir: String,
    #[serde(default = "default_theme")]
    pub(crate) theme: String,
    #[serde(default)]
    pub(crate) profiles: Vec<ConfigProfile>,
    #[serde(default = "default_execution_history_limit")]
    pub(crate) execution_history_limit: usize,
    #[serde(default = "default_environment_provider_ids")]
    pub(crate) environment_provider_ids: Vec<String>,
    #[serde(default)]
    pub(crate) recent_repo_ids: Vec<String>,
    #[serde(default)]
    pub(crate) recent_config_keys_by_repo: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    pub(crate) execution_history: Vec<ExecutionRecord>,
}

impl Default for StoredAppState {
    fn default() -> Self {
        AppState::default().into()
    }
}

impl From<StoredAppState> for AppState {
    fn from(value: StoredAppState) -> Self {
        Self {
            repositories: value.repositories,
            selected_repo_id: value.selected_repo_id,
            left_panel_width: value.left_panel_width,
            middle_panel_width: value.middle_panel_width,
            panel_widths_customized: value.panel_widths_customized,
            minimize_to_tray_on_close: value.minimize_to_tray_on_close,
            language: value.language,
            default_output_dir: value.default_output_dir,
            theme: value.theme,
            execution_history_limit: value.execution_history_limit,
            environment_provider_ids: value.environment_provider_ids,
            recent_repo_ids: value.recent_repo_ids,
            recent_config_keys_by_repo: value.recent_config_keys_by_repo,
            execution_history: value.execution_history,
            startup_notice: None,
        }
    }
}

impl From<AppState> for StoredAppState {
    fn from(value: AppState) -> Self {
        Self {
            repositories: value.repositories,
            selected_repo_id: value.selected_repo_id,
            left_panel_width: value.left_panel_width,
            middle_panel_width: value.middle_panel_width,
            panel_widths_customized: value.panel_widths_customized,
            minimize_to_tray_on_close: value.minimize_to_tray_on_close,
            language: value.language,
            default_output_dir: value.default_output_dir,
            theme: value.theme,
            execution_history_limit: value.execution_history_limit,
            environment_provider_ids: value.environment_provider_ids,
            recent_repo_ids: value.recent_repo_ids,
            recent_config_keys_by_repo: value.recent_config_keys_by_repo,
            execution_history: value.execution_history,
        }
    }
}

impl From<&AppState> for StoredAppState {
    fn from(value: &AppState) -> Self {
        value.clone().into()
    }
}

pub(crate) fn sanitize_state(mut state: AppState) -> AppState {
    state.execution_history_limit =
        normalize_execution_history_limit(state.execution_history_limit);
    trim_execution_history(&mut state.execution_history, state.execution_history_limit);
    state.environment_provider_ids =
        normalize_environment_provider_ids(state.environment_provider_ids);
    sanitize_recent_publish_state(&mut state);

    // Migrate DeleteExistingFiles from properties map to first-class field
    for repo in &mut state.repositories {
        migrate_delete_existing_files_property(&mut repo.publish_config.custom_config);
    }

    state
}

fn migrate_delete_existing_files_property(config: &mut PublishConfigStore) {
    for key in ["DeleteExistingFiles", "deleteExistingFiles"] {
        if config
            .properties
            .remove(key)
            .is_some_and(|value| is_truthy_delete_existing_files_property(&value))
        {
            config.delete_existing_files = true;
        }
    }
}

fn is_truthy_delete_existing_files_property(value: &str) -> bool {
    matches!(value.trim().to_lowercase().as_str(), "true" | "1" | "yes")
}

pub(crate) fn migrate_legacy_state(legacy: LegacyStoredAppState) -> AppState {
    let mut state = AppState {
        repositories: legacy.repositories,
        selected_repo_id: legacy.selected_repo_id,
        left_panel_width: legacy.left_panel_width,
        middle_panel_width: legacy.middle_panel_width,
        panel_widths_customized: legacy.panel_widths_customized,
        minimize_to_tray_on_close: legacy.minimize_to_tray_on_close,
        language: legacy.language,
        default_output_dir: legacy.default_output_dir,
        theme: legacy.theme,
        execution_history_limit: legacy.execution_history_limit,
        environment_provider_ids: legacy.environment_provider_ids,
        recent_repo_ids: legacy.recent_repo_ids,
        recent_config_keys_by_repo: legacy.recent_config_keys_by_repo,
        execution_history: legacy.execution_history,
        startup_notice: None,
    };

    let global_has_value = legacy.selected_preset != default_preset()
        || legacy.is_custom_mode
        || !legacy.profiles.is_empty();

    if global_has_value && !state.repositories.is_empty() {
        let global_config = RepoPublishConfig {
            selected_preset: legacy.selected_preset,
            is_custom_mode: legacy.is_custom_mode,
            custom_config: legacy.custom_config,
            profiles: legacy.profiles,
        };

        for repo in &mut state.repositories {
            if repo.publish_config.is_default() {
                repo.publish_config = global_config.clone();
            }
        }

        log::info!("已将 legacy 全局发布配置迁移到各仓库");
    }

    sanitize_state(state)
}
