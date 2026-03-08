use crate::config_export::{ConfigExport, ConfigProfile};

/// 导出配置到文件
#[tauri::command]
pub async fn export_config(
    profiles: Vec<ConfigProfile>,
    file_path: String,
) -> Result<String, crate::errors::AppError> {
    let config = ConfigExport {
        version: 1,
        exported_at: chrono::Utc::now(),
        profiles,
    };
    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| crate::errors::AppError::unknown(format!("serialization error: {}", e)))?;
    std::fs::write(&file_path, json)
        .map_err(|e| crate::errors::AppError::unknown(format!("write error: {}", e)))?;
    Ok(file_path)
}

/// 导入配置从文件
#[tauri::command]
pub async fn import_config(file_path: String) -> Result<ConfigExport, crate::errors::AppError> {
    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| crate::errors::AppError::unknown(format!("read error: {}", e)))?;
    let config: ConfigExport = serde_json::from_str(&content)
        .map_err(|e| crate::errors::AppError::unknown(format!("parse error: {}", e)))?;
    // Validate the imported configuration
    crate::config_export::validate_import(&config)
        .map_err(|e| crate::errors::AppError::unknown(format!("validation error: {}", e)))?;
    Ok(config)
}

/// 应用导入的配置（按仓库隔离）
#[tauri::command]
pub async fn apply_imported_config(
    repo_id: String,
    profiles: Vec<ConfigProfile>,
) -> Result<(), crate::errors::AppError> {
    let mut state = crate::store::get_state();
    let repo = state
        .repositories
        .iter_mut()
        .find(|r| r.id == repo_id)
        .ok_or_else(|| crate::errors::AppError::unknown(format!("未找到仓库: {}", repo_id)))?;

    for profile in profiles {
        // 检查是否已存在同名配置文件
        if repo.publish_config.profiles.iter().any(|p| p.name == profile.name) {
            log::warn!("配置文件 '{}' 已存在，跳过导入", profile.name);
            continue;
        }
        // 转换 parameters: BTreeMap -> serde_json::Value::Object
        let parameters = serde_json::Value::Object(
            profile
                .parameters
                .into_iter()
                .map(|(k, v)| (k, v))
                .collect(),
        );
        // 转换为 store::ConfigProfile 格式
        let store_profile = crate::store::ConfigProfile {
            name: profile.name,
            provider_id: profile.provider_id,
            parameters,
            profile_group: profile.profile_group,
            created_at: profile.created_at.to_rfc3339(),
            is_system_default: profile.is_system_default,
        };
        repo.publish_config.profiles.push(store_profile);
    }
    crate::store::update_state(state)
        .map_err(|e| crate::errors::AppError::unknown(format!("保存配置失败: {}", e)))?;
    Ok(())
}
