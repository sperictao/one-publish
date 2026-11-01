use super::contracts::{PublishLogChunkEvent, PublishLogSummary, PublishSessionStartedEvent};
use std::collections::HashSet;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::sync::mpsc;

pub(crate) fn emit_publish_log<R: tauri::Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    line: &str,
) {
    let payload = PublishLogChunkEvent {
        session_id: session_id.to_string(),
        line: line.to_string(),
    };
    if let Err(error) = app.emit("provider-publish-log", payload) {
        log::warn!("failed to emit provider-publish-log: {}", error);
    }
}

/// 在 spawn 子进程前 emit 发布会话开始事件。
///
/// 前端据此显式锁定活动会话，替代旧的"首 chunk 锁存"策略。
/// emit 失败只 log 不中断——日志会话归属是观测性问题，不影响发布本身。
pub(crate) fn emit_publish_session_started<R: tauri::Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
) {
    let payload = PublishSessionStartedEvent {
        session_id: session_id.to_string(),
    };
    if let Err(error) = app.emit("provider-publish-session-started", payload) {
        log::warn!("failed to emit provider-publish-session-started: {}", error);
    }
}

/// 聚合保留日志上限（约 5 MB UTF-8 字节）。超出后保留末尾并按换行对齐，
/// 失控构建输出不会把内存耗尽；实时事件流与 warning 收集不受影响。
const MAX_AGGREGATE_OUTPUT_BYTES: usize = 5_000_000;
/// 超出上限后允许继续累积的字数，摊薄尾部截断的 drain 成本。
const OUTPUT_TRUNCATION_SLACK: usize = 64_000;
/// 换行对齐只在截断点后的有限前瞻内查找——超长单行不能让对齐丢弃整段保留内容。
const OUTPUT_TRUNCATION_ALIGN_LOOKAHEAD: usize = 4096;
/// 截断标记：发生过一次截断就钉在保留输出头部，让持久化记录如实反映。
const TRUNCATED_OUTPUT_MARKER: &str = "[one-publish: earlier output truncated]\n";
/// warning 列表上限：文本去重后仍按条数封顶，防病态输出无限增长。
const MAX_COLLECTED_WARNINGS: usize = 10_000;
/// 实时日志 emit 的批量阈值：4KB 读粒度逐条 emit 在失控输出下是数万次/秒的
/// IPC 泛洪；攒到该阈值或 flush 间隔到期时合并发送（合并保持字节序不变）。
const EMIT_BATCH_BYTES: usize = 256 * 1024;
/// 实时日志 emit 的最大攒批延迟：输出静默期到期即发，保证可见延迟有界。
const EMIT_FLUSH_INTERVAL: std::time::Duration = std::time::Duration::from_millis(80);

/// 实时日志的待发送攒批缓冲：纯数据策略（阈值判断 + 顺序拼接），emit 副作用
/// 留给调用方以便单测。多块拼成一个 payload 与逐块 append 语义相同——前端按
/// 原文拼接 `payload.line`，顺序与内容不变。
struct PendingEmit {
    pending: String,
}

impl PendingEmit {
    fn new() -> Self {
        Self {
            pending: String::new(),
        }
    }

    fn push(&mut self, rendered: &str) {
        self.pending.push_str(rendered);
    }

    fn batch_full(&self) -> bool {
        self.pending.len() >= EMIT_BATCH_BYTES
    }

    /// 取走攒批内容（无内容返回 None）；阈值/定时器/关闭三种触发共用。
    fn take(&mut self) -> Option<String> {
        if self.pending.is_empty() {
            None
        } else {
            Some(std::mem::take(&mut self.pending))
        }
    }
}

fn append_capped_output(output: &mut String, rendered: &str, truncated: &mut bool) {
    output.push_str(rendered);
    if output.len() <= MAX_AGGREGATE_OUTPUT_BYTES + OUTPUT_TRUNCATION_SLACK {
        return;
    }
    *truncated = true;
    let mut boundary = output.len() - MAX_AGGREGATE_OUTPUT_BYTES;
    while !output.is_char_boundary(boundary) {
        boundary += 1;
    }
    let lookahead_end = (boundary + OUTPUT_TRUNCATION_ALIGN_LOOKAHEAD).min(output.len());
    if let Some(offset) = output.as_bytes()[boundary..lookahead_end]
        .iter()
        .position(|byte| *byte == b'\n')
    {
        boundary += offset + 1;
    }
    output.drain(..boundary);
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
            if lower.contains("warning")
                && lower.contains(':')
                && self.warnings.len() < MAX_COLLECTED_WARNINGS
                && self.seen.insert(trimmed.to_string())
            {
                self.warnings.push(trimmed.to_string());
            }
        }
    }
}

