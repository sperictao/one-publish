//! prepare-from-projection：触发时现场规划（决议 #87）。
//!
//! 模板投影携带修订固化的静态规划输入；此处只补全触发事实——tag 推导版本、
//! 干净 checkout 的源快照与 runner 运行时目录——随后经共享 planner 密封为
//! PreparedAttempt，Attempt 身份（snapshot/plan 摘要）由此在触发时形成。
//! 同一触发上下文（同一 tag、同一提交）重放必须产出相同摘要，因此源快照
//! 时间取 HEAD committer 时间而非墙钟，运行时目录用固定相对路径。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use publish_domain::{
    AutomationTriggerPolicy, PlanningInputSnapshot, PublishError, SourceSnapshot,
    PLANNING_INPUT_SNAPSHOT_VERSION,
};
use serde_json::Value;

use crate::{
    installed_registry, verify_installed_projection, PreparedAttempt, RunnerPorts,
    RunnerProjection, StandaloneRunner,
};

/// 触发上下文：checkout 根与触发输入。触发形态必须与安装投影的触发策略
/// 匹配——tag 推送提供完整 tag 名，手动 dispatch 提供显式版本（决议 #89）。
#[derive(Debug, Clone)]
pub struct TriggerContext {
    pub repository_root: PathBuf,
    pub trigger: TriggerInput,
}

#[derive(Debug, Clone)]
pub enum TriggerInput {
    Tag(String),
    Manual { version: String },
}

/// Runner 运行时目录：与桌面 prepare 的组合缺省补全同构——桌面注入桌面
/// 事实（绝对存储根、本地交付目录），runner 注入 checkout 内的固定相对路径。
const RUNNER_STORE_DIRECTORY: &str = ".one-publish-work/store";
const RUNNER_DELIVERY_DIRECTORY: &str = ".one-publish-work/delivery";
const RUNNER_ARTIFACT_RETENTION_SECONDS: u64 = 604_800;

pub fn prepare_from_projection(
    projection: &RunnerProjection,
    context: &TriggerContext,
) -> Result<PreparedAttempt, PublishError> {
    verify_installed_projection(projection)?;
    let version = trigger_version(&projection.trigger_policy, context)?;
    let source = capture_clean_source(&context.repository_root)?;

    let mut release_input = projection.release_input.clone();
    release_input.insert("version".to_string(), Value::String(version));

    let mut adapters = projection.adapters.clone();
    if adapters.artifact_store.adapter.id == "temporary-artifact-store" {
        adapters
            .artifact_store
            .settings
            .values
            .entry("root_directory".to_string())
            .or_insert_with(|| Value::String(RUNNER_STORE_DIRECTORY.to_string()));
        adapters
            .artifact_store
            .settings
            .values
            .entry("retention_seconds".to_string())
            .or_insert_with(|| Value::from(RUNNER_ARTIFACT_RETENTION_SECONDS));
    }
    for route in &mut adapters.delivery_routes {
        if route.binding.adapter.id == publish_adapters::LOCAL_DESTINATION_ID {
            route
                .binding
                .settings
                .values
                .entry("directory".to_string())
                .or_insert_with(|| Value::String(RUNNER_DELIVERY_DIRECTORY.to_string()));
        }
    }

    let snapshot = PlanningInputSnapshot {
        version: PLANNING_INPUT_SNAPSHOT_VERSION,
        configuration_revision: projection.configuration_revision_id.clone(),
        runtime_revision: projection.runtime_revision.identifier(),
        release_input,
        source,
        external_preconditions: BTreeMap::new(),
        promoted_manifest_digest: None,
        adapters,
    };
    let registry = installed_registry(
        &snapshot,
        RunnerPorts::default(),
        &projection.secret_bindings,
    )?;
    let mut attempt = StandaloneRunner::new(registry, projection.runtime_revision.clone())?
        .prepare_attempt(&snapshot)?;
    attempt.secret_bindings = projection.secret_bindings.clone();
    Ok(attempt)
}

fn trigger_version(
    policy: &AutomationTriggerPolicy,
    context: &TriggerContext,
) -> Result<String, PublishError> {
    match (policy, &context.trigger) {
        (AutomationTriggerPolicy::TagPush { tag_prefix }, TriggerInput::Tag(tag)) => {
            let tag = tag.trim();
            if tag.is_empty() {
                return Err(PublishError::Execution(
                    "tag-push planning requires the pushed tag name".to_string(),
                ));
            }
            let version = tag.strip_prefix(tag_prefix.as_str()).ok_or_else(|| {
                PublishError::Execution(format!(
                    "tag {tag} does not match the bound tag prefix {tag_prefix}"
                ))
            })?;
            if version.trim().is_empty() {
                return Err(PublishError::Execution(format!(
                    "tag {tag} carries no version after the bound tag prefix {tag_prefix}"
                )));
            }
            Ok(version.to_string())
        }
        (AutomationTriggerPolicy::Manual, TriggerInput::Manual { version }) => {
            let version = version.trim();
            if version.is_empty() {
                return Err(PublishError::Execution(
                    "manual dispatch planning requires an explicit version input".to_string(),
                ));
            }
            Ok(version.to_string())
        }
        (AutomationTriggerPolicy::TagPush { .. }, TriggerInput::Manual { .. }) => {
            Err(PublishError::Execution(
                "a tag-push binding cannot plan from a manual dispatch input".to_string(),
            ))
        }
        (AutomationTriggerPolicy::Manual, TriggerInput::Tag(_)) => Err(PublishError::Execution(
            "a manual binding cannot plan from a pushed tag".to_string(),
        )),
    }
}

/// 触发时源快照：远端规划要求干净 checkout，快照引用不可变 VCS revision，
/// 时间取自提交对象（committer 时间）保证重放摘要稳定。
fn capture_clean_source(repository_root: &Path) -> Result<SourceSnapshot, PublishError> {
    let revision = git(repository_root, &["rev-parse", "--verify", "HEAD"])?;
    if revision.is_empty() {
        return Err(PublishError::Execution(
            "git returned an empty HEAD revision".to_string(),
        ));
    }
    let status = git(repository_root, &["status", "--porcelain=v1"])?;
    if !status.is_empty() {
        return Err(PublishError::Execution(format!(
            "on-site planning requires a clean checkout:\n{status}"
        )));
    }
    let captured_at = git(repository_root, &["show", "-s", "--format=%cI", "HEAD"])?;
    Ok(SourceSnapshot {
        revision,
        workspace_digest: None,
        dirty: false,
        captured_at,
        reproducible: true,
    })
}

fn git(repository_root: &Path, args: &[&str]) -> Result<String, PublishError> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repository_root)
        .args(args)
        .output()
        .map_err(|error| {
            PublishError::Execution(format!("failed to run git {}: {error}", args.join(" ")))
        })?;
    if !output.status.success() {
        return Err(PublishError::Execution(format!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
