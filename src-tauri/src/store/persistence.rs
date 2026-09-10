use super::migration::{
    migrate_legacy_state, migrate_legacy_tauri_release_settings, sanitize_stored_state,
    LegacyStoredAppState, StoredAppState, StoredAppStateV3, CURRENT_STORE_SCHEMA_VERSION,
};
use super::types::AppState;
use std::fs::{self};
use std::io::Write;
use std::path::{Path, PathBuf};

pub(crate) fn get_config_path() -> PathBuf {
    if let Some(home_dir) = dirs::home_dir() {
        return home_dir.join(".one-publish").join("config.json");
    }

    if let Ok(current_dir) = std::env::current_dir() {
        log::warn!("无法获取用户主目录，回退到当前目录保存配置");
        return current_dir.join(".one-publish").join("config.json");
    }

    log::warn!("无法获取用户主目录和当前目录，回退到相对路径保存配置");
    PathBuf::from(".one-publish").join("config.json")
}

fn build_temp_config_path(path: &Path) -> PathBuf {
    let timestamp = chrono::Utc::now().format("%Y%m%d%H%M%S%3f");
    let pid = std::process::id();
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("config.json");
    path.with_file_name(format!("{file_name}.tmp.{pid}.{timestamp}"))
}

fn build_corrupt_backup_path(path: &Path) -> PathBuf {
    let timestamp = chrono::Utc::now().format("%Y%m%d%H%M%S%3f");
    path.with_file_name(format!("config.corrupt.{timestamp}.json"))
}

fn backup_corrupt_file(path: &Path) -> Option<PathBuf> {
    if !path.exists() {
        return None;
    }

    let backup_path = build_corrupt_backup_path(path);
    match fs::rename(path, &backup_path) {
        Ok(()) => {
            let _ = crate::security::harden_private_path(&backup_path);
            Some(backup_path)
        }
        Err(rename_error) => {
            log::warn!(
                "重命名损坏配置文件失败，尝试复制备份。路径: {}, 错误: {}",
                path.display(),
                rename_error
            );
            match fs::copy(path, &backup_path) {
                Ok(_) => {
                    let _ = fs::remove_file(path);
                    let _ = crate::security::harden_private_path(&backup_path);
                    Some(backup_path)
                }
                Err(copy_error) => {
                    log::error!(
                        "备份损坏配置文件失败。路径: {}, 错误: {}",
                        path.display(),
                        copy_error
                    );
                    None
                }
            }
        }
    }
}

fn future_schema_version(value: &serde_json::Value) -> Option<u64> {
    value
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        .filter(|version| *version > u64::from(CURRENT_STORE_SCHEMA_VERSION))
}

fn future_schema_fallback(path: &Path, schema_version: u64) -> AppState {
    let state = AppState {
        startup_notice: Some(format!(
            "检测到由更高版本 One Publish 写入的配置（schemaVersion={schema_version}，当前仅支持到 {CURRENT_STORE_SCHEMA_VERSION}）。为避免数据丢失，本版本不会读取或覆盖该配置文件，请升级 One Publish 后再修改设置。"
        )),
        ..Default::default()
    };
    log::warn!(
        "配置文件 schemaVersion={} 高于当前支持的 {}，已按只读保护处理。路径: {}",
        schema_version,
        CURRENT_STORE_SCHEMA_VERSION,
        path.display()
    );
    state
}

fn ensure_writable_store_schema(path: &Path) -> Result<(), crate::errors::AppError> {
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        // 现有行为允许 save_to_path 修复已由 load 路径隔离的损坏文件；这里仅
        // 对能够明确识别为未来 schema 的文件加写保护，不扩大错误面。
        Err(_) => return Ok(()),
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) else {
        return Ok(());
    };
    let Some(schema_version) = future_schema_version(&value) else {
        return Ok(());
    };

    Err(crate::errors::AppError::store_with_code(
        format!(
            "配置文件 schemaVersion {schema_version} 高于当前支持的 {CURRENT_STORE_SCHEMA_VERSION}，已拒绝覆盖以避免数据丢失"
        ),
        "store_schema_version_newer",
    ))
}

