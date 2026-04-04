//! 系统托盘模块
//!
//! 处理系统托盘图标、菜单创建和事件处理

use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        OnceLock,
    },
    thread,
    time::Duration,
};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, Wry,
};

const TRAY_PUBLISH_EVENT_PREFIX: &str = "tray_publish:";
const MAX_TRAY_CONFIGS_PER_REPO: usize = 3;
const TRAY_PUBLISHING_TITLE_INTERVAL: Duration = Duration::from_millis(420);
const TRAY_RESULT_EFFECT_DURATION: Duration = Duration::from_secs(2);
const TRAY_PUBLISHING_DOT_COUNT: usize = 3;
const PUNCTUATION_SPACE: char = '\u{2008}';

/// 托盘菜单文本（多语言支持）
pub struct TrayTexts {
    pub show_main: String,
    pub quit: String,
    pub publishing: String,
    pub publish_success: String,
    pub publish_failure: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayPublishRequestPayload {
    pub repo_id: String,
    pub config_key: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TrayPublishStatus {
    Idle,
    Publishing,
    Success,
    Failure,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TrayRecentConfigMenuItem {
    config_key: String,
    label: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TrayRecentRepoMenu {
    repo_id: String,
    repo_name: String,
    config_items: Vec<TrayRecentConfigMenuItem>,
}

impl TrayTexts {
    pub fn from_language(language: &str) -> Self {
        match language {
            "en" => Self {
                show_main: "Show Main Window".to_string(),
                quit: "Quit".to_string(),
                publishing: "Publishing".to_string(),
                publish_success: "Publish Succeeded".to_string(),
                publish_failure: "Publish Failed".to_string(),
            },
            _ => Self {
                // 中文默认
                show_main: "显示主界面".to_string(),
                quit: "退出应用".to_string(),
                publishing: "发布中".to_string(),
                publish_success: "发布成功".to_string(),
                publish_failure: "发布失败".to_string(),
            },
        }
    }
}

impl Default for TrayTexts {
    fn default() -> Self {
        Self::from_language("zh")
    }
}

#[derive(Default)]
struct TrayAnimationController {
    revision: AtomicU64,
}

impl TrayAnimationController {
    fn begin_transition(&self) -> u64 {
        self.revision.fetch_add(1, Ordering::SeqCst) + 1
    }

    fn is_current(&self, revision: u64) -> bool {
        self.revision.load(Ordering::SeqCst) == revision
    }
}

fn tray_animation_controller() -> &'static TrayAnimationController {
    static CONTROLLER: OnceLock<TrayAnimationController> = OnceLock::new();
    CONTROLLER.get_or_init(TrayAnimationController::default)
}

fn current_tray_texts() -> TrayTexts {
    TrayTexts::from_language(crate::store::get_state().language.as_str())
}

fn resolve_status_title(
    texts: &TrayTexts,
    status: TrayPublishStatus,
    frame_index: usize,
) -> String {
    match status {
        TrayPublishStatus::Idle => String::new(),
        TrayPublishStatus::Publishing => {
            let visible_dots = (frame_index % TRAY_PUBLISHING_DOT_COUNT) + 1;
            let reserved_spaces = TRAY_PUBLISHING_DOT_COUNT.saturating_sub(visible_dots);
            format!(
                "{}{}{}",
                texts.publishing,
                ".".repeat(visible_dots),
                PUNCTUATION_SPACE.to_string().repeat(reserved_spaces)
            )
        }
        TrayPublishStatus::Success => texts.publish_success.clone(),
        TrayPublishStatus::Failure => texts.publish_failure.clone(),
    }
}

fn apply_tray_status_title(
    app: &AppHandle,
    status: TrayPublishStatus,
    frame_index: usize,
) -> Result<bool, crate::errors::AppError> {
    let Some(tray) = app.tray_by_id("main") else {
        return Ok(false);
    };
    let texts = current_tray_texts();
    let title = resolve_status_title(&texts, status, frame_index);

    #[cfg(target_os = "windows")]
    {
        let tooltip = if title.is_empty() {
            None::<&str>
        } else {
            Some(title.as_str())
        };
        tray.set_tooltip(tooltip).map_err(|source| {
            crate::errors::AppError::tray_with_code(
                format!("更新托盘提示失败: {}", source),
                "tray_tooltip_update_failed",
            )
        })?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        // `tray-icon` 在 macOS 上把 `set_title(None)` 实现成 no-op，
        // 空闲态需要显式写入空字符串才能真正清掉上一轮状态文字。
        tray.set_title(Some(title.as_str())).map_err(|source| {
            crate::errors::AppError::tray_with_code(
                format!("更新托盘标题失败: {}", source),
                "tray_title_update_failed",
            )
        })?;
    }

    Ok(true)
}

fn spawn_publishing_animation(app: AppHandle, revision: u64) {
    thread::spawn(move || {
        let mut frame_index = 1;
        while tray_animation_controller().is_current(revision) {
            thread::sleep(TRAY_PUBLISHING_TITLE_INTERVAL);
            if !tray_animation_controller().is_current(revision) {
                break;
            }
            if let Err(err) =
                apply_tray_status_title(&app, TrayPublishStatus::Publishing, frame_index)
            {
                log::warn!("更新发布中托盘状态失败: {}", err);
                break;
            }
            frame_index = (frame_index + 1) % TRAY_PUBLISHING_DOT_COUNT;
        }
    });
}

fn spawn_result_clear_animation(app: AppHandle, revision: u64) {
    thread::spawn(move || {
        thread::sleep(TRAY_RESULT_EFFECT_DURATION);

        if tray_animation_controller().is_current(revision) {
            if let Err(err) = apply_tray_status_title(&app, TrayPublishStatus::Idle, 0) {
                log::warn!("恢复托盘空闲标题失败: {}", err);
            }
        }
    });
}

fn set_tray_publish_status_internal(
    app: &AppHandle,
    status: TrayPublishStatus,
) -> Result<bool, crate::errors::AppError> {
    let revision = tray_animation_controller().begin_transition();
    let updated = apply_tray_status_title(app, status, 0)?;

    if !updated {
        return Ok(false);
    }

    match status {
        TrayPublishStatus::Idle => {}
        TrayPublishStatus::Publishing => spawn_publishing_animation(app.clone(), revision),
        TrayPublishStatus::Success | TrayPublishStatus::Failure => {
            spawn_result_clear_animation(app.clone(), revision)
        }
    }

    Ok(updated)
}

/// macOS 平台加载 template 图标
#[cfg(target_os = "macos")]
fn macos_tray_icon() -> Option<Image<'static>> {
    const ICON_BYTES: &[u8] = include_bytes!("../icons/tray/macos/statusbar_template.png");

    match Image::from_bytes(ICON_BYTES) {
        Ok(icon) => Some(icon),
        Err(err) => {
            log::warn!("加载 macOS 托盘图标失败: {}", err);
            None
        }
    }
}

/// Windows 平台加载彩色图标
#[cfg(target_os = "windows")]
fn windows_tray_icon() -> Option<Image<'static>> {
    const ICON_BYTES: &[u8] = include_bytes!("../icons/tray/windows/tray_icon.png");

    match Image::from_bytes(ICON_BYTES) {
        Ok(icon) => Some(icon),
        Err(err) => {
            log::warn!("加载 Windows 托盘图标失败: {}", err);
            None
        }
    }
}

fn build_tray_publish_event_id(repo_id: &str, config_key: &str) -> String {
    format!("{}{}:{}", TRAY_PUBLISH_EVENT_PREFIX, repo_id, config_key)
}

fn parse_tray_publish_event_id(event_id: &str) -> Option<TrayPublishRequestPayload> {
    let payload = event_id.strip_prefix(TRAY_PUBLISH_EVENT_PREFIX)?;
    let (repo_id, config_key) = payload.split_once(':')?;
    if repo_id.trim().is_empty() || config_key.trim().is_empty() {
        return None;
    }

    Some(TrayPublishRequestPayload {
        repo_id: repo_id.to_string(),
        config_key: config_key.to_string(),
    })
}

fn is_supported_dotnet_project_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase().ends_with("proj"))
        .unwrap_or(false)
}

