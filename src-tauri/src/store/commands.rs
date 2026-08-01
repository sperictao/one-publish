use super::recent::{
    push_recent_publish_config_state, remove_recent_publish_config_state,
    replace_recent_publish_config_key_state,
};
use super::runtime::{
    append_execution_history, apply_selected_repo_id_update, find_repository, find_repository_mut,
    get_bootstrap_state, get_execution_history_snapshot, get_state, persist_state_and_refresh_tray,
    refresh_tray_menu, update_state, validate_repository_project_binding, with_read_state,
};
use super::types::{
    normalize_environment_provider_ids, normalize_execution_history_limit, trim_execution_history,
    AppState, ConfigProfile, ExecutionRecord, PublishConfigStore, Repository,
};
use crate::errors::AppError;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileOrderEntry {
    pub id: String,
    #[serde(default)]
    pub profile_group: Option<String>,
}

fn normalize_ordered_ids(ids: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::with_capacity(ids.len());
    let mut seen = BTreeSet::new();

    for id in ids {
        let trimmed = id.trim();
        if trimmed.is_empty() {
            continue;
        }

        let value = trimmed.to_string();
        if seen.insert(value.clone()) {
            normalized.push(value);
        }
    }

    normalized
}

fn ensure_exact_order_match(
    current_ids: &[String],
    requested_ids: &[String],
    error_code: &str,
) -> Result<(), AppError> {
    let current_set = current_ids.iter().cloned().collect::<BTreeSet<_>>();
    let requested_set = requested_ids.iter().cloned().collect::<BTreeSet<_>>();

    if current_ids.len() != requested_ids.len() || current_set != requested_set {
        return Err(AppError::validation_with_code(
            "排序目标与当前列表不一致",
            error_code,
        ));
    }

    Ok(())
}

#[tauri::command]
pub async fn get_app_state() -> Result<AppState, AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new("store::commands::get_app_state");
    Ok(get_bootstrap_state())
}

#[tauri::command]
pub async fn get_repository(repo_id: String) -> Result<Repository, AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new("store::commands::get_repository");
    with_read_state(|state| find_repository(&state.repositories, &repo_id).cloned())
}

#[tauri::command]
pub async fn save_app_state(state: AppState) -> Result<(), AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new("store::commands::save_app_state");
    update_state(state)
}

#[tauri::command]
pub async fn add_repository(app: tauri::AppHandle, repo: Repository) -> Result<AppState, AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new("store::commands::add_repository");
    let mut state = get_state();

    if state
        .repositories
        .iter()
        .any(|repository| repository.path == repo.path)
    {
        return Err(AppError::validation_with_code(
            "仓库已存在",
            "repository_exists",
        ));
    }

    state.repositories.push(repo.clone());
    state.selected_repo_id = Some(repo.id);
    persist_state_and_refresh_tray(&app, state).await?;
    Ok(get_bootstrap_state())
}

#[tauri::command]
pub async fn remove_repository(
    app: tauri::AppHandle,
    repo_id: String,
) -> Result<AppState, AppError> {
    let _timer =
        crate::commands::middleware::CommandTimer::new("store::commands::remove_repository");
    let mut state = get_state();

    state
        .repositories
        .retain(|repository| repository.id != repo_id);

    if state.selected_repo_id.as_ref() == Some(&repo_id) {
        state.selected_repo_id = state
            .repositories
            .first()
            .map(|repository| repository.id.clone());
    }

    persist_state_and_refresh_tray(&app, state).await?;
    Ok(get_bootstrap_state())
}

fn merge_repository_metadata(existing: &Repository, mut update: Repository) -> Repository {
    update.publish_config = existing.publish_config.clone();
    update
}

