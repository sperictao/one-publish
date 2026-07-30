use crate::config_export::{
    build_config_export, validate_import, ConfigExport, ConfigProfile, CONFIG_VERSION,
};
use std::path::Path;

/// 导出配置到文件
#[tauri::command]
pub async fn export_config(
    repo_id: String,
    file_path: String,
) -> Result<String, crate::errors::AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new("commands::config::export_config");
    let state = crate::store::get_state();
    let repo = state
        .repositories
        .iter()
        .find(|repo| repo.id == repo_id)
        .ok_or_else(|| {
            crate::errors::AppError::config_with_code(
                format!("未找到仓库: {repo_id}"),
                "config_repo_not_found",
            )
        })?;
    let config =
        build_config_export(&repo.publish_config, chrono::Utc::now()).map_err(|source| {
            crate::errors::AppError::config_with_code(
                format!("export projection error: {source}"),
                "export_config_projection_failed",
            )
        })?;
    let json = serde_json::to_string_pretty(&config).map_err(|source| {
        crate::errors::AppError::config_with_code(
            format!("serialization error: {}", source),
            "export_config_serialize_failed",
        )
    })?;
    crate::security::write_private_text_file(Path::new(&file_path), &json).map_err(|source| {
        crate::errors::AppError::config_with_code(
            format!("write error: {}", source),
            "export_config_write_failed",
        )
    })?;
    Ok(file_path)
}

/// 导入配置从文件
#[tauri::command]
pub async fn import_config(file_path: String) -> Result<ConfigExport, crate::errors::AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new("commands::config::import_config");
    let content = std::fs::read_to_string(&file_path).map_err(|source| {
        crate::errors::AppError::config_with_code(
            format!("read error: {}", source),
            "import_config_read_failed",
        )
    })?;
    let config: ConfigExport = serde_json::from_str(&content).map_err(|source| {
        crate::errors::AppError::config_with_code(
            format!("parse error: {}", source),
            "import_config_parse_failed",
        )
    })?;
    // Validate the imported configuration
    validate_import(&config).map_err(|source| {
        crate::errors::AppError::config_with_code(
            format!("validation error: {}", source),
            "import_config_validation_failed",
        )
    })?;
    Ok(config)
}

fn validate_profiles_for_apply(
    profiles: Vec<ConfigProfile>,
) -> Result<Vec<ConfigProfile>, crate::errors::AppError> {
    let config = ConfigExport {
        version: CONFIG_VERSION,
        exported_at: chrono::Utc::now(),
        profiles,
    };
    validate_import(&config).map_err(|source| {
        crate::errors::AppError::config_with_code(
            format!("validation error: {}", source),
            "import_config_validation_failed",
        )
    })?;
    Ok(config.profiles)
}

/// 将导入的 profile 合并进指定仓库，同名 profile 静默跳过（仅 log::warn）。
///
/// 纯函数：仅操作传入的 `Repository`，返回实际追加的条数。BTreeMap->serde_json::Value 的
/// 参数转换、跳过语义与原 `apply_imported_config` 循环体保持一致。
pub(crate) fn merge_imported_profiles(
    repo: &mut crate::store::Repository,
    profiles: Vec<ConfigProfile>,
) -> usize {
    let mut imported = 0usize;
    for profile in profiles {
        let profile_name = profile.name.clone();
        let parameters = serde_json::Value::Object(profile.parameters.into_iter().collect());
        let result = repo
            .publish_config
            .import_profile(crate::store::ConfigurationImport {
                name: profile.name,
                provider_id: profile.provider_id,
                contract_version: profile.contract_version,
                provider_version: profile.provider_version,
                settings_version: profile.settings_version,
                parameters,
                // 旧备份没有组合字段：按迁移默认组合物化，与存量修订一致。
                composition: profile
                    .composition
                    .unwrap_or_else(crate::store::PublishComposition::local_default),
                profile_group: profile.profile_group,
                created_at: profile.created_at.to_rfc3339(),
                is_system_default: profile.is_system_default,
            });
        match result {
            Ok(Some(_)) => imported += 1,
            Ok(None) => log::warn!("配置文件 '{}' 已存在，跳过导入", profile_name),
            Err(error) => log::warn!("导入配置文件 '{}' 失败: {}", profile_name, error),
        }
    }
    imported
}

