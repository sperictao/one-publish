use serde_json::Value;
use std::path::{Path, PathBuf};

mod writers;
pub use writers::*;

fn export_error(message: impl Into<String>, code: impl Into<String>) -> crate::errors::AppError {
    crate::errors::AppError::export_with_code(message, code)
}

fn export_source_error(
    prefix: &str,
    source: impl std::fmt::Display,
    code: &'static str,
) -> crate::errors::AppError {
    export_error(format!("{prefix}: {source}"), code)
}

fn export_open_error(
    prefix: &str,
    source: impl std::fmt::Display,
    code: &'static str,
) -> crate::errors::AppError {
    crate::errors::AppError::external_open_with_code(format!("{prefix}: {source}"), code)
}

#[tauri::command]
pub async fn export_preflight_report(
    report: Value,
    file_path: String,
) -> Result<String, crate::errors::AppError> {
    let _timer =
        crate::commands::middleware::CommandTimer::new("commands::export::export_preflight_report");
    let mut report = report;
    if !report.is_object() {
        return Err(export_error(
            "preflight report payload must be an object",
            "preflight_report_payload_invalid",
        ));
    }
    crate::security::sanitize_export_value(&mut report);
    let ext = Path::new(&file_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_else(|| "json".to_string());
    let content = if ext == "md" || ext == "markdown" {
        render_preflight_markdown(&report)?
    } else {
        serde_json::to_string_pretty(&report).map_err(|source| {
            export_source_error(
                "serialization error",
                source,
                "preflight_report_serialize_failed",
            )
        })?
    };
    crate::security::write_private_text_file(Path::new(&file_path), &content).map_err(
        |source| export_source_error("write error", source, "preflight_report_write_failed"),
    )?;
    Ok(file_path)
}

#[tauri::command]
pub async fn export_execution_snapshot(
    snapshot: Value,
    file_path: String,
) -> Result<String, crate::errors::AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new(
        "commands::export::export_execution_snapshot",
    );
    let mut snapshot = snapshot;
    if !snapshot.is_object() {
        return Err(export_error(
            "execution snapshot payload must be an object",
            "execution_snapshot_payload_invalid",
        ));
    }
    crate::security::sanitize_export_value(&mut snapshot);
    let ext = Path::new(&file_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_else(|| "json".to_string());
    let content = if ext == "md" || ext == "markdown" {
        render_execution_snapshot_markdown(&snapshot)?
    } else {
        serde_json::to_string_pretty(&snapshot).map_err(|source| {
            export_source_error(
                "serialization error",
                source,
                "execution_snapshot_serialize_failed",
            )
        })?
    };
    crate::security::write_private_text_file(Path::new(&file_path), &content).map_err(
        |source| export_source_error("write error", source, "execution_snapshot_write_failed"),
    )?;
    Ok(file_path)
}

#[tauri::command]
pub async fn export_failure_group_bundle(
    bundle: Value,
    file_path: String,
) -> Result<String, crate::errors::AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new(
        "commands::export::export_failure_group_bundle",
    );
    let mut bundle = bundle;
    if !bundle.is_object() {
        return Err(export_error(
            "failure group bundle payload must be an object",
            "failure_group_bundle_payload_invalid",
        ));
    }
    crate::security::sanitize_export_value(&mut bundle);

    let ext = Path::new(&file_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_else(|| "json".to_string());
    let content = if ext == "md" || ext == "markdown" {
        render_failure_group_bundle_markdown(&bundle)?
    } else {
        serde_json::to_string_pretty(&bundle).map_err(|source| {
            export_source_error(
                "serialization error",
                source,
                "failure_group_bundle_serialize_failed",
            )
        })?
    };

    crate::security::write_private_text_file(Path::new(&file_path), &content).map_err(
        |source| export_source_error("write error", source, "failure_group_bundle_write_failed"),
    )?;
    Ok(file_path)
}

#[tauri::command]
pub async fn export_execution_history(
    history: Vec<Value>,
    file_path: String,
) -> Result<String, crate::errors::AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new(
        "commands::export::export_execution_history",
    );
    let mut history = history;
    for item in &mut history {
        crate::security::sanitize_export_value(item);
    }
    let ext = Path::new(&file_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_else(|| "json".to_string());

    let content = if ext == "csv" {
        render_execution_history_csv(&history)?
    } else {
        serde_json::to_string_pretty(&history).map_err(|source| {
            export_source_error(
                "serialization error",
                source,
                "execution_history_serialize_failed",
            )
        })?
    };

    crate::security::write_private_text_file(Path::new(&file_path), &content).map_err(
        |source| export_source_error("write error", source, "execution_history_write_failed"),
    )?;
    Ok(file_path)
}

#[tauri::command]
pub async fn export_diagnostics_index(
    index: Value,
    file_path: String,
) -> Result<String, crate::errors::AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new(
        "commands::export::export_diagnostics_index",
    );
    let mut index = index;
    if !index.is_object() {
        return Err(export_error(
            "diagnostics index payload must be an object",
            "diagnostics_index_payload_invalid",
        ));
    }
    crate::security::sanitize_export_value(&mut index);

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
        serde_json::to_string_pretty(&index).map_err(|source| {
            export_source_error(
                "serialization error",
                source,
                "diagnostics_index_serialize_failed",
            )
        })?
    };

    crate::security::write_private_text_file(Path::new(&file_path), &content).map_err(
        |source| export_source_error("write error", source, "diagnostics_index_write_failed"),
    )?;
    Ok(file_path)
}