#[tauri::command]
pub async fn update_repository(
    app: tauri::AppHandle,
    repo: Repository,
) -> Result<AppState, AppError> {
    let _timer =
        crate::commands::middleware::CommandTimer::new("store::commands::update_repository");
    let mut state = get_state();
    let existing = find_repository(&state.repositories, &repo.id)?;
    let repo = merge_repository_metadata(existing, repo);
    validate_repository_project_binding(&repo).await?;
    let repo_id = repo.id.clone();
    *find_repository_mut(&mut state.repositories, &repo_id)? = repo;

    persist_state_and_refresh_tray(&app, state).await?;
    Ok(get_bootstrap_state())
}

#[tauri::command]
pub async fn reorder_repositories(
    app: tauri::AppHandle,
    repo_ids: Vec<String>,
) -> Result<AppState, AppError> {
    let _timer =
        crate::commands::middleware::CommandTimer::new("store::commands::reorder_repositories");
    let mut state = get_state();
    let requested_ids = normalize_ordered_ids(repo_ids);
    let current_ids = state
        .repositories
        .iter()
        .map(|repository| repository.id.clone())
        .collect::<Vec<_>>();

    ensure_exact_order_match(&current_ids, &requested_ids, "repository_order_mismatch")?;

    if current_ids == requested_ids {
        return Ok(get_bootstrap_state());
    }

    let mut repository_map = state
        .repositories
        .into_iter()
        .map(|repository| (repository.id.clone(), repository))
        .collect::<BTreeMap<_, _>>();

    state.repositories = requested_ids
        .into_iter()
        .filter_map(|repo_id| repository_map.remove(&repo_id))
        .collect();

    persist_state_and_refresh_tray(&app, state).await?;
    Ok(get_bootstrap_state())
}

#[tauri::command]
pub async fn update_ui_state(
    left_panel_width: Option<i32>,
    middle_panel_width: Option<i32>,
    selected_repo_id: Option<String>,
    clear_selected_repo_id: Option<bool>,
) -> Result<AppState, AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new("store::commands::update_ui_state");
    let mut state = get_state();

    if let Some(width) = left_panel_width {
        state.left_panel_width = width;
        state.panel_widths_customized = true;
    }
    if let Some(width) = middle_panel_width {
        state.middle_panel_width = width;
        state.panel_widths_customized = true;
    }
    apply_selected_repo_id_update(
        &mut state,
        selected_repo_id,
        clear_selected_repo_id.unwrap_or(false),
    );

    update_state(state)?;
    Ok(get_bootstrap_state())
}

#[tauri::command]
pub async fn update_preferences(
    app: tauri::AppHandle,
    language: Option<String>,
    minimize_to_tray_on_close: Option<bool>,
    default_output_dir: Option<String>,
    theme: Option<String>,
    execution_history_limit: Option<usize>,
    environment_provider_ids: Option<Vec<String>>,
) -> Result<AppState, AppError> {
    let _timer =
        crate::commands::middleware::CommandTimer::new("store::commands::update_preferences");
    let mut state = get_state();
    let language_changed = language.is_some();

    if let Some(lang) = language {
        state.language = lang;
    }
    if let Some(minimize) = minimize_to_tray_on_close {
        state.minimize_to_tray_on_close = minimize;
    }
    if let Some(output_dir) = default_output_dir {
        state.default_output_dir = output_dir;
    }
    if let Some(theme) = theme {
        state.theme = theme;
    }
    if let Some(limit) = execution_history_limit {
        state.execution_history_limit = normalize_execution_history_limit(limit);
        trim_execution_history(&mut state.execution_history, state.execution_history_limit);
    }
    if let Some(provider_ids) = environment_provider_ids {
        state.environment_provider_ids = normalize_environment_provider_ids(provider_ids);
    }

    update_state(state)?;

    if language_changed {
        refresh_tray_menu(app).await;
    }

    Ok(get_bootstrap_state())
}