pub(crate) async fn collect_log_chunks<R: tauri::Runtime>(
    app: AppHandle<R>,
    session_id: String,
    mut receiver: mpsc::UnboundedReceiver<(String, String)>,
) -> PublishLogSummary {
    let mut stderr_needs_prefix = true;
    let mut ends_with_newline = true;
    let mut output = String::new();
    let mut output_truncated = false;
    let mut warnings = WarningCollector::new();
    let mut pending = PendingEmit::new();
    let mut flush = tokio::time::interval(EMIT_FLUSH_INTERVAL);
    // interval 首 tick 立即返回；pending 为空时 take 是 no-op，不单独跳过。
    flush.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        tokio::select! {
            chunk = receiver.recv() => {
                let Some((stream, chunk)) = chunk else { break };
                let rendered = render_stream_chunk(&stream, &chunk, &mut stderr_needs_prefix);
                if rendered.is_empty() {
                    continue;
                }
                warnings.scan(&rendered);
                pending.push(&rendered);
                append_capped_output(&mut output, &rendered, &mut output_truncated);
                ends_with_newline = rendered.ends_with('\n') || rendered.ends_with('\r');
                if pending.batch_full() {
                    if let Some(batch) = pending.take() {
                        emit_publish_log(&app, &session_id, &batch);
                    }
                }
            }
            _ = flush.tick() => {
                if let Some(batch) = pending.take() {
                    emit_publish_log(&app, &session_id, &batch);
                }
            }
        }
    }

    // 读端关闭后发出剩余攒批，尾部内容不丢。
    if let Some(batch) = pending.take() {
        emit_publish_log(&app, &session_id, &batch);
    }

    if output_truncated {
        output.insert_str(0, TRUNCATED_OUTPUT_MARKER);
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
    use super::{
        append_capped_output, PendingEmit, WarningCollector, EMIT_BATCH_BYTES,
        MAX_AGGREGATE_OUTPUT_BYTES, OUTPUT_TRUNCATION_SLACK,
    };

    #[test]
    fn pending_emit_joins_chunks_in_order() {
        let mut pending = PendingEmit::new();
        pending.push("first\n");
        pending.push("second\n");
        pending.push("third\n");

        assert_eq!(pending.take().as_deref(), Some("first\nsecond\nthird\n"));
        assert!(pending.take().is_none(), "取走后缓冲应为空");
    }

    #[test]
    fn pending_emit_take_on_empty_returns_none() {
        let mut pending = PendingEmit::new();
        assert!(pending.take().is_none());
    }

    #[test]
    fn pending_emit_reports_batch_full_at_threshold() {
        let mut pending = PendingEmit::new();
        assert!(!pending.batch_full());

        pending.push(&"x".repeat(EMIT_BATCH_BYTES));
        assert!(pending.batch_full(), "达到批量阈值应触发 flush");

        pending.take();
        assert!(!pending.batch_full());
    }

    #[test]
    fn warning_collector_matches_msbuild_warning_lines() {
        let mut collector = WarningCollector::new();
        collector
            .scan("Main.cs(17,20): warning CS0168: The variable 'x' is declared but never used\n");

        assert_eq!(collector.warnings.len(), 1);
        assert!(collector.warnings[0].contains("warning CS0168"));
    }

    #[test]
    fn warning_collector_matches_nuget_security_warning_on_stderr() {
        let mut collector = WarningCollector::new();
        collector.scan(
            "[stderr] warning NU1903: Package 'Foo' has a known high severity vulnerability\n",
        );

        assert_eq!(collector.warnings.len(), 1);
        assert!(collector.warnings[0].contains("warning NU1903"));
    }

    #[test]
    fn warning_collector_ignores_error_lines() {
        let mut collector = WarningCollector::new();
        collector.scan(
            "[stderr] CS0246: error CS0246: The type or namespace 'Foo' could not be found\n",
        );

        assert_eq!(collector.warnings.len(), 0, "error 行不应被分类为 warning");
    }

    #[test]
    fn warning_collector_ignores_plain_output_without_warning_keyword() {
        let mut collector = WarningCollector::new();
        collector.scan("Build succeeded.\n 0 Warning(s)\n 0 Error(s)\n");

        assert_eq!(
            collector.warnings.len(),
            0,
            "含 warning 单词但非诊断格式的行不应被收录"
        );
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

    #[test]
    fn append_capped_output_keeps_small_logs_intact() {
        let mut output = String::new();
        let mut truncated = false;

        append_capped_output(&mut output, "line one\nline two\n", &mut truncated);

        assert_eq!(output, "line one\nline two\n");
        assert!(!truncated);
    }

    #[test]
    fn append_capped_output_retains_only_tail_beyond_cap() {
        let mut output = String::new();
        let mut truncated = false;
        let head = "h".repeat(MAX_AGGREGATE_OUTPUT_BYTES + OUTPUT_TRUNCATION_SLACK);
        append_capped_output(&mut output, &head, &mut truncated);
        append_capped_output(&mut output, "tail-line\n", &mut truncated);

        assert!(truncated, "超出上限后必须标记截断");
        assert!(
            output.len() <= MAX_AGGREGATE_OUTPUT_BYTES,
            "保留输出不得超过上限，实际 {} 字节",
            output.len()
        );
        assert!(output.ends_with("tail-line\n"), "必须保留末尾内容");
    }

    #[test]
    fn append_capped_output_aligns_truncation_to_newline() {
        // boundary = 追加后 len - MAX = 64_006；'\n' 位于 64_101，落在前瞻窗口内，
        // 截断应对齐到该换行之后，保留 'z' 段与追加尾部。
        let mut output = format!("{}\n{}", "x".repeat(64_101), "z".repeat(4_999_899));
        let mut truncated = false;

        append_capped_output(&mut output, "tail\n", &mut truncated);

        assert!(truncated);
        assert!(output.starts_with('z'), "截断起点应对齐到换行之后");
        assert!(output.ends_with("tail\n"), "必须保留末尾内容");
        assert!(output.len() <= MAX_AGGREGATE_OUTPUT_BYTES);
    }

    #[test]
    fn append_capped_output_keeps_tail_when_no_newline_within_lookahead() {
        // '\n' 位于 69_001，超出前瞻窗口（boundary 64_006 + 4KB）：对齐不得
        // 丢弃整段保留内容，直接从边界保留尾部。
        let mut output = format!("{}\n{}", "x".repeat(69_001), "z".repeat(4_994_999));
        let mut truncated = false;

        append_capped_output(&mut output, "tail\n", &mut truncated);

        assert!(truncated);
        assert!(output.ends_with("tail\n"));
        assert_eq!(output.len(), MAX_AGGREGATE_OUTPUT_BYTES);
    }

    #[test]
    fn append_capped_output_handles_multibyte_boundaries() {
        // 多字节字符 + 周期换行：截断起点可能落在 UTF-8 序列中间，
        // 必须先推进到字符边界再对齐换行，且不得 panic。
        let mut output = "界界\n".repeat(MAX_AGGREGATE_OUTPUT_BYTES / 2);
        let mut truncated = false;

        append_capped_output(&mut output, "end\n", &mut truncated);

        assert!(truncated);
        assert!(output.ends_with("end\n"));
        assert!(output.len() <= MAX_AGGREGATE_OUTPUT_BYTES);
    }

    #[test]
    fn warning_collector_stops_growing_at_cap() {
        let mut collector = WarningCollector::new();
        for index in 0..(super::MAX_COLLECTED_WARNINGS + 5) {
            collector.scan(&format!(
                "warning CS{index:04}: synthetic warning {index}\n"
            ));
        }

        assert_eq!(
            collector.warnings.len(),
            super::MAX_COLLECTED_WARNINGS,
            "warning 列表必须封顶，防失控输出无限增长"
        );
    }
}
