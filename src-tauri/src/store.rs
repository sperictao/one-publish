//! 应用状态持久化模块
//!
//! 使用 JSON 文件存储应用配置，位于 `~/.one-publish/config.json`

use crate::errors::AppError;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::{OnceLock, RwLock};

/// 分支信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub name: String,
    pub is_main: bool,
    pub is_current: bool,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_count: Option<i32>,
}

/// 仓库信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Repository {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_file: Option<String>,
    pub current_branch: String,
    pub branches: Vec<Branch>,
    #[serde(default)]
    pub is_main: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub publish_config: RepoPublishConfig,
}

/// 发布配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
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
    pub properties: BTreeMap<String, String>,
    pub define: Vec<String>,
    pub use_profile: bool,
    pub profile_name: String,
}

/// 配置文件（用于 import/export）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigProfile {
    pub name: String,
    pub provider_id: String,
    pub parameters: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile_group: Option<String>,
    pub created_at: String,
    pub is_system_default: bool,
}

/// 执行历史记录
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionRecord {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo_id: Option<String>,
    pub provider_id: String,
    pub project_path: String,
    pub started_at: String,
    pub finished_at: String,
    pub success: bool,
    #[serde(default)]
    pub cancelled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command_line: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_signature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec: Option<serde_json::Value>,
    #[serde(default)]
    pub file_count: usize,
}

const DEFAULT_EXECUTION_HISTORY_LIMIT: usize = 20;
const MIN_EXECUTION_HISTORY_LIMIT: usize = 5;
const MAX_EXECUTION_HISTORY_LIMIT: usize = 200;
const MAX_RECENT_REPOSITORIES: usize = 6;
const MAX_RECENT_CONFIGS_PER_REPO: usize = 6;

fn default_execution_history_limit() -> usize {
    DEFAULT_EXECUTION_HISTORY_LIMIT
}

fn normalize_execution_history_limit(limit: usize) -> usize {
    limit.clamp(MIN_EXECUTION_HISTORY_LIMIT, MAX_EXECUTION_HISTORY_LIMIT)
}

fn trim_execution_history(history: &mut Vec<ExecutionRecord>, limit: usize) {
    let mut scoped_count: HashMap<String, usize> = HashMap::new();
    let mut retained: Vec<ExecutionRecord> = Vec::with_capacity(history.len());

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
            properties: BTreeMap::new(),
            define: Vec::new(),
            use_profile: false,
            profile_name: String::new(),
        }
    }
}

/// 仓库级发布配置（隔离到每个仓库）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
    /// 判断是否全部为默认值
    fn is_default(&self) -> bool {
        self.selected_preset == default_preset() && !self.is_custom_mode && self.profiles.is_empty()
    }
}

/// 应用状态
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppState {
    /// 仓库列表
    #[serde(default)]
    pub repositories: Vec<Repository>,
    /// 当前选中的仓库 ID
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_repo_id: Option<String>,
    /// 左侧面板宽度
    #[serde(default = "default_left_panel_width")]
    pub left_panel_width: i32,
    /// 中间面板宽度
    #[serde(default = "default_middle_panel_width")]
    pub middle_panel_width: i32,
    /// 用户是否自定义了面板宽度
    #[serde(default)]
    pub panel_widths_customized: bool,
    /// 选中的预设 ID
    #[serde(default = "default_preset")]
    pub selected_preset: String,
    /// 是否自定义模式
    #[serde(default)]
    pub is_custom_mode: bool,
    /// 自定义配置
    #[serde(default)]
    pub custom_config: PublishConfigStore,
    /// 是否最小化到托盘
    #[serde(default = "default_minimize_to_tray")]
    pub minimize_to_tray_on_close: bool,
    /// UI 语言
    #[serde(default = "default_language")]
    pub language: String,
    /// 默认发布目录
    #[serde(default)]
    pub default_output_dir: String,
    /// 主题设置: "light", "dark", "auto"
    #[serde(default = "default_theme")]
    pub theme: String,
    /// 保存的配置文件
    #[serde(default)]
    pub profiles: Vec<ConfigProfile>,
    /// 最近执行历史保留上限
    #[serde(default = "default_execution_history_limit")]
    pub execution_history_limit: usize,
    /// 环境检查启用的 Provider 列表
    #[serde(default = "default_environment_provider_ids")]
    pub environment_provider_ids: Vec<String>,
    /// 最近使用的仓库 ID（按时间倒序）
    #[serde(default)]
    pub recent_repo_ids: Vec<String>,
    /// 各仓库最近使用的发布配置 key 列表
    #[serde(default)]
    pub recent_config_keys_by_repo: BTreeMap<String, Vec<String>>,
    /// 最近执行历史
    #[serde(default)]
    pub execution_history: Vec<ExecutionRecord>,
}

