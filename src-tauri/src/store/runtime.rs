use super::migration::sanitize_state;
use super::persistence::{load_from_file, save_to_file};
use super::types::{AppState, ExecutionRecord, Repository};
use crate::errors::AppError;
use std::path::Path;
use std::sync::{OnceLock, RwLock};

static STATE_STORE: OnceLock<RwLock<AppState>> = OnceLock::new();

fn state_store() -> &'static RwLock<AppState> {
    STATE_STORE.get_or_init(|| RwLock::new(load_from_file()))
}

pub(crate) fn with_read_state<T>(reader: impl FnOnce(&AppState) -> T) -> T {
    match state_store().read() {
        Ok(guard) => reader(&guard),
        Err(err) => {
            log::error!("读取状态锁失败: {}", err);
            let guard = err.into_inner();
            reader(&guard)
        }
    }
}

fn repository_not_found_error(repo_id: &str) -> AppError {
    AppError::validation_with_code(format!("未找到仓库: {}", repo_id), "repository_not_found")
}

fn provider_requires_project_binding(provider_id: Option<&str>) -> bool {
    let Some(provider_id) = provider_id.map(str::trim).filter(|value| !value.is_empty()) else {
        return true;
    };

    crate::provider::registry::provider_registry()
        .get(provider_id)
        .map(|provider| provider.capabilities().requires_project_binding)
        .unwrap_or(true)
}

pub(crate) async fn validate_repository_project_binding(repo: &Repository) -> Result<(), AppError> {
    if !provider_requires_project_binding(repo.provider_id.as_deref()) {
        return Ok(());
    }

    let repo_path = repo.path.trim();
    if repo_path.is_empty() || !Path::new(repo_path).exists() {
        return Ok(());
    }

    let candidates = match crate::commands::scan_project_candidates_from_path(Path::new(repo_path))
    {
        Ok(candidates) => candidates,
        Err(error) => {
            log::warn!(
                "仓库项目绑定校验跳过，无法扫描候选项目。路径: {}, 错误: {}",
                repo_path,
                error
            );
            return Ok(());
        }
    };

    if candidates.project_files.len() <= 1 {
        return Ok(());
    }

    let bound_project_file = repo.project_file.as_deref().map(str::trim).unwrap_or("");
    if candidates
        .project_files
        .iter()
        .any(|candidate| candidate == bound_project_file)
    {
        return Ok(());
    }

    Err(AppError::repository_with_code(
        "multiple project files found; bind an explicit project file first",
        "multiple_project_files_found",
    ))
}

pub(crate) fn find_repository<'a>(
    repositories: &'a [Repository],
    repo_id: &str,
) -> Result<&'a Repository, AppError> {
    repositories
        .iter()
        .find(|repository| repository.id == repo_id)
        .ok_or_else(|| repository_not_found_error(repo_id))
}

pub(crate) fn find_repository_mut<'a>(
    repositories: &'a mut [Repository],
    repo_id: &str,
) -> Result<&'a mut Repository, AppError> {
    repositories
        .iter_mut()
        .find(|repository| repository.id == repo_id)
        .ok_or_else(|| repository_not_found_error(repo_id))
}

pub fn get_state() -> AppState {
    with_read_state(|state| state.clone())
}

pub(crate) fn get_bootstrap_state() -> AppState {
    with_read_state(build_frontend_state)
}

pub(crate) fn apply_selected_repo_id_update(
    state: &mut AppState,
    selected_repo_id: Option<String>,
    clear_selected_repo_id: bool,
) {
    if clear_selected_repo_id {
        state.selected_repo_id = None;
    } else if let Some(repo_id) = selected_repo_id {
        state.selected_repo_id = Some(repo_id);
    }
}

pub(crate) fn get_execution_history_snapshot() -> Vec<ExecutionRecord> {
    with_read_state(|state| state.execution_history.clone())
}

pub(crate) fn build_frontend_state(state: &AppState) -> AppState {
    AppState {
        repositories: state.repositories.clone(),
        selected_repo_id: state.selected_repo_id.clone(),
        left_panel_width: state.left_panel_width,
        middle_panel_width: state.middle_panel_width,
        panel_widths_customized: state.panel_widths_customized,
        minimize_to_tray_on_close: state.minimize_to_tray_on_close,
        language: state.language.clone(),
        default_output_dir: state.default_output_dir.clone(),
        theme: state.theme.clone(),
        execution_history_limit: state.execution_history_limit,
        environment_provider_ids: state.environment_provider_ids.clone(),
        recent_repo_ids: state.recent_repo_ids.clone(),
        recent_config_keys_by_repo: state.recent_config_keys_by_repo.clone(),
        execution_history: Vec::new(),
        startup_notice: state.startup_notice.clone(),
    }
}

pub fn update_state(new_state: AppState) -> Result<(), crate::errors::AppError> {
    let mut normalized = sanitize_state(new_state);
    save_to_file(&normalized)?;
    normalized.startup_notice = None;

    let mut guard = state_store().write().map_err(|error| {
        crate::errors::AppError::store_with_code(
            format!("写入状态锁失败: {}", error),
            "store_lock_write_failed",
        )
    })?;
    *guard = normalized;
    Ok(())
}

pub(crate) async fn refresh_tray_menu(app: tauri::AppHandle) {
    if let Err(error) = crate::tray::update_tray_menu(app.clone()).await {
        log::warn!("刷新托盘菜单失败: {}", error);
    }
}

pub(crate) async fn persist_state_and_refresh_tray(
    app: &tauri::AppHandle,
    state: AppState,
) -> Result<(), AppError> {
    update_state(state)?;
    refresh_tray_menu(app.clone()).await;
    Ok(())
}

pub(crate) fn append_execution_history(
    history: &mut Vec<ExecutionRecord>,
    record: ExecutionRecord,
    execution_history_limit: usize,
) {
    history.insert(0, record);
    super::types::trim_execution_history(history, execution_history_limit);
}
