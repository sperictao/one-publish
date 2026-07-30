use super::recent::sanitize_recent_publish_state;
use super::types::{
    default_environment_provider_ids, default_execution_history_limit, default_language,
    default_left_panel_width, default_middle_panel_width, default_minimize_to_tray, default_preset,
    default_theme, normalize_environment_provider_ids, normalize_execution_history_limit,
    trim_execution_history, AppState, ConfigProfile, ExecutionRecord, PublishConfigStore,
    RepoPublishConfig, Repository,
};
use crate::tauri_release::{TauriReleaseConfig, RELEASE_SETTINGS_PARAMETER};
use publish_adapters::TAURI_PROVIDER_ID;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub(crate) const CURRENT_STORE_SCHEMA_VERSION: u32 = 3;

fn legacy_store_schema_version() -> u32 {
    0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredAppState {
    #[serde(default = "legacy_store_schema_version")]
    pub(crate) schema_version: u32,
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
            schema_version: CURRENT_STORE_SCHEMA_VERSION,
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

fn migrate_profile_identities(state: &mut AppState) -> bool {
    let mut migrated = false;

    for repo in &mut state.repositories {
        for profile in &mut repo.publish_config.profiles {
            migrated |= profile.migrate_legacy_identity();
        }

        let profile_ids_by_name = repo
            .publish_config
            .profiles
            .iter()
            .filter(|profile| profile.deleted_at.is_none())
            .map(|profile| (profile.name.clone(), profile.id.clone()))
            .collect::<BTreeMap<_, _>>();
        if let Some(profile_name) = repo
            .publish_config
            .selected_preset
            .strip_prefix("userprofile:")
        {
            if let Some(profile_id) = profile_ids_by_name.get(profile_name) {
                repo.publish_config.selected_preset = format!("userprofile:{profile_id}");
                migrated = true;
            }
        }

        if let Some(recent_keys) = state.recent_config_keys_by_repo.get_mut(&repo.id) {
            for recent_key in recent_keys {
                let Some(profile_name) = recent_key.strip_prefix("userprofile:") else {
                    continue;
                };
                if let Some(profile_id) = profile_ids_by_name.get(profile_name) {
                    *recent_key = format!("userprofile:{profile_id}");
                    migrated = true;
                }
            }
        }
    }

    migrated
}

fn sanitize_state_with_migration(mut state: AppState) -> (AppState, bool) {
    let profiles_migrated = migrate_profile_identities(&mut state);
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

    (state, profiles_migrated)
}

pub(crate) fn sanitize_state(state: AppState) -> AppState {
    sanitize_state_with_migration(state).0
}

pub(crate) fn sanitize_stored_state(state: AppState) -> (AppState, bool) {
    sanitize_state_with_migration(state)
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
            bindings: Vec::new(),
            applied_bundles: Vec::new(),
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

/// 旧独立 Tauri 发布中心的专用状态文件（T19 Contract 后不再有任何运行时消费者）。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyTauriReleaseState {
    #[serde(default)]
    configs: BTreeMap<String, TauriReleaseConfig>,
    /// 历史 Attempt 是不可再生的发布证据，按 JSON 原文保留，不复活旧类型
    /// （Issue #49 迁移验收：历史 Attempt 不丢失）。
    #[serde(default)]
    attempts: Vec<serde_json::Value>,
}

/// 迁移结果：`changed` 表示 AppState 被修改需要持久化；`cleanup` 在
/// 持久化成功后调用，负责处置已被并入的旧状态文件。
pub(crate) struct LegacyTauriReleaseMigration {
    pub(crate) changed: bool,
    cleanup: Option<LegacyStateCleanup>,
}

/// 旧文件的处置方式：不含历史 Attempt 时移除；仍承载 Attempt 证据时原子
/// 改名归档，数据零加工保留，改名后不再被迁移读取。
enum LegacyStateCleanup {
    Remove(PathBuf),
    Archive(PathBuf),
}

impl LegacyTauriReleaseMigration {
    fn untouched() -> Self {
        Self {
            changed: false,
            cleanup: None,
        }
    }

    pub(crate) fn cleanup(self) {
        match self.cleanup {
            None => {}
            Some(LegacyStateCleanup::Remove(path)) => {
                if let Err(error) = std::fs::remove_file(&path) {
                    log::warn!(
                        "移除已迁移的 Tauri 发布状态失败，下次启动会重新尝试。路径: {}, 错误: {}",
                        path.display(),
                        error
                    );
                }
            }
            Some(LegacyStateCleanup::Archive(path)) => {
                let timestamp = chrono::Utc::now().format("%Y%m%d%H%M%S%3f");
                let archive_path =
                    path.with_file_name(format!("tauri-release.attempts.{timestamp}.json"));
                match std::fs::rename(&path, &archive_path) {
                    Ok(()) => {
                        let _ = crate::security::harden_private_path(&archive_path);
                        log::info!(
                            "旧 Tauri 发布状态仍含历史 Attempt，已归档到 {}",
                            archive_path.display()
                        );
                    }
                    Err(error) => {
                        log::warn!(
                            "归档旧 Tauri 发布 Attempt 失败，下次启动会重新尝试。路径: {}, 错误: {}",
                            path.display(),
                            error
                        );
                    }
                }
            }
        }
    }
}

/// 一次性把旧 `tauri-release.json` 中的仓库级 Tauri 发布设置并入通用
/// Configuration Catalog：已有 Tauri 配置获得携带 `releaseSettings` 的新修订，
/// 没有的仓库得到一份新配置；不属于任何已知仓库的条目直接丢弃。
pub(crate) fn migrate_legacy_tauri_release_settings(
    state: &mut AppState,
    legacy_path: &Path,
) -> LegacyTauriReleaseMigration {
    let content = match std::fs::read_to_string(legacy_path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return LegacyTauriReleaseMigration::untouched();
        }
        Err(error) => {
            log::warn!(
                "读取旧 Tauri 发布状态失败，下次启动会重新尝试迁移。路径: {}, 错误: {}",
                legacy_path.display(),
                error
            );
            return LegacyTauriReleaseMigration::untouched();
        }
    };

    let legacy: LegacyTauriReleaseState = match serde_json::from_str(&content) {
        Ok(legacy) => legacy,
        Err(error) => {
            preserve_unreadable_tauri_release_state(legacy_path, &error);
            return LegacyTauriReleaseMigration::untouched();
        }
    };

    let now = chrono::Utc::now().to_rfc3339();
    let mut changed = false;
    let mut all_merged = true;
    let LegacyTauriReleaseState { configs, attempts } = legacy;
    for (repository_id, release) in configs {
        let Some(repository) = state
            .repositories
            .iter_mut()
            .find(|repository| repository.id == repository_id)
        else {
            log::info!("丢弃未知仓库 {repository_id} 的旧 Tauri 发布设置");
            continue;
        };
        match merge_tauri_release_settings(&mut repository.publish_config, release, &now) {
            Some(merged) => changed |= merged,
            None => all_merged = false,
        }
    }

    LegacyTauriReleaseMigration {
        changed,
        // 任何一条并入失败都保留旧文件，等待下次启动重试；成功并入或有意
        // 丢弃（未知仓库）后才处置旧文件：无 Attempt 移除，有 Attempt 归档。
        cleanup: all_merged.then(|| {
            if attempts.is_empty() {
                LegacyStateCleanup::Remove(legacy_path.to_path_buf())
            } else {
                LegacyStateCleanup::Archive(legacy_path.to_path_buf())
            }
        }),
    }
}

fn preserve_unreadable_tauri_release_state(path: &Path, error: &serde_json::Error) {
    let timestamp = chrono::Utc::now().format("%Y%m%d%H%M%S%3f");
    let backup_path = path.with_file_name(format!("tauri-release.invalid.{timestamp}.json"));
    match std::fs::rename(path, &backup_path) {
        Ok(()) => {
            let _ = crate::security::harden_private_path(&backup_path);
            log::error!(
                "旧 Tauri 发布状态无法解析（{error}），已保留到 {}",
                backup_path.display()
            );
        }
        Err(rename_error) => {
            log::error!("旧 Tauri 发布状态无法解析（{error}），备份也失败: {rename_error}");
        }
    }
}

fn active_tauri_profile(config: &RepoPublishConfig) -> Option<&ConfigProfile> {
    config.active_profiles().into_iter().find(|profile| {
        profile
            .current_revision()
            .is_some_and(|revision| revision.provider_id == TAURI_PROVIDER_ID)
    })
}

/// 返回 `Some(changed)` 表示条目已并入（或无需变化），`None` 表示并入失败。
fn merge_tauri_release_settings(
    config: &mut RepoPublishConfig,
    release: TauriReleaseConfig,
    now: &str,
) -> Option<bool> {
    let settings = match serde_json::to_value(&release) {
        Ok(settings) => settings,
        Err(error) => {
            log::error!("序列化旧 Tauri 发布设置失败，跳过迁移: {error}");
            return None;
        }
    };

    let Some(profile) = active_tauri_profile(config) else {
        let base_name = if release.app_name.trim().is_empty() {
            "Tauri Release".to_string()
        } else {
            release.app_name.trim().to_string()
        };
        let taken = config
            .active_profiles()
            .into_iter()
            .map(|profile| profile.name.clone())
            .collect::<Vec<_>>();
        let name = std::iter::once(base_name.clone())
            .chain((2..).map(|counter| format!("{base_name} {counter}")))
            .find(|candidate| !taken.contains(candidate))
            .expect("a fresh profile name always exists");
        let created = config.create_profile(
            name,
            TAURI_PROVIDER_ID.to_string(),
            serde_json::json!({ RELEASE_SETTINGS_PARAMETER: settings }),
            None,
            now.to_string(),
        );
        if let Err(error) = created {
            log::error!("迁移旧 Tauri 发布设置失败: {}", error.message);
            return None;
        }
        return Some(true);
    };

    let revision = profile.current_revision()?;
    if revision
        .parameters
        .get(RELEASE_SETTINGS_PARAMETER)
        .is_some()
    {
        return Some(false);
    }

    let mut parameters = revision.parameters.clone();
    if !parameters.is_object() {
        parameters = serde_json::Value::Object(serde_json::Map::new());
    }
    parameters[RELEASE_SETTINGS_PARAMETER] = settings;
    let profile_id = profile.id.clone();
    let name = profile.name.clone();
    let profile_group = profile.profile_group.clone();
    match config.update_profile(
        &profile_id,
        name,
        TAURI_PROVIDER_ID.to_string(),
        parameters,
        profile_group,
        None,
        now.to_string(),
    ) {
        Ok(()) => Some(true),
        Err(error) => {
            log::error!("迁移旧 Tauri 发布设置失败: {}", error.message);
            None
        }
    }
}
