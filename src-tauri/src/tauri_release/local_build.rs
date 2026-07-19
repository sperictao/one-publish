use super::{project, PlatformSigningStatus, TauriLocalBuildResult, TauriReleaseConfig};
use crate::errors::AppError;
use crate::spec::{PublishSpec, SPEC_VERSION};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

fn git_output(repository_root: &Path, args: &[&str]) -> Result<String, AppError> {
    let output = crate::process_utils::new_std_command("git")
        .arg("-C")
        .arg(repository_root)
        .args(args)
        .output()
        .map_err(|error| {
            AppError::external_command_with_code(
                format!("failed to run git {}: {error}", args.join(" ")),
                "tauri_local_build_git_failed",
            )
        })?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(AppError::external_command_with_code(
        if stderr.is_empty() {
            format!("git {} failed with {}", args.join(" "), output.status)
        } else {
            stderr
        },
        "tauri_local_build_git_failed",
    ))
}

fn safe_segment(value: &str) -> String {
    let segment = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    let trimmed = segment.trim_matches('-');
    if trimmed.is_empty() {
        "tauri-app".to_string()
    } else {
        trimmed.to_string()
    }
}

fn platform_architecture() -> (String, String) {
    let platform = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    };
    let architecture = if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x64"
    };
    (platform.to_string(), architecture.to_string())
}

fn compile_patterns(config: &TauriReleaseConfig) -> Result<Vec<glob::Pattern>, AppError> {
    config
        .release_asset_patterns
        .iter()
        .map(|pattern| {
            glob::Pattern::new(pattern).map_err(|error| {
                AppError::validation_with_code(
                    format!("invalid release asset pattern '{pattern}': {error}"),
                    "tauri_release_asset_pattern_invalid",
                )
            })
        })
        .collect()
}

pub(crate) fn copy_delivery_assets(
    bundle_dir: &Path,
    delivery_dir: &Path,
    config: &TauriReleaseConfig,
) -> Result<Vec<String>, AppError> {
    let patterns = compile_patterns(config)?;
    let mut matches = Vec::new();
    for entry in walkdir::WalkDir::new(bundle_dir) {
        let entry = entry.map_err(|error| {
            AppError::artifact_with_code(
                format!("failed to inspect Tauri bundle output: {error}"),
                "tauri_local_build_bundle_scan_failed",
            )
        })?;
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy();
        if patterns.iter().any(|pattern| pattern.matches(&name)) {
            matches.push(entry.path().to_path_buf());
        }
    }
    matches.sort();
    if matches.is_empty() {
        return Err(AppError::artifact_with_code(
            format!(
                "no Tauri bundle files in {} matched the configured delivery allowlist",
                bundle_dir.display()
            ),
            "tauri_local_build_assets_missing",
        ));
    }

    let mut names = BTreeSet::new();
    for source in &matches {
        let name = source
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| {
                AppError::artifact_with_code(
                    format!(
                        "bundle asset has an invalid file name: {}",
                        source.display()
                    ),
                    "tauri_local_build_asset_name_invalid",
                )
            })?;
        if !names.insert(name.to_string()) {
            return Err(AppError::artifact_with_code(
                format!("multiple bundle assets have the same file name: {name}"),
                "tauri_local_build_asset_name_conflict",
            ));
        }
    }

    let delivery_parent = delivery_dir.parent().ok_or_else(|| {
        AppError::artifact_with_code(
            format!(
                "delivery directory has no parent: {}",
                delivery_dir.display()
            ),
            "tauri_local_build_delivery_invalid",
        )
    })?;
    std::fs::create_dir_all(delivery_parent).map_err(|error| {
        AppError::artifact_with_code(
            format!("failed to create {}: {error}", delivery_parent.display()),
            "tauri_local_build_delivery_create_failed",
        )
    })?;
    std::fs::create_dir(delivery_dir).map_err(|error| {
        AppError::artifact_with_code(
            format!(
                "failed to create unique delivery directory {}: {error}",
                delivery_dir.display()
            ),
            "tauri_local_build_delivery_create_failed",
        )
    })?;
    let mut copied = Vec::new();
    for source in matches {
        let destination = delivery_dir.join(source.file_name().expect("validated file name"));
        std::fs::copy(&source, &destination).map_err(|error| {
            AppError::artifact_with_code(
                format!(
                    "failed to copy {} to {}: {error}",
                    source.display(),
                    destination.display()
                ),
                "tauri_local_build_asset_copy_failed",
            )
        })?;
        copied.push(destination.to_string_lossy().to_string());
    }
    Ok(copied)
}

