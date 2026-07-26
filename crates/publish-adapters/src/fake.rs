use std::collections::BTreeMap;
use std::sync::Arc;

use publish_domain::{
    AdapterDescriptor, AdapterKind, AdapterSchema, AdapterSettings, AutomationBindingProjection,
    AutomationBundleFile, AutomationProjectionBundle, Capability, PlanNodeTemplate,
    PlanningInputSnapshot, PublishError, PublishPlan, PublishingCapability, ResolvedCredential,
};

use crate::{
    execute_plan_in_order, AdapterContract, CredentialResolveFailure, CredentialSource,
    ExecutionBackend, PlanNodeExecutor, AUTOMATION_PROJECTION_CAPABILITY,
    STRUCTURED_PLAN_EXECUTION_CAPABILITY,
};

pub const FAKE_AUTOMATION_BACKEND_ID: &str = "fake-automation";
const BUNDLE_ROOT: &str = "one-publish/automation";

/// 纵向验证用执行后端：只提供自动化投影渲染，不执行发布计划。
pub struct FakeAutomationBackend {
    descriptor: AdapterDescriptor,
}

impl FakeAutomationBackend {
    pub fn new() -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ExecutionBackend,
                FAKE_AUTOMATION_BACKEND_ID,
                1,
                AdapterSchema::new(1),
                PublishingCapability {
                    provides: vec![Capability::new(AUTOMATION_PROJECTION_CAPABILITY, 1)],
                    requires: vec![],
                },
            ),
        }
    }
}

impl Default for FakeAutomationBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl AdapterContract for FakeAutomationBackend {
    fn descriptor(&self) -> &AdapterDescriptor {
        &self.descriptor
    }

    fn default_settings(&self) -> AdapterSettings {
        AdapterSettings::new(1)
    }

    fn plan_fragment(
        &self,
        _snapshot: &PlanningInputSnapshot,
        _settings: &AdapterSettings,
    ) -> Result<Vec<PlanNodeTemplate>, PublishError> {
        Ok(vec![])
    }
}

impl ExecutionBackend for FakeAutomationBackend {
    fn render_automation_bundle(
        &self,
        bindings: &[AutomationBindingProjection],
    ) -> Result<AutomationProjectionBundle, PublishError> {
        render_fake_bundle(self.descriptor.identity(), bindings)
    }
}

pub const FAKE_REMOTE_BACKEND_ID: &str = "fake-remote";

/// 纵向验证用远端执行后端：模拟远端环境按顺序执行封存计划，
/// 并从自己的 Secret Store（例如受保护变量映射）解析凭据引用，
/// 用于证明与本地后端等价的解析合同（ADR-0029、Issue T08）。
pub struct FakeRemoteBackend {
    descriptor: AdapterDescriptor,
    credential_source: Arc<dyn CredentialSource>,
}

impl FakeRemoteBackend {
    pub fn new(credential_source: Arc<dyn CredentialSource>) -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ExecutionBackend,
                FAKE_REMOTE_BACKEND_ID,
                1,
                AdapterSchema::new(1),
                PublishingCapability {
                    provides: vec![Capability::new(STRUCTURED_PLAN_EXECUTION_CAPABILITY, 1)],
                    requires: vec![],
                },
            ),
            credential_source,
        }
    }
}

impl AdapterContract for FakeRemoteBackend {
    fn descriptor(&self) -> &AdapterDescriptor {
        &self.descriptor
    }

    fn default_settings(&self) -> AdapterSettings {
        AdapterSettings::new(1)
    }

    fn plan_fragment(
        &self,
        _snapshot: &PlanningInputSnapshot,
        _settings: &AdapterSettings,
    ) -> Result<Vec<PlanNodeTemplate>, PublishError> {
        Ok(vec![])
    }

    fn execute_plan(
        &self,
        plan: &PublishPlan,
        executor: &mut dyn PlanNodeExecutor,
    ) -> Result<(), PublishError> {
        execute_plan_in_order(plan, executor)
    }
}

impl ExecutionBackend for FakeRemoteBackend {
    fn resolve_credential(
        &self,
        reference: &str,
    ) -> Result<ResolvedCredential, CredentialResolveFailure> {
        self.credential_source.resolve(reference)
    }
}

