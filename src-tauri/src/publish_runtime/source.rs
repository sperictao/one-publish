//! 统一发布来源解析（统一发布输入方案 §2.1/§2.2）。
//!
//! `PublishSource` 是前端表达"发布配置从哪来"的唯一方式：选择修订、编辑草稿、
//! 应用模板、项目配置、历史重跑与新建草稿。解析产物是完整
//! `PublishConfigurationContent`；执行输入的派生（spec、命令、输出目录）
//! 全部发生在后端统一 prepare 中，前端不再构造执行 spec。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use crate::errors::AppError;
use crate::provider::registry::ProviderRegistry;
use crate::store::{
    find_repository, get_state, ConfigProfile, ExecutionRecord, PublishComposition,
    PublishConfigurationRevision, Repository, CURRENT_SETTINGS_VERSION,
    PUBLISH_CONFIGURATION_CONTRACT_VERSION,
};

use super::PublishRecoverySnapshot;

/// 完整配置内容：一次发布所需的全部配置数据，不含来源身份。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct PublishConfigurationContent {
    pub provider_id: String,
    pub contract_version: u32,
    pub provider_version: String,
    pub settings_version: u32,
    /// 项目候选身份（不透明引用，沿用后端候选身份编码）。
    #[serde(default)]
    #[ts(optional)]
    pub project_binding: Option<String>,
    /// 完整参数，包含 releaseSettings 等保留键；不做富表单往返、不静默过滤。
    pub parameters: Value,
    pub composition: PublishComposition,
}

/// 编辑基准修订引用：只表示草稿的编辑来源；草稿修改后不能继续按该旧修订执行。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct PublishBaseRevisionRef {
    pub configuration_id: String,
    pub revision_id: String,
}

/// 草稿来源引用：记录草稿从哪里加载，供展示与语义判断使用。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum PublishDraftOrigin {
    Revision {
        #[serde(rename = "configurationId")]
        #[ts(rename = "configurationId")]
        configuration_id: String,
        #[serde(rename = "revisionId")]
        #[ts(rename = "revisionId")]
        revision_id: String,
    },
    Template {
        #[serde(rename = "templateId")]
        #[ts(rename = "templateId")]
        template_id: String,
    },
    ProjectProfile {
        reference: String,
    },
    History {
        #[serde(rename = "recordId")]
        #[ts(rename = "recordId")]
        record_id: String,
    },
    New,
}

/// 可编辑的统一草稿：普通 Provider 与 .NET 共用同一份状态。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct PublishDraft {
    pub content: PublishConfigurationContent,
    pub origin: PublishDraftOrigin,
    /// 编辑基准修订；仅当草稿来自命名配置修订时设置。
    #[serde(default)]
    #[ts(optional)]
    pub base_revision: Option<PublishBaseRevisionRef>,
}

/// 发布配置来源（§2.1）：统一 prepare 与编辑器加载的唯一入口。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[allow(clippy::large_enum_variant)] // Serialized IPC contract; boxing would only change Rust storage semantics.
pub enum PublishSource {
    /// 已保存命名配置：加载指定修订；当前修订检查保留在统一 prepare 中。
    Revision {
        #[serde(rename = "configurationId")]
        #[ts(rename = "configurationId")]
        configuration_id: String,
        #[serde(rename = "revisionId")]
        #[ts(rename = "revisionId")]
        revision_id: String,
    },
    /// 草稿携带完整配置内容，不能在发布时丢弃其绑定、版本或交付组合。
    Draft {
        content: PublishConfigurationContent,
        /// 编辑基准修订（可选）：草稿修改自某个修订时携带。
        #[serde(default)]
        #[ts(optional)]
        base_revision: Option<PublishBaseRevisionRef>,
    },
    /// Provider 模板：后端模板实现产生配置内容。
    Template {
        #[serde(rename = "providerId")]
        #[ts(rename = "providerId")]
        provider_id: String,
        #[serde(rename = "templateId")]
        #[ts(rename = "templateId")]
        template_id: String,
        #[serde(rename = "projectBinding")]
        #[ts(rename = "projectBinding")]
        project_binding: Option<String>,
    },
    /// 项目配置（.NET pubxml）：Provider 语义解析项目配置引用；未绑定身份时
    /// 沿用仓库已解析的项目文件。
    ProjectProfile {
        #[serde(rename = "providerId")]
        #[ts(rename = "providerId")]
        provider_id: String,
        #[serde(default)]
        #[ts(optional)]
        project_binding: Option<String>,
        reference: String,
    },
    /// 历史重跑：恢复原配置与已记录执行输入，使用当前源码，创建新 Attempt。
    History {
        #[serde(rename = "recordId")]
        #[ts(rename = "recordId")]
        record_id: String,
    },
    /// 新建草稿：后端生成版本信息与本地默认组合；参数为空对象。
    Empty {
        #[serde(rename = "providerId")]
        #[ts(rename = "providerId")]
        provider_id: String,
        #[serde(rename = "projectBinding")]
        #[ts(rename = "projectBinding")]
        project_binding: Option<String>,
    },
}

/// 本次运行的运行时输入：只承载不属于配置修订的数据（§2.2）。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(rename_all = "camelCase")]
pub struct PublishRunInputs {
    /// 当前默认输出目录；空字符串明确表示未设置。
    pub default_output_dir: String,
    /// Artifact Promotion 复用既有封存 Manifest（ADR-0040）。
    #[serde(default)]
    #[ts(optional)]
    pub promoted_manifest_digest: Option<String>,
}

/// 来源解析诊断：非致命信息；致命缺失以结构化错误返回。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct PublishSourceDiagnostic {
    pub code: String,
    pub message: String,
}

/// `resolve_publish_source` 的结果：完整草稿、来源身份与诊断；不创建 Attempt。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ResolvedPublishSource {
    pub draft: PublishDraft,
    /// 来源身份：revision/history 来源解析出的配置与修订身份。
    #[serde(default)]
    #[ts(optional)]
    pub configuration_id: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub revision_id: Option<String>,
    /// 配置级阻断（配置封锁或修订版本不兼容）；当前修订检查保留在 prepare。
    #[serde(default)]
    #[ts(optional)]
    pub blocked_reason: Option<String>,
    pub diagnostics: Vec<PublishSourceDiagnostic>,
}

fn source_error(code: &str, message: impl Into<String>) -> AppError {
    AppError::validation_with_code(message, code)
}

fn known_provider(provider_id: &str) -> Result<(), AppError> {
    ProviderRegistry::new()
        .get(provider_id)
        .map(|_| ())
        .map_err(|_| {
            source_error(
                "publish_source_unknown_provider",
                format!("unknown publish provider: {provider_id}"),
            )
        })
}

