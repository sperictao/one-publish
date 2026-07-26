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
    canonical_digest, diff_automation_files, is_safe_portable_relative_path, AdapterIdentity,
    AdapterKind, AutomationBindingProjection, AutomationBundleFile, AutomationBundleFileChange,
    AutomationFileChangeKind, AutomationProjection, AutomationRuntimeRevision,
    AutomationTriggerPolicy as DomainTriggerPolicy, PublishError,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use crate::errors::AppError;
use crate::github_actions_backend::{GitHubActionsAutomationBackend, GITHUB_ACTIONS_BACKEND_ID};
use crate::store::{
    new_configuration_identity, AppliedProjectionBundle, AutomationBinding,
    AutomationTriggerPolicy, RepoPublishConfig,
};

pub const AUTOMATION_DRIFT_BLOCKED_REASON: &str = "automation_projection_drift";
const AUTOMATION_COMMIT_SUBJECT: &str = "chore(release): apply One Publish automation projection";

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
        #[serde(default)]
        confirmed_conflict_paths: Vec<String>,
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
                confirmed_conflict_paths,
            } => Self::Install {
                configuration_id: configuration_id.clone(),
                execution_backend_id: execution_backend_id.clone(),
                trigger_policy: trigger_policy.clone(),
                binding_id: Some(
                    binding_id
                        .clone()
                        .unwrap_or_else(|| new_configuration_identity("automation-binding")),
                ),
                confirmed_conflict_paths: confirmed_conflict_paths.clone(),
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
    pub conflict_release_namespace: Option<String>,
    pub conflict_delivery_destination_namespace: Option<String>,
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
    pub current_runtime_revision: String,
    pub expected_runtime_revision: String,
    pub runtime_upgrade_available: bool,
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
    pub conflicts: BTreeMap<String, AutomationNamespaceConflict>,
    /// 同时覆盖期望投影与呈现给使用者的差异；仓库或配置任何一方变化都会使其失效。
    pub confirmation_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct AutomationNamespaceConflict {
    pub release_namespace: String,
    pub delivery_destination_namespace: String,
}

fn automation_backend(backend_id: &str) -> Result<Arc<dyn ExecutionBackend>, AppError> {
    match backend_id {
        FAKE_AUTOMATION_BACKEND_ID => Ok(Arc::new(FakeAutomationBackend::new())),
        GITHUB_ACTIONS_BACKEND_ID => Ok(Arc::new(GitHubActionsAutomationBackend::new())),
        other => Err(AppError::validation_with_code(
            format!("执行后端 {other} 不支持自动化投影"),
            "automation_backend_unsupported",
        )),
    }
}

/// 安装或显式升级时从绑定目标修订的 `releaseSettings` 固化后端投影输入。
/// 捕获值随 Binding 固定，后续查看与漂移协调只能消费该快照。
fn fixed_backend_projection(
    backend_id: &str,
    revision: &crate::store::PublishConfigurationRevision,
) -> Result<Value, AppError> {
    match backend_id {
        GITHUB_ACTIONS_BACKEND_ID => {
            let release_config =
                crate::tauri_release::release_settings_from_parameters(&revision.parameters)?
                    .ok_or_else(|| {
                        AppError::config_with_code(
                            "GitHub Actions 自动化需要修订中的 Tauri 发布设置",
                            "github_actions_release_config_missing",
                        )
                    })?;
            crate::tauri_release::validate_release_config(&release_config)?;
            serde_json::to_value(release_config).map_err(|error| {
                AppError::config_with_code(
                    format!("无法固定 GitHub Actions 投影输入: {error}"),
                    "github_actions_projection_snapshot_failed",
                )
            })
        }
        _ => Ok(Value::Null),
    }
}

fn automation_runtime_revision(
    backend: &dyn ExecutionBackend,
    revision: &crate::store::PublishConfigurationRevision,
) -> Result<AutomationRuntimeRevision, AppError> {
    one_publish_runner::current_runtime_revision([
        backend.descriptor().identity(),
        AdapterIdentity::new(
            AdapterKind::ProjectProvider,
            revision.provider_id.clone(),
            1,
        ),
    ])
    .map_err(|error| {
        AppError::publish_with_code(
            format!("无法封存自动化运行时修订: {error}"),
            "automation_runtime_revision_invalid",
        )
    })
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
            ..
        } => {
            let profile = active_profile(config, configuration_id)?;
            ensure_unblocked(profile)?;
            let revision = profile.current_revision().ok_or_else(|| {
                AppError::validation_with_code(
                    format!("配置 {} 缺少当前修订", profile.id),
                    "automation_configuration_revision_missing",
                )
            })?;
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
                backend_projection: fixed_backend_projection(execution_backend_id, revision)?,
                runtime_revision: automation_runtime_revision(backend.as_ref(), revision)?.into(),
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
            let revision = profile.current_revision().ok_or_else(|| {
                AppError::validation_with_code(
                    format!("配置 {} 缺少当前修订", profile.id),
                    "automation_configuration_revision_missing",
                )
            })?;
            let backend = automation_backend(&binding.execution_backend_id)?;
            binding.configuration_revision_id = profile.current_revision_id.clone();
            binding.backend_projection =
                fixed_backend_projection(&binding.execution_backend_id, revision)?;
            binding.runtime_revision =
                automation_runtime_revision(backend.as_ref(), revision)?.into();
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
    binding
        .runtime_revision
        .validate_for_projection()
        .map_err(render_error)?;
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
        release_namespace: release_namespace(binding),
        delivery_destination_namespaces: delivery_destination_namespace(binding)
            .into_iter()
            .map(str::to_string)
            .collect(),
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
                (
                    "backendProjection".to_string(),
                    binding.backend_projection.clone(),
                ),
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

fn release_namespace(binding: &AutomationBinding) -> String {
    match &binding.trigger_policy {
        AutomationTriggerPolicy::TagPush { tag_prefix } => format!("tag:{tag_prefix}*"),
        AutomationTriggerPolicy::Manual => "manual".to_string(),
    }
}

fn delivery_destination_namespace(binding: &AutomationBinding) -> Option<&'static str> {
    (binding.execution_backend_id == GITHUB_ACTIONS_BACKEND_ID)
        .then_some("github-release:repository")
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct AutomationConflictKey {
    release_namespace: String,
    delivery_destination_namespace: String,
}

impl AutomationConflictKey {
    fn for_binding(binding: &AutomationBinding) -> Option<Self> {
        delivery_destination_namespace(binding).map(|destination| Self {
            release_namespace: release_namespace(binding),
            delivery_destination_namespace: destination.to_string(),
        })
    }

    fn overlaps(&self, other: &Self) -> bool {
        self.delivery_destination_namespace == other.delivery_destination_namespace
            && release_namespaces_overlap(&self.release_namespace, &other.release_namespace)
    }
}

fn release_namespaces_overlap(left: &str, right: &str) -> bool {
    match (
        left.strip_prefix("tag:")
            .and_then(|value| value.strip_suffix('*')),
        right
            .strip_prefix("tag:")
            .and_then(|value| value.strip_suffix('*')),
    ) {
        (Some(left_prefix), Some(right_prefix)) => {
            left_prefix.starts_with(right_prefix) || right_prefix.starts_with(left_prefix)
        }
        _ => left == right,
    }
}

fn validate_binding_namespaces(targets: &[AutomationBinding]) -> Result<(), AppError> {
    let mut occupied = Vec::<(AutomationConflictKey, &str)>::new();
    let mut binding_ids = BTreeSet::new();
    for binding in targets {
        if !binding_ids.insert(binding.id.as_str()) {
            return Err(AppError::validation_with_code(
                format!("自动化绑定身份重复: {}", binding.id),
                "automation_binding_identity_conflict",
            ));
        }
        let Some(key) = AutomationConflictKey::for_binding(binding) else {
            continue;
        };
        if let Some((_, existing)) = occupied
            .iter()
            .find(|(candidate, _)| candidate.overlaps(&key))
        {
            return Err(AppError::validation_with_code(
                format!(
                    "自动化绑定 {existing} 与 {} 争用发布命名空间 {} 和交付目标命名空间 {}",
                    binding.id, key.release_namespace, key.delivery_destination_namespace
                ),
                "automation_namespace_conflict",
            ));
        }
        occupied.push((key, binding.id.as_str()));
    }
    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
struct WorkflowInspection {
    release_namespaces: Vec<String>,
    has_tag_trigger: bool,
    can_write_contents: bool,
}

fn inspect_workflow(content: &str) -> Result<WorkflowInspection, yaml_serde::Error> {
    fn tag_namespace(pattern: &str) -> Option<String> {
        let normalized = pattern
            .trim()
            .trim_matches(|character| matches!(character, '\'' | '"' | '[' | ']' | ','));
        let prefix = normalized
            .split(['*', '?', '[', '{', '$', '!'])
            .next()
            .unwrap_or_default()
            .trim();
        (!prefix.is_empty()).then(|| format!("tag:{prefix}*"))
    }

    fn mapping_value<'a>(value: &'a yaml_serde::Value, key: &str) -> Option<&'a yaml_serde::Value> {
        value
            .as_mapping()?
            .get(yaml_serde::Value::String(key.to_string()))
    }

    let document = yaml_serde::from_str::<yaml_serde::Value>(content)?;
    let permission_writes_contents = |permissions: &yaml_serde::Value| {
        permissions.as_str() == Some("write-all")
            || mapping_value(permissions, "contents").and_then(yaml_serde::Value::as_str)
                == Some("write")
    };
    let can_write_contents = mapping_value(&document, "permissions")
        .is_some_and(permission_writes_contents)
        || mapping_value(&document, "jobs")
            .and_then(yaml_serde::Value::as_mapping)
            .is_some_and(|jobs| {
                jobs.values().any(|job| {
                    mapping_value(job, "permissions").is_some_and(permission_writes_contents)
                })
            });
    let Some(push) =
        mapping_value(&document, "on").and_then(|events| mapping_value(events, "push"))
    else {
        return Ok(WorkflowInspection {
            release_namespaces: Vec::new(),
            has_tag_trigger: false,
            can_write_contents,
        });
    };
    let Some(tags) = mapping_value(push, "tags") else {
        return Ok(WorkflowInspection {
            release_namespaces: Vec::new(),
            has_tag_trigger: false,
            can_write_contents,
        });
    };

    let mut namespaces = BTreeSet::new();
    match tags {
        yaml_serde::Value::String(pattern) => {
            if let Some(namespace) = tag_namespace(pattern) {
                namespaces.insert(namespace);
            }
        }
        yaml_serde::Value::Sequence(patterns) => {
            for pattern in patterns {
                if let Some(pattern) = pattern.as_str() {
                    if let Some(namespace) = tag_namespace(pattern) {
                        namespaces.insert(namespace);
                    }
                }
            }
        }
        _ => {}
    }

    Ok(WorkflowInspection {
        release_namespaces: namespaces.into_iter().collect(),
        has_tag_trigger: true,
        can_write_contents,
    })
}

fn workflow_delivery_destination_namespace(
    path: &str,
    content: &str,
    has_tag_trigger: bool,
    can_write_contents: bool,
) -> Result<Option<&'static str>, AppError> {
    let creates_github_release = content.contains("gh release create")
        || content.contains("softprops/action-gh-release")
        || content.contains("ncipollo/release-action")
        || content.contains("marvinpinto/action-automatic-releases")
        || content.contains("/repos/${{ github.repository }}/releases")
        || (content.contains("tauri-apps/tauri-action")
            && (content.contains("tagName:") || content.contains("releaseName:")));
    if creates_github_release {
        return Ok(Some("github-release:repository"));
    }

    if has_tag_trigger && can_write_contents {
        return Err(AppError::validation_with_code(
            format!(
                "标签触发的 workflow {path} 具有 contents: write 权限，但无法确定交付目标命名空间"
            ),
            "automation_workflow_namespace_ambiguous",
        ));
    }
    Ok(None)
}

