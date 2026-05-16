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
    pub name: String,
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
    let _timer = crate::commands::middleware::CommandTimer::new("store::commands::remove_repository");
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

#[tauri::command]
pub async fn update_repository(
    app: tauri::AppHandle,
    repo: Repository,
) -> Result<AppState, AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new("store::commands::update_repository");
    let mut state = get_state();
    validate_repository_project_binding(&repo).await?;

    if let Some(existing) = state
        .repositories
        .iter_mut()
        .find(|item| item.id == repo.id)
    {
        *existing = repo;
    }

    persist_state_and_refresh_tray(&app, state).await?;
    Ok(get_bootstrap_state())
}

#[tauri::command]
pub async fn reorder_repositories(
    app: tauri::AppHandle,
    repo_ids: Vec<String>,
) -> Result<AppState, AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new("store::commands::reorder_repositories");
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
) -> Result<(), AppError> {
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

    update_state(state)
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
    let _timer = crate::commands::middleware::CommandTimer::new("store::commands::update_preferences");
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
) -> Result<(), AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new("store::commands::update_publish_state");
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

    update_state(state)
}

#[tauri::command]
pub async fn get_profiles(repo_id: String) -> Result<Vec<ConfigProfile>, AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new("store::commands::get_profiles");
    with_read_state(|state| {
        Ok(find_repository(&state.repositories, &repo_id)?
            .publish_config
            .profiles
            .clone())
    })
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

    if repo
        .publish_config
        .profiles
        .iter()
        .any(|profile| profile.name == name)
    {
        return Err(AppError::validation_with_code(
            format!("配置文件 '{}' 已存在", name),
            "profile_exists",
        ));
    }

    let normalized_profile_group = profile_group
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let profile = ConfigProfile {
        name: name.clone(),
        provider_id,
        parameters,
        profile_group: normalized_profile_group,
        created_at: chrono::Utc::now().to_rfc3339(),
        is_system_default: false,
    };

    repo.publish_config.profiles.push(profile);
    let response = state.clone();
    persist_state_and_refresh_tray(&app, state).await?;
    Ok(response)
}

#[tauri::command]
pub async fn update_profile(
    app: tauri::AppHandle,
    repo_id: String,
    original_name: String,
    name: String,
    provider_id: String,
    parameters: serde_json::Value,
    profile_group: Option<String>,
) -> Result<AppState, AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new("store::commands::update_profile");
    let mut state = get_state();
    let repo = find_repository_mut(&mut state.repositories, &repo_id)?;

    if original_name != name
        && repo
            .publish_config
            .profiles
            .iter()
            .any(|profile| profile.name == name)
    {
        return Err(AppError::validation_with_code(
            format!("配置文件 '{}' 已存在", name),
            "profile_exists",
        ));
    }

    let normalized_profile_group = profile_group
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let profile = repo
        .publish_config
        .profiles
        .iter_mut()
        .find(|profile| profile.name == original_name)
        .ok_or_else(|| {
            AppError::validation_with_code(
                format!("未找到配置文件: {}", original_name),
                "profile_not_found",
            )
        })?;

    if profile.is_system_default {
        return Err(AppError::validation_with_code(
            "不能编辑系统默认配置文件",
            "system_profile_immutable",
        ));
    }

    profile.name = name;
    profile.provider_id = provider_id;
    profile.parameters = parameters;
    profile.profile_group = normalized_profile_group;

    let response = state.clone();
    persist_state_and_refresh_tray(&app, state).await?;
    Ok(response)
}

#[tauri::command]
pub async fn delete_profile(
    app: tauri::AppHandle,
    repo_id: String,
    name: String,
) -> Result<AppState, AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new("store::commands::delete_profile");
    let mut state = get_state();
    let repo = find_repository_mut(&mut state.repositories, &repo_id)?;

    if let Some(profile) = repo
        .publish_config
        .profiles
        .iter()
        .find(|profile| profile.name == name)
    {
        if profile.is_system_default {
            return Err(AppError::validation_with_code(
                "不能删除系统默认配置文件",
                "system_profile_immutable",
            ));
        }
    }

    repo.publish_config
        .profiles
        .retain(|profile| profile.name != name);
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
    let _timer = crate::commands::middleware::CommandTimer::new("store::commands::push_recent_publish_config");
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
    let _timer = crate::commands::middleware::CommandTimer::new("store::commands::remove_recent_publish_config");
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
    let _timer = crate::commands::middleware::CommandTimer::new("store::commands::replace_recent_publish_config_key");
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
    let _timer = crate::commands::middleware::CommandTimer::new("store::commands::reorder_recent_publish_configs");
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
    let _timer = crate::commands::middleware::CommandTimer::new("store::commands::reorder_profiles");
    let mut state = get_state();

    {
        let repo = find_repository_mut(&mut state.repositories, &repo_id)?;
        let current_names = repo
            .publish_config
            .profiles
            .iter()
            .map(|profile| profile.name.clone())
            .collect::<Vec<_>>();
        let requested_names = normalize_ordered_ids(
            profiles
                .iter()
                .map(|profile| profile.name.clone())
                .collect::<Vec<_>>(),
        );

        ensure_exact_order_match(&current_names, &requested_names, "profile_order_mismatch")?;

        if current_names == requested_names
            && repo
                .publish_config
                .profiles
                .iter()
                .zip(profiles.iter())
                .all(|(current, next)| {
                    current.profile_group.as_deref().unwrap_or("").trim()
                        == next.profile_group.as_deref().unwrap_or("").trim()
                })
        {
            return Ok(get_bootstrap_state());
        }

        let mut profile_map = repo
            .publish_config
            .profiles
            .drain(..)
            .map(|profile| (profile.name.clone(), profile))
            .collect::<BTreeMap<_, _>>();

        let next_profiles = profiles
            .into_iter()
            .filter_map(|entry| {
                profile_map.remove(&entry.name).map(|mut profile| {
                    profile.profile_group = entry
                        .profile_group
                        .map(|value| value.trim().to_string())
                        .filter(|value| !value.is_empty());
                    profile
                })
            })
            .collect::<Vec<_>>();

        repo.publish_config.profiles = next_profiles;
    }

    let response = state.clone();
    persist_state_and_refresh_tray(&app, state).await?;
    Ok(response)
}

#[tauri::command]
pub async fn get_execution_history() -> Result<Vec<ExecutionRecord>, AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new("store::commands::get_execution_history");
    Ok(get_execution_history_snapshot())
}

#[tauri::command]
pub async fn add_execution_record(
    record: ExecutionRecord,
) -> Result<Vec<ExecutionRecord>, AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new("store::commands::add_execution_record");
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
    let _timer = crate::commands::middleware::CommandTimer::new("store::commands::set_execution_record_snapshot");
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