//! 独立 One Publish Runner。
//!
//! 控制面只负责生成封存投影；Runner 只消费投影并复用 `publish-runner-core`
//! 执行，不读取桌面状态，也不重新选择 Adapter。

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

mod prepare;
mod staging;
pub use prepare::{prepare_from_projection, TriggerContext, TriggerInput};
pub use staging::{load_staged_artifacts, stage_shard_artifacts, SHARD_STAGING_DIRECTORY};

use publish_adapters::{
    AdapterConformanceFixture, AdapterRegistry, ChecksumProcessor, CustomCommandProcessor,
    FakeGitHubActionsBackend, GhCliGitHubReleaseApi, GitHubActionsBackend,
    GitHubReleaseDestination, LocalDirectoryDestination, LocalExecutionBackend,
    OpenSshSftpTransport, SftpDeliveryDestination, StaticCredentialSource,
    TemporaryArtifactStore, CHECKSUM_PROCESSOR_ID, CUSTOM_COMMAND_PROCESSOR_ID,
    FAKE_GITHUB_ACTIONS_BACKEND_ID, GITHUB_ACTIONS_BACKEND_ID,
    GITHUB_RELEASE_DESTINATION_ID, SFTP_DESTINATION_ID, TAURI_PROVIDER_ID,
};
use publish_domain::{
    AdapterIdentity, AdapterKind, AdapterSelection, AutomationRuntimeRevision,
    AutomationTriggerPolicy, PlanningInputSnapshot, PublishError, PublishOutcome,
    RuntimeAdapterRevision, RuntimeComponentRevision, PLANNING_INPUT_SNAPSHOT_VERSION,
    PUBLISH_PLAN_VERSION,
};
use publish_runner_core::{PreparedPublishPlan, PublishRuntime};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const RUNNER_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const RUNNER_SOURCE_DIGEST: &str = env!("ONE_PUBLISH_RUNNER_SOURCE_DIGEST");

/// 分发 tag（决议 #86：同仓独立 `runner-v*` 前缀）。桌面 app 编译期与 runner
/// crate 同源，即"内嵌配套版本"；安装/升级固化时按此 tag 拉取资产摘要。
pub fn runner_release_tag() -> String {
    format!("runner-v{RUNNER_VERSION}")
}

/// 分发仓库（决议 #86：runner 二进制随主仓库 Release 发布）。
pub const RUNNER_DISTRIBUTION_REPOSITORY: &str = "sperictao/one-publish";

pub const PLAN_CONTRACT_SOURCE_DIGEST: &str = env!("ONE_PUBLISH_PLAN_SOURCE_DIGEST");
pub const ADAPTERS_SOURCE_DIGEST: &str = env!("ONE_PUBLISH_ADAPTERS_SOURCE_DIGEST");

pub fn current_runtime_revision(
    adapters: impl IntoIterator<Item = AdapterIdentity>,
) -> Result<AutomationRuntimeRevision, PublishError> {
    current_runtime_revision_with_binary_digests(adapters, BTreeMap::new())
}