/// 应用导入的配置（按仓库隔离）
#[tauri::command]
pub async fn apply_imported_config(
    app: tauri::AppHandle,
    repo_id: String,
    profiles: Vec<ConfigProfile>,
) -> Result<(), crate::errors::AppError> {
    let _timer =
        crate::commands::middleware::CommandTimer::new("commands::config::apply_imported_config");
    let profiles = validate_profiles_for_apply(profiles)?;
    let mut state = crate::store::get_state();
    let repo = state
        .repositories
        .iter_mut()
        .find(|r| r.id == repo_id)
        .ok_or_else(|| {
            crate::errors::AppError::config_with_code(
                format!("未找到仓库: {}", repo_id),
                "config_repo_not_found",
            )
        })?;

    merge_imported_profiles(repo, profiles);

    crate::store::update_state(state).map_err(|source| {
        crate::errors::AppError::config_with_code(
            format!("保存配置失败: {}", source),
            "apply_imported_config_save_failed",
        )
    })?;
    if let Err(err) = crate::tray::update_tray_menu(app.clone()).await {
        log::warn!("刷新托盘菜单失败: {}", err);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{RepoPublishConfig, Repository};
    use chrono::TimeZone;
    use std::collections::BTreeMap;

    /// 构造一个空 publish_config 的测试仓库，与 store::tests::test_repo 保持一致风格。
    fn test_repo(id: &str) -> Repository {
        Repository {
            id: id.to_string(),
            name: format!("Repo {id}"),
            path: format!("/{id}"),
            project_file: None,
            current_branch: "main".to_string(),
            branches: Vec::new(),
            is_main: true,
            provider_id: Some("dotnet".to_string()),
            publish_config: RepoPublishConfig::default(),
        }
    }

    /// 构造一个 config_export::ConfigProfile（导入侧类型，parameters 为 BTreeMap）。
    fn import_profile(name: &str) -> ConfigProfile {
        ConfigProfile {
            name: name.to_string(),
            provider_id: "dotnet".to_string(),
            parameters: BTreeMap::new(),
            profile_group: None,
            created_at: chrono::Utc.with_ymd_and_hms(2026, 7, 18, 10, 0, 0).unwrap(),
            is_system_default: false,
            ..ConfigProfile::default()
        }
    }

    #[test]
    fn apply_boundary_rejects_credential_fields_before_storage() {
        let profile = ConfigProfile {
            name: "secret-bearing".to_string(),
            parameters: BTreeMap::from([(
                "nested".to_string(),
                serde_json::json!({ "privateKey": "must-not-enter-storage" }),
            )]),
            ..import_profile("secret-bearing")
        };

        let error = validate_profiles_for_apply(vec![profile])
            .expect_err("apply boundary must reject credentials");

        assert_eq!(
            error.code.as_deref(),
            Some("import_config_validation_failed")
        );
    }

    #[test]
    fn merge_imports_all_new_profiles_and_preserves_fields() {
        let mut repo = test_repo("repo-1");

        let mut parameters = BTreeMap::new();
        parameters.insert(
            "configuration".to_string(),
            serde_json::Value::String("Release".to_string()),
        );
        parameters.insert("selfContained".to_string(), serde_json::Value::Bool(true));

        let profiles = vec![
            ConfigProfile {
                name: "alpha".to_string(),
                provider_id: "dotnet".to_string(),
                parameters: parameters.clone(),
                profile_group: Some("g1".to_string()),
                created_at: chrono::Utc.with_ymd_and_hms(2026, 7, 18, 10, 0, 0).unwrap(),
                is_system_default: true,
                ..ConfigProfile::default()
            },
            ConfigProfile {
                name: "beta".to_string(),
                provider_id: "cargo".to_string(),
                parameters,
                profile_group: None,
                created_at: chrono::Utc
                    .with_ymd_and_hms(2026, 7, 19, 11, 30, 0)
                    .unwrap(),
                is_system_default: false,
                ..ConfigProfile::default()
            },
        ];

        let imported = merge_imported_profiles(&mut repo, profiles);

        assert_eq!(imported, 2);
        assert_eq!(repo.publish_config.profiles.len(), 2);

        let alpha = &repo.publish_config.profiles[0];
        assert_eq!(alpha.name, "alpha");
        let alpha_revision = alpha.current_revision().expect("alpha revision");
        assert_eq!(alpha_revision.provider_id, "dotnet");
        assert_eq!(alpha.profile_group.as_deref(), Some("g1"));
        assert!(alpha.is_system_default);
        assert_eq!(
            alpha.created_at, "2026-07-18T10:00:00+00:00",
            "created_at 应转为 RFC3339 字符串"
        );
        assert!(
            matches!(&alpha_revision.parameters, serde_json::Value::Object(map) if map.len() == 2),
            "parameters 应为 serde_json::Value::Object 且保留两个键"
        );
        assert_eq!(
            alpha_revision.parameters.get("configuration"),
            Some(&serde_json::Value::String("Release".to_string()))
        );
        assert_eq!(
            alpha_revision.parameters.get("selfContained"),
            Some(&serde_json::Value::Bool(true))
        );

        let beta = &repo.publish_config.profiles[1];
        assert_eq!(beta.name, "beta");
        assert_eq!(
            beta.current_revision().expect("beta revision").provider_id,
            "cargo"
        );
        assert_eq!(beta.profile_group, None);
        assert!(!beta.is_system_default);
    }

    #[test]
    fn merge_skips_duplicate_names_and_keeps_original_values() {
        let mut repo = test_repo("repo-1");
        // 预置一个同名 profile，其原始字段应保留、不被覆盖
        repo.publish_config
            .profiles
            .push(crate::store::ConfigProfile::new(
                "dup".to_string(),
                "original".to_string(),
                serde_json::Value::Null,
                Some("original-group".to_string()),
                "2026-01-01T00:00:00+00:00".to_string(),
                true,
            ));

        let profiles = vec![
            ConfigProfile {
                name: "dup".to_string(),
                provider_id: "dotnet".to_string(),
                parameters: BTreeMap::from([(
                    "configuration".to_string(),
                    serde_json::Value::String("Release".to_string()),
                )]),
                profile_group: None,
                created_at: chrono::Utc.with_ymd_and_hms(2026, 7, 18, 10, 0, 0).unwrap(),
                is_system_default: false,
                ..ConfigProfile::default()
            },
            import_profile("new"),
        ];

        let imported = merge_imported_profiles(&mut repo, profiles);

        assert_eq!(imported, 1, "仅新名 profile 应被导入");
        assert_eq!(repo.publish_config.profiles.len(), 2, "重名保留 + 新名追加");

        let original = &repo.publish_config.profiles[0];
        assert_eq!(original.name, "dup");
        let original_revision = original.current_revision().expect("original revision");
        assert_eq!(
            original_revision.provider_id, "original",
            "重名 profile 原值不应被覆盖"
        );
        assert_eq!(original.profile_group.as_deref(), Some("original-group"));
        assert!(original.is_system_default);
        assert!(
            original_revision.parameters.is_null(),
            "重名 profile 的 parameters 不应被改写"
        );

        let new = &repo.publish_config.profiles[1];
        assert_eq!(new.name, "new");
    }

    #[test]
    fn merge_all_duplicate_names_imports_nothing() {
        let mut repo = test_repo("repo-1");
        repo.publish_config
            .profiles
            .push(crate::store::ConfigProfile::new(
                "dup".to_string(),
                "dotnet".to_string(),
                serde_json::Value::Object(serde_json::Map::new()),
                None,
                "2026-01-01T00:00:00+00:00".to_string(),
                false,
            ));

        // 两个导入项均与已存在的 "dup" 重名
        let profiles = vec![import_profile("dup"), import_profile("dup")];

        let imported = merge_imported_profiles(&mut repo, profiles);

        assert_eq!(imported, 0, "全部重名应返回 0");
        assert_eq!(
            repo.publish_config.profiles.len(),
            1,
            "仓库不应新增任何 profile"
        );
        assert_eq!(repo.publish_config.profiles[0].name, "dup");
    }

    #[test]
    fn merge_empty_imports_changes_nothing() {
        let mut repo = test_repo("repo-1");
        repo.publish_config
            .profiles
            .push(crate::store::ConfigProfile::new(
                "existing".to_string(),
                "dotnet".to_string(),
                serde_json::Value::Object(serde_json::Map::new()),
                None,
                "2026-01-01T00:00:00+00:00".to_string(),
                false,
            ));

        let imported = merge_imported_profiles(&mut repo, Vec::new());

        assert_eq!(imported, 0);
        assert_eq!(repo.publish_config.profiles.len(), 1);
        assert_eq!(repo.publish_config.profiles[0].name, "existing");
    }

    #[test]
    fn merge_preserves_nested_parameters_shape() {
        let mut repo = test_repo("repo-1");

        let mut parameters = BTreeMap::new();
        // 嵌套对象
        parameters.insert(
            "build".to_string(),
            serde_json::json!({
                "configuration": "Release",
                "properties": { "Version": "1.0.0", "Tier": "Release" }
            }),
        );
        // 数组
        parameters.insert(
            "targets".to_string(),
            serde_json::json!(["win-x64", "linux-x64", "osx-arm64"]),
        );
        // 标量
        parameters.insert(
            "verbosity".to_string(),
            serde_json::Value::String("minimal".to_string()),
        );

        let profiles = vec![ConfigProfile {
            name: "nested".to_string(),
            provider_id: "dotnet".to_string(),
            parameters,
            profile_group: None,
            created_at: chrono::Utc.with_ymd_and_hms(2026, 7, 18, 10, 0, 0).unwrap(),
            is_system_default: false,
            ..ConfigProfile::default()
        }];

        let imported = merge_imported_profiles(&mut repo, profiles);

        assert_eq!(imported, 1);
        let stored = &repo.publish_config.profiles[0];
        let stored_parameters = &stored
            .current_revision()
            .expect("stored revision")
            .parameters;
        assert!(stored_parameters.is_object(), "parameters 应为 Object");
        assert_eq!(
            stored_parameters.get("verbosity"),
            Some(&serde_json::Value::String("minimal".to_string()))
        );
        assert_eq!(
            stored_parameters.get("targets"),
            Some(&serde_json::json!(["win-x64", "linux-x64", "osx-arm64"])),
            "数组值转换后形状应一致"
        );
        assert_eq!(
            stored_parameters.get("build"),
            Some(&serde_json::json!({
                "configuration": "Release",
                "properties": { "Version": "1.0.0", "Tier": "Release" }
            })),
            "嵌套对象转换后形状应一致"
        );
    }
}
