pub mod registry;

use crate::compiler::CompileError;
use crate::plan::ExecutionPlan;
use crate::spec::PublishSpec;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderManifest {
  pub id: String,
  pub display_name: String,
  pub version: String,
}

pub trait Provider: Send + Sync {
  fn manifest(&self) -> &ProviderManifest;

  fn compile(&self, spec: &PublishSpec) -> Result<ExecutionPlan, CompileError>;
}
