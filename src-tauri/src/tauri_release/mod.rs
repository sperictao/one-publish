//! Tauri 发布设置与托管 workflow 渲染。
//!
//! 发布设置的唯一权威是通用 Configuration Catalog 中所选修订的
//! `releaseSettings` 保留参数键（ADR-0058）；本模块只保留其类型、
//! 校验与 GitHub Actions 执行后端复用的 workflow 渲染。

mod types;

pub use types::*;

use crate::errors::AppError;
use std::collections::BTreeSet;
use std::path::{Component, Path};

/// 通用配置修订中承载 Provider 发布设置的保留参数键；它不属于命令参数，
/// 不参与命令渲染或参数匹配。当前唯一内容形状是 Tauri 的 `TauriReleaseConfig`。
pub const RELEASE_SETTINGS_PARAMETER: &str = "releaseSettings";

/// 从通用配置修订参数中提取 Tauri 发布设置；键缺失或显式 null（已清除）
/// 不是错误，形状损坏（无法反序列化）必须显式失败而不是静默忽略。
pub(crate) fn release_settings_from_parameters(
    parameters: &serde_json::Value,
) -> Result<Option<TauriReleaseConfig>, AppError> {
    let Some(settings) = parameters
        .get(RELEASE_SETTINGS_PARAMETER)
        .filter(|settings| !settings.is_null())
    else {
        return Ok(None);
    };
    serde_json::from_value(settings.clone())
        .map(Some)
        .map_err(|error| {
            AppError::config_with_code(
                format!("tauri_release_settings_invalid: {error}"),
                "tauri_release_settings_invalid",
            )
        })
}

fn validate_relative_path(path: &str, field: &str) -> Result<(), AppError> {
    let value = Path::new(path);
    if path.trim().is_empty()
        || path.chars().any(char::is_control)
        || value.is_absolute()
        || value
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(AppError::validation_with_code(
            format!("{field} must be a repository-relative path"),
            "tauri_release_path_invalid",
        ));
    }
    Ok(())
}

fn validate_secret_name(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(), Some(first) if first.is_ascii_uppercase() || first == '_')
        && chars.all(|character| {
            character.is_ascii_uppercase() || character.is_ascii_digit() || character == '_'
        })
        && name.len() <= 128
}

fn validate_environment_name(name: &str) -> bool {
    validate_secret_name(name)
}