fn find_latest_snapshot_in_output_dir(
    output_dir: &str,
) -> Result<PathBuf, crate::errors::AppError> {
    if output_dir.trim().is_empty() {
        return Err(export_error(
            "记录中没有可用的输出目录，请先导出快照",
            "snapshot_output_dir_missing",
        ));
    }

    let dir = PathBuf::from(output_dir);
    if !dir.is_dir() {
        return Err(export_error(
            format!("输出目录不存在: {}", dir.to_string_lossy()),
            "snapshot_output_dir_not_found",
        ));
    }

    let mut latest: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in std::fs::read_dir(&dir).map_err(|source| {
        export_source_error(
            "读取输出目录失败",
            source,
            "snapshot_output_dir_read_failed",
        )
    })? {
        let entry = entry.map_err(|source| {
            export_source_error(
                "读取目录项失败",
                source,
                "snapshot_output_dir_entry_read_failed",
            )
        })?;
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
        export_error(
            format!(
                "未在输出目录找到执行快照，请先导出快照: {}",
                dir.to_string_lossy()
            ),
            "snapshot_not_found_in_output_dir",
        )
    })
}

#[tauri::command]
pub async fn open_execution_snapshot(
    snapshot_path: Option<String>,
    output_dir: Option<String>,
) -> Result<String, crate::errors::AppError> {
    let _timer =
        crate::commands::middleware::CommandTimer::new("commands::export::open_execution_snapshot");
    let path = if let Some(snapshot_path) = snapshot_path {
        let trimmed = snapshot_path.trim();
        if trimmed.is_empty() {
            if let Some(output_dir) = output_dir {
                find_latest_snapshot_in_output_dir(&output_dir)?
            } else {
                return Err(export_error(
                    "记录中没有快照路径，请先导出快照",
                    "snapshot_path_missing",
                ));
            }
        } else {
            let candidate = PathBuf::from(trimmed);
            if candidate.is_file() {
                candidate
            } else if let Some(output_dir) = output_dir {
                find_latest_snapshot_in_output_dir(&output_dir)?
            } else {
                return Err(export_error(
                    format!("快照文件不存在: {}", trimmed),
                    "snapshot_file_not_found",
                ));
            }
        }
    } else if let Some(output_dir) = output_dir {
        find_latest_snapshot_in_output_dir(&output_dir)?
    } else {
        return Err(export_error(
            "记录中没有可用的快照路径和输出目录",
            "snapshot_and_output_dir_missing",
        ));
    };

    open::that(&path)
        .map_err(|source| export_open_error("打开快照失败", source, "open_snapshot_failed"))?;

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn open_directory(path: String) -> Result<String, crate::errors::AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new("commands::export::open_directory");
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(export_error("目录路径为空", "directory_path_empty"));
    }

    let directory = PathBuf::from(trimmed);
    if !directory.exists() {
        return Err(export_error(
            format!("目录不存在: {}", trimmed),
            "directory_not_found",
        ));
    }

    if !directory.is_dir() {
        return Err(export_error(
            format!("路径不是文件夹: {}", trimmed),
            "directory_not_directory",
        ));
    }

    open::that(&directory)
        .map_err(|source| export_open_error("打开目录失败", source, "open_directory_failed"))?;

    Ok(directory.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn open_output_directory(output_dir: String) -> Result<String, crate::errors::AppError> {
    let _timer =
        crate::commands::middleware::CommandTimer::new("commands::export::open_output_directory");
    let trimmed = output_dir.trim();
    if trimmed.is_empty() {
        return Err(export_error("输出目录为空", "output_dir_empty"));
    }

    let path = PathBuf::from(trimmed);
    if !path.exists() {
        return Err(export_error(
            format!("输出目录不存在: {}", trimmed),
            "output_dir_not_found",
        ));
    }

    if !path.is_dir() {
        return Err(export_error(
            format!("输出目录不是文件夹: {}", trimmed),
            "output_dir_not_directory",
        ));
    }

    open::that(&path).map_err(|source| {
        export_open_error("打开输出目录失败", source, "open_output_directory_failed")
    })?;

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
