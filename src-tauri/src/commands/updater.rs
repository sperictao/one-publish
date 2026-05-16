use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{Mutex, MutexGuard},
    time::Duration,
};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::{Error as UpdaterError, Update, Updater, UpdaterExt};
use tokio::time::sleep;
use ts_rs::TS;

const UPDATE_CHECK_TIMEOUT: Duration = Duration::from_secs(20);
const UPDATE_DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(60 * 15);
const UPDATE_DOWNLOAD_MAX_ATTEMPTS: usize = 3;
const UPDATE_DOWNLOAD_PROGRESS_EVENT: &str = "updater-download-progress";

#[derive(Default)]
pub struct PendingUpdateState {
    pending_update: Mutex<Option<Update>>,
}

struct DownloadFailure {
    error: UpdaterError,
    attempts: usize,
}

/// 版本信息
#[derive(Debug, Serialize, Deserialize, TS)]
pub struct UpdateInfo {
    pub current_version: String,
    pub available_version: Option<String>,
    pub has_update: bool,
    pub release_notes: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct UpdaterHelpPaths {
    pub docs_path: String,
    pub template_path: String,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct UpdaterConfigHealth {
    pub configured: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct UpdateDownloadProgressPayload {
    stage: String,
    version: String,
    #[ts(type = "number")]
    downloaded_bytes: u64,
    #[ts(type = "number | null")]
    total_bytes: Option<u64>,
    percent: Option<f64>,
    attempt: usize,
    max_attempts: usize,
    message: Option<String>,
}

fn lock_pending_update(state: &PendingUpdateState) -> MutexGuard<'_, Option<Update>> {
    match state.pending_update.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            log::warn!("更新缓存状态锁已损坏，将继续使用恢复后的状态");
            poisoned.into_inner()
        }
    }
}

fn set_pending_update(state: &PendingUpdateState, update: Option<Update>) {
    *lock_pending_update(state) = update;
}

fn get_pending_update(
    state: &PendingUpdateState,
    expected_version: Option<&str>,
) -> Option<Update> {
    let guard = lock_pending_update(state);
    guard.as_ref().and_then(|update| {
        let version_matches = expected_version
            .map(|version| version == update.version.as_str())
            .unwrap_or(true);

        if version_matches {
            Some(update.clone())
        } else {
            None
        }
    })
}

