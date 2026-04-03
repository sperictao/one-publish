use super::contracts::{PublishLogChunkEvent, PublishLogSummary};
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

pub(crate) async fn collect_log_chunks(
    app: AppHandle,
    session_id: String,
    mut receiver: mpsc::UnboundedReceiver<(String, String)>,
) -> PublishLogSummary {
    let mut stderr_needs_prefix = true;
    let mut ends_with_newline = true;

    while let Some((stream, chunk)) = receiver.recv().await {
        let rendered = render_stream_chunk(&stream, &chunk, &mut stderr_needs_prefix);
        if rendered.is_empty() {
            continue;
        }

        emit_publish_log(&app, &session_id, &rendered);
        ends_with_newline = rendered.ends_with('\n') || rendered.ends_with('\r');
    }

    PublishLogSummary { ends_with_newline }
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
