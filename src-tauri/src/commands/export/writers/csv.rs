use serde_json::Value;

use super::super::export_error;

fn csv_escape(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn record_string(record: &serde_json::Map<String, Value>, camel: &str, snake: &str) -> String {
    record
        .get(camel)
        .or_else(|| record.get(snake))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

pub fn render_execution_history_csv(history: &[Value]) -> Result<String, crate::errors::AppError> {
    let header = [
        "id",
        "providerId",
        "status",
        "finishedAt",
        "projectPath",
        "failureSignature",
        "commandLine",
        "error",
        "snapshotPath",
        "fileCount",
    ]
    .join(",");

    let mut lines = vec![header];

    for item in history {
        let Some(record) = item.as_object() else {
            return Err(export_error(
                "execution history item must be an object",
                "execution_history_item_invalid",
            ));
        };

        let success = record
            .get("success")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let cancelled = record
            .get("cancelled")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let status = if success {
            "success"
        } else if cancelled {
            "cancelled"
        } else {
            "failed"
        };

        let file_count = record
            .get("fileCount")
            .or_else(|| record.get("file_count"))
            .and_then(Value::as_u64)
            .map(|value| value.to_string())
            .unwrap_or_else(|| "0".to_string());

        let row = vec![
            record_string(record, "id", "id"),
            record_string(record, "providerId", "provider_id"),
            status.to_string(),
            record_string(record, "finishedAt", "finished_at"),
            record_string(record, "projectPath", "project_path"),
            record_string(record, "failureSignature", "failure_signature"),
            record_string(record, "commandLine", "command_line"),
            record_string(record, "error", "error"),
            record_string(record, "snapshotPath", "snapshot_path"),
            file_count,
        ];

        let escaped = row
            .into_iter()
            .map(|value| csv_escape(&value))
            .collect::<Vec<_>>()
            .join(",");
        lines.push(escaped);
    }

    Ok(lines.join("\n"))
}