/// 正常加载成功后的收尾：执行旧 Tauri 发布状态的一次性迁移，仅在持久化
/// 成功后才移除旧文件，保证迁移不会丢失尚未写盘的数据。
/// `migration_backup`：首次写入新 schema 前保留原始文件备份（§4.2）。
fn finalize_loaded_state(
    mut state: AppState,
    path: &Path,
    mut needs_save: bool,
    migration_backup: bool,
) -> AppState {
    let legacy_tauri_release_path = path.with_file_name("tauri-release.json");
    let migration = migrate_legacy_tauri_release_settings(&mut state, &legacy_tauri_release_path);
    needs_save |= migration.changed;
    if needs_save {
        if migration_backup {
            backup_before_migration(path);
        }
        if let Err(error) = save_to_path(&state, path) {
            log::warn!(
                "写回迁移后的配置失败。路径: {}, 错误: {}",
                path.display(),
                error
            );
            return state;
        }
    }
    migration.cleanup();
    state
}

/// §4.2：首次成功写入 v4 前保留一份原始迁移备份；失败仅记录，不阻断迁移。
fn backup_before_migration(path: &Path) {
    if !path.exists() {
        return;
    }
    let timestamp = chrono::Utc::now().format("%Y%m%d%H%M%S%3f");
    let backup_path = path.with_file_name(format!("config.migrate.{timestamp}.json"));
    match fs::copy(path, &backup_path) {
        Ok(_) => {
            let _ = crate::security::harden_private_path(&backup_path);
            log::info!("迁移前已备份原始配置: {}", backup_path.display());
        }
        Err(error) => {
            log::warn!(
                "迁移前备份原始配置失败（继续迁移）。路径: {}, 错误: {}",
                path.display(),
                error
            );
        }
    }
}

pub(crate) fn load_from_path(path: &Path) -> AppState {
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return AppState::default(),
        Err(err) => {
            log::warn!(
                "读取配置文件失败，将使用默认配置。路径: {}, 错误: {}",
                path.display(),
                err
            );
            return AppState::default();
        }
    };

    let parsed_json = match serde_json::from_str::<serde_json::Value>(&content) {
        Ok(value) => value,
        Err(_) => serde_json::Value::Null,
    };
    if let Some(schema_version) = future_schema_version(&parsed_json) {
        return future_schema_fallback(path, schema_version);
    }
    let schema_version = parsed_json
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    let has_legacy_fields = parsed_json.get("selectedPreset").is_some()
        || parsed_json.get("isCustomMode").is_some()
        || parsed_json.get("customConfig").is_some()
        || parsed_json.get("profiles").is_some();

    // v2 及更早：顶层全局三字段形态。
    if schema_version < 3 {
        if let Ok(legacy_state) = serde_json::from_str::<LegacyStoredAppState>(&content) {
            let state = migrate_legacy_state(legacy_state);
            return finalize_loaded_state(state, path, true, true);
        }
    }

    // v3：仓库级三字段编辑状态，转换为统一选择与草稿。
    if schema_version == 3 || (schema_version == 0 && has_legacy_fields) {
        if let Ok(stored_state) = serde_json::from_str::<StoredAppStateV3>(&content) {
            let state: AppState = stored_state.into();
            // §4.2：先执行常规清理（含名称到身份迁移），再转换编辑状态。
            let (mut state, profiles_migrated) = sanitize_stored_state(state);
            let mut edit_state_migrated = false;
            for repo in &mut state.repositories {
                edit_state_migrated |= super::migration::migrate_repo_edit_state_v3_to_v4(repo);
            }
            return finalize_loaded_state(
                state,
                path,
                true || profiles_migrated || edit_state_migrated,
                true,
            );
        }
    }

    // v4：统一选择与草稿，只做常规清理。
    if let Ok(v4_state) = serde_json::from_str::<StoredAppState>(&content) {
        let state: AppState = v4_state.into();
        let (state, profiles_migrated) = sanitize_stored_state(state);
        return finalize_loaded_state(state, path, profiles_migrated, false);
    }

    let mut fallback_state = AppState::default();
    let backup_path = backup_corrupt_file(path);
    fallback_state.startup_notice = Some(match backup_path {
        Some(backup_path) => format!(
            "检测到损坏配置并已恢复默认设置，备份文件已保存到 {}",
            backup_path.display()
        ),
        None => "检测到损坏配置并已恢复默认设置，请检查配置目录权限".to_string(),
    });

    log::warn!(
        "配置文件解析失败，已回退到安全默认状态。路径: {}",
        path.display()
    );

    fallback_state
}

