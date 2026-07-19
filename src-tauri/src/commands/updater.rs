use serde::{Deserialize, Serialize};
use std::{
    future::Future,
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

#[derive(Debug)]
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

async fn download_with_retry<F, Fut>(
    mut attempt_download: F,
    retry_delay_fn: impl Fn(u32) -> Duration,
) -> Result<(Vec<u8>, usize), DownloadFailure>
where
    F: FnMut(u32) -> Fut,
    Fut: Future<Output = Result<Vec<u8>, UpdaterError>>,
{
    for attempt in 1..=UPDATE_DOWNLOAD_MAX_ATTEMPTS {
        match attempt_download(attempt as u32).await {
            Ok(bytes) => return Ok((bytes, attempt.saturating_sub(1))),
            Err(error) => {
                let can_retry =
                    attempt < UPDATE_DOWNLOAD_MAX_ATTEMPTS && is_retryable_download_error(&error);

                if can_retry {
                    sleep(retry_delay_fn(attempt as u32)).await;
                    continue;
                }

                return Err(DownloadFailure { error, attempts: attempt });
            }
        }
    }

    unreachable!("下载重试循环必须在成功或失败时返回");
}

async fn download_update_with_retry(
    app: &AppHandle,
    update: &Update,
) -> Result<(Vec<u8>, usize), DownloadFailure> {
    let attempt_download = |attempt: u32| async move {
        emit_update_download_progress(
            app,
            build_progress_payload("downloading", &update.version, 0, None, attempt as usize, None),
        );

        let app_handle = app.clone();
        let version = update.version.clone();
        let mut downloaded_bytes = 0_u64;

        let result = update
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
                            attempt as usize,
                            None,
                        ),
                    );
                },
                || {},
            )
            .await;

        match result {
            Ok(bytes) => Ok(bytes),
            Err(error) => {
                log::warn!(
                    "下载更新包失败（第 {}/{} 次，版本 {}）: {}",
                    attempt,
                    UPDATE_DOWNLOAD_MAX_ATTEMPTS,
                    update.version,
                    error
                );
                Err(error)
            }
        }
    };

    let retry_delay_fn = |attempt: u32| {
        emit_update_download_progress(
            app,
            build_progress_payload(
                "retrying",
                &update.version,
                0,
                None,
                attempt as usize + 1,
                None,
            ),
        );
        retry_delay(attempt as usize)
    };

    download_with_retry(attempt_download, retry_delay_fn).await
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
    resolve_update_with_fetch(pending_update_state, expected_version, || {
        fetch_remote_update(app, pending_update_state)
    })
    .await
}

/// 注入 fetch 闭包的 pending 状态机解析 seam。
///
/// `fetch_remote` 无参、返回 `Future<Output = Result<Option<Update>, AppError>>`，与生产实现
/// `fetch_remote_update`（扣除 `app` / `state` 参数）语义一致。命中缓存返回 `(update, true)`，
/// miss 则调用 `fetch_remote` 返回 `(update, false)`。纯状态机逻辑，便于单测。
///
/// 闭包签名取 `FnOnce() -> Fut`（而非 `FnOnce(&PendingUpdateState) -> Fut`），让 `Fut` 作为
/// 单一泛型类型由编译器推断（同 `download_with_retry` 模式），规避 `for<'a>` HRTB 生命周期
/// 约束；生产封装通过捕获 `&PendingUpdateState` 将 state 注入闭包。
async fn resolve_update_with_fetch<F, Fut>(
    pending_update_state: &PendingUpdateState,
    expected_version: Option<&str>,
    fetch_remote: F,
) -> Result<Option<(Update, bool)>, crate::errors::AppError>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<Option<Update>, crate::errors::AppError>>,
{
    if let Some(update) = get_pending_update(pending_update_state, expected_version) {
        return Ok(Some((update, true)));
    }

    Ok(fetch_remote().await?.map(|update| (update, false)))
}

async fn refresh_update_after_cached_failure(
    app: &AppHandle,
    pending_update_state: &PendingUpdateState,
    previous_update: &Update,
) -> Option<Update> {
    let previous_metadata = update_metadata_from(previous_update);
    refresh_after_failure_with_fetch(pending_update_state, &previous_metadata, || {
        fetch_remote_update(app, pending_update_state)
    })
    .await
}

