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
    AppState, ConfigProfile, ExecutionRecord, PublishComposition, PublishConfigurationRevision,
    PublishSelectionRef, Repository, ScopedPublishDraft, CURRENT_SETTINGS_VERSION,
    PUBLISH_CONFIGURATION_CONTRACT_VERSION,
};
use crate::errors::AppError;
use crate::publish_runtime::PublishBaseRevisionRef;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileOrderEntry {
    pub id: String,
    #[serde(default)]
    pub profile_group: Option<String>,
}

/// 是否按 Windows 路径规则处理（盘符 / 反斜杠 / UNC 前缀）。
fn is_windows_like_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    let has_drive_prefix = bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':';

    has_drive_prefix || path.contains('\\') || path.starts_with("\\\\")
}

/// 仓库路径比较用的归一化：去掉首尾空白与尾部分隔符，Windows 风格路径忽略大小写。
///
/// 与前端 `isSameRepositoryPath` 保持同一套规则（POSIX 路径按大小写敏感处理）。
/// 不解析符号链接 —— 那是文件系统语义，且对不存在的路径会失败。
pub(super) fn normalize_repository_path(path: &str) -> String {
    let trimmed = path.trim();
    let without_trailing = trimmed.trim_end_matches(['/', '\\']);
    // 根路径（"/"、"C:\"）整串都是分隔符，去尾后会变空，此时保留原文
    let normalized = if without_trailing.is_empty() {
        trimmed
    } else {
        without_trailing
    };

    if is_windows_like_path(normalized) {
        normalized.to_ascii_lowercase()
    } else {
        normalized.to_string()
    }
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

/// 新增仓库前的判重：路径经同一归一化规则比较，命中即拒绝（repository_exists）。
fn ensure_repository_path_absent(
    repositories: &[Repository],
    candidate_path: &str,
) -> Result<(), AppError> {
    let normalized_path = normalize_repository_path(candidate_path);
    if repositories
        .iter()
        .any(|repository| normalize_repository_path(&repository.path) == normalized_path)
    {
        return Err(AppError::validation_with_code(
            "仓库已存在",
            "repository_exists",
        ));
    }
    Ok(())
}

/// 删除仓库并维护选中引用：被删的是当前选中项时回退到剩余列表首位。
fn remove_repository_by_id(
    repositories: &mut Vec<Repository>,
    selected_repo_id: &mut Option<String>,
    repo_id: &str,
) {
    repositories.retain(|repository| repository.id != repo_id);

    if selected_repo_id.as_deref() == Some(repo_id) {
        *selected_repo_id = repositories.first().map(|repository| repository.id.clone());
    }
}

/// 应用已校验的顺序：只按 id 重新排列，缺项由前置校验拦截，此处防御性丢弃。
fn apply_repository_order(
    repositories: Vec<Repository>,
    ordered_ids: Vec<String>,
) -> Vec<Repository> {
    let mut repository_map = repositories
        .into_iter()
        .map(|repository| (repository.id.clone(), repository))
        .collect::<BTreeMap<_, _>>();

    ordered_ids
        .into_iter()
        .filter_map(|repo_id| repository_map.remove(&repo_id))
        .collect()
}

fn apply_panel_width_update(
    state: &mut AppState,
    left_panel_width: Option<i32>,
    middle_panel_width: Option<i32>,
) {
    if let Some(width) = left_panel_width {
        state.left_panel_width = width;
        state.panel_widths_customized = true;
    }
    if let Some(width) = middle_panel_width {
        state.middle_panel_width = width;
        state.panel_widths_customized = true;
    }
}

/// 偏好补丁：None 字段保持原值；返回是否修改了语言（决定是否刷新托盘）。
#[derive(Debug, Default)]
struct PreferenceUpdate {
    language: Option<String>,
    minimize_to_tray_on_close: Option<bool>,
    default_output_dir: Option<String>,
    theme: Option<String>,
    execution_history_limit: Option<usize>,
    environment_provider_ids: Option<Vec<String>>,
}

fn apply_preference_update(state: &mut AppState, update: PreferenceUpdate) -> bool {
    let language_changed = update.language.is_some();

    if let Some(lang) = update.language {
        state.language = lang;
    }
    if let Some(minimize) = update.minimize_to_tray_on_close {
        state.minimize_to_tray_on_close = minimize;
    }
    if let Some(output_dir) = update.default_output_dir {
        state.default_output_dir = output_dir;
    }
    if let Some(theme) = update.theme {
        state.theme = theme;
    }
    if let Some(limit) = update.execution_history_limit {
        state.execution_history_limit = normalize_execution_history_limit(limit);
        trim_execution_history(&mut state.execution_history, state.execution_history_limit);
    }
    if let Some(provider_ids) = update.environment_provider_ids {
        state.environment_provider_ids = normalize_environment_provider_ids(provider_ids);
    }

    language_changed
}

/// 发布设置表单的初值决策（ADR-0060）：修订已有可读设置时原样返回；否则按
/// 项目绑定（存量修订退回仓库当前候选）探测建议值，不写入修订。
fn resolve_release_settings_draft(
    repo: &Repository,
    revision: &PublishConfigurationRevision,
) -> crate::tauri_release::ReleaseSettingsDraft {
    if let Ok(Some(settings)) =
        crate::tauri_release::release_settings_from_parameters(&revision.parameters)
    {
        return crate::tauri_release::ReleaseSettingsDraft {
            settings,
            stored: true,
        };
    }
    let project_binding = revision
        .project_binding
        .clone()
        .or_else(|| repository_project_binding(repo, publish_adapters::TAURI_PROVIDER_ID));
    let config_path = project_binding.as_deref().and_then(|binding| {
        crate::publish_runtime::project_binding_selector(
            publish_adapters::TAURI_PROVIDER_ID,
            binding,
        )
    });
    crate::tauri_release::ReleaseSettingsDraft {
        settings: crate::tauri_release::suggested_release_settings(
            std::path::Path::new(&repo.path),
            config_path,
        ),
        stored: false,
    }
}

/// 为执行记录写入快照路径；记录不存在时返回 false（由调用方转成校验错误）。
fn set_record_snapshot_path(
    records: &mut [ExecutionRecord],
    record_id: &str,
    snapshot_path: String,
) -> bool {
    let Some(record) = records.iter_mut().find(|record| record.id == record_id) else {
        return false;
    };
    record.snapshot_path = Some(snapshot_path);
    true
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

/// 新增仓库：判重后入列并选中新增项。
fn add_repository_in_state(state: &mut AppState, repo: &Repository) -> Result<(), AppError> {
    ensure_repository_path_absent(&state.repositories, &repo.path)?;
    state.repositories.push(repo.clone());
    state.selected_repo_id = Some(repo.id.clone());
    Ok(())
}

#[tauri::command]
pub async fn add_repository(app: tauri::AppHandle, repo: Repository) -> Result<AppState, AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new("store::commands::add_repository");
    let mut state = get_state();
    add_repository_in_state(&mut state, &repo)?;
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
    remove_repository_by_id(
        &mut state.repositories,
        &mut state.selected_repo_id,
        &repo_id,
    );

    persist_state_and_refresh_tray(&app, state).await?;
    Ok(get_bootstrap_state())
}

fn merge_repository_metadata(existing: &Repository, mut update: Repository) -> Repository {
    update.publish_config = existing.publish_config.clone();
    update
}

/// 更新仓库前的暂存：定位既有仓库并继承权威 publish_config（含历史修订）。
/// 返回的合并结果仍需经项目绑定校验才可写回。
fn stage_repository_update(state: &AppState, repo: Repository) -> Result<Repository, AppError> {
    let existing = find_repository(&state.repositories, &repo.id)?;
    Ok(merge_repository_metadata(existing, repo))
}

#[tauri::command]
pub async fn update_repository(
    app: tauri::AppHandle,
    repo: Repository,
) -> Result<AppState, AppError> {
    let _timer =
        crate::commands::middleware::CommandTimer::new("store::commands::update_repository");
    let mut state = get_state();
    let repo = stage_repository_update(&state, repo)?;
    validate_repository_project_binding(&repo).await?;
    let repo_id = repo.id.clone();
    *find_repository_mut(&mut state.repositories, &repo_id)? = repo;

    persist_state_and_refresh_tray(&app, state).await?;
    Ok(get_bootstrap_state())
}

/// 应用仓库重排：成员集校验先于同序短路——请求必须恰好覆盖当前 id 集合；
/// 相同顺序返回 false 表示无需落盘。
fn apply_repository_reorder(state: &mut AppState, repo_ids: Vec<String>) -> Result<bool, AppError> {
    let requested_ids = normalize_ordered_ids(repo_ids);
    let current_ids = state
        .repositories
        .iter()
        .map(|repository| repository.id.clone())
        .collect::<Vec<_>>();

    ensure_exact_order_match(&current_ids, &requested_ids, "repository_order_mismatch")?;

    if current_ids == requested_ids {
        return Ok(false);
    }

    state.repositories =
        apply_repository_order(std::mem::take(&mut state.repositories), requested_ids);
    Ok(true)
}

#[tauri::command]
pub async fn reorder_repositories(
    app: tauri::AppHandle,
    repo_ids: Vec<String>,
) -> Result<AppState, AppError> {
    let _timer =
        crate::commands::middleware::CommandTimer::new("store::commands::reorder_repositories");
    let mut state = get_state();
    if !apply_repository_reorder(&mut state, repo_ids)? {
        return Ok(get_bootstrap_state());
    }

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
    apply_panel_width_update(&mut state, left_panel_width, middle_panel_width);
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
    let language_changed = apply_preference_update(
        &mut state,
        PreferenceUpdate {
            language,
            minimize_to_tray_on_close,
            default_output_dir,
            theme,
            execution_history_limit,
            environment_provider_ids,
        },
    );

    update_state(state)?;

    if language_changed {
        refresh_tray_menu(app).await;
    }

    Ok(get_bootstrap_state())
}

/// 显式编辑状态协议（§4.1 v4）：设置选择引用与/或写入当前作用域草稿。
/// 草稿提交只携带前端拥有的数据（Provider、绑定、参数、基准修订），
/// 版本与组合由后端补全；写入草稿时自动选中该草稿作用域。
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct PublishEditStateUpdate {
    #[serde(default)]
    #[ts(optional)]
    pub selection: Option<PublishSelectionRef>,
    #[serde(default)]
    #[ts(optional)]
    pub draft: Option<PublishDraftSubmission>,
}

/// 草稿提交载荷：完整参数一次写入，不做富表单往返。
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct PublishDraftSubmission {
    #[serde(rename = "providerId")]
    #[ts(rename = "providerId")]
    pub provider_id: String,
    #[serde(rename = "projectBinding")]
    #[ts(rename = "projectBinding")]
    #[serde(default)]
    #[ts(optional)]
    pub project_binding: Option<String>,
    pub parameters: serde_json::Value,
    #[serde(rename = "baseRevision")]
    #[ts(rename = "baseRevision")]
    #[serde(default)]
    #[ts(optional)]
    pub base_revision: Option<PublishBaseRevisionRef>,
}

/// 编辑状态更新（§4.1 v4）：草稿优先——写入草稿时自动选中该草稿作用域；
/// 仅给选择时校验所选修订与仓库 Provider 一致。两者皆空为合法 no-op。
fn apply_publish_edit_update(
    repo: &mut Repository,
    update: PublishEditStateUpdate,
) -> Result<(), AppError> {
    if let Some(draft) = update.draft {
        let project_binding = upsert_edit_draft(
            repo,
            &draft.provider_id,
            draft.project_binding.clone(),
            draft.parameters,
            draft.base_revision,
        )?;
        repo.publish_config.selection = Some(PublishSelectionRef::Draft {
            provider_id: draft.provider_id,
            project_binding,
        });
    } else if let Some(selection) = update.selection {
        ensure_selection_matches_repository_provider(repo, &selection)?;
        repo.publish_config.selection = Some(selection);
    }
    Ok(())
}

#[tauri::command]
pub async fn update_publish_edit_state(
    repo_id: String,
    update: PublishEditStateUpdate,
) -> Result<AppState, AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new(
        "store::commands::update_publish_edit_state",
    );
    let mut state = get_state();
    let repo = find_repository_mut(&mut state.repositories, &repo_id)?;
    apply_publish_edit_update(repo, update)?;

    update_state(state)?;
    Ok(get_bootstrap_state())
}