fn default_minimize_to_tray() -> bool {
    true
}

fn default_language() -> String {
    "zh".to_string()
}

fn default_theme() -> String {
    "auto".to_string()
}

fn default_environment_provider_ids() -> Vec<String> {
    vec!["dotnet".to_string()]
}

fn normalize_environment_provider_ids(provider_ids: Vec<String>) -> Vec<String> {
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

fn default_left_panel_width() -> i32 {
    220
}

fn default_middle_panel_width() -> i32 {
    280
}

fn default_preset() -> String {
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
            selected_preset: default_preset(),
            is_custom_mode: false,
            custom_config: PublishConfigStore::default(),
            minimize_to_tray_on_close: default_minimize_to_tray(),
            language: default_language(),
            default_output_dir: String::new(),
            theme: default_theme(),
            profiles: Vec::new(),
            execution_history_limit: default_execution_history_limit(),
            environment_provider_ids: default_environment_provider_ids(),
            recent_repo_ids: Vec::new(),
            recent_config_keys_by_repo: BTreeMap::new(),
            execution_history: Vec::new(),
        }
    }
}

fn normalize_recent_config_keys(keys: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::new();

    for key in keys {
        let trimmed = key.trim();
        if trimmed.is_empty() || normalized.iter().any(|item| item == trimmed) {
            continue;
        }

        normalized.push(trimmed.to_string());
        if normalized.len() >= MAX_RECENT_CONFIGS_PER_REPO {
            break;
        }
    }

    normalized
}

fn push_recent_publish_config_state(
    recent_repo_ids: &mut Vec<String>,
    recent_config_keys_by_repo: &mut BTreeMap<String, Vec<String>>,
    repo_id: &str,
    config_key: &str,
) -> bool {
    let repo_id = repo_id.trim();
    let config_key = config_key.trim();
    if repo_id.is_empty() || config_key.is_empty() {
        return false;
    }

    let scoped = recent_config_keys_by_repo
        .entry(repo_id.to_string())
        .or_default();
    let previous_scoped = scoped.clone();
    *scoped = std::iter::once(config_key.to_string())
        .chain(
            previous_scoped
                .into_iter()
                .filter(|item| item != config_key),
        )
        .take(MAX_RECENT_CONFIGS_PER_REPO)
        .collect();

    let previous_repo_ids = recent_repo_ids.clone();
    *recent_repo_ids = std::iter::once(repo_id.to_string())
        .chain(previous_repo_ids.into_iter().filter(|item| item != repo_id))
        .take(MAX_RECENT_REPOSITORIES)
        .collect();

    let retained_repo_ids = recent_repo_ids.iter().cloned().collect::<HashSet<_>>();
    recent_config_keys_by_repo
        .retain(|id, keys| retained_repo_ids.contains(id) && !keys.is_empty());

    true
}

fn remove_recent_publish_config_state(
    recent_repo_ids: &mut Vec<String>,
    recent_config_keys_by_repo: &mut BTreeMap<String, Vec<String>>,
    repo_id: &str,
    config_key: &str,
) -> bool {
    let repo_id = repo_id.trim();
    let config_key = config_key.trim();
    if repo_id.is_empty() || config_key.is_empty() {
        return false;
    }

    let (removed, should_remove_repo) =
        if let Some(scoped) = recent_config_keys_by_repo.get_mut(repo_id) {
            let original_len = scoped.len();
            scoped.retain(|item| item != config_key);
            (original_len != scoped.len(), scoped.is_empty())
        } else {
            return false;
        };

    if should_remove_repo {
        recent_config_keys_by_repo.remove(repo_id);
        recent_repo_ids.retain(|item| item != repo_id);
    }

    removed || should_remove_repo
}

fn replace_recent_publish_config_key_state(
    recent_config_keys_by_repo: &mut BTreeMap<String, Vec<String>>,
    repo_id: &str,
    previous_key: &str,
    next_key: &str,
) -> bool {
    let repo_id = repo_id.trim();
    let previous_key = previous_key.trim();
    let next_key = next_key.trim();
    if repo_id.is_empty() || previous_key.is_empty() || next_key.is_empty() {
        return false;
    }

    let Some(scoped) = recent_config_keys_by_repo.get_mut(repo_id) else {
        return false;
    };

    if !scoped.iter().any(|item| item == previous_key) {
        return false;
    }

    *scoped = normalize_recent_config_keys(
        scoped
            .iter()
            .map(|item| {
                if item == previous_key {
                    next_key.to_string()
                } else {
                    item.clone()
                }
            })
            .collect(),
    );
    true
}

