use std::collections::BTreeMap;

use publish_domain::{
    AdapterDescriptor, AdapterKind, AdapterSchema, AdapterSettings, AutomationBindingProjection,
    AutomationBundleFile, AutomationProjectionBundle, Capability, PlanNodeTemplate,
    PlanningInputSnapshot, PublishError, PublishingCapability,
};

use crate::{AdapterContract, ExecutionBackend, AUTOMATION_PROJECTION_CAPABILITY};

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
        if bindings.is_empty() {
            return Err(PublishError::Execution(
                "automation projection bundles require at least one binding".to_string(),
            ));
        }

        let mut files = BTreeMap::new();
        let mut owned_paths_by_binding = BTreeMap::new();
        for binding in bindings {
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
            "backend": FAKE_AUTOMATION_BACKEND_ID,
            "bindings": owned_paths_by_binding,
        });
        files.insert(
            format!("{BUNDLE_ROOT}/bundle.json"),
            AutomationBundleFile {
                content: serialize_pretty(&manifest)?,
                binding_id: None,
            },
        );

        AutomationProjectionBundle::seal(self.descriptor.identity(), files)
    }
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