/// 命名配置的当前修订必须属于仓库声明的 Provider；跨 Provider 导入的存量
/// 配置不能被选为当前发布配置。
fn ensure_selection_matches_repository_provider(
    repo: &Repository,
    selection: &PublishSelectionRef,
) -> Result<(), AppError> {
    let PublishSelectionRef::Revision { configuration_id } = selection else {
        return Ok(());
    };
    let Some(revision) = repo
        .publish_config
        .profile(configuration_id)
        .and_then(ConfigProfile::current_revision)
    else {
        return Ok(());
    };
    match repo.provider_mismatch_reason(&revision.provider_id) {
        Some(reason) => Err(AppError::validation_with_code(
            "配置的 Provider 与仓库不一致，不能选择",
            "publish_selection_provider_mismatch",
        )
        .with_details(reason)),
        None => Ok(()),
    }
}

fn upsert_edit_draft(
    repo: &mut Repository,
    provider_id: &str,
    project_binding: Option<String>,
    parameters: serde_json::Value,
    base_revision: Option<PublishBaseRevisionRef>,
) -> Result<Option<String>, AppError> {
    let mut content = if let Some(base) = &base_revision {
        let revision = repo
            .publish_config
            .profile(&base.configuration_id)
            .filter(|profile| {
                profile.deleted_at.is_none() && profile.current_revision_id == base.revision_id
            })
            .and_then(|profile| profile.current_revision())
            .filter(|revision| revision.provider_id == provider_id)
            .ok_or_else(|| {
                AppError::validation_with_code(
                    "草稿基准修订已变化，请重新加载配置",
                    "publish_source_draft_conflict",
                )
            })?;
        crate::publish_runtime::source::content_from_revision(revision)
    } else {
        crate::publish_runtime::PublishConfigurationContent {
            provider_id: provider_id.to_string(),
            contract_version: PUBLISH_CONFIGURATION_CONTRACT_VERSION,
            provider_version: crate::provider::registry::ProviderRegistry::new()
                .get(provider_id)
                .map(|provider| provider.manifest().version.clone())
                .unwrap_or_else(|_| "unknown".to_string()),
            settings_version: CURRENT_SETTINGS_VERSION,
            project_binding: project_binding.clone(),
            parameters: serde_json::json!({}),
            composition: PublishComposition::local_default(),
        }
    };
    content.parameters = parameters;
    content.project_binding = project_binding.or(content.project_binding);
    let project_binding = content.project_binding.clone();
    let draft = ScopedPublishDraft {
        provider_id: provider_id.to_string(),
        project_binding: project_binding.clone(),
        content,
        base_revision,
    };
    if let Some(existing) = repo.publish_config.drafts.iter_mut().find(|existing| {
        existing.provider_id == draft.provider_id
            && existing.project_binding == draft.project_binding
    }) {
        *existing = draft;
    } else {
        repo.publish_config.drafts.push(draft);
    }
    Ok(project_binding)
}

