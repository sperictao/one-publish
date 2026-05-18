use crate::provider::registry::{BuiltInProvider, BuiltInProviderKind};
use crate::provider::{
    ProviderCapabilities, ProviderCatalogEntry, ProviderManifest, ProviderProjectFileMatcher,
    ProviderProjectPathKind, ProviderRepositoryDiscovery, ProviderRepositoryMarker,
};

impl BuiltInProvider {
    pub(crate) fn cargo() -> Self {
        Self::new(
            BuiltInProviderKind::Cargo,
            ProviderManifest {
                id: "cargo".to_string(),
                display_name: "cargo".to_string(),
                version: "1".to_string(),
            },
            ProviderCapabilities {
                requires_project_binding: false,
                project_path_kind: ProviderProjectPathKind::RepositoryRoot,
                supports_command_import: true,
            },
            ProviderCatalogEntry {
                id: "cargo".to_string(),
                display_name: "cargo".to_string(),
                version: "1".to_string(),
                label: "Rust (cargo)".to_string(),
                command_example: "cargo build --release --target x86_64-unknown-linux-gnu"
                    .to_string(),
                environment_label: "Rust".to_string(),
                environment_description: "cargo".to_string(),
                requires_project_binding: false,
                project_path_kind: ProviderProjectPathKind::RepositoryRoot,
                supports_command_import: true,
            },
            ProviderRepositoryDiscovery {
                provider_id: "cargo".to_string(),
                repository_markers: vec![ProviderRepositoryMarker::FileName(
                    "Cargo.toml".to_string(),
                )],
                project_file_matchers: vec![ProviderProjectFileMatcher::FileName(
                    "Cargo.toml".to_string(),
                )],
            },
            include_str!("../schemas/cargo.json"),
            "cargo.build",
            "cargo build",
        )
    }
}

/// 供 `providers::all()` 调用的统一入口。
pub(crate) fn create() -> BuiltInProvider {
    BuiltInProvider::cargo()
}