fn sanitize_recent_publish_state(state: &mut AppState) {
    let valid_repo_ids = state
        .repositories
        .iter()
        .map(|repo| repo.id.clone())
        .collect::<HashSet<_>>();

    let recent_config_keys_by_repo = std::mem::take(&mut state.recent_config_keys_by_repo);
    state.recent_config_keys_by_repo = recent_config_keys_by_repo
        .into_iter()
        .filter_map(|(repo_id, keys)| {
            if !valid_repo_ids.contains(&repo_id) {
                return None;
            }

            let normalized = normalize_recent_config_keys(keys);
            if normalized.is_empty() {
                return None;
            }

            Some((repo_id, normalized))
        })
        .collect();

    let mut normalized_recent_repo_ids = Vec::new();
    for repo_id in std::mem::take(&mut state.recent_repo_ids) {
        if normalized_recent_repo_ids.len() >= MAX_RECENT_REPOSITORIES {
            break;
        }

        if !valid_repo_ids.contains(&repo_id)
            || !state.recent_config_keys_by_repo.contains_key(&repo_id)
            || normalized_recent_repo_ids
                .iter()
                .any(|item| item == &repo_id)
        {
            continue;
        }

        normalized_recent_repo_ids.push(repo_id);
    }

    for repo_id in state.recent_config_keys_by_repo.keys() {
        if normalized_recent_repo_ids.len() >= MAX_RECENT_REPOSITORIES {
            break;
        }

        if normalized_recent_repo_ids
            .iter()
            .any(|item| item == repo_id)
        {
            continue;
        }

        normalized_recent_repo_ids.push(repo_id.clone());
    }

    let retained_repo_ids = normalized_recent_repo_ids
        .iter()
        .cloned()
        .collect::<HashSet<_>>();
    state.recent_repo_ids = normalized_recent_repo_ids;
    state
        .recent_config_keys_by_repo
        .retain(|repo_id, _| retained_repo_ids.contains(repo_id));
}

/// 获取配置文件路径
fn get_config_path() -> PathBuf {
    if let Some(home_dir) = dirs::home_dir() {
        return home_dir.join(".one-publish").join("config.json");
    }

    if let Ok(current_dir) = std::env::current_dir() {
        log::warn!("无法获取用户主目录，回退到当前目录保存配置");
        return current_dir.join(".one-publish").join("config.json");
    }

    log::warn!("无法获取用户主目录和当前目录，回退到相对路径保存配置");
    PathBuf::from(".one-publish").join("config.json")
}

/// 从文件加载状态
fn sanitize_state(mut state: AppState) -> AppState {
    state.execution_history_limit =
        normalize_execution_history_limit(state.execution_history_limit);
    trim_execution_history(&mut state.execution_history, state.execution_history_limit);
    state.environment_provider_ids =
        normalize_environment_provider_ids(state.environment_provider_ids);
    sanitize_recent_publish_state(&mut state);

    // 一次性迁移：将全局发布配置下沉到各仓库
    let global_has_value = state.selected_preset != default_preset()
        || state.is_custom_mode
        || !state.profiles.is_empty();

    if global_has_value && !state.repositories.is_empty() {
        let global_config = RepoPublishConfig {
            selected_preset: state.selected_preset.clone(),
            is_custom_mode: state.is_custom_mode,
            custom_config: state.custom_config.clone(),
            profiles: state.profiles.clone(),
        };

        for repo in &mut state.repositories {
            if repo.publish_config.is_default() {
                repo.publish_config = global_config.clone();
            }
        }

        // 重置全局字段为默认值
        state.selected_preset = default_preset();
        state.is_custom_mode = false;
        state.custom_config = PublishConfigStore::default();
        state.profiles = Vec::new();

        log::info!("已将全局发布配置迁移到各仓库");
    }

    state
}

fn load_from_file() -> AppState {
    let path = get_config_path();
    if let Ok(content) = fs::read_to_string(&path) {
        match serde_json::from_str::<AppState>(&content) {
            Ok(state) => sanitize_state(state),
            Err(err) => {
                log::warn!(
                    "解析配置文件失败，将使用默认配置。路径: {}, 错误: {}",
                    path.display(),
                    err
                );
                AppState::default()
            }
        }
    } else {
        AppState::default()
    }
}

