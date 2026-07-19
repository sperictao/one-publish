use super::{
    TauriAppInspection, TauriRepositoryInspection, TauriVersionSource, TauriVersionSourceKind,
    VersionMirror, VersionMirrorKind,
};
use crate::errors::AppError;
use serde_json::Value;
use std::path::{Path, PathBuf};

fn project_error(message: impl Into<String>, code: impl Into<String>) -> AppError {
    AppError::provider_with_code(message, code)
}

fn relative_path(root: &Path, path: &Path) -> Result<String, AppError> {
    let normalized_path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    normalized_path
        .strip_prefix(root)
        .map(|value| value.to_string_lossy().replace('\\', "/"))
        .map_err(|_| {
            project_error(
                format!(
                    "{} is outside repository {}",
                    path.display(),
                    root.display()
                ),
                "tauri_app_outside_repository",
            )
        })
}

fn read_json_config(path: &Path) -> Result<Value, AppError> {
    let content = std::fs::read_to_string(path).map_err(|error| {
        project_error(
            format!("failed to read {}: {error}", path.display()),
            "tauri_config_read_failed",
        )
    })?;
    serde_json::from_str(&content)
        .or_else(|_| json5::from_str(&content))
        .map_err(|error| {
            project_error(
                format!("failed to parse {}: {error}", path.display()),
                "tauri_config_parse_failed",
            )
        })
}

fn read_toml_config(path: &Path) -> Result<toml_edit::DocumentMut, AppError> {
    let content = std::fs::read_to_string(path).map_err(|error| {
        project_error(
            format!("failed to read {}: {error}", path.display()),
            "tauri_config_read_failed",
        )
    })?;
    content.parse::<toml_edit::DocumentMut>().map_err(|error| {
        project_error(
            format!("failed to parse {}: {error}", path.display()),
            "tauri_config_parse_failed",
        )
    })
}

fn read_package_version(path: &Path) -> Result<String, AppError> {
    let content = std::fs::read_to_string(path).map_err(|error| {
        project_error(
            format!("failed to read version file {}: {error}", path.display()),
            "tauri_version_file_read_failed",
        )
    })?;
    let value: Value = serde_json::from_str(&content).map_err(|error| {
        project_error(
            format!("failed to parse version file {}: {error}", path.display()),
            "tauri_version_file_parse_failed",
        )
    })?;
    value
        .get("version")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| {
            project_error(
                format!("missing version in {}", path.display()),
                "tauri_version_missing",
            )
        })
}

fn read_cargo_package(path: &Path) -> Result<(String, Option<String>), AppError> {
    let content = std::fs::read_to_string(path).map_err(|error| {
        project_error(
            format!("failed to read {}: {error}", path.display()),
            "tauri_cargo_toml_read_failed",
        )
    })?;
    let document = content.parse::<toml_edit::DocumentMut>().map_err(|error| {
        project_error(
            format!("failed to parse {}: {error}", path.display()),
            "tauri_cargo_toml_parse_failed",
        )
    })?;
    let version = document["package"]["version"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| {
            project_error(
                format!("missing package.version in {}", path.display()),
                "tauri_version_missing",
            )
        })?;
    let name = document["package"]["name"].as_str().map(str::to_string);
    Ok((version, name))
}

fn ensure_stable_semver(version: &str, path: &Path) -> Result<String, AppError> {
    let parsed = semver::Version::parse(version).map_err(|error| {
        project_error(
            format!("invalid version '{version}' in {}: {error}", path.display()),
            "tauri_version_invalid",
        )
    })?;
    if !parsed.pre.is_empty() || !parsed.build.is_empty() {
        return Err(project_error(
            format!("only stable major.minor.patch versions are supported: {version}"),
            "tauri_version_not_stable",
        ));
    }
    Ok(parsed.to_string())
}

fn resolve_version_source(
    repository_root: &Path,
    config_path: &Path,
    configured_version: Option<&str>,
) -> Result<TauriVersionSource, AppError> {
    let config_dir = config_path.parent().ok_or_else(|| {
        project_error(
            "Tauri config has no parent directory",
            "tauri_app_root_missing",
        )
    })?;

    if let Some(raw) = configured_version
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if semver::Version::parse(raw).is_ok() {
            return Ok(TauriVersionSource {
                kind: TauriVersionSourceKind::TauriConfig,
                path: relative_path(repository_root, config_path)?,
                selector: "version".to_string(),
                version: ensure_stable_semver(raw, config_path)?,
            });
        }

        let referenced = config_dir.join(raw);
        let version = ensure_stable_semver(&read_package_version(&referenced)?, &referenced)?;
        return Ok(TauriVersionSource {
            kind: TauriVersionSourceKind::ReferencedPackageJson,
            path: relative_path(repository_root, &referenced)?,
            selector: "/version".to_string(),
            version,
        });
    }

    let cargo_toml = config_dir.join("Cargo.toml");
    let (version, _) = read_cargo_package(&cargo_toml)?;
    Ok(TauriVersionSource {
        kind: TauriVersionSourceKind::CargoToml,
        path: relative_path(repository_root, &cargo_toml)?,
        selector: "package.version".to_string(),
        version: ensure_stable_semver(&version, &cargo_toml)?,
    })
}

