use serde_json::Value;

use super::super::export_source_error;

pub fn render_preflight_markdown(report: &Value) -> Result<String, crate::errors::AppError> {
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
    let raw = serde_json::to_string_pretty(report).map_err(|source| {
        export_source_error(
            "serialization error",
            source,
            "preflight_markdown_serialize_failed",
        )
    })?;
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

pub fn render_execution_snapshot_markdown(snapshot: &Value) -> Result<String, crate::errors::AppError> {
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
        .map_err(|source| {
            export_source_error(
                "serialization error",
                source,
                "execution_snapshot_spec_serialize_failed",
            )
        })?
        .unwrap_or_else(|| "{}".to_string());
    let result_json = snapshot
        .get("result")
        .map(serde_json::to_string_pretty)
        .transpose()
        .map_err(|source| {
            export_source_error(
                "serialization error",
                source,
                "execution_snapshot_result_serialize_failed",
            )
        })?
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

pub fn render_failure_group_bundle_markdown(bundle: &Value) -> Result<String, crate::errors::AppError> {
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

    let raw = serde_json::to_string_pretty(bundle).map_err(|source| {
        export_source_error(
            "serialization error",
            source,
            "failure_group_bundle_markdown_serialize_failed",
        )
    })?;
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

pub fn collect_link_paths(index: &Value, category: &str) -> Vec<String> {
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

pub fn summary_u64(index: &Value, key: &str) -> u64 {
    index
        .get("summary")
        .and_then(Value::as_object)
        .and_then(|summary| summary.get(key))
        .and_then(Value::as_u64)
        .unwrap_or(0)
}

pub fn markdown_link(path: &str) -> String {
    let label = path
        .replace('\\', "\\\\")
        .replace('[', "\\[")
        .replace(']', "\\]");
    format!("[{}](<{}>)", label, path)
}

pub fn render_diagnostics_index_markdown(index: &Value) -> Result<String, crate::errors::AppError> {
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

    let raw = serde_json::to_string_pretty(index).map_err(|source| {
        export_source_error(
            "serialization error",
            source,
            "diagnostics_index_markdown_serialize_failed",
        )
    })?;
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
