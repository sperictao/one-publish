use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

#[derive(Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(rename_all = "camelCase")]
pub struct PublishConfig {
    pub configuration: String,
    pub runtime: String,
    pub framework: String,
    pub self_contained: bool,
    pub output_dir: String,
    pub no_build: bool,
    pub no_restore: bool,
    pub verbosity: String,
    pub no_logo: bool,
    pub delete_existing_files: bool,
    pub properties: BTreeMap<String, String>,
    pub define: Vec<String>,
    pub use_profile: bool,
    pub profile_name: String,
}

impl Default for PublishConfig {
    fn default() -> Self {
        Self {
            configuration: "Release".to_string(),
            runtime: String::new(),
            framework: String::new(),
            self_contained: false,
            output_dir: String::new(),
            no_build: false,
            no_restore: false,
            verbosity: String::new(),
            no_logo: false,
            delete_existing_files: false,
            properties: BTreeMap::new(),
            define: Vec::new(),
            use_profile: false,
            profile_name: String::new(),
        }
    }
}

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
