use std::collections::BTreeMap;
use std::sync::Arc;

use publish_domain::{
    AdapterDescriptor, AdapterIdentity, AdapterKind, AdapterSettings, ArtifactCandidate,
    ArtifactManifest, AutomationBindingProjection, AutomationProjectionBundle, DeliveryEnvelope,
    DeliveryIdempotencyIdentity, DeliveryReceipt, PlanNode, PlanNodeTemplate, PlanOperation,
    PlanStage, PlanningInputSnapshot, ProjectCandidate, PublishError, PublishPlan,
    ADAPTER_CONTRACT_VERSION,
};
use serde_json::Value;

mod credentials;
mod fake;
mod local;
mod processors;
pub mod tauri;

pub use credentials::{CredentialResolveFailure, CredentialSource, StaticCredentialSource};
pub use fake::{
    FakeAutomationBackend, FakeRemoteBackend, FAKE_AUTOMATION_BACKEND_ID, FAKE_REMOTE_BACKEND_ID,
};
pub use local::{LocalDirectoryDestination, LocalExecutionBackend, TemporaryArtifactStore};
pub use processors::{
    ChecksumProcessor, CustomCommandProcessor, CHECKSUM_MANIFEST_ROLE, CHECKSUM_PROCESSOR_ID,
    CUSTOM_COMMAND_GATE_CAPABILITY, CUSTOM_COMMAND_PROCESSOR_ID,
};
pub use tauri::{
    TauriBuildDriver, TauriProjectInspection, TauriProjectProvider, TauriVersionSource,
    TauriVersionSourceKind, VersionMirror, VersionMirrorKind, TAURI_INSPECT_ACTION,
    TAURI_PROVIDER_ID,
};

pub const AUTOMATION_PROJECTION_CAPABILITY: &str = "automation-projection";
pub const STRUCTURED_PLAN_EXECUTION_CAPABILITY: &str = "structured-plan-execution";
pub const ARTIFACT_CANDIDATE_CAPABILITY: &str = "artifact-candidate";
pub const ARTIFACT_VERIFIED_CAPABILITY: &str = "artifact-verified";

pub(crate) fn action_name(node: &PlanNode) -> Result<&str, PublishError> {
    match &node.operation {
        PlanOperation::AdapterAction { action, .. } => Ok(action),
        _ => Err(PublishError::Execution(format!(
            "node {} is not an adapter action",
            node.id
        ))),
    }
}

pub(crate) fn require_action(node: &PlanNode, expected: &str) -> Result<(), PublishError> {
    let actual = action_name(node)?;
    if actual != expected {
        return Err(PublishError::Execution(format!(
            "node {} expected action {expected}, got {actual}",
            node.id
        )));
    }
    Ok(())
}

#[derive(Debug)]
pub struct AdapterExecutionContext<'a> {
    pub attempt_id: &'a str,
    pub plan_digest: &'a str,
    pub snapshot_digest: &'a str,
    pub artifacts: &'a [ArtifactCandidate],
    pub manifest: Option<&'a ArtifactManifest>,
    pub envelopes: &'a [DeliveryEnvelope],
    pub receipts: &'a [DeliveryReceipt],
    /// 当前节点 Adapter 的 schema 声明并由执行后端解析的凭据；只在执行边界存在，
    /// 不进入任何序列化面（ADR-0029）。
    pub credentials: &'a BTreeMap<String, publish_domain::ResolvedCredential>,
}

#[derive(Debug, Default)]
pub struct AdapterExecutionOutput {
    pub artifacts: Vec<ArtifactCandidate>,
    pub manifest: Option<ArtifactManifest>,
    pub envelopes: Vec<DeliveryEnvelope>,
    pub receipts: Vec<DeliveryReceipt>,
}

pub trait PlanNodeExecutor {
    fn execute_node(&mut self, node: &PlanNode) -> Result<(), PublishError>;
}

pub trait AdapterContract: Send + Sync {
    fn descriptor(&self) -> &AdapterDescriptor;

    fn default_settings(&self) -> AdapterSettings;

    fn migrate_settings(
        &self,
        settings: &AdapterSettings,
    ) -> Result<AdapterSettings, PublishError> {
        let descriptor = self.descriptor();
        if settings.schema_version != descriptor.schema.version {
            return Err(PublishError::UnsupportedSchemaVersion {
                adapter: descriptor.identity().display_name(),
                actual: settings.schema_version,
                current: descriptor.schema.version,
            });
        }
        Ok(settings.clone())
    }

