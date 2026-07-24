mod github;
mod local_build;
mod monitor;
mod preflight;
mod project;
mod storage;
mod takeover;
mod transaction;
mod types;
mod versioning;
mod workflow;

pub use types::*;

use crate::errors::AppError;
use std::collections::BTreeSet;
use std::path::{Component, Path};

/// 供通用 PublishRuntime 读取仓库的 Tauri 发布配置（例如 Release Gate）；
/// 配置缺失不是错误，由调用方决定语义。
pub(crate) fn stored_release_config(
    repository_id: &str,
) -> Result<Option<TauriReleaseConfig>, AppError> {
    storage::get_config(repository_id)
}

#[tauri::command]
pub fn inspect_tauri_repository(
    repository_path: String,
) -> Result<TauriRepositoryInspection, AppError> {
    project::inspect_repository(Path::new(&repository_path))
}

#[tauri::command]
pub fn prepare_tauri_github_release(
    repository_id: String,
    version: String,
) -> Result<TauriReleasePreflight, AppError> {
    let state = crate::store::get_state();
    let repository = state
        .repositories
        .iter()
        .find(|repository| repository.id == repository_id)
        .ok_or_else(|| {
            AppError::validation_with_code(
                format!("repository not found: {repository_id}"),
                "repository_not_found",
            )
        })?;
    let config = storage::get_config(&repository_id)?.ok_or_else(|| {
        AppError::config_with_code(
            format!("Tauri release config not found: {repository_id}"),
            "tauri_release_config_not_found",
        )
    })?;
    validate_release_config(&config)?;
    preflight::prepare(
        &repository_id,
        Path::new(&repository.path),
        &config,
        &version,
    )
}

#[tauri::command]
pub async fn start_tauri_github_release(
    request: StartTauriGithubReleaseRequest,
) -> Result<ReleaseAttempt, AppError> {
    let repository_id = request.repository_id.clone();
    let state = crate::store::get_state();
    let repository = state
        .repositories
        .iter()
        .find(|repository| repository.id == repository_id)
        .ok_or_else(|| {
            AppError::validation_with_code(
                format!("repository not found: {repository_id}"),
                "repository_not_found",
            )
        })?;
    let config = storage::get_config(&repository_id)?.ok_or_else(|| {
        AppError::config_with_code(
            format!("Tauri release config not found: {repository_id}"),
            "tauri_release_config_not_found",
        )
    })?;
    validate_release_config(&config)?;
    transaction::start(
        &repository_id,
        Path::new(&repository.path),
        &config,
        request,
    )
    .await
}

#[tauri::command]
pub async fn execute_tauri_local_build(
    app: tauri::AppHandle,
    repository_id: String,
) -> Result<TauriLocalBuildResult, AppError> {
    let state = crate::store::get_state();
    let repository = state
        .repositories
        .iter()
        .find(|repository| repository.id == repository_id)
        .ok_or_else(|| {
            AppError::validation_with_code(
                format!("repository not found: {repository_id}"),
                "repository_not_found",
            )
        })?;
    let config = storage::get_config(&repository_id)?.ok_or_else(|| {
        AppError::config_with_code(
            format!("Tauri release config not found: {repository_id}"),
            "tauri_release_config_not_found",
        )
    })?;
    validate_release_config(&config)?;
    local_build::execute(&app, Path::new(&repository.path), &config).await
}

#[tauri::command]
pub fn preview_tauri_managed_workflow(
    repository_id: String,
) -> Result<ManagedWorkflowPreview, AppError> {
    let state = crate::store::get_state();
    let repository = state
        .repositories
        .iter()
        .find(|repository| repository.id == repository_id)
        .ok_or_else(|| {
            AppError::validation_with_code(
                format!("repository not found: {repository_id}"),
                "repository_not_found",
            )
        })?;
    let config = storage::get_config(&repository_id)?.ok_or_else(|| {
        AppError::config_with_code(
            format!("Tauri release config not found: {repository_id}"),
            "tauri_release_config_not_found",
        )
    })?;
    validate_release_config(&config)?;
    workflow::preview(Path::new(&repository.path), &config)
}

