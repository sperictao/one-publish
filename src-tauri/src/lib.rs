// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

pub mod commands;
pub mod store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