/// 注入 fetch 闭包的缓存失败刷新 seam。
///
/// 先清缓存，再调用 `fetch_remote` 重新拉取；若远端 metadata 与 `previous_metadata`
/// 一致则返回 `None`（视为同一损坏包，不重试），否则返回新 `Update`。纯状态机逻辑，便于单测。
///
/// 接收 `&UpdateMetadata` 而非 `&Update`，是因为 `Update` 在测试中不可构造；
/// 上层封装 `refresh_update_after_cached_failure` 会先调用 `update_metadata_from`
/// 抽出可比较字段再传入。闭包签名同 `resolve_update_with_fetch`，规避 HRTB。
async fn refresh_after_failure_with_fetch<F, Fut>(
    pending_update_state: &PendingUpdateState,
    previous_metadata: &UpdateMetadata<'_>,
    fetch_remote: F,
) -> Option<Update>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<Option<Update>, crate::errors::AppError>>,
{
    set_pending_update(pending_update_state, None);

    let Ok(maybe_update) = fetch_remote().await else {
        return None;
    };

    maybe_update.and_then(|update| {
        if update_metadata_changed(previous_metadata, &update_metadata_from(&update)) {
            Some(update)
        } else {
            None
        }
    })
}

/// `Update` 中参与「是否需要重新下载」判定的关键字段快照。
///
/// 抽出原始 `&str` 而非直接用 `&Update`，是因为 `tauri_plugin_updater::Update`
/// 含私有字段（`run_on_main_thread` 等）且无公开构造器，测试中无法构造实例。
/// 本结构仅由 `String`/`&str` 组成，可在测试中自由构造，从而让
/// `update_metadata_changed` 成为真正可单测的纯函数。
struct UpdateMetadata<'a> {
    version: &'a str,
    download_url: &'a str,
    signature: &'a str,
}

fn update_metadata_from(update: &Update) -> UpdateMetadata<'_> {
    UpdateMetadata {
        version: update.version.as_str(),
        download_url: update.download_url.as_str(),
        signature: update.signature.as_str(),
    }
}

