use serde_json::Value;
use std::path::{Path, PathBuf};

fn render_preflight_markdown(report: &Value) -> Result<String, crate::errors::AppError> {
    let generated_at = report
        .get("generatedAt")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let summary = report.get("summary").and_then(Value::as_object);
    let passed = summary
        .and_then(|s| s.get("passed"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let warning = summary
        .and_then(|s| s.get("warning"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let failed = summary
        .and_then(|s| s.get("failed"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let blocking_ready = summary
        .and_then(|s| s.get("blockingReady"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let mut lines = vec![
        "# Preflight Report".to_string(),
        String::new(),
        format!("- Generated At: {}", generated_at),
        format!(
            "- Blocking Ready: {}",
            if blocking_ready { "yes" } else { "no" }
        ),
        format!("- Passed: {}", passed),
        format!("- Warnings: {}", warning),
        format!("- Failed: {}", failed),
        String::new(),
        "## Checklist".to_string(),
    ];
    let checklist = report
        .get("checklist")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if checklist.is_empty() {
        lines.push("- (no checklist items)".to_string());
    } else {
        for (idx, item) in checklist.iter().enumerate() {
            let title = item
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("untitled");
            let status = item
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let detail = item
                .get("detail")
                .and_then(Value::as_str)
                .unwrap_or("")
                .replace('\n', " ");
            lines.push(format!("- [{}] {} ({})", idx + 1, title, status));
            if !detail.trim().is_empty() {
                lines.push(format!("  - Detail: {}", detail.trim()));
            }
        }
    }
    let raw = serde_json::to_string_pretty(report)
        .map_err(|e| crate::errors::AppError::unknown(format!("serialization error: {}", e)))?;
    lines.extend([
        String::new(),
        "## Raw Snapshot".to_string(),
        String::new(),
        "```json".to_string(),
        raw,
        "```".to_string(),
    ]);
    Ok(lines.join("\n"))
}

#[tauri::command]
pub async fn export_preflight_report(
    report: Value,
    file_path: String,
) -> Result<String, crate::errors::AppError> {
    if !report.is_object() {
        return Err(crate::errors::AppError::unknown(
            "preflight report payload must be an object",
        ));
    }
    let ext = Path::new(&file_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_else(|| "json".to_string());
    let content = if ext == "md" || ext == "markdown" {
        render_preflight_markdown(&report)?
    } else {
        serde_json::to_string_pretty(&report)
            .map_err(|e| crate::errors::AppError::unknown(format!("serialization error: {}", e)))?
    };
    std::fs::write(&file_path, content)
        .map_err(|e| crate::errors::AppError::unknown(format!("write error: {}", e)))?;
    Ok(file_path)
}

fn render_execution_snapshot_markdown(snapshot: &Value) -> Result<String, crate::errors::AppError> {
    let generated_at = snapshot
        .get("generatedAt")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let provider_id = snapshot
        .get("providerId")
        .or_else(|| snapshot.get("provider_id"))
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let command_line = snapshot
        .get("command")
        .and_then(Value::as_object)
        .and_then(|command| command.get("line"))
        .and_then(Value::as_str)
        .unwrap_or("(not captured)");
    let result = snapshot.get("result").and_then(Value::as_object);
    let success = result
        .and_then(|value| value.get("success"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let cancelled = result
        .and_then(|value| value.get("cancelled"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let output_dir = result
        .and_then(|value| value.get("outputDir"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let file_count = result
        .and_then(|value| value.get("fileCount"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let environment = snapshot
        .get("environmentSummary")
        .and_then(Value::as_object);
    let checked_provider_count = environment
        .and_then(|value| value.get("providerIds"))
        .and_then(Value::as_array)
        .map(|items| items.len())
        .unwrap_or(0);
    let warning_count = environment
        .and_then(|value| value.get("warningCount"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let critical_count = environment
        .and_then(|value| value.get("criticalCount"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let spec_json = snapshot
        .get("spec")
        .map(serde_json::to_string_pretty)
        .transpose()
        .map_err(|e| crate::errors::AppError::unknown(format!("serialization error: {}", e)))?
        .unwrap_or_else(|| "{}".to_string());
    let result_json = snapshot
        .get("result")
        .map(serde_json::to_string_pretty)
        .transpose()
        .map_err(|e| crate::errors::AppError::unknown(format!("serialization error: {}", e)))?
        .unwrap_or_else(|| "{}".to_string());
    let mut lines = vec![
        "# Execution Snapshot".to_string(),
        String::new(),
        format!("- Generated At: {}", generated_at),
        format!("- Provider: {}", provider_id),
        format!(
            "- Status: {}",
            if success {
                "success"
            } else if cancelled {
                "cancelled"
            } else {
                "failed"
            }
        ),
        format!(
            "- Output Dir: {}",
            if output_dir.is_empty() {
                "(none)"
            } else {
                output_dir
            }
        ),
        format!("- File Count: {}", file_count),
        String::new(),
        "## Command".to_string(),
        String::new(),
        format!("- {}", command_line),
        String::new(),
        "## Environment Summary".to_string(),
        String::new(),
        format!("- Checked Providers: {}", checked_provider_count),
        format!("- Warnings: {}", warning_count),
        format!("- Critical: {}", critical_count),
        String::new(),
        "## Spec".to_string(),
        String::new(),
        "```json".to_string(),
        spec_json,
        "```".to_string(),
        String::new(),
        "## Result".to_string(),
        String::new(),
        "```json".to_string(),
        result_json,
        "```".to_string(),
    ];
    if let Some(log_text) = snapshot
        .get("output")
        .and_then(Value::as_object)
        .and_then(|value| value.get("log"))
        .and_then(Value::as_str)
    {
        lines.extend([
            String::new(),
            "## Log".to_string(),
            String::new(),
            "```text".to_string(),
            log_text.to_string(),
            "```".to_string(),
        ]);
    }
    Ok(lines.join("\n"))
}

#[tauri::command]
pub async fn export_execution_snapshot(
    snapshot: Value,
    file_path: String,
) -> Result<String, crate::errors::AppError> {
    if !snapshot.is_object() {
        return Err(crate::errors::AppError::unknown(
            "execution snapshot payload must be an object",
        ));
    }
    let ext = Path::new(&file_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_else(|| "json".to_string());
    let content = if ext == "md" || ext == "markdown" {
        render_execution_snapshot_markdown(&snapshot)?
    } else {
        serde_json::to_string_pretty(&snapshot)
            .map_err(|e| crate::errors::AppError::unknown(format!("serialization error: {}", e)))?
    };
    std::fs::write(&file_path, content)
        .map_err(|e| crate::errors::AppError::unknown(format!("write error: {}", e)))?;
    Ok(file_path)
}

fn render_failure_group_bundle_markdown(bundle: &Value) -> Result<String, crate::errors::AppError> {
    let generated_at = bundle
        .get("generatedAt")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let provider_id = bundle
        .get("providerId")
        .or_else(|| bundle.get("provider_id"))
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let signature = bundle
        .get("signature")
        .and_then(Value::as_str)
        .unwrap_or("(unknown)");
    let frequency = bundle.get("frequency").and_then(Value::as_u64).unwrap_or(0);
    let representative_record_id = bundle
        .get("representativeRecordId")
        .or_else(|| bundle.get("representative_record_id"))
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let records = bundle
        .get("records")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut lines = vec![
        "# Failure Group Diagnostics Bundle".to_string(),
        String::new(),
        format!("- Generated At: {}", generated_at),
        format!("- Provider: {}", provider_id),
        format!("- Signature: {}", signature),
        format!("- Frequency: {}", frequency),
        format!("- Representative Record: {}", representative_record_id),
        String::new(),
        "## Representative Runs".to_string(),
    ];

    if records.is_empty() {
        lines.push("- (no records)".to_string());
    } else {
        for (index, record) in records.iter().enumerate() {
            let record_id = record
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let finished_at = record
                .get("finishedAt")
                .or_else(|| record.get("finished_at"))
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let project_path = record
                .get("projectPath")
                .or_else(|| record.get("project_path"))
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let command_line = record
                .get("commandLine")
                .or_else(|| record.get("command_line"))
                .and_then(Value::as_str)
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .unwrap_or("(not captured)");
            let error = record
                .get("error")
                .and_then(Value::as_str)
                .map(|value| value.replace('\n', " "))
                .unwrap_or_default();
            let snapshot_path = record
                .get("snapshotPath")
                .or_else(|| record.get("snapshot_path"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let output_dir = record
                .get("outputDir")
                .or_else(|| record.get("output_dir"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty());

            lines.push(format!("- [{}] {} ({})", index + 1, finished_at, record_id));
            lines.push(format!("  - Project: {}", project_path));
            lines.push(format!("  - Command: {}", command_line));
            if !error.trim().is_empty() {
                lines.push(format!("  - Error: {}", error.trim()));
            }
            if let Some(path) = snapshot_path {
                lines.push(format!("  - Snapshot: {}", path));
            } else if let Some(dir) = output_dir {
                lines.push(format!("  - Snapshot: (not exported, output dir: {})", dir));
            } else {
                lines.push("  - Snapshot: (not exported)".to_string());
            }
        }
    }

    let raw = serde_json::to_string_pretty(bundle)
        .map_err(|e| crate::errors::AppError::unknown(format!("serialization error: {}", e)))?;
    lines.extend([
        String::new(),
        "## Raw Bundle".to_string(),
        String::new(),
        "```json".to_string(),
        raw,
        "```".to_string(),
    ]);

    Ok(lines.join("\n"))
}

#[tauri::command]
pub async fn export_failure_group_bundle(
    bundle: Value,
    file_path: String,
) -> Result<String, crate::errors::AppError> {
    if !bundle.is_object() {
        return Err(crate::errors::AppError::unknown(
            "failure group bundle payload must be an object",
        ));
    }

    let ext = Path::new(&file_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_else(|| "json".to_string());
    let content = if ext == "md" || ext == "markdown" {
        render_failure_group_bundle_markdown(&bundle)?
    } else {
        serde_json::to_string_pretty(&bundle)
            .map_err(|e| crate::errors::AppError::unknown(format!("serialization error: {}", e)))?
    };

    std::fs::write(&file_path, content)
        .map_err(|e| crate::errors::AppError::unknown(format!("write error: {}", e)))?;
    Ok(file_path)
}

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

fn render_execution_history_csv(history: &[Value]) -> Result<String, crate::errors::AppError> {
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
            return Err(crate::errors::AppError::unknown(
                "execution history item must be an object",
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

#[tauri::command]
pub async fn export_execution_history(
    history: Vec<Value>,
    file_path: String,
) -> Result<String, crate::errors::AppError> {
    let ext = Path::new(&file_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_else(|| "json".to_string());

    let content = if ext == "csv" {
        render_execution_history_csv(&history)?
    } else {
        serde_json::to_string_pretty(&history)
            .map_err(|e| crate::errors::AppError::unknown(format!("serialization error: {}", e)))?
    };

    std::fs::write(&file_path, content)
        .map_err(|e| crate::errors::AppError::unknown(format!("write error: {}", e)))?;
    Ok(file_path)
}

fn collect_link_paths(index: &Value, category: &str) -> Vec<String> {
    index
        .get("links")
        .and_then(Value::as_object)
        .and_then(|links| links.get(category))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .map(|value| value.to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn summary_u64(index: &Value, key: &str) -> u64 {
    index
        .get("summary")
        .and_then(Value::as_object)
        .and_then(|summary| summary.get(key))
        .and_then(Value::as_u64)
        .unwrap_or(0)
}

fn markdown_link(path: &str) -> String {
    let label = path
        .replace('\\', "\\\\")
        .replace('[', "\\[")
        .replace(']', "\\]");
    format!("[{}](<{}>)", label, path)
}

fn render_diagnostics_index_markdown(index: &Value) -> Result<String, crate::errors::AppError> {
    let generated_at = index
        .get("generatedAt")
        .and_then(Value::as_str)
        .unwrap_or("unknown");

    let snapshots = collect_link_paths(index, "snapshots");
    let bundles = collect_link_paths(index, "bundles");
    let history_exports = collect_link_paths(index, "historyExports");

    let mut lines = vec![
        "# Diagnostics Index".to_string(),
        String::new(),
        format!("- Generated At: {}", generated_at),
        format!("- History Records: {}", summary_u64(index, "historyCount")),
        format!(
            "- Filtered Records: {}",
            summary_u64(index, "filteredHistoryCount")
        ),
        format!(
            "- Failure Groups: {}",
            summary_u64(index, "failureGroupCount")
        ),
        format!("- Snapshot Links: {}", snapshots.len()),
        format!("- Bundle Links: {}", bundles.len()),
        format!("- History Exports: {}", history_exports.len()),
    ];

    let mut append_links = |title: &str, items: &[String]| {
        lines.push(String::new());
        lines.push(format!("## {}", title));
        if items.is_empty() {
            lines.push("- (none)".to_string());
        } else {
            for item in items {
                lines.push(format!("- {}", markdown_link(item)));
            }
        }
    };

    append_links("Snapshot Exports", &snapshots);
    append_links("Bundle Exports", &bundles);
    append_links("History Exports", &history_exports);

    let raw = serde_json::to_string_pretty(index)
        .map_err(|e| crate::errors::AppError::unknown(format!("serialization error: {}", e)))?;
    lines.extend([
        String::new(),
        "## Raw Index".to_string(),
        String::new(),
        "```json".to_string(),
        raw,
        "```".to_string(),
    ]);

    Ok(lines.join("\n"))
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn render_diagnostics_index_html(index: &Value) -> String {
    let generated_at = index
        .get("generatedAt")
        .and_then(Value::as_str)
        .unwrap_or("unknown");

    let snapshots = collect_link_paths(index, "snapshots");
    let bundles = collect_link_paths(index, "bundles");
    let history_exports = collect_link_paths(index, "historyExports");

    let render_list = |title: &str, items: &[String]| {
        let mut out = format!("<h2>{}</h2><ul>", html_escape(title));
        if items.is_empty() {
            out.push_str("<li>(none)</li>");
        } else {
            for item in items {
                let escaped = html_escape(item);
                out.push_str(&format!("<li><a href=\"{}\">{}</a></li>", escaped, escaped));
            }
        }
        out.push_str("</ul>");
        out
    };

    [
        "<!doctype html>".to_string(),
        "<html><head><meta charset=\"utf-8\"><title>Diagnostics Index</title></head><body>"
            .to_string(),
        "<h1>Diagnostics Index</h1>".to_string(),
        format!(
            "<p><strong>Generated At:</strong> {}</p>",
            html_escape(generated_at)
        ),
        "<ul>".to_string(),
        format!(
            "<li>History Records: {}</li>",
            summary_u64(index, "historyCount")
        ),
        format!(
            "<li>Filtered Records: {}</li>",
            summary_u64(index, "filteredHistoryCount")
        ),
        format!(
            "<li>Failure Groups: {}</li>",
            summary_u64(index, "failureGroupCount")
        ),
        "</ul>".to_string(),
        render_list("Snapshot Exports", &snapshots),
        render_list("Bundle Exports", &bundles),
        render_list("History Exports", &history_exports),
        "</body></html>".to_string(),
    ]
    .join("\n")
}

#[tauri::command]
pub async fn export_diagnostics_index(
    index: Value,
    file_path: String,
) -> Result<String, crate::errors::AppError> {
    if !index.is_object() {
        return Err(crate::errors::AppError::unknown(
            "diagnostics index payload must be an object",
        ));
    }

    let ext = Path::new(&file_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_else(|| "json".to_string());

    let content = if ext == "md" || ext == "markdown" {
        render_diagnostics_index_markdown(&index)?
    } else if ext == "html" || ext == "htm" {
        render_diagnostics_index_html(&index)
    } else {
        serde_json::to_string_pretty(&index)
            .map_err(|e| crate::errors::AppError::unknown(format!("serialization error: {}", e)))?
    };

    std::fs::write(&file_path, content)
        .map_err(|e| crate::errors::AppError::unknown(format!("write error: {}", e)))?;
    Ok(file_path)
}

fn find_latest_snapshot_in_output_dir(
    output_dir: &str,
) -> Result<PathBuf, crate::errors::AppError> {
    if output_dir.trim().is_empty() {
        return Err(crate::errors::AppError::unknown(
            "记录中没有可用的输出目录，请先导出快照",
        ));
    }

    let dir = PathBuf::from(output_dir);
    if !dir.is_dir() {
        return Err(crate::errors::AppError::unknown(format!(
            "输出目录不存在: {}",
            dir.to_string_lossy()
        )));
    }

    let mut latest: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in std::fs::read_dir(&dir)
        .map_err(|e| crate::errors::AppError::unknown(format!("读取输出目录失败: {}", e)))?
    {
        let entry = entry
            .map_err(|e| crate::errors::AppError::unknown(format!("读取目录项失败: {}", e)))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !name.starts_with("execution-snapshot-") {
            continue;
        }

        let Some(ext) = path.extension().and_then(|value| value.to_str()) else {
            continue;
        };
        let ext = ext.to_ascii_lowercase();
        if ext != "md" && ext != "markdown" && ext != "json" {
            continue;
        }

        let modified = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);

        match &latest {
            Some((current, _)) if modified <= *current => {}
            _ => latest = Some((modified, path)),
        }
    }

    latest.map(|(_, path)| path).ok_or_else(|| {
        crate::errors::AppError::unknown(format!(
            "未在输出目录找到执行快照，请先导出快照: {}",
            dir.to_string_lossy()
        ))
    })
}

#[tauri::command]
pub async fn open_execution_snapshot(
    snapshot_path: Option<String>,
    output_dir: Option<String>,
) -> Result<String, crate::errors::AppError> {
    let path = if let Some(snapshot_path) = snapshot_path {
        let trimmed = snapshot_path.trim();
        if trimmed.is_empty() {
            if let Some(output_dir) = output_dir {
                find_latest_snapshot_in_output_dir(&output_dir)?
            } else {
                return Err(crate::errors::AppError::unknown(
                    "记录中没有快照路径，请先导出快照",
                ));
            }
        } else {
            let candidate = PathBuf::from(trimmed);
            if candidate.is_file() {
                candidate
            } else if let Some(output_dir) = output_dir {
                find_latest_snapshot_in_output_dir(&output_dir)?
            } else {
                return Err(crate::errors::AppError::unknown(format!(
                    "快照文件不存在: {}",
                    trimmed
                )));
            }
        }
    } else if let Some(output_dir) = output_dir {
        find_latest_snapshot_in_output_dir(&output_dir)?
    } else {
        return Err(crate::errors::AppError::unknown(
            "记录中没有可用的快照路径和输出目录",
        ));
    };

    open::that(&path)
        .map_err(|e| crate::errors::AppError::unknown(format!("打开快照失败: {}", e)))?;

    Ok(path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn preflight_markdown_contains_summary_and_checklist() {
        let report = json!({
            "generatedAt": "2026-02-07T10:00:00Z",
            "summary": {
                "passed": 3,
                "warning": 1,
                "failed": 0,
                "blockingReady": true
            },
            "checklist": [
                {
                    "title": "Environment",
                    "status": "pass",
                    "detail": "ready"
                },
                {
                    "title": "Updater",
                    "status": "warning",
                    "detail": "missing endpoints"
                }
            ]
        });
        let markdown = render_preflight_markdown(&report).expect("markdown");
        assert!(markdown.contains("# Preflight Report"));
        assert!(markdown.contains("- Blocking Ready: yes"));
        assert!(markdown.contains("- [1] Environment (pass)"));
        assert!(markdown.contains("- [2] Updater (warning)"));
        assert!(markdown.contains("## Raw Snapshot"));
    }

    #[test]
    fn execution_snapshot_markdown_contains_core_sections() {
        let snapshot = json!({
            "generatedAt": "2026-02-08T10:00:00Z",
            "providerId": "go",
            "command": {
                "line": "$ go build -o ./dist/app"
            },
            "environmentSummary": {
                "providerIds": ["go"],
                "warningCount": 1,
                "criticalCount": 0
            },
            "spec": {
                "provider_id": "go",
                "project_path": "/tmp/go.mod",
                "parameters": {
                    "output": "./dist/app"
                }
            },
            "result": {
                "success": true,
                "cancelled": false,
                "outputDir": "./dist",
                "fileCount": 1
            },
            "output": {
                "log": "$ go build -o ./dist/app\nbuild done"
            }
        });
        let markdown = render_execution_snapshot_markdown(&snapshot).expect("markdown");
        assert!(markdown.contains("# Execution Snapshot"));
        assert!(markdown.contains("- Provider: go"));
        assert!(markdown.contains("## Command"));
        assert!(markdown.contains("## Environment Summary"));
        assert!(markdown.contains("## Spec"));
        assert!(markdown.contains("## Result"));
        assert!(markdown.contains("## Log"));
    }

    #[test]
    fn failure_group_bundle_markdown_contains_signature_and_snapshots() {
        let bundle = json!({
            "generatedAt": "2026-02-08T10:00:00Z",
            "providerId": "dotnet",
            "signature": "dotnet sdk missing",
            "frequency": 3,
            "representativeRecordId": "rec-2",
            "records": [
                {
                    "id": "rec-2",
                    "projectPath": "/tmp/app.csproj",
                    "finishedAt": "2026-02-08T10:05:00Z",
                    "commandLine": "$ dotnet publish /tmp/app.csproj",
                    "error": "SDK not found",
                    "snapshotPath": "/tmp/out/execution-snapshot-2026-02-08.md",
                    "outputDir": "/tmp/out"
                },
                {
                    "id": "rec-1",
                    "projectPath": "/tmp/app.csproj",
                    "finishedAt": "2026-02-08T09:55:00Z",
                    "commandLine": "$ dotnet publish /tmp/app.csproj",
                    "error": "SDK not found",
                    "snapshotPath": null,
                    "outputDir": "/tmp/out"
                }
            ]
        });
        let markdown = render_failure_group_bundle_markdown(&bundle).expect("markdown");
        assert!(markdown.contains("# Failure Group Diagnostics Bundle"));
        assert!(markdown.contains("- Signature: dotnet sdk missing"));
        assert!(markdown.contains("- Frequency: 3"));
        assert!(markdown.contains("- Snapshot: /tmp/out/execution-snapshot-2026-02-08.md"));
        assert!(markdown.contains("Snapshot: (not exported, output dir: /tmp/out)"));
        assert!(markdown.contains("## Raw Bundle"));
    }

    #[test]
    fn execution_history_csv_contains_status_and_signature() {
        let history = vec![
            json!({
                "id": "rec-1",
                "providerId": "dotnet",
                "projectPath": "/tmp/app.csproj",
                "finishedAt": "2026-02-08T10:00:00Z",
                "success": false,
                "cancelled": false,
                "failureSignature": "sdk missing",
                "commandLine": "$ dotnet publish /tmp/app.csproj",
                "error": "SDK not found",
                "snapshotPath": "/tmp/out/execution-snapshot-1.md",
                "fileCount": 0
            }),
            json!({
                "id": "rec-2",
                "providerId": "go",
                "projectPath": "/tmp/go",
                "finishedAt": "2026-02-08T11:00:00Z",
                "success": true,
                "cancelled": false,
                "fileCount": 1
            }),
        ];

        let csv = render_execution_history_csv(&history).expect("csv");
        assert!(csv.contains("id,providerId,status,finishedAt,projectPath"));
        assert!(csv.contains("rec-1,dotnet,failed,2026-02-08T10:00:00Z"));
        assert!(csv.contains("rec-2,go,success,2026-02-08T11:00:00Z"));
        assert!(csv.contains("sdk missing"));
    }

    #[test]
    fn diagnostics_index_markdown_contains_clickable_links_and_summary() {
        let index = json!({
            "generatedAt": "2026-02-08T12:00:00Z",
            "summary": {
                "historyCount": 4,
                "filteredHistoryCount": 2,
                "failureGroupCount": 1
            },
            "links": {
                "snapshots": ["/tmp/out/execution-snapshot 1.md"],
                "bundles": ["/tmp/out/failure-group-bundle.md"],
                "historyExports": []
            }
        });

        let markdown = render_diagnostics_index_markdown(&index).expect("markdown");
        assert!(markdown.contains("# Diagnostics Index"));
        assert!(markdown.contains("- History Records: 4"));
        assert!(markdown.contains("- Snapshot Links: 1"));
        assert!(markdown
            .contains("[/tmp/out/execution-snapshot 1.md](</tmp/out/execution-snapshot 1.md>)"));
        assert!(markdown.contains("## Raw Index"));
    }

    #[test]
    fn diagnostics_index_html_escapes_links() {
        let index = json!({
            "generatedAt": "2026-02-08T12:00:00Z",
            "summary": {
                "historyCount": 2,
                "filteredHistoryCount": 1,
                "failureGroupCount": 1
            },
            "links": {
                "snapshots": ["/tmp/out/a&b.md"],
                "bundles": ["/tmp/out/<bundle>.md"],
                "historyExports": []
            }
        });

        let html = render_diagnostics_index_html(&index);
        assert!(html.contains("<h1>Diagnostics Index</h1>"));
        assert!(html.contains("href=\"/tmp/out/a&amp;b.md\""));
        assert!(html.contains("href=\"/tmp/out/&lt;bundle&gt;.md\""));
        assert!(html.contains("<li>(none)</li>"));
    }
}
