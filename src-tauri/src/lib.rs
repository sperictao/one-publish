// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

pub mod artifact;
pub mod command_parser;
pub mod commands;
pub mod compiler;
pub mod config_export;
pub mod environment;
pub mod errors;
pub mod parameter;
pub mod plan;
pub mod provider;
pub mod publish;
pub mod shortcuts;
pub mod spec;
pub mod store;
pub mod tray;

pub use environment::{check_environment, FixAction, FixResult, FixType};

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 当尝试启动第二个实例时，显示主窗口
            log::info!("检测到第二个实例启动，显示主窗口");
            if let Some(window) = app.get_webview_window("main") {
                #[cfg(target_os = "windows")]
                {
                    let _ = window.set_skip_taskbar(false);
                }
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();

                #[cfg(target_os = "macos")]
                {
                    tray::apply_tray_policy(app, true);
                }
            }
        }))
        .setup(|app| {
            // 初始化系统托盘
            if let Err(err) = tray::init_tray(app.handle()) {
                log::error!("初始化系统托盘失败: {}", err);
            }

            // 注册全局快捷键
            if let Err(err) = shortcuts::register_shortcuts(app.handle()) {
                log::error!("注册全局快捷键失败: {}", err);
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let settings = crate::store::get_state();

                if settings.minimize_to_tray_on_close {
                    // 阻止默认关闭行为
                    api.prevent_close();

                    // 隐藏窗口
                    let _ = window.hide();

                    // Windows 平台隐藏任务栏图标
                    #[cfg(target_os = "windows")]
                    {
                        let _ = window.set_skip_taskbar(true);
                    }

                    // macOS 平台切换到 Accessory 模式（隐藏 Dock 图标）
                    #[cfg(target_os = "macos")]
                    {
                        tray::apply_tray_policy(window.app_handle(), false);
                    }

                    log::info!("窗口已最小化到托盘");
                } else {
                    // 正常退出应用
                    window.app_handle().exit(0);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_project,
            commands::detect_repository_provider,
            commands::scan_repository_branches,
            commands::execute_publish,
            commands::execute_provider_publish,
            commands::cancel_provider_publish,
            commands::check_update,
            commands::install_update,
            commands::get_updater_help_paths,
            commands::get_updater_config_health,
            commands::open_updater_help,
            commands::get_current_version,
            commands::get_shortcuts_help,
            commands::list_providers,
            commands::get_provider_schema,
            commands::import_from_command,
            commands::export_config,
            commands::export_preflight_report,
            commands::export_execution_snapshot,
            commands::export_failure_group_bundle,
            commands::export_execution_history,
            commands::export_diagnostics_index,
            commands::open_execution_snapshot,
            commands::import_config,
            commands::apply_imported_config,
            commands::run_environment_check,
            commands::apply_fix,
            commands::package_artifact,
            commands::sign_artifact,
            store::get_app_state,
            store::save_app_state,
            store::add_repository,
            store::remove_repository,
            store::update_repository,
            store::update_ui_state,
            store::update_publish_state,
            store::update_preferences,
            store::get_profiles,
            store::save_profile,
            store::delete_profile,
            store::get_execution_history,
            store::add_execution_record,
            store::set_execution_record_snapshot,
            tray::update_tray_menu
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
