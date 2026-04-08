use crate::command_parser::CommandParser;
use crate::provider::registry::provider_registry;
use crate::provider::ProviderCatalogEntry;

#[tauri::command]
pub fn list_providers() -> Vec<ProviderCatalogEntry> {
    provider_registry().catalog_entries()
}

/// 获取 Provider 的参数 Schema
#[tauri::command]
pub async fn get_provider_schema(
    provider_id: String,
) -> Result<crate::parameter::ParameterSchema, crate::errors::AppError> {
    let provider = provider_registry()
        .get(&provider_id)
        .map_err(crate::errors::AppError::from)?;
    let schema = provider.get_schema().map_err(|source| {
        crate::errors::AppError::provider_with_code(
            format!("failed to load schema: {}", source),
            "provider_schema_load_failed",
        )
    })?;
    Ok(schema)
}

/// 从命令导入配置
#[tauri::command]
pub async fn import_from_command(
    command: String,
    provider_id: String,
    project_path: String,
) -> Result<crate::spec::PublishSpec, crate::errors::AppError> {
    let provider = provider_registry()
        .get(&provider_id)
        .map_err(crate::errors::AppError::from)?;
    let schema = provider.get_schema().map_err(|source| {
        crate::errors::AppError::provider_with_code(
            format!("failed to load schema: {}", source),
            "provider_schema_load_failed",
        )
    })?;
    let parser = CommandParser::new(provider_id);
    let spec = parser
        .parse_command(&command, project_path, &schema)
        .map_err(|source| {
            crate::errors::AppError::provider_with_code(
                format!("parse error: {}", source),
                "provider_command_parse_failed",
            )
        })?;
    Ok(spec)
}

#[cfg(test)]
mod tests {
    use super::list_providers;

    #[test]
    fn list_providers_includes_core_toolchains() {
        let providers = list_providers();
        let ids: Vec<String> = providers
            .iter()
            .map(|provider| provider.id.clone())
            .collect();
        assert!(ids.contains(&"dotnet".to_string()));
        assert!(ids.contains(&"cargo".to_string()));
        assert!(ids.contains(&"go".to_string()));
        assert!(ids.contains(&"java".to_string()));

        let java = providers
            .iter()
            .find(|provider| provider.id == "java")
            .expect("java provider");
        assert_eq!(java.label, "Java (Gradle)");
        assert_eq!(java.command_example, "./gradlew build --info");
        assert_eq!(java.environment_label, "Java (Gradle)");
        assert_eq!(java.environment_description, "gradle / java runtime");
        assert!(!java.requires_project_binding);
    }
}