pub async fn execute(
    app: &tauri::AppHandle,
    repository_root: &Path,
    config: &TauriReleaseConfig,
) -> Result<TauriLocalBuildResult, AppError> {
    let inspection = project::inspect_repository(repository_root)?;
    let selected = inspection
        .apps
        .iter()
        .find(|app| app.config_path == config.app_config_path)
        .ok_or_else(|| {
            AppError::provider_with_code(
                format!("bound Tauri app not found: {}", config.app_config_path),
                "tauri_app_binding_missing",
            )
        })?;
    if selected.build_driver != config.build_driver {
        return Err(AppError::provider_with_code(
            format!(
                "configured build driver '{}' no longer matches detected driver '{}'",
                config.build_driver.name(),
                selected.build_driver.name()
            ),
            "tauri_build_driver_drift",
        ));
    }

    let git_head = git_output(repository_root, &["rev-parse", "HEAD"])?;
    let worktree_dirty = !git_output(repository_root, &["status", "--porcelain=v1"])?.is_empty();
    let config_path = repository_root.join(&config.app_config_path);
    let publish = crate::commands::execute_publish_spec(
        app,
        PublishSpec {
            version: SPEC_VERSION,
            provider_id: "tauri".to_string(),
            project_path: config_path.to_string_lossy().to_string(),
            parameters: BTreeMap::new(),
        },
    )
    .await?;
    if !publish.success {
        return Ok(TauriLocalBuildResult {
            delivery_dir: String::new(),
            assets: Vec::new(),
            git_head,
            worktree_dirty,
            reproducible: false,
            platform: std::env::consts::OS.to_string(),
            architecture: std::env::consts::ARCH.to_string(),
            platform_signing: PlatformSigningStatus::Unverified,
            distribution_ready: false,
            publish,
        });
    }

    let (platform, architecture) = platform_architecture();
    let delivery_dir = repository_root
        .join(&config.local_delivery_dir)
        .join(safe_segment(&config.app_name))
        .join(&selected.version_source.version)
        .join(format!("{platform}-{architecture}"))
        .join(chrono::Utc::now().format("%Y%m%d-%H%M%S-%9f").to_string());
    let assets = copy_delivery_assets(Path::new(&publish.output_dir), &delivery_dir, config)?;
    let platform_signing = if platform == "linux" {
        PlatformSigningStatus::NotRequired
    } else {
        PlatformSigningStatus::Unverified
    };
    let distribution_ready = platform_signing == PlatformSigningStatus::NotRequired;

    Ok(TauriLocalBuildResult {
        publish,
        delivery_dir: delivery_dir.to_string_lossy().to_string(),
        assets,
        git_head,
        worktree_dirty,
        reproducible: !worktree_dirty,
        platform,
        architecture,
        platform_signing,
        distribution_ready,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delivery_copy_uses_allowlist_and_never_overwrites_existing_run() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let bundle = temp_dir.path().join("bundle");
        let delivery = temp_dir.path().join("delivery");
        std::fs::create_dir_all(bundle.join("dmg")).expect("create bundle");
        std::fs::write(bundle.join("dmg/Demo.dmg"), "installer").expect("write installer");
        std::fs::write(bundle.join("debug.log"), "log").expect("write log");
        let config = TauriReleaseConfig {
            release_asset_patterns: vec!["*.dmg".to_string()],
            allow_unsigned_release: true,
            ..TauriReleaseConfig::default()
        };

        let copied = copy_delivery_assets(&bundle, &delivery, &config).expect("copy assets");

        assert_eq!(copied.len(), 1);
        assert!(delivery.join("Demo.dmg").is_file());
        assert!(!delivery.join("debug.log").exists());

        let error = copy_delivery_assets(&bundle, &delivery, &config)
            .expect_err("existing delivery run must not be overwritten");
        assert_eq!(
            error.code.as_deref(),
            Some("tauri_local_build_delivery_create_failed")
        );
    }
}
