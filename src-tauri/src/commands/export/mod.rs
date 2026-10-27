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

/// 交接包 README 索引：运行概要 + 包含文件清单，全部取自已脱敏的 record 值。
fn render_handoff_readme(record: &Value, includes: &[(&str, bool)]) -> String {
    let field = |key: &str| -> String {
        record
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or("(unknown)")
            .to_string()
    };
    let provider = field("provider_id");
    let status = if record.get("success").and_then(Value::as_bool) == Some(true) {
        "成功"
    } else if record.get("cancelled").and_then(Value::as_bool) == Some(true) {
        "已取消"
    } else {
        "失败"
    };
    let command_line = record
        .get("command_line")
        .and_then(Value::as_str)
        .unwrap_or("(no command recorded)");
    let error = record
        .get("error")
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
        .unwrap_or("(none)");

    let mut content = format!(
        "# OnePublish 交接包\n\n\
         一次发布运行的离线交接产物：命令、执行快照与失败分组，脱敏后可分享。\n\n\
         ## 运行概要\n\n\
         - Provider: {provider}\n\
         - 项目: {}\n\
         - 状态: {status}\n\
         - 开始时间: {}\n\
         - 结束时间: {}\n\n\
         ## 命令\n\n```text\n{command_line}\n```\n\n\
         ## 错误\n\n```text\n{error}\n```\n\n\
         ## 包含文件\n\n",
        field("project_path"),
        field("started_at"),
        field("finished_at"),
    );
    for (name, present) in includes {
        let note = if *present {
            ""
        } else {
            "（本次运行未包含）"
        };
        content.push_str(&format!("- `{name}` {note}\n"));
    }
    content
}