fn normalize_expected_version(expected_version: Option<String>) -> Option<String> {
    expected_version.and_then(|version| {
        let trimmed = version.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn calculate_progress_percent(downloaded_bytes: u64, total_bytes: Option<u64>) -> Option<f64> {
    total_bytes.and_then(|total| {
        if total == 0 {
            None
        } else {
            Some(((downloaded_bytes as f64 / total as f64) * 100.0).min(100.0))
        }
    })
}

fn emit_update_download_progress(app: &AppHandle, payload: UpdateDownloadProgressPayload) {
    if let Err(err) = app.emit(UPDATE_DOWNLOAD_PROGRESS_EVENT, payload) {
        log::warn!("发送更新下载进度事件失败: {}", err);
    }
}

fn build_progress_payload(
    stage: &str,
    version: &str,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    attempt: usize,
    message: Option<String>,
) -> UpdateDownloadProgressPayload {
    UpdateDownloadProgressPayload {
        stage: stage.to_string(),
        version: version.to_string(),
        downloaded_bytes,
        total_bytes,
        percent: calculate_progress_percent(downloaded_bytes, total_bytes),
        attempt,
        max_attempts: UPDATE_DOWNLOAD_MAX_ATTEMPTS,
        message,
    }
}

fn no_update_info(message: Option<String>) -> UpdateInfo {
    UpdateInfo {
        current_version: env!("CARGO_PKG_VERSION").to_string(),
        available_version: None,
        has_update: false,
        release_notes: None,
        message,
    }
}

pub(crate) fn map_updater_error(err: UpdaterError) -> String {
    match err {
        UpdaterError::EmptyEndpoints => {
            "更新源未配置，请在 tauri.conf.json 中设置 updater 的 endpoints 与 pubkey".to_string()
        }
        UpdaterError::InsecureTransportProtocol => {
            "更新地址必须使用 https 协议（或在开发环境显式允许非安全协议）".to_string()
        }
        _ => err.to_string(),
    }
}

fn build_updater(app: &AppHandle) -> Result<Updater, crate::errors::AppError> {
    app.updater_builder()
        .timeout(UPDATE_CHECK_TIMEOUT)
        .build()
        .map_err(|source| {
            crate::errors::AppError::updater_with_code(
                format!("更新源未配置或不可用: {}", map_updater_error(source)),
                "updater_not_configured",
            )
        })
}

fn into_downloadable_update(mut update: Update) -> Update {
    update.timeout = Some(UPDATE_DOWNLOAD_TIMEOUT);
    update
}

fn available_update_info(update: &Update) -> UpdateInfo {
    UpdateInfo {
        current_version: update.current_version.clone(),
        available_version: Some(update.version.clone()),
        has_update: true,
        release_notes: update.body.clone(),
        message: Some("发现可用更新".to_string()),
    }
}

async fn fetch_remote_update(
    app: &AppHandle,
    pending_update_state: &PendingUpdateState,
) -> Result<Option<Update>, crate::errors::AppError> {
    let updater = build_updater(app)?;
    let maybe_update = updater.check().await.map_err(|source| {
        crate::errors::AppError::updater_with_code(
            format!("检查更新失败: {}", map_updater_error(source)),
            "check_update_failed",
        )
    })?;

    let maybe_update = maybe_update.map(into_downloadable_update);
    set_pending_update(pending_update_state, maybe_update.clone());
    Ok(maybe_update)
}

fn extract_http_status_code(message: &str) -> Option<u16> {
    message
        .split_once("status:")
        .and_then(|(_, raw_status)| raw_status.split_whitespace().next())
        .and_then(|status| status.parse::<u16>().ok())
}

fn is_retryable_status_code(status: u16) -> bool {
    matches!(status, 408 | 429) || (500..=599).contains(&status)
}

fn is_retryable_download_error(error: &UpdaterError) -> bool {
    match error {
        UpdaterError::Reqwest(source) => {
            source.is_timeout()
                || source.is_connect()
                || source.is_request()
                || source.is_body()
                || source.is_decode()
        }
        UpdaterError::Network(message) => extract_http_status_code(message)
            .map(is_retryable_status_code)
            .unwrap_or(true),
        _ => false,
    }
}

fn retry_delay(attempt: usize) -> Duration {
    match attempt {
        1 => Duration::from_secs(1),
        2 => Duration::from_secs(2),
        _ => Duration::from_secs(4),
    }
}

async fn download_update_with_retry(
    app: &AppHandle,
    update: &Update,
) -> Result<(Vec<u8>, usize), DownloadFailure> {
    for attempt in 1..=UPDATE_DOWNLOAD_MAX_ATTEMPTS {
        emit_update_download_progress(
            app,
            build_progress_payload("downloading", &update.version, 0, None, attempt, None),
        );

        let app_handle = app.clone();
        let version = update.version.clone();
        let mut downloaded_bytes = 0_u64;

        match update
            .download(
                move |chunk_len, total_bytes| {
                    downloaded_bytes += chunk_len as u64;
                    emit_update_download_progress(
                        &app_handle,
                        build_progress_payload(
                            "downloading",
                            &version,
                            downloaded_bytes,
                            total_bytes,
                            attempt,
                            None,
                        ),
                    );
                },
                || {},
            )
            .await
        {
            Ok(bytes) => return Ok((bytes, attempt.saturating_sub(1))),
            Err(error) => {
                let can_retry =
                    attempt < UPDATE_DOWNLOAD_MAX_ATTEMPTS && is_retryable_download_error(&error);

                log::warn!(
                    "下载更新包失败（第 {}/{} 次，版本 {}）: {}",
                    attempt,
                    UPDATE_DOWNLOAD_MAX_ATTEMPTS,
                    update.version,
                    error
                );

                if can_retry {
                    emit_update_download_progress(
                        app,
                        build_progress_payload(
                            "retrying",
                            &update.version,
                            0,
                            None,
                            attempt + 1,
                            None,
                        ),
                    );
                    sleep(retry_delay(attempt)).await;
                    continue;
                }

                return Err(DownloadFailure {
                    error,
                    attempts: attempt,
                });
            }
        }
    }

    unreachable!("下载重试循环必须在成功或失败时返回");
}

fn download_failure_to_app_error(failure: DownloadFailure) -> crate::errors::AppError {
    let retry_note = if failure.attempts > 1 {
        format!("（已自动重试 {} 次）", failure.attempts - 1)
    } else {
        String::new()
    };

    crate::errors::AppError::updater_with_code(
        format!(
            "下载更新失败{}: {}",
            retry_note,
            map_updater_error(failure.error)
        ),
        "download_update_failed",
    )
}

async fn resolve_install_update(
    app: &AppHandle,
    pending_update_state: &PendingUpdateState,
    expected_version: Option<&str>,
) -> Result<Option<(Update, bool)>, crate::errors::AppError> {
    if let Some(update) = get_pending_update(pending_update_state, expected_version) {
        return Ok(Some((update, true)));
    }

    Ok(fetch_remote_update(app, pending_update_state)
        .await?
        .map(|update| (update, false)))
}

async fn refresh_update_after_cached_failure(
    app: &AppHandle,
    pending_update_state: &PendingUpdateState,
    previous_update: &Update,
) -> Option<Update> {
    set_pending_update(pending_update_state, None);

    let Ok(maybe_update) = fetch_remote_update(app, pending_update_state).await else {
        return None;
    };

    maybe_update.and_then(|update| {
        let metadata_changed = update.version != previous_update.version
            || update.download_url != previous_update.download_url
            || update.signature != previous_update.signature;

        if metadata_changed {
            Some(update)
        } else {
            None
        }
    })
}

fn resolve_updater_help_paths() -> Result<(PathBuf, PathBuf), crate::errors::AppError> {
    let mut roots = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        roots.push(cwd);
    }
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            roots.push(parent.to_path_buf());
        }
    }
    for root in roots {
        let mut current = root;
        loop {
            let docs = current.join("docs").join("updater").join("SETUP.md");
            let template = current
                .join("src-tauri")
                .join("tauri.conf.updater.example.json");
            if docs.exists() && template.exists() {
                return Ok((docs, template));
            }
            if !current.pop() {
                break;
            }
        }
    }
    Err(crate::errors::AppError::updater_with_code(
        "未找到 updater 指南文件，请在源码仓库中运行该功能",
        "updater_help_files_not_found",
    ))
}