/// 保存状态到文件
fn save_to_file(state: &AppState) -> Result<(), crate::errors::AppError> {
    let path = get_config_path();

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            crate::errors::AppError::store_with_code(
                format!("创建目录失败: {}", e),
                "store_create_dir_failed",
            )
        })?;
    }

    let json = serde_json::to_string_pretty(state).map_err(|e| {
        crate::errors::AppError::store_with_code(
            format!("序列化失败: {}", e),
            "store_serialize_failed",
        )
    })?;
    fs::write(&path, json).map_err(|e| {
        crate::errors::AppError::store_with_code(
            format!("写入文件失败: {}", e),
            "store_write_failed",
        )
    })?;
    Ok(())
}

/// 全局状态存储
static STATE_STORE: OnceLock<RwLock<AppState>> = OnceLock::new();

fn state_store() -> &'static RwLock<AppState> {
    STATE_STORE.get_or_init(|| RwLock::new(load_from_file()))
}

fn with_read_state<T>(reader: impl FnOnce(&AppState) -> T) -> T {
    match state_store().read() {
        Ok(guard) => reader(&guard),
        Err(err) => {
            log::error!("读取状态锁失败: {}", err);
            let guard = err.into_inner();
            reader(&guard)
        }
    }
}

/// 获取当前状态
pub fn get_state() -> AppState {
    with_read_state(|state| state.clone())
}

fn get_bootstrap_state() -> AppState {
    with_read_state(build_frontend_state)
}

fn get_execution_history_snapshot() -> Vec<ExecutionRecord> {
    with_read_state(|state| state.execution_history.clone())
}

fn build_frontend_state(state: &AppState) -> AppState {
    AppState {
        repositories: state.repositories.clone(),
        selected_repo_id: state.selected_repo_id.clone(),
        left_panel_width: state.left_panel_width,
        middle_panel_width: state.middle_panel_width,
        panel_widths_customized: state.panel_widths_customized,
        selected_preset: default_preset(),
        is_custom_mode: false,
        custom_config: PublishConfigStore::default(),
        minimize_to_tray_on_close: state.minimize_to_tray_on_close,
        language: state.language.clone(),
        default_output_dir: state.default_output_dir.clone(),
        theme: state.theme.clone(),
        profiles: Vec::new(),
        execution_history_limit: state.execution_history_limit,
        environment_provider_ids: state.environment_provider_ids.clone(),
        recent_repo_ids: state.recent_repo_ids.clone(),
        recent_config_keys_by_repo: state.recent_config_keys_by_repo.clone(),
        execution_history: Vec::new(),
    }
}

/// 更新状态
pub fn update_state(new_state: AppState) -> Result<(), crate::errors::AppError> {
    let normalized = sanitize_state(new_state);
    save_to_file(&normalized)?;

    let mut guard = state_store().write().map_err(|err| {
        crate::errors::AppError::store_with_code(
            format!("写入状态锁失败: {}", err),
            "store_lock_write_failed",
        )
    })?;
    *guard = normalized;
    Ok(())
}

async fn refresh_tray_menu(app: tauri::AppHandle) {
    if let Err(err) = crate::tray::update_tray_menu(app.clone()).await {
        log::warn!("刷新托盘菜单失败: {}", err);
    }
}

async fn persist_state_and_refresh_tray(
    app: &tauri::AppHandle,
    state: AppState,
) -> Result<(), AppError> {
    update_state(state)?;
    refresh_tray_menu(app.clone()).await;
    Ok(())
}

// ==================== Tauri Commands ====================

/// 获取应用状态
#[tauri::command]
pub async fn get_app_state() -> Result<AppState, AppError> {
    Ok(get_bootstrap_state())
}

/// 保存应用状态
#[tauri::command]
pub async fn save_app_state(state: AppState) -> Result<(), AppError> {
    update_state(state)
}

/// 添加仓库
#[tauri::command]
pub async fn add_repository(app: tauri::AppHandle, repo: Repository) -> Result<AppState, AppError> {
    let mut state = get_state();

    // 检查是否已存在
    if state.repositories.iter().any(|r| r.path == repo.path) {
        return Err(AppError::validation_with_code(
            "仓库已存在",
            "repository_exists",
        ));
    }

    state.repositories.push(repo.clone());
    state.selected_repo_id = Some(repo.id);
    persist_state_and_refresh_tray(&app, state).await?;
    Ok(get_bootstrap_state())
}