fn resolve_repo_project_file(repo: &crate::store::Repository) -> Option<PathBuf> {
    repo.project_file
        .as_deref()
        .map(PathBuf::from)
        .filter(|path| path.is_file() && is_supported_dotnet_project_file(path))
        .or_else(|| crate::commands::resolve_project_file_from_search_path(Path::new(&repo.path)))
}

fn resolve_valid_pubxml_names(repo: &crate::store::Repository) -> Vec<String> {
    resolve_repo_project_file(repo)
        .map(|project_file| crate::commands::scan_publish_profiles(&project_file))
        .unwrap_or_default()
}

fn build_recent_repo_menus(state: &crate::store::AppState) -> Vec<TrayRecentRepoMenu> {
    let mut repo_menus = Vec::new();

    for repo_id in state.recent_repo_ids.iter().take(6) {
        let Some(repo) = state.repositories.iter().find(|item| item.id == *repo_id) else {
            continue;
        };
        let Some(recent_keys) = state.recent_config_keys_by_repo.get(repo_id) else {
            continue;
        };

        let valid_pubxml_names = resolve_valid_pubxml_names(repo);
        let mut config_items = Vec::new();

        for config_key in recent_keys {
            if config_items.len() >= MAX_TRAY_CONFIGS_PER_REPO {
                break;
            }

            let Some((key_type, key_value)) = config_key.split_once(':') else {
                continue;
            };

            let label = match key_type {
                "userprofile" => repo
                    .publish_config
                    .profiles
                    .iter()
                    .find(|profile| profile.name == key_value)
                    .map(|profile| profile.name.clone()),
                "pubxml" => valid_pubxml_names
                    .iter()
                    .any(|profile_name| profile_name == key_value)
                    .then(|| key_value.to_string()),
                _ => None,
            };

            if let Some(label) = label {
                config_items.push(TrayRecentConfigMenuItem {
                    config_key: config_key.clone(),
                    label,
                });
            }
        }

        if config_items.is_empty() {
            continue;
        }

        repo_menus.push(TrayRecentRepoMenu {
            repo_id: repo.id.clone(),
            repo_name: repo.name.clone(),
            config_items,
        });
    }

    repo_menus
}

