//! 远端证据同步（决议 #88）：workflow artifacts 只是传输层，本地归档区才是
//! 持久层。控制面按绑定轮询已完成的 runs，把每个 job 的事件段与 prepared
//! attempt 拉回归档（digest 校验、稳定命名、append-only），随后用 #85 的
//! 多段 reducer 归约出 Attempt 结果。期望段集合由绑定的平台亲和推导；缺段
//! 触发补拉；保留期内从未同步且 artifact 已过期时显式进入"远端证据已过期"
//! 状态，不静默缺段。
//!
//! 远端 attempt 没有本地资源租约与流式续传，因此不写入本地执行 journal，
//! 而是独立归档区——读取侧统一经 reducer 呈现，无兼容分支。

use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};

use publish_domain::{sha256_hex, PublishAttemptStatus, PublishEvent};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::errors::AppError;
use crate::store::{AutomationBinding, RepoPublishConfig};
use one_publish_runner::{validate_prepared_attempt, PreparedAttempt};
use publish_runner_core::{reduce_publish_events, ShardOutcome};

const EVENTS_ARTIFACT_PREFIX: &str = "one-publish-events";
const PREPARED_ARTIFACT_PREFIX: &str = "one-publish-prepared";
/// 汇聚段亲和名（决议 #85）；每个远端 attempt 恰有一个汇聚段。
const AGGREGATE_SEGMENT: &str = "any";

#[derive(Debug, Clone)]
pub(crate) struct RemoteRun {
    pub run_id: u64,
    pub run_attempt: u64,
}

#[derive(Debug, Clone)]
pub(crate) struct RemoteArtifact {
    pub id: u64,
    pub name: String,
    pub expired: bool,
    /// REST asset digest（`sha256:<hex>`）；缺失视为不可校验、显式失败。
    pub digest: Option<String>,
}

/// GH runs/artifacts 的只读端口；桌面实现走 gh CLI，测试注入内存 fake。
pub(crate) trait RemoteEvidenceSource {
    fn completed_runs(
        &self,
        repo_root: &Path,
        workflow_file: &str,
    ) -> Result<Vec<RemoteRun>, AppError>;
    fn run_artifacts(&self, repo_root: &Path, run_id: u64) -> Result<Vec<RemoteArtifact>, AppError>;
    fn download_artifact(&self, repo_root: &Path, artifact_id: u64) -> Result<Vec<u8>, AppError>;
}

pub(crate) struct GhCliRemoteEvidenceSource;

