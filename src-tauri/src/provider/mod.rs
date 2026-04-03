pub mod registry;

use crate::compiler::CompileError;
use crate::parameter::{ParameterSchema, RenderError};
use crate::plan::ExecutionPlan;
use crate::spec::PublishSpec;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ProviderManifest {
    pub id: String,
    pub display_name: String,
    pub version: String,
}

pub trait Provider: Send + Sync {
    fn manifest(&self) -> &ProviderManifest;

    fn get_schema(&self) -> Result<ParameterSchema, RenderError>;

    fn compile(&self, spec: &PublishSpec) -> Result<ExecutionPlan, CompileError>;
}