#[tauri::command]
pub async fn update_publish_state(
    repo_id: String,
    selected_preset: Option<String>,
    is_custom_mode: Option<bool>,
    custom_config: Option<PublishConfigStore>,
) -> Result<AppState, AppError> {
    let _timer =
        crate::commands::middleware::CommandTimer::new("store::commands::update_publish_state");
    let mut state = get_state();
    let repo = find_repository_mut(&mut state.repositories, &repo_id)?;

    if let Some(preset) = selected_preset {
        repo.publish_config.selected_preset = preset;
    }
    if let Some(mode) = is_custom_mode {
        repo.publish_config.is_custom_mode = mode;
    }
    if let Some(config) = custom_config {
        repo.publish_config.custom_config = config;
    }

    update_state(state)?;
    Ok(get_bootstrap_state())
}

#[tauri::command]
pub async fn get_profiles(repo_id: String) -> Result<Vec<ConfigProfile>, AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new("store::commands::get_profiles");
    with_read_state(|state| {
        Ok(find_repository(&state.repositories, &repo_id)?
            .publish_config
            .active_profiles()
            .into_iter()
            .cloned()
            .collect())
    })
}

/// 保存修订时解析仓库当前的 Project Candidate 并固化进修订（决议 #78）。
/// 引用与发布 spec 的构造规则一致：使用项目文件的 Provider 用仓库绑定的
/// project_file，其余用仓库根；无法解析时宽限为 None，失配由 prepare 阻断。
fn repository_project_binding(
    repo: &crate::store::Repository,
    provider_id: &str,
) -> Option<String> {
    let kind = crate::provider::registry::provider_registry()
        .get(provider_id)
        .ok()?
        .capabilities()
        .project_path_kind;
    let reference = match kind {
        crate::provider::ProviderProjectPathKind::ProjectFile => repo
            .project_file
            .clone()
            .filter(|file| !file.trim().is_empty())?,
        crate::provider::ProviderProjectPathKind::RepositoryRoot => repo.path.clone(),
    };
    crate::publish_runtime::resolve_project_binding(&repo.path, provider_id, &reference)
}

#[tauri::command]
pub async fn save_profile(
    app: tauri::AppHandle,
    repo_id: String,
    name: String,
    provider_id: String,
    parameters: serde_json::Value,
    profile_group: Option<String>,
) -> Result<AppState, AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new("store::commands::save_profile");
    let mut state = get_state();
    let repo = find_repository_mut(&mut state.repositories, &repo_id)?;

    let project_binding = repository_project_binding(repo, &provider_id);
    repo.publish_config.create_profile(
        name,
        provider_id,
        parameters,
        profile_group,
        project_binding,
        chrono::Utc::now().to_rfc3339(),
    )?;
    let response = state.clone();
    persist_state_and_refresh_tray(&app, state).await?;
    Ok(response)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn update_profile(
    app: tauri::AppHandle,
    repo_id: String,
    profile_id: String,
    name: String,
    provider_id: String,
    parameters: serde_json::Value,
    profile_group: Option<String>,
    composition: Option<crate::store::PublishComposition>,
) -> Result<AppState, AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new("store::commands::update_profile");
    let mut state = get_state();
    let repo = find_repository_mut(&mut state.repositories, &repo_id)?;

    let project_binding = repository_project_binding(repo, &provider_id);
    repo.publish_config.update_profile(
        &profile_id,
        name,
        provider_id,
        parameters,
        profile_group,
        composition,
        project_binding,
        chrono::Utc::now().to_rfc3339(),
    )?;

    let response = state.clone();
    persist_state_and_refresh_tray(&app, state).await?;
    Ok(response)
}

