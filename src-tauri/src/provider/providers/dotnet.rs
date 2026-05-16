use crate::provider::registry::{BuiltInProvider, BuiltInProviderKind};
use crate::provider::{
    ProviderCapabilities, ProviderCatalogEntry, ProviderManifest,
    ProviderProjectFileMatcher, ProviderProjectPathKind, ProviderRepositoryDiscovery,
    ProviderRepositoryMarker,
};

const DOTNET_PROJECT_EXTENSIONS: &[&str] = &["csproj", "fsproj", "vbproj"];
const DOTNET_SOLUTION_EXTENSION: &str = "sln";
const DOTNET_NESTED_PROJECT_DIRECTORIES: &[&str] = &["src", "UI"];

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
            },
            ProviderRepositoryDiscovery {
                provider_id: "dotnet".to_string(),
                repository_markers: dotnet_repository_markers(),
                project_file_matchers: dotnet_project_file_matchers(),
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
