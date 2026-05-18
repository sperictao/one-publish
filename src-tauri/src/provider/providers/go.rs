use crate::provider::registry::{BuiltInProvider, BuiltInProviderKind};
use crate::provider::{
    ProviderCapabilities, ProviderCatalogEntry, ProviderManifest, ProviderProjectFileMatcher,
    ProviderProjectPathKind, ProviderRepositoryDiscovery, ProviderRepositoryMarker,
};

impl BuiltInProvider {
    pub(crate) fn go() -> Self {
        Self::new(
            BuiltInProviderKind::Go,
            ProviderManifest {
                id: "go".to_string(),
                display_name: "go".to_string(),
                version: "1".to_string(),
            },
            ProviderCapabilities {
                requires_project_binding: false,
                project_path_kind: ProviderProjectPathKind::RepositoryRoot,
                supports_command_import: true,
            },
            ProviderCatalogEntry {
                id: "go".to_string(),
                display_name: "go".to_string(),
                version: "1".to_string(),
                label: "Go".to_string(),
                command_example: "go build -o ./bin/app ./cmd/app".to_string(),
                environment_label: "Go".to_string(),
                environment_description: "go".to_string(),
                requires_project_binding: false,
                project_path_kind: ProviderProjectPathKind::RepositoryRoot,
                supports_command_import: true,
            },
            ProviderRepositoryDiscovery {
                provider_id: "go".to_string(),
                repository_markers: vec![ProviderRepositoryMarker::FileName("go.mod".to_string())],
                project_file_matchers: vec![ProviderProjectFileMatcher::FileName(
                    "go.mod".to_string(),
                )],
            },
            include_str!("../schemas/go.json"),
            "go.build",
            "go build",
        )
    }
}

/// 供 `providers::all()` 调用的统一入口。
pub(crate) fn create() -> BuiltInProvider {
    BuiltInProvider::go()
}