/// 显式换绑到当前仓库候选（决议 #78）：换绑是显式动作，产一版新修订；
/// 与更新保存的"继承绑定"语义互补。
#[tauri::command]
pub async fn rebind_profile_project(
    app: tauri::AppHandle,
    repo_id: String,
    profile_id: String,
) -> Result<AppState, AppError> {
    let _timer =
        crate::commands::middleware::CommandTimer::new("store::commands::rebind_profile_project");
    let mut state = get_state();
    let repo = find_repository_mut(&mut state.repositories, &repo_id)?;

    let provider_id = repo
        .publish_config
        .profile(&profile_id)
        .filter(|profile| profile.deleted_at.is_none())
        .and_then(|profile| profile.current_revision())
        .map(|revision| revision.provider_id.clone())
        .ok_or_else(|| {
            AppError::validation_with_code(
                format!("未找到配置文件: {profile_id}"),
                "profile_not_found",
            )
        })?;
    let project_binding = repository_project_binding(repo, &provider_id);
    repo.publish_config.rebind_profile_project(
        &profile_id,
        project_binding,
        chrono::Utc::now().to_rfc3339(),
    )?;

    let response = state.clone();
    persist_state_and_refresh_tray(&app, state).await?;
    Ok(response)
}

#[tauri::command]
pub async fn delete_profile(
    app: tauri::AppHandle,
    repo_id: String,
    profile_id: String,
) -> Result<AppState, AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new("store::commands::delete_profile");
    let mut state = get_state();
    {
        let repo = find_repository_mut(&mut state.repositories, &repo_id)?;
        repo.publish_config
            .delete_profile(&profile_id, chrono::Utc::now().to_rfc3339())?;
    }
    remove_recent_publish_config_state(
        &mut state.recent_repo_ids,
        &mut state.recent_config_keys_by_repo,
        &repo_id,
        &format!("userprofile:{profile_id}"),
    );
    let response = state.clone();
    persist_state_and_refresh_tray(&app, state).await?;
    Ok(response)
}

#[tauri::command]
pub async fn push_recent_publish_config(
    app: tauri::AppHandle,
    repo_id: String,
    config_key: String,
) -> Result<AppState, AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new(
        "store::commands::push_recent_publish_config",
    );
    let mut state = get_state();
    find_repository(&state.repositories, &repo_id)?;

    if !push_recent_publish_config_state(
        &mut state.recent_repo_ids,
        &mut state.recent_config_keys_by_repo,
        &repo_id,
        &config_key,
    ) {
        return Ok(get_bootstrap_state());
    }

    persist_state_and_refresh_tray(&app, state).await?;
    Ok(get_bootstrap_state())
}

#[tauri::command]
pub async fn remove_recent_publish_config(
    app: tauri::AppHandle,
    repo_id: String,
    config_key: String,
) -> Result<AppState, AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new(
        "store::commands::remove_recent_publish_config",
    );
    let mut state = get_state();

    if !remove_recent_publish_config_state(
        &mut state.recent_repo_ids,
        &mut state.recent_config_keys_by_repo,
        &repo_id,
        &config_key,
    ) {
        return Ok(get_bootstrap_state());
    }

    persist_state_and_refresh_tray(&app, state).await?;
    Ok(get_bootstrap_state())
}

#[tauri::command]
pub async fn replace_recent_publish_config_key(
    app: tauri::AppHandle,
    repo_id: String,
    previous_key: String,
    next_key: String,
) -> Result<AppState, AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new(
        "store::commands::replace_recent_publish_config_key",
    );
    let mut state = get_state();

    if !replace_recent_publish_config_key_state(
        &mut state.recent_config_keys_by_repo,
        &repo_id,
        &previous_key,
        &next_key,
    ) {
        return Ok(get_bootstrap_state());
    }

    persist_state_and_refresh_tray(&app, state).await?;
    Ok(get_bootstrap_state())
}

#[tauri::command]
pub async fn reorder_recent_publish_configs(
    app: tauri::AppHandle,
    repo_id: String,
    config_keys: Vec<String>,
) -> Result<AppState, AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new(
        "store::commands::reorder_recent_publish_configs",
    );
    let mut state = get_state();
    find_repository(&state.repositories, &repo_id)?;

    let current_keys = state
        .recent_config_keys_by_repo
        .get(&repo_id)
        .cloned()
        .unwrap_or_default();
    let requested_keys = normalize_ordered_ids(config_keys);

    ensure_exact_order_match(
        &current_keys,
        &requested_keys,
        "recent_config_order_mismatch",
    )?;

    if current_keys == requested_keys {
        return Ok(get_bootstrap_state());
    }

    state
        .recent_config_keys_by_repo
        .insert(repo_id, requested_keys);

    persist_state_and_refresh_tray(&app, state).await?;
    Ok(get_bootstrap_state())
}