    fn validate_settings(&self, settings: &AdapterSettings) -> Result<(), PublishError> {
        validate_settings_against_schema(self.descriptor(), settings)
    }

    fn summarize_settings(&self, _settings: &AdapterSettings) -> Result<String, PublishError> {
        Ok(self.descriptor().id.clone())
    }

    fn plan_fragment(
        &self,
        snapshot: &PlanningInputSnapshot,
        settings: &AdapterSettings,
    ) -> Result<Vec<PlanNodeTemplate>, PublishError>;

    fn execute_node(
        &self,
        _node: &PlanNode,
        _context: &AdapterExecutionContext<'_>,
    ) -> Result<AdapterExecutionOutput, PublishError> {
        Err(PublishError::Execution(format!(
            "adapter {} does not execute plan nodes",
            self.descriptor().identity().display_name()
        )))
    }

    fn execute_plan(
        &self,
        _plan: &PublishPlan,
        _executor: &mut dyn PlanNodeExecutor,
    ) -> Result<(), PublishError> {
        Err(PublishError::Execution(format!(
            "adapter {} is not an execution backend",
            self.descriptor().identity().display_name()
        )))
    }
}

pub trait ProjectProvider: AdapterContract {
    /// 在 Repository 中发现项目候选；发现结果只报告候选与依据，不建立或覆盖绑定（ADR-0044）。
    fn discover_candidates(
        &self,
        _repository_root: &std::path::Path,
    ) -> Result<Vec<ProjectCandidate>, PublishError> {
        Ok(Vec::new())
    }
}
pub trait ArtifactProcessor: AdapterContract {}

pub trait ExecutionBackend: AdapterContract {
    /// 由后端把仓库全部自动化绑定渲染为其拥有的投影包（ADR-0048）。
    fn render_automation_bundle(
        &self,
        _bindings: &[AutomationBindingProjection],
    ) -> Result<AutomationProjectionBundle, PublishError> {
        Err(PublishError::MissingCapability {
            consumer: self.descriptor().identity().display_name(),
            capability: AUTOMATION_PROJECTION_CAPABILITY.to_string(),
        })
    }

    /// 在执行边界从后端受支持的 Secret Store 解析一个非秘密引用（ADR-0029）。
    fn resolve_credential(
        &self,
        _reference: &str,
    ) -> Result<publish_domain::ResolvedCredential, CredentialResolveFailure> {
        Err(CredentialResolveFailure::Missing)
    }
}

pub trait ArtifactStore: AdapterContract {
    /// 为发布尝试取得产物集合租约：保留期限过后，有效租约仍阻止清理（ADR-0038/0040）。
    fn acquire_artifact_set_lease(
        &self,
        settings: &AdapterSettings,
        attempt_id: &str,
        manifest_digest: &str,
        valid_until: &str,
    ) -> Result<(), PublishError>;

    /// 释放发布尝试持有的租约；不存在的租约视为已释放。
    fn release_artifact_set_lease(
        &self,
        settings: &AdapterSettings,
        attempt_id: &str,
    ) -> Result<(), PublishError>;

    /// 按保留期限清理产物集合并返回可观察报告；被有效租约引用或与保留集合
    /// 共享的产物不被删除（ADR-0038）。
    fn enforce_retention(
        &self,
        settings: &AdapterSettings,
        now: &str,
    ) -> Result<RetentionSweepReport, PublishError>;
}

