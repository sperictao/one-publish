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
    AppError::validation_with_code("未找到仓库", "repository_not_found").with_details(repo_id)
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

    // 仓库是源码容器，可以先添加再绑定；只有已声明的绑定必须有效。
    let bound_project_file = repo.project_file.as_deref().map(str::trim).unwrap_or("");
    if bound_project_file.is_empty() {
        return Ok(());
    }
    let candidates = crate::commands::scan_provider_project_candidates_from_path(
        Path::new(repo_path),
        repo.provider_id.as_deref(),
    )?;
    // 兼容旧仓库中保存的解决方案路径，它由前端继续解析为项目。
    if candidates
        .solution_files
        .iter()
        .any(|path| path == bound_project_file)
    {
        return Ok(());
    }
    if candidates
        .project_files
        .iter()
        .any(|candidate| candidate == bound_project_file)
    {
        return Ok(());
    }

    Err(AppError::repository_with_code(
        "bound project file was not found for this provider; choose a project candidate again",
        "project_binding_not_found",
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
    let mut repositories = state.repositories.clone();
    for repository in &mut repositories {
        repository
            .publish_config
            .profiles
            .retain(|profile| profile.deleted_at.is_none());
    }

    AppState {
        repositories,
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
    let mut guard = state_store().write().map_err(|error| {
        crate::errors::AppError::store_with_code("写入状态锁失败", "store_lock_write_failed")
            .with_details(error.to_string())
    })?;
    let mut normalized = sanitize_state(new_state);
    save_to_file(&normalized)?;
    normalized.startup_notice = None;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::types::{ConfigProfile, RepoPublishConfig};

    fn test_repository(id: &str) -> Repository {
        Repository {
            id: id.to_string(),
            name: format!("Repo {id}"),
            path: format!("/repos/{id}"),
            project_file: None,
            current_branch: "main".to_string(),
            branches: Vec::new(),
            is_main: true,
            provider_id: None,
            publish_config: RepoPublishConfig::default(),
        }
    }

    fn test_profile(id: &str, deleted_at: Option<&str>) -> ConfigProfile {
        ConfigProfile {
            id: id.to_string(),
            name: id.to_string(),
            profile_group: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            is_system_default: false,
            is_draft: false,
            current_revision_id: String::new(),
            revisions: Vec::new(),
            deleted_at: deleted_at.map(str::to_string),
            blocked_reason: None,
        }
    }

    #[test]
    fn find_repository_locates_by_id_and_reports_missing() {
        let repositories = vec![test_repository("repo-1"), test_repository("repo-2")];

        assert_eq!(
            find_repository(&repositories, "repo-2")
                .map(|repo| repo.id.as_str())
                .unwrap(),
            "repo-2"
        );

        let err = find_repository(&repositories, "missing").unwrap_err();
        assert_eq!(err.code.as_deref(), Some("repository_not_found"));
        assert_eq!(err.details.as_deref(), Some("missing"));
    }

    #[test]
    fn find_repository_mut_allows_in_place_update() {
        let mut repositories = vec![test_repository("repo-1")];
        find_repository_mut(&mut repositories, "repo-1")
            .unwrap()
            .current_branch = "release".to_string();
        assert_eq!(repositories[0].current_branch, "release");
        assert!(find_repository_mut(&mut repositories, "other").is_err());
    }

    #[test]
    fn provider_requires_project_binding_defaults_fail_closed() {
        // 未声明/空白 provider 视为需要绑定（保守语义）。
        assert!(provider_requires_project_binding(None));
        assert!(provider_requires_project_binding(Some("")));
        assert!(provider_requires_project_binding(Some("   ")));
        // 未知 provider id 同样按需要绑定处理。
        assert!(provider_requires_project_binding(Some("no-such-provider")));
    }

    #[test]
    fn apply_selected_repo_id_update_honours_clear_flag() {
        let mut state = AppState::default();

        apply_selected_repo_id_update(&mut state, Some("repo-1".into()), false);
        assert_eq!(state.selected_repo_id.as_deref(), Some("repo-1"));

        // 非清除调用携带 None 时保留既有选择。
        apply_selected_repo_id_update(&mut state, None, false);
        assert_eq!(state.selected_repo_id.as_deref(), Some("repo-1"));

        apply_selected_repo_id_update(&mut state, Some("ignored".into()), true);
        assert_eq!(state.selected_repo_id, None);
    }

    #[test]
    fn build_frontend_state_drops_deleted_profiles_and_empties_history() {
        let mut repo = test_repository("repo-1");
        repo.publish_config.profiles = vec![
            test_profile("alive", None),
            test_profile("gone", Some("2026-01-02T00:00:00Z")),
        ];
        let mut state = AppState {
            repositories: vec![repo],
            selected_repo_id: Some("repo-1".to_string()),
            ..AppState::default()
        };
        state.execution_history = vec![ExecutionRecord {
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
            output_dir: None,
            error: None,
            command_line: None,
            snapshot_path: None,
            failure_signature: None,
            output_excerpt: None,
            spec: None,
            attempt_id: None,
            recovery_snapshot: None,
            file_count: 0,
            warnings: None,
            manifest_digest: None,
        }];

        let frontend = build_frontend_state(&state);

        let profiles = &frontend.repositories[0].publish_config.profiles;
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].id, "alive");
        // 前端态绝不携带执行历史——历史经专用快照接口分发。
        assert!(frontend.execution_history.is_empty());
        assert_eq!(frontend.selected_repo_id.as_deref(), Some("repo-1"));
        // 源状态不被修改。
        assert_eq!(state.execution_history.len(), 1);
        assert_eq!(state.repositories[0].publish_config.profiles.len(), 2);
    }
}
