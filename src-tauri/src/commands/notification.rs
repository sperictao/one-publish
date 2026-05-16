use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

use crate::errors::AppError;

#[tauri::command]
pub async fn show_system_notification(
    app: AppHandle,
    title: String,
    body: Option<String>,
) -> Result<bool, AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new("commands::notification::show_system_notification");
    let title = title.trim();
    if title.is_empty() {
        return Ok(false);
    }

    let mut notification = app.notification().builder().title(title.to_string());
    if let Some(body) = body
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        notification = notification.body(body);
    }

    notification.show().map_err(|source| {
        AppError::external_open_with_code(
            format!("发送系统通知失败: {}", source),
            "show_system_notification_failed",
        )
    })?;

    Ok(true)
}