/// 所有 PublishSource 共用的配置内容版本门禁。来源可以不同，但只要最终
/// 解析为同一份 PublishConfigurationContent，就必须按当前 Provider/Settings
/// 合同统一判断兼容性，禁止 History/Draft 绕过命名 Revision 的版本阻断。
fn configuration_content_blocked_reason(content: &PublishConfigurationContent) -> Option<String> {
    if content.contract_version != PUBLISH_CONFIGURATION_CONTRACT_VERSION {
        return Some(format!(
            "configuration_contract_version_unsupported:{}",
            content.contract_version
        ));
    }

    let registry = ProviderRegistry::new();
    let provider = match registry.get(&content.provider_id) {
        Ok(provider) => provider,
        Err(_) => return Some(format!("provider_unavailable:{}", content.provider_id)),
    };

    if let Some(project_binding) = content.project_binding.as_deref() {
        if super::project_binding_selector(&content.provider_id, project_binding).is_none() {
            return Some(format!(
                "project_binding_provider_mismatch:{project_binding}"
            ));
        }
    }

    if content.provider_version != provider.manifest().version {
        return Some(format!(
            "provider_version_unsupported:{}",
            content.provider_version
        ));
    }

    if content.settings_version != CURRENT_SETTINGS_VERSION {
        return Some(format!(
            "settings_version_unsupported:{}",
            content.settings_version
        ));
    }

    if let Some(reason) = super::composition_invalid_reason(&content.composition) {
        return Some(reason);
    }

    None
}

pub(crate) fn content_from_revision(revision: &PublishConfigurationRevision) -> PublishConfigurationContent {
    PublishConfigurationContent {
        provider_id: revision.provider_id.clone(),
        contract_version: revision.contract_version,
        provider_version: revision.provider_version.clone(),
        settings_version: revision.settings_version,
        project_binding: revision.project_binding.clone(),
        parameters: revision.parameters.clone(),
        composition: revision.composition.clone(),
    }
}

fn draft_from_content(
    content: PublishConfigurationContent,
    origin: PublishDraftOrigin,
    base_revision: Option<PublishBaseRevisionRef>,
) -> PublishDraft {
    PublishDraft {
        content,
        origin,
        base_revision,
    }
}

fn resolution(
    draft: PublishDraft,
    configuration_id: Option<String>,
    revision_id: Option<String>,
    blocked_reason: Option<String>,
    diagnostics: Vec<PublishSourceDiagnostic>,
) -> ResolvedPublishSource {
    ResolvedPublishSource {
        draft,
        configuration_id,
        revision_id,
        blocked_reason,
        diagnostics,
    }
}

fn diagnostic(code: &str, message: impl Into<String>) -> PublishSourceDiagnostic {
    PublishSourceDiagnostic {
        code: code.to_string(),
        message: message.into(),
    }
}

/// Tauri 命令：解析发布来源，返回完整草稿与诊断；不创建 Attempt。
#[tauri::command]
pub fn resolve_publish_source(
    repository_id: String,
    source: PublishSource,
) -> Result<ResolvedPublishSource, AppError> {
    let state = get_state();
    let repository = find_repository(&state.repositories, &repository_id)?;
    resolve_publish_source_scoped(repository, &state.execution_history, &source)
}

/// 来源解析核心：仓库与历史由调用方提供，便于测试。
pub(crate) fn resolve_publish_source_scoped(
    repository: &Repository,
    history: &[ExecutionRecord],
    source: &PublishSource,
) -> Result<ResolvedPublishSource, AppError> {
    let mut resolved = match source {
        PublishSource::Revision {
            configuration_id,
            revision_id,
        } => resolve_revision_source(repository, configuration_id, revision_id),
        PublishSource::Draft {
            content,
            base_revision,
        } => resolve_draft_source(repository, content, base_revision.as_ref()),
        PublishSource::Template {
            provider_id,
            template_id,
            project_binding,
        } => resolve_template_source(provider_id, template_id, project_binding.as_deref()),
        PublishSource::ProjectProfile {
            provider_id,
            project_binding,
            reference,
        } => resolve_project_profile_source(repository, provider_id, project_binding.as_deref(), reference),
        PublishSource::History { record_id } => {
            resolve_history_source(repository, history, record_id)
        }
        PublishSource::Empty {
            provider_id,
            project_binding,
        } => resolve_empty_source(provider_id, project_binding.as_deref()),
    }?;

    if resolved.blocked_reason.is_none() {
        resolved.blocked_reason = configuration_content_blocked_reason(&resolved.draft.content);
    }

    Ok(resolved)
}

fn resolve_revision_source(
    repository: &Repository,
    configuration_id: &str,
    revision_id: &str,
) -> Result<ResolvedPublishSource, AppError> {
    let profile = find_active_profile(repository, configuration_id)?;
    let revision = find_revision(profile, revision_id)?;

    let mut diagnostics = Vec::new();
    if profile.current_revision_id != revision_id {
        diagnostics.push(diagnostic(
            "publish_source_revision_not_current",
            format!(
                "configuration {configuration_id} is currently at revision {}",
                profile.current_revision_id
            ),
        ));
    }

    let content = content_from_revision(revision);
    Ok(resolution(
        draft_from_content(
            content,
            PublishDraftOrigin::Revision {
                configuration_id: configuration_id.to_string(),
                revision_id: revision_id.to_string(),
            },
            Some(PublishBaseRevisionRef {
                configuration_id: configuration_id.to_string(),
                revision_id: revision_id.to_string(),
            }),
        ),
        Some(configuration_id.to_string()),
        Some(revision_id.to_string()),
        profile.blocked_reason.clone(),
        diagnostics,
    ))
}

fn resolve_draft_source(
    repository: &Repository,
    content: &PublishConfigurationContent,
    base_revision: Option<&PublishBaseRevisionRef>,
) -> Result<ResolvedPublishSource, AppError> {
    known_provider(&content.provider_id)?;
    if let Some(base) = base_revision {
        let profile = find_active_profile(repository, &base.configuration_id)?;
        let revision = find_revision(profile, &base.revision_id)?;
        if profile.current_revision_id != base.revision_id
            || revision.provider_id != content.provider_id
        {
            return Err(source_error(
                "publish_source_draft_conflict",
                "the draft base revision has changed; reload the configuration before publishing",
            ));
        }
    }
    let origin = match base_revision {
        Some(base) => PublishDraftOrigin::Revision {
            configuration_id: base.configuration_id.clone(),
            revision_id: base.revision_id.clone(),
        },
        None => PublishDraftOrigin::New,
    };
    Ok(resolution(
        draft_from_content(content.clone(), origin, base_revision.cloned()),
        None,
        None,
        None,
        Vec::new(),
    ))
}

