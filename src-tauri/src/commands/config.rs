use crate::config_export::{
    build_config_export, validate_import, ConfigExport, ConfigProfile, CONFIG_VERSION,
};
use std::path::PathBuf;
use ts_rs::TS;

/// 导入配置的应用结果：按处理方式分别计数，供界面如实反馈。
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ImportedConfigSummary {
    pub imported: usize,
    /// 仓库内已有同名配置，保留原配置、不覆盖。
    pub skipped_existing: usize,
    /// 配置 Provider 与仓库声明的 Provider 不一致，拒绝导入。
    pub skipped_provider_mismatch: usize,
    /// 同名配置被导入内容覆盖（已有 profile 追加 imported 修订）。
    pub overwritten: usize,
    /// 同名配置以派生名（`name (n)`）导入。
    pub renamed: usize,
}

/// 同名导入冲突策略（Phase 11 候选 A）：跳过保留原配置、覆盖为导入内容
/// （保留 profile 身份，追加修订）、或以派生名导入。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum ImportConflictStrategy {
    Skip,
    Overwrite,
    Rename,
}

/// 导入对话框只列出 `.json` 文件；Linux (GTK) 保存对话框不会按过滤器补扩展名，
/// 因此导出时统一补齐，保证导出的文件能被再次导入。
fn ensure_json_extension(file_path: &str) -> PathBuf {
    let path = PathBuf::from(file_path);
    let has_json_extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("json"));
    if has_json_extension {
        path
    } else {
        PathBuf::from(format!("{file_path}.json"))
    }
}

/// 导出配置到文件，返回实际写入的路径（可能补齐了 `.json` 扩展名）。
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
                "export projection error",
                "export_config_projection_failed",
            )
            .with_details(source.to_string())
        })?;
    let json = serde_json::to_string_pretty(&config).map_err(|source| {
        crate::errors::AppError::config_with_code(
            "serialization error",
            "export_config_serialize_failed",
        )
        .with_details(source.to_string())
    })?;
    let file_path = ensure_json_extension(&file_path);
    crate::security::write_private_text_file(&file_path, &json).map_err(|source| {
        crate::errors::AppError::config_with_code("write error", "export_config_write_failed")
            .with_details(source.to_string())
    })?;
    Ok(file_path.to_string_lossy().into_owned())
}

/// 导入配置从文件
#[tauri::command]
pub async fn import_config(file_path: String) -> Result<ConfigExport, crate::errors::AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new("commands::config::import_config");
    let content = std::fs::read_to_string(&file_path).map_err(|source| {
        crate::errors::AppError::config_with_code("read error", "import_config_read_failed")
            .with_details(source.to_string())
    })?;
    let config: ConfigExport = serde_json::from_str(&content).map_err(|source| {
        crate::errors::AppError::config_with_code("parse error", "import_config_parse_failed")
            .with_details(source.to_string())
    })?;
    // Validate the imported configuration
    validate_import(&config).map_err(|source| {
        crate::errors::AppError::config_with_code(
            "validation error",
            "import_config_validation_failed",
        )
        .with_details(source.to_string())
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
            "validation error",
            "import_config_validation_failed",
        )
        .with_details(source.to_string())
    })?;
    Ok(config.profiles)
}

