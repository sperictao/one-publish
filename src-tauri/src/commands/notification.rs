use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

use crate::errors::AppError;

/// 通知载荷归一化：空标题不发送（返回 None），空正文按无正文处理。
fn normalize_notification_payload(
    title: &str,
    body: Option<String>,
) -> Option<(String, Option<String>)> {
    let title = title.trim();
    if title.is_empty() {
        return None;
    }
    let body = body
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    Some((title.to_string(), body))
}

#[tauri::command]
pub async fn show_system_notification(
    app: AppHandle,
    title: String,
    body: Option<String>,
) -> Result<bool, AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new(
        "commands::notification::show_system_notification",
    );
    let Some((title, body)) = normalize_notification_payload(&title, body) else {
        return Ok(false);
    };

    let mut notification = app.notification().builder().title(title);
    if let Some(body) = body {
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

#[cfg(test)]
mod tests {
    use super::normalize_notification_payload;

    #[test]
    fn normalize_notification_payload_skips_empty_titles() {
        assert_eq!(normalize_notification_payload("", None), None);
        assert_eq!(
            normalize_notification_payload("   ", Some("body".into())),
            None
        );
    }

    #[test]
    fn normalize_notification_payload_trims_and_drops_empty_body() {
        assert_eq!(
            normalize_notification_payload("  done  ", Some("  ".into())),
            Some(("done".to_string(), None))
        );
        assert_eq!(
            normalize_notification_payload("done", Some("  files.zip  ".into())),
            Some(("done".to_string(), Some("files.zip".to_string())))
        );
        assert_eq!(
            normalize_notification_payload("done", None),
            Some(("done".to_string(), None))
        );
    }
}