/// 带分发资产摘要的封存（决议 #86）：控制面固化时经 REST 拉取 per-target
/// 摘要后钉入 runner 组件；本机自证与离线检测用无摘要归一形态。
pub fn current_runtime_revision_with_binary_digests(
    adapters: impl IntoIterator<Item = AdapterIdentity>,
    binary_digests: BTreeMap<String, String>,
) -> Result<AutomationRuntimeRevision, PublishError> {
    let adapters = built_in_adapter_identities()
        .into_iter()
        .chain(adapters)
        .collect::<BTreeSet<_>>();
    AutomationRuntimeRevision::seal(
        RuntimeComponentRevision::new(RUNNER_VERSION, RUNNER_SOURCE_DIGEST)
            .with_binary_digests(binary_digests),
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
            GITHUB_ACTIONS_BACKEND_ID,
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

pub const RUNNER_PROJECTION_VERSION: u32 = 1;

/// 安装进仓库的规划输入模板（决议 #87）：携带修订固化的静态规划输入、物化
/// Adapter 选择、Runtime Revision 与凭据引用→Secret 名映射表。刻意不携带
/// 密封计划——触发事实（版本、源快照、运行时目录）由 runner 现场补全后
/// 规划，Attempt 身份（snapshot/plan 摘要）在触发时形成。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RunnerProjection {
    pub version: u32,
    pub binding_id: String,
    pub configuration_id: String,
    pub configuration_revision_id: String,
    pub trigger_policy: AutomationTriggerPolicy,
    pub runtime_revision: AutomationRuntimeRevision,
    /// 修订固化的静态规划输入；触发事实由 prepare-from-projection 补全。
    pub release_input: BTreeMap<String, Value>,
    /// 物化的 Adapter 选择；桌面运行时缺省键（存储根、本地交付目录）不携带。
    pub adapters: AdapterSelection,
    /// 凭据引用 → 执行环境 Secret 名的公开映射表（名字非秘密，ADR-0029）。
    pub secret_bindings: BTreeMap<String, String>,
}

/// prepare-from-projection 的密封产物：触发时形成的完整规划输入与计划；
/// execute 消费前重放规划并逐字比对。凭据引用→Secret 名映射表随之携带
/// （名字非秘密），执行边界据此从 env 解析凭据（决议 #87 / ADR-0029）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PreparedAttempt {
    pub runtime_revision: AutomationRuntimeRevision,
    pub prepared: PreparedPublishPlan,
    pub secret_bindings: BTreeMap<String, String>,
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

    pub fn prepare_attempt(
        &self,
        snapshot: &publish_domain::PlanningInputSnapshot,
    ) -> Result<PreparedAttempt, PublishError> {
        self.ensure_runtime_identifier(&snapshot.runtime_revision)?;
        Ok(PreparedAttempt {
            runtime_revision: self.runtime_revision.clone(),
            prepared: self.runtime.prepare_attempt(snapshot)?,
            secret_bindings: BTreeMap::new(),
        })
    }

    pub fn execute(
        &self,
        attempt: &PreparedAttempt,
        attempt_id: &str,
    ) -> Result<PublishOutcome, PublishError> {
        self.ensure_serviceable_attempt(attempt)?;
        let prepared = self.runtime.prepare_attempt(&attempt.prepared.snapshot)?;
        if prepared != attempt.prepared {
            return Err(PublishError::InvalidPlan(
                "prepared attempt no longer matches its sealed planning input".to_string(),
            ));
        }
        self.runtime.start_prepared(&attempt.prepared, attempt_id)
    }

    /// 分片执行（决议 #85）：只执行分配给指定平台亲和的节点子集，输出本段
    /// 自足证据（事件流 + 汇聚段的 Manifest，决议 #88 的传输单元）。
    pub fn execute_shard(
        &self,
        attempt: &PreparedAttempt,
        attempt_id: &str,
        platform: publish_domain::PlanNodePlatform,
        staged_artifacts: Vec<publish_domain::ArtifactCandidate>,
    ) -> Result<publish_runner_core::ShardOutcome, PublishError> {
        self.ensure_serviceable_attempt(attempt)?;
        self.runtime
            .start_prepared_shard(&attempt.prepared, attempt_id, platform, staged_artifacts)
    }

    fn ensure_serviceable_attempt(&self, attempt: &PreparedAttempt) -> Result<(), PublishError> {
        self.runtime_revision.validate()?;
        attempt.runtime_revision.validate()?;
        if attempt.runtime_revision != self.runtime_revision {
            return Err(PublishError::InvalidRuntimeRevision(format!(
                "prepared attempt pins {}, but this runner provides {}",
                attempt.runtime_revision.identifier(),
                self.runtime_revision.identifier()
            )));
        }
        self.ensure_runtime_identifier(&attempt.prepared.snapshot.runtime_revision)
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

/// 模板投影的结构校验：版本受支持、绑定身份齐全、Runtime Revision 封存自洽。
pub fn validate_projection(projection: &RunnerProjection) -> Result<(), PublishError> {
    if projection.version != RUNNER_PROJECTION_VERSION {
        return Err(PublishError::InvalidPlan(format!(
            "runner projection version {} is not supported, expected {RUNNER_PROJECTION_VERSION}",
            projection.version
        )));
    }
    for (name, value) in [
        ("binding", &projection.binding_id),
        ("configuration", &projection.configuration_id),
        ("configuration revision", &projection.configuration_revision_id),
    ] {
        if value.trim().is_empty() {
            return Err(PublishError::InvalidPlan(format!(
                "runner projection is missing its {name} identity"
            )));
        }
    }
    projection.runtime_revision.validate()
}

/// 已安装 runner 能否服务该模板投影：结构校验 + 投影钉住的运行时修订与本机
/// 封存一致（Adapter 集合以投影的物化选择为准）。分发资产摘要是控制面 TOFU
/// 固化的事实、由 workflow 下载校验消费，runner 无法自证——以归一形态比较。
pub fn verify_installed_projection(projection: &RunnerProjection) -> Result<(), PublishError> {
    validate_projection(projection)?;
    let installed = current_runtime_revision(
        projection
            .adapters
            .ordered_bindings()
            .into_iter()
            .map(|binding| binding.adapter.clone()),
    )?;
    if projection.runtime_revision.without_binary_digests()? != installed {
        return Err(PublishError::InvalidRuntimeRevision(format!(
            "projection pins {}, but the installed runner provides {}",
            projection.runtime_revision.identifier(),
            installed.identifier()
        )));
    }
    Ok(())
}

pub fn validate_prepared_attempt(attempt: &PreparedAttempt) -> Result<(), PublishError> {
    attempt.runtime_revision.validate()?;
    let expected = attempt.runtime_revision.identifier();
    if attempt.prepared.snapshot.runtime_revision != expected {
        return Err(PublishError::InvalidRuntimeRevision(format!(
            "sealed planning input pins {}, but the prepared attempt provides {expected}",
            attempt.prepared.snapshot.runtime_revision
        )));
    }
    if attempt.prepared.snapshot.version != PLANNING_INPUT_SNAPSHOT_VERSION {
        return Err(PublishError::UnsupportedSnapshotVersion {
            actual: attempt.prepared.snapshot.version,
            expected: PLANNING_INPUT_SNAPSHOT_VERSION,
        });
    }
    let snapshot_digest = attempt.prepared.snapshot.digest()?;
    if attempt.prepared.plan.snapshot_digest != snapshot_digest {
        return Err(PublishError::InvalidPlan(
            "sealed plan does not reference the prepared planning input".to_string(),
        ));
    }
    if attempt.prepared.plan.version != PUBLISH_PLAN_VERSION {
        return Err(PublishError::UnsupportedPlanVersion {
            actual: attempt.prepared.plan.version,
            expected: PUBLISH_PLAN_VERSION,
        });
    }
    let plan_digest = attempt.prepared.plan.recomputed_digest()?;
    if attempt.prepared.plan.digest != plan_digest {
        return Err(PublishError::PlanDigestMismatch {
            expected: attempt.prepared.plan.digest.clone(),
            actual: plan_digest,
        });
    }
    Ok(())
}

pub fn installed_runner(attempt: &PreparedAttempt) -> Result<StandaloneRunner, PublishError> {
    validate_prepared_attempt(attempt)?;
    let installed_revision = current_runtime_revision(
        attempt
            .prepared
            .snapshot
            .adapters
            .ordered_bindings()
            .into_iter()
            .map(|binding| binding.adapter.clone()),
    )?;
    // 分发资产摘要由控制面 TOFU 固化、workflow 下载校验消费；本机自证以
    // 归一形态比较，随后沿用 attempt 钉住的完整修订保持身份贯通。
    if attempt.runtime_revision.without_binary_digests()? != installed_revision {
        return Err(PublishError::InvalidRuntimeRevision(format!(
            "prepared attempt pins {}, but the installed runner provides {}",
            attempt.runtime_revision.identifier(),
            installed_revision.identifier()
        )));
    }
    let registry = installed_registry(
        &attempt.prepared.snapshot,
        RunnerPorts::default(),
        &attempt.secret_bindings,
    )?;
    StandaloneRunner::new(registry, attempt.runtime_revision.clone())
}

/// 环境注入集合（决议 #80）：桌面注入 Tauri 执行端口；headless 环境缺省
/// 使用直执行实现（子进程直跑密封命令、bundle 产物物化到确定性相对目录、
/// 干净检出源守卫恒真）。
#[derive(Default)]
pub struct RunnerPorts {
    pub provider_execution: Option<publish_adapters::ProviderExecution>,
}

/// Headless 缺省执行环境：输出目录用固定相对路径，与分片规划的运行时
/// 目录同族（重放摘要与宿主无关）。
fn headless_provider_execution() -> publish_adapters::ProviderExecution {
    publish_adapters::ProviderExecution {
        port: Arc::new(publish_adapters::DirectProviderExecutionPort),
        output_directory: std::path::PathBuf::from(".one-publish-work/provider-output"),
        source_guard: Arc::new(publish_adapters::CleanCheckoutGuard),
    }
}

pub fn installed_registry(
    snapshot: &PlanningInputSnapshot,
    mut ports: RunnerPorts,
    secret_bindings: &BTreeMap<String, String>,
) -> Result<AdapterRegistry, PublishError> {
    let fixture = AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = AdapterRegistry::new();

    register_project_provider(&mut registry, &fixture, snapshot, &mut ports)?;
    register_processors(&mut registry, &fixture, snapshot)?;
    register_execution_backend(&mut registry, &fixture, snapshot, secret_bindings)?;
    register_artifact_store(&mut registry, &fixture, snapshot)?;
    register_destinations(&mut registry, &fixture, snapshot)?;

    Ok(registry)
}

/// 远端执行边界的凭据源（决议 #87）：把模板映射表（引用→Secret 名）与
/// 交付目标声明的凭据类型 join 成 env 解析条目；kind 的事实来源始终是
/// Adapter 声明，映射表只提供环境变量名。
fn env_credential_source(
    snapshot: &PlanningInputSnapshot,
    secret_bindings: &BTreeMap<String, String>,
) -> Result<Arc<publish_adapters::EnvCredentialSource>, PublishError> {
    let mut entries = BTreeMap::new();
    for route in &snapshot.adapters.delivery_routes {
        let destination = destination_instance(&route.binding)?;
        let declarations = &destination.descriptor().schema.credentials;
        for (requirement, reference) in &route.binding.credentials {
            let Some(declared) = declarations.get(requirement) else {
                continue;
            };
            if let Some(variable) = secret_bindings.get(reference) {
                entries.insert(reference.clone(), (variable.clone(), declared.kind));
            }
        }
    }
    Ok(Arc::new(publish_adapters::EnvCredentialSource::new(entries)))
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
                    Some(
                        ports
                            .provider_execution
                            .take()
                            .unwrap_or_else(headless_provider_execution),
                    ),
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
    secret_bindings: &BTreeMap<String, String>,
) -> Result<(), PublishError> {
    let identity = &snapshot.adapters.execution_backend.adapter;
    let credentials: Arc<dyn publish_adapters::CredentialSource> = if secret_bindings.is_empty() {
        Arc::new(StaticCredentialSource::new())
    } else {
        env_credential_source(snapshot, secret_bindings)?
    };
    match (identity.id.as_str(), identity.version) {
        ("local-execution", 1) => {
            registry.register_execution_backend(Arc::new(LocalExecutionBackend::new()), fixture)
        }
        (GITHUB_ACTIONS_BACKEND_ID, 1) => registry.register_execution_backend(
            Arc::new(GitHubActionsBackend::new(credentials)),
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
        registry.register_delivery_destination(destination_instance(&route.binding)?, fixture)?;
    }
    Ok(())
}

/// 交付目标实例的唯一构造点：注册与凭据声明收集共用同一映射。
fn destination_instance(
    binding: &publish_domain::AdapterBinding,
) -> Result<Arc<dyn publish_adapters::DeliveryDestination>, PublishError> {
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
            Ok(Arc::new(LocalDirectoryDestination::new(directory)))
        }
        (GITHUB_RELEASE_DESTINATION_ID, 1) => Ok(Arc::new(GitHubReleaseDestination::new(
            Arc::new(GhCliGitHubReleaseApi::new()),
        ))),
        (SFTP_DESTINATION_ID, 1) => Ok(Arc::new(SftpDeliveryDestination::new(Arc::new(
            OpenSshSftpTransport::new(),
        )))),
        _ => Err(unsupported_installed_adapter(&binding.adapter)),
    }
}

fn unsupported_installed_adapter(identity: &AdapterIdentity) -> PublishError {
    PublishError::AdapterNotRegistered {
        kind: identity.kind,
        id: identity.id.clone(),
        version: identity.version,
    }
}

#[cfg(test)]
mod projection_template_tests {
    use std::collections::BTreeMap;

    use publish_domain::{
        AdapterBinding, AdapterIdentity, AdapterKind, AdapterSelection, AdapterSettings,
        AutomationTriggerPolicy, DeliveryRoute, RuntimeComponentRevision,
    };
    use serde_json::Value;

    use super::{
        current_runtime_revision, validate_projection, verify_installed_projection,
        RunnerProjection, RUNNER_PROJECTION_VERSION,
    };

    fn fixture_projection() -> RunnerProjection {
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
                "github-release-route",
                AdapterIdentity::new(
                    AdapterKind::DeliveryDestination,
                    publish_adapters::GITHUB_RELEASE_DESTINATION_ID,
                    1,
                ),
                AdapterSettings::new(1),
            ))],
        };
        let runtime_revision = current_runtime_revision(
            adapters
                .ordered_bindings()
                .into_iter()
                .map(|binding| binding.adapter.clone()),
        )
        .expect("seal fixture runtime revision");
        RunnerProjection {
            version: RUNNER_PROJECTION_VERSION,
            binding_id: "binding-stable".to_string(),
            configuration_id: "configuration-1".to_string(),
            configuration_revision_id: "configuration-revision-1".to_string(),
            trigger_policy: AutomationTriggerPolicy::TagPush {
                tag_prefix: "v".to_string(),
            },
            runtime_revision,
            release_input: BTreeMap::from([(
                "channel".to_string(),
                Value::String("stable".to_string()),
            )]),
            adapters,
            secret_bindings: BTreeMap::from([(
                "ci-github-token".to_string(),
                "ONE_PUBLISH_CI_GITHUB_TOKEN".to_string(),
            )]),
        }
    }

    #[test]
    fn installed_template_projection_round_trips_and_verifies() {
        let projection = fixture_projection();
        let serialized = serde_json::to_string(&projection).expect("serialize template");
        let decoded: RunnerProjection =
            serde_json::from_str(&serialized).expect("decode template");
        assert_eq!(decoded, projection);
        verify_installed_projection(&decoded).expect("installed runner serves the template");
    }

    #[test]
    fn template_projection_rejects_missing_identities_and_foreign_versions() {
        let mut missing_binding = fixture_projection();
        missing_binding.binding_id = " ".to_string();
        let error = validate_projection(&missing_binding)
            .expect_err("blank binding identity must be rejected");
        assert!(error.to_string().contains("binding identity"));

        let mut unsupported = fixture_projection();
        unsupported.version = RUNNER_PROJECTION_VERSION + 1;
        let error = validate_projection(&unsupported)
            .expect_err("unknown projection version must be rejected");
        assert!(error.to_string().contains("not supported"));

        let mut foreign = fixture_projection();
        foreign.runtime_revision = publish_domain::AutomationRuntimeRevision::seal(
            RuntimeComponentRevision::new("9.9.9", foreign.runtime_revision.runner.digest.clone()),
            foreign.runtime_revision.plan_contract.clone(),
            foreign.runtime_revision.adapters.clone(),
        )
        .expect("seal self-consistent foreign runtime");
        let error = verify_installed_projection(&foreign)
            .expect_err("a different self-consistent runtime must be rejected");
        assert!(error.to_string().contains("installed runner provides"));
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