/// 保留清理的可观察结果：每个产物集合要么带原因保留，要么带删除明细移除。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct RetentionSweepReport {
    pub retained: Vec<RetainedArtifactSet>,
    pub removed: Vec<RemovedArtifactSet>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct RetainedArtifactSet {
    pub manifest_digest: String,
    pub reason: RetentionHold,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RetentionHold {
    WithinRetention {
        retain_until: String,
    },
    LeasedByAttempt {
        attempt_id: String,
        valid_until: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct RemovedArtifactSet {
    pub manifest_digest: String,
    /// 随本集合一并删除的产物内容摘要；被保留集合共享的产物不出现在这里。
    pub removed_artifacts: Vec<String>,
}

pub trait DeliveryDestination: AdapterContract {
    /// 自动重试前按 Delivery Idempotency Identity 探测远端状态（ADR-0051）。
    /// 默认无法探测：不可查询的副作用被显式标记为不可自动重试。
    fn probe_delivery(
        &self,
        _settings: &AdapterSettings,
        _identity: &DeliveryIdempotencyIdentity,
    ) -> Result<DeliveryProbe, PublishError> {
        Ok(DeliveryProbe::Unprobeable {
            reason: format!(
                "destination {} does not support idempotency probes",
                self.descriptor().identity().display_name()
            ),
        })
    }
}

/// 幂等探测的四种可能结果（ADR-0051）：只有 Absent 允许重新执行副作用，
/// Matching 复用既有交付，Conflicting 与 Unprobeable 都阻断自动重试。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeliveryProbe {
    /// 远端不存在此幂等身份的交付；重新执行是安全的。
    Absent,
    /// 远端存在且产物摘要一致；携带可直接复用的外部引用。
    Matching { external_reference: String },
    /// 远端存在同名交付但摘要不一致；继续执行会覆盖另一份发布产物。
    Conflicting { external_reference: String },
    /// 目标不支持探测或当前无法完成探测。
    Unprobeable { reason: String },
}

#[derive(Debug, Clone)]
pub struct AdapterConformanceFixture {
    pub snapshot: PlanningInputSnapshot,
    pub forbidden_values: Vec<String>,
}

impl AdapterConformanceFixture {
    pub fn new(snapshot: PlanningInputSnapshot) -> Self {
        Self {
            snapshot,
            forbidden_values: Vec::new(),
        }
    }
}

#[derive(Default)]
pub struct AdapterRegistry {
    project_providers: BTreeMap<(String, u32), Arc<dyn ProjectProvider>>,
    artifact_processors: BTreeMap<(String, u32), Arc<dyn ArtifactProcessor>>,
    execution_backends: BTreeMap<(String, u32), Arc<dyn ExecutionBackend>>,
    artifact_stores: BTreeMap<(String, u32), Arc<dyn ArtifactStore>>,
    delivery_destinations: BTreeMap<(String, u32), Arc<dyn DeliveryDestination>>,
}

impl AdapterRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register_project_provider(
        &mut self,
        adapter: Arc<dyn ProjectProvider>,
        fixture: &AdapterConformanceFixture,
    ) -> Result<(), PublishError> {
        verify_adapter_conformance(adapter.as_ref(), AdapterKind::ProjectProvider, fixture)?;
        insert_adapter(&mut self.project_providers, adapter)
    }

    pub fn register_artifact_processor(
        &mut self,
        adapter: Arc<dyn ArtifactProcessor>,
        fixture: &AdapterConformanceFixture,
    ) -> Result<(), PublishError> {
        verify_adapter_conformance(adapter.as_ref(), AdapterKind::ArtifactProcessor, fixture)?;
        insert_adapter(&mut self.artifact_processors, adapter)
    }

    pub fn register_execution_backend(
        &mut self,
        adapter: Arc<dyn ExecutionBackend>,
        fixture: &AdapterConformanceFixture,
    ) -> Result<(), PublishError> {
        verify_adapter_conformance(adapter.as_ref(), AdapterKind::ExecutionBackend, fixture)?;
        insert_adapter(&mut self.execution_backends, adapter)
    }

    pub fn register_artifact_store(
        &mut self,
        adapter: Arc<dyn ArtifactStore>,
        fixture: &AdapterConformanceFixture,
    ) -> Result<(), PublishError> {
        verify_adapter_conformance(adapter.as_ref(), AdapterKind::ArtifactStore, fixture)?;
        insert_adapter(&mut self.artifact_stores, adapter)
    }

    pub fn register_delivery_destination(
        &mut self,
        adapter: Arc<dyn DeliveryDestination>,
        fixture: &AdapterConformanceFixture,
    ) -> Result<(), PublishError> {
        verify_adapter_conformance(adapter.as_ref(), AdapterKind::DeliveryDestination, fixture)?;
        insert_adapter(&mut self.delivery_destinations, adapter)
    }

    pub fn descriptor(
        &self,
        identity: &AdapterIdentity,
    ) -> Result<&AdapterDescriptor, PublishError> {
        Ok(self.resolve(identity)?.descriptor())
    }

    pub fn migrate_and_validate_settings(
        &self,
        identity: &AdapterIdentity,
        settings: &AdapterSettings,
    ) -> Result<AdapterSettings, PublishError> {
        let adapter = self.resolve(identity)?;
        let migrated = adapter.migrate_settings(settings)?;
        let repeated = adapter.migrate_settings(settings)?;
        if migrated != repeated {
            return Err(PublishError::InvalidAdapter {
                adapter: adapter.descriptor().identity().display_name(),
                message: "settings migration is not deterministic".to_string(),
            });
        }
        adapter.validate_settings(&migrated)?;
        Ok(migrated)
    }

    pub fn plan_fragment(
        &self,
        identity: &AdapterIdentity,
        snapshot: &PlanningInputSnapshot,
        settings: &AdapterSettings,
    ) -> Result<Vec<PlanNodeTemplate>, PublishError> {
        let adapter = self.resolve(identity)?;
        let first = adapter.plan_fragment(snapshot, settings)?;
        let second = adapter.plan_fragment(snapshot, settings)?;
        if first != second {
            return Err(PublishError::InvalidAdapter {
                adapter: adapter.descriptor().identity().display_name(),
                message: "plan fragment is not deterministic".to_string(),
            });
        }
        validate_fragment(adapter.descriptor(), settings, &first, &[])?;
        Ok(first)
    }

    pub fn validate_plan_node(&self, node: &PlanNode) -> Result<(), PublishError> {
        let descriptor = self.descriptor(&node.adapter)?;
        validate_operation(descriptor, &node.operation)
    }

    pub fn execute_node(
        &self,
        node: &PlanNode,
        context: &AdapterExecutionContext<'_>,
    ) -> Result<AdapterExecutionOutput, PublishError> {
        self.resolve(&node.adapter)?.execute_node(node, context)
    }

    pub fn execute_plan(
        &self,
        identity: &AdapterIdentity,
        plan: &PublishPlan,
        executor: &mut dyn PlanNodeExecutor,
    ) -> Result<(), PublishError> {
        if identity.kind != AdapterKind::ExecutionBackend {
            return Err(PublishError::AdapterKindMismatch {
                id: identity.id.clone(),
                expected: AdapterKind::ExecutionBackend,
                actual: identity.kind,
            });
        }
        self.resolve(identity)?.execute_plan(plan, executor)
    }

    pub fn validate_capabilities<'a, I>(&self, identities: I) -> Result<(), PublishError>
    where
        I: IntoIterator<Item = &'a AdapterIdentity>,
    {
        let mut descriptors = BTreeMap::<AdapterIdentity, &AdapterDescriptor>::new();
        for identity in identities {
            descriptors
                .entry(identity.clone())
                .or_insert(self.descriptor(identity)?);
        }

        let mut provided = BTreeMap::<&str, std::collections::BTreeSet<u32>>::new();
        for descriptor in descriptors.values() {
            for capability in &descriptor.capabilities.provides {
                provided
                    .entry(&capability.id)
                    .or_default()
                    .insert(capability.version);
            }
        }

        for descriptor in descriptors.values() {
            for requirement in &descriptor.capabilities.requires {
                let Some(versions) = provided.get(requirement.id.as_str()) else {
                    return Err(PublishError::MissingCapability {
                        consumer: descriptor.identity().display_name(),
                        capability: requirement.id.clone(),
                    });
                };
                if !versions.iter().any(|version| requirement.accepts(*version)) {
                    return Err(PublishError::IncompatibleCapability {
                        consumer: descriptor.identity().display_name(),
                        capability: requirement.id.clone(),
                        minimum: requirement.minimum_version,
                        maximum: requirement.maximum_version,
                        provided: versions.iter().copied().collect(),
                    });
                }
            }
        }
        Ok(())
    }

    /// 静态校验一个绑定的凭据引用：schema 未声明的名字被拒绝，
    /// 声明的每项要求都必须绑定一个非秘密引用（ADR-0029/0030）。
    pub fn validate_credential_bindings(
        &self,
        binding: &publish_domain::AdapterBinding,
    ) -> Result<(), PublishError> {
        let descriptor = self.descriptor(&binding.adapter)?;
        let adapter = descriptor.identity().display_name();
        if let Some(name) = binding
            .credentials
            .keys()
            .find(|name| !descriptor.schema.credentials.contains_key(*name))
        {
            return Err(PublishError::CredentialNotDeclared {
                adapter,
                name: name.clone(),
            });
        }
        if let Some(requirement) = descriptor
            .schema
            .credentials
            .keys()
            .find(|requirement| !binding.credentials.contains_key(*requirement))
        {
            return Err(PublishError::CredentialNotBound {
                adapter,
                requirement: requirement.clone(),
            });
        }
        Ok(())
    }

    /// 通过当前 Execution Backend 解析一个绑定声明的全部凭据要求。
    /// 只返回 schema 声明的凭据，并统一校验类型；诊断只包含引用，从不包含解析值。
    pub fn resolve_binding_credentials(
        &self,
        backend: &AdapterIdentity,
        binding: &publish_domain::AdapterBinding,
    ) -> Result<BTreeMap<String, publish_domain::ResolvedCredential>, PublishError> {
        self.validate_credential_bindings(binding)?;
        let descriptor = self.descriptor(&binding.adapter)?;
        let adapter = descriptor.identity().display_name();
        let backend_adapter = self.execution_backend(backend)?;

        let mut resolved = BTreeMap::new();
        for (requirement, declared) in &descriptor.schema.credentials {
            let reference = binding.credentials.get(requirement).ok_or_else(|| {
                PublishError::CredentialNotBound {
                    adapter: adapter.clone(),
                    requirement: requirement.clone(),
                }
            })?;
            let credential = backend_adapter
                .resolve_credential(reference)
                .map_err(|failure| match failure {
                    CredentialResolveFailure::Missing => PublishError::CredentialReferenceMissing {
                        adapter: adapter.clone(),
                        requirement: requirement.clone(),
                        reference: reference.clone(),
                    },
                    CredentialResolveFailure::AccessDenied => {
                        PublishError::CredentialAccessDenied {
                            adapter: adapter.clone(),
                            requirement: requirement.clone(),
                            reference: reference.clone(),
                        }
                    }
                })?;
            if credential.kind != declared.kind {
                return Err(PublishError::CredentialKindMismatch {
                    adapter: adapter.clone(),
                    requirement: requirement.clone(),
                    reference: reference.clone(),
                    expected: declared.kind,
                    actual: credential.kind,
                });
            }
            resolved.insert(requirement.clone(), credential);
        }
        Ok(resolved)
    }

    fn execution_backend(
        &self,
        identity: &AdapterIdentity,
    ) -> Result<&dyn ExecutionBackend, PublishError> {
        if identity.kind != AdapterKind::ExecutionBackend {
            return Err(PublishError::AdapterKindMismatch {
                id: identity.id.clone(),
                expected: AdapterKind::ExecutionBackend,
                actual: identity.kind,
            });
        }
        self.execution_backends
            .get(&(identity.id.clone(), identity.version))
            .map(Arc::as_ref)
            .ok_or_else(|| self.unresolved_adapter(identity))
    }

    /// 按交付幂等身份探测一条路线的远端状态（ADR-0051）。
    pub fn probe_delivery(
        &self,
        destination: &AdapterIdentity,
        settings: &AdapterSettings,
        identity: &DeliveryIdempotencyIdentity,
    ) -> Result<DeliveryProbe, PublishError> {
        if destination.kind != AdapterKind::DeliveryDestination {
            return Err(PublishError::AdapterKindMismatch {
                id: destination.id.clone(),
                expected: AdapterKind::DeliveryDestination,
                actual: destination.kind,
            });
        }
        self.delivery_destinations
            .get(&(destination.id.clone(), destination.version))
            .map(Arc::as_ref)
            .ok_or_else(|| self.unresolved_adapter(destination))?
            .probe_delivery(settings, identity)
    }

    fn resolve(&self, identity: &AdapterIdentity) -> Result<AdapterRef<'_>, PublishError> {
        let key = (identity.id.clone(), identity.version);
        let adapter = match identity.kind {
            AdapterKind::ProjectProvider => self
                .project_providers
                .get(&key)
                .map(|adapter| AdapterRef::ProjectProvider(adapter.as_ref())),
            AdapterKind::ArtifactProcessor => self
                .artifact_processors
                .get(&key)
                .map(|adapter| AdapterRef::ArtifactProcessor(adapter.as_ref())),
            AdapterKind::ExecutionBackend => self
                .execution_backends
                .get(&key)
                .map(|adapter| AdapterRef::ExecutionBackend(adapter.as_ref())),
            AdapterKind::ArtifactStore => self
                .artifact_stores
                .get(&key)
                .map(|adapter| AdapterRef::ArtifactStore(adapter.as_ref())),
            AdapterKind::DeliveryDestination => self
                .delivery_destinations
                .get(&key)
                .map(|adapter| AdapterRef::DeliveryDestination(adapter.as_ref())),
        };

        adapter.ok_or_else(|| self.unresolved_adapter(identity))
    }

    fn unresolved_adapter(&self, identity: &AdapterIdentity) -> PublishError {
        let available = match identity.kind {
            AdapterKind::ProjectProvider => {
                available_versions(&self.project_providers, &identity.id)
            }
            AdapterKind::ArtifactProcessor => {
                available_versions(&self.artifact_processors, &identity.id)
            }
            AdapterKind::ExecutionBackend => {
                available_versions(&self.execution_backends, &identity.id)
            }
            AdapterKind::ArtifactStore => available_versions(&self.artifact_stores, &identity.id),
            AdapterKind::DeliveryDestination => {
                available_versions(&self.delivery_destinations, &identity.id)
            }
        };
        if available.is_empty() {
            PublishError::AdapterNotRegistered {
                kind: identity.kind,
                id: identity.id.clone(),
                version: identity.version,
            }
        } else {
            PublishError::AdapterVersionMismatch {
                kind: identity.kind,
                id: identity.id.clone(),
                requested: identity.version,
                available,
            }
        }
    }
}