/// 单次运行的交接包：命令摘要（README 索引）、执行快照与失败分组打包为单一
/// zip 产物。所有内容沿用导出脱敏链路：record/bundle 经 `sanitize_export_value`，
/// 快照文件在导出时已脱敏；包内不出现未脱敏的本地绝对路径。
#[tauri::command]
pub async fn export_handoff_bundle(
    record: Value,
    failure_bundle: Option<Value>,
    file_path: String,
) -> Result<String, crate::errors::AppError> {
    let _timer =
        crate::commands::middleware::CommandTimer::new("commands::export::export_handoff_bundle");
    let mut record = record;
    if !record.is_object() {
        return Err(export_error(
            "handoff record payload must be an object",
            "handoff_record_payload_invalid",
        ));
    }
    // 快照定位必须先于脱敏：snapshot_path/output_dir 是本地绝对路径，
    // 脱敏后会被遮蔽为占位符而无法寻址。快照文件本身在导出时已脱敏。
    let snapshot_content = resolve_execution_snapshot(
        &execution_snapshot_root()?,
        record
            .get("snapshot_path")
            .and_then(Value::as_str)
            .map(str::to_string),
        record
            .get("output_dir")
            .and_then(Value::as_str)
            .map(str::to_string),
    )
    .ok()
    .and_then(|path| std::fs::read_to_string(path).ok());

    crate::security::sanitize_export_value(&mut record);
    let mut failure_bundle = failure_bundle;
    if let Some(bundle) = failure_bundle.as_mut() {
        if !bundle.is_object() {
            return Err(export_error(
                "handoff failure bundle payload must be an object",
                "handoff_failure_bundle_payload_invalid",
            ));
        }
        crate::security::sanitize_export_value(bundle);
    }
    let failure_group_content = failure_bundle
        .as_ref()
        .map(render_failure_group_bundle_markdown)
        .transpose()
        .map_err(|source| {
            export_source_error(
                "serialization error",
                source,
                "handoff_failure_group_render_failed",
            )
        })?;

    let includes = [
        ("README.md", true),
        ("snapshot.md", snapshot_content.is_some()),
        ("failure-groups.md", failure_group_content.is_some()),
    ];
    let readme = render_handoff_readme(&record, &includes);

    let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let mut entries: Vec<(&str, String)> = vec![("README.md", readme)];
    if let Some(snapshot) = snapshot_content.as_deref() {
        entries.push(("snapshot.md", snapshot.to_string()));
    }
    if let Some(groups) = failure_group_content.as_deref() {
        entries.push(("failure-groups.md", groups.to_string()));
    }
    for (name, content) in &entries {
        zip.start_file(*name, options).map_err(|source| {
            export_source_error("write error", source, "handoff_zip_write_failed")
        })?;
        std::io::Write::write_all(&mut zip, content.as_bytes()).map_err(|source| {
            export_source_error("write error", source, "handoff_zip_write_failed")
        })?;
    }
    let bytes = zip
        .finish()
        .map_err(|source| {
            export_source_error("write error", source, "handoff_zip_finalize_failed")
        })?
        .into_inner();
    crate::security::write_private_binary_file(Path::new(&file_path), &bytes).map_err(
        |source| export_source_error("write error", source, "handoff_bundle_write_failed"),
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
        return Err(export_error("输出目录不存在", "output_dir_not_found").with_details(trimmed));
    }

    if path.is_dir() {
        return Ok(path);
    }
    match path.parent() {
        Some(parent) if path.is_file() && !parent.as_os_str().is_empty() => {
            Ok(parent.to_path_buf())
        }
        _ => Err(
            export_error("输出目录不是文件夹", "output_dir_not_directory").with_details(trimmed),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn handoff_bundle_packages_command_snapshot_and_failure_groups_without_local_paths() {
        let dir = tempfile::tempdir().expect("temp dir");
        // 预置一份已脱敏导出的执行快照，交接包应原样收录。
        let snapshot_dir = dir.path().join("snapshot-bucket");
        std::fs::create_dir_all(&snapshot_dir).expect("create snapshot bucket");
        std::fs::write(
            snapshot_dir.join("execution-snapshot-2026.md"),
            "# 执行快照\n\n命令已脱敏：/private/tmp 应不可见。",
        )
        .expect("write snapshot");
        // execution_snapshot_root 读取固定主目录，这里直接注入 resolve 的结果文件：
        // 通过 record.snapshot_path 指向该文件即可命中 resolve_execution_snapshot 的
        // recorded 分支，无需改写 home 目录。
        let snapshot_path = snapshot_dir.join("execution-snapshot-2026.md");

        let record = json!({
            "provider_id": "dotnet",
            "project_path": "/Users/secret/project/App.csproj",
            "success": false,
            "cancelled": false,
            "command_line": "$ dotnet publish /Users/secret/project/App.csproj -c Release",
            "error": "build failed at /Users/secret/project/Program.cs:12",
            "started_at": "2026-04-02T10:00:00.000Z",
            "finished_at": "2026-04-02T10:00:03.000Z",
            "snapshot_path": snapshot_path.to_string_lossy(),
            "output_dir": "/Users/secret/project/bin/Release/publish",
        });
        let failure_bundle = json!({
            "generatedAt": "2026-04-02T10:00:04Z",
            "summary": { "failureGroupCount": 1, "failedRecordCount": 1 },
            "groups": [
                {
                    "signature": "compile-error",
                    "title": "编译失败",
                    "records": [ { "id": "r1", "error": "CS1002 at /Users/secret/x.cs" } ]
                }
            ]
        });

        let out = dir.path().join("handoff.zip");
        let path = tokio::runtime::Runtime::new()
            .expect("runtime")
            .block_on(export_handoff_bundle(
                record,
                Some(failure_bundle),
                out.to_string_lossy().into_owned(),
            ))
            .expect("export handoff bundle");
        assert_eq!(path, out.to_string_lossy());

        let bytes = std::fs::read(&out).expect("read zip");
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(&bytes)).expect("open zip");
        let mut names = Vec::new();
        for index in 0..archive.len() {
            let file = archive.by_index(index).expect("zip entry");
            names.push(file.name().expect("entry name").to_string());
        }
        names.sort();
        assert_eq!(names, ["README.md", "failure-groups.md", "snapshot.md"]);

        let mut read = |name: &str| -> String {
            let mut file = archive.by_name(name).expect("entry");
            let mut content = String::new();
            std::io::Read::read_to_string(&mut file, &mut content).expect("read entry");
            content
        };

        let readme = read("README.md");
        assert!(readme.contains("dotnet publish"));
        assert!(readme.contains("状态: 失败"));
        assert!(readme.contains("`snapshot.md`"));
        assert!(readme.contains("`failure-groups.md`"));
        // 本地绝对路径必须被遮蔽（脱敏链路经 sanitize_export_value）。
        assert!(
            !readme.contains("/Users/secret"),
            "README 不得泄漏本地路径：{readme}"
        );

        let groups = read("failure-groups.md");
        assert!(groups.contains("编译失败"), "失败分组内容应包含分组标题");
        assert!(
            !groups.contains("/Users/secret"),
            "失败分组不得泄漏本地路径"
        );

        let snapshot = read("snapshot.md");
        assert!(snapshot.contains("执行快照"));
    }

    #[test]
    fn handoff_bundle_degrades_gracefully_without_snapshot_or_groups() {
        let dir = tempfile::tempdir().expect("temp dir");
        let record = json!({
            "provider_id": "cargo",
            "project_path": "/tmp/secret-app",
            "success": true,
            "cancelled": false,
            "command_line": "$ cargo build --release",
            "error": null,
            "started_at": "2026-04-02T10:00:00.000Z",
            "finished_at": "2026-04-02T10:00:03.000Z",
            "snapshot_path": null,
            "output_dir": null,
        });

        let out = dir.path().join("handoff-minimal.zip");
        tokio::runtime::Runtime::new()
            .expect("runtime")
            .block_on(export_handoff_bundle(
                record,
                None,
                out.to_string_lossy().into_owned(),
            ))
            .expect("export handoff bundle");

        let bytes = std::fs::read(&out).expect("read zip");
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(&bytes)).expect("open zip");
        let mut readme = String::new();
        let mut file = archive.by_name("README.md").expect("README");
        std::io::Read::read_to_string(&mut file, &mut readme).expect("read README");
        assert!(readme.contains("状态: 成功"));
        assert!(readme.contains("`snapshot.md` （本次运行未包含）"));
        assert!(readme.contains("`failure-groups.md` （本次运行未包含）"));
    }

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
    fn not_found_errors_keep_the_path_in_details() {
        let temp = tempfile::tempdir().expect("temp dir");
        let missing = temp.path().join("missing").to_string_lossy().to_string();

        let output_error = output_directory_to_open(&missing).unwrap_err();
        assert_eq!(output_error.message, "输出目录不存在");
        assert_eq!(output_error.details.as_deref(), Some(missing.as_str()));

        let directory_error =
            tauri::async_runtime::block_on(open_directory(format!(" {missing} "))).unwrap_err();
        assert_eq!(directory_error.code.as_deref(), Some("directory_not_found"));
        assert_eq!(directory_error.details.as_deref(), Some(missing.as_str()));

        let snapshot_error =
            resolve_execution_snapshot(temp.path(), Some(missing.clone()), None).unwrap_err();
        assert_eq!(snapshot_error.message, "快照文件不存在");
        assert_eq!(snapshot_error.details.as_deref(), Some(missing.as_str()));

        let lookup_error = find_latest_snapshot_for_output_dir(temp.path(), &missing).unwrap_err();
        assert_eq!(lookup_error.message, "未找到输出目录的执行快照");
        assert_eq!(lookup_error.details.as_deref(), Some(missing.as_str()));
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
    async fn open_directory_rejects_a_file_with_the_path_in_details() {
        let temp = tempfile::tempdir().expect("temp dir");
        let file = temp.path().join("file.txt");
        std::fs::write(&file, "not a directory").expect("write file");
        let file = file.to_string_lossy().to_string();

        let error = open_directory(file.clone()).await.unwrap_err();
        assert_eq!(error.code.as_deref(), Some("directory_not_directory"));
        assert_eq!(error.message, "路径不是文件夹");
        assert_eq!(error.details.as_deref(), Some(file.as_str()));
    }
}