/// 删除仓库
#[tauri::command]
pub async fn remove_repository(
    app: tauri::AppHandle,
    repo_id: String,
) -> Result<AppState, AppError> {
    let mut state = get_state();

    state.repositories.retain(|r| r.id != repo_id);

    // 如果删除的是当前选中的仓库，清除选中状态
    if state.selected_repo_id.as_ref() == Some(&repo_id) {
        state.selected_repo_id = state.repositories.first().map(|r| r.id.clone());
    }

    persist_state_and_refresh_tray(&app, state).await?;
    Ok(get_bootstrap_state())
}

/// 更新仓库
#[tauri::command]
pub async fn update_repository(
    app: tauri::AppHandle,
    repo: Repository,
) -> Result<AppState, AppError> {
    let mut state = get_state();

    if let Some(existing) = state.repositories.iter_mut().find(|r| r.id == repo.id) {
        *existing = repo;
    }

    persist_state_and_refresh_tray(&app, state).await?;
    Ok(get_bootstrap_state())
}

/// 更新 UI 状态（面板宽度等）
#[tauri::command]
pub async fn update_ui_state(
    left_panel_width: Option<i32>,
    middle_panel_width: Option<i32>,
    selected_repo_id: Option<String>,
) -> Result<(), AppError> {
    let mut state = get_state();

    if let Some(width) = left_panel_width {
        state.left_panel_width = width;
        state.panel_widths_customized = true;
    }
    if let Some(width) = middle_panel_width {
        state.middle_panel_width = width;
        state.panel_widths_customized = true;
    }
    if let Some(repo_id) = selected_repo_id {
        state.selected_repo_id = Some(repo_id);
    }

    update_state(state)
}

/// 更新偏好设置（语言、托盘行为、主题等）
#[tauri::command]
pub async fn update_preferences(
    app: tauri::AppHandle,
    language: Option<String>,
    minimize_to_tray_on_close: Option<bool>,
    default_output_dir: Option<String>,
    theme: Option<String>,
    execution_history_limit: Option<usize>,
    environment_provider_ids: Option<Vec<String>>,
) -> Result<AppState, AppError> {
    let mut state = get_state();
    let language_changed = language.is_some();

    if let Some(lang) = language {
        state.language = lang;
    }

    if let Some(minimize) = minimize_to_tray_on_close {
        state.minimize_to_tray_on_close = minimize;
    }

    if let Some(output_dir) = default_output_dir {
        state.default_output_dir = output_dir;
    }

    if let Some(thm) = theme {
        state.theme = thm;
    }

    if let Some(limit) = execution_history_limit {
        state.execution_history_limit = normalize_execution_history_limit(limit);
        trim_execution_history(&mut state.execution_history, state.execution_history_limit);
    }

    if let Some(provider_ids) = environment_provider_ids {
        state.environment_provider_ids = normalize_environment_provider_ids(provider_ids);
    }

    update_state(state)?;

    // 语言变化需要刷新托盘菜单以便实时更新文案
    if language_changed {
        refresh_tray_menu(app).await;
    }

    Ok(get_bootstrap_state())
}

/// 更新发布配置状态（按仓库隔离）
#[tauri::command]
pub async fn update_publish_state(
    repo_id: String,
    selected_preset: Option<String>,
    is_custom_mode: Option<bool>,
    custom_config: Option<PublishConfigStore>,
) -> Result<(), AppError> {
    let mut state = get_state();

    let repo = state
        .repositories
        .iter_mut()
        .find(|r| r.id == repo_id)
        .ok_or_else(|| {
            AppError::validation_with_code(
                format!("未找到仓库: {}", repo_id),
                "repository_not_found",
            )
        })?;

    if let Some(preset) = selected_preset {
        repo.publish_config.selected_preset = preset;
    }
    if let Some(mode) = is_custom_mode {
        repo.publish_config.is_custom_mode = mode;
    }
    if let Some(config) = custom_config {
        repo.publish_config.custom_config = config;
    }

    update_state(state)
}

/// 获取保存的配置文件（按仓库隔离）
#[tauri::command]
pub async fn get_profiles(repo_id: String) -> Result<Vec<ConfigProfile>, AppError> {
    with_read_state(|state| {
        let repo = state
            .repositories
            .iter()
            .find(|r| r.id == repo_id)
            .ok_or_else(|| {
                AppError::validation_with_code(
                    format!("未找到仓库: {}", repo_id),
                    "repository_not_found",
                )
            })?;

        Ok(repo.publish_config.profiles.clone())
    })
}