fn append_recent_repo_section(
    menu: &Menu<Wry>,
    app: &AppHandle,
    repo_menu: &TrayRecentRepoMenu,
    insert_separator_before: bool,
) -> Result<(), tauri::Error> {
    if insert_separator_before {
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }

    let header_item = MenuItem::with_id(
        app,
        format!("recent_repo_header:{}", repo_menu.repo_id),
        repo_menu.repo_name.clone(),
        false,
        None::<&str>,
    )?;
    menu.append(&header_item)?;

    for config in &repo_menu.config_items {
        let config_item = MenuItem::with_id(
            app,
            build_tray_publish_event_id(&repo_menu.repo_id, &config.config_key),
            config.label.clone(),
            true,
            None::<&str>,
        )?;
        menu.append(&config_item)?;
    }

    Ok(())
}

/// 恢复并显示主窗口
///
/// 统一处理窗口恢复逻辑，包括：
/// - Windows: 恢复任务栏显示
/// - macOS: 设置 Dock 可见性
/// - 通用: 取消最小化、显示窗口、设置焦点
pub fn restore_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        log::warn!("无法获取主窗口");
        return;
    };

    // Windows 平台恢复任务栏显示
    #[cfg(target_os = "windows")]
    {
        if let Err(e) = window.set_skip_taskbar(false) {
            log::warn!("恢复任务栏显示失败: {}", e);
        }
    }

    if let Err(e) = window.unminimize() {
        log::warn!("取消最小化失败: {}", e);
    }

    if let Err(e) = window.show() {
        log::warn!("显示窗口失败: {}", e);
    }

    if let Err(e) = window.set_focus() {
        log::warn!("设置焦点失败: {}", e);
    }

    // macOS 平台设置为 Regular 模式并显示 Dock 图标
    #[cfg(target_os = "macos")]
    {
        apply_tray_policy(app, true);
    }
}

