use super::recent::sanitize_recent_publish_state;
use super::types::{
    default_environment_provider_ids, default_execution_history_limit, default_language,
    default_left_panel_width, default_middle_panel_width, default_minimize_to_tray, default_preset,
    default_theme, normalize_environment_provider_ids, normalize_execution_history_limit,
    trim_execution_history, AppState, AppliedProjectionBundle, AutomationBinding, ConfigProfile,
    ExecutionRecord, PublishConfigStore, RepoPublishConfig, Repository,
};
use crate::tauri_release::{TauriReleaseConfig, RELEASE_SETTINGS_PARAMETER};
use publish_adapters::TAURI_PROVIDER_ID;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub(crate) const CURRENT_STORE_SCHEMA_VERSION: u32 = 4;

fn legacy_store_schema_version() -> u32 {
    0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredAppState {
    #[serde(default = "legacy_store_schema_version")]
    pub(crate) schema_version: u32,
    #[serde(default)]
    pub(crate) repositories: Vec<StoredRepository>,
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

/// v3 及更早磁盘形状的只读解码 DTO：repositories 携带旧三字段编辑状态，
/// 由 load 路径转换为统一选择与草稿（§4.2）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredAppStateV3 {
    #[serde(default = "legacy_store_schema_version")]
    pub(crate) schema_version: u32,
    #[serde(default)]
    pub(crate) repositories: Vec<StoredRepositoryV3>,
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

impl From<StoredAppStateV3> for AppState {
    fn from(value: StoredAppStateV3) -> Self {
        Self {
            repositories: value
                .repositories
                .into_iter()
                .map(Repository::from)
                .collect(),
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

/// v3 只读解码 DTO：repositories 携带旧三字段编辑状态。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredRepositoryV3 {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) path: String,
    #[serde(default)]
    pub(crate) project_file: Option<String>,
    pub(crate) current_branch: String,
    #[serde(default)]
    pub(crate) branches: Vec<super::types::Branch>,
    #[serde(default)]
    pub(crate) is_main: bool,
    #[serde(default)]
    pub(crate) provider_id: Option<String>,
    pub(crate) publish_config: StoredRepoPublishConfigV3,
}

impl From<StoredRepositoryV3> for Repository {
    fn from(stored: StoredRepositoryV3) -> Self {
        Repository {
            id: stored.id,
            name: stored.name,
            path: stored.path,
            project_file: stored.project_file,
            current_branch: stored.current_branch,
            branches: stored.branches,
            is_main: stored.is_main,
            provider_id: stored.provider_id,
            publish_config: stored.publish_config.into_v4_repo_config(),
        }
    }
}

/// v3 仓库状态：转换旧编辑字段，原样保留配置和自动化归属。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredRepoPublishConfigV3 {
    #[serde(default = "default_preset")]
    pub(crate) selected_preset: String,
    #[serde(default)]
    pub(crate) is_custom_mode: bool,
    #[serde(default)]
    pub(crate) custom_config: PublishConfigStore,
    #[serde(default)]
    pub(crate) profiles: Vec<ConfigProfile>,
    #[serde(default)]
    pub(crate) bindings: Vec<AutomationBinding>,
    #[serde(default)]
    pub(crate) applied_bundles: Vec<AppliedProjectionBundle>,
}

impl StoredRepoPublishConfigV3 {
    fn into_v4_repo_config(self) -> crate::store::types::RepoPublishConfig {
        let mut config = crate::store::types::RepoPublishConfig::default();
        config.profiles = self.profiles;
        config.bindings = self.bindings;
        config.applied_bundles = self.applied_bundles;
        config.global_v3_edit = Some(LegacyEditStateV3 {
            selected_preset: self.selected_preset,
            is_custom_mode: self.is_custom_mode,
            custom_config: self.custom_config,
        });
        config
    }
}

/// v4 持久化仓库形状：publish_config 只落选择与草稿（§4.2）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredRepository {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) path: String,
    #[serde(default)]
    pub(crate) project_file: Option<String>,
    pub(crate) current_branch: String,
    #[serde(default)]
    pub(crate) branches: Vec<super::types::Branch>,
    #[serde(default)]
    pub(crate) is_main: bool,
    #[serde(default)]
    pub(crate) provider_id: Option<String>,
    pub(crate) publish_config: super::types::PersistedRepoPublishConfig,
}

impl From<Repository> for StoredRepository {
    fn from(repo: Repository) -> Self {
        Self {
            id: repo.id,
            name: repo.name,
            path: repo.path,
            project_file: repo.project_file,
            current_branch: repo.current_branch,
            branches: repo.branches,
            is_main: repo.is_main,
            provider_id: repo.provider_id,
            publish_config: super::types::PersistedRepoPublishConfig::from(&repo.publish_config),
        }
    }
}

impl From<StoredRepository> for Repository {
    fn from(stored: StoredRepository) -> Self {
        let mut repo = Self {
            id: stored.id,
            name: stored.name,
            path: stored.path,
            project_file: stored.project_file,
            current_branch: stored.current_branch,
            branches: stored.branches,
            is_main: stored.is_main,
            provider_id: stored.provider_id,
            publish_config: stored.publish_config.into(),
        };
        repo
    }
}

impl Default for StoredAppState {
    fn default() -> Self {
        AppState::default().into()
    }
}

impl From<StoredAppState> for AppState {
    fn from(value: StoredAppState) -> Self {
        Self {
            repositories: value
                .repositories
                .into_iter()
                .map(Repository::from)
                .collect(),
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
            repositories: value
                .repositories
                .into_iter()
                .map(StoredRepository::from)
                .collect(),
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
        // v3 选择引用：userprofile:<名称> → userprofile:<身份>。
        if let Some(PublishSelectionRef::Revision { configuration_id }) =
            repo.publish_config.selection.as_mut()
        {
            if let Some(profile_id) = profile_ids_by_name.get(configuration_id) {
                if *configuration_id != *profile_id {
                    *configuration_id = profile_id.clone();
                    migrated = true;
                }
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

    (state, profiles_migrated)
}

pub(crate) fn sanitize_state(state: AppState) -> AppState {
    sanitize_state_with_migration(state).0
}

pub(crate) fn sanitize_stored_state(state: AppState) -> (AppState, bool) {
    sanitize_state_with_migration(state)
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

    // v2 全局三字段：把全局编辑状态塞进每个仍是默认值的仓库后，
    // 统一走 v3→v4 转换（§4.2：全局到仓库 → 名称到身份 → 编辑状态转换）。
    // v2 全局三字段（§4.2：全局到仓库）：暂存为迁移输入，随每个默认仓库
    // 的 v3→v4 转换一并落地。
    let global_has_value = legacy.selected_preset != default_preset()
        || legacy.is_custom_mode
        || !legacy.profiles.is_empty();

    let global_edit_state = global_has_value.then(|| LegacyEditStateV3 {
        selected_preset: legacy.selected_preset.clone(),
        is_custom_mode: legacy.is_custom_mode,
        custom_config: legacy.custom_config.clone(),
    });

    if global_has_value && !state.repositories.is_empty() {
        for repo in &mut state.repositories {
            if repo.publish_config.is_default() {
                repo.publish_config.profiles = legacy.profiles.clone();
                repo.publish_config.global_v3_edit = global_edit_state.clone();
            }
        }
    }

    // §4.2：更旧的全局配置先执行全局到仓库、名称到身份迁移，再转换编辑状态。
    let mut state = sanitize_state(state);
    let mut edit_state_migrated = false;
    for repo in &mut state.repositories {
        edit_state_migrated |= migrate_repo_edit_state_v3_to_v4(repo);
    }
    if edit_state_migrated {
        log::info!("已将 v3 编辑状态迁移为统一选择与草稿");
    }

    state
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

// ── v3 → v4 编辑状态迁移（统一发布输入方案 §4.2）──────────────────────────

use super::types::{PublishSelectionRef, ScopedPublishDraft};
use crate::publish_runtime::{PublishBaseRevisionRef, PublishConfigurationContent};

/// 把修订/草稿内容包装为完整配置内容：版本与组合由后端补全。
fn draft_content(
    provider_id: &str,
    project_binding: Option<String>,
    parameters: serde_json::Value,
) -> PublishConfigurationContent {
    PublishConfigurationContent {
        provider_id: provider_id.to_string(),
        contract_version: crate::store::PUBLISH_CONFIGURATION_CONTRACT_VERSION,
        provider_version: crate::provider::registry::ProviderRegistry::new()
            .get(provider_id)
            .map(|provider| provider.manifest().version.clone())
            .unwrap_or_else(|_| "unknown".to_string()),
        settings_version: crate::store::CURRENT_SETTINGS_VERSION,
        project_binding,
        parameters,
        composition: crate::store::PublishComposition::local_default(),
    }
}

fn upsert_scoped_draft(drafts: &mut Vec<ScopedPublishDraft>, draft: ScopedPublishDraft) {
    if let Some(existing) = drafts
        .iter_mut()
        .find(|existing| {
            existing.provider_id == draft.provider_id
                && existing.project_binding == draft.project_binding
        })
    {
        *existing = draft;
    } else {
        drafts.push(draft);
    }
}

fn userprofile_base_revision(
    repo: &Repository,
    selected_preset: &str,
) -> Option<PublishBaseRevisionRef> {
    let configuration_id = selected_preset.strip_prefix("userprofile:")?;
    let profile = repo
        .publish_config
        .profiles
        .iter()
        .find(|profile| profile.id == configuration_id)?;
    Some(PublishBaseRevisionRef {
        configuration_id: configuration_id.to_string(),
        revision_id: profile.current_revision_id.clone(),
    })
}

/// v3 编辑状态 → 统一选择与草稿（§4.2 旧状态转换规则）。幂等：已是 v4
/// 内容（存在选择或草稿）的仓库只做投影，不重复转换。
/// v3 遗留编辑状态（仅迁移期间存在于内存）：由 StoredAppStateV3 加载路径或
/// 全局迁移注入，v3→v4 转换消费后即清除，不持久化、不下发前端。
#[derive(Debug, Clone)]
pub(crate) struct LegacyEditStateV3 {
    pub(crate) selected_preset: String,
    pub(crate) is_custom_mode: bool,
    pub(crate) custom_config: PublishConfigStore,
}

/// v3 选择引用按 id 或名称解析为 profile 身份（名称→身份迁移可能尚未覆盖）。
fn resolve_profile_id(repo: &Repository, reference: &str) -> Option<String> {
    let profiles = &repo.publish_config.profiles;
    profiles
        .iter()
        .find(|profile| profile.id == reference && profile.deleted_at.is_none())
        .or_else(|| {
            profiles
                .iter()
                .find(|profile| profile.name == reference && profile.deleted_at.is_none())
        })
        .map(|profile| profile.id.clone())
}

pub(crate) fn migrate_repo_edit_state_v3_to_v4(repo: &mut Repository) -> bool {
    if repo.publish_config.selection.is_some() || !repo.publish_config.drafts.is_empty() {
        return false;
    }

    // v3 遗留编辑状态：由加载路径（StoredAppStateV3）或全局迁移注入。
    let Some(legacy_edit) = repo.publish_config.global_v3_edit.take() else {
        return false;
    };
    let legacy_preset = legacy_edit.selected_preset;
    let legacy_is_custom = legacy_edit.is_custom_mode;
    let legacy_custom = legacy_edit.custom_config;
    let provider_id = repo
        .provider_id
        .clone()
        .unwrap_or_else(|| "dotnet".to_string());
    let binding = crate::store::repository_project_binding(repo, &provider_id);

    let mut drafts = std::mem::take(&mut repo.publish_config.drafts);
    let selection = if legacy_is_custom || legacy_preset.starts_with("userprofile:") {
        // 命名 .NET 配置可能包含未保存修改：比较"修订按旧规则投影的富表单"
        // 与持久化 customConfig，只叠加实际变化的字段（§4.2）。
        let configuration_id = legacy_preset
            .strip_prefix("userprofile:")
            .and_then(|reference| resolve_profile_id(repo, reference));
        let current_revision = configuration_id
            .as_deref()
            .and_then(|configuration_id| {
                repo.publish_config
                    .profiles
                    .iter()
                    .find(|profile| profile.id == configuration_id)
            })
            .and_then(|profile| profile.current_revision());
        match (configuration_id, current_revision) {
            (Some(configuration_id), Some(revision))
                if revision.provider_id == "dotnet" && legacy_is_custom =>
            {
                // 命名 .NET 配置的未保存修改：只叠加实际变化的字段。
                let revision_parameters = revision.parameters.clone();
                let revision_id = revision.id.clone();
                match super::legacy_dotnet::draft_parameters_with_unsaved_changes(
                    &revision_parameters,
                    &legacy_custom,
                ) {
                    Some(parameters) => {
                        let mut content = crate::publish_runtime::source::content_from_revision(revision);
                        content.parameters = parameters;
                        content.project_binding = content.project_binding.or(binding.clone());
                        let draft_binding = content.project_binding.clone();
                        upsert_scoped_draft(
                            &mut drafts,
                            ScopedPublishDraft {
                                provider_id: "dotnet".to_string(),
                                project_binding: draft_binding.clone(),
                                content,
                                base_revision: Some(PublishBaseRevisionRef {
                                    configuration_id: configuration_id.to_string(),
                                    revision_id,
                                }),
                            },
                        );
                        Some(PublishSelectionRef::Draft {
                            provider_id: "dotnet".to_string(),
                            project_binding: draft_binding,
                        })
                    }
                    // 没有变化：保留修订选择。
                    None => Some(PublishSelectionRef::Revision {
                        configuration_id: configuration_id.to_string(),
                    }),
                }
            }
            // 修订引用始终保留：缺失配置或无修订时为待解析状态。
            (Some(configuration_id), _) => Some(PublishSelectionRef::Revision {
                configuration_id: configuration_id.to_string(),
            }),
            // userprofile 之外的 custom 状态：独立 customConfig 一次性转换。
            (None, _) => {
                let parameters = super::legacy_dotnet::parameters_from_rich_form(&legacy_custom);
                upsert_scoped_draft(
                    &mut drafts,
                    ScopedPublishDraft {
                        provider_id: "dotnet".to_string(),
                        project_binding: binding.clone(),
                        content: draft_content("dotnet", binding.clone(), parameters),
                        base_revision: None,
                    },
                );
                Some(PublishSelectionRef::Draft {
                    provider_id: "dotnet".to_string(),
                    project_binding: binding,
                })
            }
        }
    } else if let Some(reference) = legacy_preset.strip_prefix("profile-") {
        // 旧 pubxml 选择转为明确来源；失效时保留引用并显示阻断。
        Some(PublishSelectionRef::ProjectProfile {
            provider_id,
            reference: reference.to_string(),
        })
    } else if legacy_preset.is_empty() || legacy_preset == default_preset() && provider_id != "dotnet"
    {
        // 非 .NET 不继承无关的 release-fd；旧临时参数仅存于内存，转为空草稿。
        Some(PublishSelectionRef::Draft {
            provider_id: provider_id.clone(),
            project_binding: binding.clone(),
        })
    } else if legacy_preset == default_preset() {
        None
    } else if provider_id == "dotnet" {
        // 旧模板选择转为明确来源。
        Some(PublishSelectionRef::Template {
            provider_id: "dotnet".to_string(),
            template_id: legacy_preset,
        })
    } else {
        Some(PublishSelectionRef::Draft {
            provider_id: provider_id.clone(),
            project_binding: binding.clone(),
        })
    };

    repo.publish_config.drafts = drafts;
    repo.publish_config.selection = selection;
    true
}