/// 保存当前配置为配置文件（按仓库隔离）
#[tauri::command]
pub async fn save_profile(
    app: tauri::AppHandle,
    repo_id: String,
    name: String,
    provider_id: String,
    parameters: serde_json::Value,
    profile_group: Option<String>,
) -> Result<AppState, AppError> {
    let mut state = get_state();

    let repo = state
        .repositories
        .iter_mut()
        .find(|r| r.id == repo_id)
        .ok_or_else(|| {
            AppError::validation_with_code(
                format!("未找到仓库: {}", repo_id),
                "repository_not_found",
            )
        })?;

    // 检查是否已存在同名配置文件
    if repo.publish_config.profiles.iter().any(|p| p.name == name) {
        return Err(AppError::validation_with_code(
            format!("配置文件 '{}' 已存在", name),
            "profile_exists",
        ));
    }

    let normalized_profile_group = profile_group
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let profile = ConfigProfile {
        name: name.clone(),
        provider_id,
        parameters,
        profile_group: normalized_profile_group,
        created_at: chrono::Utc::now().to_rfc3339(),
        is_system_default: false,
    };

    repo.publish_config.profiles.push(profile);
    let response = state.clone();
    persist_state_and_refresh_tray(&app, state).await?;
    Ok(response)
}

/// 更新已保存配置文件（按仓库隔离）
#[tauri::command]
pub async fn update_profile(
    app: tauri::AppHandle,
    repo_id: String,
    original_name: String,
    name: String,
    provider_id: String,
    parameters: serde_json::Value,
    profile_group: Option<String>,
) -> Result<AppState, AppError> {
    let mut state = get_state();

    let repo = state
        .repositories
        .iter_mut()
        .find(|r| r.id == repo_id)
        .ok_or_else(|| {
            AppError::validation_with_code(
                format!("未找到仓库: {}", repo_id),
                "repository_not_found",
            )
        })?;

    if original_name != name && repo.publish_config.profiles.iter().any(|p| p.name == name) {
        return Err(AppError::validation_with_code(
            format!("配置文件 '{}' 已存在", name),
            "profile_exists",
        ));
    }

    let normalized_profile_group = profile_group
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let profile = repo
        .publish_config
        .profiles
        .iter_mut()
        .find(|p| p.name == original_name)
        .ok_or_else(|| {
            AppError::validation_with_code(
                format!("未找到配置文件: {}", original_name),
                "profile_not_found",
            )
        })?;

    if profile.is_system_default {
        return Err(AppError::validation_with_code(
            "不能编辑系统默认配置文件",
            "system_profile_immutable",
        ));
    }

    profile.name = name;
    profile.provider_id = provider_id;
    profile.parameters = parameters;
    profile.profile_group = normalized_profile_group;

    let response = state.clone();
    persist_state_and_refresh_tray(&app, state).await?;
    Ok(response)
}

/// 删除配置文件（按仓库隔离）
#[tauri::command]
pub async fn delete_profile(
    app: tauri::AppHandle,
    repo_id: String,
    name: String,
) -> Result<AppState, AppError> {
    let mut state = get_state();

    let repo = state
        .repositories
        .iter_mut()
        .find(|r| r.id == repo_id)
        .ok_or_else(|| {
            AppError::validation_with_code(
                format!("未找到仓库: {}", repo_id),
                "repository_not_found",
            )
        })?;

    // 不允许删除系统默认配置文件
    if let Some(profile) = repo.publish_config.profiles.iter().find(|p| p.name == name) {
        if profile.is_system_default {
            return Err(AppError::validation_with_code(
                "不能删除系统默认配置文件",
                "system_profile_immutable",
            ));
        }
    }

    repo.publish_config.profiles.retain(|p| p.name != name);
    let response = state.clone();
    persist_state_and_refresh_tray(&app, state).await?;
    Ok(response)
}

/// 记录最近使用的发布配置
#[tauri::command]
pub async fn push_recent_publish_config(
    app: tauri::AppHandle,
    repo_id: String,
    config_key: String,
) -> Result<AppState, AppError> {
    let mut state = get_state();

    if !state.repositories.iter().any(|repo| repo.id == repo_id) {
        return Err(AppError::validation_with_code(
            format!("未找到仓库: {}", repo_id),
            "repository_not_found",
        ));
    }

    if !push_recent_publish_config_state(
        &mut state.recent_repo_ids,
        &mut state.recent_config_keys_by_repo,
        &repo_id,
        &config_key,
    ) {
        return Ok(get_bootstrap_state());
    }

    persist_state_and_refresh_tray(&app, state).await?;
    Ok(get_bootstrap_state())
}

