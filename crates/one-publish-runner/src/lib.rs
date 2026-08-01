//! 独立 One Publish Runner。
//!
//! 控制面只负责生成封存投影；Runner 只消费投影并复用 `publish-runner-core`
//! 执行，不读取桌面状态，也不重新选择 Adapter。

use std::collections::BTreeSet;
use std::sync::Arc;

use publish_adapters::{
    AdapterConformanceFixture, AdapterRegistry, ChecksumProcessor, CustomCommandProcessor,
    FakeGitHubActionsBackend, GhCliGitHubReleaseApi, GitHubActionsExecutionBackend,
    GitHubReleaseDestination, LocalDirectoryDestination, LocalExecutionBackend,
    OpenSshSftpTransport, SftpDeliveryDestination, StaticCredentialSource,
    TemporaryArtifactStore, CHECKSUM_PROCESSOR_ID, CUSTOM_COMMAND_PROCESSOR_ID,
    FAKE_GITHUB_ACTIONS_BACKEND_ID, GITHUB_ACTIONS_EXECUTION_BACKEND_ID,
    GITHUB_RELEASE_DESTINATION_ID, SFTP_DESTINATION_ID, TAURI_PROVIDER_ID,
};
use publish_domain::{
    AdapterIdentity, AdapterKind, AutomationRuntimeRevision, PlanningInputSnapshot, PublishError,
    PublishOutcome, RuntimeAdapterRevision, RuntimeComponentRevision,
    PLANNING_INPUT_SNAPSHOT_VERSION, PUBLISH_PLAN_VERSION,
};
use publish_runner_core::{PreparedPublishPlan, PublishRuntime};
use serde::{Deserialize, Serialize};

pub const RUNNER_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const RUNNER_SOURCE_DIGEST: &str = env!("ONE_PUBLISH_RUNNER_SOURCE_DIGEST");

/// 分发 tag（决议 #86：同仓独立 `runner-v*` 前缀）。桌面 app 编译期与 runner
/// crate 同源，即"内嵌配套版本"；安装/升级固化时按此 tag 拉取资产摘要。
pub fn runner_release_tag() -> String {
    format!("runner-v{RUNNER_VERSION}")
}
pub const PLAN_CONTRACT_SOURCE_DIGEST: &str = env!("ONE_PUBLISH_PLAN_SOURCE_DIGEST");
pub const ADAPTERS_SOURCE_DIGEST: &str = env!("ONE_PUBLISH_ADAPTERS_SOURCE_DIGEST");

pub fn current_runtime_revision(
    adapters: impl IntoIterator<Item = AdapterIdentity>,
) -> Result<AutomationRuntimeRevision, PublishError> {
    let adapters = built_in_adapter_identities()
        .into_iter()
        .chain(adapters)
        .collect::<BTreeSet<_>>();
    AutomationRuntimeRevision::seal(
        RuntimeComponentRevision::new(RUNNER_VERSION, RUNNER_SOURCE_DIGEST),
        RuntimeComponentRevision::new(
            PUBLISH_PLAN_VERSION.to_string(),
            PLAN_CONTRACT_SOURCE_DIGEST,
        ),
        adapters
            .into_iter()
            .map(|adapter| RuntimeAdapterRevision::new(adapter, ADAPTERS_SOURCE_DIGEST))
            .collect(),
    )
}