/// 保存修订时解析仓库当前的 Project Candidate 并固化进修订（决议 #78）。
/// 引用与发布 spec 的构造规则一致：使用项目文件的 Provider 用仓库绑定的
/// project_file，其余用仓库根；无法解析时宽限为 None，失配由 prepare 阻断。
pub(crate) fn repository_project_binding(
    repo: &crate::store::Repository,
    provider_id: &str,
) -> Option<String> {
    let registry = crate::provider::registry::provider_registry();
    let provider = registry.get(provider_id).ok()?;
    let reference = match provider.capabilities().project_path_kind {
        crate::provider::ProviderProjectPathKind::ProjectFile => {
            let project_file = repo
                .project_file
                .clone()
                .filter(|file| !file.trim().is_empty())?;
            let project_path = std::path::Path::new(&project_file);
            let discovery = provider.repository_discovery();
            let matches_project_file =
                discovery
                    .project_file_matchers
                    .iter()
                    .any(|matcher| match matcher {
                        crate::provider::ProviderProjectFileMatcher::Extension(extension) => {
                            project_path
                                .extension()
                                .and_then(|value| value.to_str())
                                .is_some_and(|value| value.eq_ignore_ascii_case(extension))
                        }
                        crate::provider::ProviderProjectFileMatcher::FileName(name) => project_path
                            .file_name()
                            .and_then(|value| value.to_str())
                            .is_some_and(|value| value.eq_ignore_ascii_case(name)),
                    });
            let matches_solution = discovery.solution_file_extensions.iter().any(|extension| {
                project_path
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|value| value.eq_ignore_ascii_case(extension))
            });
            if !matches_project_file && !matches_solution {
                return None;
            }
            project_file
        }
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

    crate::tauri_release::validate_supplied_release_settings(&parameters, None)?;
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

    crate::tauri_release::validate_supplied_release_settings(
        &parameters,
        repo.publish_config
            .inherited_release_settings(&profile_id, &provider_id),
    )?;
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

/// 发布设置表单的初值（ADR-0060）：修订已有可读设置时原样返回；否则按
/// 项目绑定（存量修订退回仓库当前候选）探测建议值，不写入修订。
#[tauri::command]
pub async fn load_release_settings_draft(
    repo_id: String,
    profile_id: String,
) -> Result<crate::tauri_release::ReleaseSettingsDraft, AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new(
        "store::commands::load_release_settings_draft",
    );
    let state = get_state();
    let repo = find_repository(&state.repositories, &repo_id)?;
    let revision = repo.publish_config.release_settings_revision(&profile_id)?;
    Ok(resolve_release_settings_draft(repo, revision))
}

/// 发布设置表单的保存命令（ADR-0060）：校验通过才产生新修订。
#[tauri::command]
pub async fn update_profile_release_settings(
    app: tauri::AppHandle,
    repo_id: String,
    profile_id: String,
    settings: crate::tauri_release::TauriReleaseConfig,
) -> Result<AppState, AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new(
        "store::commands::update_profile_release_settings",
    );
    let mut state = get_state();
    let repo = find_repository_mut(&mut state.repositories, &repo_id)?;
    repo.publish_config.update_release_settings(
        &profile_id,
        settings,
        chrono::Utc::now().to_rfc3339(),
    )?;

    let response = state.clone();
    persist_state_and_refresh_tray(&app, state).await?;
    Ok(response)
}

/// 显式换绑到当前仓库候选（决议 #78）：换绑是显式动作，产一版新修订；
/// 与更新保存的"继承绑定"语义互补。
/// 换绑前解析配置的 Provider：取当前修订的 provider_id，缺失或已删除的
/// 配置（含无当前修订）报 profile_not_found。
fn resolve_rebind_provider(repo: &Repository, profile_id: &str) -> Result<String, AppError> {
    repo.publish_config
        .profile(profile_id)
        .filter(|profile| profile.deleted_at.is_none())
        .and_then(|profile| profile.current_revision())
        .map(|revision| revision.provider_id.clone())
        .ok_or_else(|| super::types::profile_not_found_error(profile_id))
}

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

    let provider_id = resolve_rebind_provider(repo, &profile_id)?;
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

/// 删除配置并清掉其最近使用键（`userprofile:{id}`）——墓碑与最近列表
/// 同属一次状态变更，避免留下悬空的 recent 条目。
fn delete_profile_in_state(
    state: &mut AppState,
    repo_id: &str,
    profile_id: &str,
) -> Result<(), AppError> {
    {
        let repo = find_repository_mut(&mut state.repositories, repo_id)?;
        repo.publish_config
            .delete_profile(profile_id, chrono::Utc::now().to_rfc3339())?;
    }
    remove_recent_publish_config_state(
        &mut state.recent_repo_ids,
        &mut state.recent_config_keys_by_repo,
        repo_id,
        &format!("userprofile:{profile_id}"),
    );
    Ok(())
}

#[tauri::command]
pub async fn delete_profile(
    app: tauri::AppHandle,
    repo_id: String,
    profile_id: String,
) -> Result<AppState, AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new("store::commands::delete_profile");
    let mut state = get_state();
    delete_profile_in_state(&mut state, &repo_id, &profile_id)?;
    let response = state.clone();
    persist_state_and_refresh_tray(&app, state).await?;
    Ok(response)
}

