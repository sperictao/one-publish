use super::types::{ReleaseAttempt, TauriReleaseBackup, TauriReleaseConfig, RELEASE_STATE_VERSION};
use crate::errors::AppError;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{OnceLock, RwLock};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TauriReleaseState {
    #[serde(default = "state_version")]
    version: u32,
    #[serde(default)]
    configs: BTreeMap<String, TauriReleaseConfig>,
    #[serde(default)]
    attempts: Vec<ReleaseAttempt>,
}

fn state_version() -> u32 {
    RELEASE_STATE_VERSION
}

fn state_path() -> PathBuf {
    let base = dirs::home_dir()
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."));
    base.join(".one-publish").join("tauri-release.json")
}

fn empty_state() -> TauriReleaseState {
    TauriReleaseState {
        version: RELEASE_STATE_VERSION,
        ..TauriReleaseState::default()
    }
}

fn preserve_invalid_state(path: &Path) -> Option<PathBuf> {
    if !path.exists() {
        return None;
    }
    let timestamp = chrono::Utc::now().format("%Y%m%d%H%M%S%3f");
    let backup_path = path.with_file_name(format!("tauri-release.invalid.{timestamp}.json"));
    match std::fs::rename(path, &backup_path) {
        Ok(()) => {
            if let Err(error) = crate::security::harden_private_path(&backup_path) {
                log::warn!(
                    "failed to harden preserved Tauri release state {}: {error}",
                    backup_path.display()
                );
            }
            Some(backup_path)
        }
        Err(error) => {
            log::error!(
                "failed to preserve invalid Tauri release state {}: {error}",
                path.display()
            );
            None
        }
    }
}

fn load_from_path(path: &Path) -> TauriReleaseState {
    let content = match std::fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return empty_state(),
        Err(error) => {
            log::error!(
                "failed to read Tauri release state at {}: {error}",
                path.display()
            );
            return empty_state();
        }
    };
    match serde_json::from_str::<TauriReleaseState>(&content) {
        Ok(state) if state.version <= RELEASE_STATE_VERSION => state,
        Ok(state) => {
            let backup = preserve_invalid_state(path);
            log::error!(
                "unsupported Tauri release state version {} at {}; preserved at {:?}",
                state.version,
                path.display(),
                backup
            );
            empty_state()
        }
        Err(error) => {
            let backup = preserve_invalid_state(path);
            log::error!(
                "failed to parse Tauri release state at {}: {}; preserved at {:?}",
                path.display(),
                error,
                backup
            );
            empty_state()
        }
    }
}

fn save_to_path(state: &TauriReleaseState, path: &Path) -> Result<(), AppError> {
    let content = serde_json::to_vec_pretty(state).map_err(|error| {
        AppError::store_with_code(
            format!("failed to serialize Tauri release state: {error}"),
            "tauri_release_state_serialize_failed",
        )
    })?;
    crate::store::write_json_atomically(path, &content).map_err(|error| {
        AppError::store_with_code(
            format!("failed to write Tauri release state: {error}"),
            "tauri_release_state_write_failed",
        )
    })
}

fn state_store() -> &'static RwLock<TauriReleaseState> {
    static STORE: OnceLock<RwLock<TauriReleaseState>> = OnceLock::new();
    STORE.get_or_init(|| RwLock::new(load_from_path(&state_path())))
}

fn with_state<T>(
    mutator: impl FnOnce(&mut TauriReleaseState) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let mut state = state_store().write().map_err(|error| {
        AppError::store_with_code(
            format!("Tauri release state lock poisoned: {error}"),
            "tauri_release_state_lock_failed",
        )
    })?;
    let previous = state.clone();
    let result = mutator(&mut state)?;
    if let Err(error) = save_to_path(&state, &state_path()) {
        *state = previous;
        return Err(error);
    }
    Ok(result)
}

fn read_lock_error(error: impl std::fmt::Display) -> AppError {
    AppError::store_with_code(
        format!("Tauri release state lock poisoned: {error}"),
        "tauri_release_state_lock_failed",
    )
}

pub(crate) fn get_config(repository_id: &str) -> Result<Option<TauriReleaseConfig>, AppError> {
    let state = state_store().read().map_err(read_lock_error)?;
    Ok(state.configs.get(repository_id).cloned())
}

pub(crate) fn save_config(
    repository_id: &str,
    config: TauriReleaseConfig,
) -> Result<TauriReleaseConfig, AppError> {
    with_state(|state| {
        state
            .configs
            .insert(repository_id.to_string(), config.clone());
        Ok(config)
    })
}

