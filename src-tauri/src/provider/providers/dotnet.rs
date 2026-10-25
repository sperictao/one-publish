use crate::provider::registry::{read_parameter_string, BuiltInProvider, BuiltInProviderKind};
use crate::provider::{
    ProviderCapabilities, ProviderCatalogEntry, ProviderManifest, ProviderOutputLayout,
    ProviderProjectFileMatcher, ProviderProjectPathKind, ProviderProjectProfiles,
    ProviderRepositoryDiscovery, ProviderRepositoryMarker,
};
use crate::spec::PublishSpec;

const DOTNET_PROJECT_EXTENSIONS: &[&str] = &["csproj", "fsproj", "vbproj"];
const DOTNET_SOLUTION_EXTENSION: &str = "sln";
const DOTNET_NESTED_PROJECT_DIRECTORIES: &[&str] = &["src", "UI"];
const DOTNET_OUTPUT_PARAMETER: &str = "output";
/// MSBuild 属性求值出的构建实际输出目录（保留参数，不进入构建命令）：
/// pubxml 直接发布与缺 output 的历史重跑由它决定产物收集位置。
pub(crate) const DOTNET_PUBLISH_DIR_PARAMETER: &str = "publish_dir";
/// `dotnet publish` 只覆盖不删除：派生目录归 OnePublish 独占时缺省清空，
/// 已移除的依赖不会残留进下一次交付。
const DOTNET_CLEANUP_PARAMETER: &str = "delete_existing_files";

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
                    cleanup_parameter: Some(DOTNET_CLEANUP_PARAMETER.to_string()),
                }),
                project_profiles: Some(dotnet_project_profiles()),
                framework_tags: vec!["TargetFramework".to_string(), "TargetFrameworks".to_string()],
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
            "调试模式",
            "Debug",
            "linux-x64",
            true,
        ),
    ]
}

/// `dotnet msbuild <csproj> -getProperty:PublishDir` 携带的属性参数。
/// `dotnet publish` 不带 -c 默认 Release，而 MSBuild 属性求值默认 Debug，
/// Configuration 必须显式传入；用户 properties 排在固定映射之后，同名覆盖。
pub(crate) fn msbuild_property_args(spec: &PublishSpec) -> Vec<String> {
    let configuration = read_parameter_string(&spec.parameters, "configuration")
        .unwrap_or_else(|| "Release".to_string());
    let mut args = vec![format!("-p:Configuration={configuration}")];
    if let Some(runtime) = read_parameter_string(&spec.parameters, "runtime") {
        args.push(format!("-p:RuntimeIdentifier={runtime}"));
    }
    if let Some(framework) = read_parameter_string(&spec.parameters, "framework") {
        args.push(format!("-p:TargetFramework={framework}"));
    }
    if let Some(crate::spec::SpecValue::Map(properties)) = spec.parameters.get("properties") {
        for (key, value) in properties {
            if let crate::spec::SpecValue::String(value) = value {
                args.push(format!("-p:{key}={value}"));
            }
        }
    }
    args
}

