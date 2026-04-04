use super::migration::{
    migrate_legacy_state, sanitize_state, LegacyStoredAppState, StoredAppState,
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
    let is_legacy_schema = parsed_json.get("selectedPreset").is_some()
        || parsed_json.get("isCustomMode").is_some()
        || parsed_json.get("customConfig").is_some()
        || parsed_json.get("profiles").is_some();

    if is_legacy_schema {
        if let Ok(legacy_state) = serde_json::from_str::<LegacyStoredAppState>(&content) {
            return migrate_legacy_state(legacy_state);
        }
    } else if let Ok(state) = serde_json::from_str::<StoredAppState>(&content) {
        return sanitize_state(state.into());
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

fn write_json_atomically(path: &Path, json: &[u8]) -> Result<(), crate::errors::AppError> {
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