#[tauri::command]
pub fn get_updater_help_paths() -> Result<UpdaterHelpPaths, crate::errors::AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new("commands::updater::get_updater_help_paths");
    let (docs, template) = resolve_updater_help_paths()?;
    Ok(UpdaterHelpPaths {
        docs_path: docs.to_string_lossy().to_string(),
        template_path: template.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn get_updater_config_health(app: AppHandle) -> UpdaterConfigHealth {
    let _timer = crate::commands::middleware::CommandTimer::new("commands::updater::get_updater_config_health");
    match app.updater() {
        Ok(_) => UpdaterConfigHealth {
            configured: true,
            message: "updater 配置已就绪".to_string(),
        },
        Err(err) => UpdaterConfigHealth {
            configured: false,
            message: format!("更新源未配置或不可用: {}", map_updater_error(err)),
        },
    }
}

#[tauri::command]
pub fn open_updater_help(target: String) -> Result<String, crate::errors::AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new("commands::updater::open_updater_help");
    let (docs, template) = resolve_updater_help_paths()?;
    let path = match target.as_str() {
        "docs" => docs,
        "template" => template,
        _ => {
            return Err(crate::errors::AppError::updater_with_code(
                format!("unsupported updater help target: {}", target),
                "unsupported_updater_help_target",
            ))
        }
    };
    open::that(&path).map_err(|source| {
        crate::errors::AppError::updater_with_code(
            format!("failed to open updater help file: {}", source),
            "open_updater_help_failed",
        )
    })?;
    Ok(path.to_string_lossy().to_string())
}

/// 检查更新
#[tauri::command]
pub async fn check_update(
    app: AppHandle,
    pending_update_state: State<'_, PendingUpdateState>,
) -> Result<UpdateInfo, crate::errors::AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new("commands::updater::check_update");
    match fetch_remote_update(&app, pending_update_state.inner()).await {
        Ok(Some(update)) => Ok(available_update_info(&update)),
        Ok(None) => Ok(no_update_info(Some("当前已是最新版本".to_string()))),
        Err(err) => {
            set_pending_update(pending_update_state.inner(), None);
            Ok(no_update_info(Some(err.message)))
        }
    }
}