/// 将导入的 profile 合并进指定仓库：Provider 与仓库不一致的拒绝导入，同名
/// 冲突按 `strategy` 处理（跳过保留原配置 / 覆盖为导入修订 / 派生名导入），
/// 其余追加。
///
/// 纯函数：仅操作传入的 `Repository`，返回各处理方式的计数。
pub(crate) fn merge_imported_profiles(
    repo: &mut crate::store::Repository,
    profiles: Vec<ConfigProfile>,
    strategy: ImportConflictStrategy,
) -> Result<ImportedConfigSummary, crate::errors::AppError> {
    let mut summary = ImportedConfigSummary::default();
    for profile in profiles {
        if let Some(reason) = repo.provider_mismatch_reason(&profile.provider_id) {
            log::warn!("配置文件 '{}' 拒绝导入: {}", profile.name, reason);
            summary.skipped_provider_mismatch += 1;
            continue;
        }
        let parameters = serde_json::Value::Object(profile.parameters.into_iter().collect());
        // 旧备份没有组合字段：按迁移默认组合物化，与存量修订一致。
        let composition = profile
            .composition
            .unwrap_or_else(crate::store::PublishComposition::local_default);
        let mut import = crate::store::ConfigurationImport {
            name: profile.name.clone(),
            provider_id: profile.provider_id,
            contract_version: profile.contract_version,
            provider_version: profile.provider_version,
            settings_version: profile.settings_version,
            parameters,
            composition,
            project_binding: profile.project_binding,
            profile_group: profile.profile_group,
            created_at: profile.created_at.to_rfc3339(),
            is_system_default: profile.is_system_default,
        };

        let name_taken = repo.publish_config.has_active_profile_named(&import.name);
        match strategy {
            ImportConflictStrategy::Skip if name_taken => {
                summary.skipped_existing += 1;
                continue;
            }
            ImportConflictStrategy::Overwrite if name_taken => {
                // 系统默认配置不可覆盖，回落为跳过。
                let overwritten = repo
                    .publish_config
                    .import_profile_overwriting(import)?
                    .is_some();
                if overwritten {
                    summary.overwritten += 1;
                } else {
                    summary.skipped_existing += 1;
                }
                continue;
            }
            ImportConflictStrategy::Rename if name_taken => {
                import.name = derive_imported_profile_name(&repo.publish_config, &import.name);
                let imported = repo.publish_config.import_profile(import)?.is_some();
                debug_assert!(imported, "派生名不应再冲突");
                summary.renamed += 1;
                continue;
            }
            _ => {}
        }

        let imported = repo.publish_config.import_profile(import)?.is_some();
        if imported {
            summary.imported += 1;
        } else {
            summary.skipped_existing += 1;
        }
    }
    Ok(summary)
}

/// 派生不冲突的导入名：`name (2)`、`name (3)` 递增。
fn derive_imported_profile_name(
    config: &crate::store::RepoPublishConfig,
    base_name: &str,
) -> String {
    let mut suffix = 2usize;
    loop {
        let candidate = format!("{base_name} ({suffix})");
        if !config.has_active_profile_named(&candidate) {
            return candidate;
        }
        suffix += 1;
    }
}