/// 求值输出取最后一个非空行；Windows 分隔符统一为 `/`，去尾部斜杠。
/// 相对路径按项目文件目录解析（与 `infer_output_dir` 的基准一致）。
pub(crate) fn parse_msbuild_publish_dir(stdout: &str) -> Option<String> {
    let line = stdout.lines().map(str::trim).rfind(|line| !line.is_empty())?;
    let normalized = line.replace('\\', "/");
    let trimmed = normalized.trim_end_matches('/');
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// 向工具链求值构建实际写入的输出目录。求值失败（dotnet 缺失、SDK 不支持
/// -getProperty、项目不可求值）返回 None，调用方回落静态推断，不阻断发布。
pub(crate) fn evaluate_msbuild_publish_dir(spec: &PublishSpec) -> Option<String> {
    let dotnet = crate::environment::command_path("dotnet")?;
    let output = crate::process_utils::new_std_command(dotnet)
        .arg("msbuild")
        .arg(&spec.project_path)
        .arg("-getProperty:PublishDir")
        .args(msbuild_property_args(spec))
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    parse_msbuild_publish_dir(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spec::{SpecValue, SPEC_VERSION};
    use std::collections::BTreeMap;

    fn spec(parameters: &[(&str, SpecValue)]) -> PublishSpec {
        PublishSpec {
            version: SPEC_VERSION,
            provider_id: "dotnet".to_string(),
            project_path: "/tmp/App.csproj".to_string(),
            parameters: parameters
                .iter()
                .map(|(key, value)| (key.to_string(), value.clone()))
                .collect(),
        }
    }

    #[test]
    fn msbuild_properties_default_configuration_to_publish_semantics() {
        // dotnet publish 不带 -c 默认 Release，求值属性必须与之一致。
        assert_eq!(
            msbuild_property_args(&spec(&[])),
            vec!["-p:Configuration=Release".to_string()]
        );
    }

    #[test]
    fn msbuild_properties_map_command_parameters_to_msbuild_properties() {
        let properties = SpecValue::Map(BTreeMap::from([
            (
                "PublishProfile".to_string(),
                SpecValue::String("FolderProfile".to_string()),
            ),
            (
                "Configuration".to_string(),
                SpecValue::String("Debug".to_string()),
            ),
        ]));
        let spec = spec(&[
            ("configuration", SpecValue::String("Release".to_string())),
            ("runtime", SpecValue::String("osx-arm64".to_string())),
            ("framework", SpecValue::String("net8.0".to_string())),
            ("properties", properties),
        ]);

        assert_eq!(
            msbuild_property_args(&spec),
            vec![
                "-p:Configuration=Release".to_string(),
                "-p:RuntimeIdentifier=osx-arm64".to_string(),
                "-p:TargetFramework=net8.0".to_string(),
                // 用户 properties 在固定映射之后展开（Map 按键序），
                // 同名属性（如自定义 Configuration）覆盖固定值。
                "-p:Configuration=Debug".to_string(),
                "-p:PublishProfile=FolderProfile".to_string(),
            ]
        );
    }

    #[test]
    fn publish_dir_output_takes_the_last_non_empty_line_normalized() {
        assert_eq!(
            parse_msbuild_publish_dir("bin/Release/net8.0/publish/\n"),
            Some("bin/Release/net8.0/publish".to_string())
        );
        // SDK 默认布局的属性段可能带 Windows 分隔符，与正斜杠混用。
        assert_eq!(
            parse_msbuild_publish_dir("  \nbin\\Debug/net8.0/publish/\n\n"),
            Some("bin/Debug/net8.0/publish".to_string())
        );
        assert_eq!(parse_msbuild_publish_dir("   \n"), None);
        assert_eq!(parse_msbuild_publish_dir("/"), None);
    }

    /// 真实 SDK 求值回归：pubxml 声明的 PublishDir（新版 VS 默认形式，含 TFM 段）
    /// 与 SDK 默认布局（pubxml 未声明 PublishDir）。属性求值不需要 restore。
    /// CI 无 dotnet SDK 时跳过。
    #[test]
    fn msbuild_evaluation_resolves_the_real_publish_dir() {
        if crate::environment::command_path("dotnet").is_none() {
            return;
        }
        let project = tempfile::tempdir().expect("create project");
        let project_file = project.path().join("Min.csproj");
        std::fs::write(
            &project_file,
            "<Project Sdk=\"Microsoft.NET.Sdk\">\n  <PropertyGroup>\n    <TargetFramework>net8.0</TargetFramework>\n    <OutputType>Exe</OutputType>\n  </PropertyGroup>\n</Project>\n",
        )
        .expect("write project file");
        let profiles = project.path().join("Properties").join("PublishProfiles");
        std::fs::create_dir_all(&profiles).expect("create profiles directory");
        std::fs::write(
            profiles.join("FolderProfile.pubxml"),
            "<Project>\n  <PropertyGroup>\n    <PublishDir>bin/Release/net8.0/publish/</PublishDir>\n  </PropertyGroup>\n</Project>\n",
        )
        .expect("write profile");

        let mut spec = spec(&[]);
        spec.project_path = project_file.to_string_lossy().to_string();
        spec.parameters.insert(
            "properties".to_string(),
            SpecValue::Map(BTreeMap::from([(
                "PublishProfile".to_string(),
                SpecValue::String("FolderProfile".to_string()),
            )])),
        );
        assert_eq!(
            evaluate_msbuild_publish_dir(&spec).as_deref(),
            Some("bin/Release/net8.0/publish")
        );

        // pubxml 未声明 PublishDir：SDK 默认布局（含 TFM 段，分隔符可能混用）。
        spec.parameters.insert(
            "configuration".to_string(),
            SpecValue::String("Release".to_string()),
        );
        let mut default_layout_spec = spec.clone();
        default_layout_spec.parameters.remove("properties");
        let resolved = evaluate_msbuild_publish_dir(&default_layout_spec)
            .expect("evaluate SDK default layout");
        assert!(
            resolved
                .replace('\\', "/")
                .ends_with("bin/Release/net8.0/publish"),
            "unexpected default layout: {resolved}"
        );
    }
}