fn suggested_mirrors(
    repository_root: &Path,
    config_path: &Path,
    version_source: &TauriVersionSource,
) -> Vec<VersionMirror> {
    let mut mirrors = Vec::new();
    let package_json = crate::provider::providers::tauri::resolve_app_root(config_path)
        .map(|root| root.join("package.json"));
    if let Some(package_json) = package_json.filter(|path| path.is_file()) {
        if let Ok(version) = read_package_version(&package_json) {
            if version == version_source.version
                && relative_path(repository_root, &package_json)
                    .ok()
                    .as_deref()
                    != Some(version_source.path.as_str())
            {
                if let Ok(path) = relative_path(repository_root, &package_json) {
                    mirrors.push(VersionMirror {
                        path,
                        kind: VersionMirrorKind::JsonPointer,
                        selector: "/version".to_string(),
                    });
                }
            }
        }
    }

    let cargo_toml = config_path.parent().map(|parent| parent.join("Cargo.toml"));
    if let Some(cargo_toml) = cargo_toml.filter(|path| path.is_file()) {
        if let Ok((version, _)) = read_cargo_package(&cargo_toml) {
            if version == version_source.version
                && relative_path(repository_root, &cargo_toml).ok().as_deref()
                    != Some(version_source.path.as_str())
            {
                if let Ok(path) = relative_path(repository_root, &cargo_toml) {
                    mirrors.push(VersionMirror {
                        path,
                        kind: VersionMirrorKind::TomlKey,
                        selector: "package.version".to_string(),
                    });
                }
            }
        }
    }
    mirrors
}

fn inspect_app(repository_root: &Path, config_path: &Path) -> Result<TauriAppInspection, AppError> {
    let app_root =
        crate::provider::providers::tauri::resolve_app_root(config_path).ok_or_else(|| {
            project_error(
                format!("cannot resolve app root from {}", config_path.display()),
                "tauri_app_root_missing",
            )
        })?;
    let is_toml = config_path.file_name().and_then(|name| name.to_str()) == Some("Tauri.toml");
    let (configured_version, product_name, updater_enabled) = if is_toml {
        let config = read_toml_config(config_path)?;
        (
            config["version"].as_str().map(str::to_string),
            config["productName"].as_str().map(str::to_string),
            config["bundle"]["createUpdaterArtifacts"]
                .as_bool()
                .unwrap_or(false),
        )
    } else {
        let config = read_json_config(config_path)?;
        (
            config
                .get("version")
                .and_then(Value::as_str)
                .map(str::to_string),
            config
                .get("productName")
                .and_then(Value::as_str)
                .map(str::to_string),
            config
                .pointer("/bundle/createUpdaterArtifacts")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        )
    };
    let version_source =
        resolve_version_source(repository_root, config_path, configured_version.as_deref())?;
    let app_name = product_name
        .filter(|name| !name.trim().is_empty())
        .or_else(|| {
            app_root
                .file_name()
                .and_then(|name| name.to_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "tauri-app".to_string());

    Ok(TauriAppInspection {
        config_path: relative_path(repository_root, config_path)?,
        app_root: relative_path(repository_root, &app_root)?,
        app_name,
        build_driver: crate::provider::providers::tauri::resolve_build_driver(&app_root)?,
        updater_enabled,
        suggested_version_mirrors: suggested_mirrors(repository_root, config_path, &version_source),
        version_source,
    })
}

pub fn inspect_repository(repository_path: &Path) -> Result<TauriRepositoryInspection, AppError> {
    let repository_root = repository_path.canonicalize().map_err(|error| {
        project_error(
            format!(
                "failed to resolve repository {}: {error}",
                repository_path.display()
            ),
            "tauri_repository_path_invalid",
        )
    })?;
    let candidates = crate::commands::scan_project_candidates_from_path(&repository_root)?;
    let mut apps = candidates
        .project_files
        .iter()
        .map(PathBuf::from)
        .filter(|path| {
            matches!(
                path.file_name().and_then(|name| name.to_str()),
                Some("tauri.conf.json" | "tauri.conf.json5" | "Tauri.toml")
            )
        })
        .map(|path| inspect_app(&repository_root, &path))
        .collect::<Result<Vec<_>, _>>()?;
    apps.sort_by(|left, right| left.config_path.cmp(&right.config_path));
    if apps.is_empty() {
        return Err(project_error(
            format!(
                "no Tauri 2 desktop app found in {}",
                repository_root.display()
            ),
            "tauri_app_not_found",
        ));
    }

    Ok(TauriRepositoryInspection {
        repository_path: repository_root.to_string_lossy().to_string(),
        apps,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_version_is_authoritative_and_matching_files_are_suggested_as_mirrors() {
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
        assert_eq!(app.version_source.kind, TauriVersionSourceKind::TauriConfig);
        assert_eq!(app.version_source.version, "1.2.3");
        assert_eq!(app.suggested_version_mirrors.len(), 2);
    }

    #[test]
    fn config_can_reference_package_json_as_authoritative_version() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let tauri_dir = temp_dir.path().join("src-tauri");
        std::fs::create_dir_all(&tauri_dir).expect("create tauri dir");
        std::fs::write(
            tauri_dir.join("tauri.conf.json5"),
            "{ productName: 'Demo', version: '../package.json' }",
        )
        .expect("write config");
        std::fs::write(
            temp_dir.path().join("package.json"),
            r#"{"packageManager":"npm@10.0.0","version":"2.3.4"}"#,
        )
        .expect("write package json");

        let inspection = inspect_repository(temp_dir.path()).expect("inspect");
        assert_eq!(
            inspection.apps[0].version_source.kind,
            TauriVersionSourceKind::ReferencedPackageJson
        );
        assert_eq!(inspection.apps[0].version_source.path, "package.json");
    }
}
