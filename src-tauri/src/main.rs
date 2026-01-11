// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod store;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::scan_project,
            commands::execute_publish,
            store::get_app_state,
            store::save_app_state,
            store::add_repository,
            store::remove_repository,
            store::update_repository,
            store::update_ui_state,
            store::update_publish_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
