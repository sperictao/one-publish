//! 应用状态持久化模块
//!
//! 使用 JSON 文件存储应用配置，位于 `~/.one-publish/config.json`

use serde::{Deserialize, Serialize};
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
    pub current_branch: String,
    pub branches: Vec<Branch>,
    #[serde(default)]
    pub is_main: bool,
}

/// 发布配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishConfigStore {
    pub configuration: String,
    pub runtime: String,
    pub self_contained: bool,
    pub output_dir: String,
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
    pub created_at: String,
    pub is_system_default: bool,
}

impl Default for PublishConfigStore {
    fn default() -> Self {
        Self {
            configuration: "Release".to_string(),
            runtime: String::new(),
            self_contained: false,
            output_dir: String::new(),
            use_profile: false,
            profile_name: String::new(),
        }
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
            selected_preset: default_preset(),
            is_custom_mode: false,
            custom_config: PublishConfigStore::default(),
            minimize_to_tray_on_close: default_minimize_to_tray(),
            language: default_language(),
            default_output_dir: String::new(),
            theme: default_theme(),
            profiles: Vec::new(),
        }
    }
}

/// 获取配置文件路径
fn get_config_path() -> PathBuf {
    dirs::home_dir()
        .expect("无法获取用户主目录")
        .join(".one-publish")
        .join("config.json")
}

/// 从文件加载状态
fn load_from_file() -> AppState {
    let path = get_config_path();
    if let Ok(content) = fs::read_to_string(&path) {
        match serde_json::from_str::<AppState>(&content) {
            Ok(state) => state,
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
fn save_to_file(state: &AppState) -> Result<(), String> {
    let path = get_config_path();

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }

    let json =
        serde_json::to_string_pretty(state).map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(())
}

/// 全局状态存储
static STATE_STORE: OnceLock<RwLock<AppState>> = OnceLock::new();

fn state_store() -> &'static RwLock<AppState> {
    STATE_STORE.get_or_init(|| RwLock::new(load_from_file()))
}

/// 获取当前状态
pub fn get_state() -> AppState {
    state_store().read().expect("读取状态锁失败").clone()
}

/// 更新状态
pub fn update_state(new_state: AppState) -> Result<(), String> {
    save_to_file(&new_state)?;

    let mut guard = state_store().write().expect("写入状态锁失败");
    *guard = new_state;
    Ok(())
}

// ==================== Tauri Commands ====================

/// 获取应用状态
#[tauri::command]
pub async fn get_app_state() -> Result<AppState, String> {
    Ok(get_state())
}

/// 保存应用状态
#[tauri::command]
pub async fn save_app_state(state: AppState) -> Result<(), String> {
    update_state(state)
}

/// 添加仓库
#[tauri::command]
pub async fn add_repository(repo: Repository) -> Result<AppState, String> {
    let mut state = get_state();

    // 检查是否已存在
    if state.repositories.iter().any(|r| r.path == repo.path) {
        return Err("仓库已存在".to_string());
    }

    state.repositories.push(repo.clone());
    state.selected_repo_id = Some(repo.id);
    update_state(state.clone())?;
    Ok(state)
}

/// 删除仓库
#[tauri::command]
pub async fn remove_repository(repo_id: String) -> Result<AppState, String> {
    let mut state = get_state();

    state.repositories.retain(|r| r.id != repo_id);

    // 如果删除的是当前选中的仓库，清除选中状态
    if state.selected_repo_id.as_ref() == Some(&repo_id) {
        state.selected_repo_id = state.repositories.first().map(|r| r.id.clone());
    }

    update_state(state.clone())?;
    Ok(state)
}

/// 更新仓库
#[tauri::command]
pub async fn update_repository(repo: Repository) -> Result<AppState, String> {
    let mut state = get_state();

    if let Some(existing) = state.repositories.iter_mut().find(|r| r.id == repo.id) {
        *existing = repo;
    }

    update_state(state.clone())?;
    Ok(state)
}

/// 更新 UI 状态（面板宽度等）
#[tauri::command]
pub async fn update_ui_state(
    left_panel_width: Option<i32>,
    middle_panel_width: Option<i32>,
    selected_repo_id: Option<String>,
) -> Result<(), String> {
    let mut state = get_state();

    if let Some(width) = left_panel_width {
        state.left_panel_width = width;
    }
    if let Some(width) = middle_panel_width {
        state.middle_panel_width = width;
    }
    if selected_repo_id.is_some() {
        state.selected_repo_id = selected_repo_id;
    }

    update_state(state)
}

/// 更新发布配置状态
#[tauri::command]
pub async fn update_publish_state(
    selected_preset: Option<String>,
    is_custom_mode: Option<bool>,
    custom_config: Option<PublishConfigStore>,
) -> Result<(), String> {
    let mut state = get_state();

    if let Some(preset) = selected_preset {
        state.selected_preset = preset;
    }
    if let Some(mode) = is_custom_mode {
        state.is_custom_mode = mode;
    }
    if let Some(config) = custom_config {
        state.custom_config = config;
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
) -> Result<AppState, String> {
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

    update_state(state.clone())?;

    // 语言变化需要刷新托盘菜单以便实时更新文案
    if language_changed {
        if let Err(err) = crate::tray::update_tray_menu(app.clone()).await {
            log::warn!("刷新托盘菜单失败: {}", err);
        }
    }

    Ok(state)
}

/// 获取保存的配置文件
#[tauri::command]
pub async fn get_profiles() -> Result<Vec<ConfigProfile>, String> {
    let state = get_state();
    Ok(state.profiles)
}

/// 保存当前配置为配置文件
#[tauri::command]
pub async fn save_profile(
    name: String,
    provider_id: String,
    parameters: serde_json::Value,
) -> Result<AppState, String> {
    let mut state = get_state();

    // 检查是否已存在同名配置文件
    if state.profiles.iter().any(|p| p.name == name) {
        return Err(format!("配置文件 '{}' 已存在", name));
    }

    let profile = ConfigProfile {
        name: name.clone(),
        provider_id,
        parameters,
        created_at: chrono::Utc::now().to_rfc3339(),
        is_system_default: false,
    };

    state.profiles.push(profile);
    update_state(state.clone())?;
    Ok(state)
}

/// 删除配置文件
#[tauri::command]
pub async fn delete_profile(name: String) -> Result<AppState, String> {
    let mut state = get_state();

    // 不允许删除系统默认配置文件
    if let Some(profile) = state.profiles.iter().find(|p| p.name == name) {
        if profile.is_system_default {
            return Err("不能删除系统默认配置文件".to_string());
        }
    }

    state.profiles.retain(|p| p.name != name);
    update_state(state.clone())?;
    Ok(state)
}