/// 创建托盘菜单
pub fn create_tray_menu(app: &AppHandle) -> Result<Menu<Wry>, tauri::Error> {
    let state = crate::store::get_state();
    let texts = TrayTexts::from_language(state.language.as_str());
    let recent_repo_menus = build_recent_repo_menus(&state);
    let menu = Menu::new(app)?;

    let show_main_item = MenuItem::with_id(app, "show_main", texts.show_main, true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", texts.quit, true, None::<&str>)?;

    menu.append(&show_main_item)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;

    for (index, repo_menu) in recent_repo_menus.iter().enumerate() {
        append_recent_repo_section(&menu, app, repo_menu, index > 0)?;
    }

    if !recent_repo_menus.is_empty() {
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }

    menu.append(&quit_item)?;

    Ok(menu)
}

/// 处理托盘菜单事件
pub fn handle_tray_menu_event(app: &AppHandle, event_id: &str) {
    if let Some(payload) = parse_tray_publish_event_id(event_id) {
        if let Err(err) = set_tray_publish_status_internal(app, TrayPublishStatus::Publishing) {
            log::warn!("切换托盘发布中状态失败: {}", err);
        }
        if let Err(err) = app.emit("tray-publish-request", payload) {
            log::warn!("发送 tray-publish-request 失败: {}", err);
            if let Err(status_err) =
                set_tray_publish_status_internal(app, TrayPublishStatus::Failure)
            {
                log::warn!("切换托盘失败状态失败: {}", status_err);
            }
        }
        return;
    }

    match event_id {
        "show_main" => {
            restore_main_window(app);
        }
        "quit" => {
            log::info!("用户从托盘菜单选择退出");
            app.exit(0);
        }
        _ => {
            log::debug!("未处理的托盘菜单事件: {}", event_id);
        }
    }
}

/// macOS 平台设置 Dock 可见性
#[cfg(target_os = "macos")]
pub fn apply_tray_policy(app: &AppHandle, dock_visible: bool) {
    use tauri::ActivationPolicy;

    let desired_policy = if dock_visible {
        ActivationPolicy::Regular // 显示在 Dock
    } else {
        ActivationPolicy::Accessory // 隐藏 Dock 图标
    };

    if let Err(err) = app.set_activation_policy(desired_policy) {
        log::warn!("设置激活策略失败: {}", err);
    }
}

/// 初始化系统托盘
pub fn init_tray(app: &AppHandle) -> Result<(), tauri::Error> {
    let menu = create_tray_menu(app)?;

    let mut tray_builder = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            handle_tray_menu_event(app, event.id().as_ref());
        });

    #[cfg(target_os = "macos")]
    {
        if let Some(icon) = macos_tray_icon() {
            tray_builder = tray_builder.icon(icon).icon_as_template(true);
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(icon) = windows_tray_icon() {
            tray_builder = tray_builder.icon(icon);
        }
    }

    // 构建托盘图标
    tray_builder.build(app)?;

    log::info!("系统托盘初始化成功");
    Ok(())
}

#[tauri::command]
pub async fn show_main_window(app: AppHandle) -> Result<bool, crate::errors::AppError> {
    restore_main_window(&app);
    Ok(true)
}

/// 更新托盘菜单
#[tauri::command]
pub async fn update_tray_menu(app: AppHandle) -> Result<bool, crate::errors::AppError> {
    match create_tray_menu(&app) {
        Ok(new_menu) => {
            if let Some(tray) = app.tray_by_id("main") {
                tray.set_menu(Some(new_menu)).map_err(|source| {
                    crate::errors::AppError::tray_with_code(
                        format!("更新托盘菜单失败: {}", source),
                        "tray_menu_update_failed",
                    )
                })?;
                return Ok(true);
            }
            Ok(false)
        }
        Err(err) => {
            log::error!("创建托盘菜单失败: {}", err);
            Err(crate::errors::AppError::tray_with_code(
                format!("创建托盘菜单失败: {}", err),
                "tray_menu_create_failed",
            ))
        }
    }
}