fn discover_initial_takeover_conflicts(
    repo_root: &Path,
    config: &RepoPublishConfig,
    change: &AutomationChangeRequest,
    targets: &[AutomationBinding],
    expected_paths: &BTreeSet<String>,
) -> Result<BTreeMap<String, AutomationNamespaceConflict>, AppError> {
    let is_initial_github_install = matches!(
        change,
        AutomationChangeRequest::Install {
            execution_backend_id,
            ..
        } if execution_backend_id == GITHUB_ACTIONS_BACKEND_ID
    ) && !config
        .applied_bundles
        .iter()
        .any(|bundle| bundle.backend_id == GITHUB_ACTIONS_BACKEND_ID);
    if !is_initial_github_install {
        return Ok(BTreeMap::new());
    }

    let target_namespaces = targets
        .iter()
        .filter_map(AutomationConflictKey::for_binding)
        .collect::<BTreeSet<_>>();
    let workflow_dir = repo_root.join(".github/workflows");
    if !workflow_dir.is_dir() {
        return Ok(BTreeMap::new());
    }

    let mut conflicts = BTreeMap::new();
    for entry in std::fs::read_dir(&workflow_dir).map_err(|error| {
        AppError::repository_with_code(
            format!("无法读取 {}: {error}", workflow_dir.display()),
            "automation_workflow_scan_failed",
        )
    })? {
        let path = entry
            .map_err(|error| {
                AppError::repository_with_code(
                    format!("无法读取 workflow 目录项: {error}"),
                    "automation_workflow_scan_failed",
                )
            })?
            .path();
        if !matches!(
            path.extension().and_then(|extension| extension.to_str()),
            Some("yml" | "yaml")
        ) {
            continue;
        }
        let relative = path
            .strip_prefix(repo_root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        if expected_paths.contains(&relative) {
            continue;
        }
        let content = std::fs::read_to_string(&path).map_err(|error| {
            AppError::repository_with_code(
                format!("无法读取 workflow {relative}: {error}"),
                "automation_workflow_read_failed",
            )
        })?;
        let inspection = inspect_workflow(&content).map_err(|error| {
            AppError::validation_with_code(
                format!("无法解析 workflow {relative}: {error}"),
                "automation_workflow_parse_failed",
            )
        })?;
        let Some(destination) = workflow_delivery_destination_namespace(
            &relative,
            &content,
            inspection.has_tag_trigger,
            inspection.can_write_contents,
        )?
        else {
            continue;
        };
        if inspection.release_namespaces.is_empty() {
            return Err(AppError::validation_with_code(
                format!("workflow {relative} 会写入 GitHub Release，但无法确定 Release Namespace"),
                "automation_workflow_namespace_ambiguous",
            ));
        }
        let conflict = inspection.release_namespaces.into_iter().find(|release| {
            let key = AutomationConflictKey {
                release_namespace: release.clone(),
                delivery_destination_namespace: destination.to_string(),
            };
            target_namespaces.iter().any(|target| target.overlaps(&key))
        });
        if let Some(release) = conflict {
            conflicts.insert(
                relative,
                AutomationNamespaceConflict {
                    release_namespace: release,
                    delivery_destination_namespace: destination.to_string(),
                },
            );
        }
    }
    Ok(conflicts)
}

pub(crate) fn preview_change(
    repo_root: &Path,
    config: &RepoPublishConfig,
    change: &AutomationChangeRequest,
    now: &str,
) -> Result<AutomationPreviewOutcome, AppError> {
    let mut normalized_change = change.normalized();
    let targets = resolve_target_bindings(config, &normalized_change, now)?;
    validate_binding_namespaces(&targets)?;
    let expected = render_expected(config, &targets, now)?;
    let previously_owned = previously_owned_paths(config)?;
    let candidates = expected
        .files
        .keys()
        .cloned()
        .chain(previously_owned.iter().cloned())
        .collect::<BTreeSet<_>>();
    let actual = read_repository_files(repo_root, &candidates)?;
    let mut changes = diff_automation_files(&expected.files, &actual, &previously_owned);
    let expected_paths = expected.files.keys().cloned().collect::<BTreeSet<_>>();
    let conflicts = discover_initial_takeover_conflicts(
        repo_root,
        config,
        &normalized_change,
        &targets,
        &expected_paths,
    )?;
    if let AutomationChangeRequest::Install {
        confirmed_conflict_paths,
        ..
    } = &mut normalized_change
    {
        if confirmed_conflict_paths
            .iter()
            .any(|path| !is_safe_portable_relative_path(path))
        {
            return Err(AppError::validation_with_code(
                "接管确认包含不可移植的资源路径",
                "automation_takeover_conflict_path_invalid",
            ));
        }
        let discovered = conflicts.keys().cloned().collect::<Vec<_>>();
        if confirmed_conflict_paths.is_empty() {
            *confirmed_conflict_paths = discovered;
        } else {
            let confirmed_still_present = confirmed_conflict_paths
                .iter()
                .filter(|path| repo_root.join(path).is_file())
                .cloned()
                .collect::<Vec<_>>();
            if confirmed_still_present == discovered {
                // 已确认但已不存在的路径只能来自上次未推送成功的本地接入提交。
            } else {
                return Err(AppError::validation_with_code(
                    "接管冲突资源与预览时不一致，请重新查看完整差异并确认",
                    "automation_takeover_conflicts_changed",
                ));
            }
        }
    }
    for path in conflicts.keys() {
        let content = std::fs::read_to_string(repo_root.join(path)).map_err(|error| {
            AppError::repository_with_code(
                format!("无法读取冲突 workflow {path}: {error}"),
                "automation_workflow_read_failed",
            )
        })?;
        changes.push(AutomationBundleFileChange {
            path: path.clone(),
            kind: AutomationFileChangeKind::Removed,
            current_content: Some(content),
            expected_content: None,
        });
    }
    changes.sort_by(|left, right| left.path.cmp(&right.path));
    let confirmation_digest =
        canonical_digest(&(&normalized_change, &expected.files, &changes, &conflicts))
            .map_err(render_error)?;
    Ok(AutomationPreviewOutcome {
        normalized_change,
        targets,
        expected,
        changes,
        conflicts,
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

    let mut targets = outcome.targets.clone();
    assign_external_identities(&mut targets, &outcome.expected.files)?;

    if outcome.changes.is_empty() {
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
        let pending_commit =
            retry_pending_projection_push(repo_root, &expected_branch, config, &outcome)?;
        config.bindings = targets;
        config.applied_bundles = outcome.expected.bundles;
        return Ok(AutomationApplyResult {
            commit_sha: pending_commit.clone(),
            pushed_branch: pending_commit.map(|_| expected_branch),
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
    successful_git(repo_root, &["commit", "-m", AUTOMATION_COMMIT_SUBJECT])?;
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
    let drift = outcome
        .changes
        .iter()
        .map(|change| change_view(change, outcome.conflicts.get(&change.path)))
        .collect::<Vec<_>>();

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
            let backend = automation_backend(&binding.execution_backend_id)?;
            let profile = active_profile(config, &binding.configuration_id)?;
            let revision = profile.current_revision().ok_or_else(|| {
                AppError::validation_with_code(
                    format!("配置 {} 缺少当前修订", profile.id),
                    "automation_configuration_revision_missing",
                )
            })?;
            let expected_runtime_revision =
                automation_runtime_revision(backend.as_ref(), revision)?;
            let current_runtime_revision = binding.runtime_revision.identifier();
            let expected_runtime_revision_id = expected_runtime_revision.identifier();
            Ok(AutomationBindingView {
                binding: binding.clone(),
                configuration_name: config
                    .profile(&binding.configuration_id)
                    .map(|profile| profile.name.clone()),
                blocked_reason: blocked.then(|| AUTOMATION_DRIFT_BLOCKED_REASON.to_string()),
                runtime_upgrade_available: binding.runtime_revision
                    != expected_runtime_revision.clone().into(),
                current_runtime_revision,
                expected_runtime_revision: expected_runtime_revision_id,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;

    Ok(AutomationBindingsView { bindings, drift })
}

fn change_view(
    change: &AutomationBundleFileChange,
    conflict: Option<&AutomationNamespaceConflict>,
) -> AutomationFileChangeView {
    AutomationFileChangeView {
        path: change.path.clone(),
        kind: match change.kind {
            AutomationFileChangeKind::Added => AutomationFileChangeKindView::Added,
            AutomationFileChangeKind::Updated => AutomationFileChangeKindView::Updated,
            AutomationFileChangeKind::Removed => AutomationFileChangeKindView::Removed,
        },
        current_content: change.current_content.clone(),
        expected_content: change.expected_content.clone(),
        conflict_release_namespace: conflict.map(|value| value.release_namespace.clone()),
        conflict_delivery_destination_namespace: conflict
            .map(|value| value.delivery_destination_namespace.clone()),
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

fn retry_pending_projection_push(
    repository_root: &Path,
    default_branch: &str,
    config: &RepoPublishConfig,
    outcome: &AutomationPreviewOutcome,
) -> Result<Option<String>, AppError> {
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
    let parsed = counts
        .split_whitespace()
        .map(str::parse::<usize>)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| {
            AppError::repository_with_code(
                format!("无法解析默认分支同步状态 '{counts}': {error}"),
                "automation_branch_sync_state_invalid",
            )
        })?;
    match parsed.as_slice() {
        [0, 0] => Ok(None),
        [1, 0] => {
            let subject = successful_git(repository_root, &["show", "-s", "--format=%s", "HEAD"])?;
            let changed_paths = successful_git(
                repository_root,
                &["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"],
            )?;
            let paths = changed_paths
                .lines()
                .map(str::trim)
                .filter(|path| !path.is_empty())
                .collect::<Vec<_>>();
            if subject != AUTOMATION_COMMIT_SUBJECT || paths.is_empty() {
                return Err(AppError::repository_with_code(
                    "默认分支包含无法验证的本地提交，拒绝作为自动化投影重试推送",
                    "automation_pending_commit_unverified",
                ));
            }
            validate_pending_projection_commit(
                repository_root,
                default_branch,
                config,
                outcome,
                &paths,
            )?;
            let commit_sha = successful_git(repository_root, &["rev-parse", "HEAD"])?;
            successful_git(
                repository_root,
                &["push", "origin", &format!("HEAD:{default_branch}")],
            )?;
            Ok(Some(commit_sha))
        }
        _ => Err(AppError::repository_with_code(
            format!("默认分支与 origin/{default_branch} 不同步: {counts}"),
            "automation_branch_not_synced",
        )),
    }
}

fn git_file_at(
    repository_root: &Path,
    revision: &str,
    path: &str,
) -> Result<Option<String>, AppError> {
    let object = format!("{revision}:{path}");
    let exists = git(repository_root, &["cat-file", "-e", &object])?;
    if !exists.status.success() {
        return Ok(None);
    }
    let output = git(repository_root, &["show", &object])?;
    if output.status.success() {
        Ok(Some(String::from_utf8_lossy(&output.stdout).into_owned()))
    } else {
        Err(AppError::repository_with_code(
            format!("无法读取 Git 对象 {object}"),
            "automation_pending_commit_unverified",
        ))
    }
}

fn validate_pending_projection_commit(
    repository_root: &Path,
    default_branch: &str,
    config: &RepoPublishConfig,
    outcome: &AutomationPreviewOutcome,
    changed_paths: &[&str],
) -> Result<(), AppError> {
    let previous_owned = previously_owned_paths(config)?;
    let confirmed_conflicts = match &outcome.normalized_change {
        AutomationChangeRequest::Install {
            confirmed_conflict_paths,
            ..
        } => confirmed_conflict_paths
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>(),
        _ => BTreeSet::new(),
    };
    let target_namespaces = outcome
        .targets
        .iter()
        .filter_map(AutomationConflictKey::for_binding)
        .collect::<BTreeSet<_>>();
    let remote_revision = format!("origin/{default_branch}");

    for path in changed_paths {
        if let Some(expected) = outcome.expected.files.get(*path) {
            let actual = git_file_at(repository_root, "HEAD", path)?;
            if actual.as_deref() != Some(expected.content.as_str()) {
                return Err(AppError::repository_with_code(
                    format!("待重试提交中的 Bundle 内容与固定投影不一致: {path}"),
                    "automation_pending_commit_unverified",
                ));
            }
            continue;
        }
        if previous_owned.contains(*path) {
            if git_file_at(repository_root, "HEAD", path)?.is_some()
                || git_file_at(repository_root, &remote_revision, path)?.is_none()
            {
                return Err(AppError::repository_with_code(
                    format!("待重试提交没有按 Bundle 所有权移除资源: {path}"),
                    "automation_pending_commit_unverified",
                ));
            }
            continue;
        }
        if confirmed_conflicts.contains(*path) {
            let is_workflow = path.starts_with(".github/workflows/")
                && matches!(
                    Path::new(path).extension().and_then(|value| value.to_str()),
                    Some("yml" | "yaml")
                );
            let original = git_file_at(repository_root, &remote_revision, path)?;
            let conflict_is_valid = if let Some(content) = original {
                let inspection = inspect_workflow(&content).map_err(|error| {
                    AppError::repository_with_code(
                        format!("无法解析待重试提交中的 workflow {path}: {error}"),
                        "automation_pending_commit_unverified",
                    )
                })?;
                let destination = workflow_delivery_destination_namespace(
                    path,
                    &content,
                    inspection.has_tag_trigger,
                    inspection.can_write_contents,
                )?;
                destination.is_some_and(|destination| {
                    inspection.release_namespaces.into_iter().any(|release| {
                        let key = AutomationConflictKey {
                            release_namespace: release,
                            delivery_destination_namespace: destination.to_string(),
                        };
                        target_namespaces.iter().any(|target| target.overlaps(&key))
                    })
                })
            } else {
                false
            };
            if !is_workflow
                || !conflict_is_valid
                || git_file_at(repository_root, "HEAD", path)?.is_some()
            {
                return Err(AppError::repository_with_code(
                    format!("待重试提交移除了未经语义确认的资源: {path}"),
                    "automation_pending_commit_unverified",
                ));
            }
            continue;
        }
        return Err(AppError::repository_with_code(
            format!("待重试提交触碰了 Bundle 之外的资源: {path}"),
            "automation_pending_commit_unverified",
        ));
    }
    Ok(())
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
        changes: outcome
            .changes
            .iter()
            .map(|change| change_view(change, outcome.conflicts.get(&change.path)))
            .collect(),
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
    use crate::tauri_release::{TauriReleaseConfig, MANAGED_WORKFLOW_PATH};
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
        run_git(work, &["commit", "--quiet", "-m", message]);
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
        run_git(&work, &["config", "user.name", "One Publish Tests"]);
        run_git(
            &work,
            &["config", "user.email", "tests@one-publish.invalid"],
        );
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
        fixture_config_for_provider(name, "dotnet")
    }

    fn fixture_config_for_provider(name: &str, provider_id: &str) -> (RepoPublishConfig, String) {
        let mut config = RepoPublishConfig::default();
        let profile = config
            .create_profile(
                name.to_string(),
                provider_id.to_string(),
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
            confirmed_conflict_paths: Vec::new(),
        }
    }

    fn github_actions_install_request(
        profile_id: &str,
        binding_id: &str,
        tag_prefix: &str,
    ) -> AutomationChangeRequest {
        AutomationChangeRequest::Install {
            configuration_id: profile_id.to_string(),
            execution_backend_id: crate::github_actions_backend::GITHUB_ACTIONS_BACKEND_ID
                .to_string(),
            trigger_policy: AutomationTriggerPolicy::TagPush {
                tag_prefix: tag_prefix.to_string(),
            },
            binding_id: Some(binding_id.to_string()),
            confirmed_conflict_paths: Vec::new(),
        }
    }

    fn fixture_tauri_config(name: &str) -> (RepoPublishConfig, String) {
        let mut config = RepoPublishConfig::default();
        let release_settings =
            serde_json::to_value(github_actions_config()).expect("serialize release settings");
        let profile = config
            .create_profile(
                name.to_string(),
                "tauri".to_string(),
                serde_json::json!({
                    crate::tauri_release::RELEASE_SETTINGS_PARAMETER: release_settings
                }),
                None,
                "2026-07-21T10:00:00Z".to_string(),
            )
            .expect("create fixture profile")
            .clone();
        (config, profile.id)
    }

    fn github_actions_config() -> TauriReleaseConfig {
        TauriReleaseConfig {
            app_name: "Fixture".to_string(),
            allow_unsigned_release: true,
            ..TauriReleaseConfig::default()
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
    fn github_actions_install_seals_the_projection_from_the_revision_release_settings() {
        let (_temp, work) = fixture_repository();
        let mut config = RepoPublishConfig::default();
        let release_settings =
            serde_json::to_value(github_actions_config()).expect("serialize release settings");
        let profile = config
            .create_profile(
                "Stable".to_string(),
                "tauri".to_string(),
                serde_json::json!({
                    crate::tauri_release::RELEASE_SETTINGS_PARAMETER: release_settings.clone()
                }),
                None,
                "2026-07-21T10:00:00Z".to_string(),
            )
            .expect("create fixture profile")
            .clone();

        let outcome = preview_change(
            &work,
            &config,
            &github_actions_install_request(&profile.id, "binding-stable", "v"),
            NOW,
        )
        .expect("preview GitHub Actions install from catalog settings");

        assert_eq!(outcome.targets.len(), 1);
        assert_eq!(outcome.targets[0].backend_projection, release_settings);
    }

    #[test]
    fn github_actions_install_without_revision_release_settings_is_rejected() {
        let (_temp, work) = fixture_repository();
        let (config, profile_id) = fixture_config_for_provider("Stable", "tauri");

        let error = preview_change(
            &work,
            &config,
            &github_actions_install_request(&profile_id, "binding-stable", "v"),
            NOW,
        )
        .expect_err("install without release settings must fail");

        assert_eq!(
            error.code.as_deref(),
            Some("github_actions_release_config_missing")
        );
    }

    #[test]
    fn github_actions_takeover_previews_and_applies_the_complete_confirmed_diff() {
        let (temp, work) = fixture_repository();
        let (mut config, profile_id) = fixture_tauri_config("Stable");
        let workflow_dir = work.join(".github/workflows");
        std::fs::create_dir_all(&workflow_dir).expect("create workflow directory");
        let managed_path = work.join(MANAGED_WORKFLOW_PATH);
        std::fs::write(&managed_path, "name: drifted managed workflow\n")
            .expect("write drifted managed workflow");
        let legacy_path = workflow_dir.join("legacy-release.yml");
        std::fs::write(
            &legacy_path,
            "on:\n  push:\n    tags: ['v*']\nsteps:\n  - run: gh release create\n",
        )
        .expect("write conflicting legacy workflow");
        let quality_path = workflow_dir.join("quality.yml");
        std::fs::write(&quality_path, "on: [push]\nsteps:\n  - run: cargo test\n")
            .expect("write unrelated workflow");
        commit_all(&work, "seed workflow takeover");
        run_git(&work, &["push", "--quiet", "origin", "main"]);
        let before = run_git(&work, &["rev-parse", "HEAD"]);

        let change = github_actions_install_request(&profile_id, "binding-stable", "v");
        let preview =
            preview_change(&work, &config, &change, NOW).expect("preview GitHub Actions takeover");

        let described = preview
            .changes
            .iter()
            .map(|change| (change.path.as_str(), change.kind))
            .collect::<Vec<_>>();
        assert!(described.contains(&(
            ".one-publish/automation/github-actions.json",
            AutomationFileChangeKind::Added
        )));
        assert!(described.contains(&(MANAGED_WORKFLOW_PATH, AutomationFileChangeKind::Updated)));
        assert!(described.contains(&(
            ".github/workflows/legacy-release.yml",
            AutomationFileChangeKind::Removed
        )));
        let conflict = preview
            .conflicts
            .get(".github/workflows/legacy-release.yml")
            .expect("semantic namespace conflict");
        assert_eq!(conflict.release_namespace, "tag:v*");
        assert_eq!(
            conflict.delivery_destination_namespace,
            "github-release:repository"
        );
        match &preview.normalized_change {
            AutomationChangeRequest::Install {
                confirmed_conflict_paths,
                ..
            } => assert_eq!(
                confirmed_conflict_paths,
                &vec![".github/workflows/legacy-release.yml".to_string()]
            ),
            other => panic!("expected normalized install request, got {other:?}"),
        }
        assert!(quality_path.is_file());
        assert_eq!(run_git(&work, &["rev-parse", "HEAD"]), before);
        assert!(config.bindings.is_empty());

        let result = apply_change(
            &work,
            &mut config,
            &preview.normalized_change,
            &preview.confirmation_digest,
            NOW,
        )
        .expect("apply confirmed GitHub Actions takeover");

        let commit_sha = result.commit_sha.expect("single onboarding commit");
        assert_eq!(result.pushed_branch.as_deref(), Some("main"));
        assert_eq!(
            run_git(&work, &["rev-list", "--count", &format!("{before}..HEAD")]),
            "1"
        );
        assert_eq!(
            run_git(&temp.path().join("origin.git"), &["rev-parse", "main"]),
            commit_sha
        );
        assert!(work.join(MANAGED_WORKFLOW_PATH).is_file());
        assert!(!legacy_path.exists());
        assert!(quality_path.is_file());
        assert_eq!(config.bindings.len(), 1);
        assert_eq!(
            config.bindings[0].execution_backend_id,
            crate::github_actions_backend::GITHUB_ACTIONS_BACKEND_ID
        );
    }

    #[test]
    fn github_actions_conflicts_use_release_and_destination_namespaces() {
        let (_temp, work) = fixture_repository();
        let (mut config, stable_id) = fixture_tauri_config("Stable");
        let nightly = config
            .create_profile(
                "Nightly".to_string(),
                "tauri".to_string(),
                serde_json::json!({
                    crate::tauri_release::RELEASE_SETTINGS_PARAMETER:
                        serde_json::to_value(github_actions_config())
                            .expect("serialize release settings")
                }),
                None,
                "2026-07-22T10:05:00Z".to_string(),
            )
            .expect("create nightly profile")
            .clone();
        let stable = github_actions_install_request(&stable_id, "binding-stable", "v");
        let stable_preview =
            preview_change(&work, &config, &stable, NOW).expect("preview stable binding");
        apply_change(
            &work,
            &mut config,
            &stable_preview.normalized_change,
            &stable_preview.confirmation_digest,
            NOW,
        )
        .expect("apply stable binding");

        let duplicate = github_actions_install_request(&nightly.id, "binding-duplicate", "v1");
        let error = preview_change(&work, &config, &duplicate, NOW)
            .expect_err("the same release and destination namespace must conflict");
        assert_eq!(error.code.as_deref(), Some("automation_namespace_conflict"));

        let non_overlapping =
            github_actions_install_request(&nightly.id, "binding-nightly", "nightly-");
        let preview = preview_change(&work, &config, &non_overlapping, NOW)
            .expect("different release namespaces may coexist");
        assert!(preview
            .changes
            .iter()
            .any(|change| change.path.contains("binding-nightly")));

        let duplicate_identity =
            github_actions_install_request(&nightly.id, "binding-stable", "nightly-");
        let error = preview_change(&work, &config, &duplicate_identity, NOW)
            .expect_err("binding identities must be unique");
        assert_eq!(
            error.code.as_deref(),
            Some("automation_binding_identity_conflict")
        );
    }

    #[test]
    fn takeover_scans_every_tag_namespace_and_blocks_ambiguous_release_writers() {
        let (_temp, work) = fixture_repository();
        let (config, profile_id) = fixture_tauri_config("Stable");
        let workflow_dir = work.join(".github/workflows");
        std::fs::create_dir_all(&workflow_dir).expect("create workflow directory");
        let multi_tag = workflow_dir.join("multi-tag-release.yml");
        std::fs::write(
            &multi_tag,
            "on:\n  push:\n    tags: ['nightly-*', 'v1*']\nsteps:\n  - uses: ncipollo/release-action@0123456789012345678901234567890123456789\n",
        )
        .expect("write multi-tag release workflow");
        commit_all(&work, "seed multi-tag workflow");
        run_git(&work, &["push", "--quiet", "origin", "main"]);

        let install = github_actions_install_request(&profile_id, "binding-stable", "v");
        let preview = preview_change(&work, &config, &install, NOW)
            .expect("second tag namespace still conflicts");
        assert_eq!(
            preview
                .conflicts
                .get(".github/workflows/multi-tag-release.yml")
                .map(|conflict| conflict.release_namespace.as_str()),
            Some("tag:v1*")
        );

        std::fs::remove_file(&multi_tag).expect("replace with ambiguous workflow");
        std::fs::write(
            workflow_dir.join("custom-release.yml"),
            "on:\n  push:\n    tags:\n      - '*'\npermissions:\n  contents: write\nsteps:\n  - uses: example/publish@0123456789012345678901234567890123456789\n",
        )
        .expect("write ambiguous catch-all tag workflow");
        commit_all(&work, "replace with ambiguous release writer");
        run_git(&work, &["push", "--quiet", "origin", "main"]);

        let error = preview_change(&work, &config, &install, NOW)
            .expect_err("unknown release writer must not be silently skipped");
        assert_eq!(
            error.code.as_deref(),
            Some("automation_workflow_namespace_ambiguous")
        );
    }

    #[test]
    fn workflow_inspection_reads_only_trigger_and_permissions_paths() {
        let flow_style = "on: { push: { tags: ['v*'] } }\npermissions: { contents: write }\n";
        let inspection = inspect_workflow(flow_style).expect("parse flow-style workflow");
        assert!(inspection.has_tag_trigger);
        assert!(inspection.can_write_contents);
        assert_eq!(inspection.release_namespaces, vec!["tag:v*".to_string()]);
        assert_eq!(
            workflow_delivery_destination_namespace(
                "flow-style.yml",
                flow_style,
                inspection.has_tag_trigger,
                inspection.can_write_contents,
            )
            .expect_err("flow-style unknown writer must be blocked")
            .code
            .as_deref(),
            Some("automation_workflow_namespace_ambiguous")
        );

        let step_input =
            "on: [workflow_dispatch]\nsteps:\n  - uses: example/action@v1\n    with:\n      tags: v*\n";
        let inspection = inspect_workflow(step_input).expect("parse workflow input tags");
        assert!(!inspection.has_tag_trigger);
        assert!(!inspection.can_write_contents);
        assert!(inspection.release_namespaces.is_empty());

        let write_all =
            "on: { push: { tags: ['v*'] } }\npermissions: write-all\njobs: { publish: { runs-on: ubuntu-latest } }\n";
        let inspection = inspect_workflow(write_all).expect("parse write-all workflow");
        assert!(inspection.can_write_contents);

        let job_permission = "on: { push: { tags: ['v*'] } }\njobs:\n  publish:\n    permissions: { contents: write }\n";
        let inspection = inspect_workflow(job_permission).expect("parse job permissions");
        assert!(inspection.can_write_contents);
    }

    #[test]
    fn github_actions_takeover_deletes_only_the_exact_conflicts_confirmed_in_preview() {
        let (_temp, work) = fixture_repository();
        let (mut config, profile_id) = fixture_tauri_config("Stable");
        let workflow_dir = work.join(".github/workflows");
        std::fs::create_dir_all(&workflow_dir).expect("create workflow directory");
        let first = workflow_dir.join("legacy-first.yml");
        std::fs::write(
            &first,
            "on:\n  push:\n    tags: ['v*']\nsteps:\n  - run: gh release create\n",
        )
        .expect("write first conflict");
        commit_all(&work, "seed first conflict");
        run_git(&work, &["push", "--quiet", "origin", "main"]);

        let install = github_actions_install_request(&profile_id, "binding-stable", "v");
        let preview = preview_change(&work, &config, &install, NOW)
            .expect("preview exact takeover conflicts");

        let second = workflow_dir.join("legacy-second.yml");
        std::fs::write(
            &second,
            "on:\n  push:\n    tags: ['v1*']\nsteps:\n  - run: gh release create\n",
        )
        .expect("add a new overlapping conflict after preview");
        let error = apply_change(
            &work,
            &mut config,
            &preview.normalized_change,
            &preview.confirmation_digest,
            NOW,
        )
        .expect_err("a changed conflict set requires a new explicit confirmation");

        assert_eq!(
            error.code.as_deref(),
            Some("automation_takeover_conflicts_changed")
        );
        assert!(first.is_file());
        assert!(second.is_file());
        assert!(config.bindings.is_empty());
        assert!(config.applied_bundles.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn failed_github_push_keeps_binding_incomplete_and_retries_the_same_onboarding_commit() {
        use std::os::unix::fs::PermissionsExt;

        let (temp, work) = fixture_repository();
        let (mut config, profile_id) = fixture_tauri_config("Stable");
        let hook = temp.path().join("origin.git/hooks/pre-receive");
        std::fs::write(&hook, "#!/bin/sh\nexit 1\n").expect("write rejecting hook");
        let mut permissions = std::fs::metadata(&hook)
            .expect("read hook metadata")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&hook, permissions).expect("make hook executable");

        let change = github_actions_install_request(&profile_id, "binding-stable", "v");
        let preview = preview_change(&work, &config, &change, NOW).expect("preview install");
        let error = apply_change(
            &work,
            &mut config,
            &preview.normalized_change,
            &preview.confirmation_digest,
            NOW,
        )
        .expect_err("fake GitHub rejects the onboarding push");
        assert_eq!(error.code.as_deref(), Some("automation_git_failed"));
        assert!(config.bindings.is_empty());
        assert!(config.applied_bundles.is_empty());
        let pending_commit = run_git(&work, &["rev-parse", "HEAD"]);
        std::fs::remove_file(&hook).expect("repair fake GitHub push boundary");

        let retry = preview_change(&work, &config, &preview.normalized_change, NOW)
            .expect("retry preview sees the local onboarding commit");
        assert!(retry.changes.is_empty());
        let retried = apply_change(
            &work,
            &mut config,
            &retry.normalized_change,
            &retry.confirmation_digest,
            NOW,
        )
        .expect("repaired boundary pushes the original onboarding commit");
        assert_eq!(retried.commit_sha.as_deref(), Some(pending_commit.as_str()));
        assert_eq!(retried.pushed_branch.as_deref(), Some("main"));
        assert_eq!(
            run_git(&temp.path().join("origin.git"), &["rev-parse", "main"]),
            pending_commit
        );
        assert_eq!(config.bindings.len(), 1);
        assert_eq!(config.applied_bundles.len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn failed_push_retry_rejects_a_commit_that_deletes_an_unowned_file() {
        use std::os::unix::fs::PermissionsExt;

        let (temp, work) = fixture_repository();
        let quality_path = work.join(".github/workflows/quality.yml");
        std::fs::create_dir_all(quality_path.parent().expect("workflow parent"))
            .expect("create workflow directory");
        std::fs::write(&quality_path, "on: [push]\nsteps:\n  - run: cargo test\n")
            .expect("write quality workflow");
        commit_all(&work, "seed unowned quality workflow");
        run_git(&work, &["push", "--quiet", "origin", "main"]);

        let (mut config, profile_id) = fixture_tauri_config("Stable");
        let hook = temp.path().join("origin.git/hooks/pre-receive");
        std::fs::write(&hook, "#!/bin/sh\nexit 1\n").expect("write rejecting hook");
        let mut permissions = std::fs::metadata(&hook)
            .expect("read hook metadata")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&hook, permissions).expect("make hook executable");

        let install = github_actions_install_request(&profile_id, "binding-stable", "v");
        let preview = preview_change(&work, &config, &install, NOW).expect("preview install");
        apply_change(
            &work,
            &mut config,
            &preview.normalized_change,
            &preview.confirmation_digest,
            NOW,
        )
        .expect_err("fake GitHub rejects the push");

        std::fs::remove_file(&quality_path).expect("maliciously delete unowned workflow");
        run_git(&work, &["add", "--", ".github/workflows/quality.yml"]);
        run_git(&work, &["commit", "--amend", "--no-edit"]);
        std::fs::remove_file(&hook).expect("repair fake GitHub");
        let mut malicious_change = preview.normalized_change;
        let AutomationChangeRequest::Install {
            confirmed_conflict_paths,
            ..
        } = &mut malicious_change
        else {
            panic!("expected install request");
        };
        confirmed_conflict_paths.push(".github/workflows/quality.yml".to_string());
        let retry = preview_change(&work, &config, &malicious_change, NOW)
            .expect("retry preview cannot trust missing client-supplied paths");
        let error = apply_change(
            &work,
            &mut config,
            &retry.normalized_change,
            &retry.confirmation_digest,
            NOW,
        )
        .expect_err("unowned deletion must not be pushed");
        assert_eq!(
            error.code.as_deref(),
            Some("automation_pending_commit_unverified")
        );
        assert!(config.bindings.is_empty());
        assert_ne!(
            run_git(&temp.path().join("origin.git"), &["rev-parse", "main"]),
            run_git(&work, &["rev-parse", "HEAD"])
        );
    }

    #[test]
    fn github_actions_drift_update_and_detach_preserve_unowned_history() {
        let (_temp, work) = fixture_repository();
        let (mut config, profile_id) = fixture_tauri_config("Stable");
        let install = github_actions_install_request(&profile_id, "binding-stable", "v");
        let preview = preview_change(&work, &config, &install, NOW).expect("preview install");
        let installed = apply_change(
            &work,
            &mut config,
            &preview.normalized_change,
            &preview.confirmation_digest,
            NOW,
        )
        .expect("apply install");
        let onboarding_commit = installed.commit_sha.expect("onboarding commit");
        let binding = config.bindings[0].clone();

        let history_dir = work.join("history");
        std::fs::create_dir_all(&history_dir).expect("create history fixtures");
        std::fs::write(history_dir.join("attempt.json"), "{\"attempt\":\"kept\"}\n")
            .expect("write attempt sentinel");
        std::fs::write(history_dir.join("receipt.json"), "{\"receipt\":\"kept\"}\n")
            .expect("write receipt sentinel");
        std::fs::write(
            work.join(&binding.external_identity),
            "name: manually drifted\n",
        )
        .expect("drift managed workflow");
        commit_all(&work, "record history and drift workflow");
        run_git(&work, &["tag", "v0.1.0"]);
        run_git(&work, &["push", "--quiet", "origin", "main", "v0.1.0"]);

        let view = bindings_view(&work, &config, NOW).expect("view drift");
        assert_eq!(view.drift.len(), 1);
        assert_eq!(
            view.bindings[0].blocked_reason.as_deref(),
            Some(AUTOMATION_DRIFT_BLOCKED_REASON)
        );

        let reconcile = preview_change(&work, &config, &AutomationChangeRequest::Reconcile, NOW)
            .expect("preview drift update");
        apply_change(
            &work,
            &mut config,
            &reconcile.normalized_change,
            &reconcile.confirmation_digest,
            NOW,
        )
        .expect("apply drift update");

        let detach = AutomationChangeRequest::Detach {
            binding_id: binding.id,
        };
        let detach_preview = preview_change(&work, &config, &detach, NOW).expect("preview detach");
        apply_change(
            &work,
            &mut config,
            &detach_preview.normalized_change,
            &detach_preview.confirmation_digest,
            NOW,
        )
        .expect("apply detach");

        assert!(config.bindings.is_empty());
        assert!(config.applied_bundles.is_empty());
        assert!(config.profile(&profile_id).is_some());
        assert!(!config
            .profile(&profile_id)
            .expect("configuration retained")
            .revisions
            .is_empty());
        assert!(history_dir.join("attempt.json").is_file());
        assert!(history_dir.join("receipt.json").is_file());
        assert_eq!(
            run_git(&work, &["rev-parse", "refs/tags/v0.1.0"]),
            run_git(&work, &["rev-parse", "v0.1.0"])
        );
        assert_eq!(
            run_git(&work, &["cat-file", "-t", &onboarding_commit]),
            "commit"
        );
    }

    #[test]
    fn github_actions_upgrade_changes_only_the_pinned_bundle_projection() {
        let (_temp, work) = fixture_repository();
        let (mut config, profile_id) = fixture_tauri_config("Stable");
        let install = github_actions_install_request(&profile_id, "binding-stable", "v");
        let install_preview =
            preview_change(&work, &config, &install, NOW).expect("preview install");
        apply_change(
            &work,
            &mut config,
            &install_preview.normalized_change,
            &install_preview.confirmation_digest,
            NOW,
        )
        .expect("apply install");
        let pinned_revision = config.bindings[0].configuration_revision_id.clone();

        let mut changed_release_config = github_actions_config();
        changed_release_config.app_config_path = "desktop/src-tauri/tauri.conf.json".to_string();
        config
            .update_profile(
                &profile_id,
                "Stable".to_string(),
                "tauri".to_string(),
                serde_json::json!({
                    crate::tauri_release::RELEASE_SETTINGS_PARAMETER:
                        serde_json::to_value(&changed_release_config)
                            .expect("serialize changed release settings")
                }),
                None,
                "2026-07-22T11:00:00Z".to_string(),
            )
            .expect("save new configuration revision");
        let current_revision = config
            .profile(&profile_id)
            .expect("profile")
            .current_revision_id
            .clone();
        assert_ne!(pinned_revision, current_revision);
        assert_eq!(
            config.bindings[0].configuration_revision_id,
            pinned_revision
        );

        let unchanged = bindings_view(&work, &config, NOW)
            .expect("a newer local revision cannot change the fixed projection");
        assert!(unchanged.drift.is_empty());

        let upgrade = AutomationChangeRequest::UpgradeRevision {
            binding_id: config.bindings[0].id.clone(),
        };
        let preview = preview_change(&work, &config, &upgrade, NOW)
            .expect("preview explicit revision and backend snapshot upgrade");
        assert!(preview.changes.iter().any(|change| {
            change.path == ".one-publish/automation/github-actions.json"
                && change.kind == AutomationFileChangeKind::Updated
        }));
        assert!(preview.changes.iter().any(|change| {
            change.path == MANAGED_WORKFLOW_PATH && change.kind == AutomationFileChangeKind::Updated
        }));

        apply_change(
            &work,
            &mut config,
            &preview.normalized_change,
            &preview.confirmation_digest,
            NOW,
        )
        .expect("apply explicit revision upgrade");
        assert_eq!(
            config.bindings[0].configuration_revision_id,
            current_revision
        );
        assert!(
            std::fs::read_to_string(work.join(".one-publish/automation/github-actions.json"))
                .expect("read bundle manifest")
                .contains(&current_revision)
        );
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
    fn bindings_report_pinned_and_expected_runtime_until_explicit_upgrade() {
        let (_temp, work) = fixture_repository();
        let (mut config, profile_id) = fixture_config("Stable");
        preview_then_apply(&work, &mut config, &install_request(&profile_id));
        let binding_id = config.bindings[0].id.clone();
        let expected_runtime = config.bindings[0]
            .runtime_revision
            .exact()
            .expect("new binding pins an exact runtime")
            .clone();
        let pinned_runtime = publish_domain::PinnedAutomationRuntimeRevision::Legacy(
            "plan-v1.adapter-v1.fake-automation@1".to_string(),
        );
        let pinned_runtime_id = pinned_runtime.identifier();
        let expected_runtime_id = expected_runtime.identifier();
        config.bindings[0].runtime_revision = pinned_runtime.clone();

        // 模拟已安装自动化仍固定旧 Runner；协调只恢复该固定投影，不能隐式升级。
        preview_then_apply(&work, &mut config, &AutomationChangeRequest::Reconcile);
        let before_upgrade = bindings_view(&work, &config, NOW).expect("view pinned runtime");
        assert!(before_upgrade.drift.is_empty());
        assert_eq!(
            before_upgrade.bindings[0].current_runtime_revision,
            pinned_runtime_id
        );
        assert_eq!(
            before_upgrade.bindings[0].expected_runtime_revision,
            expected_runtime_id
        );
        assert!(before_upgrade.bindings[0].runtime_upgrade_available);
        assert_eq!(config.bindings[0].runtime_revision, pinned_runtime);

        let upgrade = AutomationChangeRequest::UpgradeRevision {
            binding_id: binding_id.clone(),
        };
        let preview =
            preview_change(&work, &config, &upgrade, NOW).expect("preview runtime upgrade");
        assert!(preview.changes.iter().any(|change| {
            change
                .current_content
                .as_deref()
                .is_some_and(|content| content.contains(&pinned_runtime_id))
                && change
                    .expected_content
                    .as_deref()
                    .is_some_and(|content| content.contains(&expected_runtime.runner.version))
        }));
        assert_eq!(
            config.bindings[0].runtime_revision, pinned_runtime,
            "preview must not upgrade the binding"
        );

        preview_then_apply(&work, &mut config, &upgrade);
        let upgraded = bindings_view(&work, &config, NOW).expect("view upgraded runtime");
        assert_eq!(
            upgraded.bindings[0].current_runtime_revision,
            expected_runtime_id
        );
        assert_eq!(
            upgraded.bindings[0].expected_runtime_revision,
            expected_runtime_id
        );
        assert!(!upgraded.bindings[0].runtime_upgrade_available);
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
                confirmed_conflict_paths: Vec::new(),
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
                confirmed_conflict_paths: Vec::new(),
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