/// 移除最近使用的发布配置
#[tauri::command]
pub async fn remove_recent_publish_config(
    app: tauri::AppHandle,
    repo_id: String,
    config_key: String,
) -> Result<AppState, AppError> {
    let mut state = get_state();

    if !remove_recent_publish_config_state(
        &mut state.recent_repo_ids,
        &mut state.recent_config_keys_by_repo,
        &repo_id,
        &config_key,
    ) {
        return Ok(get_bootstrap_state());
    }

    persist_state_and_refresh_tray(&app, state).await?;
    Ok(get_bootstrap_state())
}

/// 替换最近使用的发布配置 key
#[tauri::command]
pub async fn replace_recent_publish_config_key(
    app: tauri::AppHandle,
    repo_id: String,
    previous_key: String,
    next_key: String,
) -> Result<AppState, AppError> {
    let mut state = get_state();

    if !replace_recent_publish_config_key_state(
        &mut state.recent_config_keys_by_repo,
        &repo_id,
        &previous_key,
        &next_key,
    ) {
        return Ok(get_bootstrap_state());
    }

    persist_state_and_refresh_tray(&app, state).await?;
    Ok(get_bootstrap_state())
}

fn append_execution_history(
    history: &mut Vec<ExecutionRecord>,
    record: ExecutionRecord,
    execution_history_limit: usize,
) {
    history.insert(0, record);
    trim_execution_history(history, execution_history_limit);
}

/// 获取执行历史
#[tauri::command]
pub async fn get_execution_history() -> Result<Vec<ExecutionRecord>, AppError> {
    Ok(get_execution_history_snapshot())
}

/// 追加执行历史记录（按配置保留最近 N 条）
#[tauri::command]
pub async fn add_execution_record(
    record: ExecutionRecord,
) -> Result<Vec<ExecutionRecord>, AppError> {
    let mut state = get_state();
    let history_limit = state.execution_history_limit;
    append_execution_history(&mut state.execution_history, record, history_limit);
    let history = state.execution_history.clone();
    update_state(state)?;
    Ok(history)
}