/// 比较两份 update metadata 是否变化（版本号、下载地址、签名）。
///
/// 任一字段不同即视为已变化（应允许重新下载）。纯函数，便于单测。
fn update_metadata_changed(prev: &UpdateMetadata<'_>, next: &UpdateMetadata<'_>) -> bool {
    next.version != prev.version
        || next.download_url != prev.download_url
        || next.signature != prev.signature
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
    let _timer =
        crate::commands::middleware::CommandTimer::new("commands::updater::get_updater_help_paths");
    let (docs, template) = resolve_updater_help_paths()?;
    Ok(UpdaterHelpPaths {
        docs_path: docs.to_string_lossy().to_string(),
        template_path: template.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn get_updater_config_health(app: AppHandle) -> UpdaterConfigHealth {
    let _timer = crate::commands::middleware::CommandTimer::new(
        "commands::updater::get_updater_config_health",
    );
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
    let _timer =
        crate::commands::middleware::CommandTimer::new("commands::updater::open_updater_help");
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
        Ok(None) => Ok(no_update_info(None)),
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
    let _timer =
        crate::commands::middleware::CommandTimer::new("commands::updater::install_update");
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
    let _timer =
        crate::commands::middleware::CommandTimer::new("commands::updater::get_current_version");
    env!("CARGO_PKG_VERSION").to_string()
}

/// 获取快捷键帮助
#[tauri::command]
pub fn get_shortcuts_help() -> Vec<crate::shortcuts::ShortcutHelp> {
    let _timer =
        crate::commands::middleware::CommandTimer::new("commands::updater::get_shortcuts_help");
    crate::shortcuts::get_shortcuts_help()
}

#[cfg(test)]
mod tests {
    use super::{
        download_failure_to_app_error, download_with_retry, extract_http_status_code,
        is_retryable_download_error, is_retryable_status_code, map_updater_error,
        normalize_expected_version, refresh_after_failure_with_fetch, resolve_update_with_fetch,
        update_metadata_changed, DownloadFailure, PendingUpdateState, UpdateMetadata,
        UPDATE_DOWNLOAD_MAX_ATTEMPTS,
    };
    use crate::errors::{AppError, ErrorKind};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;
    use tauri_plugin_updater::{Error as UpdaterError, Update};

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

    #[test]
    fn normalize_expected_version_none_for_absent_input() {
        assert_eq!(normalize_expected_version(None), None);
    }

    #[test]
    fn normalize_expected_version_none_for_empty_string() {
        assert_eq!(normalize_expected_version(Some(String::new())), None);
    }

    #[test]
    fn normalize_expected_version_none_for_whitespace_only() {
        assert_eq!(normalize_expected_version(Some("   \t  ".to_string())), None);
    }

    #[test]
    fn normalize_expected_version_trims_surrounding_whitespace() {
        assert_eq!(
            normalize_expected_version(Some("  1.2.3  ".to_string())),
            Some("1.2.3".to_string())
        );
    }

    fn network_failure(attempts: usize, status: u16) -> DownloadFailure {
        DownloadFailure {
            error: UpdaterError::Network(format!(
                "Download request failed with status: {status}"
            )),
            attempts,
        }
    }

    #[test]
    fn download_failure_with_single_attempt_has_no_retry_note() {
        let err: AppError = download_failure_to_app_error(network_failure(1, 500));
        assert_eq!(err.kind, ErrorKind::Updater);
        assert_eq!(err.code.as_deref(), Some("download_update_failed"));
        assert!(!err.message.contains("已自动重试"));
        assert!(err.message.contains("500"));
    }

    #[test]
    fn download_failure_with_multiple_attempts_notes_retry_count() {
        // attempts=3 -> "已自动重试 2 次"（attempts - 1）
        let err: AppError = download_failure_to_app_error(network_failure(3, 503));
        assert_eq!(err.kind, ErrorKind::Updater);
        assert_eq!(err.code.as_deref(), Some("download_update_failed"));
        assert!(err.message.contains("已自动重试 2 次"));
        assert!(err.message.contains("503"));
    }

    fn retryable_network_error() -> UpdaterError {
        UpdaterError::Network("Download request failed with status: 503".into())
    }

    fn fatal_network_error() -> UpdaterError {
        UpdaterError::Network("Download request failed with status: 404".into())
    }

    /// 单次下载尝试的结果（测试 fake 闭包序列元素）。
    type AttemptOutcome = Result<Vec<u8>, UpdaterError>;
    /// fake 闭包返回的 boxed future，避免 async closure 的生命周期问题。
    type AttemptFuture = std::pin::Pin<Box<dyn std::future::Future<Output = AttemptOutcome> + Send>>;

    fn sequence_attempt_download(sequence: Vec<AttemptOutcome>) -> impl FnMut(u32) -> AttemptFuture {
        use std::collections::VecDeque;
        use std::sync::{Arc, Mutex};
        let queue: Arc<Mutex<VecDeque<AttemptOutcome>>> =
            Arc::new(Mutex::new(sequence.into_iter().collect()));
        move |attempt: u32| {
            let queue = queue.clone();
            Box::pin(async move {
                match queue.lock().expect("sequence queue poisoned").pop_front() {
                    Some(result) => result,
                    None => panic!("attempt_download 被调用次数超过序列长度（attempt {}）", attempt),
                }
            })
        }
    }

    #[tokio::test]
    async fn retry_loop_succeeds_after_retries() {
        // [Err(retryable), Err(retryable), Ok] -> 成功且 retries=2
        let sequence = vec![
            Err(retryable_network_error()),
            Err(retryable_network_error()),
            Ok(vec![1, 2, 3]),
        ];

        let result = download_with_retry(sequence_attempt_download(sequence), |_| Duration::ZERO).await;

        let (bytes, retries) = result.expect("应在两次重试后成功");
        assert_eq!(retries, 2);
        assert_eq!(bytes, vec![1, 2, 3]);
    }

    #[tokio::test]
    async fn retry_loop_exhausts_attempts_on_persistent_retryable_error() {
        // [Err(retryable) × MAX] -> Err 且 attempts=MAX
        let sequence = vec![
            Err(retryable_network_error()),
            Err(retryable_network_error()),
            Err(retryable_network_error()),
        ];

        let result = download_with_retry(sequence_attempt_download(sequence), |_| Duration::ZERO).await;

        let failure = result.expect_err("持续可重试错误应耗尽重试后失败");
        assert_eq!(failure.attempts, UPDATE_DOWNLOAD_MAX_ATTEMPTS);
        assert!(failure.error.to_string().contains("503"));
    }

    #[tokio::test]
    async fn retry_loop_fails_immediately_on_fatal_error() {
        // [Err(fatal)] -> 立即 Err，attempts=1
        let sequence = vec![Err(fatal_network_error())];

        let result = download_with_retry(sequence_attempt_download(sequence), |_| Duration::ZERO).await;

        let failure = result.expect_err("致命错误应立即失败");
        assert_eq!(failure.attempts, 1);
        assert!(failure.error.to_string().contains("404"));
    }

    #[tokio::test]
    async fn retry_loop_stops_on_fatal_after_retryable() {
        // [Err(retryable), Err(fatal)] -> 第二次即停（attempts=2）
        let sequence = vec![Err(retryable_network_error()), Err(fatal_network_error())];

        let result = download_with_retry(sequence_attempt_download(sequence), |_| Duration::ZERO).await;

        let failure = result.expect_err("重试后遇到致命错误应停止");
        assert_eq!(failure.attempts, 2);
        assert!(failure.error.to_string().contains("404"));
    }

    // ---- pending 状态机 seam 测试 ----
    //
    // 注意：`tauri_plugin_updater::Update` 含私有字段（`run_on_main_thread` 等）且无公开
    // 构造器，测试中无法构造实例。因此涉及 `Some(Update)` 的路径无法直接覆盖：
    //   - `resolve_update_with_fetch` 的缓存命中分支（需预填 `Update`）；
    //   - `refresh_after_failure_with_fetch` 的 metadata 变化/不变命中分支（需 `Some(Update)`）。
    // 已覆盖：
    //   - `update_metadata_changed` 纯函数（覆盖 Some 路径的决策逻辑，4 个字段维度）；
    //   - 两 seam 的 None / Err 路径 + fetch 调用计数（覆盖缓存 miss -> fetch 的状态机分支）。
    // `Some(Update)` 命中分支由生产代码 `install_update` 集成覆盖。

    fn metadata(version: &'static str, url: &'static str, signature: &'static str) -> UpdateMetadata<'static> {
        UpdateMetadata {
            version,
            download_url: url,
            signature,
        }
    }

    #[test]
    fn metadata_unchanged_when_all_fields_equal() {
        let prev = metadata("1.2.3", "https://example.com/v1.2.3.pkg", "sig-prev");
        let next = metadata("1.2.3", "https://example.com/v1.2.3.pkg", "sig-prev");
        assert!(!update_metadata_changed(&prev, &next));
    }

    #[test]
    fn metadata_changed_when_version_differs() {
        let prev = metadata("1.2.3", "https://example.com/pkg", "sig");
        let next = metadata("1.2.4", "https://example.com/pkg", "sig");
        assert!(update_metadata_changed(&prev, &next));
    }

    #[test]
    fn metadata_changed_when_download_url_differs() {
        let prev = metadata("1.2.3", "https://example.com/old.pkg", "sig");
        let next = metadata("1.2.3", "https://example.com/new.pkg", "sig");
        assert!(update_metadata_changed(&prev, &next));
    }

    #[test]
    fn metadata_changed_when_signature_differs() {
        let prev = metadata("1.2.3", "https://example.com/pkg", "sig-old");
        let next = metadata("1.2.3", "https://example.com/pkg", "sig-new");
        assert!(update_metadata_changed(&prev, &next));
    }

    /// 记录 fetch 是否被调用（`FnOnce` seam 最多调用一次，故用共享 flag 即可）。
    /// 闭包无参、返回 boxed `Send` future（`Fut` 泛型由 seam 推断为该 trait object）。
    type BoxedFetchFut = std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<Option<Update>, AppError>> + Send>,
    >;

    fn recording_fetch(outcome: Result<Option<Update>, AppError>) -> (Arc<Mutex<bool>>, impl FnOnce() -> BoxedFetchFut) {
        let called = Arc::new(Mutex::new(false));
        let called_for_closure = called.clone();
        let fetch = move || {
            *called_for_closure.lock().expect("fetch flag poisoned") = true;
            // 显式标注目标 trait object 类型触发 unsized coercion。
            let fut: BoxedFetchFut = Box::pin(async move { outcome });
            fut
        };
        (called, fetch)
    }

    #[tokio::test]
    async fn resolve_calls_fetch_and_returns_none_when_cache_empty() {
        // 缓存为空 + fetch 返回 None -> 结果 None，且 fetch 被调用一次。
        // （缓存命中跳过 fetch 的分支无法测试：需预填 `Update`，而 `Update` 不可构造。）
        let state = PendingUpdateState::default();
        let (called, fetch) = recording_fetch(Ok(None));

        let result = resolve_update_with_fetch(&state, None, fetch).await;

        // `Update` 未实现 `Debug`，无法 `unwrap`；用 as_ref 断言 Ok(None)。
        assert!(matches!(result.as_ref(), Ok(None)), "应返回 Ok(None)");
        assert!(
            *called.lock().expect("fetch flag poisoned"),
            "缓存 miss 时应调用 fetch"
        );
    }

    #[tokio::test]
    async fn resolve_propagates_fetch_error() {
        // 缓存为空 + fetch 返回 Err -> 透传 Err，fetch 被调用。
        let state = PendingUpdateState::default();
        let err = AppError::updater_with_code("boom".to_string(), "check_update_failed");
        let (called, fetch) = recording_fetch(Err(err));

        let result = resolve_update_with_fetch(&state, None, fetch).await;

        // `Update` 未实现 `Debug`，无法用 `expect_err`；手动断言 Err 分支。
        let err = match result {
            Err(err) => err,
            Ok(_) => panic!("fetch 失败应透传 Err"),
        };
        assert_eq!(err.code.as_deref(), Some("check_update_failed"));
        assert!(
            *called.lock().expect("fetch flag poisoned"),
            "缓存 miss 时应调用 fetch"
        );
    }

    #[tokio::test]
    async fn resolve_does_not_panic_with_version_filter_on_empty_cache() {
        // 缓存为空 + 带 expected_version 过滤 + fetch None -> Ok(None)。
        // 覆盖 `get_pending_update` 的 version 匹配分支在缓存为空时的早退语义。
        let state = PendingUpdateState::default();
        let (called, fetch) = recording_fetch(Ok(None));

        let result = resolve_update_with_fetch(&state, Some("1.2.3"), fetch).await;

        assert!(matches!(result.as_ref(), Ok(None)), "应返回 Ok(None)");
        assert!(
            *called.lock().expect("fetch flag poisoned"),
            "缓存为空时即便带版本过滤也应调用 fetch"
        );
    }

    #[tokio::test]
    async fn refresh_clears_cache_then_returns_none_on_fetch_error() {
        // 缓存失败刷新：先清缓存，fetch 返回 Err -> 返回 None。
        // （无法预填 `Update` 验证「清缓存」效果，但可确认 fetch 失败路径返回 None。）
        let state = PendingUpdateState::default();
        let previous = metadata("1.2.3", "https://example.com/pkg", "sig");
        let err = AppError::updater_with_code("boom".to_string(), "check_update_failed");
        let (called, fetch) = recording_fetch(Err(err));

        let result = refresh_after_failure_with_fetch(&state, &previous, fetch).await;

        assert!(result.is_none(), "fetch 失败应返回 None");
        assert!(
            *called.lock().expect("fetch flag poisoned"),
            "刷新时应调用 fetch"
        );
        assert!(
            state.pending_update.lock().unwrap().is_none(),
            "刷新后缓存应被清空"
        );
    }

    #[tokio::test]
    async fn refresh_returns_none_when_fetch_returns_none() {
        // fetch 返回 None（远端无更新）-> 返回 None。
        let state = PendingUpdateState::default();
        let previous = metadata("1.2.3", "https://example.com/pkg", "sig");
        let (called, fetch) = recording_fetch(Ok(None));

        let result = refresh_after_failure_with_fetch(&state, &previous, fetch).await;

        assert!(result.is_none(), "fetch 返回 None 时应返回 None");
        assert!(*called.lock().expect("fetch flag poisoned"));
    }
}
