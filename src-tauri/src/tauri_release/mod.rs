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

/// 写入关口（ADR-0060）：参数显式携带、且与修订已有值不同的发布设置必须先
/// 通过与自动化绑定相同的校验；原样回传或继承的值不重复校验，存量设置不阻断
/// 普通编辑；显式 null 表示清除，无需校验。
pub(crate) fn validate_supplied_release_settings(
    parameters: &serde_json::Value,
    current: Option<&serde_json::Value>,
) -> Result<(), AppError> {
    if parameters.get(RELEASE_SETTINGS_PARAMETER) == current {
        return Ok(());
    }
    match release_settings_from_parameters(parameters)? {
        Some(settings) => validate_release_config(&settings),
        None => Ok(()),
    }
}

/// 修订没有可读发布设置时的表单初值（ADR-0060）：以默认值为底，按项目绑定的
/// Tauri 配置入口探测应用名、构建驱动、Updater 与版本镜像建议。探测失败只
/// 退回默认值；未签名发布保持未授权，由使用者显式决定（ADR-0006）。
pub(crate) fn suggested_release_settings(
    repository_path: &Path,
    config_path: Option<&str>,
) -> TauriReleaseConfig {
    let mut settings = TauriReleaseConfig::default();
    let Some(config_path) = config_path else {
        return settings;
    };
    settings.app_config_path = config_path.to_string();
    let inspection = match publish_adapters::tauri::TauriProjectProvider::new()
        .inspect(repository_path, config_path)
    {
        Ok(inspection) => inspection,
        Err(error) => {
            log::warn!("探测 Tauri 项目失败，发布设置初值退回默认值: {error}");
            return settings;
        }
    };
    settings.app_name = inspection.app_name;
    settings.build_driver = match inspection.build_driver {
        publish_adapters::tauri::TauriBuildDriver::Pnpm => TauriBuildDriver::Pnpm,
        publish_adapters::tauri::TauriBuildDriver::Npm => TauriBuildDriver::Npm,
        publish_adapters::tauri::TauriBuildDriver::Yarn => TauriBuildDriver::Yarn,
        publish_adapters::tauri::TauriBuildDriver::Bun => TauriBuildDriver::Bun,
        publish_adapters::tauri::TauriBuildDriver::Cargo => TauriBuildDriver::Cargo,
    };
    settings.updater.enabled = inspection.updater_enabled;
    settings.version_mirrors = inspection
        .suggested_version_mirrors
        .into_iter()
        .map(|mirror| VersionMirror {
            path: mirror.path,
            kind: match mirror.kind {
                publish_adapters::tauri::VersionMirrorKind::JsonPointer => {
                    VersionMirrorKind::JsonPointer
                }
                publish_adapters::tauri::VersionMirrorKind::TomlKey => VersionMirrorKind::TomlKey,
            },
            selector: mirror.selector,
        })
        .collect();
    settings
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
        )
        .with_details(field));
    }
    Ok(())
}