fn resolve_template_source(
    provider_id: &str,
    template_id: &str,
    project_binding: Option<&str>,
) -> Result<ResolvedPublishSource, AppError> {
    known_provider(provider_id)?;
    let registry = ProviderRegistry::new();
    let provider = registry.get(provider_id).expect("provider known");
    let template = provider.resolve_template(template_id).ok_or_else(|| {
        source_error(
            "publish_source_template_not_found",
            format!("provider {provider_id} has no template {template_id}"),
        )
    })?;

    let content = PublishConfigurationContent {
        provider_id: provider_id.to_string(),
        contract_version: PUBLISH_CONFIGURATION_CONTRACT_VERSION,
        provider_version: provider.manifest().version.clone(),
        settings_version: CURRENT_SETTINGS_VERSION,
        project_binding: project_binding.map(str::to_string),
        parameters: template.parameters,
        composition: PublishComposition::local_default(),
    };
    Ok(resolution(
        draft_from_content(content, PublishDraftOrigin::Template { template_id: template_id.to_string() }, None),
        None,
        None,
        None,
        Vec::new(),
    ))
}

/// 项目配置（Project Publish Profile）：绑定选择子定位项目文件，引用必须命中
/// 已发现的配置名单；按 Provider 声明的项目配置语义解析，不识别具体工具链。
fn resolve_project_profile_source(
    repository: &Repository,
    provider_id: &str,
    project_binding: Option<&str>,
    reference: &str,
) -> Result<ResolvedPublishSource, AppError> {
    let registry = ProviderRegistry::new();
    let provider = registry
        .get(provider_id)
        .map_err(|_| {
            source_error(
                "publish_source_unknown_provider",
                format!("unknown publish provider: {provider_id}"),
            )
        })?;
    let Some(project_profiles) = provider.capabilities().project_profiles.clone() else {
        return Err(source_error(
            "publish_source_project_profile_unsupported",
            format!("provider {provider_id} does not support project profiles"),
        ));
    };

    let project_file = match project_binding {
        Some(binding) => project_file_for_binding(repository, provider_id, binding)?,
        None => {
            let project_file = repository.project_file.as_deref().ok_or_else(|| {
                source_error(
                    "publish_source_project_profile_not_found",
                    "the repository has no resolved project file for the publish profile",
                )
            })?;
            repository_scoped_project_file(repository, Path::new(project_file))?
        }
    };
    let valid_profiles = crate::commands::scan_publish_profiles(&project_file);
    if !valid_profiles.iter().any(|name| name == reference) {
        return Err(source_error(
            "publish_source_project_profile_not_found",
            format!(
                "publish profile {reference} was not found; available: {}",
                if valid_profiles.is_empty() {
                    "(none)".to_string()
                } else {
                    valid_profiles.join(", ")
                }
            ),
        ));
    }

    let mut reference_value = serde_json::Map::new();
    reference_value.insert(
        project_profiles.reference_property,
        serde_json::Value::String(reference.to_string()),
    );
    let mut parameters = serde_json::Map::new();
    parameters.insert(
        project_profiles.reference_parameter,
        serde_json::Value::Object(reference_value),
    );
    let content = PublishConfigurationContent {
        provider_id: provider_id.to_string(),
        contract_version: PUBLISH_CONFIGURATION_CONTRACT_VERSION,
        provider_version: provider.manifest().version.clone(),
        settings_version: CURRENT_SETTINGS_VERSION,
        project_binding: project_binding.map(str::to_string),
        parameters: serde_json::Value::Object(parameters),
        composition: PublishComposition::local_default(),
    };
    Ok(resolution(
        draft_from_content(
            content,
            PublishDraftOrigin::ProjectProfile {
                reference: reference.to_string(),
            },
            None,
        ),
        None,
        None,
        None,
        Vec::new(),
    ))
}

/// 历史来源：恢复原配置与已记录执行输入。
///
/// 旧记录（无恢复快照）按证据处理：有精确配置/修订引用且修订仍存在时，
/// 结合原 spec 恢复；缺少完整原配置返回 `history_input_incomplete`。
/// 新记录的完整恢复快照在统一 prepare 批次接入后优先于修订引用。
fn resolve_history_source(
    repository: &Repository,
    history: &[ExecutionRecord],
    record_id: &str,
) -> Result<ResolvedPublishSource, AppError> {
    let record = history
        .iter()
        .find(|record| {
            record.id == record_id
                && record
                    .repo_id
                    .as_deref()
                    .map_or(true, |repo| repo == repository.id)
        })
        .ok_or_else(|| {
            source_error(
                "publish_source_history_not_found",
                format!("execution record {record_id} was not found"),
            )
        })?;

    let history_incomplete = || {
        source_error(
            "history_input_incomplete",
            "this history entry has no complete original configuration; it can only be restored as a new draft",
        )
    };

    // 新记录优先使用完整恢复快照（§3.3）：直接恢复，不依赖修订存活。
    if let Some(value) = record.recovery_snapshot.as_ref() {
        let mut value = value.clone();
        if crate::security::sanitize_publish_recovery_snapshot(&mut value) {
            return Err(history_incomplete());
        }
        let snapshot: PublishRecoverySnapshot = serde_json::from_value(value)
            .map_err(|_| history_incomplete())?;
        if snapshot.version != super::PUBLISH_RECOVERY_SNAPSHOT_VERSION {
            return Err(history_incomplete());
        }
        let mut content = snapshot.content;
        let mut diagnostics = Vec::new();
        if let Some(parameters) = content.parameters.as_object_mut() {
            if let Some(executed) = snapshot.executed_parameters.as_object() {
                let mut applied = false;
                for (key, value) in executed {
                    if parameters.get(key) != Some(value) {
                        parameters.insert(key.clone(), value.clone());
                        applied = true;
                    }
                }
                if applied {
                    diagnostics.push(diagnostic(
                        "history_recorded_inputs_applied",
                        "recorded execution inputs from the original run were applied",
                    ));
                }
            }
        }
        return Ok(resolution(
            draft_from_content(
                content,
                PublishDraftOrigin::History {
                    record_id: record_id.to_string(),
                },
                None,
            ),
            Some(snapshot.configuration_id),
            Some(snapshot.configuration_revision_id),
            None,
            diagnostics,
        ));
    }

    let (Some(configuration_id), Some(revision_id)) = (
        record.configuration_id.as_deref(),
        record.configuration_revision_id.as_deref(),
    ) else {
        return Err(history_incomplete());
    };
    let revision = repository
        .publish_config
        .profiles
        .iter()
        .find(|profile| profile.id == configuration_id)
        .and_then(|profile| {
            profile
                .revisions
                .iter()
                .find(|revision| revision.id == revision_id)
        })
        .ok_or_else(history_incomplete)?;

    // 原配置为基础；已记录执行参数（如当次输出目录）叠加在其上。
    // releaseSettings 等保留键不在执行 spec 中，只存在于修订参数里，不受影响。
    let mut content = content_from_revision(revision);
    let mut diagnostics = Vec::new();
    if let Some(recorded) = record
        .spec
        .as_ref()
        .and_then(|spec| spec.get("parameters"))
        .and_then(Value::as_object)
    {
        if let Some(parameters) = content.parameters.as_object_mut() {
            let mut applied = false;
            for (key, value) in recorded {
                if parameters.get(key) != Some(value) {
                    parameters.insert(key.clone(), value.clone());
                    applied = true;
                }
            }
            if applied {
                diagnostics.push(diagnostic(
                    "history_recorded_inputs_applied",
                    "recorded execution inputs from the original run were applied",
                ));
            }
        }
    } else {
        diagnostics.push(diagnostic(
            "history_input_missing_spec",
            "the history entry has no recorded execution inputs; the revision parameters will be used",
        ));
    }

    let mut recovery = serde_json::json!({"content": &content});
    if crate::security::sanitize_publish_recovery_snapshot(&mut recovery) {
        return Err(history_incomplete());
    }
    Ok(resolution(
        draft_from_content(
            content,
            PublishDraftOrigin::History {
                record_id: record_id.to_string(),
            },
            Some(PublishBaseRevisionRef {
                configuration_id: configuration_id.to_string(),
                revision_id: revision_id.to_string(),
            }),
        ),
        Some(configuration_id.to_string()),
        Some(revision_id.to_string()),
        None,
        diagnostics,
    ))
}

