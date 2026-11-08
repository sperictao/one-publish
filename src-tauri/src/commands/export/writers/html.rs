use serde_json::Value;

use super::markdown::{collect_link_paths, is_safe_link_target, summary_u64};

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
                // href 是可执行上下文：可执行 scheme（javascript:/data: 等）
                // 降级为纯文本，只保留转义后的可读值。
                if is_safe_link_target(item) {
                    out.push_str(&format!("<li><a href=\"{}\">{}</a></li>", escaped, escaped));
                } else {
                    out.push_str(&format!("<li>{}</li>", escaped));
                }
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

#[cfg(test)]
mod tests {
    use super::render_diagnostics_index_html;
    use serde_json::json;

    #[test]
    fn executable_link_schemes_render_as_plain_text() {
        let index = json!({
            "generatedAt": "2026-02-08T12:00:00Z",
            "links": {
                "snapshots": ["javascript:alert(1)", "/tmp/ok.md"],
            }
        });
        let html = render_diagnostics_index_html(&index);
        assert!(!html.contains("href=\"javascript:"));
        assert!(html.contains("<li>javascript:alert(1)</li>"));
        assert!(html.contains("<a href=\"/tmp/ok.md\">/tmp/ok.md</a>"));
    }

    #[test]
    fn windows_drive_paths_stay_clickable() {
        let index = json!({
            "links": { "bundles": ["C:\\exports\\bundle.zip"] }
        });
        let html = render_diagnostics_index_html(&index);
        assert!(html.contains("<a href=\"C:\\exports\\bundle.zip\">"));
    }
}