impl GhCliRemoteEvidenceSource {
    fn gh_api(repo_root: &Path, path: &str) -> Result<Vec<u8>, AppError> {
        let output = crate::process_utils::new_std_command("gh")
            .current_dir(repo_root)
            .args(["api", path])
            .output()
            .map_err(|error| remote_error(format!("无法运行 gh api: {error}")))?;
        if !output.status.success() {
            return Err(remote_error(format!(
                "gh api {path} 失败: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }
        Ok(output.stdout)
    }
}

impl RemoteEvidenceSource for GhCliRemoteEvidenceSource {
    fn completed_runs(
        &self,
        repo_root: &Path,
        workflow_file: &str,
    ) -> Result<Vec<RemoteRun>, AppError> {
        #[derive(Deserialize)]
        struct RunsPayload {
            workflow_runs: Vec<RunPayload>,
        }
        #[derive(Deserialize)]
        struct RunPayload {
            id: u64,
            run_attempt: u64,
        }
        let payload = Self::gh_api(
            repo_root,
            &format!(
                "repos/{{owner}}/{{repo}}/actions/workflows/{workflow_file}/runs?status=completed&per_page=50"
            ),
        )?;
        let runs: RunsPayload = serde_json::from_slice(&payload)
            .map_err(|error| remote_error(format!("runs 载荷无法解析: {error}")))?;
        Ok(runs
            .workflow_runs
            .into_iter()
            .map(|run| RemoteRun {
                run_id: run.id,
                run_attempt: run.run_attempt,
            })
            .collect())
    }

    fn run_artifacts(
        &self,
        repo_root: &Path,
        run_id: u64,
    ) -> Result<Vec<RemoteArtifact>, AppError> {
        #[derive(Deserialize)]
        struct ArtifactsPayload {
            artifacts: Vec<ArtifactPayload>,
        }
        #[derive(Deserialize)]
        struct ArtifactPayload {
            id: u64,
            name: String,
            #[serde(default)]
            expired: bool,
            #[serde(default)]
            digest: Option<String>,
        }
        let payload = Self::gh_api(
            repo_root,
            &format!("repos/{{owner}}/{{repo}}/actions/runs/{run_id}/artifacts?per_page=100"),
        )?;
        let artifacts: ArtifactsPayload = serde_json::from_slice(&payload)
            .map_err(|error| remote_error(format!("artifacts 载荷无法解析: {error}")))?;
        Ok(artifacts
            .artifacts
            .into_iter()
            .map(|artifact| RemoteArtifact {
                id: artifact.id,
                name: artifact.name,
                expired: artifact.expired,
                digest: artifact.digest,
            })
            .collect())
    }

    fn download_artifact(&self, repo_root: &Path, artifact_id: u64) -> Result<Vec<u8>, AppError> {
        Self::gh_api(
            repo_root,
            &format!("repos/{{owner}}/{{repo}}/actions/artifacts/{artifact_id}/zip"),
        )
    }
}

fn remote_error(message: String) -> AppError {
    AppError::publish_with_code(
        format!("远端证据同步失败: {message}"),
        "remote_evidence_sync_failed",
    )
}

/// 手动 dispatch 与强取消端口（决议 #89/#84）：dispatch 经 workflow
/// dispatches API 并以 `return_run_details` 直取 run id；取消经 cancel run
/// API——语义限定为强取消，runner 协作清理不保证、事件段可能截尾。
pub(crate) trait RemoteDispatchPort {
    fn dispatch(
        &self,
        repo_root: &Path,
        workflow_file: &str,
        reference: &str,
        inputs: &BTreeMap<String, String>,
    ) -> Result<Option<u64>, AppError>;
    fn cancel(&self, repo_root: &Path, run_id: u64) -> Result<(), AppError>;
}

pub(crate) struct GhCliRemoteDispatchPort;

impl RemoteDispatchPort for GhCliRemoteDispatchPort {
    fn dispatch(
        &self,
        repo_root: &Path,
        workflow_file: &str,
        reference: &str,
        inputs: &BTreeMap<String, String>,
    ) -> Result<Option<u64>, AppError> {
        let mut command = crate::process_utils::new_std_command("gh");
        command.current_dir(repo_root).args([
            "api",
            &format!(
                "repos/{{owner}}/{{repo}}/actions/workflows/{workflow_file}/dispatches"
            ),
            "-X",
            "POST",
            "-f",
            &format!("ref={reference}"),
            "-F",
            "return_run_details=true",
        ]);
        for (key, value) in inputs {
            command.args(["-f", &format!("inputs[{key}]={value}")]);
        }
        let output = command
            .output()
            .map_err(|error| remote_error(format!("无法运行 gh api dispatch: {error}")))?;
        if !output.status.success() {
            return Err(remote_error(format!(
                "workflow dispatch 失败: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }
        let payload: Option<serde_json::Value> = serde_json::from_slice(&output.stdout).ok();
        Ok(payload.and_then(|value| {
            value
                .get("run_id")
                .or_else(|| value.get("id"))
                .and_then(serde_json::Value::as_u64)
        }))
    }

    fn cancel(&self, repo_root: &Path, run_id: u64) -> Result<(), AppError> {
        let output = crate::process_utils::new_std_command("gh")
            .current_dir(repo_root)
            .args([
                "api",
                &format!("repos/{{owner}}/{{repo}}/actions/runs/{run_id}/cancel"),
                "-X",
                "POST",
            ])
            .output()
            .map_err(|error| remote_error(format!("无法运行 gh api cancel: {error}")))?;
        if !output.status.success() {
            return Err(remote_error(format!(
                "取消 run {run_id} 失败: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ManualDispatchResult {
    pub attempt_id: String,
    #[ts(type = "number | null")]
    pub run_id: Option<u64>,
}

/// 手动语义（决议 #89）：经已安装的 workflow_dispatch 投影触发远端 Attempt。
/// attempt id 本地预生成并随 inputs 传入（run-name 回显）；dispatch 前预写
/// 占位、触发失败显式清理，不留半悬状态。
pub(crate) fn dispatch_manual_publish(
    repo_root: &Path,
    config: &RepoPublishConfig,
    binding_id: &str,
    version: &str,
    reference: &str,
    port: &dyn RemoteDispatchPort,
    archive: &RemoteEvidenceArchive,
) -> Result<ManualDispatchResult, AppError> {
    let binding = config
        .bindings
        .iter()
        .find(|binding| binding.id == binding_id)
        .ok_or_else(|| {
            AppError::validation_with_code(
                format!("未找到自动化绑定: {binding_id}"),
                "automation_binding_not_found",
            )
        })?;
    if binding.execution_backend_id != publish_adapters::GITHUB_ACTIONS_BACKEND_ID {
        return Err(AppError::validation_with_code(
            format!("绑定 {binding_id} 不是 GitHub Actions 远端绑定"),
            "remote_dispatch_backend_unsupported",
        ));
    }
    if !matches!(
        binding.trigger_policy,
        crate::store::AutomationTriggerPolicy::Manual
    ) {
        return Err(AppError::validation_with_code(
            format!("绑定 {binding_id} 不是手动触发，请通过推送 tag 发布"),
            "remote_dispatch_trigger_mismatch",
        ));
    }
    let workflow_file = Path::new(&binding.external_identity)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| {
            AppError::validation_with_code(
                format!("绑定 {binding_id} 尚未安装远端投影，请先应用自动化投影"),
                "remote_dispatch_projection_not_installed",
            )
        })?;
    let version = version.trim();
    if version.is_empty() {
        return Err(AppError::validation_with_code(
            "手动发布需要显式版本",
            "remote_dispatch_version_missing",
        ));
    }

    let attempt_id = crate::store::new_configuration_identity("manual-attempt");
    let pending_path = archive.pending_path(&attempt_id)?;
    archive.write(
        &pending_path,
        serde_json::json!({
            "bindingId": binding.id,
            "version": version,
            "dispatchedAt": chrono::Utc::now().to_rfc3339(),
        })
        .to_string()
        .as_bytes(),
    )?;
    let inputs = BTreeMap::from([
        ("attempt-id".to_string(), attempt_id.clone()),
        ("version".to_string(), version.to_string()),
    ]);
    match port.dispatch(repo_root, workflow_file, reference, &inputs) {
        Ok(run_id) => Ok(ManualDispatchResult { attempt_id, run_id }),
        Err(error) => {
            // 触发失败显式清理占位，不留半悬状态（决议 #89）。
            let _ = std::fs::remove_file(&pending_path);
            Err(error)
        }
    }
}

/// 独立归档区：`~/.one-publish/publish-attempts/remote/<run>/`。
/// 段与 prepared 一经写入不再改写（append-only）；重复同步只补缺。
pub(crate) struct RemoteEvidenceArchive {
    root: PathBuf,
}

impl RemoteEvidenceArchive {
    pub(crate) fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub(crate) fn for_current_user() -> Result<Self, AppError> {
        let home_dir = dirs::home_dir().ok_or_else(|| {
            remote_error("cannot locate the current user home for the remote archive".to_string())
        })?;
        Ok(Self::new(
            home_dir
                .join(".one-publish")
                .join("publish-attempts")
                .join("remote"),
        ))
    }

    fn attempt_dir(&self, attempt_id: &str) -> Result<PathBuf, AppError> {
        if !publish_domain::is_safe_portable_relative_path(attempt_id) {
            return Err(remote_error(format!(
                "remote attempt id {attempt_id} is not a safe archive path"
            )));
        }
        Ok(self.root.join(attempt_id))
    }

    fn segment_path(&self, attempt_id: &str, affinity: &str) -> Result<PathBuf, AppError> {
        Ok(self
            .attempt_dir(attempt_id)?
            .join("segments")
            .join(format!("{affinity}.json")))
    }

    fn prepared_path(&self, attempt_id: &str) -> Result<PathBuf, AppError> {
        Ok(self.attempt_dir(attempt_id)?.join("prepared.json"))
    }

    fn pending_path(&self, attempt_id: &str) -> Result<PathBuf, AppError> {
        if !publish_domain::is_safe_portable_relative_path(attempt_id) {
            return Err(remote_error(format!(
                "manual attempt id {attempt_id} is not a safe archive path"
            )));
        }
        Ok(self.root.join("pending").join(format!("{attempt_id}.json")))
    }

    fn write(&self, path: &Path, bytes: &[u8]) -> Result<(), AppError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| remote_error(format!("无法创建归档目录: {error}")))?;
        }
        std::fs::write(path, bytes)
            .map_err(|error| remote_error(format!("无法写入归档 {}: {error}", path.display())))
    }

    fn read_json<T: for<'de> Deserialize<'de>>(&self, path: &Path) -> Result<Option<T>, AppError> {
        if !path.is_file() {
            return Ok(None);
        }
        let bytes = std::fs::read(path)
            .map_err(|error| remote_error(format!("无法读取归档 {}: {error}", path.display())))?;
        serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|error| remote_error(format!("归档 {} 已损坏: {error}", path.display())))
    }
}

/// 远端 attempt 的同步结果视图。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct RemoteAttemptEvidenceView {
    pub attempt_id: String,
    pub binding_id: String,
    #[ts(type = "number")]
    pub run_id: u64,
    pub state: RemoteEvidenceState,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RemoteEvidenceState {
    /// 全部段已归档并归约出结果。
    #[serde(rename_all = "camelCase")]
    Archived {
        status: RemoteArchivedStatus,
        error: Option<String>,
    },
    /// 段尚未齐（job 未上传或尚未拉到）；缺段可补拉。
    #[serde(rename_all = "camelCase")]
    MissingSegments { missing: Vec<String> },
    /// 保留期内从未同步且 artifact 已过期：证据不可恢复（决议 #88）。
    #[serde(rename_all = "camelCase")]
    Expired { missing: Vec<String> },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum RemoteArchivedStatus {
    Running,
    Published,
    PartialDelivery,
    Failed,
    Cancelled,
}

impl From<PublishAttemptStatus> for RemoteArchivedStatus {
    fn from(status: PublishAttemptStatus) -> Self {
        match status {
            PublishAttemptStatus::Running => Self::Running,
            PublishAttemptStatus::Published => Self::Published,
            PublishAttemptStatus::PartialDelivery => Self::PartialDelivery,
            PublishAttemptStatus::Failed => Self::Failed,
            PublishAttemptStatus::Cancelled => Self::Cancelled,
        }
    }
}

/// 期望段集合 = 绑定启用平台的族集合 + 汇聚段（决议 #88：由平台亲和推导）。
fn expected_segments(binding: &AutomationBinding) -> Result<Vec<String>, AppError> {
    let release_config = serde_json::from_value::<crate::tauri_release::TauriReleaseConfig>(
        binding.backend_projection.clone(),
    )
    .map_err(|error| {
        remote_error(format!(
            "绑定 {} 的固化投影无法解析: {error}",
            binding.id
        ))
    })?;
    let mut segments = release_config
        .enabled_targets
        .iter()
        .map(|target| {
            publish_runner_core::platform_segment_name(
                publish_adapters::tauri::platform_for_build_target(target.build_target_triple()),
            )
            .to_string()
        })
        .collect::<std::collections::BTreeSet<_>>();
    segments.insert(AGGREGATE_SEGMENT.to_string());
    Ok(segments.into_iter().collect())
}

/// 从 zip artifact 中取唯一 JSON 负载（段文件或 prepared attempt）。
fn unzip_single_json(bytes: &[u8]) -> Result<Vec<u8>, AppError> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|error| remote_error(format!("artifact zip 无法解包: {error}")))?;
    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|error| remote_error(format!("artifact zip 无法读取: {error}")))?;
        if file.name().ends_with(".json") {
            let mut content = Vec::new();
            file.read_to_end(&mut content)
                .map_err(|error| remote_error(format!("artifact 负载读取失败: {error}")))?;
            return Ok(content);
        }
    }
    Err(remote_error(
        "artifact zip 不包含 JSON 证据负载".to_string(),
    ))
}

fn verify_artifact_digest(artifact: &RemoteArtifact, bytes: &[u8]) -> Result<(), AppError> {
    let digest = artifact
        .digest
        .as_deref()
        .and_then(|digest| digest.strip_prefix("sha256:"))
        .ok_or_else(|| {
            remote_error(format!(
                "artifact {} 缺少 sha256 digest，证据不可校验",
                artifact.name
            ))
        })?;
    let actual = sha256_hex(bytes);
    if digest != actual {
        return Err(remote_error(format!(
            "artifact {} digest 不匹配: 期望 {digest}，实际 {actual}",
            artifact.name
        )));
    }
    Ok(())
}

pub(crate) fn synchronize_remote_evidence(
    repo_root: &Path,
    config: &RepoPublishConfig,
    source: &dyn RemoteEvidenceSource,
    archive: &RemoteEvidenceArchive,
) -> Result<Vec<RemoteAttemptEvidenceView>, AppError> {
    let mut views = Vec::new();
    for binding in &config.bindings {
        if binding.execution_backend_id != publish_adapters::GITHUB_ACTIONS_BACKEND_ID {
            continue;
        }
        let workflow_file = Path::new(&binding.external_identity)
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .ok_or_else(|| {
                remote_error(format!(
                    "绑定 {} 缺少 workflow 外部身份，无法轮询 runs",
                    binding.id
                ))
            })?;
        let expected = expected_segments(binding)?;
        for run in source.completed_runs(repo_root, workflow_file)? {
            views.push(synchronize_run(
                repo_root, binding, &expected, &run, source, archive,
            )?);
        }
    }
    Ok(views)
}

fn synchronize_run(
    repo_root: &Path,
    binding: &AutomationBinding,
    expected_segments: &[String],
    run: &RemoteRun,
    source: &dyn RemoteEvidenceSource,
    archive: &RemoteEvidenceArchive,
) -> Result<RemoteAttemptEvidenceView, AppError> {
    // 归档目录以 run 定位；attempt 身份从段事件读取——tag 外壳按 run 推导，
    // 手动 dispatch 的 attempt id 由桌面预生成并经 inputs 传入（决议 #89）。
    let archive_key = format!("gh-{}-{}", run.run_id, run.run_attempt);
    let missing_segments = |archive: &RemoteEvidenceArchive| -> Result<Vec<String>, AppError> {
        let mut missing = Vec::new();
        for segment in expected_segments {
            if !archive.segment_path(&archive_key, segment)?.is_file() {
                missing.push(segment.clone());
            }
        }
        Ok(missing)
    };

    let mut missing = missing_segments(archive)?;
    let prepared_missing = archive.prepared_path(&archive_key)?.is_file().eq(&false);
    let mut expired = Vec::new();
    if !missing.is_empty() || prepared_missing {
        let artifacts = source.run_artifacts(repo_root, run.run_id)?;
        let find = |name: &str| artifacts.iter().find(|artifact| artifact.name == name);
        for segment in missing.clone() {
            let name = format!(
                "{EVENTS_ARTIFACT_PREFIX}-{}-{}-{segment}",
                run.run_id, run.run_attempt
            );
            match find(&name) {
                Some(artifact) if artifact.expired => expired.push(segment.clone()),
                Some(artifact) => {
                    let bytes = source.download_artifact(repo_root, artifact.id)?;
                    verify_artifact_digest(artifact, &bytes)?;
                    let payload = unzip_single_json(&bytes)?;
                    // 归档前校验形状：段必须能解析为分片证据。
                    let _: ShardOutcome = serde_json::from_slice(&payload).map_err(|error| {
                        remote_error(format!("段 {name} 无法解析: {error}"))
                    })?;
                    archive.write(&archive.segment_path(&archive_key, &segment)?, &payload)?;
                }
                None => {}
            }
        }
        if prepared_missing {
            let prepared_artifact = artifacts.iter().find(|artifact| {
                artifact.name.starts_with(&format!(
                    "{PREPARED_ARTIFACT_PREFIX}-{}-{}-",
                    run.run_id, run.run_attempt
                ))
            });
            if let Some(artifact) = prepared_artifact {
                if !artifact.expired {
                    let bytes = source.download_artifact(repo_root, artifact.id)?;
                    verify_artifact_digest(artifact, &bytes)?;
                    let payload = unzip_single_json(&bytes)?;
                    let prepared: PreparedAttempt =
                        serde_json::from_slice(&payload).map_err(|error| {
                            remote_error(format!("prepared attempt 无法解析: {error}"))
                        })?;
                    validate_prepared_attempt(&prepared).map_err(|error| {
                        remote_error(format!("prepared attempt 校验失败: {error}"))
                    })?;
                    archive.write(&archive.prepared_path(&archive_key)?, &payload)?;
                }
            }
        }
        missing = missing_segments(archive)?;
    }

    let prepared: Option<PreparedAttempt> =
        archive.read_json(&archive.prepared_path(&archive_key)?)?;
    let (state, attempt_id) = if missing.is_empty() {
        let Some(prepared) = prepared else {
            return Ok(RemoteAttemptEvidenceView {
                attempt_id: archive_key,
                binding_id: binding.id.clone(),
                run_id: run.run_id,
                state: RemoteEvidenceState::MissingSegments {
                    missing: vec!["prepared".to_string()],
                },
            });
        };
        reduce_archived_attempt(archive, &archive_key, expected_segments, &prepared)?
    } else if !expired.is_empty() {
        (RemoteEvidenceState::Expired { missing }, None)
    } else {
        (RemoteEvidenceState::MissingSegments { missing }, None)
    };
    Ok(RemoteAttemptEvidenceView {
        attempt_id: attempt_id.unwrap_or(archive_key),
        binding_id: binding.id.clone(),
        run_id: run.run_id,
        state,
    })
}

/// 全段归档后的归约：段事件必须钉住 prepared 的 plan digest 且段间归属同一
/// attempt，多段合并语义复用 #85 的 reducer；汇聚段的 Manifest 与归约出的
/// 绑定摘要互验。返回归约状态与事件承载的 attempt 身份。
fn reduce_archived_attempt(
    archive: &RemoteEvidenceArchive,
    archive_key: &str,
    expected_segments: &[String],
    prepared: &PreparedAttempt,
) -> Result<(RemoteEvidenceState, Option<String>), AppError> {
    let mut events: Vec<PublishEvent> = Vec::new();
    let mut manifests = BTreeMap::new();
    for segment in expected_segments {
        let outcome: ShardOutcome = archive
            .read_json(&archive.segment_path(archive_key, segment)?)?
            .ok_or_else(|| remote_error(format!("段 {segment} 归档缺失")))?;
        if let Some(manifest) = outcome.manifest {
            manifests.insert(segment.clone(), manifest);
        }
        events.extend(outcome.events);
    }
    let mut attempt_id: Option<String> = None;
    for event in &events {
        if event.plan_digest != prepared.prepared.plan.digest {
            return Err(remote_error(format!(
                "段事件 {} 未钉住 prepared plan digest",
                event.event_id
            )));
        }
        match &attempt_id {
            Some(existing) if existing != &event.attempt_id => {
                return Err(remote_error(format!(
                    "run {archive_key} 的段携带互相冲突的 attempt 身份"
                )));
            }
            Some(_) => {}
            None => attempt_id = Some(event.attempt_id.clone()),
        }
    }
    let projection = reduce_publish_events(&events, &prepared.prepared.plan.routes)
        .map_err(|error| remote_error(format!("事件段归约失败: {error}")))?;
    if let Some((_, manifest)) = manifests.iter().next() {
        publish_runner_core::validate_manifest_provenance(&prepared.prepared, manifest)
            .map_err(|error| remote_error(format!("Manifest 溯源校验失败: {error}")))?;
        if let Some(reduced) = projection.manifest_digest.as_deref() {
            if manifest.digest != reduced {
                return Err(remote_error(format!(
                    "汇聚段 Manifest {} 与事件归约 {reduced} 不一致",
                    manifest.digest
                )));
            }
        }
    }
    Ok((
        RemoteEvidenceState::Archived {
            status: projection.status.into(),
            error: projection.error,
        },
        attempt_id,
    ))
}

#[tauri::command]
pub async fn synchronize_remote_publish_evidence(
    repo_id: String,
) -> Result<Vec<RemoteAttemptEvidenceView>, AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new(
        "publish_runtime::synchronize_remote_publish_evidence",
    );
    let state = crate::store::get_state();
    let repo = crate::store::find_repository(&state.repositories, &repo_id)?;
    let repo_root = repository_root(&repo.path)?;
    synchronize_remote_evidence(
        &repo_root,
        &repo.publish_config,
        &GhCliRemoteEvidenceSource,
        &RemoteEvidenceArchive::for_current_user()?,
    )
}

#[tauri::command]
pub async fn dispatch_manual_publish_run(
    repo_id: String,
    binding_id: String,
    version: String,
) -> Result<ManualDispatchResult, AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new(
        "publish_runtime::dispatch_manual_publish_run",
    );
    let state = crate::store::get_state();
    let repo = crate::store::find_repository(&state.repositories, &repo_id)?;
    let repo_root = repository_root(&repo.path)?;
    let reference = crate::automation::repository_default_branch(&repo_root)?;
    dispatch_manual_publish(
        &repo_root,
        &repo.publish_config,
        &binding_id,
        &version,
        &reference,
        &GhCliRemoteDispatchPort,
        &RemoteEvidenceArchive::for_current_user()?,
    )
}

#[tauri::command]
pub async fn cancel_remote_publish_run(repo_id: String, run_id: u64) -> Result<(), AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new(
        "publish_runtime::cancel_remote_publish_run",
    );
    let state = crate::store::get_state();
    let repo = crate::store::find_repository(&state.repositories, &repo_id)?;
    let repo_root = repository_root(&repo.path)?;
    GhCliRemoteDispatchPort.cancel(&repo_root, run_id)
}

fn repository_root(path: &str) -> Result<PathBuf, AppError> {
    let root = Path::new(path.trim());
    if path.trim().is_empty() || !root.is_dir() {
        return Err(AppError::repository_with_code(
            format!("仓库路径不可用: {path}"),
            "remote_evidence_repository_unavailable",
        ));
    }
    Ok(root.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::io::Write;
    use std::process::Command;

    use publish_domain::{
        AdapterBinding, AdapterIdentity, AdapterKind, AdapterSelection, AdapterSettings,
        AutomationTriggerPolicy, DeliveryRoute, PUBLISH_EVENT_VERSION,
    };
    use serde_json::Value;

    fn run_git(dir: &Path, args: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .output()
            .expect("run git fixture command");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn fixture_checkout() -> tempfile::TempDir {
        let temp = tempfile::tempdir().expect("temp checkout");
        run_git(temp.path(), &["init", "--quiet", "-b", "main"]);
        run_git(temp.path(), &["config", "user.name", "One Publish Tests"]);
        run_git(
            temp.path(),
            &["config", "user.email", "tests@one-publish.invalid"],
        );
        std::fs::write(temp.path().join("README.md"), "fixture\n").expect("write fixture file");
        run_git(temp.path(), &["add", "--all"]);
        run_git(temp.path(), &["commit", "--quiet", "-m", "fixture"]);
        temp
    }

    fn fixture_prepared(checkout: &Path) -> PreparedAttempt {
        let adapters = AdapterSelection {
            project_provider: AdapterBinding::new(
                "project",
                AdapterIdentity::new(
                    AdapterKind::ProjectProvider,
                    publish_adapters::TAURI_PROVIDER_ID,
                    1,
                ),
                AdapterSettings::new(1)
                    .with_value(
                        "config_path",
                        Value::String("src-tauri/tauri.conf.json".to_string()),
                    )
                    .with_value("build_driver", Value::String("pnpm".to_string())),
            ),
            artifact_processors: vec![AdapterBinding::new(
                "checksums",
                AdapterIdentity::new(
                    AdapterKind::ArtifactProcessor,
                    publish_adapters::CHECKSUM_PROCESSOR_ID,
                    1,
                ),
                AdapterSettings::new(1),
            )],
            execution_backend: AdapterBinding::new(
                "backend",
                AdapterIdentity::new(
                    AdapterKind::ExecutionBackend,
                    publish_adapters::GITHUB_ACTIONS_BACKEND_ID,
                    1,
                ),
                AdapterSettings::new(1),
            ),
            artifact_store: AdapterBinding::new(
                "store",
                AdapterIdentity::new(AdapterKind::ArtifactStore, "temporary-artifact-store", 1),
                AdapterSettings::new(1),
            ),
            delivery_routes: vec![DeliveryRoute::required(AdapterBinding::new(
                "local-delivery",
                AdapterIdentity::new(
                    AdapterKind::DeliveryDestination,
                    publish_adapters::LOCAL_DESTINATION_ID,
                    1,
                ),
                AdapterSettings::new(1),
            ))],
        };
        let runtime_revision = one_publish_runner::current_runtime_revision(
            adapters
                .ordered_bindings()
                .into_iter()
                .map(|binding| binding.adapter.clone()),
        )
        .expect("seal fixture runtime revision");
        let projection = one_publish_runner::RunnerProjection {
            version: one_publish_runner::RUNNER_PROJECTION_VERSION,
            binding_id: "binding-stable".to_string(),
            configuration_id: "configuration-1".to_string(),
            configuration_revision_id: "configuration-revision-1".to_string(),
            trigger_policy: AutomationTriggerPolicy::TagPush {
                tag_prefix: "v".to_string(),
            },
            runtime_revision,
            release_input: BTreeMap::new(),
            adapters,
            secret_bindings: BTreeMap::new(),
        };
        one_publish_runner::prepare_from_projection(
            &projection,
            &one_publish_runner::TriggerContext {
                repository_root: checkout.to_path_buf(),
                trigger: one_publish_runner::TriggerInput::Tag("v1.0.0".to_string()),
            },
        )
        .expect("plan the fixture attempt on site")
    }

    fn segment_outcome(
        attempt_id: &str,
        affinity: &str,
        plan_digest: &str,
        node_id: &str,
    ) -> ShardOutcome {
        let event = |sequence: u64, kind: &str| PublishEvent {
            version: PUBLISH_EVENT_VERSION,
            event_id: format!("{attempt_id}/{affinity}#{sequence}"),
            attempt_id: attempt_id.to_string(),
            backend_run_id: format!("{attempt_id}/{affinity}"),
            sequence,
            plan_digest: plan_digest.to_string(),
            plan_node_id: node_id.to_string(),
            kind: kind.to_string(),
            payload: BTreeMap::new(),
        };
        ShardOutcome {
            events: vec![event(1, "plan_node_started"), event(2, "plan_node_completed")],
            manifest: None,
        }
    }

    fn zip_bytes(file_name: &str, content: &[u8]) -> Vec<u8> {
        let mut buffer = std::io::Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut buffer);
            writer
                .start_file(file_name, zip::write::SimpleFileOptions::default())
                .expect("start zip entry");
            writer.write_all(content).expect("write zip entry");
            writer.finish().expect("finish zip");
        }
        buffer.into_inner()
    }

    #[derive(Default)]
    struct FakeSource {
        runs: Vec<RemoteRun>,
        artifacts: BTreeMap<u64, Vec<RemoteArtifact>>,
        payloads: BTreeMap<u64, Vec<u8>>,
        downloads: RefCell<usize>,
    }

    impl FakeSource {
        fn push_artifact(&mut self, run_id: u64, id: u64, name: &str, zip: Vec<u8>, expired: bool) {
            self.artifacts.entry(run_id).or_default().push(RemoteArtifact {
                id,
                name: name.to_string(),
                expired,
                digest: Some(format!("sha256:{}", sha256_hex(&zip))),
            });
            self.payloads.insert(id, zip);
        }
    }

    impl RemoteEvidenceSource for FakeSource {
        fn completed_runs(
            &self,
            _repo_root: &Path,
            _workflow_file: &str,
        ) -> Result<Vec<RemoteRun>, AppError> {
            Ok(self.runs.clone())
        }

        fn run_artifacts(
            &self,
            _repo_root: &Path,
            run_id: u64,
        ) -> Result<Vec<RemoteArtifact>, AppError> {
            Ok(self.artifacts.get(&run_id).cloned().unwrap_or_default())
        }

        fn download_artifact(&self, _repo_root: &Path, artifact_id: u64) -> Result<Vec<u8>, AppError> {
            *self.downloads.borrow_mut() += 1;
            self.payloads
                .get(&artifact_id)
                .cloned()
                .ok_or_else(|| remote_error(format!("artifact {artifact_id} 不存在")))
        }
    }

    fn fixture_binding() -> AutomationBinding {
        AutomationBinding {
            id: "binding-stable".to_string(),
            configuration_id: "configuration-1".to_string(),
            configuration_revision_id: "configuration-revision-1".to_string(),
            execution_backend_id: publish_adapters::GITHUB_ACTIONS_BACKEND_ID.to_string(),
            trigger_policy: crate::store::AutomationTriggerPolicy::TagPush {
                tag_prefix: "v".to_string(),
            },
            backend_projection: serde_json::to_value(
                crate::tauri_release::TauriReleaseConfig::default(),
            )
            .expect("serialize release settings"),
            runtime_revision: publish_domain::PinnedAutomationRuntimeRevision::Legacy(
                "fixture-runtime".to_string(),
            ),
            external_identity: ".github/workflows/one-publish-binding-stable-release.yml"
                .to_string(),
            created_at: "2026-07-22T10:00:00Z".to_string(),
            updated_at: "2026-07-22T10:00:00Z".to_string(),
        }
    }

    fn fixture_config() -> RepoPublishConfig {
        let mut config = RepoPublishConfig::default();
        config.bindings.push(fixture_binding());
        config
    }

    fn seed_source(prepared: &PreparedAttempt) -> FakeSource {
        let attempt_id = "gh-7-1";
        let digest = prepared.prepared.plan.digest.clone();
        let mut source = FakeSource {
            runs: vec![RemoteRun {
                run_id: 7,
                run_attempt: 1,
            }],
            ..FakeSource::default()
        };
        for (index, affinity) in ["any", "linux", "macos", "windows"].iter().enumerate() {
            let outcome = segment_outcome(attempt_id, affinity, &digest, "project.build");
            source.push_artifact(
                7,
                index as u64 + 1,
                &format!("one-publish-events-7-1-{affinity}"),
                zip_bytes(
                    &format!("one-publish-events-{affinity}.json"),
                    &serde_json::to_vec(&outcome).expect("serialize segment"),
                ),
                false,
            );
        }
        source.push_artifact(
            7,
            9,
            "one-publish-prepared-7-1-any",
            zip_bytes(
                "prepared-attempt.json",
                &serde_json::to_vec(prepared).expect("serialize prepared"),
            ),
            false,
        );
        source
    }

    #[test]
    fn complete_runs_archive_all_segments_and_reduce_a_status() {
        let checkout = fixture_checkout();
        let prepared = fixture_prepared(checkout.path());
        let source = seed_source(&prepared);
        let archive_root = tempfile::tempdir().expect("archive root");
        let archive = RemoteEvidenceArchive::new(archive_root.path().to_path_buf());
        let config = fixture_config();

        let views =
            synchronize_remote_evidence(checkout.path(), &config, &source, &archive)
                .expect("synchronize remote evidence");
        assert_eq!(views.len(), 1);
        assert_eq!(views[0].attempt_id, "gh-7-1");
        assert_eq!(
            views[0].state,
            RemoteEvidenceState::Archived {
                status: RemoteArchivedStatus::Running,
                error: None,
            }
        );
        let first_downloads = *source.downloads.borrow();
        assert_eq!(first_downloads, 5);

        // 归档是持久层：重复同步不再拉取任何 artifact（append-only + 去重）。
        let views = synchronize_remote_evidence(checkout.path(), &config, &source, &archive)
            .expect("resynchronize");
        assert_eq!(*source.downloads.borrow(), first_downloads);
        assert!(matches!(
            views[0].state,
            RemoteEvidenceState::Archived { .. }
        ));
    }

    #[test]
    fn missing_segments_are_refetched_and_expired_evidence_is_explicit() {
        let checkout = fixture_checkout();
        let prepared = fixture_prepared(checkout.path());
        let mut source = seed_source(&prepared);
        // 抽掉 windows 段：缺段可补拉，而不是静默归约。
        let removed = source
            .artifacts
            .get_mut(&7)
            .expect("run artifacts")
            .iter()
            .position(|artifact| artifact.name.ends_with("-windows"))
            .expect("windows segment");
        let windows = source.artifacts.get_mut(&7).expect("run artifacts").remove(removed);
        let archive_root = tempfile::tempdir().expect("archive root");
        let archive = RemoteEvidenceArchive::new(archive_root.path().to_path_buf());
        let config = fixture_config();

        let views = synchronize_remote_evidence(checkout.path(), &config, &source, &archive)
            .expect("synchronize with a missing segment");
        assert_eq!(
            views[0].state,
            RemoteEvidenceState::MissingSegments {
                missing: vec!["windows".to_string()],
            }
        );

        // 段重新可得：补拉只下载缺段，随后归约完整。
        let downloads_before = *source.downloads.borrow();
        source.artifacts.get_mut(&7).expect("run artifacts").push(windows);
        let views = synchronize_remote_evidence(checkout.path(), &config, &source, &archive)
            .expect("refetch the missing segment");
        assert!(matches!(
            views[0].state,
            RemoteEvidenceState::Archived { .. }
        ));
        assert_eq!(*source.downloads.borrow(), downloads_before + 1);

        // 过期段：显式进入"远端证据已过期"，不静默缺段（决议 #88）。
        let mut expired_source = seed_source(&prepared);
        for artifact in expired_source.artifacts.get_mut(&7).expect("run artifacts") {
            if artifact.name.ends_with("-macos") {
                artifact.expired = true;
            }
        }
        let archive_root = tempfile::tempdir().expect("fresh archive root");
        let archive = RemoteEvidenceArchive::new(archive_root.path().to_path_buf());
        let views =
            synchronize_remote_evidence(checkout.path(), &config, &expired_source, &archive)
                .expect("synchronize expired evidence");
        assert_eq!(
            views[0].state,
            RemoteEvidenceState::Expired {
                missing: vec!["macos".to_string()],
            }
        );
    }

    #[test]
    fn tampered_artifacts_fail_digest_verification() {
        let checkout = fixture_checkout();
        let prepared = fixture_prepared(checkout.path());
        let mut source = seed_source(&prepared);
        for artifact in source.artifacts.get_mut(&7).expect("run artifacts") {
            if artifact.name.ends_with("-linux") {
                artifact.digest = Some(format!("sha256:{}", "0".repeat(64)));
            }
        }
        let archive_root = tempfile::tempdir().expect("archive root");
        let archive = RemoteEvidenceArchive::new(archive_root.path().to_path_buf());

        let error = synchronize_remote_evidence(
            checkout.path(),
            &fixture_config(),
            &source,
            &archive,
        )
        .expect_err("digest mismatches must fail loudly");
        assert!(error.message.contains("digest 不匹配"));
    }

    type DispatchedRecord = (String, String, BTreeMap<String, String>);

    #[derive(Default)]
    struct FakeDispatchPort {
        fail: bool,
        dispatched: RefCell<Vec<DispatchedRecord>>,
        cancelled: RefCell<Vec<u64>>,
    }

    impl RemoteDispatchPort for FakeDispatchPort {
        fn dispatch(
            &self,
            _repo_root: &Path,
            workflow_file: &str,
            reference: &str,
            inputs: &BTreeMap<String, String>,
        ) -> Result<Option<u64>, AppError> {
            if self.fail {
                return Err(remote_error("dispatch rejected".to_string()));
            }
            self.dispatched.borrow_mut().push((
                workflow_file.to_string(),
                reference.to_string(),
                inputs.clone(),
            ));
            Ok(Some(42))
        }

        fn cancel(&self, _repo_root: &Path, run_id: u64) -> Result<(), AppError> {
            self.cancelled.borrow_mut().push(run_id);
            Ok(())
        }
    }

    fn manual_config() -> RepoPublishConfig {
        let mut config = fixture_config();
        config.bindings[0].trigger_policy = crate::store::AutomationTriggerPolicy::Manual;
        config
    }

    #[test]
    fn manual_dispatch_sends_inputs_and_cleans_up_the_placeholder_on_failure() {
        let checkout = fixture_checkout();
        let archive_root = tempfile::tempdir().expect("archive root");
        let archive = RemoteEvidenceArchive::new(archive_root.path().to_path_buf());
        let config = manual_config();
        let port = FakeDispatchPort::default();

        let result = dispatch_manual_publish(
            checkout.path(),
            &config,
            "binding-stable",
            "1.2.3",
            "main",
            &port,
            &archive,
        )
        .expect("dispatch the manual attempt");
        assert!(result.attempt_id.starts_with("manual-attempt"));
        assert_eq!(result.run_id, Some(42));
        // 占位随 dispatch 成功保留为审计痕迹；inputs 携带预生成 attempt id。
        assert!(archive
            .pending_path(&result.attempt_id)
            .expect("pending path")
            .is_file());
        let dispatched = port.dispatched.borrow();
        let (workflow, reference, inputs) = &dispatched[0];
        assert_eq!(workflow, "one-publish-binding-stable-release.yml");
        assert_eq!(reference, "main");
        assert_eq!(inputs.get("attempt-id"), Some(&result.attempt_id));
        assert_eq!(inputs.get("version"), Some(&"1.2.3".to_string()));

        // 触发失败：占位显式清理，不留半悬状态（决议 #89）。
        let failing = FakeDispatchPort {
            fail: true,
            ..FakeDispatchPort::default()
        };
        let error = dispatch_manual_publish(
            checkout.path(),
            &config,
            "binding-stable",
            "1.2.3",
            "main",
            &failing,
            &archive,
        )
        .expect_err("dispatch failure surfaces");
        assert!(error.message.contains("dispatch rejected"));
        let pending_dir = archive_root.path().join("pending");
        let leftovers = std::fs::read_dir(&pending_dir)
            .map(|entries| entries.count())
            .unwrap_or(0);
        assert_eq!(leftovers, 1, "only the successful dispatch keeps its placeholder");
    }

    #[test]
    fn manual_dispatch_blocks_without_an_installed_projection_or_manual_policy() {
        let checkout = fixture_checkout();
        let archive_root = tempfile::tempdir().expect("archive root");
        let archive = RemoteEvidenceArchive::new(archive_root.path().to_path_buf());
        let port = FakeDispatchPort::default();

        // 未安装投影：显式 blocked 并引导先安装（决议 #89）。
        let mut uninstalled = manual_config();
        uninstalled.bindings[0].external_identity = String::new();
        let error = dispatch_manual_publish(
            checkout.path(),
            &uninstalled,
            "binding-stable",
            "1.2.3",
            "main",
            &port,
            &archive,
        )
        .expect_err("an uninstalled projection must block dispatch");
        assert_eq!(
            error.code.as_deref(),
            Some("remote_dispatch_projection_not_installed")
        );

        // tag 绑定不能手动 dispatch：发布路径由触发策略决定。
        let tag_bound = fixture_config();
        let error = dispatch_manual_publish(
            checkout.path(),
            &tag_bound,
            "binding-stable",
            "1.2.3",
            "main",
            &port,
            &archive,
        )
        .expect_err("tag bindings must not dispatch manually");
        assert_eq!(
            error.code.as_deref(),
            Some("remote_dispatch_trigger_mismatch")
        );
        assert!(port.dispatched.borrow().is_empty());
    }
}