/// 更新执行记录关联的快照路径
#[tauri::command]
pub async fn set_execution_record_snapshot(
    record_id: String,
    snapshot_path: String,
) -> Result<Vec<ExecutionRecord>, AppError> {
    let mut state = get_state();
    let mut found = false;

    for record in &mut state.execution_history {
        if record.id == record_id {
            record.snapshot_path = Some(snapshot_path.clone());
            found = true;
            break;
        }
    }

    if !found {
        return Err(AppError::validation_with_code(
            format!("未找到执行记录: {}", record_id),
            "execution_record_not_found",
        ));
    }

    let history = state.execution_history.clone();
    update_state(state)?;
    Ok(history)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_repo(id: &str) -> Repository {
        Repository {
            id: id.to_string(),
            name: format!("Repo {id}"),
            path: format!("/{id}"),
            project_file: None,
            current_branch: "main".to_string(),
            branches: Vec::new(),
            is_main: true,
            provider_id: Some("dotnet".to_string()),
            publish_config: RepoPublishConfig::default(),
        }
    }

    #[test]
    fn bootstrap_state_serialization_excludes_execution_history() {
        let state = AppState {
            repositories: vec![Repository {
                id: "repo-1".to_string(),
                name: "one-publish".to_string(),
                path: "/repo".to_string(),
                project_file: None,
                current_branch: "main".to_string(),
                branches: Vec::new(),
                is_main: true,
                provider_id: Some("dotnet".to_string()),
                publish_config: RepoPublishConfig::default(),
            }],
            execution_history: vec![ExecutionRecord {
                id: "history-1".to_string(),
                repo_id: Some("repo-1".to_string()),
                provider_id: "dotnet".to_string(),
                project_path: "/repo/App.csproj".to_string(),
                started_at: "2026-03-28T10:00:00.000Z".to_string(),
                finished_at: "2026-03-28T10:00:03.000Z".to_string(),
                success: true,
                cancelled: false,
                output_dir: Some("/repo/out".to_string()),
                error: None,
                command_line: None,
                snapshot_path: None,
                failure_signature: None,
                spec: None,
                file_count: 2,
            }],
            ..AppState::default()
        };

        let frontend_state = build_frontend_state(&state);
        let serialized = serde_json::to_value(&frontend_state).expect("serialize frontend state");

        assert_eq!(
            serialized
                .get("executionHistory")
                .and_then(serde_json::Value::as_array)
                .map(Vec::len),
            Some(0),
            "前端启动载荷不应携带执行历史内容"
        );
        assert_eq!(
            serialized
                .get("repositories")
                .and_then(serde_json::Value::as_array)
                .map(Vec::len),
            Some(1)
        );
        assert_eq!(
            serialized
                .get("profiles")
                .and_then(serde_json::Value::as_array)
                .map(Vec::len),
            Some(0)
        );
    }

    #[test]
    fn push_recent_publish_config_state_deduplicates_and_truncates() {
        let mut recent_repo_ids = vec![
            "repo-6".to_string(),
            "repo-5".to_string(),
            "repo-4".to_string(),
            "repo-3".to_string(),
            "repo-2".to_string(),
            "repo-1".to_string(),
        ];
        let mut recent_config_keys_by_repo = BTreeMap::from([
            (
                "repo-1".to_string(),
                vec![
                    "userprofile:alpha".to_string(),
                    "userprofile:beta".to_string(),
                    "userprofile:gamma".to_string(),
                    "userprofile:delta".to_string(),
                    "userprofile:epsilon".to_string(),
                    "userprofile:zeta".to_string(),
                ],
            ),
            ("repo-7".to_string(), vec!["userprofile:legacy".to_string()]),
        ]);

        assert!(push_recent_publish_config_state(
            &mut recent_repo_ids,
            &mut recent_config_keys_by_repo,
            "repo-1",
            "userprofile:beta",
        ));

        assert_eq!(recent_repo_ids[0], "repo-1");
        assert_eq!(
            recent_config_keys_by_repo.get("repo-1"),
            Some(&vec![
                "userprofile:beta".to_string(),
                "userprofile:alpha".to_string(),
                "userprofile:gamma".to_string(),
                "userprofile:delta".to_string(),
                "userprofile:epsilon".to_string(),
                "userprofile:zeta".to_string(),
            ])
        );
        assert!(!recent_config_keys_by_repo.contains_key("repo-7"));
    }

    #[test]
    fn remove_recent_publish_config_state_prunes_empty_repo_bucket() {
        let mut recent_repo_ids = vec!["repo-1".to_string()];
        let mut recent_config_keys_by_repo =
            BTreeMap::from([("repo-1".to_string(), vec!["userprofile:alpha".to_string()])]);

        assert!(remove_recent_publish_config_state(
            &mut recent_repo_ids,
            &mut recent_config_keys_by_repo,
            "repo-1",
            "userprofile:alpha",
        ));

        assert!(recent_repo_ids.is_empty());
        assert!(recent_config_keys_by_repo.is_empty());
    }

    #[test]
    fn replace_recent_publish_config_key_state_keeps_order_and_deduplicates() {
        let mut recent_config_keys_by_repo = BTreeMap::from([(
            "repo-1".to_string(),
            vec![
                "userprofile:alpha".to_string(),
                "userprofile:beta".to_string(),
                "userprofile:gamma".to_string(),
            ],
        )]);

        assert!(replace_recent_publish_config_key_state(
            &mut recent_config_keys_by_repo,
            "repo-1",
            "userprofile:beta",
            "userprofile:alpha",
        ));

        assert_eq!(
            recent_config_keys_by_repo.get("repo-1"),
            Some(&vec![
                "userprofile:alpha".to_string(),
                "userprofile:gamma".to_string(),
            ])
        );
    }

    #[test]
    fn sanitize_recent_publish_state_removes_unknown_repositories() {
        let mut state = AppState {
            repositories: vec![test_repo("repo-1"), test_repo("repo-2")],
            recent_repo_ids: vec![
                "repo-3".to_string(),
                "repo-2".to_string(),
                "repo-2".to_string(),
                "repo-1".to_string(),
            ],
            recent_config_keys_by_repo: BTreeMap::from([
                ("repo-1".to_string(), vec!["userprofile:alpha".to_string()]),
                ("repo-2".to_string(), vec!["userprofile:beta".to_string()]),
                ("repo-3".to_string(), vec!["userprofile:stale".to_string()]),
            ]),
            ..AppState::default()
        };

        sanitize_recent_publish_state(&mut state);

        assert_eq!(
            state.recent_repo_ids,
            vec!["repo-2".to_string(), "repo-1".to_string()]
        );
        assert_eq!(state.recent_config_keys_by_repo.len(), 2);
        assert!(!state.recent_config_keys_by_repo.contains_key("repo-3"));
    }
}