/// 置顶最近配置：仓库必须先存在；返回是否真正改变了最近列表。
fn push_recent_config_in_state(
    state: &mut AppState,
    repo_id: &str,
    config_key: &str,
) -> Result<bool, AppError> {
    find_repository(&state.repositories, repo_id)?;
    Ok(push_recent_publish_config_state(
        &mut state.recent_repo_ids,
        &mut state.recent_config_keys_by_repo,
        repo_id,
        config_key,
    ))
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
    if !push_recent_config_in_state(&mut state, &repo_id, &config_key)? {
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

/// 重排最近配置：仓库必须存在；请求键须恰好覆盖当前集合（先校验后同序
/// 短路）；返回是否写入了新顺序。
fn apply_recent_config_reorder(
    state: &mut AppState,
    repo_id: &str,
    config_keys: Vec<String>,
) -> Result<bool, AppError> {
    find_repository(&state.repositories, repo_id)?;

    let current_keys = state
        .recent_config_keys_by_repo
        .get(repo_id)
        .cloned()
        .unwrap_or_default();
    let requested_keys = normalize_ordered_ids(config_keys);

    ensure_exact_order_match(
        &current_keys,
        &requested_keys,
        "recent_config_order_mismatch",
    )?;

    if current_keys == requested_keys {
        return Ok(false);
    }

    state
        .recent_config_keys_by_repo
        .insert(repo_id.to_string(), requested_keys);
    Ok(true)
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
    if !apply_recent_config_reorder(&mut state, &repo_id, config_keys)? {
        return Ok(get_bootstrap_state());
    }

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

pub(super) fn sanitize_record_for_storage(record: &mut ExecutionRecord) {
    if let Some(snapshot) = record.recovery_snapshot.as_mut() {
        crate::security::sanitize_publish_recovery_snapshot(snapshot);
    }
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

/// 写快照路径：记录不存在时给出 execution_record_not_found（附 record_id）。
fn set_snapshot_in_state(
    state: &mut AppState,
    record_id: &str,
    snapshot_path: String,
) -> Result<(), AppError> {
    if !set_record_snapshot_path(&mut state.execution_history, record_id, snapshot_path) {
        return Err(
            AppError::validation_with_code("未找到执行记录", "execution_record_not_found")
                .with_details(record_id.to_string()),
        );
    }
    Ok(())
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
    set_snapshot_in_state(&mut state, &record_id, snapshot_path)?;

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
            attempt_id: None,
            recovery_snapshot: None,
            file_count: 2,
            warnings: None,
            manifest_digest: None,
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
            .expect("seal test runtime revision"),
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
    fn sanitize_record_for_storage_redacts_recovery_snapshot_and_marks_it_incomplete() {
        let mut record = test_record();
        record.recovery_snapshot = Some(json!({
            "content": {"providerId": "dotnet", "parameters": {
                "output": "/tmp/out", "properties": {"Password": "test-only-password"}
            }},
            "executedParameters": {"properties": {"ApiToken": "test-only-token"}}
        }));
        sanitize_record_for_storage(&mut record);
        let snapshot = record.recovery_snapshot.as_ref().unwrap();
        assert_eq!(snapshot["redacted"], true);
        assert_eq!(snapshot["content"]["parameters"]["output"], "/tmp/out");
        assert!(!snapshot.to_string().contains("test-only-"));
        let original = snapshot.clone();
        sanitize_record_for_storage(&mut record);
        assert_eq!(record.recovery_snapshot.as_ref(), Some(&original));
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

    #[test]
    fn revision_selection_refuses_profiles_from_another_repository_provider() {
        use super::ensure_selection_matches_repository_provider;
        use crate::store::PublishSelectionRef;

        let mut publish_config = RepoPublishConfig::default();
        let go_profile_id = publish_config
            .create_profile(
                "Linux".to_string(),
                "go".to_string(),
                json!({ "goos": "linux", "goarch": "amd64" }),
                None,
                None,
                "2026-10-06T10:00:00Z".to_string(),
            )
            .expect("create go profile")
            .id
            .clone();
        let cargo_profile_id = publish_config
            .create_profile(
                "Release".to_string(),
                "cargo".to_string(),
                json!({ "release": true }),
                None,
                None,
                "2026-10-06T10:00:00Z".to_string(),
            )
            .expect("create cargo profile")
            .id
            .clone();
        let mut repo = Repository {
            id: "rust-repo".to_string(),
            name: "Rust".to_string(),
            path: "/rust-repo".to_string(),
            project_file: None,
            current_branch: "main".to_string(),
            branches: Vec::new(),
            is_main: true,
            provider_id: Some("cargo".to_string()),
            publish_config,
        };
        let select = |configuration_id: &str| PublishSelectionRef::Revision {
            configuration_id: configuration_id.to_string(),
        };

        let error = ensure_selection_matches_repository_provider(&repo, &select(&go_profile_id))
            .expect_err("go profile must not be selectable in a cargo repository");
        assert_eq!(
            error.code.as_deref(),
            Some("publish_selection_provider_mismatch")
        );
        assert_eq!(
            error.details.as_deref(),
            Some("repository_provider_mismatch:go:cargo")
        );

        ensure_selection_matches_repository_provider(&repo, &select(&cargo_profile_id))
            .expect("matching provider stays selectable");

        repo.provider_id = None;
        ensure_selection_matches_repository_provider(&repo, &select(&go_profile_id))
            .expect("repositories without a declared provider stay unrestricted");
    }

    fn test_repository(id: &str, path: &str) -> Repository {
        Repository {
            id: id.to_string(),
            name: format!("Repo {id}"),
            path: path.to_string(),
            project_file: None,
            current_branch: "main".to_string(),
            branches: Vec::new(),
            is_main: true,
            provider_id: None,
            publish_config: RepoPublishConfig::default(),
        }
    }

    #[test]
    fn normalize_repository_path_matches_frontend_comparison_rules() {
        use super::normalize_repository_path;

        // POSIX 路径大小写敏感，仅修剪空白与尾部分隔符
        assert_eq!(normalize_repository_path(" /Repo/App/ "), "/Repo/App");
        assert_eq!(normalize_repository_path("/repo\\"), "/repo");
        // 根路径去尾后会变空，保留原文
        assert_eq!(normalize_repository_path("/"), "/");
        // Windows 风格路径忽略大小写：盘符 / 反斜杠 / UNC 任一命中
        assert_eq!(
            normalize_repository_path("C:\\Repo\\App\\"),
            "c:\\repo\\app"
        );
        assert_eq!(normalize_repository_path("d:/Repo"), "d:/repo");
        assert_eq!(
            normalize_repository_path("\\\\NAS\\share\\"),
            "\\\\nas\\share"
        );
    }

    #[test]
    fn normalize_ordered_ids_trims_dedupes_and_preserves_first_seen_order() {
        use super::normalize_ordered_ids;

        let ids = vec![
            "  b ".to_string(),
            "a".to_string(),
            String::new(),
            "   ".to_string(),
            "b".to_string(),
            "c".to_string(),
            "a ".to_string(),
        ];
        assert_eq!(normalize_ordered_ids(ids), vec!["b", "a", "c"]);
        assert!(normalize_ordered_ids(Vec::new()).is_empty());
    }

    #[test]
    fn ensure_exact_order_match_requires_same_membership() {
        use super::ensure_exact_order_match;

        let current = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        // 同集不同序是合法的
        let reordered = vec!["c".to_string(), "a".to_string(), "b".to_string()];
        ensure_exact_order_match(&current, &reordered, "test_order_mismatch")
            .expect("same membership in any order");

        let missing = vec!["a".to_string(), "b".to_string()];
        let error = ensure_exact_order_match(&current, &missing, "test_order_mismatch")
            .expect_err("shorter list must be rejected");
        assert_eq!(error.code.as_deref(), Some("test_order_mismatch"));

        let alien = vec!["a".to_string(), "b".to_string(), "z".to_string()];
        let error = ensure_exact_order_match(&current, &alien, "test_order_mismatch")
            .expect_err("unknown member must be rejected");
        assert_eq!(error.code.as_deref(), Some("test_order_mismatch"));
    }

    #[test]
    fn ensure_repository_path_absent_rejects_normalized_duplicates() {
        use super::ensure_repository_path_absent;

        let repositories = vec![
            test_repository("r1", "/Repo/App"),
            test_repository("r2", "D:\\Tools\\Builder"),
        ];

        ensure_repository_path_absent(&repositories, "/Repo/App/")
            .expect_err("trailing-slash duplicate must be rejected");
        ensure_repository_path_absent(&repositories, "d:\\tools\\builder")
            .expect_err("windows-case duplicate must be rejected");
        ensure_repository_path_absent(&repositories, "/repo/app")
            .expect("POSIX paths compare case-sensitively");
        ensure_repository_path_absent(&repositories, "/other").expect("distinct paths pass");
    }

    #[test]
    fn remove_repository_by_id_repairs_selected_fallback() {
        use super::remove_repository_by_id;

        let mut repositories = vec![
            test_repository("r1", "/one"),
            test_repository("r2", "/two"),
            test_repository("r3", "/three"),
        ];

        // 删除非选中项：选择保持不变
        let mut selected = Some("r1".to_string());
        remove_repository_by_id(&mut repositories, &mut selected, "r3");
        assert_eq!(repositories.len(), 2);
        assert_eq!(selected.as_deref(), Some("r1"));

        // 删除选中项：回退到剩余列表首位
        remove_repository_by_id(&mut repositories, &mut selected, "r1");
        assert_eq!(repositories.len(), 1);
        assert_eq!(selected.as_deref(), Some("r2"));

        // 删空后选择置空
        remove_repository_by_id(&mut repositories, &mut selected, "r2");
        assert!(repositories.is_empty());
        assert_eq!(selected, None);
    }

    #[test]
    fn apply_repository_order_reorders_by_id() {
        use super::apply_repository_order;

        let repositories = vec![
            test_repository("r1", "/one"),
            test_repository("r2", "/two"),
            test_repository("r3", "/three"),
        ];
        let ordered = apply_repository_order(
            repositories,
            vec!["r3".to_string(), "r1".to_string(), "r2".to_string()],
        );
        let ids = ordered
            .iter()
            .map(|repository| repository.id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(ids, vec!["r3", "r1", "r2"]);
    }

    #[test]
    fn apply_panel_width_update_marks_customization_only_on_real_change() {
        use super::{apply_panel_width_update, AppState};

        let mut state = AppState::default();
        let original_left = state.left_panel_width;
        let original_middle = state.middle_panel_width;

        apply_panel_width_update(&mut state, None, None);
        assert_eq!(state.left_panel_width, original_left);
        assert!(!state.panel_widths_customized);

        apply_panel_width_update(&mut state, Some(320), None);
        assert_eq!(state.left_panel_width, 320);
        assert_eq!(state.middle_panel_width, original_middle);
        assert!(state.panel_widths_customized);
    }

    #[test]
    fn apply_preference_update_applies_patch_and_reports_language_change() {
        use super::{apply_preference_update, AppState, PreferenceUpdate};

        let mut state = AppState::default();

        // 无语言字段 → 不刷新托盘；其余字段原样
        let language_changed = apply_preference_update(
            &mut state,
            PreferenceUpdate {
                minimize_to_tray_on_close: Some(true),
                theme: Some("dark".to_string()),
                ..PreferenceUpdate::default()
            },
        );
        assert!(!language_changed);
        assert!(state.minimize_to_tray_on_close);
        assert_eq!(state.theme, "dark");

        // 有语言字段 → 报告刷新
        let language_changed = apply_preference_update(
            &mut state,
            PreferenceUpdate {
                language: Some("en-US".to_string()),
                ..PreferenceUpdate::default()
            },
        );
        assert!(language_changed);
        assert_eq!(state.language, "en-US");
    }

    #[test]
    fn apply_preference_update_clamps_history_limit_and_trims() {
        use super::{apply_preference_update, AppState, PreferenceUpdate};

        let mut state = AppState {
            execution_history: (0..10)
                .map(|index| ExecutionRecord {
                    id: format!("rec-{index}"),
                    ..test_record()
                })
                .collect(),
            ..AppState::default()
        };

        apply_preference_update(
            &mut state,
            PreferenceUpdate {
                execution_history_limit: Some(0),
                ..PreferenceUpdate::default()
            },
        );
        assert_eq!(
            state.execution_history_limit,
            crate::store::types::MIN_EXECUTION_HISTORY_LIMIT
        );
        assert_eq!(
            state.execution_history.len(),
            crate::store::types::MIN_EXECUTION_HISTORY_LIMIT
        );

        apply_preference_update(
            &mut state,
            PreferenceUpdate {
                execution_history_limit: Some(9999),
                ..PreferenceUpdate::default()
            },
        );
        assert_eq!(
            state.execution_history_limit,
            crate::store::types::MAX_EXECUTION_HISTORY_LIMIT
        );
    }

    #[test]
    fn apply_preference_update_normalizes_environment_provider_ids() {
        use super::{apply_preference_update, AppState, PreferenceUpdate};

        let mut state = AppState::default();
        apply_preference_update(
            &mut state,
            PreferenceUpdate {
                environment_provider_ids: Some(vec![
                    " tauri ".to_string(),
                    "dotnet".to_string(),
                    "tauri".to_string(),
                    " ".to_string(),
                ]),
                ..PreferenceUpdate::default()
            },
        );
        assert_eq!(
            state.environment_provider_ids,
            vec!["dotnet".to_string(), "tauri".to_string()]
        );

        // 空列表回退到注册表默认集，而不是保存空偏好
        apply_preference_update(
            &mut state,
            PreferenceUpdate {
                environment_provider_ids: Some(Vec::new()),
                ..PreferenceUpdate::default()
            },
        );
        assert!(!state.environment_provider_ids.is_empty());
    }

    #[test]
    fn set_record_snapshot_path_updates_matching_record() {
        use super::set_record_snapshot_path;

        let mut records = vec![test_record(), {
            let mut second = test_record();
            second.id = "rec-2".to_string();
            second
        }];

        assert!(set_record_snapshot_path(
            &mut records,
            "rec-2",
            "/snapshots/r2.json".to_string()
        ));
        assert_eq!(
            records[1].snapshot_path.as_deref(),
            Some("/snapshots/r2.json")
        );
        assert!(records[0].snapshot_path.is_none());

        assert!(!set_record_snapshot_path(
            &mut records,
            "missing",
            "/snapshots/none.json".to_string()
        ));
    }

    #[test]
    fn redact_sensitive_spec_values_scrubs_nested_secrets_only() {
        use super::redact_sensitive_spec_values;
        use serde_json::json;

        let mut value = json!({
            "token": "abc123",
            "outputDir": "/repo/out",
            "nested": { "password": "hunter2", "retries": 3 },
            "list": [{ "clientSecret": "s" }, "plain", 42]
        });
        redact_sensitive_spec_values(&mut value);

        assert_eq!(value["token"], json!(crate::security::REDACTED_VALUE));
        assert_eq!(
            value["nested"]["password"],
            json!(crate::security::REDACTED_VALUE)
        );
        assert_eq!(
            value["list"][0]["clientSecret"],
            json!(crate::security::REDACTED_VALUE)
        );
        // 路径与自由文本原样保留（重跑依赖原值）
        assert_eq!(value["outputDir"], json!("/repo/out"));
        assert_eq!(value["nested"]["retries"], json!(3));
        assert_eq!(value["list"][1], json!("plain"));

        // 非对象值不处理
        let mut scalar = json!("token");
        redact_sensitive_spec_values(&mut scalar);
        assert_eq!(scalar, json!("token"));
    }

    #[test]
    fn upsert_edit_draft_creates_scoped_draft_with_registry_version() {
        use super::upsert_edit_draft;

        let mut repo = test_repository("r1", "/repo");
        let binding = upsert_edit_draft(
            &mut repo,
            "tauri",
            Some("tauri:src-tauri/tauri.conf.json".to_string()),
            json!({ "enabledTargets": ["dmg"] }),
            None,
        )
        .expect("create draft");

        assert_eq!(binding.as_deref(), Some("tauri:src-tauri/tauri.conf.json"));
        assert_eq!(repo.publish_config.drafts.len(), 1);
        let draft = &repo.publish_config.drafts[0];
        assert_eq!(draft.provider_id, "tauri");
        assert_eq!(draft.content.provider_version, "1");
        assert_eq!(
            draft.content.parameters,
            json!({ "enabledTargets": ["dmg"] })
        );
        assert_eq!(
            draft.content.contract_version,
            super::PUBLISH_CONFIGURATION_CONTRACT_VERSION
        );
    }

    #[test]
    fn upsert_edit_draft_replaces_same_scope_and_keeps_other_scopes() {
        use super::upsert_edit_draft;

        let mut repo = test_repository("r1", "/repo");
        upsert_edit_draft(&mut repo, "dotnet", None, json!({ "a": 1 }), None)
            .expect("create first draft");
        upsert_edit_draft(
            &mut repo,
            "dotnet",
            Some("dotnet:App.csproj".to_string()),
            json!({ "a": 2 }),
            None,
        )
        .expect("create second scope");
        assert_eq!(repo.publish_config.drafts.len(), 2);

        // 同作用域覆盖：参数更新、数量不变
        upsert_edit_draft(&mut repo, "dotnet", None, json!({ "a": 3 }), None)
            .expect("replace first scope");
        assert_eq!(repo.publish_config.drafts.len(), 2);
        let first = repo
            .publish_config
            .drafts
            .iter()
            .find(|draft| draft.project_binding.is_none())
            .expect("first scope still exists");
        assert_eq!(first.content.parameters, json!({ "a": 3 }));
    }

    #[test]
    fn upsert_edit_draft_seeds_from_base_revision_and_rejects_stale_base() {
        use super::upsert_edit_draft;
        use crate::publish_runtime::PublishBaseRevisionRef;

        let mut repo = test_repository("r1", "/repo");
        repo.provider_id = Some("dotnet".to_string());
        let profile = repo
            .publish_config
            .create_profile(
                "Release".to_string(),
                "dotnet".to_string(),
                json!({ "configuration": "Release" }),
                None,
                Some("dotnet:App.csproj".to_string()),
                "2026-10-08T10:00:00Z".to_string(),
            )
            .expect("create profile")
            .clone();
        let revision = profile.current_revision().expect("revision").clone();

        let base = PublishBaseRevisionRef {
            configuration_id: profile.id.clone(),
            revision_id: revision.id.clone(),
        };
        upsert_edit_draft(
            &mut repo,
            "dotnet",
            None,
            json!({ "x": 1 }),
            Some(base.clone()),
        )
        .expect("seed from base revision");

        let draft = &repo.publish_config.drafts[0];
        assert_eq!(draft.base_revision, Some(base.clone()));
        assert_eq!(draft.content.provider_id, "dotnet");
        assert_eq!(
            draft.content.project_binding.as_deref(),
            Some("dotnet:App.csproj")
        );

        // 基准已漂移（修订不再是当前 / 配置不存在）→ publish_source_draft_conflict
        let stale = PublishBaseRevisionRef {
            configuration_id: "ghost".to_string(),
            revision_id: "rev-x".to_string(),
        };
        let error = upsert_edit_draft(&mut repo, "dotnet", None, json!({}), Some(stale))
            .expect_err("stale base must be rejected");
        assert_eq!(error.code.as_deref(), Some("publish_source_draft_conflict"));

        // 基准 Provider 与提交 Provider 不一致同样拒绝
        let mismatched = PublishBaseRevisionRef {
            configuration_id: profile.id,
            revision_id: revision.id,
        };
        let error = upsert_edit_draft(&mut repo, "cargo", None, json!({}), Some(mismatched))
            .expect_err("provider-mismatched base must be rejected");
        assert_eq!(error.code.as_deref(), Some("publish_source_draft_conflict"));
    }

    #[test]
    fn repository_project_binding_resolves_only_declared_candidates() {
        use super::repository_project_binding;

        // 未注册 Provider → None
        let repo = test_repository("r1", "/definitely-not-existing-repo-path");
        assert_eq!(repository_project_binding(&repo, "bogus-provider"), None);

        // ProjectFile 型 Provider 无 project_file → None（决议 #78 宽限）
        let repo = test_repository("r1", "/definitely-not-existing-repo-path");
        assert_eq!(repository_project_binding(&repo, "tauri"), None);

        // project_file 与 Provider 发现规则不匹配 → None
        let mut repo = test_repository("r1", "/definitely-not-existing-repo-path");
        repo.project_file = Some("src-tauri/app.csproj".to_string());
        assert_eq!(repository_project_binding(&repo, "tauri"), None);

        // 匹配的 project_file + 存在的仓库路径 → 固化身份
        let tempdir = tempfile::tempdir().expect("tempdir");
        let mut repo = test_repository("r1", tempdir.path().to_str().expect("utf8 path"));
        repo.project_file = Some("src-tauri/tauri.conf.json".to_string());
        assert_eq!(
            repository_project_binding(&repo, "tauri").as_deref(),
            Some("tauri:src-tauri/tauri.conf.json")
        );

        // 仓库路径不可解析 → 宽限 None（prepare 阶段再阻断）
        let mut repo = test_repository("r1", "/definitely-not-existing-repo-path");
        repo.project_file = Some("src-tauri/tauri.conf.json".to_string());
        assert_eq!(repository_project_binding(&repo, "tauri"), None);
    }

    #[test]
    fn resolve_release_settings_draft_prefers_stored_then_suggests() {
        use super::resolve_release_settings_draft;

        let mut repo = test_repository("r1", "/repo");
        repo.provider_id = Some("tauri".to_string());

        // 修订已存可读设置 → 原样返回并标记 stored
        let stored_settings = crate::tauri_release::TauriReleaseConfig {
            app_name: "My App".to_string(),
            ..crate::tauri_release::TauriReleaseConfig::default()
        };
        let profile = repo
            .publish_config
            .create_profile(
                "Desktop".to_string(),
                "tauri".to_string(),
                json!({ "releaseSettings": serde_json::to_value(&stored_settings).unwrap() }),
                None,
                None,
                "2026-10-08T10:00:00Z".to_string(),
            )
            .expect("create tauri profile")
            .clone();
        let revision = profile.current_revision().expect("revision");
        let draft = resolve_release_settings_draft(&repo, revision);
        assert!(draft.stored);
        assert_eq!(draft.settings.app_name, "My App");

        // 修订无设置但有绑定 → 建议值携带绑定的配置路径，不标记 stored
        let mut repo = test_repository("r1", "/repo");
        let profile = repo
            .publish_config
            .create_profile(
                "Fresh".to_string(),
                "tauri".to_string(),
                json!({}),
                None,
                Some("tauri:apps/desktop/tauri.conf.json".to_string()),
                "2026-10-08T11:00:00Z".to_string(),
            )
            .expect("create unbound-settings profile")
            .clone();
        let revision = profile.current_revision().expect("revision");
        let draft = resolve_release_settings_draft(&repo, revision);
        assert!(!draft.stored);
        assert_eq!(
            draft.settings.app_config_path,
            "apps/desktop/tauri.conf.json"
        );

        // 修订无设置亦无绑定且仓库无候选 → 纯默认建议
        let mut repo = test_repository("r1", "/repo");
        let profile = repo
            .publish_config
            .create_profile(
                "Plain".to_string(),
                "tauri".to_string(),
                json!({}),
                None,
                None,
                "2026-10-08T12:00:00Z".to_string(),
            )
            .expect("create plain profile")
            .clone();
        let revision = profile.current_revision().expect("revision");
        let draft = resolve_release_settings_draft(&repo, revision);
        assert!(!draft.stored);
        assert_eq!(
            draft.settings,
            crate::tauri_release::TauriReleaseConfig::default()
        );
    }

    #[test]
    fn add_repository_in_state_selects_new_repo_and_rejects_duplicates() {
        use super::{add_repository_in_state, AppState};

        let mut state = AppState::default();
        let repo = test_repository("r1", "/repo-one");
        add_repository_in_state(&mut state, &repo).expect("add repository");
        assert_eq!(state.repositories.len(), 1);
        assert_eq!(state.selected_repo_id.as_deref(), Some("r1"));

        let duplicate = test_repository("r2", "/repo-one/");
        let error = add_repository_in_state(&mut state, &duplicate)
            .expect_err("normalized duplicate path must be rejected");
        assert_eq!(error.code.as_deref(), Some("repository_exists"));
        assert_eq!(state.repositories.len(), 1);
    }

    #[test]
    fn stage_repository_update_inherits_publish_config_and_requires_existing_repo() {
        use super::{stage_repository_update, AppState};

        let mut existing = test_repository("r1", "/repo");
        existing
            .publish_config
            .create_profile(
                "Release".to_string(),
                "dotnet".to_string(),
                json!({ "configuration": "Release" }),
                None,
                None,
                "2026-11-02T10:00:00Z".to_string(),
            )
            .expect("create profile");
        let mut state = AppState::default();
        state.repositories.push(existing);

        let update = Repository {
            name: "Renamed".to_string(),
            publish_config: RepoPublishConfig::default(),
            ..test_repository("r1", "/repo")
        };
        let staged = stage_repository_update(&state, update).expect("stage update");
        assert_eq!(staged.name, "Renamed");
        assert_eq!(staged.publish_config.profiles.len(), 1);

        let error = stage_repository_update(&state, test_repository("ghost", "/elsewhere"))
            .expect_err("unknown repository must be rejected");
        assert_eq!(error.code.as_deref(), Some("repository_not_found"));
    }

    #[test]
    fn apply_repository_reorder_validates_membership_before_noop() {
        use super::{apply_repository_reorder, AppState};

        let mut state = AppState {
            repositories: vec![
                test_repository("r1", "/one"),
                test_repository("r2", "/two"),
                test_repository("r3", "/three"),
            ],
            ..AppState::default()
        };

        let error = apply_repository_reorder(&mut state, vec!["r1".to_string(), "r2".to_string()])
            .expect_err("subset must be rejected");
        assert_eq!(error.code.as_deref(), Some("repository_order_mismatch"));

        let same_order = vec!["r1".to_string(), "r2".to_string(), "r3".to_string()];
        assert!(
            !apply_repository_reorder(&mut state, same_order).expect("same order is a valid no-op"),
            "identical order must report unchanged"
        );

        let reordered = vec!["r3".to_string(), "r1".to_string(), "r2".to_string()];
        assert!(apply_repository_reorder(&mut state, reordered).expect("apply reorder"));
        let ids = state
            .repositories
            .iter()
            .map(|repository| repository.id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(ids, vec!["r3", "r1", "r2"]);
    }

    #[test]
    fn apply_publish_edit_update_selects_draft_scope_or_validates_revision() {
        use super::{apply_publish_edit_update, PublishDraftSubmission, PublishEditStateUpdate};
        use crate::store::PublishSelectionRef;

        // 空更新是合法 no-op
        let mut repo = test_repository("r1", "/repo");
        apply_publish_edit_update(
            &mut repo,
            PublishEditStateUpdate {
                selection: None,
                draft: None,
            },
        )
        .expect("empty update is a no-op");
        assert!(repo.publish_config.selection.is_none());

        // 草稿写入自动选中草稿作用域
        apply_publish_edit_update(
            &mut repo,
            PublishEditStateUpdate {
                selection: None,
                draft: Some(PublishDraftSubmission {
                    provider_id: "dotnet".to_string(),
                    project_binding: Some("dotnet:App.csproj".to_string()),
                    parameters: json!({ "configuration": "Release" }),
                    base_revision: None,
                }),
            },
        )
        .expect("draft upsert");
        match repo.publish_config.selection.as_ref() {
            Some(PublishSelectionRef::Draft {
                provider_id,
                project_binding,
            }) => {
                assert_eq!(provider_id, "dotnet");
                assert_eq!(project_binding.as_deref(), Some("dotnet:App.csproj"));
            }
            other => panic!("expected draft selection, got {other:?}"),
        }
        assert_eq!(repo.publish_config.drafts.len(), 1);

        // 未声明 Provider 的仓库允许选任意修订（provider 校验在专门用例覆盖）
        let profile = repo
            .publish_config
            .create_profile(
                "Pinned".to_string(),
                "dotnet".to_string(),
                json!({}),
                None,
                None,
                "2026-11-02T10:00:00Z".to_string(),
            )
            .expect("create profile")
            .clone();
        apply_publish_edit_update(
            &mut repo,
            PublishEditStateUpdate {
                selection: Some(PublishSelectionRef::Revision {
                    configuration_id: profile.id.clone(),
                }),
                draft: None,
            },
        )
        .expect("selection update");
        assert_eq!(
            repo.publish_config.selection,
            Some(PublishSelectionRef::Revision {
                configuration_id: profile.id,
            })
        );
    }

    #[test]
    fn apply_publish_edit_update_rejects_selection_of_foreign_provider() {
        use super::{apply_publish_edit_update, PublishEditStateUpdate};
        use crate::store::PublishSelectionRef;

        let mut repo = test_repository("r1", "/repo");
        repo.provider_id = Some("dotnet".to_string());
        let foreign = repo
            .publish_config
            .create_profile(
                "Cargo".to_string(),
                "cargo".to_string(),
                json!({}),
                None,
                None,
                "2026-11-02T10:00:00Z".to_string(),
            )
            .expect("create cargo profile")
            .clone();

        let error = apply_publish_edit_update(
            &mut repo,
            PublishEditStateUpdate {
                selection: Some(PublishSelectionRef::Revision {
                    configuration_id: foreign.id,
                }),
                draft: None,
            },
        )
        .expect_err("foreign-provider selection must be rejected");
        assert_eq!(
            error.code.as_deref(),
            Some("publish_selection_provider_mismatch")
        );
        assert!(repo.publish_config.selection.is_none());
    }

    #[test]
    fn resolve_rebind_provider_rejects_missing_or_deleted_profiles() {
        use super::resolve_rebind_provider;

        let mut repo = test_repository("r1", "/repo");
        let error = resolve_rebind_provider(&repo, "missing")
            .expect_err("unknown profile must be rejected");
        assert_eq!(error.code.as_deref(), Some("profile_not_found"));
        assert_eq!(error.details.as_deref(), Some("missing"));

        let profile = repo
            .publish_config
            .create_profile(
                "Release".to_string(),
                "dotnet".to_string(),
                json!({}),
                None,
                None,
                "2026-11-02T10:00:00Z".to_string(),
            )
            .expect("create profile")
            .clone();
        assert_eq!(
            resolve_rebind_provider(&repo, &profile.id).expect("live profile"),
            "dotnet"
        );

        repo.publish_config
            .delete_profile(&profile.id, "2026-11-02T11:00:00Z".to_string())
            .expect("tombstone profile");
        let error = resolve_rebind_provider(&repo, &profile.id)
            .expect_err("deleted profile must be rejected");
        assert_eq!(error.code.as_deref(), Some("profile_not_found"));
    }

    #[test]
    fn delete_profile_in_state_tombstones_and_cleans_recent_key() {
        use super::{delete_profile_in_state, AppState};

        let mut state = AppState::default();
        let mut repo = test_repository("r1", "/repo");
        let profile = repo
            .publish_config
            .create_profile(
                "Release".to_string(),
                "dotnet".to_string(),
                json!({}),
                None,
                None,
                "2026-11-02T10:00:00Z".to_string(),
            )
            .expect("create profile")
            .clone();
        state.repositories.push(repo);
        state.recent_config_keys_by_repo.insert(
            "r1".to_string(),
            vec![format!("userprofile:{}", profile.id)],
        );

        delete_profile_in_state(&mut state, "r1", &profile.id).expect("delete profile");
        let repo = &state.repositories[0];
        assert!(repo
            .publish_config
            .profile(&profile.id)
            .expect("tombstone kept")
            .deleted_at
            .is_some());
        assert!(state
            .recent_config_keys_by_repo
            .get("r1")
            .map(|keys| keys.is_empty())
            .unwrap_or(true));

        let error = delete_profile_in_state(&mut state, "ghost", "p")
            .expect_err("missing repo must be rejected");
        assert_eq!(error.code.as_deref(), Some("repository_not_found"));
    }

    #[test]
    fn push_recent_config_in_state_requires_existing_repo() {
        use super::{push_recent_config_in_state, AppState};

        let mut state = AppState::default();
        let error = push_recent_config_in_state(&mut state, "ghost", "userprofile:x")
            .expect_err("missing repo must be rejected");
        assert_eq!(error.code.as_deref(), Some("repository_not_found"));

        state.repositories.push(test_repository("r1", "/repo"));
        assert!(push_recent_config_in_state(&mut state, "r1", "userprofile:p1").expect("push key"));
        assert_eq!(
            state.recent_config_keys_by_repo.get("r1"),
            Some(&vec!["userprofile:p1".to_string()])
        );
    }

    #[test]
    fn apply_recent_config_reorder_validates_membership_before_noop() {
        use super::{apply_recent_config_reorder, AppState};

        let mut state = AppState::default();
        state.repositories.push(test_repository("r1", "/repo"));
        state
            .recent_config_keys_by_repo
            .insert("r1".to_string(), vec!["a".to_string(), "b".to_string()]);

        let error = apply_recent_config_reorder(&mut state, "ghost", Vec::new())
            .expect_err("missing repo must be rejected");
        assert_eq!(error.code.as_deref(), Some("repository_not_found"));

        let error = apply_recent_config_reorder(&mut state, "r1", vec!["a".to_string()])
            .expect_err("subset must be rejected");
        assert_eq!(error.code.as_deref(), Some("recent_config_order_mismatch"));

        assert!(
            !apply_recent_config_reorder(&mut state, "r1", vec!["a".to_string(), "b".to_string()],)
                .expect("same order is a no-op"),
            "identical order must report unchanged"
        );

        assert!(apply_recent_config_reorder(
            &mut state,
            "r1",
            vec!["b".to_string(), "a".to_string()],
        )
        .expect("apply reorder"));
        assert_eq!(
            state.recent_config_keys_by_repo.get("r1"),
            Some(&vec!["b".to_string(), "a".to_string()])
        );
    }

    #[test]
    fn set_snapshot_in_state_maps_missing_record_to_error() {
        use super::{set_snapshot_in_state, AppState};

        let mut state = AppState::default();
        let error = set_snapshot_in_state(&mut state, "missing", "/s.json".to_string())
            .expect_err("missing record must be rejected");
        assert_eq!(error.code.as_deref(), Some("execution_record_not_found"));
        assert_eq!(error.details.as_deref(), Some("missing"));

        state.execution_history.push(test_record());
        set_snapshot_in_state(&mut state, "rec-1", "/snapshots/r1.json".to_string())
            .expect("set snapshot");
        assert_eq!(
            state.execution_history[0].snapshot_path.as_deref(),
            Some("/snapshots/r1.json")
        );
    }
}
