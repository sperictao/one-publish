use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

pub const PLANNING_INPUT_SNAPSHOT_VERSION: u32 = 1;
pub const PUBLISH_PLAN_VERSION: u32 = 1;
pub const ADAPTER_CONTRACT_VERSION: u32 = 1;
pub const ARTIFACT_MANIFEST_VERSION: u32 = 1;
pub const PUBLISH_EVENT_VERSION: u32 = 1;
pub const DELIVERY_RECEIPT_VERSION: u32 = 1;
pub const PUBLISH_FAILURE_VERSION: u32 = 1;
pub const RELEASE_ATTEMPT_VERSION: u32 = 1;
pub const AUTOMATION_PROJECTION_BUNDLE_VERSION: u32 = 1;
pub const AUTOMATION_RUNTIME_REVISION_VERSION: u32 = 1;
pub const PUBLISH_RESOURCE_LEASE_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PublishError {
    #[error("unsupported planning input snapshot version {actual}; expected {expected}")]
    UnsupportedSnapshotVersion { actual: u32, expected: u32 },
    #[error("unsupported publish plan version {actual}; expected {expected}")]
    UnsupportedPlanVersion { actual: u32, expected: u32 },
    #[error("unsupported publish event version {actual}; expected {expected}")]
    UnsupportedEventVersion { actual: u32, expected: u32 },
    #[error("unsupported release attempt version {actual}; expected {expected}")]
    UnsupportedAttemptVersion { actual: u32, expected: u32 },
    #[error("unsupported publish failure classification version {actual}; expected {expected}")]
    UnsupportedFailureVersion { actual: u32, expected: u32 },
    #[error(
        "automatic retry is blocked: {}", reasons.join("; ")
    )]
    AutomaticRetryBlocked { reasons: Vec<String> },
    #[error(
        "publish event history has unexplained sequence gaps; missing ranges {missing:?} must be requested explicitly before the state can advance"
    )]
    EventSequenceGap { missing: Vec<(u64, u64)> },
    #[error("unsupported adapter contract version {actual}; expected {expected}")]
    UnsupportedAdapterContractVersion { actual: u32, expected: u32 },
    #[error("adapter {kind:?}/{id}@{version} is not registered")]
    AdapterNotRegistered {
        kind: AdapterKind,
        id: String,
        version: u32,
    },
    #[error(
        "adapter {kind:?}/{id} does not provide requested version {requested}; available versions are {available:?}"
    )]
    AdapterVersionMismatch {
        kind: AdapterKind,
        id: String,
        requested: u32,
        available: Vec<u32>,
    },
    #[error("adapter {id} is registered as {actual:?}, not {expected:?}")]
    AdapterKindMismatch {
        id: String,
        expected: AdapterKind,
        actual: AdapterKind,
    },
    #[error("adapter {kind:?}/{id}@{version} is already registered")]
    DuplicateAdapter {
        kind: AdapterKind,
        id: String,
        version: u32,
    },
    #[error("adapter {adapter} uses unsupported settings schema version {actual}; current version is {current}")]
    UnsupportedSchemaVersion {
        adapter: String,
        actual: u32,
        current: u32,
    },
    #[error("invalid adapter {adapter}: {message}")]
    InvalidAdapter { adapter: String, message: String },
    #[error("invalid settings for adapter {adapter}: {message}")]
    InvalidAdapterSettings { adapter: String, message: String },
    #[error(
        "adapter {adapter} requires credential {requirement}, but the configuration binds no reference"
    )]
    CredentialNotBound {
        adapter: String,
        requirement: String,
    },
    #[error("adapter {adapter} does not declare credential {name} in its settings schema")]
    CredentialNotDeclared { adapter: String, name: String },
    #[error(
        "credential reference {reference} for {adapter}/{requirement} is not available in the execution backend"
    )]
    CredentialReferenceMissing {
        adapter: String,
        requirement: String,
        reference: String,
    },
    #[error(
        "credential reference {reference} for {adapter}/{requirement} cannot be accessed by the execution backend"
    )]
    CredentialAccessDenied {
        adapter: String,
        requirement: String,
        reference: String,
    },
    #[error(
        "credential reference {reference} for {adapter}/{requirement} resolved to a {actual:?} credential, expected {expected:?}"
    )]
    CredentialKindMismatch {
        adapter: String,
        requirement: String,
        reference: String,
        expected: CredentialKind,
        actual: CredentialKind,
    },
    #[error("adapter {consumer} requires missing capability {capability}")]
    MissingCapability {
        consumer: String,
        capability: String,
    },
    #[error(
        "adapter {consumer} requires capability {capability} versions {minimum}..={maximum}, but selected adapters provide {provided:?}"
    )]
    IncompatibleCapability {
        consumer: String,
        capability: String,
        minimum: u32,
        maximum: u32,
        provided: Vec<u32>,
    },
    #[error("invalid publish plan: {0}")]
    InvalidPlan(String),
    #[error("publish plan digest mismatch: expected {expected}, got {actual}")]
    PlanDigestMismatch { expected: String, actual: String },
    #[error("invalid automation runtime revision: {0}")]
    InvalidRuntimeRevision(String),
    #[error("artifact digest mismatch for {artifact}: expected {expected}, got {actual}")]
    ArtifactDigestMismatch {
        artifact: String,
        expected: String,
        actual: String,
    },
    #[error("invalid artifact {artifact}: {message}")]
    InvalidArtifact { artifact: String, message: String },
    #[error("publish plan did not produce an artifact manifest")]
    MissingArtifactManifest,
    #[error("publish plan did not produce a delivery receipt")]
    MissingDeliveryReceipt,
    #[error("publish plan execution was incomplete; missing nodes: {missing:?}")]
    IncompletePlanExecution { missing: Vec<String> },
    #[error("publish attempt {attempt_id} has already started")]
    AttemptAlreadyStarted { attempt_id: String },
    #[error("unsupported publish resource lease version {actual}; expected {expected}")]
    UnsupportedLeaseVersion { actual: u32, expected: u32 },
    #[error("publish attempt {requester} is blocked: {resource} is leased by attempt {holder}")]
    LeaseResourceConflict {
        requester: String,
        holder: String,
        resource: String,
    },
    #[error(
        "publish attempt {attempt_id} lost its resource lease ({reason}); execution must fail instead of continuing with uncertain ownership"
    )]
    LeaseLost { attempt_id: String, reason: String },
    #[error(
        "artifact set {manifest_digest} is no longer available from the artifact store ({reason}); the delivery is unresumable and a new build attempt is required"
    )]
    UnresumableDelivery {
        manifest_digest: String,
        reason: String,
    },
    #[error("project inspection failed: {code}: {message}")]
    ProjectInspection { code: String, message: String },
    #[error(
        "delivery failed with {} failure {}: {} (retry_safe: {}, retry_after_seconds: {:?})",
        failure.category.name(),
        failure.native_code,
        failure.message,
        failure.retry_safe,
        failure.retry_after_seconds
    )]
    Classified { failure: PublishFailure },
    #[error("adapter execution failed: {0}")]
    Execution(String),
    #[error("I/O operation {operation} failed: {message}")]
    Io { operation: String, message: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AdapterKind {
    ProjectProvider,
    ArtifactProcessor,
    ExecutionBackend,
    ArtifactStore,
    DeliveryDestination,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct AdapterIdentity {
    pub kind: AdapterKind,
    pub id: String,
    pub version: u32,
}

impl AdapterIdentity {
    pub fn new(kind: AdapterKind, id: impl Into<String>, version: u32) -> Self {
        Self {
            kind,
            id: id.into(),
            version,
        }
    }

    pub fn display_name(&self) -> String {
        format!("{:?}/{}@{}", self.kind, self.id, self.version)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdapterSchema {
    pub version: u32,
    pub fields: BTreeMap<String, AdapterSchemaField>,
    /// Schema 声明的 Credential Requirement：发布配置只能把它们绑定为
    /// 非秘密引用，Adapter 也只会收到这里声明的凭据（ADR-0029/0030）。
    pub credentials: BTreeMap<String, CredentialRequirement>,
}

impl AdapterSchema {
    pub fn new(version: u32) -> Self {
        Self {
            version,
            fields: BTreeMap::new(),
            credentials: BTreeMap::new(),
        }
    }

    pub fn with_credential(
        mut self,
        name: impl Into<String>,
        kind: CredentialKind,
        purpose: impl Into<String>,
    ) -> Self {
        self.credentials.insert(
            name.into(),
            CredentialRequirement {
                kind,
                purpose: purpose.into(),
            },
        );
        self
    }

    pub fn with_required_string(mut self, key: impl Into<String>) -> Self {
        self.fields.insert(
            key.into(),
            AdapterSchemaField {
                value_type: AdapterSchemaValueType::String,
                required: true,
            },
        );
        self
    }

    pub fn with_required_number(mut self, key: impl Into<String>) -> Self {
        self.fields.insert(
            key.into(),
            AdapterSchemaField {
                value_type: AdapterSchemaValueType::Number,
                required: true,
            },
        );
        self
    }

    pub fn with_required_boolean(mut self, key: impl Into<String>) -> Self {
        self.fields.insert(
            key.into(),
            AdapterSchemaField {
                value_type: AdapterSchemaValueType::Boolean,
                required: true,
            },
        );
        self
    }

    pub fn with_required_string_list(mut self, key: impl Into<String>) -> Self {
        self.fields.insert(
            key.into(),
            AdapterSchemaField {
                value_type: AdapterSchemaValueType::StringList,
                required: true,
            },
        );
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdapterSchemaField {
    pub value_type: AdapterSchemaValueType,
    pub required: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AdapterSchemaValueType {
    String,
    Boolean,
    Number,
    StringList,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CredentialKind {
    Token,
    SigningKey,
    SshPrivateKey,
}

/// Adapter 对一项逻辑凭据的声明：类型与用途说明。用途随配置导出保留，
/// 秘密值从不进入任何可序列化结构。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CredentialRequirement {
    pub kind: CredentialKind,
    pub purpose: String,
}

/// 已解析的秘密值。刻意不实现 Serialize/Deserialize，Debug 输出脱敏，
/// 让秘密无法进入计划、事件、清单、日志或备份等序列化面（ADR-0004/0029）。
#[derive(Clone)]
pub struct CredentialValue(String);

impl CredentialValue {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for CredentialValue {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("CredentialValue([redacted])")
    }
}

/// Execution Backend 在执行边界解析一个引用得到的凭据；类型匹配由运行时统一校验。
#[derive(Debug, Clone)]
pub struct ResolvedCredential {
    pub kind: CredentialKind,
    pub value: CredentialValue,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Capability {
    pub id: String,
    pub version: u32,
}

impl Capability {
    pub fn new(id: impl Into<String>, version: u32) -> Self {
        Self {
            id: id.into(),
            version,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapabilityRequirement {
    pub id: String,
    pub minimum_version: u32,
    pub maximum_version: u32,
}

impl CapabilityRequirement {
    pub fn exact(id: impl Into<String>, version: u32) -> Self {
        Self {
            id: id.into(),
            minimum_version: version,
            maximum_version: version,
        }
    }

    pub fn accepts(&self, version: u32) -> bool {
        (self.minimum_version..=self.maximum_version).contains(&version)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublishingCapability {
    pub provides: Vec<Capability>,
    pub requires: Vec<CapabilityRequirement>,
}

impl PublishingCapability {
    pub fn validate(&self, adapter: &str) -> Result<(), PublishError> {
        let mut provided = BTreeSet::new();
        for capability in &self.provides {
            if capability.id.trim().is_empty() || capability.version == 0 {
                return Err(PublishError::InvalidAdapter {
                    adapter: adapter.to_string(),
                    message: "provided capabilities require a non-empty id and positive version"
                        .to_string(),
                });
            }
            if !provided.insert((&capability.id, capability.version)) {
                return Err(PublishError::InvalidAdapter {
                    adapter: adapter.to_string(),
                    message: format!(
                        "capability {}@{} is declared more than once",
                        capability.id, capability.version
                    ),
                });
            }
        }

        for requirement in &self.requires {
            if requirement.id.trim().is_empty()
                || requirement.minimum_version == 0
                || requirement.minimum_version > requirement.maximum_version
            {
                return Err(PublishError::InvalidAdapter {
                    adapter: adapter.to_string(),
                    message: "capability requirements require a valid id and version range"
                        .to_string(),
                });
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdapterDescriptor {
    pub kind: AdapterKind,
    pub id: String,
    pub version: u32,
    pub contract_version: u32,
    pub schema: AdapterSchema,
    pub capabilities: PublishingCapability,
    /// Opaque executable ids resolved by the execution backend; never raw paths or command names.
    pub allowed_programs: BTreeSet<String>,
}

impl AdapterDescriptor {
    pub fn new(
        kind: AdapterKind,
        id: impl Into<String>,
        version: u32,
        schema: AdapterSchema,
        capabilities: PublishingCapability,
    ) -> Self {
        Self {
            kind,
            id: id.into(),
            version,
            contract_version: ADAPTER_CONTRACT_VERSION,
            schema,
            capabilities,
            allowed_programs: BTreeSet::new(),
        }
    }

    pub fn with_allowed_program(mut self, program: impl Into<String>) -> Self {
        self.allowed_programs.insert(program.into());
        self
    }

    pub fn identity(&self) -> AdapterIdentity {
        AdapterIdentity::new(self.kind, self.id.clone(), self.version)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AdapterSettings {
    pub schema_version: u32,
    pub values: BTreeMap<String, Value>,
}

impl AdapterSettings {
    pub fn new(schema_version: u32) -> Self {
        Self {
            schema_version,
            values: BTreeMap::new(),
        }
    }

    pub fn with_value(mut self, key: impl Into<String>, value: Value) -> Self {
        self.values.insert(key.into(), value);
        self
    }

    pub fn string(&self, key: &str, adapter: &str) -> Result<&str, PublishError> {
        self.values.get(key).and_then(Value::as_str).ok_or_else(|| {
            PublishError::InvalidAdapterSettings {
                adapter: adapter.to_string(),
                message: format!("{key} must be a string"),
            }
        })
    }

    pub fn unsigned_number(&self, key: &str, adapter: &str) -> Result<u64, PublishError> {
        self.values.get(key).and_then(Value::as_u64).ok_or_else(|| {
            PublishError::InvalidAdapterSettings {
                adapter: adapter.to_string(),
                message: format!("{key} must be an unsigned number"),
            }
        })
    }

    pub fn boolean(&self, key: &str, adapter: &str) -> Result<bool, PublishError> {
        self.values
            .get(key)
            .and_then(Value::as_bool)
            .ok_or_else(|| PublishError::InvalidAdapterSettings {
                adapter: adapter.to_string(),
                message: format!("{key} must be a boolean"),
            })
    }

    pub fn string_list(&self, key: &str, adapter: &str) -> Result<Vec<String>, PublishError> {
        self.values
            .get(key)
            .and_then(Value::as_array)
            .and_then(|values| {
                values
                    .iter()
                    .map(|value| value.as_str().map(str::to_string))
                    .collect::<Option<Vec<_>>>()
            })
            .ok_or_else(|| PublishError::InvalidAdapterSettings {
                adapter: adapter.to_string(),
                message: format!("{key} must be a list of strings"),
            })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AdapterBinding {
    pub binding_id: String,
    pub adapter: AdapterIdentity,
    pub settings: AdapterSettings,
    /// 凭据要求名到当前 Execution Backend 引用的绑定；只保存非秘密引用（ADR-0029）。
    pub credentials: BTreeMap<String, String>,
}

impl AdapterBinding {
    pub fn new(
        binding_id: impl Into<String>,
        adapter: AdapterIdentity,
        settings: AdapterSettings,
    ) -> Self {
        Self {
            binding_id: binding_id.into(),
            adapter,
            settings,
            credentials: BTreeMap::new(),
        }
    }

    pub fn with_credential(
        mut self,
        requirement: impl Into<String>,
        reference: impl Into<String>,
    ) -> Self {
        self.credentials
            .insert(requirement.into(), reference.into());
        self
    }
}

/// 有序交付路线：一个 Delivery Destination 绑定加上 Required/Optional 语义；
/// 全部路线消费同一封存 Manifest，Required 决定聚合结果而不是执行顺序（ADR-0022）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DeliveryRoute {
    pub binding: AdapterBinding,
    pub required: bool,
}

impl DeliveryRoute {
    pub fn required(binding: AdapterBinding) -> Self {
        Self {
            binding,
            required: true,
        }
    }

    pub fn optional(binding: AdapterBinding) -> Self {
        Self {
            binding,
            required: false,
        }
    }

    pub fn route_id(&self) -> &str {
        &self.binding.binding_id
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AdapterSelection {
    pub project_provider: AdapterBinding,
    pub artifact_processors: Vec<AdapterBinding>,
    pub execution_backend: AdapterBinding,
    pub artifact_store: AdapterBinding,
    pub delivery_routes: Vec<DeliveryRoute>,
}

impl AdapterSelection {
    pub fn ordered_bindings(&self) -> Vec<&AdapterBinding> {
        let mut bindings = Vec::with_capacity(4 + self.artifact_processors.len());
        bindings.push(&self.project_provider);
        bindings.extend(self.artifact_processors.iter());
        bindings.push(&self.execution_backend);
        bindings.push(&self.artifact_store);
        bindings.extend(self.delivery_routes.iter().map(|route| &route.binding));
        bindings
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceSnapshot {
    pub revision: String,
    pub workspace_digest: Option<String>,
    pub dirty: bool,
    pub captured_at: String,
    pub reproducible: bool,
}

/// 项目发现记录的检测依据：哪个仓库内文件以何种理由标识了候选。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectDetectionEvidence {
    pub path: String,
    pub detail: String,
}

/// Repository 中发现的可发布项目入口；候选身份稳定且可移植，绑定由发布配置显式建立（ADR-0044）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectCandidate {
    pub identity: String,
    pub provider_id: String,
    pub project_root: String,
    pub evidence: Vec<ProjectDetectionEvidence>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReleaseIdentity {
    pub project_identity: String,
    pub source: SourceSnapshot,
    pub version: String,
    pub channel: String,
    pub build_sequence: Option<String>,
}

impl ReleaseIdentity {
    pub fn new(
        project_identity: impl Into<String>,
        source: SourceSnapshot,
        version: impl Into<String>,
        channel: impl Into<String>,
        build_sequence: Option<String>,
    ) -> Self {
        Self {
            project_identity: project_identity.into(),
            source,
            version: version.into(),
            channel: channel.into(),
            build_sequence,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExternalPrecondition {
    pub checked_at: String,
    pub valid_until: String,
    pub result_digest: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlanningInputSnapshot {
    pub version: u32,
    pub configuration_revision: String,
    pub runtime_revision: String,
    pub release_input: BTreeMap<String, Value>,
    pub source: SourceSnapshot,
    pub external_preconditions: BTreeMap<String, ExternalPrecondition>,
    /// Artifact Promotion 输入：既有产物集合的 Manifest digest。存在时计划跳过
    /// 构建与产物处理，交付在创建时绑定同一 Manifest（ADR-0040）。
    pub promoted_manifest_digest: Option<String>,
    pub adapters: AdapterSelection,
}

impl PlanningInputSnapshot {
    pub fn digest(&self) -> Result<String, PublishError> {
        canonical_digest(self)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanStage {
    InspectSource,
    PrepareIdentity,
    Build,
    CollectArtifacts,
    ProcessArtifacts,
    PersistManifest,
    StageRoutes,
    PublishRoutes,
    ObserveRoutes,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PlanOperation {
    RunProgram {
        program: String,
        args: Vec<String>,
        working_directory: Option<String>,
        environment_references: BTreeMap<String, String>,
    },
    AdapterAction {
        action: String,
        inputs: BTreeMap<String, Value>,
    },
}

impl PlanOperation {
    pub fn validate(&self) -> Result<(), PublishError> {
        match self {
            Self::RunProgram { program, .. } if program.trim().is_empty() => Err(
                PublishError::InvalidPlan("structured command program cannot be empty".to_string()),
            ),
            Self::RunProgram { program, args, .. }
                if contains_shell_interpreter(program, args) =>
            {
                Err(PublishError::InvalidPlan(format!(
                    "shell interpreter references are not allowed in structured publish commands: {program}"
                )))
            }
            Self::AdapterAction { action, .. } if action.trim().is_empty() => Err(
                PublishError::InvalidPlan("adapter action cannot be empty".to_string()),
            ),
            _ => Ok(()),
        }
    }
}

fn contains_shell_interpreter(program: &str, args: &[String]) -> bool {
    is_shell_interpreter(program) || args.iter().any(|arg| is_shell_interpreter(arg))
}

fn is_shell_interpreter(value: &str) -> bool {
    let normalized = value.replace('\\', "/");
    let file_name = normalized
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    matches!(
        file_name.as_str(),
        "sh" | "bash"
            | "zsh"
            | "fish"
            | "cmd"
            | "cmd.exe"
            | "powershell"
            | "powershell.exe"
            | "pwsh"
            | "pwsh.exe"
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanSideEffect {
    FileSystem,
    Network,
    SourceMutation,
    ExternalSystem,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlanNodeTemplate {
    pub local_id: String,
    pub stage: PlanStage,
    pub operation: PlanOperation,
    pub artifact_inputs: Vec<String>,
    pub artifact_outputs: Vec<String>,
    pub side_effects: Vec<PlanSideEffect>,
    pub irreversible: bool,
}

impl PlanNodeTemplate {
    pub fn command(
        local_id: impl Into<String>,
        stage: PlanStage,
        program: impl Into<String>,
        args: Vec<String>,
    ) -> Self {
        Self {
            local_id: local_id.into(),
            stage,
            operation: PlanOperation::RunProgram {
                program: program.into(),
                args,
                working_directory: None,
                environment_references: BTreeMap::new(),
            },
            artifact_inputs: Vec::new(),
            artifact_outputs: Vec::new(),
            side_effects: Vec::new(),
            irreversible: false,
        }
    }

    pub fn adapter_action(
        local_id: impl Into<String>,
        stage: PlanStage,
        action: impl Into<String>,
        inputs: BTreeMap<String, Value>,
    ) -> Self {
        Self {
            local_id: local_id.into(),
            stage,
            operation: PlanOperation::AdapterAction {
                action: action.into(),
                inputs,
            },
            artifact_inputs: Vec::new(),
            artifact_outputs: Vec::new(),
            side_effects: Vec::new(),
            irreversible: false,
        }
    }

    pub fn with_artifact_io(mut self, inputs: Vec<String>, outputs: Vec<String>) -> Self {
        self.artifact_inputs = inputs;
        self.artifact_outputs = outputs;
        self
    }

    pub fn with_side_effects(mut self, side_effects: Vec<PlanSideEffect>) -> Self {
        self.side_effects = side_effects;
        self
    }

    pub fn irreversible(mut self) -> Self {
        self.irreversible = true;
        self
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlanNode {
    pub id: String,
    pub stage: PlanStage,
    pub adapter: AdapterIdentity,
    pub binding_id: String,
    pub settings: AdapterSettings,
    pub operation: PlanOperation,
    pub depends_on: Vec<String>,
    pub artifact_inputs: Vec<String>,
    pub artifact_outputs: Vec<String>,
    pub side_effects: Vec<PlanSideEffect>,
    pub irreversible: bool,
}

/// 封存进计划的路线合同：路线身份与 Required 语义随计划摘要固定，
/// 运行时据此聚合交付结果而不回读配置（ADR-0022/0026）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanRoute {
    pub route_id: String,
    pub required: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PublishPlan {
    pub version: u32,
    pub snapshot_digest: String,
    pub adapters: Vec<AdapterBinding>,
    pub execution_backend: AdapterIdentity,
    pub routes: Vec<PlanRoute>,
    pub nodes: Vec<PlanNode>,
    pub digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArtifactCandidate {
    pub role: String,
    pub file_name: String,
    pub media_type: String,
    pub platform: String,
    pub architecture: String,
    pub size: u64,
    pub digest: String,
    pub bytes: Vec<u8>,
}

impl ArtifactCandidate {
    pub fn new(
        role: impl Into<String>,
        file_name: impl Into<String>,
        media_type: impl Into<String>,
        platform: impl Into<String>,
        architecture: impl Into<String>,
        bytes: Vec<u8>,
    ) -> Self {
        Self {
            role: role.into(),
            file_name: file_name.into(),
            media_type: media_type.into(),
            platform: platform.into(),
            architecture: architecture.into(),
            size: bytes.len() as u64,
            digest: sha256_hex(&bytes),
            bytes,
        }
    }

    pub fn verify(&self) -> Result<(), PublishError> {
        validate_artifact_metadata(
            &self.file_name,
            &self.role,
            &self.media_type,
            &self.platform,
            &self.architecture,
        )?;
        let actual = sha256_hex(&self.bytes);
        if actual != self.digest || self.size != self.bytes.len() as u64 {
            return Err(PublishError::ArtifactDigestMismatch {
                artifact: self.file_name.clone(),
                expected: self.digest.clone(),
                actual,
            });
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArtifactManifestEntry {
    pub role: String,
    pub file_name: String,
    pub media_type: String,
    pub platform: String,
    pub architecture: String,
    pub size: u64,
    pub digest: String,
    pub locator: String,
    pub retention: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArtifactManifest {
    pub version: u32,
    pub planning_snapshot_digest: String,
    pub artifacts: Vec<ArtifactManifestEntry>,
    pub digest: String,
}

impl ArtifactManifest {
    pub fn seal(
        planning_snapshot_digest: impl Into<String>,
        artifacts: Vec<ArtifactManifestEntry>,
    ) -> Result<Self, PublishError> {
        if artifacts.is_empty() {
            return Err(PublishError::Execution(
                "cannot seal an empty artifact manifest".to_string(),
            ));
        }
        validate_unique_file_names(&artifacts)?;
        for artifact in &artifacts {
            artifact.validate()?;
        }
        let mut manifest = Self {
            version: ARTIFACT_MANIFEST_VERSION,
            planning_snapshot_digest: planning_snapshot_digest.into(),
            artifacts,
            digest: String::new(),
        };
        manifest.digest = manifest.recomputed_digest()?;
        Ok(manifest)
    }

    pub fn recomputed_digest(&self) -> Result<String, PublishError> {
        #[derive(Serialize)]
        struct DigestInput<'a> {
            version: u32,
            planning_snapshot_digest: &'a str,
            artifacts: &'a [ArtifactManifestEntry],
        }

        canonical_digest(&DigestInput {
            version: self.version,
            planning_snapshot_digest: &self.planning_snapshot_digest,
            artifacts: &self.artifacts,
        })
    }

    pub fn validate(&self) -> Result<(), PublishError> {
        if self.version != ARTIFACT_MANIFEST_VERSION {
            return Err(PublishError::Execution(format!(
                "unsupported artifact manifest version {}",
                self.version
            )));
        }
        if self.artifacts.is_empty() {
            return Err(PublishError::Execution(
                "artifact manifest cannot be empty".to_string(),
            ));
        }
        validate_unique_file_names(&self.artifacts)?;
        for artifact in &self.artifacts {
            artifact.validate()?;
        }
        let actual = self.recomputed_digest()?;
        if actual != self.digest {
            return Err(PublishError::Execution(format!(
                "artifact manifest digest mismatch: expected {}, got {actual}",
                self.digest
            )));
        }
        Ok(())
    }
}

impl ArtifactManifestEntry {
    pub fn validate(&self) -> Result<(), PublishError> {
        validate_artifact_metadata(
            &self.file_name,
            &self.role,
            &self.media_type,
            &self.platform,
            &self.architecture,
        )?;
        if self.locator.trim().is_empty() || self.retention.trim().is_empty() {
            return Err(PublishError::InvalidArtifact {
                artifact: self.file_name.clone(),
                message: "store locator and retention are required".to_string(),
            });
        }
        if !is_sha256_digest(&self.digest) {
            return Err(PublishError::InvalidArtifact {
                artifact: self.file_name.clone(),
                message: "content digest must be a 64-character SHA-256 value".to_string(),
            });
        }
        Ok(())
    }
}

/// 内容摘要的统一形状判定：64 位十六进制 SHA-256，供清单校验与推广输入共用。
pub fn is_sha256_digest(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn validate_unique_file_names(artifacts: &[ArtifactManifestEntry]) -> Result<(), PublishError> {
    let mut file_names = BTreeSet::new();
    for artifact in artifacts {
        if !file_names.insert(artifact.file_name.as_str()) {
            return Err(PublishError::InvalidArtifact {
                artifact: artifact.file_name.clone(),
                message: "one artifact set cannot carry conflicting entries for one file name"
                    .to_string(),
            });
        }
    }
    Ok(())
}

fn validate_artifact_metadata(
    file_name: &str,
    role: &str,
    media_type: &str,
    platform: &str,
    architecture: &str,
) -> Result<(), PublishError> {
    if !is_safe_portable_relative_path(file_name) {
        return Err(PublishError::InvalidArtifact {
            artifact: file_name.to_string(),
            message: "artifact path must be a portable relative path within adapter roots"
                .to_string(),
        });
    }
    if [role, media_type, platform, architecture]
        .iter()
        .any(|value| value.trim().is_empty())
    {
        return Err(PublishError::InvalidArtifact {
            artifact: file_name.to_string(),
            message: "role, media type, platform, and architecture are required".to_string(),
        });
    }
    Ok(())
}

pub fn is_safe_portable_relative_path(path: &str) -> bool {
    !path.trim().is_empty()
        && !path.starts_with('/')
        && !path.ends_with('/')
        && !path.contains(['\\', '\0', ':'])
        && path
            .split('/')
            .all(|component| !component.is_empty() && component != "." && component != "..")
}

/// 声明的 Artifact Role 是否覆盖某个具体角色：精确条目逐一匹配；`:*` 结尾的
/// 通配条目表示声明方接受任意角色，仅用于构建发现式输出（例如 Provider 的
/// `provider-output:*`），处理器输出禁止使用通配（ADR-0035）。
pub fn declares_artifact_role(declared: &[String], role: &str) -> bool {
    declared
        .iter()
        .any(|entry| entry == role || is_artifact_role_wildcard(entry))
}

/// 通配角色声明的唯一判定，供计划校验与运行时准入共用。
pub fn is_artifact_role_wildcard(entry: &str) -> bool {
    entry.ends_with(":*")
}

/// 发布失败分类的封闭集合（ADR-0056）：只有明确的瞬时或限流失败有资格自动重试，
/// 其余分类（含未分类的 Unknown）都成为显式阻断状态。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PublishFailureCategory {
    Transient,
    RateLimited,
    Authentication,
    Authorization,
    Validation,
    Conflict,
    Policy,
    Unsupported,
    Rejected,
    Unknown,
}

impl PublishFailureCategory {
    /// 分类资格只是自动重试的必要条件；执行前还必须通过幂等探测（ADR-0051）。
    pub fn allows_automatic_retry(self) -> bool {
        matches!(self, Self::Transient | Self::RateLimited)
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Transient => "transient",
            Self::RateLimited => "rate_limited",
            Self::Authentication => "authentication",
            Self::Authorization => "authorization",
            Self::Validation => "validation",
            Self::Conflict => "conflict",
            Self::Policy => "policy",
            Self::Unsupported => "unsupported",
            Self::Rejected => "rejected",
            Self::Unknown => "unknown",
        }
    }
}

/// Adapter 返回的版本化结构失败描述：分类、原始错误码、副作用是否确定未发生
/// 和可选 retry-after；Runner 不解析错误字符串（ADR-0056）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublishFailure {
    pub version: u32,
    pub category: PublishFailureCategory,
    pub native_code: String,
    pub message: String,
    /// true 表示失败时外部副作用确定未发生，false 表示结果不确定。这个字段
    /// 供控制面呈现与审计使用；自动重试不因 true 而跳过幂等探测——任何
    /// 可重试副作用都必须先探测远端状态（ADR-0051）。
    pub retry_safe: bool,
    pub retry_after_seconds: Option<u64>,
}

/// 交付幂等身份（ADR-0051）：由发布尝试、计划节点、发布身份、产物清单摘要和
/// 交付路线共同确定的外部副作用身份；目标状态必须可探测且摘要一致才能安全复用。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeliveryIdempotencyIdentity {
    pub attempt_id: String,
    pub plan_node_id: String,
    pub release_identity: ReleaseIdentity,
    pub manifest_digest: String,
    pub route_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryStatus {
    Pending,
    Staged,
    Submitted,
    Published,
    Failed,
    Rejected,
    Cancelled,
    Expired,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeliveryReceipt {
    pub version: u32,
    pub receipt_id: String,
    pub revision: u32,
    pub route_id: String,
    pub manifest_digest: String,
    pub status: DeliveryStatus,
    pub external_reference: String,
}

/// 路线专属交付封装：交付目标在 staging 阶段从封存 Manifest、发布输入和路线设置
/// 派生的目标原生元数据；它只属于一条路线，不能修改共享产物或替换 Manifest（ADR-0055）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DeliveryEnvelope {
    pub route_id: String,
    pub manifest_digest: String,
    pub content: BTreeMap<String, Value>,
}

impl DeliveryEnvelope {
    pub fn new(route_id: impl Into<String>, manifest_digest: impl Into<String>) -> Self {
        Self {
            route_id: route_id.into(),
            manifest_digest: manifest_digest.into(),
            content: BTreeMap::new(),
        }
    }

    pub fn with_content(mut self, key: impl Into<String>, value: Value) -> Self {
        self.content.insert(key.into(), value);
        self
    }

    pub fn validate(&self) -> Result<(), PublishError> {
        if self.route_id.trim().is_empty() || self.manifest_digest.trim().is_empty() {
            return Err(PublishError::Execution(
                "delivery envelopes require a route id and a sealed manifest digest".to_string(),
            ));
        }
        Ok(())
    }
}

impl DeliveryReceipt {
    pub fn published(
        receipt_id: impl Into<String>,
        route_id: impl Into<String>,
        manifest_digest: impl Into<String>,
        external_reference: impl Into<String>,
    ) -> Self {
        Self {
            version: DELIVERY_RECEIPT_VERSION,
            receipt_id: receipt_id.into(),
            revision: 1,
            route_id: route_id.into(),
            manifest_digest: manifest_digest.into(),
            status: DeliveryStatus::Published,
            external_reference: external_reference.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PublishEvent {
    pub version: u32,
    pub event_id: String,
    pub attempt_id: String,
    pub backend_run_id: String,
    pub sequence: u64,
    pub plan_digest: String,
    pub plan_node_id: String,
    pub kind: String,
    pub payload: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PublishAttemptStatus {
    Running,
    Published,
    /// Required Route 失败但至少一条路线已 Published；已发布的不可变交付不被否定（ADR-0022）。
    PartialDelivery,
    Failed,
    /// 尚无任何交付时被取消的尝试；已 Published 的路线存在时按路线聚合，
    /// 不会整体呈现为 Cancelled（ADR-0041）。
    Cancelled,
}

/// 事件历史观察到的计划节点状态；被跳过的节点不产生事件，因此不出现（ADR-0057）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanNodeExecutionState {
    Completed,
    Failed,
}

/// 单条交付路线的聚合结果：状态、外部引用与错误按路线呈现，
/// 只有 Published 满足 Required Route（ADR-0039）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RouteDeliveryView {
    pub route_id: String,
    pub required: bool,
    pub status: DeliveryStatus,
    pub external_reference: Option<String>,
    pub error: Option<String>,
    /// route_failed 事件携带的结构化 Publish Failure Classification；
    /// 自动重试资格只依据这里的分类，从不解析 error 字符串（ADR-0056）。
    pub failure: Option<PublishFailure>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReleaseAttempt {
    pub version: u32,
    pub attempt_id: String,
    pub configuration_revision: String,
    pub planning_snapshot_digest: String,
    pub plan_version: u32,
    pub plan_digest: String,
    pub release_identity: ReleaseIdentity,
    pub execution_backend: AdapterIdentity,
    pub runtime_revision: String,
    pub backend_run_id: String,
    pub manifest_digest: Option<String>,
}

/// 租约保护的真实共享资源种类（ADR-0042）：仓库写入、发布命名空间、
/// 产物身份与目标命名空间。冲突判定只看种类与 key，不含目标特例。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PublishResourceKind {
    RepositoryWrite,
    ReleaseNamespace,
    ArtifactIdentity,
    DestinationNamespace,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct PublishResource {
    pub kind: PublishResourceKind,
    pub key: String,
}

impl PublishResource {
    pub fn new(kind: PublishResourceKind, key: impl Into<String>) -> Self {
        Self {
            kind,
            key: key.into(),
        }
    }

    pub fn display_name(&self) -> String {
        format!("{:?}({})", self.kind, self.key)
    }
}

/// 一次续租的不可变记录：续租时间与新期限。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LeaseRenewal {
    pub renewed_at_seconds: u64,
    pub expires_at_seconds: u64,
}

/// 发布资源租约（ADR-0042）：发布尝试在执行前取得的限时资源所有权，
/// 具有所有者、范围、期限与续租记录；时间是显式输入，核心不读系统时钟。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublishResourceLease {
    pub version: u32,
    pub lease_id: String,
    pub owner_attempt_id: String,
    pub resources: BTreeSet<PublishResource>,
    pub acquired_at_seconds: u64,
    pub expires_at_seconds: u64,
    pub renewals: Vec<LeaseRenewal>,
}

impl PublishResourceLease {
    /// 到期时刻本身即失效：所有权不确定时不得继续外部写入。
    pub fn is_expired(&self, now_seconds: u64) -> bool {
        now_seconds >= self.expires_at_seconds
    }

    pub fn validate(&self) -> Result<(), PublishError> {
        if self.version != PUBLISH_RESOURCE_LEASE_VERSION {
            return Err(PublishError::UnsupportedLeaseVersion {
                actual: self.version,
                expected: PUBLISH_RESOURCE_LEASE_VERSION,
            });
        }
        if self.lease_id.trim().is_empty() || self.owner_attempt_id.trim().is_empty() {
            return Err(PublishError::Execution(
                "publish resource leases require a lease id and an owner attempt id".to_string(),
            ));
        }
        if self.resources.is_empty()
            || self
                .resources
                .iter()
                .any(|resource| resource.key.trim().is_empty())
        {
            return Err(PublishError::Execution(format!(
                "publish resource lease {} must scope at least one concrete resource with a non-empty key",
                self.lease_id
            )));
        }
        if self.expires_at_seconds <= self.acquired_at_seconds {
            return Err(PublishError::Execution(format!(
                "publish resource lease {} must expire after it is acquired",
                self.lease_id
            )));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PublishAttemptView {
    pub attempt: ReleaseAttempt,
    pub status: PublishAttemptStatus,
    pub manifest: Option<ArtifactManifest>,
    pub events: Vec<PublishEvent>,
    /// 每个 Receipt 的当前修订；完整修订历史在 receipt_history 里（ADR-0057）。
    pub receipts: Vec<DeliveryReceipt>,
    /// 同一 Receipt ID 下的全部不可变修订，按因果归约顺序排列。
    pub receipt_history: Vec<DeliveryReceipt>,
    /// 事件历史观察到的计划节点状态，重启后据此识别已执行节点。
    pub node_states: BTreeMap<String, PlanNodeExecutionState>,
    pub routes: Vec<RouteDeliveryView>,
    /// 不影响聚合成功的可见警告，例如 Optional Route 失败（ADR-0022）。
    pub warnings: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PublishOutcome {
    pub manifest: ArtifactManifest,
    pub events: Vec<PublishEvent>,
    pub receipts: Vec<DeliveryReceipt>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AutomationTriggerPolicy {
    TagPush { tag_prefix: String },
    Manual,
}

/// 分层的只读运行投影：公开设置、受保护变量引用与秘密引用；三层都不携带秘密值。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct AutomationProjection {
    pub public_settings: BTreeMap<String, Value>,
    pub protected_variables: BTreeMap<String, String>,
    pub secret_references: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AutomationBindingProjection {
    pub binding_id: String,
    pub configuration_id: String,
    pub configuration_revision_id: String,
    pub trigger_policy: AutomationTriggerPolicy,
    /// Binding 可产生的 Release Identity 范围；冲突判断使用该事实，不读取文件名或 Provider 类型。
    pub release_namespace: String,
    /// Binding 会写入的目标范围；与 Release Namespace 共同构成自动化冲突键。
    pub delivery_destination_namespaces: Vec<String>,
    pub runtime_revision: PinnedAutomationRuntimeRevision,
    pub projection: AutomationProjection,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuntimeComponentRevision {
    pub version: String,
    pub digest: String,
}

impl RuntimeComponentRevision {
    pub fn new(version: impl Into<String>, digest: impl Into<String>) -> Self {
        Self {
            version: version.into(),
            digest: digest.into(),
        }
    }

    fn validate(&self, name: &str) -> Result<(), PublishError> {
        let version = self.version.trim();
        if version.is_empty() {
            return Err(PublishError::InvalidRuntimeRevision(format!(
                "{name} version is required"
            )));
        }
        if matches!(
            version.to_ascii_lowercase().as_str(),
            "latest" | "stable" | "main" | "master" | "nightly"
        ) {
            return Err(PublishError::InvalidRuntimeRevision(format!(
                "{name} version {version} is floating"
            )));
        }
        if !is_sha256_digest(&self.digest) {
            return Err(PublishError::InvalidRuntimeRevision(format!(
                "{name} digest must be a lowercase SHA-256 digest"
            )));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuntimeAdapterRevision {
    pub adapter: AdapterIdentity,
    pub digest: String,
}

impl RuntimeAdapterRevision {
    pub fn new(adapter: AdapterIdentity, digest: impl Into<String>) -> Self {
        Self {
            adapter,
            digest: digest.into(),
        }
    }

    fn validate(&self) -> Result<(), PublishError> {
        if !is_sha256_digest(&self.digest) {
            return Err(PublishError::InvalidRuntimeRevision(format!(
                "adapter {} digest must be a lowercase SHA-256 digest",
                self.adapter.display_name()
            )));
        }
        Ok(())
    }
}

/// 自动化安装所固定的完整 Runner 合同身份。顶层摘要封存 Runner、Publish
/// Plan 合同和全部内置 Adapter 的精确版本与内容摘要（ADR-0046）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AutomationRuntimeRevision {
    pub version: u32,
    pub runner: RuntimeComponentRevision,
    pub plan_contract: RuntimeComponentRevision,
    pub adapters: Vec<RuntimeAdapterRevision>,
    pub digest: String,
}

/// 持久化 Binding 的 runtime pin。`Legacy` 只用于无损承接 schema v2
/// 已安装自动化；新安装和显式升级始终写入可验证的 `Exact` 修订。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PinnedAutomationRuntimeRevision {
    Exact(AutomationRuntimeRevision),
    Legacy(String),
}

impl PinnedAutomationRuntimeRevision {
    pub fn identifier(&self) -> String {
        match self {
            Self::Exact(revision) => revision.identifier(),
            Self::Legacy(identifier) => identifier.clone(),
        }
    }

    pub fn validate_for_projection(&self) -> Result<(), PublishError> {
        match self {
            Self::Exact(revision) => revision.validate(),
            Self::Legacy(identifier) => {
                let identifier = identifier.trim();
                if identifier.is_empty()
                    || matches!(
                        identifier.to_ascii_lowercase().as_str(),
                        "latest" | "stable" | "main" | "master" | "nightly"
                    )
                {
                    return Err(PublishError::InvalidRuntimeRevision(
                        "legacy runtime revision must be a fixed non-empty identifier".to_string(),
                    ));
                }
                Ok(())
            }
        }
    }

    pub fn exact(&self) -> Result<&AutomationRuntimeRevision, PublishError> {
        match self {
            Self::Exact(revision) => Ok(revision),
            Self::Legacy(identifier) => Err(PublishError::InvalidRuntimeRevision(format!(
                "legacy runtime revision {identifier} must be explicitly upgraded before shared Runner execution"
            ))),
        }
    }
}

impl From<AutomationRuntimeRevision> for PinnedAutomationRuntimeRevision {
    fn from(value: AutomationRuntimeRevision) -> Self {
        Self::Exact(value)
    }
}

impl AutomationRuntimeRevision {
    pub fn seal(
        runner: RuntimeComponentRevision,
        plan_contract: RuntimeComponentRevision,
        mut adapters: Vec<RuntimeAdapterRevision>,
    ) -> Result<Self, PublishError> {
        adapters.sort_by(|left, right| left.adapter.cmp(&right.adapter));
        let mut revision = Self {
            version: AUTOMATION_RUNTIME_REVISION_VERSION,
            runner,
            plan_contract,
            adapters,
            digest: String::new(),
        };
        revision.validate_components()?;
        revision.digest = revision.recomputed_digest()?;
        Ok(revision)
    }

    pub fn identifier(&self) -> String {
        format!("runtime-v{}-{}", self.version, self.digest)
    }

    pub fn validate(&self) -> Result<(), PublishError> {
        if self.version != AUTOMATION_RUNTIME_REVISION_VERSION {
            return Err(PublishError::InvalidRuntimeRevision(format!(
                "unsupported contract version {}; expected {}",
                self.version, AUTOMATION_RUNTIME_REVISION_VERSION
            )));
        }
        self.validate_components()?;
        let actual = self.recomputed_digest()?;
        if self.digest != actual {
            return Err(PublishError::InvalidRuntimeRevision(format!(
                "digest mismatch: expected {}, got {}",
                self.digest, actual
            )));
        }
        Ok(())
    }

    fn validate_components(&self) -> Result<(), PublishError> {
        self.runner.validate("runner")?;
        self.plan_contract.validate("publish plan contract")?;
        if self.adapters.is_empty() {
            return Err(PublishError::InvalidRuntimeRevision(
                "at least one adapter revision is required".to_string(),
            ));
        }
        let mut previous: Option<&AdapterIdentity> = None;
        for adapter in &self.adapters {
            adapter.validate()?;
            if let Some(previous) = previous {
                if previous >= &adapter.adapter {
                    return Err(PublishError::InvalidRuntimeRevision(
                        "adapter revisions must be unique and sorted by identity".to_string(),
                    ));
                }
            }
            previous = Some(&adapter.adapter);
        }
        Ok(())
    }

    fn recomputed_digest(&self) -> Result<String, PublishError> {
        #[derive(Serialize)]
        struct DigestInput<'a> {
            version: u32,
            runner: &'a RuntimeComponentRevision,
            plan_contract: &'a RuntimeComponentRevision,
            adapters: &'a [RuntimeAdapterRevision],
        }

        canonical_digest(&DigestInput {
            version: self.version,
            runner: &self.runner,
            plan_contract: &self.plan_contract,
            adapters: &self.adapters,
        })
    }
}

pub fn validate_automation_runtime_revision_identifier(
    identifier: &str,
) -> Result<(), PublishError> {
    let prefix = format!("runtime-v{AUTOMATION_RUNTIME_REVISION_VERSION}-");
    let digest = identifier.strip_prefix(&prefix).ok_or_else(|| {
        PublishError::InvalidRuntimeRevision(format!(
            "runtime revision identifier must start with {prefix}"
        ))
    })?;
    if !is_sha256_digest(digest) {
        return Err(PublishError::InvalidRuntimeRevision(
            "runtime revision identifier must end with a lowercase SHA-256 digest".to_string(),
        ));
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AutomationBundleFile {
    pub content: String,
    /// 拥有该资源的绑定；None 表示由整个 Bundle 共享（例如 Bundle 清单）。
    pub binding_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutomationFileChangeKind {
    Added,
    Updated,
    Removed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AutomationBundleFileChange {
    pub path: String,
    pub kind: AutomationFileChangeKind,
    pub current_content: Option<String>,
    pub expected_content: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AutomationProjectionBundle {
    pub version: u32,
    pub backend: AdapterIdentity,
    pub files: BTreeMap<String, AutomationBundleFile>,
    pub digest: String,
}

impl AutomationProjectionBundle {
    pub fn seal(
        backend: AdapterIdentity,
        files: BTreeMap<String, AutomationBundleFile>,
    ) -> Result<Self, PublishError> {
        if files.is_empty() {
            return Err(PublishError::Execution(
                "cannot seal an empty automation projection bundle".to_string(),
            ));
        }
        for path in files.keys() {
            if !is_safe_portable_relative_path(path) {
                return Err(PublishError::InvalidArtifact {
                    artifact: path.clone(),
                    message: "bundle path must be a portable relative path inside the repository"
                        .to_string(),
                });
            }
        }
        let mut bundle = Self {
            version: AUTOMATION_PROJECTION_BUNDLE_VERSION,
            backend,
            files,
            digest: String::new(),
        };
        bundle.digest = bundle.recomputed_digest()?;
        Ok(bundle)
    }

    pub fn recomputed_digest(&self) -> Result<String, PublishError> {
        #[derive(Serialize)]
        struct DigestInput<'a> {
            version: u32,
            backend: &'a AdapterIdentity,
            files: &'a BTreeMap<String, AutomationBundleFile>,
        }

        canonical_digest(&DigestInput {
            version: self.version,
            backend: &self.backend,
            files: &self.files,
        })
    }

    pub fn validate(&self) -> Result<(), PublishError> {
        if self.version != AUTOMATION_PROJECTION_BUNDLE_VERSION {
            return Err(PublishError::Execution(format!(
                "unsupported automation projection bundle version {}",
                self.version
            )));
        }
        let actual = self.recomputed_digest()?;
        if actual != self.digest {
            return Err(PublishError::Execution(format!(
                "automation projection bundle digest mismatch: expected {}, got {actual}",
                self.digest
            )));
        }
        Ok(())
    }

    /// 以期望文件与既有归属的并集为边界，对仓库现状做差异；不触碰边界外的仓库文件。
    pub fn diff_against(
        &self,
        actual_files: &BTreeMap<String, String>,
        previously_owned: &BTreeSet<String>,
    ) -> Vec<AutomationBundleFileChange> {
        diff_automation_files(&self.files, actual_files, previously_owned)
    }
}

/// 独立的差异函数：期望文件集允许为空（例如解除最后一个绑定后）。
pub fn diff_automation_files(
    expected_files: &BTreeMap<String, AutomationBundleFile>,
    actual_files: &BTreeMap<String, String>,
    previously_owned: &BTreeSet<String>,
) -> Vec<AutomationBundleFileChange> {
    let candidates = expected_files
        .keys()
        .chain(previously_owned.iter())
        .collect::<BTreeSet<_>>();

    candidates
        .into_iter()
        .filter_map(|path| {
            let expected = expected_files.get(path).map(|file| file.content.as_str());
            let actual = actual_files.get(path).map(String::as_str);
            let kind = match (expected, actual) {
                (Some(_), None) => AutomationFileChangeKind::Added,
                (Some(expected), Some(actual)) if expected != actual => {
                    AutomationFileChangeKind::Updated
                }
                (None, Some(_)) => AutomationFileChangeKind::Removed,
                _ => return None,
            };
            Some(AutomationBundleFileChange {
                path: path.clone(),
                kind,
                current_content: actual.map(str::to_string),
                expected_content: expected.map(str::to_string),
            })
        })
        .collect()
}

impl PublishPlan {
    pub fn seal(
        snapshot_digest: String,
        adapters: Vec<AdapterBinding>,
        execution_backend: AdapterIdentity,
        routes: Vec<PlanRoute>,
        nodes: Vec<PlanNode>,
    ) -> Result<Self, PublishError> {
        let mut plan = Self {
            version: PUBLISH_PLAN_VERSION,
            snapshot_digest,
            adapters,
            execution_backend,
            routes,
            nodes,
            digest: String::new(),
        };
        plan.digest = plan.recomputed_digest()?;
        Ok(plan)
    }

    pub fn recomputed_digest(&self) -> Result<String, PublishError> {
        #[derive(Serialize)]
        struct DigestInput<'a> {
            version: u32,
            snapshot_digest: &'a str,
            adapters: &'a [AdapterBinding],
            execution_backend: &'a AdapterIdentity,
            routes: &'a [PlanRoute],
            nodes: &'a [PlanNode],
        }

        canonical_digest(&DigestInput {
            version: self.version,
            snapshot_digest: &self.snapshot_digest,
            adapters: &self.adapters,
            execution_backend: &self.execution_backend,
            routes: &self.routes,
            nodes: &self.nodes,
        })
    }
}

pub fn canonical_digest<T: Serialize>(value: &T) -> Result<String, PublishError> {
    let serialized = serde_json::to_value(value).map_err(|error| {
        PublishError::InvalidPlan(format!("cannot serialize contract: {error}"))
    })?;
    let canonical = canonicalize_json(serialized);
    let bytes = serde_json::to_vec(&canonical).map_err(|error| {
        PublishError::InvalidPlan(format!("cannot serialize canonical contract: {error}"))
    })?;
    Ok(sha256_hex(&bytes))
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn canonicalize_json(value: Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.into_iter().map(canonicalize_json).collect()),
        Value::Object(values) => {
            let sorted = values
                .into_iter()
                .map(|(key, value)| (key, canonicalize_json(value)))
                .collect::<BTreeMap<_, _>>();
            Value::Object(sorted.into_iter().collect())
        }
        scalar => scalar,
    }
}
