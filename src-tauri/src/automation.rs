//! Automation Binding 与 Automation Projection Bundle 的管理链路（#53 / T04）。
//!
//! 统一管线：解析目标绑定集 → 生成只读投影 → 由执行后端渲染投影包 →
//! 与仓库现状做差异 → 确认摘要后以接入提交应用 → 更新本地绑定状态。
//! 预览、应用、同步（漂移协调）、升级与解除都是同一条管线上的不同目标集。

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::process::Output;
use std::sync::Arc;

use publish_adapters::{ExecutionBackend, FakeAutomationBackend, FAKE_AUTOMATION_BACKEND_ID};
use publish_domain::{
    canonical_digest, diff_automation_files, is_safe_portable_relative_path,
    AutomationBindingProjection, AutomationBundleFile, AutomationBundleFileChange,
    AutomationFileChangeKind, AutomationProjection, AutomationTriggerPolicy as DomainTriggerPolicy,
    PublishError, ADAPTER_CONTRACT_VERSION, PUBLISH_PLAN_VERSION,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use crate::errors::AppError;
use crate::store::{
    new_configuration_identity, AppliedProjectionBundle, AutomationBinding,
    AutomationTriggerPolicy, RepoPublishConfig,
};

pub const AUTOMATION_DRIFT_BLOCKED_REASON: &str = "automation_projection_drift";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AutomationChangeRequest {
    #[serde(rename_all = "camelCase")]
    Install {
        configuration_id: String,
        execution_backend_id: String,
        trigger_policy: AutomationTriggerPolicy,
        /// 由预览归一化填充；应用必须回传同一身份，否则确认摘要无法匹配。
        #[serde(default)]
        binding_id: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    UpgradeRevision {
        binding_id: String,
    },
    Reconcile,
    #[serde(rename_all = "camelCase")]
    Detach {
        binding_id: String,
    },
}

impl AutomationChangeRequest {
    /// 预览时固定 Install 的绑定身份，让应用阶段重放出完全相同的目标集与摘要。
    fn normalized(&self) -> Self {
        match self {
            Self::Install {
                configuration_id,
                execution_backend_id,
                trigger_policy,
                binding_id,
            } => Self::Install {
                configuration_id: configuration_id.clone(),
                execution_backend_id: execution_backend_id.clone(),
                trigger_policy: trigger_policy.clone(),
                binding_id: Some(
                    binding_id
                        .clone()
                        .unwrap_or_else(|| new_configuration_identity("automation-binding")),
                ),
            },
            other => other.clone(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum AutomationFileChangeKindView {
    Added,
    Updated,
    Removed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct AutomationFileChangeView {
    pub path: String,
    pub kind: AutomationFileChangeKindView,
    pub current_content: Option<String>,
    pub expected_content: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct AutomationProjectionPreview {
    /// 归一化后的变更请求；应用时必须原样回传。
    pub change: AutomationChangeRequest,
    /// 覆盖期望投影与完整差异的确认摘要；应用时必须回传，任何一方变化都会失效。
    pub confirmation_digest: String,
    pub changes: Vec<AutomationFileChangeView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct AutomationBindingView {
    pub binding: AutomationBinding,
    pub configuration_name: Option<String>,
    pub blocked_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct AutomationBindingsView {
    pub bindings: Vec<AutomationBindingView>,
    pub drift: Vec<AutomationFileChangeView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct AutomationApplyResult {
    /// None 表示预览与仓库已一致，本次没有产生接入提交。
    pub commit_sha: Option<String>,
    pub pushed_branch: Option<String>,
    pub bindings: Vec<AutomationBinding>,
}

#[derive(Debug)]
pub(crate) struct ExpectedProjection {
    pub files: BTreeMap<String, AutomationBundleFile>,
    pub bundles: Vec<AppliedProjectionBundle>,
}

#[derive(Debug)]
pub(crate) struct AutomationPreviewOutcome {
    pub normalized_change: AutomationChangeRequest,
    pub targets: Vec<AutomationBinding>,
    pub expected: ExpectedProjection,
    pub changes: Vec<AutomationBundleFileChange>,
    /// 同时覆盖期望投影与呈现给使用者的差异；仓库或配置任何一方变化都会使其失效。
    pub confirmation_digest: String,
}

/// T04 过渡实现：配置修订尚未携带 Adapter 选择，Install 暂以显式参数指定后端；
/// 配置迁入通用 Adapter 选择后，此处必须改为从固定修订解析（ADR-0032）。
/// 发布命名空间冲突检测（ADR-0034）同样待触发策略映射到 Release Identity 后实现。
fn automation_backend(backend_id: &str) -> Result<Arc<dyn ExecutionBackend>, AppError> {
    match backend_id {
        FAKE_AUTOMATION_BACKEND_ID => Ok(Arc::new(FakeAutomationBackend::new())),
        other => Err(AppError::validation_with_code(
            format!("执行后端 {other} 不支持自动化投影"),
            "automation_backend_unsupported",
        )),
    }
}

fn automation_runtime_revision(backend: &dyn ExecutionBackend) -> String {
    let identity = backend.descriptor().identity();
    format!(
        "plan-v{PUBLISH_PLAN_VERSION}.adapter-v{ADAPTER_CONTRACT_VERSION}.{}@{}",
        identity.id, identity.version
    )
}

fn domain_trigger(policy: &AutomationTriggerPolicy) -> DomainTriggerPolicy {
    match policy {
        AutomationTriggerPolicy::TagPush { tag_prefix } => DomainTriggerPolicy::TagPush {
            tag_prefix: tag_prefix.clone(),
        },
        AutomationTriggerPolicy::Manual => DomainTriggerPolicy::Manual,
    }
}

fn active_profile<'a>(
    config: &'a RepoPublishConfig,
    configuration_id: &str,
) -> Result<&'a crate::store::ConfigProfile, AppError> {
    config
        .profile(configuration_id)
        .filter(|profile| profile.deleted_at.is_none())
        .ok_or_else(|| {
            AppError::validation_with_code(
                format!("未找到配置文件: {configuration_id}"),
                "profile_not_found",
            )
        })
}

fn ensure_unblocked(profile: &crate::store::ConfigProfile) -> Result<(), AppError> {
    if let Some(reason) = &profile.blocked_reason {
        return Err(AppError::validation_with_code(
            format!("配置处于阻断状态，无法绑定自动化: {reason}"),
            "automation_bind_blocked_configuration",
        ));
    }
    Ok(())
}

fn resolve_target_bindings(
    config: &RepoPublishConfig,
    change: &AutomationChangeRequest,
    now: &str,
) -> Result<Vec<AutomationBinding>, AppError> {
    let mut bindings = config.bindings.clone();
    match change {
        AutomationChangeRequest::Install {
            configuration_id,
            execution_backend_id,
            trigger_policy,
            binding_id,
        } => {
            let profile = active_profile(config, configuration_id)?;
            ensure_unblocked(profile)?;
            let backend = automation_backend(execution_backend_id)?;
            let binding_id = binding_id.clone().ok_or_else(|| {
                AppError::validation_with_code(
                    "安装请求缺少预览归一化的绑定身份，请先预览投影差异",
                    "automation_install_identity_missing",
                )
            })?;
            bindings.push(AutomationBinding {
                id: binding_id,
                configuration_id: profile.id.clone(),
                configuration_revision_id: profile.current_revision_id.clone(),
                execution_backend_id: execution_backend_id.clone(),
                trigger_policy: trigger_policy.clone(),
                runtime_revision: automation_runtime_revision(backend.as_ref()),
                external_identity: String::new(),
                created_at: now.to_string(),
                updated_at: now.to_string(),
            });
        }
        AutomationChangeRequest::UpgradeRevision { binding_id } => {
            let binding = bindings
                .iter_mut()
                .find(|binding| binding.id == *binding_id)
                .ok_or_else(|| binding_not_found(binding_id))?;
            let profile = active_profile(config, &binding.configuration_id)?;
            ensure_unblocked(profile)?;
            let backend = automation_backend(&binding.execution_backend_id)?;
            binding.configuration_revision_id = profile.current_revision_id.clone();
            binding.runtime_revision = automation_runtime_revision(backend.as_ref());
            binding.updated_at = now.to_string();
        }
        AutomationChangeRequest::Reconcile => {}
        AutomationChangeRequest::Detach { binding_id } => {
            let before = bindings.len();
            bindings.retain(|binding| binding.id != *binding_id);
            if bindings.len() == before {
                return Err(binding_not_found(binding_id));
            }
        }
    }
    Ok(bindings)
}

fn binding_not_found(binding_id: &str) -> AppError {
    AppError::validation_with_code(
        format!("未找到自动化绑定: {binding_id}"),
        "automation_binding_not_found",
    )
}

/// 投影固定引用绑定所钉住的修订，而不是配置的当前修订。
fn binding_projection(
    config: &RepoPublishConfig,
    binding: &AutomationBinding,
) -> Result<AutomationBindingProjection, AppError> {
    let profile = config.profile(&binding.configuration_id).ok_or_else(|| {
        AppError::validation_with_code(
            format!("未找到配置文件: {}", binding.configuration_id),
            "profile_not_found",
        )
    })?;
    let revision = profile
        .revisions
        .iter()
        .find(|revision| revision.id == binding.configuration_revision_id)
        .ok_or_else(|| {
            AppError::validation_with_code(
                format!(
                    "绑定引用的配置修订不存在: {}",
                    binding.configuration_revision_id
                ),
                "automation_bound_revision_missing",
            )
        })?;

    Ok(AutomationBindingProjection {
        binding_id: binding.id.clone(),
        configuration_id: binding.configuration_id.clone(),
        configuration_revision_id: binding.configuration_revision_id.clone(),
        trigger_policy: domain_trigger(&binding.trigger_policy),
        runtime_revision: binding.runtime_revision.clone(),
        projection: AutomationProjection {
            public_settings: BTreeMap::from([
                (
                    "providerId".to_string(),
                    Value::String(revision.provider_id.clone()),
                ),
                (
                    "settingsVersion".to_string(),
                    Value::from(revision.settings_version),
                ),
                ("parameters".to_string(), revision.parameters.clone()),
            ]),
            protected_variables: BTreeMap::new(),
            secret_references: BTreeMap::new(),
        },
    })
}

fn render_error(error: PublishError) -> AppError {
    AppError::publish_with_code(
        format!("自动化投影渲染失败: {error}"),
        "automation_projection_render_failed",
    )
}

fn render_expected(
    config: &RepoPublishConfig,
    targets: &[AutomationBinding],
    now: &str,
) -> Result<ExpectedProjection, AppError> {
    let mut by_backend: BTreeMap<&str, Vec<&AutomationBinding>> = BTreeMap::new();
    for binding in targets {
        by_backend
            .entry(binding.execution_backend_id.as_str())
            .or_default()
            .push(binding);
    }

    let mut files = BTreeMap::new();
    let mut bundles = Vec::new();
    for (backend_id, group) in by_backend {
        let backend = automation_backend(backend_id)?;
        let projections = group
            .iter()
            .map(|binding| binding_projection(config, binding))
            .collect::<Result<Vec<_>, _>>()?;
        let bundle = backend
            .render_automation_bundle(&projections)
            .map_err(render_error)?;
        bundle.validate().map_err(render_error)?;

        let digest = bundle.digest.clone();
        let mut owned_paths = Vec::new();
        for (path, file) in bundle.files {
            if files.contains_key(&path) {
                return Err(AppError::validation_with_code(
                    format!("多个执行后端的投影包争用同一文件: {path}"),
                    "automation_bundle_path_conflict",
                ));
            }
            owned_paths.push(path.clone());
            files.insert(path, file);
        }
        bundles.push(AppliedProjectionBundle {
            backend_id: backend_id.to_string(),
            digest,
            files: owned_paths,
            applied_at: now.to_string(),
        });
    }

    Ok(ExpectedProjection { files, bundles })
}

fn previously_owned_paths(config: &RepoPublishConfig) -> Result<BTreeSet<String>, AppError> {
    let mut paths = BTreeSet::new();
    for bundle in &config.applied_bundles {
        for path in &bundle.files {
            if !is_safe_portable_relative_path(path) {
                return Err(AppError::store_with_code(
                    format!("本地状态记录了不可移植的投影路径: {path}"),
                    "automation_owned_path_invalid",
                ));
            }
            paths.insert(path.clone());
        }
    }
    Ok(paths)
}

fn read_repository_files(
    repo_root: &Path,
    paths: &BTreeSet<String>,
) -> Result<BTreeMap<String, String>, AppError> {
    let mut files = BTreeMap::new();
    for relative in paths {
        let absolute = repo_root.join(relative);
        if !absolute.is_file() {
            continue;
        }
        let content = std::fs::read_to_string(&absolute).map_err(|error| {
            AppError::repository_with_code(
                format!("无法读取自动化投影文件 {relative}: {error}"),
                "automation_repository_file_unreadable",
            )
        })?;
        files.insert(relative.clone(), content);
    }
    Ok(files)
}

pub(crate) fn preview_change(
    repo_root: &Path,
    config: &RepoPublishConfig,
    change: &AutomationChangeRequest,
    now: &str,
) -> Result<AutomationPreviewOutcome, AppError> {
    let normalized_change = change.normalized();
    let targets = resolve_target_bindings(config, &normalized_change, now)?;
    let expected = render_expected(config, &targets, now)?;
    let previously_owned = previously_owned_paths(config)?;
    let candidates = expected
        .files
        .keys()
        .cloned()
        .chain(previously_owned.iter().cloned())
        .collect::<BTreeSet<_>>();
    let actual = read_repository_files(repo_root, &candidates)?;
    let changes = diff_automation_files(&expected.files, &actual, &previously_owned);
    let confirmation_digest =
        canonical_digest(&(&expected.files, &changes)).map_err(render_error)?;
    Ok(AutomationPreviewOutcome {
        normalized_change,
        targets,
        expected,
        changes,
        confirmation_digest,
    })
}

fn assign_external_identities(
    targets: &mut [AutomationBinding],
    files: &BTreeMap<String, AutomationBundleFile>,
) -> Result<(), AppError> {
    for binding in targets {
        let owned = files
            .iter()
            .find(|(_, file)| file.binding_id.as_deref() == Some(binding.id.as_str()));
        let Some((path, _)) = owned else {
            return Err(AppError::publish_with_code(
                format!("执行后端未为绑定 {} 生成任何拥有的资源", binding.id),
                "automation_binding_without_owned_resource",
            ));
        };
        binding.external_identity = path.clone();
    }
    Ok(())
}

pub(crate) fn apply_change(
    repo_root: &Path,
    config: &mut RepoPublishConfig,
    change: &AutomationChangeRequest,
    confirmed_digest: &str,
    now: &str,
) -> Result<AutomationApplyResult, AppError> {
    let outcome = preview_change(repo_root, config, change, now)?;
    if outcome.confirmation_digest != confirmed_digest {
        return Err(AppError::validation_with_code(
            "投影差异与预览时不一致，请重新预览并确认",
            "automation_preview_stale",
        ));
    }

    let mut targets = outcome.targets;
    assign_external_identities(&mut targets, &outcome.expected.files)?;

    if outcome.changes.is_empty() {
        // 仓库已与期望投影一致：不产生接入提交，但绑定与归属边界仍要落到本地状态。
        config.bindings = targets;
        config.applied_bundles = outcome.expected.bundles;
        return Ok(AutomationApplyResult {
            commit_sha: None,
            pushed_branch: None,
            bindings: config.bindings.clone(),
        });
    }

    ensure_clean(repo_root)?;
    let branch = current_branch(repo_root)?;
    let expected_branch = default_branch(repo_root)?;
    if branch != expected_branch {
        return Err(AppError::repository_with_code(
            format!(
                "自动化接入必须在 origin 默认分支 '{expected_branch}' 上执行，当前分支是 '{branch}'"
            ),
            "automation_default_branch_required",
        ));
    }
    ensure_synced_default_branch(repo_root, &expected_branch)?;

    let mut touched = Vec::new();
    for file_change in &outcome.changes {
        let absolute = repo_root.join(&file_change.path);
        match file_change.kind {
            AutomationFileChangeKind::Added | AutomationFileChangeKind::Updated => {
                if let Some(parent) = absolute.parent() {
                    std::fs::create_dir_all(parent).map_err(|error| {
                        AppError::repository_with_code(
                            format!("无法创建目录 {}: {error}", parent.display()),
                            "automation_projection_write_failed",
                        )
                    })?;
                }
                let expected_content = file_change.expected_content.as_deref().unwrap_or_default();
                std::fs::write(&absolute, expected_content).map_err(|error| {
                    AppError::repository_with_code(
                        format!("无法写入 {}: {error}", absolute.display()),
                        "automation_projection_write_failed",
                    )
                })?;
            }
            AutomationFileChangeKind::Removed => {
                if absolute.is_file() {
                    std::fs::remove_file(&absolute).map_err(|error| {
                        AppError::repository_with_code(
                            format!("无法移除 {}: {error}", absolute.display()),
                            "automation_projection_remove_failed",
                        )
                    })?;
                }
            }
        }
        touched.push(file_change.path.clone());
    }

    let mut add_args = vec!["add", "--"];
    add_args.extend(touched.iter().map(String::as_str));
    successful_git(repo_root, &add_args)?;
    successful_git(
        repo_root,
        &[
            "commit",
            "-m",
            "chore(release): apply One Publish automation projection",
        ],
    )?;
    let commit_sha = successful_git(repo_root, &["rev-parse", "HEAD"])?;
    successful_git(
        repo_root,
        &["push", "origin", &format!("HEAD:{expected_branch}")],
    )?;

    config.bindings = targets;
    config.applied_bundles = outcome.expected.bundles;
    Ok(AutomationApplyResult {
        commit_sha: Some(commit_sha),
        pushed_branch: Some(expected_branch),
        bindings: config.bindings.clone(),
    })
}

pub(crate) fn bindings_view(
    repo_root: &Path,
    config: &RepoPublishConfig,
    now: &str,
) -> Result<AutomationBindingsView, AppError> {
    let outcome = preview_change(repo_root, config, &AutomationChangeRequest::Reconcile, now)?;
    let drift = outcome.changes.iter().map(change_view).collect::<Vec<_>>();

    // 漂移按资源归属定位到具体绑定；共享资源（如 Bundle 清单）或失去归属的
    // 文件漂移会影响整个投影包，此时所有绑定都进入阻断状态。
    let mut drifted_bindings = BTreeSet::new();
    let mut shared_drift = false;
    for change in &outcome.changes {
        match outcome
            .expected
            .files
            .get(&change.path)
            .and_then(|file| file.binding_id.as_deref())
        {
            Some(binding_id) => {
                drifted_bindings.insert(binding_id.to_string());
            }
            None => shared_drift = true,
        }
    }

    let bindings = config
        .bindings
        .iter()
        .map(|binding| {
            let blocked = shared_drift || drifted_bindings.contains(&binding.id);
            AutomationBindingView {
                binding: binding.clone(),
                configuration_name: config
                    .profile(&binding.configuration_id)
                    .map(|profile| profile.name.clone()),
                blocked_reason: blocked.then(|| AUTOMATION_DRIFT_BLOCKED_REASON.to_string()),
            }
        })
        .collect();

    Ok(AutomationBindingsView { bindings, drift })
}

fn change_view(change: &AutomationBundleFileChange) -> AutomationFileChangeView {
    AutomationFileChangeView {
        path: change.path.clone(),
        kind: match change.kind {
            AutomationFileChangeKind::Added => AutomationFileChangeKindView::Added,
            AutomationFileChangeKind::Updated => AutomationFileChangeKindView::Updated,
            AutomationFileChangeKind::Removed => AutomationFileChangeKindView::Removed,
        },
        current_content: change.current_content.clone(),
        expected_content: change.expected_content.clone(),
    }
}

fn git(repository_root: &Path, args: &[&str]) -> Result<Output, AppError> {
    crate::process_utils::new_std_command("git")
        .arg("-C")
        .arg(repository_root)
        .args(args)
        .output()
        .map_err(|error| {
            AppError::external_command_with_code(
                format!("failed to run git {}: {error}", args.join(" ")),
                "automation_git_failed",
            )
        })
}

fn successful_git(repository_root: &Path, args: &[&str]) -> Result<String, AppError> {
    let output = git(repository_root, args)?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(AppError::external_command_with_code(
        if stderr.is_empty() {
            format!("git {} failed with {}", args.join(" "), output.status)
        } else {
            stderr
        },
        "automation_git_failed",
    ))
}

fn ensure_clean(repository_root: &Path) -> Result<(), AppError> {
    let status = successful_git(repository_root, &["status", "--porcelain=v1"])?;
    if status.is_empty() {
        return Ok(());
    }
    Err(AppError::repository_with_code(
        format!("自动化接入需要干净的工作区:\n{status}"),
        "automation_worktree_dirty",
    ))
}

fn current_branch(repository_root: &Path) -> Result<String, AppError> {
    successful_git(repository_root, &["branch", "--show-current"]).and_then(|branch| {
        if branch.is_empty() {
            Err(AppError::repository_with_code(
                "自动化接入不能在 detached HEAD 上执行",
                "automation_detached_head",
            ))
        } else {
            Ok(branch)
        }
    })
}

fn default_branch(repository_root: &Path) -> Result<String, AppError> {
    let symbolic = git(
        repository_root,
        &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    )?;
    if symbolic.status.success() {
        let value = String::from_utf8_lossy(&symbolic.stdout).trim().to_string();
        if let Some(branch) = value.strip_prefix("origin/") {
            if !branch.is_empty() {
                return Ok(branch.to_string());
            }
        }
    }

    let remote = successful_git(repository_root, &["remote", "show", "origin"])?;
    remote
        .lines()
        .find_map(|line| line.trim().strip_prefix("HEAD branch:").map(str::trim))
        .filter(|branch| !branch.is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            AppError::repository_with_code(
                "无法确定 origin 默认分支",
                "automation_default_branch_unknown",
            )
        })
}

fn ensure_synced_default_branch(
    repository_root: &Path,
    default_branch: &str,
) -> Result<(), AppError> {
    successful_git(repository_root, &["fetch", "origin", default_branch])?;
    let counts = successful_git(
        repository_root,
        &[
            "rev-list",
            "--left-right",
            "--count",
            &format!("HEAD...origin/{default_branch}"),
        ],
    )?;
    if counts.split_whitespace().eq(["0", "0"]) {
        return Ok(());
    }
    Err(AppError::repository_with_code(
        format!("默认分支与 origin/{default_branch} 不同步: {counts}"),
        "automation_branch_not_synced",
    ))
}

fn repository_root_from_path(path: &str) -> Result<&Path, AppError> {
    let root = Path::new(path.trim());
    if path.trim().is_empty() || !root.is_dir() {
        return Err(AppError::repository_with_code(
            format!("仓库路径不可用: {path}"),
            "automation_repository_unavailable",
        ));
    }
    Ok(root)
}

#[tauri::command]
pub async fn list_automation_bindings(repo_id: String) -> Result<AutomationBindingsView, AppError> {
    let _timer =
        crate::commands::middleware::CommandTimer::new("automation::list_automation_bindings");
    let state = crate::store::get_state();
    let repo = crate::store::find_repository(&state.repositories, &repo_id)?;
    let now = chrono::Utc::now().to_rfc3339();
    bindings_view(
        repository_root_from_path(&repo.path)?,
        &repo.publish_config,
        &now,
    )
}

#[tauri::command]
pub async fn preview_automation_change(
    repo_id: String,
    change: AutomationChangeRequest,
) -> Result<AutomationProjectionPreview, AppError> {
    let _timer =
        crate::commands::middleware::CommandTimer::new("automation::preview_automation_change");
    let state = crate::store::get_state();
    let repo = crate::store::find_repository(&state.repositories, &repo_id)?;
    let now = chrono::Utc::now().to_rfc3339();
    let outcome = preview_change(
        repository_root_from_path(&repo.path)?,
        &repo.publish_config,
        &change,
        &now,
    )?;
    Ok(AutomationProjectionPreview {
        change: outcome.normalized_change,
        confirmation_digest: outcome.confirmation_digest,
        changes: outcome.changes.iter().map(change_view).collect(),
    })
}

#[tauri::command]
pub async fn apply_automation_change(
    app: tauri::AppHandle,
    repo_id: String,
    change: AutomationChangeRequest,
    confirmed_digest: String,
) -> Result<AutomationApplyResult, AppError> {
    let _timer =
        crate::commands::middleware::CommandTimer::new("automation::apply_automation_change");
    let mut state = crate::store::get_state();
    let repo = crate::store::find_repository_mut(&mut state.repositories, &repo_id)?;
    let repo_path = repo.path.clone();
    let now = chrono::Utc::now().to_rfc3339();
    let result = apply_change(
        repository_root_from_path(&repo_path)?,
        &mut repo.publish_config,
        &change,
        &confirmed_digest,
        &now,
    )?;
    crate::store::persist_state_and_refresh_tray(&app, state).await?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::process::Command;

    const NOW: &str = "2026-07-22T10:00:00Z";

    fn run_git(dir: &Path, args: &[&str]) -> String {
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
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn commit_all(work: &Path, message: &str) {
        run_git(work, &["add", "--all"]);
        run_git(
            work,
            &[
                "-c",
                "user.name=One Publish Tests",
                "-c",
                "user.email=tests@one-publish.invalid",
                "commit",
                "--quiet",
                "-m",
                message,
            ],
        );
    }

    fn fixture_repository() -> (tempfile::TempDir, PathBuf) {
        let temp = tempfile::tempdir().expect("temp dir");
        let origin = temp.path().join("origin.git");
        let work = temp.path().join("work");
        std::fs::create_dir_all(&work).expect("create worktree");
        run_git(
            temp.path(),
            &["init", "--bare", "--quiet", "-b", "main", "origin.git"],
        );
        run_git(&work, &["init", "--quiet", "-b", "main"]);
        std::fs::write(work.join("README.md"), "fixture\n").expect("write readme");
        commit_all(&work, "fixture");
        run_git(
            &work,
            &[
                "remote",
                "add",
                "origin",
                origin.to_str().expect("origin path"),
            ],
        );
        run_git(&work, &["push", "--quiet", "-u", "origin", "main"]);
        run_git(&work, &["remote", "set-head", "origin", "main"]);
        (temp, work)
    }

    fn fixture_config(name: &str) -> (RepoPublishConfig, String) {
        let mut config = RepoPublishConfig::default();
        let profile = config
            .create_profile(
                name.to_string(),
                "dotnet".to_string(),
                serde_json::json!({ "configuration": "Release" }),
                None,
                "2026-07-21T10:00:00Z".to_string(),
            )
            .expect("create fixture profile")
            .clone();
        (config, profile.id)
    }

    fn install_request(profile_id: &str) -> AutomationChangeRequest {
        AutomationChangeRequest::Install {
            configuration_id: profile_id.to_string(),
            execution_backend_id: FAKE_AUTOMATION_BACKEND_ID.to_string(),
            trigger_policy: AutomationTriggerPolicy::TagPush {
                tag_prefix: "v".to_string(),
            },
            binding_id: None,
        }
    }

    fn preview_then_apply(
        work: &Path,
        config: &mut RepoPublishConfig,
        change: &AutomationChangeRequest,
    ) -> AutomationApplyResult {
        let preview = preview_change(work, config, change, NOW).expect("preview change");
        apply_change(
            work,
            config,
            &preview.normalized_change,
            &preview.confirmation_digest,
            NOW,
        )
        .expect("apply change")
    }

    #[test]
    fn install_previews_the_full_bundle_without_touching_repository_or_state() {
        let (_temp, work) = fixture_repository();
        let (config, profile_id) = fixture_config("Stable");

        let outcome = preview_change(&work, &config, &install_request(&profile_id), NOW)
            .expect("preview install");

        let described = outcome
            .changes
            .iter()
            .map(|change| (change.path.as_str(), change.kind))
            .collect::<Vec<_>>();
        assert_eq!(described.len(), 2);
        assert!(described
            .iter()
            .all(|(_, kind)| *kind == AutomationFileChangeKind::Added));
        assert!(described
            .iter()
            .any(|(path, _)| *path == "one-publish/automation/bundle.json"));
        assert!(!work.join("one-publish").exists());
        assert!(config.bindings.is_empty());
        assert!(config.applied_bundles.is_empty());
        assert_eq!(outcome.targets.len(), 1);
    }

    #[test]
    fn apply_rejects_a_stale_confirmation_digest() {
        let (_temp, work) = fixture_repository();
        let (mut config, profile_id) = fixture_config("Stable");

        let error = apply_change(
            &work,
            &mut config,
            &install_request(&profile_id),
            "stale-digest",
            NOW,
        )
        .expect_err("stale digest must be rejected");

        assert_eq!(error.code.as_deref(), Some("automation_preview_stale"));
        assert!(!work.join("one-publish").exists());
        assert!(config.bindings.is_empty());
    }

    #[test]
    fn install_applies_the_previewed_bundle_with_an_onboarding_commit() {
        let (temp, work) = fixture_repository();
        let (mut config, profile_id) = fixture_config("Stable");

        let result = preview_then_apply(&work, &mut config, &install_request(&profile_id));

        let commit_sha = result.commit_sha.expect("onboarding commit");
        assert_eq!(result.pushed_branch.as_deref(), Some("main"));
        assert_eq!(run_git(&work, &["rev-parse", "HEAD"]), commit_sha);
        assert_eq!(
            run_git(&temp.path().join("origin.git"), &["rev-parse", "main"]),
            commit_sha
        );
        assert_eq!(run_git(&work, &["status", "--porcelain=v1"]), "");

        assert_eq!(config.bindings.len(), 1);
        let binding = &config.bindings[0];
        let profile = config.profile(&profile_id).expect("profile");
        assert_eq!(binding.configuration_id, profile_id);
        assert_eq!(
            binding.configuration_revision_id,
            profile.current_revision_id
        );
        assert_eq!(binding.execution_backend_id, FAKE_AUTOMATION_BACKEND_ID);
        assert_eq!(
            binding.external_identity,
            format!("one-publish/automation/{}.json", binding.id)
        );
        assert!(work.join(&binding.external_identity).is_file());
        assert!(work.join("one-publish/automation/bundle.json").is_file());

        assert_eq!(config.applied_bundles.len(), 1);
        let bundle = &config.applied_bundles[0];
        assert_eq!(bundle.backend_id, FAKE_AUTOMATION_BACKEND_ID);
        assert_eq!(bundle.files.len(), 2);
        assert_eq!(bundle.digest.len(), 64);

        let view = bindings_view(&work, &config, NOW).expect("bindings view");
        assert!(view.drift.is_empty());
        assert_eq!(view.bindings[0].blocked_reason, None);
        assert_eq!(
            view.bindings[0].configuration_name.as_deref(),
            Some("Stable")
        );
    }

    #[test]
    fn bindings_keep_their_revision_until_an_explicit_upgrade_is_applied() {
        let (_temp, work) = fixture_repository();
        let (mut config, profile_id) = fixture_config("Stable");
        preview_then_apply(&work, &mut config, &install_request(&profile_id));
        let pinned_revision = config.bindings[0].configuration_revision_id.clone();

        config
            .update_profile(
                &profile_id,
                "Stable".to_string(),
                "dotnet".to_string(),
                serde_json::json!({ "configuration": "Debug" }),
                None,
                "2026-07-22T11:00:00Z".to_string(),
            )
            .expect("save new revision");
        let new_revision = config
            .profile(&profile_id)
            .expect("profile")
            .current_revision_id
            .clone();
        assert_ne!(pinned_revision, new_revision);

        // 本地新修订不改变已安装自动化：绑定仍钉住旧修订，也不产生漂移。
        assert_eq!(
            config.bindings[0].configuration_revision_id,
            pinned_revision
        );
        let view = bindings_view(&work, &config, NOW).expect("bindings view");
        assert!(view.drift.is_empty());
        assert_eq!(view.bindings[0].blocked_reason, None);

        let binding_id = config.bindings[0].id.clone();
        let upgrade = AutomationChangeRequest::UpgradeRevision {
            binding_id: binding_id.clone(),
        };
        let outcome = preview_change(&work, &config, &upgrade, NOW).expect("preview upgrade");
        let described = outcome
            .changes
            .iter()
            .map(|change| (change.path.as_str(), change.kind))
            .collect::<Vec<_>>();
        assert_eq!(
            described,
            vec![(
                format!("one-publish/automation/{binding_id}.json").as_str(),
                AutomationFileChangeKind::Updated
            )]
        );

        preview_then_apply(&work, &mut config, &upgrade);
        assert_eq!(config.bindings[0].configuration_revision_id, new_revision);
        assert!(bindings_view(&work, &config, NOW)
            .expect("view after upgrade")
            .drift
            .is_empty());
    }

    #[test]
    fn repository_edits_surface_as_drift_and_reconcile_restores_the_bundle() {
        let (_temp, work) = fixture_repository();
        let (mut config, profile_id) = fixture_config("Stable");
        let nightly = config
            .create_profile(
                "Nightly".to_string(),
                "dotnet".to_string(),
                serde_json::json!({ "configuration": "Debug" }),
                None,
                "2026-07-21T10:05:00Z".to_string(),
            )
            .expect("create nightly profile")
            .clone();
        preview_then_apply(&work, &mut config, &install_request(&profile_id));
        preview_then_apply(&work, &mut config, &install_request(&nightly.id));
        let stable_binding = config.bindings[0].clone();
        let nightly_binding = config.bindings[1].clone();
        let binding_path = stable_binding.external_identity.clone();

        std::fs::write(work.join(&binding_path), "tampered by hand\n").expect("tamper projection");
        commit_all(&work, "tamper managed projection");
        run_git(&work, &["push", "--quiet", "origin", "main"]);

        // 漂移按资源归属定位：只有被篡改文件的拥有者进入阻断状态。
        let view = bindings_view(&work, &config, NOW).expect("bindings view");
        assert_eq!(view.drift.len(), 1);
        assert_eq!(view.drift[0].path, binding_path);
        assert_eq!(view.drift[0].kind, AutomationFileChangeKindView::Updated);
        let blocked_by_id = |view: &AutomationBindingsView, id: &str| {
            view.bindings
                .iter()
                .find(|item| item.binding.id == id)
                .expect("binding view")
                .blocked_reason
                .clone()
        };
        assert_eq!(
            blocked_by_id(&view, &stable_binding.id).as_deref(),
            Some(AUTOMATION_DRIFT_BLOCKED_REASON)
        );
        assert_eq!(blocked_by_id(&view, &nightly_binding.id), None);

        // 共享的 Bundle 清单漂移会阻断整个投影包内的所有绑定。
        std::fs::write(
            work.join("one-publish/automation/bundle.json"),
            "tampered manifest\n",
        )
        .expect("tamper manifest");
        commit_all(&work, "tamper bundle manifest");
        run_git(&work, &["push", "--quiet", "origin", "main"]);
        let view = bindings_view(&work, &config, NOW).expect("view with shared drift");
        assert!(view
            .bindings
            .iter()
            .all(|item| item.blocked_reason.is_some()));

        let outcome = preview_change(&work, &config, &AutomationChangeRequest::Reconcile, NOW)
            .expect("preview reconcile");
        assert_eq!(outcome.changes.len(), 2);
        preview_then_apply(&work, &mut config, &AutomationChangeRequest::Reconcile);

        let view = bindings_view(&work, &config, NOW).expect("view after reconcile");
        assert!(view.drift.is_empty());
        assert!(view
            .bindings
            .iter()
            .all(|item| item.blocked_reason.is_none()));

        // 无漂移时再次协调是无副作用的应用：不产生接入提交，本地状态保持一致。
        let bundles_before = config.applied_bundles.clone();
        let noop = preview_then_apply(&work, &mut config, &AutomationChangeRequest::Reconcile);
        assert_eq!(noop.commit_sha, None);
        assert_eq!(noop.pushed_branch, None);
        assert_eq!(config.applied_bundles, bundles_before);
        assert_eq!(config.bindings.len(), 2);
    }

    #[test]
    fn detach_removes_only_bundle_owned_files_and_keeps_local_state() {
        let (_temp, work) = fixture_repository();
        let (mut config, stable_id) = fixture_config("Stable");
        let nightly = config
            .create_profile(
                "Nightly".to_string(),
                "dotnet".to_string(),
                serde_json::json!({ "configuration": "Debug" }),
                None,
                "2026-07-21T10:05:00Z".to_string(),
            )
            .expect("create nightly profile")
            .clone();
        let unmanaged = work.join(".github/workflows/quality.yml");
        std::fs::create_dir_all(unmanaged.parent().expect("workflows dir"))
            .expect("create workflows dir");
        std::fs::write(&unmanaged, "name: quality\n").expect("write unmanaged workflow");
        commit_all(&work, "add unmanaged workflow");
        run_git(&work, &["push", "--quiet", "origin", "main"]);

        preview_then_apply(&work, &mut config, &install_request(&stable_id));
        preview_then_apply(&work, &mut config, &install_request(&nightly.id));
        assert_eq!(config.bindings.len(), 2);
        let stable_binding = config.bindings[0].clone();
        let nightly_binding = config.bindings[1].clone();
        let history_len = config.profiles.len();

        let detach_stable = AutomationChangeRequest::Detach {
            binding_id: stable_binding.id.clone(),
        };
        let outcome = preview_change(&work, &config, &detach_stable, NOW).expect("preview detach");
        let described = outcome
            .changes
            .iter()
            .map(|change| (change.path.clone(), change.kind))
            .collect::<Vec<_>>();
        assert!(described.contains(&(
            stable_binding.external_identity.clone(),
            AutomationFileChangeKind::Removed
        )));
        preview_then_apply(&work, &mut config, &detach_stable);

        assert!(!work.join(&stable_binding.external_identity).exists());
        assert!(work.join(&nightly_binding.external_identity).is_file());
        assert!(work.join("one-publish/automation/bundle.json").is_file());
        assert!(unmanaged.is_file());
        assert_eq!(config.bindings.len(), 1);
        // 配置及其全部修订保持可解析；历史 Attempt 与 Receipt 存放在执行历史与
        // 运行时状态中，引擎签名只接触 RepoPublishConfig，结构上无法删除它们。
        assert_eq!(config.profiles.len(), history_len);
        assert!(config.profile(&stable_id).is_some());
        assert!(!config
            .profile(&stable_id)
            .expect("detached profile")
            .revisions
            .is_empty());

        let detach_nightly = AutomationChangeRequest::Detach {
            binding_id: nightly_binding.id.clone(),
        };
        preview_then_apply(&work, &mut config, &detach_nightly);

        assert!(!work.join("one-publish/automation/bundle.json").exists());
        assert!(!work.join(&nightly_binding.external_identity).exists());
        assert!(unmanaged.is_file());
        assert!(config.bindings.is_empty());
        assert!(config.applied_bundles.is_empty());
        assert_eq!(config.profiles.len(), history_len);
        assert_eq!(run_git(&work, &["status", "--porcelain=v1"]), "");
    }

    #[test]
    fn apply_requires_a_clean_worktree_on_the_synced_default_branch() {
        let (_temp, work) = fixture_repository();
        let (mut config, profile_id) = fixture_config("Stable");
        let change = install_request(&profile_id);
        let preview = preview_change(&work, &config, &change, NOW).expect("preview");
        let confirmed = preview.normalized_change.clone();

        std::fs::write(work.join("README.md"), "dirty\n").expect("dirty worktree");
        let dirty = apply_change(
            &work,
            &mut config,
            &confirmed,
            &preview.confirmation_digest,
            NOW,
        )
        .expect_err("dirty worktree must block onboarding");
        assert_eq!(dirty.code.as_deref(), Some("automation_worktree_dirty"));
        commit_all(&work, "make worktree clean again");
        run_git(&work, &["push", "--quiet", "origin", "main"]);

        run_git(&work, &["checkout", "--quiet", "-b", "feature"]);
        let wrong_branch = apply_change(
            &work,
            &mut config,
            &confirmed,
            &preview.confirmation_digest,
            NOW,
        )
        .expect_err("feature branch must block onboarding");
        assert_eq!(
            wrong_branch.code.as_deref(),
            Some("automation_default_branch_required")
        );
        assert!(config.bindings.is_empty());
    }

    #[test]
    fn unknown_backends_profiles_and_bindings_fail_with_explicit_errors() {
        let (_temp, work) = fixture_repository();
        let (config, profile_id) = fixture_config("Stable");

        let unsupported = preview_change(
            &work,
            &config,
            &AutomationChangeRequest::Install {
                configuration_id: profile_id,
                execution_backend_id: "local-execution".to_string(),
                trigger_policy: AutomationTriggerPolicy::Manual,
                binding_id: None,
            },
            NOW,
        )
        .expect_err("non-automation backend must be rejected");
        assert_eq!(
            unsupported.code.as_deref(),
            Some("automation_backend_unsupported")
        );

        let missing_profile = preview_change(
            &work,
            &config,
            &AutomationChangeRequest::Install {
                configuration_id: "missing".to_string(),
                execution_backend_id: FAKE_AUTOMATION_BACKEND_ID.to_string(),
                trigger_policy: AutomationTriggerPolicy::Manual,
                binding_id: None,
            },
            NOW,
        )
        .expect_err("missing profile must be rejected");
        assert_eq!(missing_profile.code.as_deref(), Some("profile_not_found"));

        let missing_binding = preview_change(
            &work,
            &config,
            &AutomationChangeRequest::Detach {
                binding_id: "missing".to_string(),
            },
            NOW,
        )
        .expect_err("missing binding must be rejected");
        assert_eq!(
            missing_binding.code.as_deref(),
            Some("automation_binding_not_found")
        );
    }
}
