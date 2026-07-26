use std::collections::{BTreeMap, BTreeSet};

use publish_adapters::{
    execute_plan_in_order, AdapterContract, ExecutionBackend, PlanNodeExecutor,
    AUTOMATION_PROJECTION_CAPABILITY, STRUCTURED_PLAN_EXECUTION_CAPABILITY,
};
use publish_domain::{
    AdapterDescriptor, AdapterKind, AdapterSchema, AdapterSettings, AutomationBindingProjection,
    AutomationBundleFile, AutomationProjectionBundle, AutomationTriggerPolicy, Capability,
    PlanNodeTemplate, PlanningInputSnapshot, PublishError, PublishPlan, PublishingCapability,
};

use crate::tauri_release::TauriReleaseConfig;

pub const GITHUB_ACTIONS_BACKEND_ID: &str = "github-actions";
const BUNDLE_MANIFEST_PATH: &str = ".one-publish/automation/github-actions.json";

pub struct GitHubActionsAutomationBackend {
    descriptor: AdapterDescriptor,
}

impl GitHubActionsAutomationBackend {
    pub fn new() -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ExecutionBackend,
                GITHUB_ACTIONS_BACKEND_ID,
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
        }
    }
}

impl AdapterContract for GitHubActionsAutomationBackend {
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

impl ExecutionBackend for GitHubActionsAutomationBackend {
    fn render_automation_bundle(
        &self,
        bindings: &[AutomationBindingProjection],
    ) -> Result<AutomationProjectionBundle, PublishError> {
        if bindings.is_empty() {
            return Err(PublishError::Execution(
                "GitHub Actions automation projection requires at least one binding".to_string(),
            ));
        }

        let mut files = BTreeMap::new();
        let mut manifest_bindings = BTreeMap::new();
        let mut binding_ids = BTreeSet::new();
        for binding in bindings {
            binding.runtime_revision.validate_for_projection()?;
            if !binding_ids.insert(binding.binding_id.as_str()) {
                return Err(PublishError::Execution(format!(
                    "GitHub Actions automation projection contains duplicate binding identity {}",
                    binding.binding_id
                )));
            }
            let provider_id = binding
                .projection
                .public_settings
                .get("providerId")
                .and_then(serde_json::Value::as_str);
            if provider_id != Some("tauri") {
                return Err(PublishError::Execution(format!(
                    "GitHub Actions workflow projection does not support provider {}",
                    provider_id.unwrap_or("unknown")
                )));
            }

            let release_config = binding
                .projection
                .public_settings
                .get("backendProjection")
                .cloned()
                .ok_or_else(|| {
                    PublishError::Execution(
                        "GitHub Actions binding is missing its fixed projection snapshot"
                            .to_string(),
                    )
                })
                .and_then(|value| {
                    serde_json::from_value::<TauriReleaseConfig>(value).map_err(|error| {
                        PublishError::Execution(format!(
                            "GitHub Actions binding has an invalid projection snapshot: {error}"
                        ))
                    })
                })?;
            let AutomationTriggerPolicy::TagPush { tag_prefix } = &binding.trigger_policy else {
                return Err(PublishError::Execution(
                    "the migrated GitHub Actions workflow requires a tag-push trigger".to_string(),
                ));
            };
            let mut config = release_config;
            let uses_legacy_stable_namespace = tag_prefix == &config.tag_prefix;
            config.tag_prefix = tag_prefix.clone();
            let path = if uses_legacy_stable_namespace {
                crate::tauri_release::MANAGED_WORKFLOW_PATH.to_string()
            } else {
                format!(
                    ".github/workflows/one-publish-{}-release.yml",
                    binding.binding_id
                )
            };
            files.insert(
                path.clone(),
                AutomationBundleFile {
                    content: crate::tauri_release::workflow::render(&config),
                    binding_id: Some(binding.binding_id.clone()),
                },
            );
            let runtime_path = format!(
                ".one-publish/automation/runtime/{}.json",
                binding.binding_id
            );
            files.insert(
                runtime_path.clone(),
                AutomationBundleFile {
                    content: serde_json::to_string_pretty(binding)
                        .map_err(|error| PublishError::Execution(error.to_string()))?
                        + "\n",
                    binding_id: Some(binding.binding_id.clone()),
                },
            );
            manifest_bindings.insert(
                binding.binding_id.clone(),
                serde_json::json!({
                    "configurationId": binding.configuration_id,
                    "configurationRevisionId": binding.configuration_revision_id,
                    "releaseNamespace": binding.release_namespace,
                    "deliveryDestinationNamespaces": binding.delivery_destination_namespaces,
                    "runtimeRevision": binding.runtime_revision.identifier(),
                    "runtime": binding.runtime_revision,
                    "ownedResources": [path, runtime_path],
                }),
            );
        }

        let manifest = serde_json::json!({
            "backend": GITHUB_ACTIONS_BACKEND_ID,
            "bindings": manifest_bindings,
        });
        let content = serde_json::to_string_pretty(&manifest)
            .map_err(|error| PublishError::Execution(error.to_string()))?
            + "\n";
        files.insert(
            BUNDLE_MANIFEST_PATH.to_string(),
            AutomationBundleFile {
                content,
                binding_id: None,
            },
        );

        AutomationProjectionBundle::seal(self.descriptor.identity(), files)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use publish_domain::{
        AdapterIdentity, AutomationProjection, AutomationRuntimeRevision,
        AUTOMATION_PROJECTION_BUNDLE_VERSION,
    };

    fn runtime_revision() -> AutomationRuntimeRevision {
        one_publish_runner::current_runtime_revision([
            GitHubActionsAutomationBackend::new()
                .descriptor()
                .identity(),
            AdapterIdentity::new(AdapterKind::ProjectProvider, "tauri", 1),
        ])
        .expect("seal runtime revision")
    }

    fn binding(id: &str, prefix: &str, revision: &str) -> AutomationBindingProjection {
        let release_config =
            serde_json::to_value(TauriReleaseConfig::default()).expect("serialize release config");
        AutomationBindingProjection {
            binding_id: id.to_string(),
            configuration_id: format!("configuration-{id}"),
            configuration_revision_id: revision.to_string(),
            trigger_policy: AutomationTriggerPolicy::TagPush {
                tag_prefix: prefix.to_string(),
            },
            release_namespace: format!("tag:{prefix}*"),
            delivery_destination_namespaces: vec!["github-release:repository".to_string()],
            runtime_revision: runtime_revision().into(),
            projection: AutomationProjection {
                public_settings: BTreeMap::from([
                    (
                        "providerId".to_string(),
                        serde_json::Value::String("tauri".to_string()),
                    ),
                    ("backendProjection".to_string(), release_config),
                ]),
                protected_variables: BTreeMap::new(),
                secret_references: BTreeMap::new(),
            },
        }
    }

    #[test]
    fn bundle_preserves_the_legacy_stable_path_and_pins_runtime_metadata() {
        let backend = GitHubActionsAutomationBackend::new();
        let bundle = backend
            .render_automation_bundle(&[
                binding("stable", "v", "revision-stable"),
                binding("nightly", "nightly-", "revision-nightly"),
            ])
            .expect("render GitHub Actions bundle");

        assert_eq!(bundle.version, AUTOMATION_PROJECTION_BUNDLE_VERSION);
        bundle.validate().expect("sealed bundle validates");
        let stable = bundle
            .files
            .get(crate::tauri_release::MANAGED_WORKFLOW_PATH)
            .expect("legacy stable workflow path");
        assert_eq!(stable.binding_id.as_deref(), Some("stable"));
        for line in stable
            .content
            .lines()
            .filter(|line| line.trim_start().starts_with("uses:"))
        {
            let sha = line
                .split('@')
                .nth(1)
                .expect("action reference")
                .split_whitespace()
                .next()
                .expect("action sha");
            assert_eq!(sha.len(), 40, "action is not pinned: {line}");
            assert!(sha.chars().all(|character| character.is_ascii_hexdigit()));
        }
        let nightly = bundle
            .files
            .get(".github/workflows/one-publish-nightly-release.yml")
            .expect("nightly binding-owned workflow");
        assert_eq!(nightly.binding_id.as_deref(), Some("nightly"));
        assert!(nightly.content.contains("'nightly-[0-9]*.[0-9]*.[0-9]*'"));

        let manifest = bundle
            .files
            .get(BUNDLE_MANIFEST_PATH)
            .expect("bundle ownership manifest");
        assert_eq!(manifest.binding_id, None);
        assert!(manifest.content.contains("revision-stable"));
        assert!(manifest.content.contains(
            &binding("stable", "v", "revision-stable")
                .runtime_revision
                .identifier()
        ));
        assert!(manifest.content.contains("\"runner\""));
        assert!(manifest.content.contains("github-release:repository"));

        let error = backend
            .render_automation_bundle(&[
                binding("duplicate", "v", "revision-one"),
                binding("duplicate", "nightly-", "revision-two"),
            ])
            .expect_err("duplicate binding identity must be rejected");
        assert!(error.to_string().contains("duplicate binding identity"));
    }

    #[test]
    fn bundle_rejects_missing_or_floating_runtime_revisions() {
        let backend = GitHubActionsAutomationBackend::new();
        for case in ["missing", "floating", "digest-mismatch"] {
            let mut projection = binding("stable", "v", "revision-stable");
            let runtime = match &mut projection.runtime_revision {
                publish_domain::PinnedAutomationRuntimeRevision::Exact(runtime) => runtime,
                publish_domain::PinnedAutomationRuntimeRevision::Legacy(_) => unreachable!(),
            };
            match case {
                "missing" => runtime.runner.digest.clear(),
                "floating" => runtime.runner.version = "latest".to_string(),
                "digest-mismatch" => runtime.digest = "0".repeat(64),
                _ => unreachable!(),
            }
            let error = backend
                .render_automation_bundle(&[projection])
                .expect_err("runtime revision must be exact");
            assert!(
                error.to_string().contains("runtime revision"),
                "unexpected error for {case}: {error}"
            );
        }
    }
}