pub fn validate_release_config(config: &TauriReleaseConfig) -> Result<(), AppError> {
    validate_relative_path(&config.app_config_path, "appConfigPath")?;
    validate_relative_path(&config.local_delivery_dir, "localDeliveryDir")?;
    for mirror in &config.version_mirrors {
        validate_relative_path(&mirror.path, "versionMirrors.path")?;
    }
    if config.managed_workflow_version != MANAGED_WORKFLOW_VERSION {
        return Err(AppError::validation_with_code(
            format!(
                "unsupported managed workflow version {}; expected {}",
                config.managed_workflow_version, MANAGED_WORKFLOW_VERSION
            ),
            "tauri_release_workflow_version_unsupported",
        ));
    }
    if config.enabled_targets.is_empty() {
        return Err(AppError::validation_with_code(
            "at least one desktop target is required",
            "tauri_release_targets_empty",
        ));
    }
    if config.enabled_targets.iter().collect::<BTreeSet<_>>().len() != config.enabled_targets.len()
    {
        return Err(AppError::validation_with_code(
            "desktop release targets cannot contain duplicates",
            "tauri_release_targets_duplicate",
        ));
    }
    if config.release_asset_patterns.is_empty() {
        return Err(AppError::validation_with_code(
            "at least one release asset pattern is required",
            "tauri_release_assets_empty",
        ));
    }
    if config.release_asset_patterns.iter().any(|pattern| {
        pattern.trim().is_empty()
            || pattern.contains('/')
            || pattern.contains('\\')
            || pattern.contains("${{")
    }) {
        return Err(AppError::validation_with_code(
            "release asset patterns must be non-empty file-name patterns without paths or workflow expressions",
            "tauri_release_asset_pattern_invalid",
        ));
    }
    if !config
        .tag_prefix
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-'))
    {
        return Err(AppError::validation_with_code(
            "tag prefix may contain only ASCII letters, digits, dots, underscores and hyphens",
            "tauri_release_tag_prefix_invalid",
        ));
    }
    if config
        .required_actions_secret_names
        .iter()
        .any(|name| !validate_secret_name(name))
        || config
            .updater
            .private_key_secret_name
            .as_deref()
            .is_some_and(|name| !validate_secret_name(name))
    {
        return Err(AppError::validation_with_code(
            "GitHub Actions secrets must be stored as uppercase secret names only",
            "tauri_release_secret_reference_invalid",
        ));
    }
    if config
        .actions_secret_environment
        .iter()
        .any(|(environment, secret)| {
            !validate_environment_name(environment) || !validate_secret_name(secret)
        })
    {
        return Err(AppError::validation_with_code(
            "secret environment mappings must use uppercase environment and secret names",
            "tauri_release_secret_environment_invalid",
        ));
    }
    let needs_platform_signing = config.enabled_targets.iter().any(|target| {
        matches!(
            target,
            TauriDesktopTarget::WindowsX64
                | TauriDesktopTarget::MacosX64
                | TauriDesktopTarget::MacosArm64
                | TauriDesktopTarget::MacosUniversal
        )
    });
    if needs_platform_signing
        && !config.allow_unsigned_release
        && config.actions_secret_environment.is_empty()
    {
        return Err(AppError::validation_with_code(
            "platform signing environment-to-secret mappings are required unless unsigned releases are explicitly allowed",
            "tauri_release_platform_signing_required",
        ));
    }
    if config.updater.enabled
        && (config
            .updater
            .endpoint
            .as_deref()
            .unwrap_or("")
            .trim()
            .is_empty()
            || config
                .updater
                .public_key
                .as_deref()
                .unwrap_or("")
                .trim()
                .is_empty()
            || config
                .updater
                .private_key_secret_name
                .as_deref()
                .unwrap_or("")
                .trim()
                .is_empty())
    {
        return Err(AppError::validation_with_code(
            "updater endpoint, public key and private-key secret name are required",
            "tauri_release_updater_incomplete",
        ));
    }
    if config.updater.enabled {
        let endpoint = config.updater.endpoint.as_deref().unwrap_or("");
        let public_key = config.updater.public_key.as_deref().unwrap_or("");
        if !endpoint.starts_with("https://")
            || endpoint.contains(char::is_whitespace)
            || endpoint.contains("${{")
            || public_key.contains("${{")
        {
            return Err(AppError::validation_with_code(
                "updater endpoint must be HTTPS and updater fields cannot contain workflow expressions",
                "tauri_release_updater_invalid",
            ));
        }
    }
    for gate in &config.release_gates {
        if gate.program.trim().is_empty() {
            return Err(AppError::validation_with_code(
                "release gate program cannot be empty",
                "tauri_release_gate_invalid",
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_values_cannot_be_smuggled_as_secret_references() {
        let config = TauriReleaseConfig {
            required_actions_secret_names: vec!["ghp_actualTokenValue".to_string()],
            ..TauriReleaseConfig::default()
        };

        let error = validate_release_config(&config).expect_err("reject secret value");
        assert_eq!(
            error.code.as_deref(),
            Some("tauri_release_secret_reference_invalid")
        );
    }

    #[test]
    fn updater_is_a_hard_gate_when_enabled() {
        let config = TauriReleaseConfig {
            updater: TauriUpdaterSettings {
                enabled: true,
                ..TauriUpdaterSettings::default()
            },
            allow_unsigned_release: true,
            ..TauriReleaseConfig::default()
        };

        let error = validate_release_config(&config).expect_err("updater should be complete");
        assert_eq!(
            error.code.as_deref(),
            Some("tauri_release_updater_incomplete")
        );
    }

    #[test]
    fn signed_desktop_targets_require_environment_secret_mappings() {
        let config = TauriReleaseConfig {
            required_actions_secret_names: vec!["APPLE_CERTIFICATE".to_string()],
            ..TauriReleaseConfig::default()
        };

        let error = validate_release_config(&config).expect_err("mapping is required");

        assert_eq!(
            error.code.as_deref(),
            Some("tauri_release_platform_signing_required")
        );
    }

    #[test]
    fn release_config_rejects_duplicate_targets_and_paths_outside_repository() {
        let duplicate_targets = TauriReleaseConfig {
            enabled_targets: vec![TauriDesktopTarget::LinuxX64, TauriDesktopTarget::LinuxX64],
            allow_unsigned_release: true,
            ..TauriReleaseConfig::default()
        };
        let error = validate_release_config(&duplicate_targets).expect_err("duplicate target");
        assert_eq!(
            error.code.as_deref(),
            Some("tauri_release_targets_duplicate")
        );

        let outside_mirror = TauriReleaseConfig {
            version_mirrors: vec![VersionMirror {
                path: "../package.json".to_string(),
                kind: VersionMirrorKind::JsonPointer,
                selector: "/version".to_string(),
            }],
            allow_unsigned_release: true,
            ..TauriReleaseConfig::default()
        };
        let error = validate_release_config(&outside_mirror).expect_err("outside mirror");
        assert_eq!(error.code.as_deref(), Some("tauri_release_path_invalid"));
    }

    #[test]
    fn an_explicit_null_reads_as_cleared_release_settings() {
        let cleared = serde_json::json!({ RELEASE_SETTINGS_PARAMETER: serde_json::Value::Null });
        assert!(release_settings_from_parameters(&cleared)
            .expect("null clears the settings instead of failing")
            .is_none());
    }

    #[test]
    fn release_settings_extraction_distinguishes_missing_from_corrupt() {
        let missing = serde_json::json!({ "target": "x86_64-unknown-linux-gnu" });
        assert!(release_settings_from_parameters(&missing)
            .expect("missing settings are not an error")
            .is_none());

        let valid = serde_json::json!({
            RELEASE_SETTINGS_PARAMETER:
                serde_json::to_value(TauriReleaseConfig::default()).expect("serialize settings")
        });
        let extracted = release_settings_from_parameters(&valid)
            .expect("valid settings parse")
            .expect("settings are present");
        assert_eq!(extracted, TauriReleaseConfig::default());

        let corrupt = serde_json::json!({
            RELEASE_SETTINGS_PARAMETER: { "enabledTargets": "not-an-array" }
        });
        let error = release_settings_from_parameters(&corrupt).expect_err("corrupt settings fail");
        assert_eq!(
            error.code.as_deref(),
            Some("tauri_release_settings_invalid")
        );
    }
}