pub(crate) fn list_attempts(repository_id: Option<&str>) -> Result<Vec<ReleaseAttempt>, AppError> {
    let state = state_store().read().map_err(read_lock_error)?;
    Ok(state
        .attempts
        .iter()
        .filter(|attempt| {
            repository_id
                .map(|id| attempt.repository_id == id)
                .unwrap_or(true)
        })
        .cloned()
        .collect())
}

pub(crate) fn get_attempt(attempt_id: &str) -> Result<Option<ReleaseAttempt>, AppError> {
    let state = state_store().read().map_err(read_lock_error)?;
    Ok(state
        .attempts
        .iter()
        .find(|attempt| attempt.id == attempt_id)
        .cloned())
}

pub(crate) fn begin_attempt(attempt: ReleaseAttempt) -> Result<ReleaseAttempt, AppError> {
    with_state(|state| {
        // Legacy 仓库级互斥：仅服务旧 Tauri GitHub 发布路径，随 T19（#68）整体
        // 移除。新发布核心的并发唯一权威是 Publish Resource Lease（#62、ADR-0042）。
        let has_active = state.attempts.iter().any(|existing| {
            existing.repository_id == attempt.repository_id && !existing.stage.is_terminal()
        });
        if has_active {
            return Err(AppError::publish_with_code(
                "this repository already has an active GitHub release attempt",
                "tauri_release_attempt_active",
            ));
        }
        state.attempts.insert(0, attempt.clone());
        Ok(attempt)
    })
}

pub(crate) fn update_attempt(attempt: ReleaseAttempt) -> Result<ReleaseAttempt, AppError> {
    with_state(|state| {
        let existing = state
            .attempts
            .iter_mut()
            .find(|existing| existing.id == attempt.id)
            .ok_or_else(|| {
                AppError::publish_with_code(
                    format!("release attempt not found: {}", attempt.id),
                    "tauri_release_attempt_not_found",
                )
            })?;
        *existing = attempt.clone();
        Ok(attempt)
    })
}

pub(crate) fn export_backup(config: TauriReleaseConfig) -> TauriReleaseBackup {
    TauriReleaseBackup {
        version: RELEASE_STATE_VERSION,
        exported_at: chrono::Utc::now().to_rfc3339(),
        config,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_state_without_attempts_migrates_with_defaults() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let path = temp_dir.path().join("tauri-release.json");
        std::fs::write(&path, r#"{"version":1,"configs":{}}"#).expect("write state");

        let state = load_from_path(&path);

        assert_eq!(state.version, RELEASE_STATE_VERSION);
        assert!(state.attempts.is_empty());
    }

    #[test]
    fn backup_contains_secret_names_but_no_secret_values() {
        let config = TauriReleaseConfig {
            required_actions_secret_names: vec!["APPLE_CERTIFICATE".to_string()],
            ..TauriReleaseConfig::default()
        };
        let json = serde_json::to_string(&export_backup(config)).expect("serialize backup");

        assert!(json.contains("APPLE_CERTIFICATE"));
        assert!(!json.contains("privateKeyValue"));
        assert!(!json.contains("tokenValue"));
    }

    #[test]
    fn release_state_is_replaced_atomically() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let path = temp_dir.path().join("tauri-release.json");
        let first = TauriReleaseState {
            version: RELEASE_STATE_VERSION,
            ..TauriReleaseState::default()
        };
        let mut second = first.clone();
        second.configs.insert(
            "repo-1".to_string(),
            TauriReleaseConfig {
                app_name: "Demo".to_string(),
                ..TauriReleaseConfig::default()
            },
        );

        save_to_path(&first, &path).expect("save initial state");
        save_to_path(&second, &path).expect("replace state");

        let persisted = load_from_path(&path);
        assert_eq!(persisted.configs.len(), 1);
        let temp_files = std::fs::read_dir(temp_dir.path())
            .expect("read temp dir")
            .flatten()
            .filter(|entry| entry.file_name().to_string_lossy().contains(".tmp."))
            .count();
        assert_eq!(temp_files, 0);
    }

    #[test]
    fn invalid_release_state_is_preserved_before_reset() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let path = temp_dir.path().join("tauri-release.json");
        std::fs::write(&path, "not-json").expect("write invalid state");

        let state = load_from_path(&path);

        assert_eq!(state.version, RELEASE_STATE_VERSION);
        assert!(!path.exists());
        let preserved = std::fs::read_dir(temp_dir.path())
            .expect("read temp dir")
            .flatten()
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("tauri-release.invalid.")
            })
            .count();
        assert_eq!(preserved, 1);
    }
}
