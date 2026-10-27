//! 应用状态持久化模块
//!
//! 使用 JSON 文件存储应用配置，位于 `~/.one-publish/config.json`

pub(crate) mod commands;
mod legacy_dotnet;
mod migration;
mod persistence;
mod recent;
mod runtime;
mod types;

pub(crate) use commands::repository_project_binding;
pub use commands::{
    add_execution_record, add_repository, delete_profile, get_app_state, get_execution_history,
    get_repository, load_release_settings_draft, push_recent_publish_config,
    rebind_profile_project, remove_recent_publish_config, remove_repository, reorder_profiles,
    reorder_recent_publish_configs, reorder_repositories, replace_recent_publish_config_key,
    save_profile, set_execution_record_snapshot, update_preferences, update_profile,
    update_profile_release_settings, update_publish_edit_state, update_repository, update_ui_state,
};
pub use commands::{PublishDraftSubmission, PublishEditStateUpdate};
pub(crate) use runtime::{find_repository, find_repository_mut, persist_state_and_refresh_tray};
pub use runtime::{get_state, update_state};
pub(crate) use types::new_configuration_identity;
pub(crate) use types::ConfigurationImport;
pub use types::{
    AppState, AppliedProjectionBundle, AutomationBinding, AutomationTriggerPolicy, Branch,
    ConfigProfile, ExecutionRecord, PublishComposition, PublishConfigStore,
    PublishConfigurationRevision, PublishSelectionRef, RepoPublishConfig, Repository,
    RevisionAdapterBinding, RevisionDeliveryRoute, ScopedPublishDraft, CURRENT_SETTINGS_VERSION,
    PUBLISH_CONFIGURATION_CONTRACT_VERSION,
};
pub(crate) use types::{LOCAL_BACKEND_ID, LOCAL_DESTINATION_ID, TEMPORARY_STORE_ID};

#[cfg(test)]
mod tests;
