use std::sync::Arc;

use publish_domain::{
    AdapterDescriptor, AdapterKind, AdapterSchema, AdapterSettings, Capability, PlanNodeTemplate,
    PlanningInputSnapshot, PublishError, PublishPlan, PublishingCapability, ResolvedCredential,
};

use crate::{
    execute_plan_in_order, AdapterContract, CredentialResolveFailure, CredentialSource,
    ExecutionBackend, PlanNodeExecutor, STRUCTURED_PLAN_EXECUTION_CAPABILITY,
};

pub const GITHUB_ACTIONS_EXECUTION_BACKEND_ID: &str = "github-actions";

/// Runner 进程内的 GitHub Actions 执行环境。它只提供拓扑和凭据解析，
/// Publish Plan 的业务语义仍由共享 Runner 与各 Adapter 解释。
pub struct GitHubActionsExecutionBackend {
    descriptor: AdapterDescriptor,
    credential_source: Arc<dyn CredentialSource>,
}

impl GitHubActionsExecutionBackend {
    pub fn new(credential_source: Arc<dyn CredentialSource>) -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ExecutionBackend,
                GITHUB_ACTIONS_EXECUTION_BACKEND_ID,
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

impl AdapterContract for GitHubActionsExecutionBackend {
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
        Ok(Vec::new())
    }

    fn execute_plan(
        &self,
        plan: &PublishPlan,
        executor: &mut dyn PlanNodeExecutor,
    ) -> Result<(), PublishError> {
        execute_plan_in_order(plan, executor)
    }
}

impl ExecutionBackend for GitHubActionsExecutionBackend {
    fn resolve_credential(
        &self,
        reference: &str,
    ) -> Result<ResolvedCredential, CredentialResolveFailure> {
        self.credential_source.resolve(reference)
    }
}