#[tauri::command]
pub async fn set_tray_publish_status(
    app: AppHandle,
    status: TrayPublishStatus,
) -> Result<bool, crate::errors::AppError> {
    set_tray_publish_status_internal(&app, status)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{AppState, ConfigProfile, RepoPublishConfig, Repository};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn create_test_repo(
        id: &str,
        name: &str,
        path: &str,
        project_file: Option<String>,
        profiles: Vec<&str>,
    ) -> Repository {
        Repository {
            id: id.to_string(),
            name: name.to_string(),
            path: path.to_string(),
            project_file,
            current_branch: "main".to_string(),
            branches: Vec::new(),
            is_main: true,
            provider_id: Some("dotnet".to_string()),
            publish_config: RepoPublishConfig {
                profiles: profiles
                    .into_iter()
                    .map(|name| ConfigProfile {
                        name: name.to_string(),
                        provider_id: "dotnet".to_string(),
                        parameters: serde_json::json!({}),
                        profile_group: None,
                        created_at: "2026-04-02T10:00:00Z".to_string(),
                        is_system_default: false,
                    })
                    .collect(),
                ..RepoPublishConfig::default()
            },
        }
    }

    fn create_pubxml_fixture(repo_name: &str, profile_names: &[&str]) -> (String, String) {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("one-publish-tray-{repo_name}-{unique}"));
        let profiles_dir = root.join("UI").join("Properties").join("PublishProfiles");
        fs::create_dir_all(&profiles_dir).expect("create profiles dir");
        fs::write(
            root.join(format!("{repo_name}.sln")),
            "Microsoft Visual Studio Solution File",
        )
        .expect("write sln");

        let project_file = root.join("UI").join(format!("{repo_name}.csproj"));
        fs::write(&project_file, "<Project />").expect("write csproj");

        for profile_name in profile_names {
            fs::write(
                profiles_dir.join(format!("{profile_name}.pubxml")),
                "<Project />",
            )
            .expect("write pubxml");
        }

        (
            root.to_string_lossy().to_string(),
            project_file.to_string_lossy().to_string(),
        )
    }

    #[test]
    fn tray_publish_event_id_round_trips() {
        let event_id = build_tray_publish_event_id("repo-1", "userprofile:alpha");
        assert_eq!(
            parse_tray_publish_event_id(&event_id),
            Some(TrayPublishRequestPayload {
                repo_id: "repo-1".to_string(),
                config_key: "userprofile:alpha".to_string(),
            })
        );
    }

    #[test]
    fn resolve_status_title_clears_idle_title() {
        let texts = TrayTexts::default();

        assert_eq!(
            resolve_status_title(&texts, TrayPublishStatus::Idle, 0),
            String::new()
        );
    }

    #[test]
    fn resolve_status_title_reserves_fixed_publishing_width() {
        let texts = TrayTexts::default();
        let titles = (0..TRAY_PUBLISHING_DOT_COUNT)
            .map(|frame_index| {
                resolve_status_title(&texts, TrayPublishStatus::Publishing, frame_index)
            })
            .collect::<Vec<_>>();

        assert_eq!(
            titles,
            vec![
                format!("发布中.{}{}", PUNCTUATION_SPACE, PUNCTUATION_SPACE),
                format!("发布中..{}", PUNCTUATION_SPACE),
                "发布中...".to_string(),
            ]
        );

        let char_counts = titles
            .iter()
            .map(|title| title.chars().count())
            .collect::<Vec<_>>();
        assert!(char_counts.windows(2).all(|pair| pair[0] == pair[1]));
    }

    #[test]
    fn resolve_status_title_returns_result_messages() {
        let texts = TrayTexts::default();

        assert_eq!(
            resolve_status_title(&texts, TrayPublishStatus::Success, 0),
            "发布成功"
        );
        assert_eq!(
            resolve_status_title(&texts, TrayPublishStatus::Failure, 0),
            "发布失败"
        );
    }

    #[test]
    fn build_recent_repo_menus_limits_repos_and_skips_invalid_entries() {
        let (repo_root, _project_file) = create_pubxml_fixture("repo-a", &["ReleaseProfile"]);
        let solution_file = Path::new(&repo_root)
            .join("repo-a.sln")
            .to_string_lossy()
            .to_string();
        let repo_a = create_test_repo(
            "repo-a",
            "Repo A",
            &repo_root,
            Some(solution_file),
            vec!["alpha", "beta", "gamma", "delta"],
        );

        let mut repositories = vec![repo_a];
        for index in 2..=7 {
            repositories.push(create_test_repo(
                &format!("repo-{index}"),
                &format!("Repo {index}"),
                &format!("/repo-{index}"),
                None,
                vec!["profile"],
            ));
        }

        let mut recent_config_keys_by_repo = std::collections::BTreeMap::new();
        recent_config_keys_by_repo.insert(
            "repo-a".to_string(),
            vec![
                "preset:release-fd".to_string(),
                "userprofile:alpha".to_string(),
                "pubxml:ReleaseProfile".to_string(),
                "userprofile:missing".to_string(),
                "userprofile:beta".to_string(),
                "userprofile:gamma".to_string(),
                "userprofile:delta".to_string(),
            ],
        );
        for index in 2..=7 {
            recent_config_keys_by_repo.insert(
                format!("repo-{index}"),
                vec!["userprofile:profile".to_string()],
            );
        }

        let state = AppState {
            repositories,
            recent_repo_ids: vec![
                "repo-a".to_string(),
                "repo-2".to_string(),
                "repo-3".to_string(),
                "repo-4".to_string(),
                "repo-5".to_string(),
                "repo-6".to_string(),
                "repo-7".to_string(),
            ],
            recent_config_keys_by_repo,
            ..AppState::default()
        };

        let menus = build_recent_repo_menus(&state);

        assert_eq!(menus.len(), 6);
        assert_eq!(menus[0].repo_id, "repo-a");
        assert_eq!(
            menus[0]
                .config_items
                .iter()
                .map(|item| item.label.as_str())
                .collect::<Vec<_>>(),
            vec!["alpha", "ReleaseProfile", "beta"]
        );
        assert!(menus.iter().all(|menu| menu.config_items.len() <= 3));
        assert!(menus.iter().all(|menu| menu.repo_id != "repo-7"));
    }
}