fn built_in_adapter_identities() -> BTreeSet<AdapterIdentity> {
    [
        AdapterIdentity::new(AdapterKind::ProjectProvider, TAURI_PROVIDER_ID, 1),
        AdapterIdentity::new(AdapterKind::ArtifactProcessor, CHECKSUM_PROCESSOR_ID, 1),
        AdapterIdentity::new(
            AdapterKind::ArtifactProcessor,
            CUSTOM_COMMAND_PROCESSOR_ID,
            1,
        ),
        AdapterIdentity::new(AdapterKind::ExecutionBackend, "local-execution", 1),
        AdapterIdentity::new(
            AdapterKind::ExecutionBackend,
            GITHUB_ACTIONS_EXECUTION_BACKEND_ID,
            1,
        ),
        AdapterIdentity::new(
            AdapterKind::ExecutionBackend,
            FAKE_GITHUB_ACTIONS_BACKEND_ID,
            1,
        ),
        AdapterIdentity::new(AdapterKind::ArtifactStore, "temporary-artifact-store", 1),
        AdapterIdentity::new(AdapterKind::DeliveryDestination, "local-directory", 1),
    ]
    .into_iter()
    .collect()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RunnerProjection {
    pub runtime_revision: AutomationRuntimeRevision,
    pub prepared: PreparedPublishPlan,
}

pub struct StandaloneRunner {
    runtime: PublishRuntime,
    runtime_revision: AutomationRuntimeRevision,
}

impl StandaloneRunner {
    pub fn new(
        registry: AdapterRegistry,
        runtime_revision: AutomationRuntimeRevision,
    ) -> Result<Self, PublishError> {
        runtime_revision.validate()?;
        Ok(Self {
            runtime: PublishRuntime::new(registry),
            runtime_revision,
        })
    }

    pub fn prepare_projection(
        &self,
        snapshot: &publish_domain::PlanningInputSnapshot,
    ) -> Result<RunnerProjection, PublishError> {
        self.ensure_runtime_identifier(&snapshot.runtime_revision)?;
        Ok(RunnerProjection {
            runtime_revision: self.runtime_revision.clone(),
            prepared: self.runtime.prepare_attempt(snapshot)?,
        })
    }

    pub fn execute(
        &self,
        projection: &RunnerProjection,
        attempt_id: &str,
    ) -> Result<PublishOutcome, PublishError> {
        self.runtime_revision.validate()?;
        projection.runtime_revision.validate()?;
        if projection.runtime_revision != self.runtime_revision {
            return Err(PublishError::InvalidRuntimeRevision(format!(
                "installed projection pins {}, but this runner provides {}",
                projection.runtime_revision.identifier(),
                self.runtime_revision.identifier()
            )));
        }
        self.ensure_runtime_identifier(&projection.prepared.snapshot.runtime_revision)?;
        let prepared = self
            .runtime
            .prepare_attempt(&projection.prepared.snapshot)?;
        if prepared != projection.prepared {
            return Err(PublishError::InvalidPlan(
                "installed runner projection no longer matches its sealed planning input"
                    .to_string(),
            ));
        }
        self.runtime
            .start_prepared(&projection.prepared, attempt_id)
    }

    fn ensure_runtime_identifier(&self, identifier: &str) -> Result<(), PublishError> {
        let expected = self.runtime_revision.identifier();
        if identifier.trim().is_empty() {
            return Err(PublishError::InvalidRuntimeRevision(
                "planning input is missing its pinned runtime revision".to_string(),
            ));
        }
        if identifier != expected {
            return Err(PublishError::InvalidRuntimeRevision(format!(
                "planning input pins {identifier}, but this runner provides {expected}"
            )));
        }
        Ok(())
    }
}

pub fn validate_projection(projection: &RunnerProjection) -> Result<(), PublishError> {
    projection.runtime_revision.validate()?;
    let expected = projection.runtime_revision.identifier();
    if projection.prepared.snapshot.runtime_revision != expected {
        return Err(PublishError::InvalidRuntimeRevision(format!(
            "sealed planning input pins {}, but projection provides {expected}",
            projection.prepared.snapshot.runtime_revision
        )));
    }
    if projection.prepared.snapshot.version != PLANNING_INPUT_SNAPSHOT_VERSION {
        return Err(PublishError::UnsupportedSnapshotVersion {
            actual: projection.prepared.snapshot.version,
            expected: PLANNING_INPUT_SNAPSHOT_VERSION,
        });
    }
    let snapshot_digest = projection.prepared.snapshot.digest()?;
    if projection.prepared.plan.snapshot_digest != snapshot_digest {
        return Err(PublishError::InvalidPlan(
            "sealed plan does not reference the installed planning input".to_string(),
        ));
    }
    if projection.prepared.plan.version != PUBLISH_PLAN_VERSION {
        return Err(PublishError::UnsupportedPlanVersion {
            actual: projection.prepared.plan.version,
            expected: PUBLISH_PLAN_VERSION,
        });
    }
    let plan_digest = projection.prepared.plan.recomputed_digest()?;
    if projection.prepared.plan.digest != plan_digest {
        return Err(PublishError::PlanDigestMismatch {
            expected: projection.prepared.plan.digest.clone(),
            actual: plan_digest,
        });
    }
    Ok(())
}

pub fn installed_runner(projection: &RunnerProjection) -> Result<StandaloneRunner, PublishError> {
    validate_projection(projection)?;
    let installed_revision = current_runtime_revision(
        projection
            .prepared
            .snapshot
            .adapters
            .ordered_bindings()
            .into_iter()
            .map(|binding| binding.adapter.clone()),
    )?;
    if projection.runtime_revision != installed_revision {
        return Err(PublishError::InvalidRuntimeRevision(format!(
            "projection pins {}, but the installed runner provides {}",
            projection.runtime_revision.identifier(),
            installed_revision.identifier()
        )));
    }
    let registry = installed_registry(&projection.prepared.snapshot, RunnerPorts::default())?;
    StandaloneRunner::new(registry, installed_revision)
}

/// 环境注入集合（决议 #80）：桌面注入 Tauri 执行端口，headless 环境用缺省
/// （无端口，构建节点显式失败直至默认直执行实现落地）。
#[derive(Default)]
pub struct RunnerPorts {
    pub provider_execution: Option<publish_adapters::ProviderExecution>,
}

pub fn installed_registry(
    snapshot: &PlanningInputSnapshot,
    mut ports: RunnerPorts,
) -> Result<AdapterRegistry, PublishError> {
    let fixture = AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = AdapterRegistry::new();

    register_project_provider(&mut registry, &fixture, snapshot, &mut ports)?;
    register_processors(&mut registry, &fixture, snapshot)?;
    register_execution_backend(&mut registry, &fixture, snapshot)?;
    register_artifact_store(&mut registry, &fixture, snapshot)?;
    register_destinations(&mut registry, &fixture, snapshot)?;

    Ok(registry)
}

fn register_project_provider(
    registry: &mut AdapterRegistry,
    fixture: &AdapterConformanceFixture,
    snapshot: &PlanningInputSnapshot,
    ports: &mut RunnerPorts,
) -> Result<(), PublishError> {
    let binding = &snapshot.adapters.project_provider;
    let identity = &binding.adapter;
    let setting = |key: &str| {
        binding
            .settings
            .values
            .get(key)
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| PublishError::InvalidAdapterSettings {
                adapter: identity.display_name(),
                message: format!("{key} is required"),
            })
    };
    match (identity.id.as_str(), identity.version) {
        (TAURI_PROVIDER_ID, 1) => {
            // 仓库根只在节点执行时消费；无桌面准备上下文的校验快照不携带。
            let repository_root = snapshot
                .release_input
                .get("repository_path")
                .and_then(serde_json::Value::as_str)
                .unwrap_or(".");
            registry.register_project_provider(
                Arc::new(publish_adapters::TauriRuntimeProvider::new(
                    setting("config_path")?,
                    setting("build_driver")?,
                    std::path::PathBuf::from(repository_root),
                    ports.provider_execution.take(),
                )),
                fixture,
            )
        }
        (publish_adapters::SELECTED_PROVIDER_ID, 1) => registry.register_project_provider(
            Arc::new(publish_adapters::SelectedProjectProvider::with_execution(
                setting("spec_json")?,
                ports.provider_execution.take(),
            )),
            fixture,
        ),
        _ => Err(unsupported_installed_adapter(identity)),
    }
}

