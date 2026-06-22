use super::contracts::{PublishLogChunkEvent, PublishLogSummary};
use std::collections::HashSet;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::sync::mpsc;

pub(crate) fn emit_publish_log(app: &AppHandle, session_id: &str, line: &str) {
    let payload = PublishLogChunkEvent {
        session_id: session_id.to_string(),
        line: line.to_string(),
    };
    if let Err(error) = app.emit("provider-publish-log", payload) {
        log::warn!("failed to emit provider-publish-log: {}", error);
    }
}

fn render_stream_chunk(stream: &str, chunk: &str, stderr_needs_prefix: &mut bool) -> String {
    if stream != "stderr" {
        return chunk.to_string();
    }

    let mut rendered = String::new();
    for ch in chunk.chars() {
        if *stderr_needs_prefix {
            rendered.push_str("[stderr] ");
            *stderr_needs_prefix = false;
        }
        rendered.push(ch);
        if ch == '\n' || ch == '\r' {
            *stderr_needs_prefix = true;
        }
    }

    rendered
}

/// 收集发布日志里的 warning 行，按文本去重。
///
/// MSBuild 诊断格式为 `Origin : [Subcategory] warning Code : Text`，
/// Category 字段固定为 `warning`。这里用行级字符串匹配：trim 后转小写，
/// 同时包含 `warning` 和 `:` 即判定为 warning 行。匹配范围足够窄，
/// 正常构建输出里 `warning` 仅作为诊断 Category 出现。
struct WarningCollector {
    seen: HashSet<String>,
    warnings: Vec<String>,
}

impl WarningCollector {
    fn new() -> Self {
        Self {
            seen: HashSet::new(),
            warnings: Vec::new(),
        }
    }

    fn scan(&mut self, rendered: &str) {
        for line in rendered.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let lower = trimmed.to_lowercase();
            if lower.contains("warning") && lower.contains(':') {
                if self.seen.insert(trimmed.to_string()) {
                    self.warnings.push(trimmed.to_string());
                }
            }
        }
    }
}

pub(crate) async fn collect_log_chunks(
    app: AppHandle,
    session_id: String,
    mut receiver: mpsc::UnboundedReceiver<(String, String)>,
) -> PublishLogSummary {
    let mut stderr_needs_prefix = true;
    let mut ends_with_newline = true;
    let mut output = String::new();
    let mut warnings = WarningCollector::new();

    while let Some((stream, chunk)) = receiver.recv().await {
        let rendered = render_stream_chunk(&stream, &chunk, &mut stderr_needs_prefix);
        if rendered.is_empty() {
            continue;
        }

        warnings.scan(&rendered);
        emit_publish_log(&app, &session_id, &rendered);
        output.push_str(&rendered);
        ends_with_newline = rendered.ends_with('\n') || rendered.ends_with('\r');
    }

    PublishLogSummary {
        ends_with_newline,
        output,
        warnings: warnings.warnings,
    }
}

pub(crate) async fn read_stream_chunks<R>(
    mut stream: R,
    stream_name: &'static str,
    sender: mpsc::UnboundedSender<(String, String)>,
) where
    R: AsyncRead + Unpin + Send + 'static,
{
    let mut buffer = [0u8; 4096];
    loop {
        match stream.read(&mut buffer).await {
            Ok(0) => return,
            Ok(size) => {
                let chunk = String::from_utf8_lossy(&buffer[..size]).to_string();
                if sender.send((stream_name.to_string(), chunk)).is_err() {
                    return;
                }
            }
            Err(error) => {
                let message = format!("stream read error: {}", error);
                let _ = sender.send(("stderr".to_string(), format!("{}\n", message)));
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::WarningCollector;

    #[test]
    fn warning_collector_matches_msbuild_warning_lines() {
        let mut collector = WarningCollector::new();
        collector.scan("Main.cs(17,20): warning CS0168: The variable 'x' is declared but never used\n");

        assert_eq!(collector.warnings.len(), 1);
        assert!(collector.warnings[0].contains("warning CS0168"));
    }

    #[test]
    fn warning_collector_matches_nuget_security_warning_on_stderr() {
        let mut collector = WarningCollector::new();
        collector.scan("[stderr] warning NU1903: Package 'Foo' has a known high severity vulnerability\n");

        assert_eq!(collector.warnings.len(), 1);
        assert!(collector.warnings[0].contains("warning NU1903"));
    }

    #[test]
    fn warning_collector_ignores_error_lines() {
        let mut collector = WarningCollector::new();
        collector.scan("[stderr] CS0246: error CS0246: The type or namespace 'Foo' could not be found\n");

        assert_eq!(collector.warnings.len(), 0, "error 行不应被分类为 warning");
    }

    #[test]
    fn warning_collector_ignores_plain_output_without_warning_keyword() {
        let mut collector = WarningCollector::new();
        collector.scan("Build succeeded.\n 0 Warning(s)\n 0 Error(s)\n");

        assert_eq!(collector.warnings.len(), 0, "含 warning 单词但非诊断格式的行不应被收录");
    }

    #[test]
    fn warning_collector_deduplicates_identical_lines() {
        let mut collector = WarningCollector::new();
        let line = "Main.cs(17,20): warning CS0168: The variable 'x' is declared but never used\n";
        collector.scan(line);
        collector.scan(line);
        collector.scan(line);

        assert_eq!(collector.warnings.len(), 1, "相同 warning 行应去重");
    }

    #[test]
    fn warning_collector_keeps_distinct_lines_in_order() {
        let mut collector = WarningCollector::new();
        collector.scan("warning CS0168: unused variable\nwarning NU1903: vulnerable package\nwarning CS0219: variable assigned but never used\n");

        assert_eq!(collector.warnings.len(), 3);
        assert!(collector.warnings[0].contains("CS0168"));
        assert!(collector.warnings[1].contains("NU1903"));
        assert!(collector.warnings[2].contains("CS0219"));
    }
}