enum AdapterRef<'a> {
    ProjectProvider(&'a dyn ProjectProvider),
    ArtifactProcessor(&'a dyn ArtifactProcessor),
    ExecutionBackend(&'a dyn ExecutionBackend),
    ArtifactStore(&'a dyn ArtifactStore),
    DeliveryDestination(&'a dyn DeliveryDestination),
}

macro_rules! dispatch_adapter {
    ($self:expr, $adapter:ident => $expression:expr) => {
        match $self {
            AdapterRef::ProjectProvider($adapter) => $expression,
            AdapterRef::ArtifactProcessor($adapter) => $expression,
            AdapterRef::ExecutionBackend($adapter) => $expression,
            AdapterRef::ArtifactStore($adapter) => $expression,
            AdapterRef::DeliveryDestination($adapter) => $expression,
        }
    };
}

impl<'a> AdapterRef<'a> {
    fn descriptor(&self) -> &'a AdapterDescriptor {
        dispatch_adapter!(self, adapter => adapter.descriptor())
    }

    fn migrate_settings(
        &self,
        settings: &AdapterSettings,
    ) -> Result<AdapterSettings, PublishError> {
        dispatch_adapter!(self, adapter => adapter.migrate_settings(settings))
    }

    fn validate_settings(&self, settings: &AdapterSettings) -> Result<(), PublishError> {
        dispatch_adapter!(self, adapter => adapter.validate_settings(settings))
    }

    fn plan_fragment(
        &self,
        snapshot: &PlanningInputSnapshot,
        settings: &AdapterSettings,
    ) -> Result<Vec<PlanNodeTemplate>, PublishError> {
        dispatch_adapter!(self, adapter => adapter.plan_fragment(snapshot, settings))
    }

    fn execute_node(
        &self,
        node: &PlanNode,
        context: &AdapterExecutionContext<'_>,
    ) -> Result<AdapterExecutionOutput, PublishError> {
        dispatch_adapter!(self, adapter => adapter.execute_node(node, context))
    }

    fn execute_plan(
        &self,
        plan: &PublishPlan,
        executor: &mut dyn PlanNodeExecutor,
    ) -> Result<(), PublishError> {
        dispatch_adapter!(self, adapter => adapter.execute_plan(plan, executor))
    }
}

pub fn verify_adapter_conformance<T: AdapterContract + ?Sized>(
    adapter: &T,
    expected_kind: AdapterKind,
    fixture: &AdapterConformanceFixture,
) -> Result<(), PublishError> {
    let descriptor = adapter.descriptor();
    validate_descriptor(descriptor, expected_kind)?;
    descriptor
        .capabilities
        .validate(&descriptor.identity().display_name())?;

    let default_settings = adapter.default_settings();
    let settings = adapter.migrate_settings(&default_settings)?;
    let repeated_settings = adapter.migrate_settings(&default_settings)?;
    if settings != repeated_settings {
        return Err(PublishError::InvalidAdapter {
            adapter: descriptor.identity().display_name(),
            message: "settings migration is not deterministic".to_string(),
        });
    }
    adapter.validate_settings(&settings)?;
    if adapter.summarize_settings(&settings)?.trim().is_empty() {
        return Err(PublishError::InvalidAdapter {
            adapter: descriptor.identity().display_name(),
            message: "settings summary cannot be empty".to_string(),
        });
    }

    let first = adapter.plan_fragment(&fixture.snapshot, &settings)?;
    let second = adapter.plan_fragment(&fixture.snapshot, &settings)?;
    if first != second {
        return Err(PublishError::InvalidAdapter {
            adapter: descriptor.identity().display_name(),
            message: "plan fragment is not deterministic".to_string(),
        });
    }

    validate_fragment(descriptor, &settings, &first, &fixture.forbidden_values)
}

fn validate_descriptor(
    descriptor: &AdapterDescriptor,
    expected_kind: AdapterKind,
) -> Result<(), PublishError> {
    if descriptor.kind != expected_kind {
        return Err(PublishError::AdapterKindMismatch {
            id: descriptor.id.clone(),
            expected: expected_kind,
            actual: descriptor.kind,
        });
    }
    if descriptor.contract_version != ADAPTER_CONTRACT_VERSION {
        return Err(PublishError::UnsupportedAdapterContractVersion {
            actual: descriptor.contract_version,
            expected: ADAPTER_CONTRACT_VERSION,
        });
    }
    if descriptor.id.trim().is_empty() || descriptor.version == 0 || descriptor.schema.version == 0
    {
        return Err(PublishError::InvalidAdapter {
            adapter: descriptor.identity().display_name(),
            message: "id, adapter version, and schema version must be present".to_string(),
        });
    }
    if descriptor
        .allowed_programs
        .iter()
        .any(|program| !is_opaque_executable_id(program))
    {
        return Err(PublishError::InvalidAdapter {
            adapter: descriptor.identity().display_name(),
            message: "allowed programs must be namespaced opaque executable ids".to_string(),
        });
    }
    if descriptor
        .schema
        .credentials
        .iter()
        .any(|(name, requirement)| name.trim().is_empty() || requirement.purpose.trim().is_empty())
    {
        return Err(PublishError::InvalidAdapter {
            adapter: descriptor.identity().display_name(),
            message: "credential requirements must declare a name and a purpose".to_string(),
        });
    }
    if descriptor.kind == AdapterKind::ArtifactProcessor
        && (descriptor.capabilities.provides.is_empty()
            || descriptor.capabilities.requires.is_empty())
    {
        return Err(PublishError::InvalidAdapter {
            adapter: descriptor.identity().display_name(),
            message: "artifact processors must declare input and output publishing capabilities"
                .to_string(),
        });
    }
    Ok(())
}

fn is_opaque_executable_id(program: &str) -> bool {
    let mut parts = program.split(':');
    let namespace = parts.next().unwrap_or_default();
    let name = parts.next().unwrap_or_default();
    parts.next().is_none()
        && [namespace, name].iter().all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
        })
}

fn validate_fragment(
    descriptor: &AdapterDescriptor,
    settings: &AdapterSettings,
    nodes: &[PlanNodeTemplate],
    forbidden_values: &[String],
) -> Result<(), PublishError> {
    let mut ids = std::collections::BTreeSet::new();
    for node in nodes {
        if node.local_id.trim().is_empty() || !ids.insert(&node.local_id) {
            return Err(PublishError::InvalidAdapter {
                adapter: descriptor.identity().display_name(),
                message: "plan node ids must be non-empty and unique".to_string(),
            });
        }
        validate_operation(descriptor, &node.operation)?;
        if descriptor.kind == AdapterKind::ArtifactProcessor {
            validate_processor_node(descriptor, node)?;
        }
    }

    let serialized = serde_json::to_string(&(settings, nodes)).map_err(|error| {
        PublishError::InvalidAdapter {
            adapter: descriptor.identity().display_name(),
            message: format!("adapter settings and plan fragment cannot be serialized: {error}"),
        }
    })?;
    if forbidden_values
        .iter()
        .any(|value| !value.is_empty() && serialized.contains(value.as_str()))
    {
        return Err(PublishError::InvalidAdapter {
            adapter: descriptor.identity().display_name(),
            message: "adapter settings or plan fragment contains a forbidden value".to_string(),
        });
    }
    Ok(())
}

fn validate_operation(
    descriptor: &AdapterDescriptor,
    operation: &PlanOperation,
) -> Result<(), PublishError> {
    operation.validate()?;
    if let PlanOperation::RunProgram { program, .. } = operation {
        if !descriptor.allowed_programs.contains(program) {
            return Err(PublishError::InvalidAdapter {
                adapter: descriptor.identity().display_name(),
                message: format!("program {program} is not declared by the adapter"),
            });
        }
    }
    Ok(())
}

/// 处理器节点的可复用合同：只在 ProcessArtifacts 阶段运行、显式声明输入角色，
/// 且输出角色必须精确（通配输出会让未声明产物进入计划，ADR-0035/ADR-0049）。
fn validate_processor_node(
    descriptor: &AdapterDescriptor,
    node: &PlanNodeTemplate,
) -> Result<(), PublishError> {
    if node.stage != PlanStage::ProcessArtifacts {
        return Err(PublishError::InvalidAdapter {
            adapter: descriptor.identity().display_name(),
            message: "artifact processor plan nodes must run in the process_artifacts stage"
                .to_string(),
        });
    }
    if node.artifact_inputs.is_empty() {
        return Err(PublishError::InvalidAdapter {
            adapter: descriptor.identity().display_name(),
            message: "artifact processor plan nodes must declare their artifact role inputs"
                .to_string(),
        });
    }
    if node
        .artifact_outputs
        .iter()
        .any(|role| publish_domain::is_artifact_role_wildcard(role))
    {
        return Err(PublishError::InvalidAdapter {
            adapter: descriptor.identity().display_name(),
            message: "artifact processor plan nodes must declare exact artifact role outputs"
                .to_string(),
        });
    }
    Ok(())
}

fn validate_settings_against_schema(
    descriptor: &AdapterDescriptor,
    settings: &AdapterSettings,
) -> Result<(), PublishError> {
    if settings.schema_version != descriptor.schema.version {
        return Err(PublishError::UnsupportedSchemaVersion {
            adapter: descriptor.identity().display_name(),
            actual: settings.schema_version,
            current: descriptor.schema.version,
        });
    }

    if let Some(key) = settings
        .values
        .keys()
        .find(|key| !descriptor.schema.fields.contains_key(*key))
    {
        return Err(PublishError::InvalidAdapterSettings {
            adapter: descriptor.identity().display_name(),
            message: format!("unknown setting {key}"),
        });
    }

    for (key, field) in &descriptor.schema.fields {
        let value = settings.values.get(key);
        if field.required && value.is_none() {
            return Err(PublishError::InvalidAdapterSettings {
                adapter: descriptor.identity().display_name(),
                message: format!("missing required setting {key}"),
            });
        }
        let Some(value) = value else {
            continue;
        };
        let valid = match field.value_type {
            publish_domain::AdapterSchemaValueType::String => value.is_string(),
            publish_domain::AdapterSchemaValueType::Boolean => value.is_boolean(),
            publish_domain::AdapterSchemaValueType::Number => value.is_number(),
            publish_domain::AdapterSchemaValueType::StringList => value
                .as_array()
                .is_some_and(|values| values.iter().all(Value::is_string)),
        };
        if !valid {
            return Err(PublishError::InvalidAdapterSettings {
                adapter: descriptor.identity().display_name(),
                message: format!("setting {key} has the wrong type"),
            });
        }
    }
    Ok(())
}

fn insert_adapter<T: AdapterContract + ?Sized>(
    adapters: &mut BTreeMap<(String, u32), Arc<T>>,
    adapter: Arc<T>,
) -> Result<(), PublishError> {
    let descriptor = adapter.descriptor();
    let key = (descriptor.id.clone(), descriptor.version);
    if adapters.contains_key(&key) {
        return Err(PublishError::DuplicateAdapter {
            kind: descriptor.kind,
            id: descriptor.id.clone(),
            version: descriptor.version,
        });
    }
    adapters.insert(key, adapter);
    Ok(())
}

fn available_versions<T: ?Sized>(adapters: &BTreeMap<(String, u32), Arc<T>>, id: &str) -> Vec<u32> {
    adapters
        .keys()
        .filter_map(|(adapter_id, version)| (adapter_id == id).then_some(*version))
        .collect()
}
