pub mod providers;
pub mod registry;

use crate::compiler::CompileError;
use crate::parameter::{ParameterSchema, RenderError};
use crate::plan::ExecutionPlan;
use crate::spec::PublishSpec;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
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
    /// Provider 内置模板摘要：前端只负责展示与选择，模板参数由后端实现持有。
    #[serde(default)]
    pub templates: Vec<ProviderTemplateSummary>,
}

/// Provider 内置模板：完整参数由 Provider 实现持有，是统一来源解析中
/// `template` 来源的数据源。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ProviderTemplate {
    pub id: String,
    pub name: String,
    pub description: String,
    /// 模板产生的完整参数（schema 键）；false/null/空值按用户语义显式保留。
    pub parameters: serde_json::Value,
}

/// 目录下发的模板摘要：不含参数细节。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ProviderTemplateSummary {
    pub id: String,
    pub name: String,
    pub description: String,
}

impl ProviderTemplate {
    pub fn summary(&self) -> ProviderTemplateSummary {
        ProviderTemplateSummary {
            id: self.id.clone(),
            name: self.name.clone(),
            description: self.description.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderRepositoryMarker {
    FileName(String),
    RecursiveFileName(String),
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderSourceInputKind {
    DeclaredNonSecret,
    Generated,
    EnvironmentDependent,
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

    /// Provider 内置模板：空实现表示该 Provider 没有模板。
    fn templates(&self) -> Vec<ProviderTemplate> {
        Vec::new()
    }

    /// 按模板 ID 解析模板；找不到时返回 None（由来源解析层报错）。
    fn resolve_template(&self, template_id: &str) -> Option<ProviderTemplate> {
        self.templates()
            .into_iter()
            .find(|template| template.id == template_id)
    }

    fn get_schema(&self) -> Result<ParameterSchema, RenderError>;

    fn compile(&self, spec: &PublishSpec) -> Result<ExecutionPlan, CompileError>;

    fn command_prefix(
        &self,
        _spec: &PublishSpec,
    ) -> Result<Option<(String, Vec<String>)>, crate::errors::AppError> {
        Ok(None)
    }

    fn resolve_working_dir(&self, spec: &PublishSpec) -> Option<PathBuf>;

    fn classify_source_input(&self, relative: &Path) -> ProviderSourceInputKind;

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
