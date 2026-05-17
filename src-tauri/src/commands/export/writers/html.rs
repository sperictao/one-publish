use serde_json::Value;

use super::markdown::{collect_link_paths, summary_u64};

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

pub fn render_diagnostics_index_html(index: &Value) -> String {
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
