use crate::provider::registry::{BuiltInProvider, BuiltInProviderKind};
use crate::provider::{
    ProviderCapabilities, ProviderCatalogEntry, ProviderManifest, ProviderProjectFileMatcher,
    ProviderProjectPathKind, ProviderRepositoryDiscovery, ProviderRepositoryMarker,
};
use crate::spec::{PublishSpec, SpecValue};
use std::path::{Path, PathBuf};

const CONFIG_FILE_NAMES: &[&str] = &["tauri.conf.json", "tauri.conf.json5", "Tauri.toml"];

fn config_matchers() -> Vec<ProviderProjectFileMatcher> {
    CONFIG_FILE_NAMES
        .iter()
        .map(|name| ProviderProjectFileMatcher::FileName((*name).to_string()))
        .collect()
}

impl BuiltInProvider {
    pub(crate) fn tauri() -> Self {
        Self::new(
            BuiltInProviderKind::Tauri,
            ProviderManifest {
                id: "tauri".to_string(),
                display_name: "tauri".to_string(),
                version: "1".to_string(),
            },
            ProviderCapabilities {
                requires_project_binding: true,
                project_path_kind: ProviderProjectPathKind::ProjectFile,
                supports_command_import: false,
            },
            ProviderCatalogEntry {
                id: "tauri".to_string(),
                display_name: "tauri".to_string(),
                version: "1".to_string(),
                label: "Tauri 2 (desktop)".to_string(),
                command_example: "pnpm tauri build".to_string(),
                environment_label: "Tauri".to_string(),
                environment_description: "Tauri CLI and platform build tools".to_string(),
                requires_project_binding: true,
                project_path_kind: ProviderProjectPathKind::ProjectFile,
                supports_command_import: false,
            },
            ProviderRepositoryDiscovery {
                provider_id: "tauri".to_string(),
                repository_markers: CONFIG_FILE_NAMES
                    .iter()
                    .map(|name| ProviderRepositoryMarker::RecursiveFileName((*name).to_string()))
                    .collect(),
                project_file_matchers: config_matchers(),
            },
            include_str!("../schemas/tauri.json"),
            "tauri.build",
            "tauri build",
        )
    }
}

pub(crate) fn create() -> BuiltInProvider {
    BuiltInProvider::tauri()
}

pub(crate) fn resolve_build_command(
    spec: &PublishSpec,
) -> Result<(String, Vec<String>), crate::errors::AppError> {
    let config_path = PathBuf::from(&spec.project_path);
    let app_root = publish_adapters::tauri::resolve_app_root(&config_path).ok_or_else(|| {
        crate::errors::AppError::provider_with_code(
            format!(
                "cannot resolve Tauri app root from {}",
                config_path.display()
            ),
            "tauri_app_root_missing",
        )
    })?;
    let driver = publish_adapters::tauri::resolve_build_driver(&app_root)
        .map_err(crate::errors::AppError::from_project_inspection)?;
    Ok((
        driver.name().to_string(),
        driver.build_command_args(&spec.project_path),
    ))
}

pub(crate) fn infer_bundle_dir(spec: &PublishSpec) -> String {
    let Some(app_root) = publish_adapters::tauri::resolve_app_root(Path::new(&spec.project_path))
    else {
        return String::new();
    };
    let mut target_dir = app_root.join("src-tauri").join("target");
    if let Some(SpecValue::String(target)) = spec.parameters.get("target") {
        if !target.trim().is_empty() {
            target_dir = target_dir.join(target.trim());
        }
    }
    target_dir
        .join("release")
        .join("bundle")
        .to_string_lossy()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spec::SPEC_VERSION;
    use std::collections::BTreeMap;
    use tempfile::TempDir;

    fn create_tauri_app(temp_dir: &TempDir) -> PathBuf {
        let tauri_dir = temp_dir.path().join("src-tauri");
        std::fs::create_dir_all(&tauri_dir).expect("create tauri dir");
        std::fs::write(tauri_dir.join("tauri.conf.json"), "{}").expect("write config");
        tauri_dir.join("tauri.conf.json")
    }

    #[test]
    fn build_command_uses_the_provider_resolved_driver() {
        let temp_dir = TempDir::new().expect("temp dir");
        let config_path = create_tauri_app(&temp_dir);
        std::fs::write(
            temp_dir.path().join("package.json"),
            r#"{"packageManager":"pnpm@10.10.0"}"#,
        )
        .expect("write package json");
        std::fs::write(
            temp_dir.path().join("pnpm-lock.yaml"),
            "lockfileVersion: '9.0'",
        )
        .expect("write lockfile");
        let spec = PublishSpec {
            version: SPEC_VERSION,
            provider_id: "tauri".to_string(),
            project_path: config_path.to_string_lossy().to_string(),
            parameters: BTreeMap::new(),
        };

        let (program, args) = resolve_build_command(&spec).expect("resolve command");

        assert_eq!(program, "pnpm");
        assert_eq!(args[..2], ["tauri".to_string(), "build".to_string()]);
    }

    #[test]
    fn conflicting_lockfiles_keep_the_stable_error_code() {
        let temp_dir = TempDir::new().expect("temp dir");
        let config_path = create_tauri_app(&temp_dir);
        std::fs::write(temp_dir.path().join("pnpm-lock.yaml"), "").expect("write pnpm lock");
        std::fs::write(temp_dir.path().join("yarn.lock"), "").expect("write yarn lock");
        let spec = PublishSpec {
            version: SPEC_VERSION,
            provider_id: "tauri".to_string(),
            project_path: config_path.to_string_lossy().to_string(),
            parameters: BTreeMap::new(),
        };

        let error = resolve_build_command(&spec).expect_err("driver conflict");
        assert_eq!(error.code.as_deref(), Some("tauri_build_driver_conflict"));
    }
}
