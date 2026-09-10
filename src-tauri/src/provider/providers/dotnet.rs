use crate::provider::registry::{BuiltInProvider, BuiltInProviderKind};
use crate::provider::{
    ProviderCapabilities, ProviderCatalogEntry, ProviderManifest, ProviderOutputLayout,
    ProviderProjectFileMatcher, ProviderProjectPathKind, ProviderProjectProfiles,
    ProviderRepositoryDiscovery, ProviderRepositoryMarker,
};

const DOTNET_PROJECT_EXTENSIONS: &[&str] = &["csproj", "fsproj", "vbproj"];
const DOTNET_SOLUTION_EXTENSION: &str = "sln";
const DOTNET_NESTED_PROJECT_DIRECTORIES: &[&str] = &["src", "UI"];
const DOTNET_OUTPUT_PARAMETER: &str = "output";

/// 项目发布配置（.pubxml）声明：目录、扩展名与引用参数固化位置。
pub(crate) fn dotnet_project_profiles() -> ProviderProjectProfiles {
    ProviderProjectProfiles {
        directory: "Properties/PublishProfiles".to_string(),
        extension: "pubxml".to_string(),
        reference_parameter: "properties".to_string(),
        reference_property: "PublishProfile".to_string(),
    }
}

/// dotnet 默认输出目录布局：{default_output_dir}/{项目名}/{configuration}。
pub(crate) const DOTNET_OUTPUT_LAYOUT: &str =
    "{default_output_dir}/{project_stem}/{param:configuration}";

fn dotnet_project_file_matchers() -> Vec<ProviderProjectFileMatcher> {
    DOTNET_PROJECT_EXTENSIONS
        .iter()
        .copied()
        .chain(std::iter::once(DOTNET_SOLUTION_EXTENSION))
        .map(|extension| ProviderProjectFileMatcher::Extension(extension.to_string()))
        .collect()
}

fn dotnet_repository_markers() -> Vec<ProviderRepositoryMarker> {
    let mut markers = vec![ProviderRepositoryMarker::Extension(
        DOTNET_SOLUTION_EXTENSION.to_string(),
    )];

    for extension in DOTNET_PROJECT_EXTENSIONS {
        markers.push(ProviderRepositoryMarker::Extension(
            (*extension).to_string(),
        ));
        for directory in DOTNET_NESTED_PROJECT_DIRECTORIES {
            markers.push(ProviderRepositoryMarker::NestedExtension {
                directory: (*directory).to_string(),
                extension: (*extension).to_string(),
            });
        }
    }

    markers
}

impl BuiltInProvider {
    pub(crate) fn dotnet() -> Self {
        Self::new(
            BuiltInProviderKind::Dotnet,
            ProviderManifest {
                id: "dotnet".to_string(),
                display_name: "dotnet".to_string(),
                version: "1".to_string(),
            },
            ProviderCapabilities {
                requires_project_binding: true,
                project_path_kind: ProviderProjectPathKind::ProjectFile,
                supports_command_import: true,
                appends_project_path: true,
                output_layout: Some(ProviderOutputLayout {
                    parameter: DOTNET_OUTPUT_PARAMETER.to_string(),
                    template: DOTNET_OUTPUT_LAYOUT.to_string(),
                }),
                project_profiles: Some(dotnet_project_profiles()),
                framework_tags: vec![
                    "TargetFramework".to_string(),
                    "TargetFrameworks".to_string(),
                ],
            },
            ProviderCatalogEntry {
                id: "dotnet".to_string(),
                display_name: "dotnet".to_string(),
                version: "1".to_string(),
                label: ".NET (dotnet)".to_string(),
                command_example:
                    "dotnet publish MyProject.csproj -c Release -r win-x64 --self-contained"
                        .to_string(),
                environment_label: ".NET".to_string(),
                environment_description: "dotnet SDK".to_string(),
                requires_project_binding: true,
                project_path_kind: ProviderProjectPathKind::ProjectFile,
                supports_command_import: true,
                supports_project_profiles: true,
                templates: dotnet_templates().iter().map(|t| t.summary()).collect(),
            },
            ProviderRepositoryDiscovery {
                provider_id: "dotnet".to_string(),
                repository_markers: dotnet_repository_markers(),
                project_file_matchers: dotnet_project_file_matchers(),
                solution_file_extensions: vec![DOTNET_SOLUTION_EXTENSION.to_string()],
                owns_project_recommendation: true,
            },
            include_str!("../schemas/dotnet.json"),
            "dotnet.publish",
            "dotnet publish",
        )
    }
}

/// 供 `providers::all()` 调用的统一入口。
pub(crate) fn create() -> BuiltInProvider {
    BuiltInProvider::dotnet()
}

use crate::provider::ProviderTemplate;

/// Provider 内置模板（原前端 dotnetPresets 迁入后端）：模板参数是完整参数，
/// 显式保留 false 语义；runtime 为空表示不限定 RID，不写入参数。
pub(crate) fn dotnet_templates() -> Vec<ProviderTemplate> {
    fn template(
        id: &str,
        name: &str,
        description: &str,
        configuration: &str,
        runtime: &str,
        self_contained: bool,
    ) -> ProviderTemplate {
        let mut parameters = serde_json::json!({
            "configuration": configuration,
            "self_contained": self_contained,
        });
        if !runtime.is_empty() {
            parameters["runtime"] = serde_json::Value::String(runtime.to_string());
        }
        ProviderTemplate {
            id: id.to_string(),
            name: name.to_string(),
            description: description.to_string(),
            parameters,
        }
    }

    vec![
        template(
            "release-fd",
            "Release - 框架依赖",
            "推荐用于开发/测试",
            "Release",
            "",
            false,
        ),
        template(
            "release-win-x64",
            "Release - Windows x64",
            "自包含部署",
            "Release",
            "win-x64",
            true,
        ),
        template(
            "release-osx-arm64",
            "Release - macOS ARM64",
            "Apple Silicon",
            "Release",
            "osx-arm64",
            true,
        ),
        template(
            "release-osx-x64",
            "Release - macOS x64",
            "Intel Mac",
            "Release",
            "osx-x64",
            true,
        ),
        template(
            "release-linux-x64",
            "Release - Linux x64",
            "自包含部署",
            "Release",
            "linux-x64",
            true,
        ),
        template(
            "debug-fd",
            "Debug - 框架依赖",
            "调试模式",
            "Debug",
            "",
            false,
        ),
        template(
            "debug-win-x64",
            "Debug - Windows x64",
            "自包含部署",
            "Debug",
            "win-x64",
            true,
        ),
        template(
            "debug-osx-arm64",
            "Debug - macOS ARM64",
            "Apple Silicon",
            "Debug",
            "osx-arm64",
            true,
        ),
        template(
            "debug-osx-x64",
            "Debug - macOS x64",
            "Intel Mac",
            "Debug",
            "osx-x64",
            true,
        ),
        template(
            "debug-linux-x64",
            "Debug - Linux x64",
            "自包含部署",
            "Debug",
            "linux-x64",
            true,
        ),
    ]
}
