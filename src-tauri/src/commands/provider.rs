use crate::command_parser::CommandParser;
use crate::provider::registry::provider_registry;
use crate::provider::ProviderCatalogEntry;

#[tauri::command]
pub fn list_providers() -> Vec<ProviderCatalogEntry> {
    let _timer =
        crate::commands::middleware::CommandTimer::new("commands::provider::list_providers");
    provider_registry().catalog_entries()
}

/// 获取 Provider 的参数 Schema
#[tauri::command]
pub async fn get_provider_schema(
    provider_id: String,
) -> Result<crate::parameter::ParameterSchema, crate::errors::AppError> {
    let _timer =
        crate::commands::middleware::CommandTimer::new("commands::provider::get_provider_schema");
    let provider = provider_registry()
        .get(&provider_id)
        .map_err(crate::errors::AppError::from)?;
    let schema = provider.get_schema().map_err(|source| {
        crate::errors::AppError::provider_with_code(
            "failed to load schema",
            "provider_schema_load_failed",
        )
        .with_details(source.to_string())
    })?;
    Ok(schema)
}

/// 从命令导入配置：schema 解析为草稿参数 + 诊断，不再构造执行 spec。
#[tauri::command]
pub async fn import_from_command(
    command: String,
    provider_id: String,
    project_path: String,
) -> Result<crate::command_parser::CommandImportResult, crate::errors::AppError> {
    let _timer =
        crate::commands::middleware::CommandTimer::new("commands::provider::import_from_command");
    // project_path 是导入入口的上下文参数，当前解析不需要工作目录；保留签名以备后用。
    let _ = project_path;
    let provider = provider_registry()
        .get(&provider_id)
        .map_err(crate::errors::AppError::from)?;
    let schema = provider.get_schema().map_err(|source| {
        crate::errors::AppError::provider_with_code(
            "failed to load schema",
            "provider_schema_load_failed",
        )
        .with_details(source.to_string())
    })?;
    let parser = CommandParser::new(provider_id);
    Ok(parser.parse(&command, &schema))
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

    #[tokio::test]
    async fn get_provider_schema_resolves_registered_providers() {
        use super::get_provider_schema;

        let schema = get_provider_schema("dotnet".to_string())
            .await
            .expect("dotnet schema");
        assert!(!schema.parameters.is_empty());

        let error = get_provider_schema("ghost-provider".to_string())
            .await
            .expect_err("unknown provider must fail");
        assert_eq!(error.code.as_deref(), Some("unsupported_provider"));
    }

    #[tokio::test]
    async fn import_from_command_parses_registered_provider_commands() {
        use super::import_from_command;

        let error = import_from_command(
            "anything".to_string(),
            "ghost-provider".to_string(),
            "/repo".to_string(),
        )
        .await
        .expect_err("unknown provider must fail");
        assert_eq!(error.code.as_deref(), Some("unsupported_provider"));

        let result = import_from_command(
            "dotnet publish -c Release -o out".to_string(),
            "dotnet".to_string(),
            "/repo".to_string(),
        )
        .await
        .expect("dotnet command parses");
        // schema 键被解析为草稿参数（不构造执行 spec）
        let configuration = result
            .parameters
            .get("configuration")
            .and_then(|value| value.as_str());
        assert_eq!(configuration, Some("Release"));
    }
}