/// 应用导入的配置（按仓库隔离）；任一配置写入失败时整体不落盘。
/// 同名冲突按 `conflict_strategy` 处理。
#[tauri::command]
pub async fn apply_imported_config(
    app: tauri::AppHandle,
    repo_id: String,
    profiles: Vec<ConfigProfile>,
    conflict_strategy: ImportConflictStrategy,
) -> Result<ImportedConfigSummary, crate::errors::AppError> {
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

    let summary = merge_imported_profiles(repo, profiles, conflict_strategy)?;
    if summary.imported == 0 && summary.overwritten == 0 && summary.renamed == 0 {
        return Ok(summary);
    }

    crate::store::update_state(state).map_err(|source| {
        crate::errors::AppError::config_with_code(
            "保存配置失败",
            "apply_imported_config_save_failed",
        )
        .with_details(source.to_string())
    })?;
    if let Err(err) = crate::tray::update_tray_menu(app.clone()).await {
        log::warn!("刷新托盘菜单失败: {}", err);
    }
    Ok(summary)
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

    /// ADR-0060：配置备份按敏感键策略剥离发布设置中的 Secret 名称，其余字段
    /// （含 Updater 公钥）原样往返；导入后的设置仍可解析，Secret 名称需在
    /// 发布设置表单中补齐。保留 Secret 名称键的备份被整份拒绝。
    #[test]
    fn backup_round_trip_strips_secret_names_from_release_settings() {
        use crate::tauri_release::{
            release_settings_from_parameters, TauriReleaseConfig, TauriUpdaterSettings,
        };

        let settings = TauriReleaseConfig {
            tag_prefix: "app-v".to_string(),
            required_actions_secret_names: vec!["APPLE_CERTIFICATE".to_string()],
            actions_secret_environment: BTreeMap::from([(
                "APPLE_PASSWORD".to_string(),
                "APPLE_CERTIFICATE_PASSWORD".to_string(),
            )]),
            updater: TauriUpdaterSettings {
                enabled: true,
                endpoint: Some("https://updates.example.com/latest.json".to_string()),
                public_key: Some("dW50cnVzdGVkIGNvbW1lbnQ=".to_string()),
                private_key_secret_name: Some("TAURI_SIGNING_PRIVATE_KEY".to_string()),
            },
            ..TauriReleaseConfig::default()
        };
        let mut source = RepoPublishConfig::default();
        source
            .create_profile(
                "Desktop".to_string(),
                "tauri".to_string(),
                serde_json::json!({ "releaseSettings": settings.clone() }),
                None,
                None,
                "2026-10-07T10:00:00+00:00".to_string(),
            )
            .expect("create tauri profile");

        let exported = build_config_export(&source, chrono::Utc::now()).expect("export");
        let backup: ConfigExport =
            serde_json::from_str(&serde_json::to_string(&exported).expect("serialize backup"))
                .expect("parse backup");
        let profiles = validate_profiles_for_apply(backup.profiles).expect("backup imports");
        // Tauri 配置只能导入同 Provider 的仓库。
        let mut target = Repository {
            provider_id: Some("tauri".to_string()),
            ..test_repo("repo-2")
        };
        let summary =
            merge_imported_profiles(&mut target, profiles, super::ImportConflictStrategy::Skip)
                .expect("merge backup");
        assert_eq!(summary.imported, 1);

        let revision = target.publish_config.profiles[0]
            .current_revision()
            .expect("imported revision");
        let imported = release_settings_from_parameters(&revision.parameters)
            .expect("imported settings parse")
            .expect("imported settings are present");
        assert!(imported.required_actions_secret_names.is_empty());
        assert!(imported.actions_secret_environment.is_empty());
        assert_eq!(imported.updater.private_key_secret_name, None);
        assert_eq!(imported.updater.public_key, settings.updater.public_key);
        assert_eq!(imported.updater.endpoint, settings.updater.endpoint);
        assert_eq!(imported.tag_prefix, "app-v");
        assert_eq!(imported.app_config_path, settings.app_config_path);
        assert_eq!(imported.enabled_targets, settings.enabled_targets);

        let hand_edited = ConfigProfile {
            name: "Hand Edited".to_string(),
            provider_id: "tauri".to_string(),
            parameters: BTreeMap::from([(
                "releaseSettings".to_string(),
                serde_json::to_value(&settings).expect("serialize settings"),
            )]),
            ..import_profile("Hand Edited")
        };
        let error = validate_profiles_for_apply(vec![hand_edited])
            .expect_err("secret-name keys count as credential fields");
        assert_eq!(
            error.code.as_deref(),
            Some("import_config_validation_failed")
        );
    }

    #[test]
    fn merge_imports_all_new_profiles_and_preserves_fields() {
        let mut repo = test_repo("repo-1");
        // 仓库未声明 Provider 时不限制导入配置的 Provider。
        repo.provider_id = None;

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

        let summary = merge_imported_profiles(&mut repo, profiles, ImportConflictStrategy::Skip)
            .expect("merge profiles");

        assert_eq!(
            summary,
            ImportedConfigSummary {
                imported: 2,
                ..ImportedConfigSummary::default()
            }
        );
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
                None,
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

        let summary = merge_imported_profiles(&mut repo, profiles, ImportConflictStrategy::Skip)
            .expect("merge profiles");

        assert_eq!(
            summary,
            ImportedConfigSummary {
                imported: 1,
                skipped_existing: 1,
                ..ImportedConfigSummary::default()
            },
            "仅新名 profile 应被导入，重名计入跳过"
        );
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
                None,
                "2026-01-01T00:00:00+00:00".to_string(),
                false,
            ));

        // 两个导入项均与已存在的 "dup" 重名
        let profiles = vec![import_profile("dup"), import_profile("dup")];

        let summary = merge_imported_profiles(&mut repo, profiles, ImportConflictStrategy::Skip)
            .expect("merge profiles");

        assert_eq!(summary.imported, 0, "全部重名应返回 0");
        assert_eq!(summary.skipped_existing, 2);
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
                None,
                "2026-01-01T00:00:00+00:00".to_string(),
                false,
            ));

        let summary = merge_imported_profiles(&mut repo, Vec::new(), ImportConflictStrategy::Skip)
            .expect("merge profiles");

        assert_eq!(summary, ImportedConfigSummary::default());
        assert_eq!(repo.publish_config.profiles.len(), 1);
        assert_eq!(repo.publish_config.profiles[0].name, "existing");
    }

    /// 预置同名 profile，返回其 id 与当前修订参数，供三策略测试复用。
    fn repo_with_existing_profile(
        name: &str,
        parameters: serde_json::Value,
        is_system_default: bool,
    ) -> (Repository, String) {
        let mut repo = test_repo("repo-1");
        repo.publish_config
            .create_profile(
                name.to_string(),
                "dotnet".to_string(),
                parameters,
                None,
                None,
                "2026-01-01T00:00:00+00:00".to_string(),
            )
            .expect("create existing profile");
        let profile = &repo.publish_config.profiles[0];
        let profile_id = profile.id.clone();
        let profile = &mut repo.publish_config.profiles[0];
        profile.is_system_default = is_system_default;
        (repo, profile_id)
    }

    fn conflicting_import(name: &str) -> ConfigProfile {
        ConfigProfile {
            name: name.to_string(),
            provider_id: "dotnet".to_string(),
            parameters: BTreeMap::from([(
                "configuration".to_string(),
                serde_json::Value::String("Imported".to_string()),
            )]),
            profile_group: Some("imported-group".to_string()),
            created_at: chrono::Utc.with_ymd_and_hms(2026, 7, 18, 10, 0, 0).unwrap(),
            is_system_default: false,
            ..ConfigProfile::default()
        }
    }

    #[test]
    fn overwrite_strategy_appends_imported_revision_and_keeps_identity() {
        let (mut repo, profile_id) = repo_with_existing_profile(
            "dup",
            serde_json::json!({ "configuration": "Original" }),
            false,
        );

        let summary = merge_imported_profiles(
            &mut repo,
            vec![conflicting_import("dup")],
            ImportConflictStrategy::Overwrite,
        )
        .expect("merge profiles");

        assert_eq!(summary.overwritten, 1);
        assert_eq!(
            summary.imported + summary.renamed + summary.skipped_existing,
            0
        );
        assert_eq!(repo.publish_config.profiles.len(), 1, "覆盖不新建 profile");

        let profile = &repo.publish_config.profiles[0];
        assert_eq!(profile.id, profile_id, "覆盖保留 profile 身份");
        assert_eq!(profile.revisions.len(), 2, "覆盖追加一个 imported 修订");
        let revision = profile.current_revision().expect("current revision");
        assert_eq!(
            revision.parameters.get("configuration"),
            Some(&serde_json::Value::String("Imported".to_string())),
            "当前修订应为导入参数"
        );
        assert_eq!(profile.profile_group.as_deref(), Some("imported-group"));
    }

    #[test]
    fn overwrite_strategy_falls_back_to_skip_for_system_default() {
        let (mut repo, _) = repo_with_existing_profile(
            "system",
            serde_json::json!({ "configuration": "Original" }),
            true,
        );

        let summary = merge_imported_profiles(
            &mut repo,
            vec![conflicting_import("system")],
            ImportConflictStrategy::Overwrite,
        )
        .expect("merge profiles");

        assert_eq!(summary.skipped_existing, 1);
        assert_eq!(summary.overwritten, 0);
        let revision = repo.publish_config.profiles[0]
            .current_revision()
            .expect("current revision");
        assert_eq!(
            revision.parameters.get("configuration"),
            Some(&serde_json::Value::String("Original".to_string())),
            "系统默认配置保持原值"
        );
    }

    #[test]
    fn rename_strategy_imports_under_derived_suffix() {
        let (mut repo, _) = repo_with_existing_profile(
            "dup",
            serde_json::json!({ "configuration": "Original" }),
            false,
        );
        repo.publish_config
            .create_profile(
                "dup (2)".to_string(),
                "dotnet".to_string(),
                serde_json::Value::Object(serde_json::Map::new()),
                None,
                None,
                "2026-01-01T00:00:00+00:00".to_string(),
            )
            .expect("create taken suffix");

        let summary = merge_imported_profiles(
            &mut repo,
            vec![conflicting_import("dup"), conflicting_import("dup")],
            ImportConflictStrategy::Rename,
        )
        .expect("merge profiles");

        assert_eq!(summary.renamed, 2);
        assert_eq!(repo.publish_config.profiles.len(), 4, "两条派生名均导入");
        let names = repo
            .publish_config
            .profiles
            .iter()
            .map(|profile| profile.name.as_str())
            .collect::<Vec<_>>();
        assert_eq!(names, ["dup", "dup (2)", "dup (3)", "dup (4)"]);
        // 原配置不被改写。
        let original = repo.publish_config.profiles[0]
            .current_revision()
            .expect("original revision");
        assert_eq!(
            original.parameters.get("configuration"),
            Some(&serde_json::Value::String("Original".to_string()))
        );
    }

    #[test]
    fn rename_strategy_keeps_new_names_untouched() {
        let mut repo = test_repo("repo-1");
        let summary = merge_imported_profiles(
            &mut repo,
            vec![import_profile("fresh")],
            ImportConflictStrategy::Rename,
        )
        .expect("merge profiles");

        assert_eq!(summary.imported, 1);
        assert_eq!(summary.renamed, 0);
        assert_eq!(repo.publish_config.profiles[0].name, "fresh");
    }

    #[test]
    fn merge_refuses_profiles_from_another_repository_provider() {
        // 复现：Go 仓库导出的配置导入 Rust 仓库，Go 配置不得进入列表。
        let mut repo = Repository {
            provider_id: Some("cargo".to_string()),
            ..test_repo("rust-repo")
        };
        let profiles = vec![
            ConfigProfile {
                provider_id: "go".to_string(),
                parameters: BTreeMap::from([
                    ("goos".to_string(), serde_json::json!("linux")),
                    ("goarch".to_string(), serde_json::json!("amd64")),
                ]),
                ..import_profile("linux-amd64")
            },
            ConfigProfile {
                provider_id: "cargo".to_string(),
                ..import_profile("release")
            },
        ];

        let summary = merge_imported_profiles(&mut repo, profiles, ImportConflictStrategy::Skip)
            .expect("merge profiles");

        assert_eq!(
            summary,
            ImportedConfigSummary {
                imported: 1,
                skipped_provider_mismatch: 1,
                ..ImportedConfigSummary::default()
            }
        );
        let names = repo
            .publish_config
            .profiles
            .iter()
            .map(|profile| profile.name.as_str())
            .collect::<Vec<_>>();
        assert_eq!(names, ["release"], "Go 配置不应写入 Rust 仓库");
    }

    #[test]
    fn export_path_gets_json_extension_when_missing() {
        assert_eq!(
            ensure_json_extension("/tmp/backup"),
            PathBuf::from("/tmp/backup.json"),
            "GTK 保存对话框不补扩展名时应补齐"
        );
        assert_eq!(
            ensure_json_extension("/tmp/backup.txt"),
            PathBuf::from("/tmp/backup.txt.json"),
            "非 json 扩展名也要补齐，否则导入对话框看不到"
        );
        assert_eq!(
            ensure_json_extension("/tmp/backup.json"),
            PathBuf::from("/tmp/backup.json")
        );
        assert_eq!(
            ensure_json_extension("/tmp/Backup.JSON"),
            PathBuf::from("/tmp/Backup.JSON"),
            "已有 json 扩展名（大小写不敏感）时保持原样"
        );
        assert_eq!(
            ensure_json_extension("/tmp/one.publish/backup"),
            PathBuf::from("/tmp/one.publish/backup.json"),
            "目录名中的点不算扩展名"
        );
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

        let summary = merge_imported_profiles(&mut repo, profiles, ImportConflictStrategy::Skip)
            .expect("merge profiles");

        assert_eq!(summary.imported, 1);
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