fn register_processors(
    registry: &mut AdapterRegistry,
    fixture: &AdapterConformanceFixture,
    snapshot: &PlanningInputSnapshot,
) -> Result<(), PublishError> {
    for binding in &snapshot.adapters.artifact_processors {
        match (binding.adapter.id.as_str(), binding.adapter.version) {
            (CHECKSUM_PROCESSOR_ID, 1) => {
                registry.register_artifact_processor(Arc::new(ChecksumProcessor::new()), fixture)?
            }
            (CUSTOM_COMMAND_PROCESSOR_ID, 1) => {
                let programs = binding
                    .settings
                    .values
                    .get("program")
                    .and_then(serde_json::Value::as_str)
                    .into_iter();
                registry.register_artifact_processor(
                    Arc::new(CustomCommandProcessor::new(programs)),
                    fixture,
                )?;
            }
            _ => return Err(unsupported_installed_adapter(&binding.adapter)),
        }
    }
    Ok(())
}

fn register_execution_backend(
    registry: &mut AdapterRegistry,
    fixture: &AdapterConformanceFixture,
    snapshot: &PlanningInputSnapshot,
) -> Result<(), PublishError> {
    let identity = &snapshot.adapters.execution_backend.adapter;
    let credentials = Arc::new(StaticCredentialSource::new());
    match (identity.id.as_str(), identity.version) {
        ("local-execution", 1) => {
            registry.register_execution_backend(Arc::new(LocalExecutionBackend::new()), fixture)
        }
        (GITHUB_ACTIONS_EXECUTION_BACKEND_ID, 1) => registry.register_execution_backend(
            Arc::new(GitHubActionsExecutionBackend::new(credentials)),
            fixture,
        ),
        (FAKE_GITHUB_ACTIONS_BACKEND_ID, 1) => registry.register_execution_backend(
            Arc::new(FakeGitHubActionsBackend::new(credentials)),
            fixture,
        ),
        _ => Err(unsupported_installed_adapter(identity)),
    }
}