pub const FAKE_GITHUB_ACTIONS_BACKEND_ID: &str = "fake-github-actions";

/// GitHub Actions 合同替身：像真实后端一样同时渲染自治投影并通过共享 Runner
/// 顺序解释 Publish Plan，不复制任何 Provider 或 Destination 业务逻辑。
pub struct FakeGitHubActionsBackend {
    descriptor: AdapterDescriptor,
    credential_source: Arc<dyn CredentialSource>,
}

impl FakeGitHubActionsBackend {
    pub fn new(credential_source: Arc<dyn CredentialSource>) -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ExecutionBackend,
                FAKE_GITHUB_ACTIONS_BACKEND_ID,
                1,
                AdapterSchema::new(1),
                PublishingCapability {
                    provides: vec![
                        Capability::new(AUTOMATION_PROJECTION_CAPABILITY, 1),
                        Capability::new(STRUCTURED_PLAN_EXECUTION_CAPABILITY, 1),
                    ],
                    requires: vec![],
                },
            ),
            credential_source,
        }
    }
}

impl AdapterContract for FakeGitHubActionsBackend {
    fn descriptor(&self) -> &AdapterDescriptor {
        &self.descriptor
    }

    fn default_settings(&self) -> AdapterSettings {
        AdapterSettings::new(1)
    }

    fn plan_fragment(
        &self,
        _snapshot: &PlanningInputSnapshot,
        _settings: &AdapterSettings,
    ) -> Result<Vec<PlanNodeTemplate>, PublishError> {
        Ok(vec![])
    }

    fn execute_plan(
        &self,
        plan: &PublishPlan,
        executor: &mut dyn PlanNodeExecutor,
    ) -> Result<(), PublishError> {
        execute_plan_in_order(plan, executor)
    }
}

impl ExecutionBackend for FakeGitHubActionsBackend {
    fn resolve_credential(
        &self,
        reference: &str,
    ) -> Result<ResolvedCredential, CredentialResolveFailure> {
        self.credential_source.resolve(reference)
    }

    fn render_automation_bundle(
        &self,
        bindings: &[AutomationBindingProjection],
    ) -> Result<AutomationProjectionBundle, PublishError> {
        render_fake_bundle(self.descriptor.identity(), bindings)
    }
}

fn render_fake_bundle(
    backend: publish_domain::AdapterIdentity,
    bindings: &[AutomationBindingProjection],
) -> Result<AutomationProjectionBundle, PublishError> {
    if bindings.is_empty() {
        return Err(PublishError::Execution(
            "automation projection bundles require at least one binding".to_string(),
        ));
    }

    let mut files = BTreeMap::new();
    let mut owned_paths_by_binding = BTreeMap::new();
    for binding in bindings {
        binding.runtime_revision.validate_for_projection()?;
        let path = format!("{BUNDLE_ROOT}/{}.json", binding.binding_id);
        let content = serialize_projection(binding)?;
        if files
            .insert(
                path.clone(),
                AutomationBundleFile {
                    content,
                    binding_id: Some(binding.binding_id.clone()),
                },
            )
            .is_some()
        {
            return Err(PublishError::Execution(format!(
                "automation binding {} is projected more than once",
                binding.binding_id
            )));
        }
        owned_paths_by_binding.insert(binding.binding_id.clone(), vec![path]);
    }

    let manifest = serde_json::json!({
        "backend": backend.id,
        "bindings": owned_paths_by_binding,
    });
    files.insert(
        format!("{BUNDLE_ROOT}/bundle.json"),
        AutomationBundleFile {
            content: serialize_pretty(&manifest)?,
            binding_id: None,
        },
    );

    AutomationProjectionBundle::seal(backend, files)
}

fn serialize_projection(binding: &AutomationBindingProjection) -> Result<String, PublishError> {
    let value = serde_json::to_value(binding).map_err(|error| {
        PublishError::Execution(format!(
            "cannot serialize automation binding projection {}: {error}",
            binding.binding_id
        ))
    })?;
    serialize_pretty(&value)
}

fn serialize_pretty(value: &serde_json::Value) -> Result<String, PublishError> {
    serde_json::to_string_pretty(value)
        .map(|content| format!("{content}\n"))
        .map_err(|error| {
            PublishError::Execution(format!("cannot serialize automation bundle file: {error}"))
        })
}
