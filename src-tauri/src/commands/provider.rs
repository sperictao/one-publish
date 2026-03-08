use crate::command_parser::CommandParser;
use crate::provider::registry::ProviderRegistry;
use crate::provider::ProviderManifest;

#[tauri::command]
pub fn list_providers() -> Vec<ProviderManifest> {
    let registry = ProviderRegistry::new();
    registry.manifests()
}

/// 获取 Provider 的参数 Schema
#[tauri::command]
pub async fn get_provider_schema(
    provider_id: String,
) -> Result<crate::parameter::ParameterSchema, crate::errors::AppError> {
    let registry = ProviderRegistry::new();
    let provider = registry
        .get(&provider_id)
        .map_err(crate::errors::AppError::from)?;
    let schema = provider
        .get_schema()
        .map_err(|e| crate::errors::AppError::unknown(format!("failed to load schema: {}", e)))?;
    Ok(schema)
}

/// 从命令导入配置
#[tauri::command]
pub async fn import_from_command(
    command: String,
    provider_id: String,
    project_path: String,
) -> Result<crate::spec::PublishSpec, crate::errors::AppError> {
    let registry = ProviderRegistry::new();
    let provider = registry
        .get(&provider_id)
        .map_err(crate::errors::AppError::from)?;
    let schema = provider
        .get_schema()
        .map_err(|e| crate::errors::AppError::unknown(format!("failed to load schema: {}", e)))?;
    let parser = CommandParser::new(provider_id);
    let spec = parser
        .parse_command(&command, project_path, &schema)
        .map_err(|e| crate::errors::AppError::unknown(format!("parse error: {}", e)))?;
    Ok(spec)
}

#[cfg(test)]
mod tests {
    use super::list_providers;

    #[test]
    fn list_providers_includes_core_toolchains() {
        let ids: Vec<String> = list_providers().into_iter().map(|provider| provider.id).collect();
        assert!(ids.contains(&"dotnet".to_string()));
        assert!(ids.contains(&"cargo".to_string()));
        assert!(ids.contains(&"go".to_string()));
        assert!(ids.contains(&"java".to_string()));
    }
}