fn register_artifact_store(
    registry: &mut AdapterRegistry,
    fixture: &AdapterConformanceFixture,
    snapshot: &PlanningInputSnapshot,
) -> Result<(), PublishError> {
    let binding = &snapshot.adapters.artifact_store;
    match (binding.adapter.id.as_str(), binding.adapter.version) {
        ("temporary-artifact-store", 1) => {
            let root = binding
                .settings
                .values
                .get("root_directory")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| PublishError::InvalidAdapterSettings {
                    adapter: binding.adapter.display_name(),
                    message: "root_directory is required".to_string(),
                })?;
            registry.register_artifact_store(Arc::new(TemporaryArtifactStore::new(root)), fixture)
        }
        _ => Err(unsupported_installed_adapter(&binding.adapter)),
    }
}

fn register_destinations(
    registry: &mut AdapterRegistry,
    fixture: &AdapterConformanceFixture,
    snapshot: &PlanningInputSnapshot,
) -> Result<(), PublishError> {
    for route in &snapshot.adapters.delivery_routes {
        let binding = &route.binding;
        match (binding.adapter.id.as_str(), binding.adapter.version) {
            ("local-directory", 1) => {
                let directory = binding
                    .settings
                    .values
                    .get("directory")
                    .and_then(serde_json::Value::as_str)
                    .ok_or_else(|| PublishError::InvalidAdapterSettings {
                        adapter: binding.adapter.display_name(),
                        message: "directory is required".to_string(),
                    })?;
                registry.register_delivery_destination(
                    Arc::new(LocalDirectoryDestination::new(directory)),
                    fixture,
                )?;
            }
            (GITHUB_RELEASE_DESTINATION_ID, 1) => {
                registry.register_delivery_destination(
                    Arc::new(GitHubReleaseDestination::new(Arc::new(
                        GhCliGitHubReleaseApi::new(),
                    ))),
                    fixture,
                )?;
            }
            (SFTP_DESTINATION_ID, 1) => {
                registry.register_delivery_destination(
                    Arc::new(SftpDeliveryDestination::new(Arc::new(
                        OpenSshSftpTransport::new(),
                    ))),
                    fixture,
                )?;
            }
            _ => return Err(unsupported_installed_adapter(&binding.adapter)),
        }
    }
    Ok(())
}

fn unsupported_installed_adapter(identity: &AdapterIdentity) -> PublishError {
    PublishError::AdapterNotRegistered {
        kind: identity.kind,
        id: identity.id.clone(),
        version: identity.version,
    }
}

#[cfg(test)]
mod runtime_revision_tests {
    use std::collections::BTreeMap;

    use publish_domain::AutomationRuntimeRevision;

    use super::{current_runtime_revision, runner_release_tag, RUNNER_VERSION};

    #[test]
    fn release_tag_embeds_the_companion_runner_version() {
        assert_eq!(runner_release_tag(), format!("runner-v{RUNNER_VERSION}"));
    }

    #[test]
    fn binary_digest_table_changes_the_sealed_runtime_identity() {
        let sealed = current_runtime_revision([]).expect("seal current runtime revision");
        // 空表与旧格式同一身份：序列化跳过空表，seal 摘要不变。
        let serialized = serde_json::to_value(&sealed.runner).expect("serialize runner component");
        assert!(serialized.get("binary_digests").is_none());

        let pinned = AutomationRuntimeRevision::seal(
            sealed.runner.clone().with_binary_digests(BTreeMap::from([(
                "x86_64-unknown-linux-gnu".to_string(),
                "a".repeat(64),
            )])),
            sealed.plan_contract.clone(),
            sealed.adapters.clone(),
        )
        .expect("seal runtime revision with binary digests");
        assert_ne!(pinned.identifier(), sealed.identifier());
        pinned.validate().expect("pinned revision stays verifiable");
    }

    #[test]
    fn malformed_binary_digests_are_rejected_at_seal_time() {
        let sealed = current_runtime_revision([]).expect("seal current runtime revision");
        let error = AutomationRuntimeRevision::seal(
            sealed.runner.clone().with_binary_digests(BTreeMap::from([(
                "x86_64-unknown-linux-gnu".to_string(),
                "not-a-digest".to_string(),
            )])),
            sealed.plan_contract.clone(),
            sealed.adapters.clone(),
        )
        .expect_err("floating or malformed binary digests must be rejected");
        assert!(error.to_string().contains("SHA-256"));
    }
}