#[tauri::command]
pub async fn reorder_profiles(
    app: tauri::AppHandle,
    repo_id: String,
    profiles: Vec<ProfileOrderEntry>,
) -> Result<AppState, AppError> {
    let _timer =
        crate::commands::middleware::CommandTimer::new("store::commands::reorder_profiles");
    let mut state = get_state();

    {
        let repo = find_repository_mut(&mut state.repositories, &repo_id)?;
        repo.publish_config.reorder_profiles(
            profiles
                .into_iter()
                .map(|entry| (entry.id, entry.profile_group))
                .collect(),
        )?;
    }

    let response = state.clone();
    persist_state_and_refresh_tray(&app, state).await?;
    Ok(response)
}

#[tauri::command]
pub async fn get_execution_history() -> Result<Vec<ExecutionRecord>, AppError> {
    let _timer =
        crate::commands::middleware::CommandTimer::new("store::commands::get_execution_history");
    Ok(get_execution_history_snapshot())
}

/// 持久化脱敏：只遮蔽密钥类值，路径/自由文本一律不动（重跑依赖原值）。
fn redact_sensitive_spec_values(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, item) in map.iter_mut() {
                if crate::security::is_sensitive_key(key) {
                    *item = serde_json::Value::String(crate::security::REDACTED_VALUE.to_string());
                    continue;
                }
                redact_sensitive_spec_values(item);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items.iter_mut() {
                redact_sensitive_spec_values(item);
            }
        }
        _ => {}
    }
}

fn sanitize_record_for_storage(record: &mut ExecutionRecord) {
    if let Some(command_line) = record.command_line.as_mut() {
        *command_line = crate::security::sanitize_secrets_in_text(command_line);
    }

    if let Some(output_excerpt) = record.output_excerpt.as_mut() {
        *output_excerpt = crate::security::sanitize_secrets_in_text(output_excerpt);
    }

    if let Some(parameters) = record
        .spec
        .as_mut()
        .and_then(|spec| spec.get_mut("parameters"))
    {
        redact_sensitive_spec_values(parameters);
    }
}

#[tauri::command]
pub async fn add_execution_record(
    record: ExecutionRecord,
) -> Result<Vec<ExecutionRecord>, AppError> {
    let _timer =
        crate::commands::middleware::CommandTimer::new("store::commands::add_execution_record");
    let mut record = record;
    sanitize_record_for_storage(&mut record);
    let mut state = get_state();
    let history_limit = state.execution_history_limit;
    append_execution_history(&mut state.execution_history, record, history_limit);
    let history = state.execution_history.clone();
    update_state(state)?;
    Ok(history)
}

#[tauri::command]
pub async fn set_execution_record_snapshot(
    record_id: String,
    snapshot_path: String,
) -> Result<Vec<ExecutionRecord>, AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new(
        "store::commands::set_execution_record_snapshot",
    );
    let mut state = get_state();
    let mut found = false;

    for record in &mut state.execution_history {
        if record.id == record_id {
            record.snapshot_path = Some(snapshot_path.clone());
            found = true;
            break;
        }
    }

    if !found {
        return Err(AppError::validation_with_code(
            format!("未找到执行记录: {}", record_id),
            "execution_record_not_found",
        ));
    }

    let history = state.execution_history.clone();
    update_state(state)?;
    Ok(history)
}

#[cfg(test)]
mod tests {
    use super::{merge_repository_metadata, sanitize_record_for_storage, ExecutionRecord};
    use crate::store::{AutomationBinding, AutomationTriggerPolicy, RepoPublishConfig, Repository};
    use serde_json::json;

