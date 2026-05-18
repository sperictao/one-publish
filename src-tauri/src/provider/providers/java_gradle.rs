use crate::provider::registry::{BuiltInProvider, BuiltInProviderKind};
use crate::provider::{
    ProviderCapabilities, ProviderCatalogEntry, ProviderManifest, ProviderProjectFileMatcher,
    ProviderProjectPathKind, ProviderRepositoryDiscovery, ProviderRepositoryMarker,
};

const GRADLE_PROJECT_FILES: &[&str] = &[
    "build.gradle",
    "build.gradle.kts",
    "settings.gradle",
    "settings.gradle.kts",
    "gradlew",
    "gradlew.bat",
];

fn gradle_project_file_matchers() -> Vec<ProviderProjectFileMatcher> {
    GRADLE_PROJECT_FILES
        .iter()
        .map(|name| ProviderProjectFileMatcher::FileName((*name).to_string()))
        .collect()
}

impl BuiltInProvider {
    pub(crate) fn java_gradle() -> Self {
        Self::new(
            BuiltInProviderKind::JavaGradle,
            ProviderManifest {
                id: "java".to_string(),
                display_name: "java".to_string(),
                version: "1".to_string(),
            },
            ProviderCapabilities {
                requires_project_binding: false,
                project_path_kind: ProviderProjectPathKind::RepositoryRoot,
                supports_command_import: true,
            },
            ProviderCatalogEntry {
                id: "java".to_string(),
                display_name: "java".to_string(),
                version: "1".to_string(),
                label: "Java (Gradle)".to_string(),
                command_example: "./gradlew build --info".to_string(),
                environment_label: "Java (Gradle)".to_string(),
                environment_description: "gradle / java runtime".to_string(),
                requires_project_binding: false,
                project_path_kind: ProviderProjectPathKind::RepositoryRoot,
                supports_command_import: true,
            },
            ProviderRepositoryDiscovery {
                provider_id: "java".to_string(),
                repository_markers: gradle_project_file_matchers()
                    .into_iter()
                    .map(|matcher| match matcher {
                        ProviderProjectFileMatcher::FileName(name) => {
                            ProviderRepositoryMarker::FileName(name)
                        }
                        ProviderProjectFileMatcher::Extension(extension) => {
                            ProviderRepositoryMarker::Extension(extension)
                        }
                    })
                    .collect(),
                project_file_matchers: gradle_project_file_matchers(),
            },
            include_str!("../schemas/java.json"),
            "gradle.build",
            "./gradlew build",
        )
    }
}

/// 供 `providers::all()` 调用的统一入口。
pub(crate) fn create() -> BuiltInProvider {
    BuiltInProvider::java_gradle()
}