fn resolve_empty_source(
    provider_id: &str,
    project_binding: Option<&str>,
) -> Result<ResolvedPublishSource, AppError> {
    known_provider(provider_id)?;
    let registry = ProviderRegistry::new();
    let provider = registry.get(provider_id).expect("provider known");
    let content = PublishConfigurationContent {
        provider_id: provider_id.to_string(),
        contract_version: PUBLISH_CONFIGURATION_CONTRACT_VERSION,
        provider_version: provider.manifest().version.clone(),
        settings_version: CURRENT_SETTINGS_VERSION,
        project_binding: project_binding.map(str::to_string),
        parameters: Value::Object(serde_json::Map::new()),
        composition: PublishComposition::local_default(),
    };
    Ok(resolution(
        draft_from_content(content, PublishDraftOrigin::New, None),
        None,
        None,
        None,
        Vec::new(),
    ))
}

fn find_active_profile<'a>(
    repository: &'a Repository,
    configuration_id: &str,
) -> Result<&'a ConfigProfile, AppError> {
    repository
        .publish_config
        .profiles
        .iter()
        .find(|profile| profile.id == configuration_id && profile.deleted_at.is_none())
        .ok_or_else(|| {
            source_error(
                "publish_source_configuration_not_found",
                format!("configuration {configuration_id} was not found"),
            )
        })
}

fn find_revision<'a>(
    profile: &'a ConfigProfile,
    revision_id: &str,
) -> Result<&'a PublishConfigurationRevision, AppError> {
    profile
        .revisions
        .iter()
        .find(|revision| revision.id == revision_id)
        .ok_or_else(|| {
            source_error(
                "publish_source_revision_not_found",
                format!(
                    "configuration {} has no revision {revision_id}",
                    profile.id
                ),
            )
        })
}

fn project_binding_outside_repository(repository: &Repository) -> AppError {
    source_error(
        "publish_source_project_binding_outside_repository",
        format!(
            "the project binding resolves outside repository {}",
            repository.path
        ),
    )
}