    fn test_record() -> ExecutionRecord {
        ExecutionRecord {
            id: "rec-1".to_string(),
            repo_id: Some("repo-1".to_string()),
            configuration_id: None,
            configuration_revision_id: None,
            provider_id: "dotnet".to_string(),
            project_path: "/repo/App.csproj".to_string(),
            started_at: "2026-07-18T10:00:00.000Z".to_string(),
            finished_at: "2026-07-18T10:00:03.000Z".to_string(),
            success: true,
            cancelled: false,
            output_dir: Some("/repo/out".to_string()),
            error: None,
            command_line: None,
            snapshot_path: None,
            failure_signature: None,
            output_excerpt: None,
            spec: None,
            file_count: 2,
            warnings: None,
        }
    }

    #[test]
    fn repository_metadata_update_preserves_authoritative_publish_history() {
        let mut publish_config = RepoPublishConfig::default();
        let profile = publish_config
            .create_profile(
                "Release".to_string(),
                "dotnet".to_string(),
                serde_json::json!({ "configuration": "Release" }),
                None,
                None,
                "2026-07-21T10:00:00Z".to_string(),
            )
            .expect("create profile")
            .clone();
        let deleted_profile = publish_config
            .create_profile(
                "Deleted".to_string(),
                "dotnet".to_string(),
                serde_json::json!({ "configuration": "Debug" }),
                None,
                None,
                "2026-07-21T09:00:00Z".to_string(),
            )
            .expect("create profile to delete")
            .clone();
        publish_config
            .delete_profile(&deleted_profile.id, "2026-07-21T09:30:00Z".to_string())
            .expect("tombstone profile");
        publish_config.bindings.push(AutomationBinding {
            id: "binding-1".to_string(),
            configuration_id: profile.id.clone(),
            configuration_revision_id: profile.current_revision_id.clone(),
            execution_backend_id: "fake-automation".to_string(),
            trigger_policy: AutomationTriggerPolicy::Manual,
            backend_projection: serde_json::Value::Null,
            runtime_revision: one_publish_runner::current_runtime_revision([
                publish_domain::AdapterIdentity::new(
                    publish_domain::AdapterKind::ExecutionBackend,
                    "fake-automation",
                    1,
                ),
            ])
            .expect("seal test runtime revision")
            .into(),
            external_identity: "one-publish/automation/binding-1.json".to_string(),
            created_at: "2026-07-21T10:00:00Z".to_string(),
            updated_at: "2026-07-21T10:00:00Z".to_string(),
        });
        let existing = Repository {
            id: "repo-1".to_string(),
            name: "Before".to_string(),
            path: "/repo".to_string(),
            project_file: None,
            current_branch: "main".to_string(),
            branches: Vec::new(),
            is_main: true,
            provider_id: Some("dotnet".to_string()),
            publish_config,
        };
        let update = Repository {
            name: "After".to_string(),
            publish_config: RepoPublishConfig::default(),
            ..existing.clone()
        };

        let merged = merge_repository_metadata(&existing, update);

        assert_eq!(merged.name, "After");
        assert_eq!(merged.publish_config.profiles.len(), 2);
        assert_eq!(
            merged.publish_config.profiles[0].current_revision_id,
            profile.current_revision_id
        );
        assert_eq!(
            merged.publish_config.profiles[0].revisions,
            profile.revisions
        );
        assert_eq!(merged.publish_config.bindings.len(), 1);
        assert!(merged
            .publish_config
            .profile(&deleted_profile.id)
            .expect("tombstone remains")
            .deleted_at
            .is_some());
    }