/// 执行更新并重启
#[tauri::command]
pub async fn install_update(
    app: AppHandle,
    pending_update_state: State<'_, PendingUpdateState>,
    expected_version: Option<String>,
) -> Result<String, crate::errors::AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new("commands::updater::install_update");
    let expected_version = normalize_expected_version(expected_version);
    let Some((selected_update, used_cached_update)) = resolve_install_update(
        &app,
        pending_update_state.inner(),
        expected_version.as_deref(),
    )
    .await?
    else {
        return Ok("当前已是最新版本，无需安装".to_string());
    };

    let (update, bytes, retry_count) =
        match download_update_with_retry(&app, &selected_update).await {
            Ok((bytes, retry_count)) => (selected_update, bytes, retry_count),
            Err(initial_failure) => {
                let refreshed_update = if used_cached_update {
                    refresh_update_after_cached_failure(
                        &app,
                        pending_update_state.inner(),
                        &selected_update,
                    )
                    .await
                } else {
                    None
                };

                if let Some(refreshed_update) = refreshed_update {
                    match download_update_with_retry(&app, &refreshed_update).await {
                        Ok((bytes, retry_count)) => (refreshed_update, bytes, retry_count),
                        Err(refreshed_failure) => {
                            return Err(download_failure_to_app_error(refreshed_failure));
                        }
                    }
                } else {
                    return Err(download_failure_to_app_error(initial_failure));
                }
            }
        };

    let target_version = update.version.clone();
    let total_bytes = bytes.len() as u64;
    emit_update_download_progress(
        &app,
        build_progress_payload(
            "installing",
            &target_version,
            total_bytes,
            Some(total_bytes),
            retry_count + 1,
            None,
        ),
    );
    update.install(bytes).map_err(|source| {
        crate::errors::AppError::updater_with_code(
            format!("安装更新失败: {}", map_updater_error(source)),
            "install_update_failed",
        )
    })?;

    set_pending_update(pending_update_state.inner(), None);

    let retry_note = if retry_count > 0 {
        format!(" 下载阶段已自动重试 {} 次。", retry_count)
    } else {
        String::new()
    };

    Ok(format!(
        "更新安装完成（v{}）。{}请重启应用以生效。",
        target_version, retry_note
    ))
}

/// 获取当前版本
#[tauri::command]
pub fn get_current_version() -> String {
    let _timer = crate::commands::middleware::CommandTimer::new("commands::updater::get_current_version");
    env!("CARGO_PKG_VERSION").to_string()
}

/// 获取快捷键帮助
#[tauri::command]
pub fn get_shortcuts_help() -> Vec<crate::shortcuts::ShortcutHelp> {
    let _timer = crate::commands::middleware::CommandTimer::new("commands::updater::get_shortcuts_help");
    crate::shortcuts::get_shortcuts_help()
}

#[cfg(test)]
mod tests {
    use super::{
        extract_http_status_code, is_retryable_download_error, is_retryable_status_code,
        map_updater_error,
    };
    use tauri_plugin_updater::Error as UpdaterError;

    #[test]
    fn updater_empty_endpoints_error_is_actionable() {
        let msg = map_updater_error(UpdaterError::EmptyEndpoints);
        assert!(msg.contains("updater"));
        assert!(msg.contains("endpoints"));
        assert!(msg.contains("pubkey"));
    }

    #[test]
    fn updater_insecure_transport_error_is_actionable() {
        let msg = map_updater_error(UpdaterError::InsecureTransportProtocol);
        assert!(msg.contains("https"));
    }

    #[test]
    fn parses_http_status_code_from_network_message() {
        let status = extract_http_status_code(
            "Download request failed with status: 503 Service Unavailable",
        );
        assert_eq!(status, Some(503));
    }

    #[test]
    fn retryable_status_codes_are_expected() {
        assert!(is_retryable_status_code(408));
        assert!(is_retryable_status_code(429));
        assert!(is_retryable_status_code(503));
        assert!(!is_retryable_status_code(404));
    }

    #[test]
    fn network_status_404_is_not_retryable() {
        let error =
            UpdaterError::Network("Download request failed with status: 404 Not Found".into());
        assert!(!is_retryable_download_error(&error));
    }

    #[test]
    fn network_status_503_is_retryable() {
        let error = UpdaterError::Network(
            "Download request failed with status: 503 Service Unavailable".into(),
        );
        assert!(is_retryable_download_error(&error));
    }
}