pub(crate) fn load_from_file() -> AppState {
    load_from_path(&get_config_path())
}

#[cfg(target_os = "windows")]
fn replace_file_atomically(source: &Path, target: &Path) -> std::io::Result<()> {
    use std::iter;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source_wide = source
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect::<Vec<_>>();
    let target_wide = target
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect::<Vec<_>>();

    let moved = unsafe {
        MoveFileExW(
            source_wide.as_ptr(),
            target_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };

    if moved == 0 {
        return Err(std::io::Error::last_os_error());
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn replace_file_atomically(source: &Path, target: &Path) -> std::io::Result<()> {
    fs::rename(source, target)
}

pub(crate) fn write_json_atomically(
    path: &Path,
    json: &[u8],
) -> Result<(), crate::errors::AppError> {
    crate::security::ensure_private_parent_dir(path).map_err(|error| {
        crate::errors::AppError::store_with_code(
            format!("创建目录失败: {}", error),
            "store_create_dir_failed",
        )
    })?;

    let temp_path = build_temp_config_path(path);
    let mut temp_file =
        crate::security::open_private_file(&temp_path, true, false).map_err(|error| {
            crate::errors::AppError::store_with_code(
                format!("创建临时文件失败: {}", error),
                "store_temp_create_failed",
            )
        })?;
    temp_file.write_all(json).map_err(|error| {
        crate::errors::AppError::store_with_code(
            format!("写入临时文件失败: {}", error),
            "store_write_failed",
        )
    })?;
    temp_file.flush().map_err(|error| {
        crate::errors::AppError::store_with_code(
            format!("刷新临时文件失败: {}", error),
            "store_flush_failed",
        )
    })?;
    temp_file.sync_all().map_err(|error| {
        crate::errors::AppError::store_with_code(
            format!("同步临时文件失败: {}", error),
            "store_sync_failed",
        )
    })?;
    drop(temp_file);

    replace_file_atomically(&temp_path, path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        crate::errors::AppError::store_with_code(
            format!("替换配置文件失败: {}", error),
            "store_rename_failed",
        )
    })?;
    crate::security::harden_private_path(path).map_err(|error| {
        crate::errors::AppError::store_with_code(
            format!("更新配置文件权限失败: {}", error),
            "store_permission_failed",
        )
    })?;

    Ok(())
}

pub(crate) fn save_to_path(state: &AppState, path: &Path) -> Result<(), crate::errors::AppError> {
    ensure_writable_store_schema(path)?;
    let json = serde_json::to_vec_pretty(&StoredAppState::from(state)).map_err(|error| {
        crate::errors::AppError::store_with_code(
            format!("序列化失败: {}", error),
            "store_serialize_failed",
        )
    })?;
    write_json_atomically(path, &json)
}

pub(crate) fn save_to_file(state: &AppState) -> Result<(), crate::errors::AppError> {
    save_to_path(state, &get_config_path())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn future_schema_load_keeps_original_file_untouched() {
        let temp = TempDir::new().expect("temp dir");
        let path = temp.path().join("config.json");
        let future_version = CURRENT_STORE_SCHEMA_VERSION + 1;
        let original = format!(
            r#"{{"schemaVersion":{future_version},"futureOnly":{{"value":42}},"repositories":[]}}"#
        );
        fs::write(&path, &original).expect("write future config");

        let state = load_from_path(&path);

        assert!(state
            .startup_notice
            .as_deref()
            .is_some_and(|notice| notice.contains(&format!("schemaVersion={future_version}"))));
        assert_eq!(
            fs::read_to_string(&path).expect("read future config"),
            original
        );
    }

    #[test]
    fn save_refuses_to_overwrite_future_schema() {
        let temp = TempDir::new().expect("temp dir");
        let path = temp.path().join("config.json");
        let future_version = CURRENT_STORE_SCHEMA_VERSION + 1;
        let original = format!(
            r#"{{"schemaVersion":{future_version},"futureOnly":{{"value":42}},"repositories":[]}}"#
        );
        fs::write(&path, &original).expect("write future config");

        let error = save_to_path(&AppState::default(), &path)
            .expect_err("future schema must be write protected");

        assert_eq!(error.code.as_deref(), Some("store_schema_version_newer"));
        assert_eq!(
            fs::read_to_string(&path).expect("read future config"),
            original
        );
    }
}