#[tauri::command]
pub fn apply_tauri_workflow_takeover(
    repository_id: String,
    preview_id: String,
    confirmed: bool,
) -> Result<WorkflowTakeoverResult, AppError> {
    if !confirmed {
        return Err(AppError::validation_with_code(
            "workflow takeover requires explicit confirmation",
            "tauri_workflow_confirmation_required",
        ));
    }
    let state = crate::store::get_state();
    let repository = state
        .repositories
        .iter()
        .find(|repository| repository.id == repository_id)
        .ok_or_else(|| {
            AppError::validation_with_code(
                format!("repository not found: {repository_id}"),
                "repository_not_found",
            )
        })?;
    let config = storage::get_config(&repository_id)?.ok_or_else(|| {
        AppError::config_with_code(
            format!("Tauri release config not found: {repository_id}"),
            "tauri_release_config_not_found",
        )
    })?;
    validate_release_config(&config)?;
    let preview = workflow::preview(Path::new(&repository.path), &config)?;
    if preview.preview_id != preview_id {
        return Err(AppError::validation_with_code(
            "workflow files changed after preview; refresh the diff before takeover",
            "tauri_workflow_preview_stale",
        ));
    }
    takeover::apply(Path::new(&repository.path), &preview)
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

#[tauri::command]
pub fn get_tauri_release_config(
    repository_id: String,
) -> Result<Option<TauriReleaseConfig>, AppError> {
    storage::get_config(&repository_id)
}

#[tauri::command]
pub fn save_tauri_release_config(
    repository_id: String,
    config: TauriReleaseConfig,
) -> Result<TauriReleaseConfig, AppError> {
    validate_release_config(&config)?;
    if !crate::store::get_state()
        .repositories
        .iter()
        .any(|repository| repository.id == repository_id)
    {
        return Err(AppError::validation_with_code(
            format!("repository not found: {repository_id}"),
            "repository_not_found",
        ));
    }
    storage::save_config(&repository_id, config)
}

#[tauri::command]
pub fn list_tauri_release_attempts(
    repository_id: Option<String>,
) -> Result<Vec<ReleaseAttempt>, AppError> {
    storage::list_attempts(repository_id.as_deref())
}

#[tauri::command]
pub fn refresh_tauri_release_attempt(attempt_id: String) -> Result<ReleaseAttempt, AppError> {
    monitor::refresh(&attempt_id)
}

#[tauri::command]
pub fn cancel_tauri_release_attempt(attempt_id: String) -> Result<ReleaseAttempt, AppError> {
    monitor::cancel(&attempt_id)
}

#[tauri::command]
pub fn retry_tauri_release_attempt(attempt_id: String) -> Result<ReleaseAttempt, AppError> {
    monitor::retry(&attempt_id)
}

#[tauri::command]
pub fn export_tauri_release_config(
    repository_id: String,
    file_path: String,
) -> Result<String, AppError> {
    let config = storage::get_config(&repository_id)?.ok_or_else(|| {
        AppError::config_with_code(
            format!("Tauri release config not found: {repository_id}"),
            "tauri_release_config_not_found",
        )
    })?;
    let backup = storage::export_backup(config);
    let json = serde_json::to_string_pretty(&backup).map_err(|error| {
        AppError::config_with_code(
            format!("failed to serialize Tauri release config: {error}"),
            "tauri_release_export_serialize_failed",
        )
    })?;
    crate::security::write_private_text_file(Path::new(&file_path), &json).map_err(|error| {
        AppError::config_with_code(
            format!("failed to export Tauri release config: {error}"),
            "tauri_release_export_write_failed",
        )
    })?;
    Ok(file_path)
}

#[tauri::command]
pub fn import_tauri_release_config(
    repository_id: String,
    file_path: String,
) -> Result<TauriReleaseConfig, AppError> {
    if !crate::store::get_state()
        .repositories
        .iter()
        .any(|repository| repository.id == repository_id)
    {
        return Err(AppError::validation_with_code(
            format!("repository not found: {repository_id}"),
            "repository_not_found",
        ));
    }
    let content = std::fs::read_to_string(&file_path).map_err(|error| {
        AppError::config_with_code(
            format!("failed to read Tauri release config: {error}"),
            "tauri_release_import_read_failed",
        )
    })?;
    let backup: TauriReleaseBackup = serde_json::from_str(&content).map_err(|error| {
        AppError::config_with_code(
            format!("failed to parse Tauri release config: {error}"),
            "tauri_release_import_parse_failed",
        )
    })?;
    if backup.version > RELEASE_STATE_VERSION {
        return Err(AppError::config_with_code(
            format!(
                "unsupported Tauri release config version: {}",
                backup.version
            ),
            "tauri_release_import_version_unsupported",
        ));
    }
    validate_release_config(&backup.config)?;
    storage::save_config(&repository_id, backup.config)
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
}
