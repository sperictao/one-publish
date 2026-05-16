use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct RenderedPublishCommand {
    pub program: String,
    pub args: Vec<String>,
    pub working_dir: Option<String>,
    pub display_command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PublishResult {
    pub provider_id: String,
    pub success: bool,
    pub cancelled: bool,
    pub error: Option<String>,
    pub command: RenderedPublishCommand,
    pub output_log: String,
    pub output_dir: String,
    pub file_count: usize,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct PublishLogChunkEvent {
    pub(crate) session_id: String,
    pub(crate) line: String,
}

#[derive(Debug, Clone)]
pub(crate) struct PublishLogSummary {
    pub(crate) ends_with_newline: bool,
    pub(crate) output: String,
}
