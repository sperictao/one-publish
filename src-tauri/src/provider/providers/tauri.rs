use crate::provider::registry::{BuiltInProvider, BuiltInProviderKind};
use crate::provider::{
    ProviderCapabilities, ProviderCatalogEntry, ProviderManifest, ProviderProjectFileMatcher,
    ProviderProjectPathKind, ProviderRepositoryDiscovery, ProviderRepositoryMarker,
};
use crate::spec::{PublishSpec, SpecValue};
use crate::tauri_release::TauriBuildDriver;
use serde_json::Value;
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

pub(crate) fn resolve_app_root(config_path: &Path) -> Option<PathBuf> {
    let config_dir = if config_path.is_dir() {
        config_path.to_path_buf()
    } else {
        config_path.parent()?.to_path_buf()
    };

    if config_dir.file_name().and_then(|name| name.to_str()) == Some("src-tauri") {
        config_dir.parent().map(Path::to_path_buf)
    } else {
        Some(config_dir)
    }
}

fn package_manager_from_package_json(
    app_root: &Path,
) -> Result<Option<TauriBuildDriver>, crate::errors::AppError> {
    let package_json_path = app_root.join("package.json");
    if !package_json_path.is_file() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&package_json_path).map_err(|error| {
        crate::errors::AppError::provider_with_code(
            format!("failed to read {}: {error}", package_json_path.display()),
            "tauri_package_json_read_failed",
        )
    })?;
    let value: Value = serde_json::from_str(&content).map_err(|error| {
        crate::errors::AppError::provider_with_code(
            format!("failed to parse {}: {error}", package_json_path.display()),
            "tauri_package_json_invalid",
        )
    })?;
    let Some(raw) = value.get("packageManager").and_then(Value::as_str) else {
        return Ok(None);
    };
    let name = raw.split('@').next().unwrap_or(raw);
    let driver = match name {
        "pnpm" => TauriBuildDriver::Pnpm,
        "npm" => TauriBuildDriver::Npm,
        "yarn" => TauriBuildDriver::Yarn,
        "bun" => TauriBuildDriver::Bun,
        unsupported => {
            return Err(crate::errors::AppError::provider_with_code(
                format!(
                    "unsupported packageManager '{unsupported}' in {}",
                    package_json_path.display()
                ),
                "tauri_package_manager_unsupported",
            ));
        }
    };
    Ok(Some(driver))
}

fn lockfile_drivers(app_root: &Path) -> Vec<TauriBuildDriver> {
    [
        ("pnpm-lock.yaml", TauriBuildDriver::Pnpm),
        ("package-lock.json", TauriBuildDriver::Npm),
        ("npm-shrinkwrap.json", TauriBuildDriver::Npm),
        ("yarn.lock", TauriBuildDriver::Yarn),
        ("bun.lock", TauriBuildDriver::Bun),
        ("bun.lockb", TauriBuildDriver::Bun),
    ]
    .into_iter()
    .filter_map(|(name, driver)| app_root.join(name).is_file().then_some(driver))
    .fold(Vec::new(), |mut drivers, driver| {
        if !drivers.contains(&driver) {
            drivers.push(driver);
        }
        drivers
    })
}

pub(crate) fn resolve_build_driver(
    app_root: &Path,
) -> Result<TauriBuildDriver, crate::errors::AppError> {
    let declared = package_manager_from_package_json(app_root)?;
    let lockfiles = lockfile_drivers(app_root);

    if lockfiles.len() > 1 {
        return Err(crate::errors::AppError::provider_with_code(
            format!(
                "conflicting Tauri package-manager lockfiles: {}",
                lockfiles
                    .iter()
                    .map(|driver| driver.name())
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            "tauri_build_driver_conflict",
        ));
    }

    if let (Some(declared), Some(lockfile)) = (declared, lockfiles.first().copied()) {
        if declared != lockfile {
            return Err(crate::errors::AppError::provider_with_code(
                format!(
                    "packageManager '{}' conflicts with '{}' lockfile",
                    declared.name(),
                    lockfile.name()
                ),
                "tauri_build_driver_conflict",
            ));
        }
        return Ok(declared);
    }

    if let Some(driver) = declared.or_else(|| lockfiles.first().copied()) {
        return Ok(driver);
    }

    if app_root.join("src-tauri").join("Cargo.toml").is_file()
        || app_root.join("Cargo.toml").is_file()
    {
        return Ok(TauriBuildDriver::Cargo);
    }

    Err(crate::errors::AppError::provider_with_code(
        format!(
            "cannot determine a Tauri build driver for {}",
            app_root.display()
        ),
        "tauri_build_driver_missing",
    ))
}

pub(crate) fn resolve_build_command(
    spec: &PublishSpec,
) -> Result<(String, Vec<String>), crate::errors::AppError> {
    let config_path = PathBuf::from(&spec.project_path);
    let app_root = resolve_app_root(&config_path).ok_or_else(|| {
        crate::errors::AppError::provider_with_code(
            format!(
                "cannot resolve Tauri app root from {}",
                config_path.display()
            ),
            "tauri_app_root_missing",
        )
    })?;
    let (program, args) = resolve_build_driver(&app_root)?.command();
    let mut args = args
        .iter()
        .map(|arg| (*arg).to_string())
        .collect::<Vec<_>>();
    args.push("--config".to_string());
    args.push(spec.project_path.clone());
    Ok((program.to_string(), args))
}

pub(crate) fn infer_bundle_dir(spec: &PublishSpec) -> String {
    let Some(app_root) = resolve_app_root(Path::new(&spec.project_path)) else {
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
    use tempfile::TempDir;

    fn create_tauri_app(temp_dir: &TempDir) -> PathBuf {
        let tauri_dir = temp_dir.path().join("src-tauri");
        std::fs::create_dir_all(&tauri_dir).expect("create tauri dir");
        std::fs::write(tauri_dir.join("tauri.conf.json"), "{}").expect("write config");
        tauri_dir.join("tauri.conf.json")
    }

    #[test]
    fn package_manager_and_lockfile_select_pnpm() {
        let temp_dir = TempDir::new().expect("temp dir");
        create_tauri_app(&temp_dir);
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

        assert_eq!(
            resolve_build_driver(temp_dir.path()).expect("resolve driver"),
            TauriBuildDriver::Pnpm
        );
    }

    #[test]
    fn conflicting_lockfiles_are_rejected_without_fallback() {
        let temp_dir = TempDir::new().expect("temp dir");
        create_tauri_app(&temp_dir);
        std::fs::write(temp_dir.path().join("pnpm-lock.yaml"), "").expect("write pnpm lock");
        std::fs::write(temp_dir.path().join("yarn.lock"), "").expect("write yarn lock");

        let error = resolve_build_driver(temp_dir.path()).expect_err("driver conflict");
        assert_eq!(error.code.as_deref(), Some("tauri_build_driver_conflict"));
    }
}
