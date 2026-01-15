//! 系统托盘模块
//!
//! 处理系统托盘图标、菜单创建和事件处理

use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Wry,
};

/// 托盘菜单文本（多语言支持）
pub struct TrayTexts {
    pub show_main: String,
    pub quit: String,
}

impl TrayTexts {
    pub fn from_language(language: &str) -> Self {
        match language {
            "en" => Self {
                show_main: "Show Main Window".to_string(),
                quit: "Quit".to_string(),
            },
            _ => Self {
                // 中文默认
                show_main: "显示主界面".to_string(),
                quit: "退出应用".to_string(),
            },
        }
    }
}

impl Default for TrayTexts {
    fn default() -> Self {
        Self::from_language("zh")
    }
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

    let show_main_item = MenuItem::with_id(app, "show_main", texts.show_main, true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", texts.quit, true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(app, &[&show_main_item, &separator, &quit_item])?;

    Ok(menu)
}

/// 处理托盘菜单事件
pub fn handle_tray_menu_event(app: &AppHandle, event_id: &str) {
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
        .on_menu_event(|app, event| {
            handle_tray_menu_event(app, event.id().as_ref());
        })
        .on_tray_icon_event(|tray, event| {
            // 处理左键点击显示窗口
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                restore_main_window(tray.app_handle());
            }
        });

    // macOS 使用 template 图标以适应亮暗色主题
    #[cfg(target_os = "macos")]
    {
        if let Some(icon) = macos_tray_icon() {
            tray_builder = tray_builder.icon(icon).icon_as_template(true);
        }
    }

    // 构建托盘图标
    tray_builder.build(app)?;

    log::info!("系统托盘初始化成功");
    Ok(())
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

/// 更新托盘菜单
#[tauri::command]
pub async fn update_tray_menu(app: AppHandle) -> Result<bool, String> {
    match create_tray_menu(&app) {
        Ok(new_menu) => {
            if let Some(tray) = app.tray_by_id("main") {
                tray.set_menu(Some(new_menu))
                    .map_err(|e| format!("更新托盘菜单失败: {}", e))?;
                return Ok(true);
            }
            Ok(false)
        }
        Err(err) => {
            log::error!("创建托盘菜单失败: {}", err);
            Err(format!("创建托盘菜单失败: {}", err))
        }
    }
}