pub(crate) fn validate_secret_name(name: &str) -> bool {
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
    fn default_settings_leave_the_unsigned_release_decision_to_the_user() {
        // ADR-0006：默认目标含需要平台签名的桌面平台，默认值不替使用者授权
        // 未签名发布，因此不能原样通过绑定校验。
        let error = validate_release_config(&TauriReleaseConfig::default())
            .expect_err("defaults need a signing decision");
        assert_eq!(
            error.code.as_deref(),
            Some("tauri_release_platform_signing_required")
        );

        let linux_only = TauriReleaseConfig {
            enabled_targets: vec![TauriDesktopTarget::LinuxX64],
            ..TauriReleaseConfig::default()
        };
        validate_release_config(&linux_only).expect("linux needs no platform signing");
    }

    #[test]
    fn invalid_paths_name_the_offending_field() {
        let config = TauriReleaseConfig {
            local_delivery_dir: "/abs/dist".to_string(),
            allow_unsigned_release: true,
            ..TauriReleaseConfig::default()
        };

        let error = validate_release_config(&config).expect_err("absolute path");
        assert_eq!(error.code.as_deref(), Some("tauri_release_path_invalid"));
        assert_eq!(error.details.as_deref(), Some("localDeliveryDir"));
    }

    #[test]
    fn stripped_secret_names_still_parse_as_empty() {
        // 配置备份剥离 Secret 名称后，设置仍须可读（ADR-0060）。
        let mut stripped =
            serde_json::to_value(TauriReleaseConfig::default()).expect("serialize settings");
        let object = stripped.as_object_mut().expect("settings object");
        object.remove("requiredActionsSecretNames");
        object.remove("actionsSecretEnvironment");
        object["updater"]
            .as_object_mut()
            .expect("updater object")
            .remove("privateKeySecretName");

        let parsed = release_settings_from_parameters(
            &serde_json::json!({ RELEASE_SETTINGS_PARAMETER: stripped }),
        )
        .expect("stripped settings parse")
        .expect("settings are present");
        assert!(parsed.required_actions_secret_names.is_empty());
        assert!(parsed.actions_secret_environment.is_empty());
        assert_eq!(parsed.updater.private_key_secret_name, None);
    }

    #[test]
    fn supplied_release_settings_are_validated_only_when_they_change() {
        let invalid = serde_json::to_value(TauriReleaseConfig::default()).expect("serialize");
        let valid = serde_json::to_value(TauriReleaseConfig {
            allow_unsigned_release: true,
            ..TauriReleaseConfig::default()
        })
        .expect("serialize");
        let with = |settings: &serde_json::Value| serde_json::json!({ "target": "x", RELEASE_SETTINGS_PARAMETER: settings });

        // 原样回传的存量设置不阻断普通编辑。
        validate_supplied_release_settings(&with(&invalid), Some(&invalid))
            .expect("unchanged settings pass through");
        // 省略（继承）与显式 null（清除）都无需校验。
        validate_supplied_release_settings(&serde_json::json!({}), Some(&invalid))
            .expect("omitted settings inherit");
        validate_supplied_release_settings(&with(&serde_json::Value::Null), Some(&invalid))
            .expect("null clears");

        let error = validate_supplied_release_settings(&with(&invalid), Some(&valid))
            .expect_err("changed settings are validated");
        assert_eq!(
            error.code.as_deref(),
            Some("tauri_release_platform_signing_required")
        );
        let error = validate_supplied_release_settings(&with(&invalid), None)
            .expect_err("new settings are validated");
        assert_eq!(
            error.code.as_deref(),
            Some("tauri_release_platform_signing_required")
        );
        validate_supplied_release_settings(&with(&valid), None).expect("valid settings pass");

        let error = validate_supplied_release_settings(
            &with(&serde_json::json!({ "tagPrefix": "v" })),
            None,
        )
        .expect_err("malformed settings fail");
        assert_eq!(
            error.code.as_deref(),
            Some("tauri_release_settings_invalid")
        );
    }

    #[test]
    fn suggestions_inspect_the_bound_project_and_fall_back_to_defaults() {
        let repository = tempfile::TempDir::new().expect("temp repository");
        let write = |path: &str, content: &str| {
            let path = repository.path().join(path);
            std::fs::create_dir_all(path.parent().expect("parent")).expect("create dir");
            std::fs::write(path, content).expect("write file");
        };
        write(
            "src-tauri/tauri.conf.json",
            r#"{"productName":"Demo","version":"1.2.3","bundle":{"createUpdaterArtifacts":true}}"#,
        );
        write("package.json", r#"{"version":"1.2.3"}"#);
        write("yarn.lock", "");

        let suggested =
            suggested_release_settings(repository.path(), Some("src-tauri/tauri.conf.json"));
        assert_eq!(suggested.app_config_path, "src-tauri/tauri.conf.json");
        assert_eq!(suggested.app_name, "Demo");
        assert_eq!(suggested.build_driver, TauriBuildDriver::Yarn);
        assert!(suggested.updater.enabled);
        assert!(suggested.version_mirrors.contains(&VersionMirror {
            path: "package.json".to_string(),
            kind: VersionMirrorKind::JsonPointer,
            selector: "/version".to_string(),
        }));
        // 探测只填事实，不替使用者授权未签名发布。
        assert!(!suggested.allow_unsigned_release);

        assert_eq!(
            suggested_release_settings(repository.path(), None),
            TauriReleaseConfig::default()
        );
        let missing = suggested_release_settings(repository.path(), Some("app/tauri.conf.json"));
        assert_eq!(missing.app_config_path, "app/tauri.conf.json");
        assert_eq!(missing.build_driver, TauriBuildDriver::Pnpm);
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
