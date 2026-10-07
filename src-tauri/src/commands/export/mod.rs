use serde_json::Value;
use std::path::{Path, PathBuf};

mod writers;
pub use writers::*;

fn export_error(message: impl Into<String>, code: impl Into<String>) -> crate::errors::AppError {
    crate::errors::AppError::export_with_code(message, code)
}

/// message 保持静态、底层错误进 details：前端按 code 取 `errors.<code>` 后仍可附加原因。
fn export_source_error(
    message: &'static str,
    source: impl std::fmt::Display,
    code: &'static str,
) -> crate::errors::AppError {
    export_error(message, code).with_details(source.to_string())
}

fn export_open_error(
    message: &'static str,
    source: impl std::fmt::Display,
    code: &'static str,
) -> crate::errors::AppError {
    crate::errors::AppError::external_open_with_code(message, code).with_details(source.to_string())
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

/// 执行快照的私有存储区 `~/.one-publish/execution-snapshots/`。快照含完整构建日志，
/// 绝不能写进 Provider 输出目录，否则会被下一次发布当作产物收集并交付。
fn execution_snapshot_root() -> Result<PathBuf, crate::errors::AppError> {
    dirs::home_dir()
        .map(|home| home.join(".one-publish").join("execution-snapshots"))
        .ok_or_else(|| {
            export_error(
                "无法定位当前用户主目录以保存执行快照",
                "snapshot_home_dir_missing",
            )
        })
}

/// 同一输出目录的快照归入同一子目录，供历史记录按输出目录回退查找最新快照。
fn execution_snapshot_bucket(
    root: &Path,
    output_dir: &str,
) -> Result<PathBuf, crate::errors::AppError> {
    let output_dir = output_dir.trim();
    if output_dir.is_empty() {
        return Err(export_error(
            "记录中没有可用的输出目录",
            "snapshot_output_dir_missing",
        ));
    }
    Ok(root.join(&publish_domain::sha256_hex(output_dir.as_bytes())[..24]))
}

pub(crate) fn write_execution_snapshot(
    root: &Path,
    output_dir: &str,
    mut snapshot: Value,
) -> Result<PathBuf, crate::errors::AppError> {
    if !snapshot.is_object() {
        return Err(export_error(
            "execution snapshot payload must be an object",
            "execution_snapshot_payload_invalid",
        ));
    }
    crate::security::sanitize_export_value(&mut snapshot);
    let content = render_execution_snapshot_markdown(&snapshot)?;
    let file_path = execution_snapshot_bucket(root, output_dir)?.join(format!(
        "{}{}.md",
        publish_adapters::EXECUTION_SNAPSHOT_FILE_PREFIX,
        chrono::Utc::now().format("%Y-%m-%dT%H-%M-%S%.3fZ")
    ));
    crate::security::write_private_text_file(&file_path, &content).map_err(|source| {
        export_source_error("write error", source, "execution_snapshot_write_failed")
    })?;
    Ok(file_path)
}

#[tauri::command]
pub async fn export_execution_snapshot(
    snapshot: Value,
    output_dir: String,
) -> Result<String, crate::errors::AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new(
        "commands::export::export_execution_snapshot",
    );
    let path = write_execution_snapshot(&execution_snapshot_root()?, &output_dir, snapshot)?;
    Ok(path.to_string_lossy().to_string())
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

fn find_latest_snapshot_for_output_dir(
    root: &Path,
    output_dir: &str,
) -> Result<PathBuf, crate::errors::AppError> {
    let dir = execution_snapshot_bucket(root, output_dir)?;
    let not_found = || {
        export_error(
            "未找到输出目录的执行快照",
            "snapshot_not_found_for_output_dir",
        )
        .with_details(output_dir.trim())
    };
    if !dir.is_dir() {
        return Err(not_found());
    }

    let mut latest: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in std::fs::read_dir(&dir).map_err(|source| {
        export_source_error("读取快照目录失败", source, "snapshot_dir_read_failed")
    })? {
        let entry = entry.map_err(|source| {
            export_source_error("读取目录项失败", source, "snapshot_dir_entry_read_failed")
        })?;
        let path = entry.path();
        let is_snapshot = path
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|name| {
                name.starts_with(publish_adapters::EXECUTION_SNAPSHOT_FILE_PREFIX)
                    && name.ends_with(".md")
            });
        if !is_snapshot || !path.is_file() {
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

    latest.map(|(_, path)| path).ok_or_else(not_found)
}

fn resolve_execution_snapshot(
    root: &Path,
    snapshot_path: Option<String>,
    output_dir: Option<String>,
) -> Result<PathBuf, crate::errors::AppError> {
    let recorded = snapshot_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty());
    if let Some(candidate) = recorded.map(PathBuf::from).filter(|path| path.is_file()) {
        return Ok(candidate);
    }
    if let Some(output_dir) = output_dir {
        return find_latest_snapshot_for_output_dir(root, &output_dir);
    }

    Err(match recorded {
        Some(path) => export_error("快照文件不存在", "snapshot_file_not_found").with_details(path),
        None if snapshot_path.is_some() => {
            export_error("记录中没有快照路径", "snapshot_path_missing")
        }
        None => export_error(
            "记录中没有可用的快照路径和输出目录",
            "snapshot_and_output_dir_missing",
        ),
    })
}

#[tauri::command]
pub async fn open_execution_snapshot(
    snapshot_path: Option<String>,
    output_dir: Option<String>,
) -> Result<String, crate::errors::AppError> {
    let _timer =
        crate::commands::middleware::CommandTimer::new("commands::export::open_execution_snapshot");
    let path = resolve_execution_snapshot(&execution_snapshot_root()?, snapshot_path, output_dir)?;

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
        return Err(export_error("目录不存在", "directory_not_found").with_details(trimmed));
    }

    if !directory.is_dir() {
        return Err(export_error("路径不是文件夹", "directory_not_directory").with_details(trimmed));
    }

    open::that(&directory)
        .map_err(|source| export_open_error("打开目录失败", source, "open_directory_failed"))?;

    Ok(directory.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn open_output_directory(output_dir: String) -> Result<String, crate::errors::AppError> {
    let _timer =
        crate::commands::middleware::CommandTimer::new("commands::export::open_output_directory");
    let path = output_directory_to_open(&output_dir)?;

    open::that(&path).map_err(|source| {
        export_open_error("打开输出目录失败", source, "open_output_directory_failed")
    })?;

    Ok(path.to_string_lossy().to_string())
}

/// 输出可以是目录，也可以是单个文件（例如 `go build -o` 写出的二进制）；
/// 文件输出打开其所在文件夹。
fn output_directory_to_open(output_dir: &str) -> Result<PathBuf, crate::errors::AppError> {
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

    if path.is_dir() {
        return Ok(path);
    }
    match path.parent() {
        Some(parent) if path.is_file() && !parent.as_os_str().is_empty() => {
            Ok(parent.to_path_buf())
        }
        _ => Err(export_error(
            format!("输出目录不是文件夹: {}", trimmed),
            "output_dir_not_directory",
        )),
    }
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
    fn execution_snapshot_is_stored_outside_the_provider_output() {
        let store = tempfile::tempdir().expect("snapshot store");
        let workspace = tempfile::tempdir().expect("workspace");
        let output_dir = workspace.path().join("build").join("libs");
        std::fs::create_dir_all(&output_dir).expect("create provider output");
        let output_dir = output_dir.to_string_lossy().to_string();

        let path = write_execution_snapshot(
            store.path(),
            &output_dir,
            json!({
                "generatedAt": "2026-07-17T10:01:02.345Z",
                "providerId": "gradle",
                "output": { "log": "BUILD SUCCESSFUL" }
            }),
        )
        .expect("write snapshot");

        assert!(path.starts_with(store.path()));
        assert!(path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(publish_adapters::is_one_publish_owned_file));
        assert_eq!(
            std::fs::read_dir(&output_dir)
                .expect("list provider output")
                .count(),
            0,
            "the provider output must stay untouched"
        );
        assert_eq!(
            find_latest_snapshot_for_output_dir(store.path(), &output_dir)
                .expect("lookup by output dir"),
            path
        );
        let other_output = workspace.path().join("other").to_string_lossy().to_string();
        assert!(find_latest_snapshot_for_output_dir(store.path(), &other_output).is_err());
        assert!(write_execution_snapshot(store.path(), "  ", json!({})).is_err());
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

    fn snapshot_payload() -> Value {
        json!({ "providerId": "dotnet", "output": { "log": "Build succeeded." } })
    }

    fn set_modified(path: &Path, secs: u64) {
        std::fs::File::options()
            .write(true)
            .open(path)
            .expect("open snapshot")
            .set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(secs))
            .expect("set snapshot mtime");
    }

    #[test]
    fn latest_snapshot_lookup_picks_the_newest_snapshot_in_its_bucket() {
        let store = tempfile::tempdir().expect("snapshot store");
        let output_dir = "/exports/App/Release";
        let newest = write_execution_snapshot(store.path(), output_dir, snapshot_payload())
            .expect("write snapshot");
        let bucket = newest.parent().expect("snapshot bucket");
        let older = bucket.join("execution-snapshot-older.md");
        let unrelated = bucket.join("notes.md");
        std::fs::write(&older, "# older").expect("older snapshot");
        std::fs::write(&unrelated, "# notes").expect("unrelated file");
        set_modified(&older, 100);
        set_modified(&newest, 200);
        set_modified(&unrelated, 300);

        assert_eq!(
            find_latest_snapshot_for_output_dir(store.path(), &format!("  {output_dir} "))
                .expect("latest snapshot"),
            newest
        );
    }

    #[test]
    fn latest_snapshot_lookup_ignores_legacy_snapshots_in_the_output_dir() {
        let temp = tempfile::tempdir().expect("temp dir");
        let root = temp.path().join("execution-snapshots");
        let output = temp.path().join("out");
        std::fs::create_dir_all(&output).expect("provider output");
        std::fs::write(output.join("execution-snapshot-legacy.md"), "# legacy")
            .expect("legacy snapshot");

        let error =
            find_latest_snapshot_for_output_dir(&root, &output.to_string_lossy()).unwrap_err();
        assert_eq!(
            error.code.as_deref(),
            Some("snapshot_not_found_for_output_dir")
        );
    }

    #[test]
    fn resolve_snapshot_prefers_the_recorded_path_and_falls_back_to_the_output_dir_bucket() {
        let temp = tempfile::tempdir().expect("temp dir");
        let root = temp.path().join("execution-snapshots");
        let output_dir = temp.path().join("out").to_string_lossy().to_string();
        let recorded = temp.path().join("recorded.md");
        std::fs::write(&recorded, "# recorded").expect("recorded snapshot");
        let latest = write_execution_snapshot(&root, &output_dir, snapshot_payload())
            .expect("bucket snapshot");

        assert_eq!(
            resolve_execution_snapshot(
                &root,
                Some(recorded.to_string_lossy().to_string()),
                Some(output_dir.clone()),
            )
            .expect("recorded path"),
            recorded
        );
        assert_eq!(
            resolve_execution_snapshot(
                &root,
                Some(temp.path().join("gone.md").to_string_lossy().to_string()),
                Some(output_dir.clone()),
            )
            .expect("fallback for a missing recorded path"),
            latest
        );
        assert_eq!(
            resolve_execution_snapshot(&root, None, Some(output_dir)).expect("fallback"),
            latest
        );
        let error_code = |snapshot_path: Option<&str>| {
            resolve_execution_snapshot(&root, snapshot_path.map(str::to_string), None)
                .unwrap_err()
                .code
        };
        assert_eq!(
            error_code(Some("/missing/snapshot.md")).as_deref(),
            Some("snapshot_file_not_found")
        );
        assert_eq!(
            error_code(Some("  ")).as_deref(),
            Some("snapshot_path_missing")
        );
        assert_eq!(
            error_code(None).as_deref(),
            Some("snapshot_and_output_dir_missing")
        );
    }

    #[test]
    fn opening_a_file_output_reveals_its_parent_folder() {
        let temp = tempfile::tempdir().expect("temp dir");
        let binary = temp.path().join("dist").join("app");
        std::fs::create_dir_all(binary.parent().expect("binary parent")).expect("create dist");
        std::fs::write(&binary, "binary").expect("write binary");

        assert_eq!(
            output_directory_to_open(&binary.to_string_lossy()).expect("file output"),
            temp.path().join("dist")
        );
        assert_eq!(
            output_directory_to_open(&format!(" {} ", temp.path().display()))
                .expect("directory output"),
            temp.path()
        );
        let error_code = |output: &str| output_directory_to_open(output).unwrap_err().code;
        assert_eq!(error_code("  ").as_deref(), Some("output_dir_empty"));
        assert_eq!(
            error_code(&temp.path().join("missing").to_string_lossy()).as_deref(),
            Some("output_dir_not_found")
        );
    }

    #[test]
    fn write_failures_keep_the_io_error_in_details() {
        let temp = tempfile::tempdir().expect("temp dir");
        // 快照根目录被同名文件占据，创建 bucket 目录必然失败。
        let root = temp.path().join("snapshots");
        std::fs::write(&root, "not a directory").expect("occupy snapshot root");

        let error = write_execution_snapshot(&root, "/tmp/out", snapshot_payload())
            .expect_err("snapshot root is a file");
        assert_eq!(
            error.code.as_deref(),
            Some("execution_snapshot_write_failed")
        );
        assert_eq!(error.message, "write error");
        assert!(error
            .details
            .as_deref()
            .is_some_and(|details| !details.is_empty()));
    }

    #[tokio::test]
    async fn open_directory_failures_keep_the_path_in_details() {
        let temp = tempfile::tempdir().expect("temp dir");
        let missing = temp.path().join("missing").to_string_lossy().to_string();
        let file = temp.path().join("file.txt");
        std::fs::write(&file, "not a directory").expect("write file");
        let file = file.to_string_lossy().to_string();

        let error = open_directory(format!(" {missing} ")).await.unwrap_err();
        assert_eq!(error.code.as_deref(), Some("directory_not_found"));
        assert_eq!(error.message, "目录不存在");
        assert_eq!(error.details.as_deref(), Some(missing.as_str()));

        let error = open_directory(file.clone()).await.unwrap_err();
        assert_eq!(error.code.as_deref(), Some("directory_not_directory"));
        assert_eq!(error.message, "路径不是文件夹");
        assert_eq!(error.details.as_deref(), Some(file.as_str()));
    }

    #[test]
    fn missing_snapshot_errors_keep_the_path_in_details() {
        let temp = tempfile::tempdir().expect("temp dir");
        let root = temp.path().join("execution-snapshots");

        let error = resolve_execution_snapshot(&root, Some(" /missing/a.md ".to_string()), None)
            .unwrap_err();
        assert_eq!(error.message, "快照文件不存在");
        assert_eq!(error.details.as_deref(), Some("/missing/a.md"));

        let error = find_latest_snapshot_for_output_dir(&root, " /exports/App ").unwrap_err();
        assert_eq!(error.message, "未找到输出目录的执行快照");
        assert_eq!(error.details.as_deref(), Some("/exports/App"));
    }
}
