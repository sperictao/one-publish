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

/// Provider 默认输出声明：目标参数名与路径布局必须一起由 Provider 持有，
/// 通用 runtime 只消费声明，不知道 `output`、`target_dir` 等具体 schema 键。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ProviderOutputLayout {
    /// 派生输出目录写入的 schema 参数键。
    pub parameter: String,
    /// 默认输出目录布局模板。
    pub template: String,
    /// 清理开关的 schema 布尔参数键：派生目录归 OnePublish 独占时缺省开启，
    /// 避免交付上次发布残留的文件；配置显式设置时保留用户选择。
    #[serde(default)]
    #[ts(optional = nullable)]
    pub cleanup_parameter: Option<String>,
}

/// Provider 自行派生的缺省输出：配置未显式给出时写入执行参数。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderDefaultOutput {
    /// 写入的 schema 参数键。
    pub parameter: String,
    pub path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ProviderCapabilities {
    pub requires_project_binding: bool,
    pub project_path_kind: ProviderProjectPathKind,
    pub supports_command_import: bool,
    /// 执行时把项目文件追加为位置参数。
    pub appends_project_path: bool,
    /// 默认输出声明；`None` 表示不向命令参数派生默认输出。
    /// `template` 可用令牌：`{default_output_dir}`、`{project_stem}`、`{param:<key>}`；
    /// 令牌无值时丢弃所在段，`param` 缺失时回退 `schema` 默认值。
    #[serde(default)]
    #[ts(optional = nullable)]
    pub output_layout: Option<ProviderOutputLayout>,
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

    /// 未声明 `output_layout` 模板的 Provider 自行派生缺省输出；`default_output_dir`
    /// 是设置中的默认发布目录（可能为空）。空实现表示沿用 Provider 原生输出。
    fn default_output(
        &self,
        _spec: &PublishSpec,
        _default_output_dir: &str,
    ) -> Option<ProviderDefaultOutput> {
        None
    }

    /// 输出不由 OnePublish 指定时（项目配置直接发布、缺输出历史重跑），向
    /// 工具链求值构建实际写入的输出目录，返回（保留参数名, 目录）写入 spec
    /// 供产物收集与 preflight 使用；空实现表示沿用 `infer_output_dir` 静态推断。
    fn resolve_implicit_output(&self, _spec: &PublishSpec) -> Option<(String, String)> {
        None
    }

    /// 构建进程成功退出后校验原生输出目录确实含有交付产物；返回 Err 时本次发布
    /// 按失败处理，避免把锁文件等无关内容当作产物交付。空实现表示不做额外校验。
    fn verify_build_output(&self, _output_dir: &Path) -> Result<(), String> {
        Ok(())
    }

    /// 交付产物筛选：原生输出目录中只有被接受的条目进入产物集合，被拒绝的目录
    /// 不再递归。空实现表示整个输出目录都是产物。
    fn artifact_filter(&self) -> Option<publish_adapters::ArtifactEntryFilter> {
        None
    }

    /// 原生输出目录跨构建累积旧产物时返回 true：构建前移除被 `artifact_filter`
    /// 接受的顶层文件，交付只含本次构建的产物。
    fn clears_stale_artifacts(&self) -> bool {
        false
    }

    fn resolve_runtime_program(
        &self,
        program: &str,
        _working_dir: Option<&PathBuf>,
    ) -> Result<String, crate::errors::AppError> {
        Ok(program.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 只实现必需方法的最小 Provider：用于钉住 trait 默认实现的契约
    /// （默认行为本身就是公共语义，不只是"空实现"）。
    struct StubProvider {
        manifest: ProviderManifest,
        capabilities: ProviderCapabilities,
        catalog: ProviderCatalogEntry,
        discovery: ProviderRepositoryDiscovery,
        templates: Vec<ProviderTemplate>,
    }

    fn stub_provider(templates: Vec<ProviderTemplate>) -> StubProvider {
        StubProvider {
            manifest: ProviderManifest {
                id: "stub".to_string(),
                display_name: "Stub".to_string(),
                version: "1".to_string(),
            },
            capabilities: ProviderCapabilities {
                requires_project_binding: false,
                project_path_kind: ProviderProjectPathKind::RepositoryRoot,
                supports_command_import: false,
                appends_project_path: false,
                output_layout: None,
                project_profiles: None,
                framework_tags: Vec::new(),
            },
            catalog: ProviderCatalogEntry {
                id: "stub".to_string(),
                display_name: "Stub".to_string(),
                version: "1".to_string(),
                label: "Stub".to_string(),
                command_example: String::new(),
                environment_label: String::new(),
                environment_description: String::new(),
                requires_project_binding: false,
                project_path_kind: ProviderProjectPathKind::RepositoryRoot,
                supports_command_import: false,
                supports_project_profiles: false,
                templates: Vec::new(),
            },
            discovery: ProviderRepositoryDiscovery {
                provider_id: "stub".to_string(),
                repository_markers: Vec::new(),
                project_file_matchers: Vec::new(),
                solution_file_extensions: Vec::new(),
                owns_project_recommendation: false,
            },
            templates,
        }
    }

    impl Provider for StubProvider {
        fn manifest(&self) -> &ProviderManifest {
            &self.manifest
        }

        fn capabilities(&self) -> &ProviderCapabilities {
            &self.capabilities
        }

        fn catalog(&self) -> &ProviderCatalogEntry {
            &self.catalog
        }

        fn repository_discovery(&self) -> &ProviderRepositoryDiscovery {
            &self.discovery
        }

        fn templates(&self) -> Vec<ProviderTemplate> {
            self.templates.clone()
        }

        fn get_schema(&self) -> Result<ParameterSchema, RenderError> {
            Ok(ParameterSchema {
                parameters: std::collections::BTreeMap::new(),
            })
        }

        fn compile(&self, spec: &PublishSpec) -> Result<ExecutionPlan, CompileError> {
            Ok(ExecutionPlan {
                version: crate::plan::PLAN_VERSION,
                spec: spec.clone(),
                steps: Vec::new(),
            })
        }

        fn resolve_working_dir(&self, _spec: &PublishSpec) -> Option<PathBuf> {
            None
        }

        fn classify_source_input(&self, _relative: &Path) -> ProviderSourceInputKind {
            ProviderSourceInputKind::DeclaredNonSecret
        }

        fn infer_output_dir(&self, _spec: &PublishSpec) -> String {
            "dist".to_string()
        }

        fn configured_output_dir(&self, _spec: &PublishSpec) -> Option<String> {
            None
        }
    }

    fn template(id: &str) -> ProviderTemplate {
        ProviderTemplate {
            id: id.to_string(),
            name: format!("Template {id}"),
            description: format!("Description {id}"),
            parameters: serde_json::json!({ "key": id }),
        }
    }

    #[test]
    fn default_templates_is_empty_and_summary_strips_parameters() {
        let bare = stub_provider(Vec::new());
        assert!(bare.templates().is_empty());
        assert_eq!(bare.resolve_template("anything"), None);

        let summary = template("release").summary();
        assert_eq!(summary.id, "release");
        assert_eq!(summary.name, "Template release");
        assert_eq!(summary.description, "Description release");
    }

    #[test]
    fn resolve_template_finds_by_id_across_declared_templates() {
        let provider = stub_provider(vec![template("debug"), template("release")]);

        let found = provider
            .resolve_template("release")
            .expect("template found");
        assert_eq!(found.parameters, serde_json::json!({ "key": "release" }));
        assert_eq!(provider.resolve_template("missing"), None);
    }

    #[test]
    fn trait_defaults_keep_native_behavior_for_unextended_providers() {
        let provider = stub_provider(Vec::new());
        let spec = PublishSpec::default();

        assert_eq!(
            provider.command_prefix(&spec).expect("command prefix"),
            None
        );
        assert_eq!(provider.default_output(&spec, "/tmp/out"), None);
        assert_eq!(provider.resolve_implicit_output(&spec), None);
        assert!(provider.verify_build_output(Path::new("/anywhere")).is_ok());
        assert!(provider.artifact_filter().is_none());
        assert!(!provider.clears_stale_artifacts());
        assert_eq!(
            provider
                .resolve_runtime_program("dotnet", None)
                .expect("runtime program"),
            "dotnet"
        );
    }
}