/// 在读取项目配置之前强制 Project Binding 留在仓库边界内。
/// 先做词法边界校验，避免 `..`/绝对路径直接访问仓库外；再 canonicalize
/// 验证真实路径，阻断仓库内 symlink 指向仓库外的逃逸。
fn repository_scoped_project_file(
    repository: &Repository,
    project_file: &Path,
) -> Result<PathBuf, AppError> {
    let raw_repository = Path::new(&repository.path);
    let canonical_repository = std::fs::canonicalize(raw_repository).map_err(|error| {
        source_error(
            "publish_source_project_profile_not_found",
            format!("the repository root cannot be resolved: {error}"),
        )
    })?;

    let candidate = if project_file.is_absolute() {
        project_file.to_path_buf()
    } else {
        if project_file.components().any(|component| {
            matches!(
                component,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        }) {
            return Err(project_binding_outside_repository(repository));
        }
        raw_repository.join(project_file)
    };

    let relative = candidate
        .strip_prefix(raw_repository)
        .or_else(|_| candidate.strip_prefix(&canonical_repository))
        .map_err(|_| project_binding_outside_repository(repository))?;
    if relative.components().any(|component| {
        matches!(
            component,
            std::path::Component::ParentDir
                | std::path::Component::RootDir
                | std::path::Component::Prefix(_)
        )
    }) {
        return Err(project_binding_outside_repository(repository));
    }

    let canonical_candidate = std::fs::canonicalize(&candidate).map_err(|error| {
        source_error(
            "publish_source_project_profile_not_found",
            format!("the project file cannot be resolved: {error}"),
        )
    })?;
    if !canonical_candidate.starts_with(&canonical_repository) {
        return Err(project_binding_outside_repository(repository));
    }

    Ok(canonical_candidate)
}

/// 从绑定身份编码中取出仓库相对选择子并定位项目文件；仓库根选择子（"."）
/// 沿用仓库已解析的项目文件。所有路径在返回前都必须通过仓库边界校验。
fn project_file_for_binding(
    repository: &Repository,
    provider_id: &str,
    project_binding: &str,
) -> Result<PathBuf, AppError> {
    let selector = super::project_binding_selector(provider_id, project_binding).ok_or_else(|| {
        source_error(
            "publish_source_project_binding_provider_mismatch",
            format!(
                "project binding {project_binding} does not belong to provider {provider_id}"
            ),
        )
    })?;
    let project_file = if selector == "." {
        repository
            .project_file
            .as_deref()
            .map(PathBuf::from)
            .ok_or_else(|| {
                source_error(
                    "publish_source_project_profile_not_found",
                    "the repository has no resolved project file for the publish profile",
                )
            })?
    } else {
        Path::new(selector).to_path_buf()
    };
    repository_scoped_project_file(repository, &project_file)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spec::SPEC_VERSION;

    fn repository_with_profile(
        parameters: Value,
        current_revision_id: &str,
    ) -> (tempfile::TempDir, Repository) {
        let dir = tempfile::tempdir().expect("create repository dir");
        let revision = PublishConfigurationRevision {
            id: current_revision_id.to_string(),
            sequence: 1,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            contract_version: PUBLISH_CONFIGURATION_CONTRACT_VERSION,
            provider_id: "dotnet".to_string(),
            provider_version: "1".to_string(),
            settings_version: CURRENT_SETTINGS_VERSION,
            parameters,
            composition: PublishComposition::local_default(),
            project_binding: None,
        };
        let profile = ConfigProfile {
            id: "configuration-A".to_string(),
            name: "配置 A".to_string(),
            profile_group: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            is_system_default: false,
            is_draft: false,
            current_revision_id: current_revision_id.to_string(),
            revisions: vec![revision],
            deleted_at: None,
            blocked_reason: None,
        };
        let repository = Repository {
            id: "repository-A".to_string(),
            name: "Demo".to_string(),
            path: dir.path().to_string_lossy().to_string(),
            project_file: None,
            current_branch: "main".to_string(),
            branches: Vec::new(),
            is_main: false,
            provider_id: Some("dotnet".to_string()),
            publish_config: crate::store::RepoPublishConfig {
                profiles: vec![profile],
                ..crate::store::RepoPublishConfig::default()
            },
        };
        (dir, repository)
    }

    fn record(
        id: &str,
        configuration_id: Option<&str>,
        revision_id: Option<&str>,
        spec: Option<Value>,
    ) -> ExecutionRecord {
        ExecutionRecord {
            id: id.to_string(),
            repo_id: Some("repository-A".to_string()),
            configuration_id: configuration_id.map(str::to_string),
            configuration_revision_id: revision_id.map(str::to_string),
            provider_id: "dotnet".to_string(),
            project_path: "/tmp/App.csproj".to_string(),
            started_at: "2026-01-01T00:00:00Z".to_string(),
            finished_at: "2026-01-01T00:01:00Z".to_string(),
            success: true,
            cancelled: false,
            output_dir: None,
            error: None,
            command_line: None,
            snapshot_path: None,
            failure_signature: None,
            output_excerpt: None,
            spec,
            attempt_id: None,
            recovery_snapshot: None,
            file_count: 0,
            warnings: None,
        }
    }

    fn recorded_spec(parameters: Value) -> Value {
        serde_json::json!({
            "version": SPEC_VERSION,
            "provider_id": "dotnet",
            "project_path": "/tmp/App.csproj",
            "parameters": parameters,
        })
    }

    #[test]
    fn revision_source_resolves_content_verbatim_with_identity() {
        let parameters = serde_json::json!({
            "configuration": "Debug",
            "runtime": "",
            "self_contained": false,
            "verbosity": null,
            "releaseSettings": { "enabled": true },
        });
        let (_dir, repository) = repository_with_profile(parameters.clone(), "revision-A");

        let resolved = resolve_publish_source_scoped(
            &repository,
            &[],
            &PublishSource::Revision {
                configuration_id: "configuration-A".to_string(),
                revision_id: "revision-A".to_string(),
            },
        )
        .expect("resolve revision source");

        // 参数原样保留：false/null/空串与保留键不做任何转换。
        assert_eq!(resolved.draft.content.parameters, parameters);
        assert_eq!(
            resolved.configuration_id.as_deref(),
            Some("configuration-A")
        );
        assert_eq!(resolved.revision_id.as_deref(), Some("revision-A"));
        assert!(resolved.blocked_reason.is_none());
        assert!(resolved.diagnostics.is_empty());
        assert_eq!(
            resolved.draft.base_revision,
            Some(PublishBaseRevisionRef {
                configuration_id: "configuration-A".to_string(),
                revision_id: "revision-A".to_string(),
            })
        );
    }

    #[test]
    fn revision_source_reports_non_current_revision_as_diagnostic() {
        let (_dir, mut repository) =
            repository_with_profile(serde_json::json!({ "configuration": "Release" }), "revision-1");
        let old_revision = PublishConfigurationRevision {
            id: "revision-old".to_string(),
            sequence: 0,
            created_at: "2025-12-01T00:00:00Z".to_string(),
            contract_version: PUBLISH_CONFIGURATION_CONTRACT_VERSION,
            provider_id: "dotnet".to_string(),
            provider_version: "1".to_string(),
            settings_version: CURRENT_SETTINGS_VERSION,
            parameters: serde_json::json!({ "configuration": "Debug" }),
            composition: PublishComposition::local_default(),
            project_binding: None,
        };
        repository.publish_config.profiles[0]
            .revisions
            .push(old_revision);

        let resolved = resolve_publish_source_scoped(
            &repository,
            &[],
            &PublishSource::Revision {
                configuration_id: "configuration-A".to_string(),
                revision_id: "revision-old".to_string(),
            },
        )
        .expect("resolve non-current revision");

        assert_eq!(
            resolved
                .diagnostics
                .iter()
                .map(|d| d.code.as_str())
                .collect::<Vec<_>>(),
            vec!["publish_source_revision_not_current"]
        );
        // 允许读取非当前修订：内容按该旧修订返回。
        assert_eq!(
            resolved.draft.content.parameters,
            serde_json::json!({ "configuration": "Debug" })
        );
    }

    #[test]
    fn revision_source_fails_with_specific_codes() {
        let (_dir, repository) =
            repository_with_profile(serde_json::json!({}), "revision-A");

        let missing_config = resolve_publish_source_scoped(
            &repository,
            &[],
            &PublishSource::Revision {
                configuration_id: "nope".to_string(),
                revision_id: "revision-A".to_string(),
            },
        )
        .expect_err("missing configuration must fail");
        assert_eq!(
            missing_config.code.as_deref(),
            Some("publish_source_configuration_not_found")
        );

        let missing_revision = resolve_publish_source_scoped(
            &repository,
            &[],
            &PublishSource::Revision {
                configuration_id: "configuration-A".to_string(),
                revision_id: "nope".to_string(),
            },
        )
        .expect_err("missing revision must fail");
        assert_eq!(
            missing_revision.code.as_deref(),
            Some("publish_source_revision_not_found")
        );
    }

    #[test]
    fn draft_source_echoes_content_without_conversion() {
        let mut draft = PublishDraft {
            content: PublishConfigurationContent {
                provider_id: "go".to_string(),
                contract_version: PUBLISH_CONFIGURATION_CONTRACT_VERSION,
                provider_version: "1".to_string(),
                settings_version: CURRENT_SETTINGS_VERSION,
                project_binding: Some("go:.".to_string()),
                parameters: serde_json::json!({ "ldflags": "-s -w", "trimpath": false }),
                composition: PublishComposition::local_default(),
            },
            origin: PublishDraftOrigin::New,
            base_revision: None,
        };

        draft.content.composition.artifact_processors.clear();
        draft.content.parameters["extra"] = serde_json::json!({"flag": false, "unset": null});
        draft.content.parameters["releaseSettings"] = serde_json::json!({"preserve": true});
        let resolved = resolve_publish_source_scoped(
            &repository_fixture(),
            &[],
            &PublishSource::Draft {
                content: draft.content.clone(),
                base_revision: None,
            },
        )
        .expect("resolve draft source");

        assert_eq!(resolved.draft.content, draft.content);
        assert!(resolved.blocked_reason.is_none());
    }

    #[test]
    fn draft_source_marks_provider_and_settings_version_mismatches_blocked() {
        let repository = repository_fixture();
        let content = |provider_version: &str, settings_version: u32| PublishConfigurationContent {
            provider_id: "go".to_string(),
            contract_version: PUBLISH_CONFIGURATION_CONTRACT_VERSION,
            provider_version: provider_version.to_string(),
            settings_version,
            project_binding: Some("go:.".to_string()),
            parameters: serde_json::json!({}),
            composition: PublishComposition::local_default(),
        };

        let provider_mismatch = resolve_publish_source_scoped(
            &repository,
            &[],
            &PublishSource::Draft {
                content: content("0", CURRENT_SETTINGS_VERSION),
                base_revision: None,
            },
        )
        .expect("resolve incompatible provider draft");
        assert_eq!(
            provider_mismatch.blocked_reason.as_deref(),
            Some("provider_version_unsupported:0")
        );

        let settings_mismatch = resolve_publish_source_scoped(
            &repository,
            &[],
            &PublishSource::Draft {
                content: content("1", CURRENT_SETTINGS_VERSION + 1),
                base_revision: None,
            },
        )
        .expect("resolve incompatible settings draft");
        assert_eq!(
            settings_mismatch.blocked_reason.as_deref(),
            Some("settings_version_unsupported:2")
        );
    }

    #[test]
    fn draft_source_marks_project_binding_provider_mismatch_blocked() {
        let content = PublishConfigurationContent {
            provider_id: "go".to_string(),
            contract_version: PUBLISH_CONFIGURATION_CONTRACT_VERSION,
            provider_version: "1".to_string(),
            settings_version: CURRENT_SETTINGS_VERSION,
            project_binding: Some("dotnet:App.csproj".to_string()),
            parameters: serde_json::json!({}),
            composition: PublishComposition::local_default(),
        };

        let resolved = resolve_publish_source_scoped(
            &repository_fixture(),
            &[],
            &PublishSource::Draft {
                content,
                base_revision: None,
            },
        )
        .expect("resolve mismatched binding draft as a blocked source");

        assert_eq!(
            resolved.blocked_reason.as_deref(),
            Some("project_binding_provider_mismatch:dotnet:App.csproj")
        );
    }

    #[test]
    fn draft_source_rejects_unknown_provider() {
        let draft = PublishDraft {
            content: PublishConfigurationContent {
                provider_id: "made-up".to_string(),
                contract_version: PUBLISH_CONFIGURATION_CONTRACT_VERSION,
                provider_version: "1".to_string(),
                settings_version: CURRENT_SETTINGS_VERSION,
                project_binding: None,
                parameters: serde_json::json!({}),
                composition: PublishComposition::local_default(),
            },
            origin: PublishDraftOrigin::New,
            base_revision: None,
        };

        let error = resolve_publish_source_scoped(
            &repository_fixture(),
            &[],
            &PublishSource::Draft {
                content: draft.content,
                base_revision: None,
            },
        )
        .expect_err("unknown provider must fail");
        assert_eq!(
            error.code.as_deref(),
            Some("publish_source_unknown_provider")
        );
    }

    #[test]
    fn template_source_resolves_backend_template_parameters() {
        let (dir, mut repository) =
            repository_with_profile(serde_json::json!({}), "revision-A");
        repository.project_file = Some(dir.path().join("App.csproj").to_string_lossy().to_string());

        let resolved = resolve_publish_source_scoped(
            &repository,
            &[],
            &PublishSource::Template {
                provider_id: "dotnet".to_string(),
                template_id: "release-win-x64".to_string(),
                project_binding: Some("dotnet:App.csproj".to_string()),
            },
        )
        .expect("resolve template source");

        assert_eq!(
            resolved.draft.content.parameters,
            serde_json::json!({
                "configuration": "Release",
                "self_contained": true,
                "runtime": "win-x64",
            })
        );
        assert_eq!(
            resolved.draft.content.project_binding.as_deref(),
            Some("dotnet:App.csproj")
        );
        assert_eq!(resolved.draft.origin, PublishDraftOrigin::Template { template_id: "release-win-x64".to_string() });

        let unknown = resolve_publish_source_scoped(
            &repository,
            &[],
            &PublishSource::Template {
                provider_id: "dotnet".to_string(),
                template_id: "nope".to_string(),
                project_binding: None,
            },
        )
        .expect_err("unknown template must fail");
        assert_eq!(
            unknown.code.as_deref(),
            Some("publish_source_template_not_found")
        );
    }

    #[test]
    fn project_profile_source_resolves_pubxml_reference() {
        let dir = tempfile::tempdir().expect("create repository dir");
        let project_file = dir.path().join("App.csproj");
        std::fs::write(&project_file, "<Project />").expect("write project file");
        let profiles_dir = dir.path().join("Properties").join("PublishProfiles");
        std::fs::create_dir_all(&profiles_dir).expect("create profiles dir");
        std::fs::write(profiles_dir.join("FolderProfile.pubxml"), "<Project />")
            .expect("write pubxml");

        let repository = Repository {
            id: "repository-A".to_string(),
            name: "Demo".to_string(),
            path: dir.path().to_string_lossy().to_string(),
            project_file: Some(project_file.to_string_lossy().to_string()),
            current_branch: "main".to_string(),
            branches: Vec::new(),
            is_main: false,
            provider_id: Some("dotnet".to_string()),
            publish_config: crate::store::RepoPublishConfig::default(),
        };

        let resolved = resolve_publish_source_scoped(
            &repository,
            &[],
            &PublishSource::ProjectProfile {
                provider_id: "dotnet".to_string(),
                project_binding: Some("dotnet:App.csproj".to_string()),
                reference: "FolderProfile".to_string(),
            },
        )
        .expect("resolve pubxml source");

        assert_eq!(
            resolved.draft.content.parameters,
            serde_json::json!({ "properties": { "PublishProfile": "FolderProfile" } })
        );
        assert_eq!(
            resolved.draft.content.project_binding.as_deref(),
            Some("dotnet:App.csproj")
        );

        let mismatch = resolve_publish_source_scoped(
            &repository,
            &[],
            &PublishSource::ProjectProfile {
                provider_id: "dotnet".to_string(),
                project_binding: Some("cargo:App.csproj".to_string()),
                reference: "FolderProfile".to_string(),
            },
        )
        .expect_err("project profile binding must belong to its provider");
        assert_eq!(
            mismatch.code.as_deref(),
            Some("publish_source_project_binding_provider_mismatch")
        );

        let missing = resolve_publish_source_scoped(
            &repository,
            &[],
            &PublishSource::ProjectProfile {
                provider_id: "dotnet".to_string(),
                project_binding: Some("dotnet:App.csproj".to_string()),
                reference: "Nope".to_string(),
            },
        )
        .expect_err("missing pubxml must fail");
        assert_eq!(
            missing.code.as_deref(),
            Some("publish_source_project_profile_not_found")
        );
    }

    #[test]
    fn project_profile_source_rejects_repository_boundary_escape() {
        let repository_dir = tempfile::tempdir().expect("create repository dir");
        let outside_dir = tempfile::tempdir().expect("create outside dir");
        let inside_project = repository_dir.path().join("App.csproj");
        std::fs::write(&inside_project, "<Project />").expect("write inside project");
        let outside_project = outside_dir.path().join("Outside.csproj");
        std::fs::write(&outside_project, "<Project />").expect("write outside project");
        let outside_profiles = outside_dir.path().join("Properties").join("PublishProfiles");
        std::fs::create_dir_all(&outside_profiles).expect("create outside profiles");
        std::fs::write(outside_profiles.join("OutsideProfile.pubxml"), "<Project />")
            .expect("write outside pubxml");

        let repository = Repository {
            id: "repository-A".to_string(),
            name: "Demo".to_string(),
            path: repository_dir.path().to_string_lossy().to_string(),
            project_file: Some(inside_project.to_string_lossy().to_string()),
            current_branch: "main".to_string(),
            branches: Vec::new(),
            is_main: false,
            provider_id: Some("dotnet".to_string()),
            publish_config: crate::store::RepoPublishConfig::default(),
        };

        let outside_name = outside_dir
            .path()
            .file_name()
            .expect("outside directory name")
            .to_string_lossy();
        let attacks = [
            format!("dotnet:../{outside_name}/Outside.csproj"),
            format!("dotnet:{}", outside_project.to_string_lossy()),
        ];
        for project_binding in attacks {
            let error = resolve_publish_source_scoped(
                &repository,
                &[],
                &PublishSource::ProjectProfile {
                    provider_id: "dotnet".to_string(),
                    project_binding: Some(project_binding),
                    reference: "OutsideProfile".to_string(),
                },
            )
            .expect_err("project binding must not escape repository");
            assert_eq!(
                error.code.as_deref(),
                Some("publish_source_project_binding_outside_repository")
            );
        }

        let mut unbound = repository.clone();
        unbound.project_file = Some(outside_project.to_string_lossy().to_string());
        let error = resolve_publish_source_scoped(
            &unbound,
            &[],
            &PublishSource::ProjectProfile {
                provider_id: "dotnet".to_string(),
                project_binding: None,
                reference: "OutsideProfile".to_string(),
            },
        )
        .expect_err("repository project_file must obey the same boundary");
        assert_eq!(
            error.code.as_deref(),
            Some("publish_source_project_binding_outside_repository")
        );
    }

    #[cfg(unix)]
    #[test]
    fn project_profile_source_rejects_symlink_escape() {
        use std::os::unix::fs::symlink;

        let repository_dir = tempfile::tempdir().expect("create repository dir");
        let outside_dir = tempfile::tempdir().expect("create outside dir");
        let outside_project = outside_dir.path().join("Outside.csproj");
        std::fs::write(&outside_project, "<Project />").expect("write outside project");
        let outside_profiles = outside_dir.path().join("Properties").join("PublishProfiles");
        std::fs::create_dir_all(&outside_profiles).expect("create outside profiles");
        std::fs::write(outside_profiles.join("OutsideProfile.pubxml"), "<Project />")
            .expect("write outside pubxml");
        symlink(outside_dir.path(), repository_dir.path().join("linked-outside"))
            .expect("create escape symlink");

        let repository = Repository {
            id: "repository-A".to_string(),
            name: "Demo".to_string(),
            path: repository_dir.path().to_string_lossy().to_string(),
            project_file: None,
            current_branch: "main".to_string(),
            branches: Vec::new(),
            is_main: false,
            provider_id: Some("dotnet".to_string()),
            publish_config: crate::store::RepoPublishConfig::default(),
        };
        let error = resolve_publish_source_scoped(
            &repository,
            &[],
            &PublishSource::ProjectProfile {
                provider_id: "dotnet".to_string(),
                project_binding: Some("dotnet:linked-outside/Outside.csproj".to_string()),
                reference: "OutsideProfile".to_string(),
            },
        )
        .expect_err("symlink must not escape repository");
        assert_eq!(
            error.code.as_deref(),
            Some("publish_source_project_binding_outside_repository")
        );
    }

    #[test]
    fn history_source_restores_revision_with_recorded_inputs() {
        let revision_parameters = serde_json::json!({ "configuration": "Release" });
        let (_dir, repository) = repository_with_profile(revision_parameters, "revision-A");
        let history = vec![record(
            "record-1",
            Some("configuration-A"),
            Some("revision-A"),
            Some(recorded_spec(serde_json::json!({
                "configuration": "Release",
                "output": "/old-default-out/App/Release",
            }))),
        )];

        let resolved = resolve_publish_source_scoped(
            &repository,
            &history,
            &PublishSource::History {
                record_id: "record-1".to_string(),
            },
        )
        .expect("resolve history source");

        // 原配置为基础，已记录执行输入叠加；输出目录来自记录而非当前默认目录。
        assert_eq!(
            resolved.draft.content.parameters,
            serde_json::json!({
                "configuration": "Release",
                "output": "/old-default-out/App/Release",
            })
        );
        assert!(resolved
            .diagnostics
            .iter()
            .any(|d| d.code == "history_recorded_inputs_applied"));
        assert!(resolved.blocked_reason.is_none());
    }

    #[test]
    fn history_source_without_recoverable_configuration_is_incomplete() {
        let (_dir, repository) =
            repository_with_profile(serde_json::json!({ "configuration": "Release" }), "revision-A");

        // 无配置引用。
        let no_refs = resolve_publish_source_scoped(
            &repository,
            &[record("record-1", None, None, None)],
            &PublishSource::History {
                record_id: "record-1".to_string(),
            },
        )
        .expect_err("history without configuration refs must be incomplete");
        assert_eq!(no_refs.code.as_deref(), Some("history_input_incomplete"));

        // 修订已被删除（回收）。
        let gone_revision = resolve_publish_source_scoped(
            &repository,
            &[record(
                "record-2",
                Some("configuration-A"),
                Some("revision-gone"),
                Some(recorded_spec(serde_json::json!({}))),
            )],
            &PublishSource::History {
                record_id: "record-2".to_string(),
            },
        )
        .expect_err("history with missing revision must be incomplete");
        assert_eq!(
            gone_revision.code.as_deref(),
            Some("history_input_incomplete")
        );
    }

    #[test]
    fn history_source_prefers_a_complete_recovery_snapshot() {
        let (_dir, repository) =
            repository_with_profile(serde_json::json!({ "configuration": "Release" }), "revision-A");
        // 快照来自已被回收的草稿修订（revision-gone 不存在），重跑仍可恢复。
        let snapshot = PublishRecoverySnapshot {
            version: 1,
            content: PublishConfigurationContent {
                provider_id: "dotnet".to_string(),
                contract_version: PUBLISH_CONFIGURATION_CONTRACT_VERSION,
                provider_version: "1".to_string(),
                settings_version: CURRENT_SETTINGS_VERSION,
                project_binding: Some("dotnet:App.csproj".to_string()),
                parameters: serde_json::json!({ "configuration": "Debug", "self_contained": false }),
                composition: PublishComposition::local_default(),
            },
            configuration_id: "draft-configuration".to_string(),
            configuration_revision_id: "revision-gone".to_string(),
            origin: PublishDraftOrigin::New,
            project_binding: Some("dotnet:App.csproj".to_string()),
            run_inputs: PublishRunInputs::default(),
            executed_parameters: serde_json::json!({
                "configuration": "Debug",
                "self_contained": false,
                "output": "/recorded-out/App/Debug",
            }),
            resolved_output_directory: "/recorded-out/App/Debug".to_string(),
        };
        let mut entry = record(
            "record-snap",
            Some("draft-configuration"),
            Some("revision-gone"),
            None,
        );
        entry.recovery_snapshot =
            Some(serde_json::to_value(&snapshot).expect("serialize recovery snapshot"));
        let history = vec![entry];

        let resolved = resolve_publish_source_scoped(
            &repository,
            &history,
            &PublishSource::History {
                record_id: "record-snap".to_string(),
            },
        )
        .expect("resolve history with recovery snapshot");

        // 内容直接来自快照；已记录执行输入（含当次输出目录）叠加其上。
        assert_eq!(
            resolved.draft.content.parameters,
            serde_json::json!({
                "configuration": "Debug",
                "self_contained": false,
                "output": "/recorded-out/App/Debug",
            })
        );
        assert_eq!(
            resolved.revision_id.as_deref(),
            Some("revision-gone")
        );
        assert!(resolved
            .diagnostics
            .iter()
            .any(|d| d.code == "history_recorded_inputs_applied"));
        assert!(resolved.blocked_reason.is_none());
    }

    #[test]
    fn history_recovery_snapshot_marks_incompatible_versions_blocked() {
        let (_dir, repository) =
            repository_with_profile(serde_json::json!({ "configuration": "Release" }), "revision-A");
        let snapshot = PublishRecoverySnapshot {
            version: 1,
            content: PublishConfigurationContent {
                provider_id: "dotnet".to_string(),
                contract_version: PUBLISH_CONFIGURATION_CONTRACT_VERSION,
                provider_version: "0".to_string(),
                settings_version: CURRENT_SETTINGS_VERSION,
                project_binding: Some("dotnet:App.csproj".to_string()),
                parameters: serde_json::json!({ "configuration": "Debug" }),
                composition: PublishComposition::local_default(),
            },
            configuration_id: "draft-configuration".to_string(),
            configuration_revision_id: "revision-gone".to_string(),
            origin: PublishDraftOrigin::New,
            project_binding: Some("dotnet:App.csproj".to_string()),
            run_inputs: PublishRunInputs::default(),
            executed_parameters: serde_json::json!({ "configuration": "Debug" }),
            resolved_output_directory: "/recorded-out/App/Debug".to_string(),
        };
        let mut entry = record(
            "record-incompatible",
            Some("draft-configuration"),
            Some("revision-gone"),
            None,
        );
        entry.recovery_snapshot =
            Some(serde_json::to_value(&snapshot).expect("serialize recovery snapshot"));

        let resolved = resolve_publish_source_scoped(
            &repository,
            &[entry],
            &PublishSource::History {
                record_id: "record-incompatible".to_string(),
            },
        )
        .expect("resolve incompatible history snapshot");

        assert_eq!(
            resolved.blocked_reason.as_deref(),
            Some("provider_version_unsupported:0")
        );
    }

    #[test]
    fn history_rejects_secret_values_and_redacted_snapshots_without_revision_fallback() {
        let (_dir, repository) = repository_with_profile(serde_json::json!({}), "revision-A");
        for snapshot in [
            serde_json::json!({"redacted": true}),
            serde_json::json!({"content": {"parameters": {"properties": {"Password": "test-only-secret"}}}}),
            serde_json::json!({"content": {"parameters": {"value": "<redacted>"}}}),
        ] {
            let mut entry = record("secret-record", Some("configuration-A"), Some("revision-A"), None);
            entry.recovery_snapshot = Some(snapshot);
            let error = resolve_publish_source_scoped(&repository, &[entry], &PublishSource::History {
                record_id: "secret-record".to_string(),
            }).expect_err("never execute secrets or redaction placeholders");
            assert_eq!(error.code.as_deref(), Some("history_input_incomplete"));
        }
    }

    #[test]
    fn empty_source_generates_versioned_content_with_local_defaults() {
        let (_dir, repository) = repository_with_profile(serde_json::json!({}), "revision-A");

        let resolved = resolve_publish_source_scoped(
            &repository,
            &[],
            &PublishSource::Empty {
                provider_id: "cargo".to_string(),
                project_binding: Some("cargo:.".to_string()),
            },
        )
        .expect("resolve empty source");

        assert_eq!(resolved.draft.content.provider_id, "cargo");
        assert_eq!(
            resolved.draft.content.contract_version,
            PUBLISH_CONFIGURATION_CONTRACT_VERSION
        );
        assert_eq!(
            resolved.draft.content.composition,
            PublishComposition::local_default()
        );
        assert_eq!(
            resolved.draft.content.parameters,
            serde_json::json!({})
        );
        assert_eq!(resolved.draft.origin, PublishDraftOrigin::New);
        assert!(resolved.blocked_reason.is_none());
    }

    fn repository_fixture() -> Repository {
        Repository {
            id: "repository-A".to_string(),
            name: "Demo".to_string(),
            path: "/tmp/one-publish-source-fixture".to_string(),
            project_file: None,
            current_branch: "main".to_string(),
            branches: Vec::new(),
            is_main: false,
            provider_id: None,
            publish_config: crate::store::RepoPublishConfig::default(),
        }
    }
}
