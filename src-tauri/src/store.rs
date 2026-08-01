//! 应用状态持久化模块
//!
//! 使用 JSON 文件存储应用配置，位于 `~/.one-publish/config.json`

mod commands;
mod migration;
mod persistence;
mod recent;
mod runtime;
mod types;

pub(crate) use commands::{
    __cmd__add_execution_record, __cmd__add_repository, __cmd__delete_profile,
    __cmd__get_app_state, __cmd__get_execution_history, __cmd__get_profiles, __cmd__get_repository,
    __cmd__push_recent_publish_config, __cmd__rebind_profile_project,
    __cmd__remove_recent_publish_config, __cmd__remove_repository, __cmd__reorder_profiles,
    __cmd__reorder_recent_publish_configs, __cmd__reorder_repositories,
    __cmd__replace_recent_publish_config_key, __cmd__save_app_state, __cmd__save_profile,
    __cmd__set_execution_record_snapshot, __cmd__update_preferences, __cmd__update_profile,
    __cmd__update_publish_state, __cmd__update_repository, __cmd__update_ui_state,
};
pub use commands::{
    add_execution_record, add_repository, delete_profile, get_app_state, get_execution_history,
    get_profiles, get_repository, push_recent_publish_config, rebind_profile_project,
    remove_recent_publish_config, remove_repository, reorder_profiles,
    reorder_recent_publish_configs, reorder_repositories, replace_recent_publish_config_key,
    save_app_state, save_profile, set_execution_record_snapshot, update_preferences,
    update_profile, update_publish_state, update_repository, update_ui_state,
};
pub(crate) use runtime::{find_repository, find_repository_mut, persist_state_and_refresh_tray};
pub use runtime::{get_state, update_state};
pub(crate) use types::new_configuration_identity;
pub(crate) use types::ConfigurationImport;
pub use types::{
    AppState, AppliedProjectionBundle, AutomationBinding, AutomationTriggerPolicy, Branch,
    ConfigProfile, ExecutionRecord, PublishComposition, PublishConfigStore,
    PublishConfigurationRevision, RepoPublishConfig, Repository, RevisionAdapterBinding,
    RevisionDeliveryRoute, CURRENT_SETTINGS_VERSION, PUBLISH_CONFIGURATION_CONTRACT_VERSION,
};
pub(crate) use types::{LOCAL_BACKEND_ID, LOCAL_DESTINATION_ID, TEMPORARY_STORE_ID};

#[cfg(test)]
mod tests;
