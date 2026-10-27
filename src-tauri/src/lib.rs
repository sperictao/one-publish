// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

// tauri-macros ≥2.7 为命令发射的隐藏宏（`__tauri_command_name_*`/`__cmd__*`）
// 只能经「其定义位置的模块路径」解析——宏展开的 macro_export 项不可用 use
// 绝对路径引用（rust#52234）。因此 generate_handler! 中的命令一律写真实
// 定义路径（如 commands::repository::scan_project），不走 mod.rs re-export。
pub mod artifact;
pub mod automation;
pub mod command_parser;
pub mod commands;
pub mod compiler;
pub mod config_export;
pub mod contracts;
pub mod environment;
pub mod errors;
pub mod output_target;
pub mod parameter;
pub mod plan;
pub mod process_utils;
pub mod provider;
pub mod publish_runtime;
pub mod security;
pub mod shortcuts;
pub mod spec;
pub mod store;
pub mod tauri_release;
pub mod tray;

pub use environment::{check_environment, FixAction, FixResult, FixType};

use tauri::Manager;
#[cfg(target_os = "macos")]
use tauri_plugin_decorum::WebviewWindowExt;

fn build_log_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    #[cfg(debug_assertions)]
    {
        use tauri_plugin_log::{Target, TargetKind};

        tauri_plugin_log::Builder::new()
            .clear_targets()
            .target(Target::new(TargetKind::Stdout))
            .build()
    }

    #[cfg(not(debug_assertions))]
    {
        tauri_plugin_log::Builder::new().build()
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let result = tauri::Builder::default()
        .plugin(build_log_plugin())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_decorum::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 当尝试启动第二个实例时，显示主窗口
            log::info!("检测到第二个实例启动，显示主窗口");
            tray::restore_main_window(app);
        }))
        .setup(|app| {
            app.manage(commands::PendingUpdateState::default());

            let Some(main_window) = app.get_webview_window("main") else {
                return Err(tauri::Error::WindowNotFound.into());
            };

            // 根据显示器分辨率自适应窗口大小
            if let Ok(Some(monitor)) = main_window.current_monitor() {
                let size = monitor.size();
                let scale = monitor.scale_factor();
                let logical_w = size.width as f64 / scale;
                let logical_h = size.height as f64 / scale;

                let target_w = (logical_w * 0.75).clamp(900.0, 1600.0) as u32;
                let target_h = (logical_h * 0.75).clamp(700.0, 1000.0) as u32;

                let _ = main_window.set_size(tauri::LogicalSize::new(target_w, target_h));
                let _ = main_window.center();
                log::info!(
                    "自适应窗口大小: {}x{} (显示器: {}x{}, scale: {:.1})",
                    target_w,
                    target_h,
                    size.width,
                    size.height,
                    scale
                );
            }

            // 设置 macOS 交通灯位置
            #[cfg(target_os = "macos")]
            {
                main_window.set_traffic_lights_inset(18.0, 32.0)?;
            }

            // 初始化系统托盘
            if let Err(err) = tray::init_tray(app.handle()) {
                log::error!("初始化系统托盘失败: {}", err);
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let settings = crate::store::get_state();

                if settings.minimize_to_tray_on_close {
                    // 阻止默认关闭行为
                    api.prevent_close();

                    tray::minimize_main_window_to_tray(window.app_handle());
                    log::info!("窗口已最小化到托盘");
                } else {
                    // 正常退出应用
                    window.app_handle().exit(0);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::repository::scan_project,
            commands::repository::scan_project_candidates,
            commands::repository::resolve_project_info,
            commands::repository::read_project_publish_profile,
            commands::repository::detect_repository_provider,
            commands::repository::scan_repository_branches,
            commands::repository::check_repository_branch_connectivity,
            commands::publish::preflight_publish_output,
            commands::publish::describe_publish_output_target,
            publish_runtime::prepare_publish_runtime,
            publish_runtime::source::resolve_publish_source,
            publish_runtime::start_publish_runtime,
            publish_runtime::resume_publish_runtime,
            publish_runtime::synchronize_publish_runtime,
            publish_runtime::remote_evidence::synchronize_remote_publish_evidence,
            publish_runtime::remote_evidence::dispatch_manual_publish_run,
            publish_runtime::remote_evidence::cancel_remote_publish_run,
            publish_runtime::cancel_publish_runtime,
            publish_runtime::list_publish_adapter_catalog,
            automation::list_automation_bindings,
            automation::preview_automation_change,
            automation::apply_automation_change,
            commands::updater::check_update,
            commands::updater::install_update,
            commands::updater::get_updater_help_paths,
            commands::updater::get_updater_config_health,
            commands::updater::open_updater_help,
            commands::updater::get_current_version,
            commands::updater::get_shortcuts_help,
            commands::provider::list_providers,
            commands::provider::get_provider_schema,
            commands::provider::import_from_command,
            commands::config::export_config,
            commands::export::export_preflight_report,
            commands::export::export_execution_snapshot,
            commands::export::export_failure_group_bundle,
            commands::export::export_handoff_bundle,
            commands::export::export_execution_history,
            commands::export::export_diagnostics_index,
            commands::export::open_directory,
            commands::export::open_execution_snapshot,
            commands::export::open_output_directory,
            commands::notification::show_system_notification,
            commands::config::import_config,
            commands::config::apply_imported_config,
            commands::environment::run_environment_check,
            commands::environment::apply_fix,
            commands::artifact::package_artifact,
            commands::artifact::sign_artifact,
            store::commands::get_app_state,
            store::commands::get_repository,
            store::commands::add_repository,
            store::commands::remove_repository,
            store::commands::update_repository,
            store::commands::reorder_repositories,
            store::commands::update_ui_state,
            store::commands::update_publish_edit_state,
            store::commands::update_preferences,
            store::commands::save_profile,
            store::commands::update_profile,
            store::commands::load_release_settings_draft,
            store::commands::update_profile_release_settings,
            store::commands::rebind_profile_project,
            store::commands::delete_profile,
            store::commands::push_recent_publish_config,
            store::commands::remove_recent_publish_config,
            store::commands::reorder_recent_publish_configs,
            store::commands::reorder_profiles,
            store::commands::replace_recent_publish_config_key,
            store::commands::get_execution_history,
            store::commands::add_execution_record,
            store::commands::set_execution_record_snapshot,
            tray::show_main_window,
            tray::set_tray_publish_status
        ])
        .run(tauri::generate_context!());

    if let Err(err) = result {
        eprintln!("error while running tauri application: {err}");
        std::process::exit(1);
    }
}
