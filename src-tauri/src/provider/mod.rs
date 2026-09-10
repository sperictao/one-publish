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

/// 项目发布配置（Project Publish Profile）声明：目录与引用参数键都是
/// Provider 知识，通用来源解析只读声明，不做身份判断。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub struct ProviderProjectProfiles {
    /// 配置文件所在目录（相对项目文件目录），例如 "Properties/PublishProfiles"。
    pub directory: String,
    /// 配置文件扩展名（不含点），例如 "pubxml"。
    pub extension: String,
    /// 引用固化到的参数键（schema 键），例如 "properties"。
    pub reference_parameter: String,
    /// 引用在该参数内的属性名，例如 "PublishProfile"。
    pub reference_property: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ProviderCapabilities {
    pub requires_project_binding: bool,
    pub project_path_kind: ProviderProjectPathKind,
    pub supports_command_import: bool,
    /// 执行时把项目文件追加为位置参数。
    pub appends_project_path: bool,
    /// 默认输出目录布局模板；None 表示不派生默认输出。
    /// 可用令牌：{default_output_dir}、{project_stem}、{param:<key>}；
    /// 令牌无值时丢弃所在段，param 缺失时回退 schema 默认值。
    #[serde(default)]
    #[ts(optional = nullable)]
    pub output_layout: Option<String>,
    /// 项目发布配置声明；None 表示该 Provider 没有项目配置语义。
    #[serde(default)]
    #[ts(optional = nullable)]
    pub project_profiles: Option<ProviderProjectProfiles>,
    /// 从项目文件 XML 提取框架建议的标签名；空表示不提取。
    #[serde(default)]
    pub framework_tags: Vec<String>,
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
    /// 该 Provider 是否支持项目发布配置来源。
    pub supports_project_profiles: bool,
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
    /// 解决方案文件扩展名；空表示该 Provider 没有 solution 概念。
    pub solution_file_extensions: Vec<String>,
    /// 声明该 Provider 拥有项目文件推荐引擎；未声明的 Provider 只做“唯一候选即推荐”。
    pub owns_project_recommendation: bool,
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
