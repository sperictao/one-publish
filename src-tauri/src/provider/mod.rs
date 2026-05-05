pub mod registry;

use crate::compiler::CompileError;
use crate::parameter::{ParameterSchema, RenderError};
use crate::plan::ExecutionPlan;
use crate::spec::PublishSpec;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ProviderManifest {
    pub id: String,
    pub display_name: String,
    pub version: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum ProviderProjectPathKind {
    RepositoryRoot,
    ProjectFile,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ProviderCapabilities {
    pub requires_project_binding: bool,
    pub project_path_kind: ProviderProjectPathKind,
    pub supports_command_import: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ProviderCatalogEntry {
    pub id: String,
    pub display_name: String,
    pub version: String,
    pub label: String,
    pub command_example: String,
    pub environment_label: String,
    pub environment_description: String,
    pub requires_project_binding: bool,
    pub project_path_kind: ProviderProjectPathKind,
    pub supports_command_import: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderRepositoryMarker {
    FileName(String),
    Extension(String),
    NestedExtension {
        directory: String,
        extension: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderProjectFileMatcher {
    FileName(String),
    Extension(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderRepositoryDiscovery {
    pub provider_id: String,
    pub repository_markers: Vec<ProviderRepositoryMarker>,
    pub project_file_matchers: Vec<ProviderProjectFileMatcher>,
}

pub trait Provider: Send + Sync {
    fn manifest(&self) -> &ProviderManifest;

    fn capabilities(&self) -> &ProviderCapabilities;

    fn catalog(&self) -> &ProviderCatalogEntry;

    fn repository_discovery(&self) -> &ProviderRepositoryDiscovery;

    fn get_schema(&self) -> Result<ParameterSchema, RenderError>;

    fn compile(&self, spec: &PublishSpec) -> Result<ExecutionPlan, CompileError>;

    fn resolve_working_dir(&self, spec: &PublishSpec) -> Option<PathBuf>;

    fn infer_output_dir(&self, spec: &PublishSpec) -> String;

    fn configured_output_dir(&self, spec: &PublishSpec) -> Option<String>;

    fn resolve_runtime_program(
        &self,
        program: &str,
        _working_dir: Option<&PathBuf>,
    ) -> Result<String, crate::errors::AppError> {
        Ok(program.to_string())
    }
}
