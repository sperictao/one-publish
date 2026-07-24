use super::{
    TauriAppInspection, TauriRepositoryInspection, TauriVersionSource, TauriVersionSourceKind,
    VersionMirror, VersionMirrorKind,
};
use crate::errors::AppError;
use publish_adapters::TauriProjectProvider;
use std::path::Path;

/// Tauri 项目识别、版本语义和构建驱动解析由内置 Tauri Project Provider 负责（T05）；
/// 这里只把 Provider 的检查结果映射为桌面壳的合同类型。
pub fn inspect_repository(repository_path: &Path) -> Result<TauriRepositoryInspection, AppError> {
    let provider = TauriProjectProvider::new();
    let inspections = provider
        .inspect_repository(repository_path)
        .map_err(AppError::from_project_inspection)?;
    if inspections.is_empty() {
        return Err(AppError::provider_with_code(
            format!(
                "no Tauri 2 desktop app found in {}",
                repository_path.display()
            ),
            "tauri_app_not_found",
        ));
    }

    Ok(TauriRepositoryInspection {
        repository_path: repository_path
            .canonicalize()
            .unwrap_or_else(|_| repository_path.to_path_buf())
            .to_string_lossy()
            .to_string(),
        apps: inspections.into_iter().map(app_inspection).collect(),
    })
}

fn app_inspection(inspection: publish_adapters::TauriProjectInspection) -> TauriAppInspection {
    TauriAppInspection {
        config_path: inspection.config_path,
        app_root: inspection.app_root,
        app_name: inspection.app_name,
        build_driver: inspection.build_driver.into(),
        version_source: TauriVersionSource {
            kind: match inspection.version_source.kind {
                publish_adapters::TauriVersionSourceKind::TauriConfig => {
                    TauriVersionSourceKind::TauriConfig
                }
                publish_adapters::TauriVersionSourceKind::ReferencedPackageJson => {
                    TauriVersionSourceKind::ReferencedPackageJson
                }
                publish_adapters::TauriVersionSourceKind::CargoToml => {
                    TauriVersionSourceKind::CargoToml
                }
            },
            path: inspection.version_source.path,
            selector: inspection.version_source.selector,
            version: inspection.version_source.version,
        },
        updater_enabled: inspection.updater_enabled,
        suggested_version_mirrors: inspection
            .suggested_version_mirrors
            .into_iter()
            .map(|mirror| VersionMirror {
                path: mirror.path,
                kind: match mirror.kind {
                    publish_adapters::VersionMirrorKind::JsonPointer => {
                        VersionMirrorKind::JsonPointer
                    }
                    publish_adapters::VersionMirrorKind::TomlKey => VersionMirrorKind::TomlKey,
                },
                selector: mirror.selector,
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inspection_maps_the_provider_result_onto_the_shell_contract() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let tauri_dir = temp_dir.path().join("src-tauri");
        std::fs::create_dir_all(&tauri_dir).expect("create tauri dir");
        std::fs::write(
            tauri_dir.join("tauri.conf.json"),
            r#"{"productName":"Demo","version":"1.2.3"}"#,
        )
        .expect("write config");
        std::fs::write(
            temp_dir.path().join("package.json"),
            r#"{"packageManager":"pnpm@10.0.0","version":"1.2.3"}"#,
        )
        .expect("write package json");
        std::fs::write(temp_dir.path().join("pnpm-lock.yaml"), "").expect("write lock");
        std::fs::write(
            tauri_dir.join("Cargo.toml"),
            "[package]\nname = \"demo\"\nversion = \"1.2.3\"\n",
        )
        .expect("write cargo toml");

        let inspection = inspect_repository(temp_dir.path()).expect("inspect");
        let app = &inspection.apps[0];
        assert_eq!(app.config_path, "src-tauri/tauri.conf.json");
        assert_eq!(app.version_source.kind, TauriVersionSourceKind::TauriConfig);
        assert_eq!(app.version_source.version, "1.2.3");
        assert_eq!(app.build_driver, super::super::TauriBuildDriver::Pnpm);
        assert_eq!(app.suggested_version_mirrors.len(), 2);
    }

    #[test]
    fn repository_without_a_tauri_app_keeps_the_stable_error_code() {
        let temp_dir = tempfile::tempdir().expect("temp dir");

        let error = inspect_repository(temp_dir.path()).expect_err("no tauri app");
        assert_eq!(error.code.as_deref(), Some("tauri_app_not_found"));
    }
}