    #[test]
    fn sanitize_record_for_storage_redacts_spec_secrets_and_preserves_paths() {
        let mut record = test_record();
        record.spec = Some(json!({
            "provider_id": "dotnet",
            "project_path": "/repo/App.csproj",
            "parameters": {
                "ClientSecret": "x",
                "output": "/tmp/o",
                "properties": {
                    "PublishProfile": "FolderProfile",
                    "ClientSecret": "nested-secret"
                }
            }
        }));

        sanitize_record_for_storage(&mut record);

        let spec = record.spec.expect("spec");
        assert_eq!(spec["parameters"]["ClientSecret"], "<redacted>");
        assert_eq!(
            spec["parameters"]["properties"]["ClientSecret"], "<redacted>",
            "嵌套 properties 内的密钥也必须被遮蔽"
        );
        assert_eq!(spec["parameters"]["output"], "/tmp/o");
        assert_eq!(
            spec["parameters"]["properties"]["PublishProfile"],
            "FolderProfile"
        );
        assert_eq!(spec["project_path"], "/repo/App.csproj");
    }

    #[test]
    fn sanitize_record_for_storage_redacts_command_line_and_excerpt_secrets() {
        let mut record = test_record();
        record.command_line = Some(
            "$ dotnet publish /repo/App.csproj -p:Password=hunter2 --output /tmp/out".to_string(),
        );
        record.output_excerpt = Some("error: token=abc123 rejected".to_string());

        sanitize_record_for_storage(&mut record);

        let command_line = record.command_line.expect("command line");
        assert!(command_line.contains("-p:Password=<redacted>"));
        assert!(!command_line.contains("hunter2"));
        assert!(command_line.contains("/tmp/out"));
        assert!(command_line.contains("/repo/App.csproj"));

        let excerpt = record.output_excerpt.expect("output excerpt");
        assert!(excerpt.contains("token=<redacted>"));
        assert!(!excerpt.contains("abc123"));
    }

    #[test]
    fn sanitize_record_for_storage_preserves_rerun_fields() {
        let mut record = test_record();
        record.spec = Some(json!({
            "project_path": "/repo/App.csproj",
            "parameters": {
                "ApiKey": "secret",
                "output": "/tmp/o"
            }
        }));

        sanitize_record_for_storage(&mut record);

        assert_eq!(record.project_path, "/repo/App.csproj");
        assert_eq!(record.output_dir.as_deref(), Some("/repo/out"));
        let spec = record.spec.expect("spec");
        assert_eq!(spec["project_path"], "/repo/App.csproj");
        assert_eq!(spec["parameters"]["ApiKey"], "<redacted>");
        assert_eq!(spec["parameters"]["output"], "/tmp/o");
    }

    #[test]
    fn sanitize_record_for_storage_leaves_non_sensitive_record_untouched() {
        let mut record = test_record();
        record.command_line =
            Some("$ dotnet publish /repo/App.csproj --output /tmp/out".to_string());
        record.output_excerpt = Some("Build succeeded in 1.2s".to_string());
        record.spec = Some(json!({
            "parameters": {
                "configuration": "Release",
                "output": "/tmp/o"
            }
        }));
        let original = record.clone();

        sanitize_record_for_storage(&mut record);

        assert_eq!(record.id, original.id);
        assert_eq!(record.repo_id, original.repo_id);
        assert_eq!(record.provider_id, original.provider_id);
        assert_eq!(record.project_path, original.project_path);
        assert_eq!(record.started_at, original.started_at);
        assert_eq!(record.finished_at, original.finished_at);
        assert_eq!(record.success, original.success);
        assert_eq!(record.cancelled, original.cancelled);
        assert_eq!(record.output_dir, original.output_dir);
        assert_eq!(record.error, original.error);
        assert_eq!(record.command_line, original.command_line);
        assert_eq!(record.snapshot_path, original.snapshot_path);
        assert_eq!(record.failure_signature, original.failure_signature);
        assert_eq!(record.output_excerpt, original.output_excerpt);
        assert_eq!(record.spec, original.spec);
        assert_eq!(record.file_count, original.file_count);
        assert_eq!(record.warnings, original.warnings);
    }
}
