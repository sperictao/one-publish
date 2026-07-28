use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use publish_adapters::{
    AdapterConformanceFixture, AdapterContract, AdapterExecutionContext, AdapterExecutionOutput,
    AdapterRegistry, ChecksumProcessor, GhCliGitHubReleaseApi, GitHubReleaseDestination,
    LocalDirectoryDestination, LocalExecutionBackend, OpenSshSftpTransport, ProjectProvider,
    SftpDeliveryDestination, TauriBuildDriver, TauriProjectProvider, TemporaryArtifactStore,
    CHECKSUM_PROCESSOR_ID, GITHUB_RELEASE_DESTINATION_ID, SFTP_DESTINATION_ID,
    TAURI_INSPECT_ACTION, TAURI_PROVIDER_ID,
};
use publish_domain::{
    AdapterBinding, AdapterDescriptor, AdapterIdentity, AdapterKind, AdapterSchema,
    AdapterSelection, AdapterSettings, ArtifactCandidate, Capability, CapabilityRequirement,
    DeliveryRoute, DeliveryStatus, PlanNode, PlanNodeTemplate, PlanOperation, PlanStage,
    PlanningInputSnapshot, PublishAttemptStatus, PublishAttemptView, PublishError, PublishResource,
    PublishResourceKind, PublishingCapability, ReleaseIdentity, SourceSnapshot,
    PLANNING_INPUT_SNAPSHOT_VERSION,
};
use publish_runner_core::{
    AttemptExecutionContext, PreparedPublishPlan, PublishLeaseCoordinator, PublishRuntime,
    StartPublishAttempt,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use ts_rs::TS;

use crate::commands::{
    preflight_publish_output, render_provider_publish, PublishOutputAccessStatus,
    PublishOutputValidationStatus, RemoteLocationKind, RenderedPublishCommand, SealedBuildCommand,
};
use crate::errors::AppError;
use crate::provider::{registry::provider_registry, ProviderSourceInputKind};
use crate::spec::PublishSpec;
use crate::tauri_release::ReleaseGate;

const SELECTED_PROVIDER_ID: &str = "selected-project-provider";
const SELECTED_PROVIDER_PROGRAM: &str = "selected-project-provider:publish";
use crate::store::{
    PublishComposition, RevisionAdapterBinding, LOCAL_BACKEND_ID, LOCAL_DESTINATION_ID,
    TEMPORARY_STORE_ID,
};
/// 桌面端产物存储的明确保留期限：7 天（ADR-0038）。
const ARTIFACT_RETENTION_SECONDS: u64 = 604_800;
const STRUCTURED_PLAN_EXECUTION: &str = "structured-plan-execution";
const ARTIFACT_VERIFIED: &str = "artifact-verified";
const RUNTIME_REVISION: &str = "one-publish-runtime-v1";
/// Tauri 配置的 Release Gate 计划节点动作；门禁位于构建与交付副作用之前（ADR-0014）。
const TAURI_RELEASE_GATE_ACTION: &str = "run_release_gate";
const RELEASE_GATES_INPUT: &str = "release_gates";
static ATTEMPT_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// 进行中 Attempt 的取消信号注册表：键是密封运行令牌的摘要——控制面在
/// start 阻塞期间唯一可预知的取消句柄（attempt 身份在执行内部才诞生）。
static ACTIVE_ATTEMPT_CANCELLATIONS: Mutex<
    BTreeMap<String, Vec<(u64, publish_runner_core::CancellationSignal)>>,
> = Mutex::new(BTreeMap::new());
static CANCELLATION_SLOT_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// 一次执行在取消注册表中的占位；Drop 时自行注销，执行失败也不遗留悬空信号。
struct RegisteredCancellation {
    token_digest: String,
    slot_id: u64,
    signal: publish_runner_core::CancellationSignal,
}

impl RegisteredCancellation {
    fn register(runtime_token: &str) -> Result<Self, AppError> {
        let token_digest = publish_domain::sha256_hex(runtime_token.as_bytes());
        let slot_id = CANCELLATION_SLOT_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let signal = publish_runner_core::CancellationSignal::new();
        ACTIVE_ATTEMPT_CANCELLATIONS
            .lock()
            .map_err(|_| cancellation_registry_poisoned())?
            .entry(token_digest.clone())
            .or_default()
            .push((slot_id, signal.clone()));
        Ok(Self {
            token_digest,
            slot_id,
            signal,
        })
    }
}

impl Drop for RegisteredCancellation {
    fn drop(&mut self) {
        if let Ok(mut registry) = ACTIVE_ATTEMPT_CANCELLATIONS.lock() {
            if let Some(slots) = registry.get_mut(&self.token_digest) {
                slots.retain(|(slot_id, _)| *slot_id != self.slot_id);
                if slots.is_empty() {
                    registry.remove(&self.token_digest);
                }
            }
        }
    }
}

fn cancellation_registry_poisoned() -> AppError {
    AppError::publish_with_code(
        "publish cancellation registry lock is poisoned",
        "publish_runtime_cancellation_poisoned",
    )
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct CancelPublishRuntimeRequest {
    pub runtime_token: String,
}

/// 请求协作取消该密封令牌下所有进行中的 Attempt（ADR-0041）：已开始的节点
/// 不被中断，已 Published 的路线保持不变。返回是否存在被请求的执行。
#[tauri::command]
pub fn cancel_publish_runtime(request: CancelPublishRuntimeRequest) -> Result<bool, AppError> {
    let token_digest = publish_domain::sha256_hex(request.runtime_token.as_bytes());
    let registry = ACTIVE_ATTEMPT_CANCELLATIONS
        .lock()
        .map_err(|_| cancellation_registry_poisoned())?;
    let Some(slots) = registry.get(&token_digest) else {
        return Ok(false);
    };
    for (_, signal) in slots {
        signal.request();
    }
    Ok(!slots.is_empty())
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct PreparePublishRuntimeRequest {
    pub repository_id: String,
    pub repository_path: String,
    pub configuration_id: String,
    pub configuration_revision_id: String,
    pub spec: PublishSpec,
    /// Artifact Promotion：复用既有封存 Manifest 的新 Attempt 输入；普通构建为空。
    #[serde(default)]
    #[ts(optional)]
    pub promoted_manifest_digest: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ResolvedPublishConfiguration {
    pub provider_id: String,
    pub parameters: Value,
    pub composition: PublishComposition,
    pub blocked_reason: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum RuntimePlanStage {
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct RuntimePlanNodeSummary {
    pub id: String,
    pub stage: RuntimePlanStage,
    pub adapter_id: String,
    pub operation: String,
    pub irreversible: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct RuntimePlanSummary {
    pub version: u32,
    pub digest: String,
    pub snapshot_digest: String,
    pub execution_backend: String,
    pub nodes: Vec<RuntimePlanNodeSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct PreparedPublishRuntime {
    pub configuration_id: String,
    pub configuration_revision_id: String,
    pub command: RenderedPublishCommand,
    pub plan: RuntimePlanSummary,
    pub blocked_reason: Option<String>,
    pub runtime_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct StartPublishRuntimeRequest {
    pub runtime_token: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum RuntimeAttemptStatus {
    Running,
    Published,
    PartialDelivery,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct RuntimeArtifactManifestSummary {
    pub digest: String,
    pub artifact_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum RuntimeDeliveryStatus {
    Pending,
    Staged,
    Submitted,
    Published,
    Failed,
    Rejected,
    Cancelled,
    Expired,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct RuntimeDeliveryReceiptSummary {
    pub version: u32,
    pub receipt_id: String,
    pub revision: u32,
    pub route_id: String,
    pub manifest_digest: String,
    pub status: RuntimeDeliveryStatus,
    pub external_reference: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct RuntimePublishEventSummary {
    pub event_id: String,
    pub plan_node_id: String,
    pub kind: String,
    pub manifest_digest: Option<String>,
    pub receipt_id: Option<String>,
    pub delivery_status: Option<String>,
    pub receipt: Option<RuntimeDeliveryReceiptSummary>,
    pub error: Option<String>,
}

/// 单条 Delivery Route 的聚合结果：状态、外部引用与错误逐路线呈现（Issue T09）。
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct RuntimeRouteSummary {
    pub route_id: String,
    pub required: bool,
    pub status: RuntimeDeliveryStatus,
    pub external_reference: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct RuntimeAttemptResult {
    pub attempt_id: String,
    pub backend_run_id: String,
    pub configuration_revision_id: String,
    pub plan_digest: String,
    pub execution_backend: String,
    pub status: RuntimeAttemptStatus,
    pub manifest_digest: Option<String>,
    pub manifest: Option<RuntimeArtifactManifestSummary>,
    pub receipts: Vec<RuntimeDeliveryReceiptSummary>,
    pub routes: Vec<RuntimeRouteSummary>,
    pub warnings: Vec<String>,
    pub events: Vec<RuntimePublishEventSummary>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct PublishRuntimeResult {
    pub attempt: RuntimeAttemptResult,
    pub publish_result: Option<crate::commands::PublishResult>,
}

pub(crate) trait ProviderExecutionPort: Send + Sync {
    fn execute(&self, spec: PublishSpec) -> Result<crate::commands::PublishResult, AppError>;

    /// 运行密封计划节点物化出的结构化构建命令；执行层不得重新推导或替换命令。
    fn execute_build(
        &self,
        request: SealedBuildCommand,
    ) -> Result<crate::commands::PublishResult, AppError>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AttemptIdentity {
    pub attempt_id: String,
    pub backend_run_id: String,
}

struct SelectedProviderExecution {
    port: Arc<dyn ProviderExecutionPort>,
    result: Arc<Mutex<Option<crate::commands::PublishResult>>>,
    output_directory: PathBuf,
    source_guard: PreparedSourceGuard,
}

struct SelectedProjectProvider {
    descriptor: AdapterDescriptor,
    spec_json: String,
    execution: Option<SelectedProviderExecution>,
}

impl SelectedProjectProvider {
    fn with_execution(spec_json: String, execution: Option<SelectedProviderExecution>) -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ProjectProvider,
                SELECTED_PROVIDER_ID,
                1,
                AdapterSchema::new(1).with_required_string("spec_json"),
                PublishingCapability {
                    provides: vec![Capability::new(ARTIFACT_VERIFIED, 1)],
                    requires: vec![CapabilityRequirement::exact(STRUCTURED_PLAN_EXECUTION, 1)],
                },
            )
            .with_allowed_program(SELECTED_PROVIDER_PROGRAM),
            spec_json,
            execution,
        }
    }
}

impl AdapterContract for SelectedProjectProvider {
    fn descriptor(&self) -> &AdapterDescriptor {
        &self.descriptor
    }

    fn default_settings(&self) -> AdapterSettings {
        AdapterSettings::new(1).with_value("spec_json", Value::String(self.spec_json.clone()))
    }

    fn plan_fragment(
        &self,
        _snapshot: &PlanningInputSnapshot,
        settings: &AdapterSettings,
    ) -> Result<Vec<PlanNodeTemplate>, PublishError> {
        settings.string("spec_json", &self.descriptor.identity().display_name())?;
        Ok(vec![PlanNodeTemplate::command(
            "build",
            PlanStage::Build,
            SELECTED_PROVIDER_PROGRAM,
            Vec::new(),
        )
        .with_artifact_io(
            Vec::new(),
            vec!["provider-output:*".to_string()],
        )])
    }

    fn execute_node(
        &self,
        node: &PlanNode,
        _context: &AdapterExecutionContext<'_>,
    ) -> Result<AdapterExecutionOutput, PublishError> {
        match &node.operation {
            PlanOperation::RunProgram {
                program,
                args,
                working_directory,
                environment_references,
            } if program == SELECTED_PROVIDER_PROGRAM
                && args.is_empty()
                && working_directory.is_none()
                && environment_references.is_empty() => {}
            _ => {
                return Err(PublishError::Execution(format!(
                    "node {} is not the sealed selected-provider operation",
                    node.id
                )))
            }
        }

        let planned_spec = node
            .settings
            .string("spec_json", &self.descriptor.identity().display_name())?;
        if planned_spec != self.spec_json {
            return Err(PublishError::InvalidPlan(
                "selected-provider node changed its sealed publish spec".to_string(),
            ));
        }
        let execution = self.execution.as_ref().ok_or_else(|| {
            PublishError::Execution(
                "selected-provider execution port is unavailable for this runtime".to_string(),
            )
        })?;
        run_bridged_execution(execution, planned_spec)
    }
}

impl ProjectProvider for SelectedProjectProvider {}

/// 通过既有 Provider 执行管道运行密封的发布规格并收集产物；
/// 非 Tauri Provider 的构建执行迁移属于后续 Ticket，这里只保证计划与执行共享一个事实来源。
fn run_bridged_execution(
    execution: &SelectedProviderExecution,
    spec_json: &str,
) -> Result<AdapterExecutionOutput, PublishError> {
    let spec: PublishSpec = serde_json::from_str(spec_json).map_err(|error| {
        PublishError::Execution(format!("cannot decode sealed publish spec: {error}"))
    })?;
    let result = execution
        .port
        .execute(spec)
        .map_err(|error| PublishError::Execution(error.to_string()))?;
    finish_provider_execution(execution, result, classify_generic_artifact)
}

/// 校验 Provider 执行结果并从其原生输出目录收集产物；失败保留根因并阻止后续副作用。
fn finish_provider_execution(
    execution: &SelectedProviderExecution,
    result: crate::commands::PublishResult,
    classify: fn(&Path) -> (&'static str, &'static str),
) -> Result<AdapterExecutionOutput, PublishError> {
    execution
        .result
        .lock()
        .map_err(|_| PublishError::Execution("publish result lock is poisoned".to_string()))?
        .replace(result.clone());

    if result.cancelled {
        return Err(PublishError::Execution(
            result
                .error
                .unwrap_or_else(|| "provider execution was cancelled".to_string()),
        ));
    }
    if !result.success {
        return Err(PublishError::Execution(
            result
                .error
                .unwrap_or_else(|| "provider execution failed".to_string()),
        ));
    }
    if Path::new(&result.output_dir) != execution.output_directory {
        return Err(PublishError::Execution(format!(
            "provider returned output directory {}, expected {}",
            result.output_dir,
            execution.output_directory.display()
        )));
    }
    execution.source_guard.validate_for_execution()?;

    Ok(AdapterExecutionOutput {
        artifacts: collect_artifacts_with(&execution.output_directory, classify)?,
        ..AdapterExecutionOutput::default()
    })
}

/// Tauri 配置的运行时包装：发现、检查与计划委托内置 Tauri Provider（合同不变），
/// 并补充 Release Gate 节点；构建按密封计划节点直接经执行端口运行（T06），
/// 不再桥接旧的发布规格管道。
struct TauriRuntimeProvider {
    provider: TauriProjectProvider,
    default_settings: AdapterSettings,
    repository_root: PathBuf,
    execution: Option<SelectedProviderExecution>,
}

impl TauriRuntimeProvider {
    fn new(
        config_path: String,
        build_driver: String,
        repository_root: PathBuf,
        execution: Option<SelectedProviderExecution>,
    ) -> Self {
        let default_settings = AdapterSettings::new(1)
            .with_value("config_path", Value::String(config_path))
            .with_value("build_driver", Value::String(build_driver));
        Self {
            provider: TauriProjectProvider::new(),
            default_settings,
            repository_root,
            execution,
        }
    }

    /// 执行密封的 Tauri 构建节点：程序与参数只能来自计划节点固定的构建驱动，
    /// 配置入口在执行时物化为绝对路径，工作目录为应用根（与驱动命令语义一致）。
    fn run_sealed_build(
        &self,
        node: &PlanNode,
        config_path: &str,
        driver: TauriBuildDriver,
    ) -> Result<AdapterExecutionOutput, PublishError> {
        let execution = self.execution.as_ref().ok_or_else(|| {
            PublishError::Execution(
                "tauri execution port is unavailable for this runtime".to_string(),
            )
        })?;
        let absolute_config = self.repository_root.join(config_path);
        let app_root =
            publish_adapters::tauri::resolve_app_root(&absolute_config).ok_or_else(|| {
                PublishError::Execution(format!(
                    "cannot resolve Tauri app root from {config_path} for node {}",
                    node.id
                ))
            })?;
        let mut args = driver
            .build_args()
            .iter()
            .map(|arg| (*arg).to_string())
            .collect::<Vec<_>>();
        args.push("--config".to_string());
        args.push(absolute_config.to_string_lossy().to_string());
        let result = execution
            .port
            .execute_build(SealedBuildCommand {
                provider_id: TAURI_PROVIDER_ID.to_string(),
                program: driver.name().to_string(),
                args,
                working_directory: app_root,
                output_directory: execution.output_directory.clone(),
            })
            .map_err(|error| PublishError::Execution(error.to_string()))?;
        finish_provider_execution(execution, result, classify_tauri_artifact)
    }
}

impl AdapterContract for TauriRuntimeProvider {
    fn descriptor(&self) -> &AdapterDescriptor {
        self.provider.descriptor()
    }

    fn default_settings(&self) -> AdapterSettings {
        self.default_settings.clone()
    }

    fn plan_fragment(
        &self,
        snapshot: &PlanningInputSnapshot,
        settings: &AdapterSettings,
    ) -> Result<Vec<PlanNodeTemplate>, PublishError> {
        let mut templates = self.provider.plan_fragment(snapshot, settings)?;
        for (index, gate) in release_gates_from_snapshot(snapshot)?.iter().enumerate() {
            if gate.program.trim().is_empty() {
                return Err(PublishError::InvalidPlan(
                    "release gate program cannot be empty".to_string(),
                ));
            }
            templates.push(PlanNodeTemplate::adapter_action(
                format!("gate-{index}"),
                PlanStage::PrepareIdentity,
                TAURI_RELEASE_GATE_ACTION,
                release_gate_inputs(gate)?,
            ));
        }
        Ok(templates)
    }

    fn execute_node(
        &self,
        node: &PlanNode,
        _context: &AdapterExecutionContext<'_>,
    ) -> Result<AdapterExecutionOutput, PublishError> {
        let adapter = self.provider.descriptor().identity().display_name();
        let config_path = node.settings.string("config_path", &adapter)?;
        let build_driver = node.settings.string("build_driver", &adapter)?;

        match &node.operation {
            PlanOperation::AdapterAction { action, .. } if action == TAURI_INSPECT_ACTION => {
                let inspection = self.provider.inspect(&self.repository_root, config_path)?;
                if inspection.build_driver.name() != build_driver {
                    return Err(PublishError::Execution(format!(
                        "tauri build driver drifted from {build_driver} to {}; re-prepare the publish plan",
                        inspection.build_driver.name()
                    )));
                }
                Ok(AdapterExecutionOutput::default())
            }
            PlanOperation::AdapterAction { action, inputs }
                if action == TAURI_RELEASE_GATE_ACTION =>
            {
                run_release_gate(&self.repository_root, node, inputs)
            }
            PlanOperation::RunProgram {
                program,
                args,
                working_directory,
                environment_references,
            } => {
                let driver = TauriBuildDriver::parse(build_driver).ok_or_else(|| {
                    PublishError::Execution(format!("unknown tauri build driver {build_driver}"))
                })?;
                // 工作目录与环境引用由本 Provider 在执行时确定；密封节点携带任何
                // 额外执行输入都视为篡改，而不是被静默丢弃。
                if *program != driver.program_id()
                    || *args != driver.build_command_args(config_path)
                    || working_directory.is_some()
                    || !environment_references.is_empty()
                {
                    return Err(PublishError::InvalidPlan(format!(
                        "node {} is not the sealed tauri build operation",
                        node.id
                    )));
                }
                self.run_sealed_build(node, config_path, driver)
            }
            _ => Err(PublishError::Execution(format!(
                "node {} is not a tauri provider operation",
                node.id
            ))),
        }
    }
}

/// 从密封快照读取 Release Gate；缺失键代表没有配置门禁。
fn release_gates_from_snapshot(
    snapshot: &PlanningInputSnapshot,
) -> Result<Vec<ReleaseGate>, PublishError> {
    match snapshot.release_input.get(RELEASE_GATES_INPUT) {
        None => Ok(Vec::new()),
        Some(value) => serde_json::from_value(value.clone()).map_err(|error| {
            PublishError::InvalidPlan(format!("sealed release gates cannot be decoded: {error}"))
        }),
    }
}

/// 门禁节点输入直接使用 ReleaseGate 的序列化形状；密封与解码共享一个字段来源。
fn release_gate_inputs(gate: &ReleaseGate) -> Result<BTreeMap<String, Value>, PublishError> {
    match serde_json::to_value(gate) {
        Ok(Value::Object(fields)) => Ok(fields.into_iter().collect()),
        _ => Err(PublishError::InvalidPlan(
            "release gate cannot be sealed into plan node inputs".to_string(),
        )),
    }
}

/// 在仓库根执行一个结构化门禁命令；任何非零退出都终止后续节点并保留完整输出根因。
fn run_release_gate(
    repository_root: &Path,
    node: &PlanNode,
    inputs: &BTreeMap<String, Value>,
) -> Result<AdapterExecutionOutput, PublishError> {
    let gate: ReleaseGate = serde_json::from_value(Value::Object(
        inputs.clone().into_iter().collect(),
    ))
    .map_err(|error| {
        PublishError::InvalidPlan(format!(
            "node {} has invalid sealed release gate inputs: {error}",
            node.id
        ))
    })?;
    if gate.program.trim().is_empty() {
        return Err(PublishError::InvalidPlan(format!(
            "node {} has no sealed release gate program",
            node.id
        )));
    }

    let output = crate::process_utils::new_std_command(&gate.program)
        .args(&gate.args)
        .current_dir(repository_root)
        .output()
        .map_err(|error| {
            PublishError::Execution(format!(
                "failed to start release gate '{}': {error}",
                gate.program
            ))
        })?;
    if output.status.success() {
        return Ok(AdapterExecutionOutput::default());
    }
    Err(PublishError::Execution(format!(
        "release gate failed: {} {}\n{}{}",
        gate.program,
        gate.args.join(" "),
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr),
    )))
}

impl ProjectProvider for TauriRuntimeProvider {
    fn discover_candidates(
        &self,
        repository_root: &Path,
    ) -> Result<Vec<publish_domain::ProjectCandidate>, PublishError> {
        self.provider.discover_candidates(repository_root)
    }
}

pub(crate) fn prepare_runtime(
    request: PreparePublishRuntimeRequest,
    resolved: ResolvedPublishConfiguration,
) -> Result<PreparedPublishRuntime, AppError> {
    validate_prepare_request(&request)?;
    // 发布设置只有一个来源：所选配置修订的保留参数键（ADR-0058）。
    let tauri_release = if resolved.provider_id == TAURI_PROVIDER_ID {
        match crate::tauri_release::release_settings_from_parameters(&resolved.parameters) {
            Ok(settings) => settings,
            Err(error) => {
                return Ok(blocked_prepared_runtime(request, error.to_string()));
            }
        }
    } else {
        None
    };
    let tauri_binding = if request.spec.provider_id == TAURI_PROVIDER_ID {
        match prepare_tauri_binding(&request.repository_path, &request.spec)? {
            TauriBindingCheck::Bound(binding) => Some(binding),
            TauriBindingCheck::Blocked(reason) => {
                // 不兼容或缺失的 Tauri 配置以阻断状态呈现，而不是让准备请求失败。
                return Ok(blocked_prepared_runtime(request, reason));
            }
        }
    } else {
        None
    };
    // 门禁属于绑定的 Tauri 应用：仓库配置绑定其他应用时不适用于本配置。
    let release_gates = match (&tauri_binding, tauri_release) {
        (Some(binding), Some(config))
            if same_repository_relative_path(&config.app_config_path, &binding.config_path) =>
        {
            config.release_gates
        }
        _ => Vec::new(),
    };
    let command = render_provider_publish(request.spec.clone())?;
    let preflight = preflight_publish_output(request.spec.clone());
    let mut blocked_reason = resolved.blocked_reason;
    let actual_parameters =
        serde_json::to_value(&request.spec.parameters).map_err(runtime_serialization_error)?;
    if request.spec.provider_id != resolved.provider_id
        || !configuration_parameters_match(
            &request.spec.provider_id,
            &resolved.parameters,
            &actual_parameters,
        )
    {
        blocked_reason = Some(
            "selected configuration revision no longer matches the publish inputs".to_string(),
        );
    }
    if blocked_reason.is_none() {
        blocked_reason = preflight_blocked_reason(&preflight);
    }

    let spec_json = serde_json::to_string(&request.spec).map_err(runtime_serialization_error)?;
    let provider_output_directory = if preflight.output_dir.trim().is_empty() {
        Path::new(&request.repository_path)
            .join(".one-publish")
            .join("blocked-provider-output")
            .to_string_lossy()
            .to_string()
    } else {
        preflight.output_dir.clone()
    };
    let delivery_directory = local_delivery_root(&provider_output_directory)?;
    if blocked_reason.is_none() {
        blocked_reason = delivery_root_blocked_reason(Path::new(&delivery_directory));
    }
    let snapshot = build_snapshot(
        &request,
        spec_json.clone(),
        &provider_output_directory,
        &delivery_directory,
        tauri_binding.as_ref(),
        &release_gates,
        &resolved.composition,
    )?;
    let registry = build_registry(&snapshot, &delivery_directory, None)?;
    let prepared = PublishRuntime::new(registry)
        .prepare_attempt(&snapshot)
        .map_err(runtime_error)?;
    let runtime_token = if blocked_reason.is_none() {
        serde_json::to_string(&prepared).map_err(runtime_serialization_error)?
    } else {
        String::new()
    };

    Ok(PreparedPublishRuntime {
        configuration_id: request.configuration_id,
        configuration_revision_id: request.configuration_revision_id,
        command,
        plan: summarize_plan(&prepared),
        blocked_reason,
        runtime_token,
    })
}

/// 归一化比较仓库相对路径：分隔符与 "./" 写法差异不构成不同的应用绑定，
/// 避免仅因路径拼写不同就静默跳过已配置的 Release Gate。
fn same_repository_relative_path(left: &str, right: &str) -> bool {
    let segments = |value: &str| {
        value
            .replace('\\', "/")
            .split('/')
            .filter(|segment| !segment.is_empty() && *segment != ".")
            .map(str::to_string)
            .collect::<Vec<_>>()
    };
    segments(left) == segments(right)
}

/// prepare 阶段解析出的 Tauri Provider 设置值：显式候选绑定（ADR-0044）、接入时确定的
/// 构建驱动，以及按 Tauri 版本来源语义解析的发布版本（ADR-0007）。
#[derive(Debug, Clone)]
pub(crate) struct ResolvedTauriSettings {
    config_path: String,
    build_driver: TauriBuildDriver,
    version: String,
}

enum TauriBindingCheck {
    Bound(ResolvedTauriSettings),
    Blocked(String),
}

/// 验证发布配置绑定的候选仍然可以被发现和检查；任何失配都作为阻断状态返回，
/// 绝不改绑其他候选（多候选仓库必须显式重新绑定）。
fn prepare_tauri_binding(
    repository_path: &str,
    spec: &PublishSpec,
) -> Result<TauriBindingCheck, AppError> {
    let repository = canonical_repository(Path::new(repository_path))?;
    let Some(config_path) =
        repository_relative_config(Path::new(repository_path), &repository, &spec.project_path)
    else {
        return Ok(TauriBindingCheck::Blocked(format!(
            "tauri_candidate_binding_stale: bound Tauri configuration {} is outside repository {}",
            spec.project_path, repository_path
        )));
    };
    let provider = TauriProjectProvider::new();
    let candidates = match provider.discover_candidates(&repository) {
        Ok(candidates) => candidates,
        Err(error) => return Ok(TauriBindingCheck::Blocked(error.to_string())),
    };
    if candidates.is_empty() {
        return Ok(TauriBindingCheck::Blocked(format!(
            "tauri_candidate_not_found: no Tauri project candidate was discovered in {repository_path}"
        )));
    }
    let identity = publish_adapters::tauri::candidate_identity(&config_path);
    if !candidates
        .iter()
        .any(|candidate| candidate.identity == identity)
    {
        let discovered = candidates
            .iter()
            .map(|candidate| candidate.identity.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        return Ok(TauriBindingCheck::Blocked(format!(
            "tauri_candidate_binding_stale: bound candidate {identity} was not discovered; \
             rebind the publish configuration explicitly (discovered: {discovered})"
        )));
    }
    match provider.inspect(&repository, &config_path) {
        Ok(inspection) => Ok(TauriBindingCheck::Bound(ResolvedTauriSettings {
            config_path,
            build_driver: inspection.build_driver,
            version: inspection.version_source.version,
        })),
        Err(error) => Ok(TauriBindingCheck::Blocked(error.to_string())),
    }
}

/// 把绑定的配置入口换算成仓库相对路径；字面前缀优先，符号链接差异回退到 canonical 比较。
fn repository_relative_config(
    raw_repository: &Path,
    canonical_repository: &Path,
    project_path: &str,
) -> Option<String> {
    let project = Path::new(project_path);
    let absolute = if project.is_absolute() {
        project.to_path_buf()
    } else {
        raw_repository.join(project)
    };
    let relative = absolute
        .strip_prefix(raw_repository)
        .or_else(|_| absolute.strip_prefix(canonical_repository))
        .map(Path::to_path_buf)
        .or_else(|_| {
            fs::canonicalize(&absolute)
                .map_err(|_| ())
                .and_then(|canonical| {
                    canonical
                        .strip_prefix(canonical_repository)
                        .map(Path::to_path_buf)
                        .map_err(|_| ())
                })
        })
        .ok()?;
    let portable = relative.to_string_lossy().replace('\\', "/");
    publish_domain::is_safe_portable_relative_path(&portable).then_some(portable)
}

/// Tauri 检查失败时仍返回可见的准备结果：驱动未知时不渲染猜测的命令或计划，
/// 只呈现阻断原因，而不是错误弹窗（领域词汇：Tauri 构建驱动禁止猜测）。
fn blocked_prepared_runtime(
    request: PreparePublishRuntimeRequest,
    reason: String,
) -> PreparedPublishRuntime {
    PreparedPublishRuntime {
        configuration_id: request.configuration_id,
        configuration_revision_id: request.configuration_revision_id,
        command: RenderedPublishCommand {
            program: String::new(),
            args: Vec::new(),
            working_dir: None,
            display_command: String::new(),
            env: Vec::new(),
        },
        plan: RuntimePlanSummary {
            version: 0,
            digest: String::new(),
            snapshot_digest: String::new(),
            execution_backend: String::new(),
            nodes: Vec::new(),
        },
        blocked_reason: Some(reason),
        runtime_token: String::new(),
    }
}

/// 修订参数中的保留键（如 `releaseSettings`）承载发布设置而不是命令参数，
/// 匹配只针对真正进入命令渲染的参数进行。
fn command_parameters(parameters: &Value) -> Value {
    let mut parameters = parameters.clone();
    if let Some(object) = parameters.as_object_mut() {
        object.remove(crate::tauri_release::RELEASE_SETTINGS_PARAMETER);
    }
    parameters
}

fn configuration_parameters_match(provider_id: &str, expected: &Value, actual: &Value) -> bool {
    let expected = &command_parameters(expected);
    let actual = &command_parameters(actual);
    if expected == actual {
        return true;
    }
    if provider_id != "dotnet" {
        return false;
    }

    let (Some(expected), Some(actual)) = (expected.as_object(), actual.as_object()) else {
        return false;
    };
    if expected.contains_key("output") {
        return false;
    }
    let mut actual_without_derived_output = actual.clone();
    let Some(Value::String(output)) = actual_without_derived_output.remove("output") else {
        return false;
    };
    !output.trim().is_empty() && &actual_without_derived_output == expected
}

#[tauri::command]
pub fn prepare_publish_runtime(
    request: PreparePublishRuntimeRequest,
) -> Result<PreparedPublishRuntime, AppError> {
    let state = crate::store::get_state();
    let repository = state
        .repositories
        .iter()
        .find(|repository| repository.id == request.repository_id)
        .ok_or_else(|| {
            AppError::repository_with_code(
                format!("repository {} was not found", request.repository_id),
                "publish_runtime_repository_not_found",
            )
        })?;
    if repository.path != request.repository_path {
        return Err(AppError::validation_with_code(
            "selected repository path no longer matches persisted state",
            "publish_runtime_repository_mismatch",
        ));
    }
    let configuration = repository
        .publish_config
        .profiles
        .iter()
        .find(|configuration| configuration.id == request.configuration_id)
        .ok_or_else(|| {
            AppError::config_with_code(
                format!(
                    "publish configuration {} was not found",
                    request.configuration_id
                ),
                "publish_runtime_configuration_not_found",
            )
        })?;
    if configuration.deleted_at.is_some() {
        return Err(AppError::config_with_code(
            "selected publish configuration has been deleted",
            "publish_runtime_configuration_deleted",
        ));
    }
    let revision = configuration
        .revisions
        .iter()
        .find(|revision| revision.id == request.configuration_revision_id)
        .ok_or_else(|| {
            AppError::config_with_code(
                format!(
                    "publish configuration revision {} was not found",
                    request.configuration_revision_id
                ),
                "publish_runtime_revision_not_found",
            )
        })?;
    let blocked_reason = (configuration.current_revision_id != revision.id)
        .then(|| "selected publish configuration revision is no longer current".to_string())
        .or_else(|| configuration.blocked_reason.clone());
    prepare_runtime(
        request,
        ResolvedPublishConfiguration {
            provider_id: revision.provider_id.clone(),
            parameters: revision.parameters.clone(),
            composition: revision.composition.clone(),
            blocked_reason,
        },
    )
}

struct TauriProviderExecutionPort {
    app: tauri::AppHandle,
    runtime: tokio::runtime::Handle,
}

impl ProviderExecutionPort for TauriProviderExecutionPort {
    fn execute(&self, spec: PublishSpec) -> Result<crate::commands::PublishResult, AppError> {
        self.runtime
            .block_on(crate::commands::execute_provider_publish(
                self.app.clone(),
                spec,
            ))
    }

    fn execute_build(
        &self,
        request: SealedBuildCommand,
    ) -> Result<crate::commands::PublishResult, AppError> {
        self.runtime
            .block_on(crate::commands::execute_sealed_build(&self.app, &request))
    }
}

#[tauri::command]
pub async fn start_publish_runtime(
    app: tauri::AppHandle,
    request: StartPublishRuntimeRequest,
) -> Result<PublishRuntimeResult, AppError> {
    let identity = new_attempt_identity(&request.runtime_token);
    let port = Arc::new(TauriProviderExecutionPort {
        app,
        runtime: tokio::runtime::Handle::current(),
    });
    tokio::task::spawn_blocking(move || {
        start_runtime_with_port(request, port, identity, lease_coordinator())
    })
    .await
    .map_err(|error| {
        AppError::publish_with_code(
            format!("publish runtime task failed: {error}"),
            "publish_runtime_task_failed",
        )
    })?
}

/// 本地发布租约期限：本机执行是同步的，租约只需覆盖单次执行；
/// 进程异常退出时租约随进程消失，不会遗留仓库级死锁。
const LOCAL_LEASE_TTL_SECONDS: u64 = 3_600;

/// 进程级发布资源租约权威（ADR-0042）：本地并发发布按仓库写入、发布命名
/// 空间与目标命名空间协调，取代旧的仓库级发布互斥；资源不相交的发布可并行。
fn lease_coordinator() -> Arc<PublishLeaseCoordinator> {
    static COORDINATOR: std::sync::OnceLock<Arc<PublishLeaseCoordinator>> =
        std::sync::OnceLock::new();
    Arc::clone(COORDINATOR.get_or_init(|| Arc::new(PublishLeaseCoordinator::new())))
}

fn unix_now_seconds() -> Result<u64, AppError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|error| {
            AppError::publish_with_code(
                format!("system clock is before the unix epoch: {error}"),
                "publish_runtime_clock_invalid",
            )
        })
}

pub(crate) fn start_runtime_with_port(
    request: StartPublishRuntimeRequest,
    execution_port: Arc<dyn ProviderExecutionPort>,
    identity: AttemptIdentity,
    leases: Arc<PublishLeaseCoordinator>,
) -> Result<PublishRuntimeResult, AppError> {
    if request.runtime_token.trim().is_empty() {
        return Err(AppError::validation_with_code(
            "prepared publish runtime token is required",
            "publish_runtime_token_missing",
        ));
    }
    let prepared: PreparedPublishPlan =
        serde_json::from_str(&request.runtime_token).map_err(runtime_serialization_error)?;
    // 从执行一开始就可被 cancel 命令寻址；占位随函数返回自动注销。
    let cancellation = RegisteredCancellation::register(&request.runtime_token)?;
    let source_guard = PreparedSourceGuard::from_snapshot(&prepared.snapshot)?;
    source_guard.validate()?;
    let provider_output_directory = prepared
        .snapshot
        .release_input
        .get("provider_output_directory")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            AppError::publish_with_code(
                "prepared runtime has no provider output directory",
                "publish_runtime_provider_output_missing",
            )
        })?
        .to_string();
    let delivery_directory = prepared
        .snapshot
        .adapters
        .delivery_routes
        .first()
        .ok_or_else(|| {
            AppError::publish_with_code(
                "prepared runtime has no delivery destination",
                "publish_runtime_destination_missing",
            )
        })?
        .binding
        .settings
        .string("directory", LOCAL_DESTINATION_ID)
        .map_err(runtime_error)?
        .to_string();
    let result = Arc::new(Mutex::new(None));
    let repository_path = source_guard.repository.to_string_lossy().to_string();
    let registry = build_registry(
        &prepared.snapshot,
        &delivery_directory,
        Some(SelectedProviderExecution {
            port: execution_port,
            result: Arc::clone(&result),
            output_directory: PathBuf::from(&provider_output_directory),
            source_guard,
        }),
    )?;
    let release_identity = release_identity(&prepared.snapshot)?;

    // 单一并发规则：按本次发布触碰的具体资源取得租约（ADR-0042）。
    // 资源不相交的发布可并行；竞争同一仓库写入、发布命名空间或目标
    // 命名空间的发布在这里被明确阻断。新构建的产物身份在封存时才诞生，
    // 无法预先声明；产物推广固定既有 Manifest，则作为 Artifact Identity
    // 资源参与竞争。
    let mut lease_resources = BTreeSet::from([
        PublishResource::new(PublishResourceKind::RepositoryWrite, &repository_path),
        PublishResource::new(
            PublishResourceKind::ReleaseNamespace,
            format!(
                "{}/{}/{}",
                release_identity.project_identity,
                release_identity.channel,
                release_identity.version
            ),
        ),
        PublishResource::new(
            PublishResourceKind::DestinationNamespace,
            format!("{LOCAL_DESTINATION_ID}:{delivery_directory}"),
        ),
    ]);
    if let Some(digest) = &prepared.snapshot.promoted_manifest_digest {
        lease_resources.insert(PublishResource::new(
            PublishResourceKind::ArtifactIdentity,
            digest,
        ));
    }
    let now_seconds = unix_now_seconds()?;
    leases
        .acquire(
            &identity.attempt_id,
            lease_resources,
            now_seconds,
            LOCAL_LEASE_TTL_SECONDS,
        )
        .map_err(runtime_error)?;
    let view_result = PublishRuntime::with_lease_coordinator(registry, Arc::clone(&leases))
        .start_attempt(
            &prepared,
            StartPublishAttempt::new(
                identity.attempt_id.clone(),
                identity.backend_run_id,
                release_identity,
            ),
            &AttemptExecutionContext::at(now_seconds)
                .with_cancellation(cancellation.signal.clone()),
        );
    let release_result = leases.release(&identity.attempt_id);
    let view = view_result.map_err(runtime_error)?;
    release_result.map_err(runtime_error)?;
    let publish_result = result
        .lock()
        .map_err(|_| {
            AppError::publish_with_code(
                "publish result lock is poisoned",
                "publish_runtime_result_unavailable",
            )
        })?
        .clone();

    Ok(PublishRuntimeResult {
        attempt: summarize_attempt(view),
        publish_result,
    })
}

fn validate_prepare_request(request: &PreparePublishRuntimeRequest) -> Result<(), AppError> {
    if request.repository_id.trim().is_empty()
        || request.repository_path.trim().is_empty()
        || request.configuration_id.trim().is_empty()
        || request.configuration_revision_id.trim().is_empty()
    {
        return Err(AppError::validation_with_code(
            "repository, configuration, and revision identities are required",
            "publish_runtime_identity_missing",
        ));
    }
    Ok(())
}

fn build_snapshot(
    request: &PreparePublishRuntimeRequest,
    spec_json: String,
    provider_output_directory: &str,
    delivery_directory: &str,
    tauri_binding: Option<&ResolvedTauriSettings>,
    release_gates: &[ReleaseGate],
    composition: &PublishComposition,
) -> Result<PlanningInputSnapshot, AppError> {
    let project_identity = project_identity(&request.repository_path, &request.spec)?;
    let repository = canonical_repository(Path::new(&request.repository_path))?;
    let source_root = provider_source_root(&repository, &request.spec)?;
    let source_root_relative = source_root.strip_prefix(&repository).map_err(|_| {
        AppError::validation_with_code(
            "publish project must be inside the selected repository",
            "publish_runtime_project_outside_repository",
        )
    })?;
    let source_root_relative = if source_root_relative.as_os_str().is_empty() {
        ".".to_string()
    } else {
        source_root_relative.to_string_lossy().replace('\\', "/")
    };
    let excluded_roots = source_excluded_roots(
        &repository,
        &source_root,
        provider_output_directory,
        delivery_directory,
    )?;
    let source = capture_source_snapshot(
        &repository,
        &source_root,
        &request.spec.provider_id,
        &excluded_roots,
    )?;
    let mut release_input = BTreeMap::from([
        (
            "repository_id".to_string(),
            Value::String(request.repository_id.clone()),
        ),
        (
            "configuration_id".to_string(),
            Value::String(request.configuration_id.clone()),
        ),
        (
            "repository_path".to_string(),
            Value::String(repository.to_string_lossy().to_string()),
        ),
        (
            "provider_id".to_string(),
            Value::String(request.spec.provider_id.clone()),
        ),
        (
            "source_root".to_string(),
            Value::String(source_root_relative),
        ),
        (
            "provider_output_directory".to_string(),
            Value::String(provider_output_directory.to_string()),
        ),
        (
            "delivery_directory".to_string(),
            Value::String(delivery_directory.to_string()),
        ),
        (
            "version".to_string(),
            Value::String("workspace".to_string()),
        ),
        ("channel".to_string(), Value::String("local".to_string())),
        (
            "project_identity".to_string(),
            Value::String(project_identity),
        ),
    ]);
    let (project_provider, provider_uses_composition_processors) = match tauri_binding {
        Some(binding) => {
            // Tauri 发布身份使用 Provider 按版本来源语义解析的版本；
            // Release Gate 密封进发布输入，保持 Tauri adapter 的 (tauri, v1) 设置合同唯一。
            release_input.insert(
                "version".to_string(),
                Value::String(binding.version.clone()),
            );
            if !release_gates.is_empty() {
                release_input.insert(
                    RELEASE_GATES_INPUT.to_string(),
                    serde_json::to_value(release_gates).map_err(runtime_serialization_error)?,
                );
            }
            (
                AdapterBinding::new(
                    "project",
                    AdapterIdentity::new(AdapterKind::ProjectProvider, TAURI_PROVIDER_ID, 1),
                    AdapterSettings::new(1)
                        .with_value("config_path", Value::String(binding.config_path.clone()))
                        .with_value(
                            "build_driver",
                            Value::String(binding.build_driver.name().to_string()),
                        ),
                ),
                true,
            )
        }
        // 遗留 Selected Provider 桥接自行声明已验证产物，不经处理器管道。
        None => (
            AdapterBinding::new(
                "project",
                AdapterIdentity::new(AdapterKind::ProjectProvider, SELECTED_PROVIDER_ID, 1),
                AdapterSettings::new(1).with_value("spec_json", Value::String(spec_json)),
            ),
            false,
        ),
    };
    let adapters = composition_selection(
        composition,
        project_provider,
        provider_uses_composition_processors,
        delivery_directory,
    )?;

    Ok(PlanningInputSnapshot {
        version: PLANNING_INPUT_SNAPSHOT_VERSION,
        configuration_revision: request.configuration_revision_id.clone(),
        runtime_revision: RUNTIME_REVISION.to_string(),
        release_input,
        source,
        external_preconditions: BTreeMap::new(),
        promoted_manifest_digest: request.promoted_manifest_digest.clone(),
        adapters,
    })
}

/// 把修订组合物化为计划输入的 Adapter 选择。修订是 Backend、Store、Processor
/// 与 Delivery Route 的唯一事实来源；桌面运行时事实（临时存储根目录、保留期
/// 与本地交付目录）不由修订携带，在此处补全缺省键。
fn composition_selection(
    composition: &PublishComposition,
    project_provider: AdapterBinding,
    include_processors: bool,
    delivery_directory: &str,
) -> Result<AdapterSelection, AppError> {
    let artifact_processors = if include_processors {
        composition
            .artifact_processors
            .iter()
            .enumerate()
            .map(|(index, binding)| {
                composition_binding(
                    &format!("processor-{}", index + 1),
                    AdapterKind::ArtifactProcessor,
                    binding,
                )
            })
            .collect::<Result<Vec<_>, _>>()?
    } else {
        Vec::new()
    };

    let execution_backend = composition_binding(
        "backend",
        AdapterKind::ExecutionBackend,
        &composition.execution_backend,
    )?;

    let mut artifact_store = composition_binding(
        "store",
        AdapterKind::ArtifactStore,
        &composition.artifact_store,
    )?;
    if artifact_store.adapter.id == TEMPORARY_STORE_ID {
        artifact_store
            .settings
            .values
            .entry("root_directory".to_string())
            .or_insert_with(|| Value::String(artifact_store_root().to_string_lossy().to_string()));
        artifact_store
            .settings
            .values
            .entry("retention_seconds".to_string())
            .or_insert_with(|| Value::from(ARTIFACT_RETENTION_SECONDS));
    }

    if composition.delivery_routes.is_empty() {
        return Err(AppError::validation_with_code(
            "publish composition requires at least one delivery route",
            "publish_runtime_composition_routes_missing",
        ));
    }
    let mut delivery_routes = Vec::with_capacity(composition.delivery_routes.len());
    for route in &composition.delivery_routes {
        let mut binding = composition_binding(
            route.route_id.as_str(),
            AdapterKind::DeliveryDestination,
            &route.destination,
        )?;
        if binding.adapter.id == LOCAL_DESTINATION_ID {
            binding
                .settings
                .values
                .entry("directory".to_string())
                .or_insert_with(|| Value::String(delivery_directory.to_string()));
        }
        delivery_routes.push(if route.required {
            DeliveryRoute::required(binding)
        } else {
            DeliveryRoute::optional(binding)
        });
    }

    Ok(AdapterSelection {
        project_provider,
        artifact_processors,
        execution_backend,
        artifact_store,
        delivery_routes,
    })
}

/// 修订内 Adapter 绑定 → 计划输入绑定；settings 必须是非秘密 JSON 对象。
fn composition_binding(
    binding_id: &str,
    kind: AdapterKind,
    revision: &RevisionAdapterBinding,
) -> Result<AdapterBinding, AppError> {
    let Value::Object(values) = &revision.settings else {
        return Err(AppError::validation_with_code(
            format!(
                "adapter {} settings must be a JSON object",
                revision.adapter_id
            ),
            "publish_runtime_composition_settings_invalid",
        ));
    };
    let mut settings = AdapterSettings::new(revision.settings_version);
    for (key, value) in values {
        settings = settings.with_value(key.as_str(), value.clone());
    }
    let mut binding = AdapterBinding::new(
        binding_id,
        AdapterIdentity::new(kind, &revision.adapter_id, 1),
        settings,
    );
    for (requirement, reference) in &revision.credentials {
        binding = binding.with_credential(requirement, reference);
    }
    Ok(binding)
}

fn build_registry(
    snapshot: &PlanningInputSnapshot,
    delivery_directory: &str,
    execution: Option<SelectedProviderExecution>,
) -> Result<AdapterRegistry, AppError> {
    let fixture = AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = AdapterRegistry::new();
    register_project_provider(&mut registry, snapshot, execution, &fixture)?;

    let mut processors = BTreeSet::new();
    for binding in &snapshot.adapters.artifact_processors {
        if !processors.insert(binding.adapter.id.clone()) {
            continue;
        }
        match binding.adapter.id.as_str() {
            CHECKSUM_PROCESSOR_ID => registry
                .register_artifact_processor(Arc::new(ChecksumProcessor::new()), &fixture)
                .map_err(runtime_error)?,
            other => return Err(unsupported_adapter("artifact processor", other)),
        }
    }

    match snapshot.adapters.execution_backend.adapter.id.as_str() {
        LOCAL_BACKEND_ID => registry
            .register_execution_backend(Arc::new(LocalExecutionBackend::new()), &fixture)
            .map_err(runtime_error)?,
        other => return Err(unsupported_adapter("execution backend", other)),
    }

    match snapshot.adapters.artifact_store.adapter.id.as_str() {
        TEMPORARY_STORE_ID => registry
            .register_artifact_store(
                Arc::new(TemporaryArtifactStore::new(artifact_store_root())),
                &fixture,
            )
            .map_err(runtime_error)?,
        other => return Err(unsupported_adapter("artifact store", other)),
    }

    let mut destinations = BTreeSet::new();
    for route in &snapshot.adapters.delivery_routes {
        let destination_id = route.binding.adapter.id.as_str();
        if !destinations.insert(destination_id.to_string()) {
            continue;
        }
        match destination_id {
            LOCAL_DESTINATION_ID => registry
                .register_delivery_destination(
                    Arc::new(LocalDirectoryDestination::new(delivery_directory)),
                    &fixture,
                )
                .map_err(runtime_error)?,
            SFTP_DESTINATION_ID => registry
                .register_delivery_destination(
                    Arc::new(SftpDeliveryDestination::new(Arc::new(
                        OpenSshSftpTransport::new(),
                    ))),
                    &fixture,
                )
                .map_err(runtime_error)?,
            GITHUB_RELEASE_DESTINATION_ID => registry
                .register_delivery_destination(
                    Arc::new(GitHubReleaseDestination::new(Arc::new(
                        GhCliGitHubReleaseApi::new(),
                    ))),
                    &fixture,
                )
                .map_err(runtime_error)?,
            other => return Err(unsupported_adapter("delivery destination", other)),
        }
    }
    Ok(registry)
}

/// 能力协商语义：组合引用了本运行时未内置的 Adapter 时报告具体缺失，
/// 不静默替换实现、跳过步骤或降低目标集合。
fn unsupported_adapter(kind: &str, adapter_id: &str) -> AppError {
    AppError::validation_with_code(
        format!("publish composition requires {kind} adapter {adapter_id}, which is not built into this runtime"),
        "publish_runtime_adapter_unavailable",
    )
}

/// 按快照声明的 Project Provider 身份注册对应实现；快照是唯一的选择事实来源。
fn register_project_provider(
    registry: &mut AdapterRegistry,
    snapshot: &PlanningInputSnapshot,
    execution: Option<SelectedProviderExecution>,
    fixture: &AdapterConformanceFixture,
) -> Result<(), AppError> {
    let binding = &snapshot.adapters.project_provider;
    let adapter_name = binding.adapter.display_name();
    if binding.adapter.id == TAURI_PROVIDER_ID {
        let config_path = binding
            .settings
            .string("config_path", &adapter_name)
            .map_err(runtime_error)?
            .to_string();
        let build_driver = binding
            .settings
            .string("build_driver", &adapter_name)
            .map_err(runtime_error)?
            .to_string();
        let repository_root = snapshot
            .release_input
            .get("repository_path")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                AppError::publish_with_code(
                    "prepared runtime has no repository path",
                    "publish_runtime_repository_missing",
                )
            })?;
        registry
            .register_project_provider(
                Arc::new(TauriRuntimeProvider::new(
                    config_path,
                    build_driver,
                    PathBuf::from(repository_root),
                    execution,
                )),
                fixture,
            )
            .map_err(runtime_error)?;
    } else {
        let spec_json = binding
            .settings
            .string("spec_json", &adapter_name)
            .map_err(runtime_error)?
            .to_string();
        registry
            .register_project_provider(
                Arc::new(SelectedProjectProvider::with_execution(
                    spec_json, execution,
                )),
                fixture,
            )
            .map_err(runtime_error)?;
    }
    Ok(())
}

/// 非 Tauri Provider 的产物暂以统一角色进入清单；逐 Provider 的角色分类属于后续 Ticket。
fn classify_generic_artifact(_relative: &Path) -> (&'static str, &'static str) {
    ("provider-output", "application/octet-stream")
}

/// Tauri bundle 输出按逻辑角色与媒体类型进入 Artifact Manifest：
/// 安装包、Updater 归档与 Updater 签名可被交付路线按角色选择，其余为构建支撑文件。
fn classify_tauri_artifact(relative: &Path) -> (&'static str, &'static str) {
    let name = relative
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if name.ends_with(".sig") {
        return ("updater-signature", "application/octet-stream");
    }
    if name.ends_with(".app.tar.gz") {
        return ("updater-archive", "application/gzip");
    }
    if name.ends_with(".nsis.zip") || name.ends_with(".msi.zip") {
        return ("updater-archive", "application/zip");
    }
    if name.ends_with(".dmg") {
        return ("installer", "application/x-apple-diskimage");
    }
    if name.ends_with(".msi") {
        return ("installer", "application/x-msi");
    }
    if name.ends_with(".exe") {
        return ("installer", "application/vnd.microsoft.portable-executable");
    }
    if name.ends_with(".appimage") {
        return ("installer", "application/vnd.appimage");
    }
    if name.ends_with(".deb") {
        return ("installer", "application/vnd.debian.binary-package");
    }
    if name.ends_with(".rpm") {
        return ("installer", "application/x-rpm");
    }
    ("build-support", "application/octet-stream")
}

fn collect_artifacts_with(
    root: &Path,
    classify: fn(&Path) -> (&'static str, &'static str),
) -> Result<Vec<ArtifactCandidate>, PublishError> {
    let metadata = fs::symlink_metadata(root).map_err(|error| PublishError::Io {
        operation: format!("inspect provider output {}", root.display()),
        message: error.to_string(),
    })?;
    if metadata.file_type().is_symlink() {
        return Err(PublishError::Execution(format!(
            "provider output cannot be a symbolic link: {}",
            root.display()
        )));
    }
    let (artifact_root, mut files) = if metadata.is_file() {
        let parent = root.parent().ok_or_else(|| {
            PublishError::Execution(format!(
                "provider output file has no parent directory: {}",
                root.display()
            ))
        })?;
        (parent.to_path_buf(), vec![root.to_path_buf()])
    } else if metadata.is_dir() {
        let mut pending = vec![root.to_path_buf()];
        let mut files = Vec::new();
        while let Some(directory) = pending.pop() {
            let entries = fs::read_dir(&directory).map_err(|error| PublishError::Io {
                operation: format!("read provider output directory {}", directory.display()),
                message: error.to_string(),
            })?;
            for entry in entries {
                let entry = entry.map_err(|error| PublishError::Io {
                    operation: format!("read provider output entry in {}", directory.display()),
                    message: error.to_string(),
                })?;
                let file_type = entry.file_type().map_err(|error| PublishError::Io {
                    operation: format!("inspect provider output {}", entry.path().display()),
                    message: error.to_string(),
                })?;
                if file_type.is_symlink() {
                    return Err(PublishError::Execution(format!(
                        "provider output cannot contain symbolic links: {}",
                        entry.path().display()
                    )));
                }
                if file_type.is_dir() {
                    pending.push(entry.path());
                } else if file_type.is_file() {
                    files.push(entry.path());
                }
            }
        }
        (root.to_path_buf(), files)
    } else {
        return Err(PublishError::Execution(format!(
            "provider output is not a file or directory: {}",
            root.display()
        )));
    };
    files.sort();
    if files.is_empty() {
        return Err(PublishError::Execution(
            "provider execution produced no artifacts".to_string(),
        ));
    }

    files
        .into_iter()
        .map(|path| {
            let relative = path.strip_prefix(&artifact_root).map_err(|_| {
                PublishError::Execution(format!(
                    "provider output escaped its root: {}",
                    path.display()
                ))
            })?;
            let bytes = fs::read(&path).map_err(|error| PublishError::Io {
                operation: format!("read provider artifact {}", path.display()),
                message: error.to_string(),
            })?;
            let (role, media_type) = classify(relative);
            Ok(ArtifactCandidate::new(
                role,
                relative.to_string_lossy().replace('\\', "/"),
                media_type,
                std::env::consts::OS,
                std::env::consts::ARCH,
                bytes,
            ))
        })
        .collect()
}

fn release_identity(snapshot: &PlanningInputSnapshot) -> Result<ReleaseIdentity, AppError> {
    let release_value = |key: &str| {
        snapshot
            .release_input
            .get(key)
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                AppError::publish_with_code(
                    format!("prepared runtime release identity is missing {key}"),
                    "publish_runtime_release_identity_missing",
                )
            })
    };
    Ok(ReleaseIdentity::new(
        release_value("project_identity")?,
        snapshot.source.clone(),
        release_value("version")?,
        release_value("channel")?,
        snapshot
            .release_input
            .get("build_sequence")
            .and_then(Value::as_str)
            .map(ToString::to_string),
    ))
}

fn summarize_attempt(view: PublishAttemptView) -> RuntimeAttemptResult {
    RuntimeAttemptResult {
        attempt_id: view.attempt.attempt_id,
        backend_run_id: view.attempt.backend_run_id,
        configuration_revision_id: view.attempt.configuration_revision,
        plan_digest: view.attempt.plan_digest,
        execution_backend: view.attempt.execution_backend.id,
        status: match view.status {
            PublishAttemptStatus::Running => RuntimeAttemptStatus::Running,
            PublishAttemptStatus::Published => RuntimeAttemptStatus::Published,
            PublishAttemptStatus::PartialDelivery => RuntimeAttemptStatus::PartialDelivery,
            PublishAttemptStatus::Failed => RuntimeAttemptStatus::Failed,
            PublishAttemptStatus::Cancelled => RuntimeAttemptStatus::Cancelled,
        },
        manifest_digest: view.attempt.manifest_digest,
        manifest: view
            .manifest
            .map(|manifest| RuntimeArtifactManifestSummary {
                digest: manifest.digest,
                artifact_count: manifest.artifacts.len(),
            }),
        receipts: view
            .receipts
            .into_iter()
            .map(|receipt| RuntimeDeliveryReceiptSummary {
                version: receipt.version,
                receipt_id: receipt.receipt_id,
                revision: receipt.revision,
                route_id: receipt.route_id,
                manifest_digest: receipt.manifest_digest,
                status: runtime_delivery_status(receipt.status),
                external_reference: receipt.external_reference,
            })
            .collect(),
        routes: view
            .routes
            .into_iter()
            .map(|route| RuntimeRouteSummary {
                route_id: route.route_id,
                required: route.required,
                status: runtime_delivery_status(route.status),
                external_reference: route.external_reference,
                error: route.error,
            })
            .collect(),
        warnings: view.warnings,
        events: view
            .events
            .into_iter()
            .map(|event| {
                let receipt = event
                    .payload
                    .get("receipt")
                    .cloned()
                    .map(|value| {
                        serde_json::from_value(value)
                            .expect("Publish Core must only return reduced receipt events")
                    })
                    .map(|receipt: publish_domain::DeliveryReceipt| {
                        RuntimeDeliveryReceiptSummary {
                            version: receipt.version,
                            receipt_id: receipt.receipt_id,
                            revision: receipt.revision,
                            route_id: receipt.route_id,
                            manifest_digest: receipt.manifest_digest,
                            status: runtime_delivery_status(receipt.status),
                            external_reference: receipt.external_reference,
                        }
                    });
                RuntimePublishEventSummary {
                    event_id: event.event_id,
                    plan_node_id: event.plan_node_id,
                    kind: event.kind,
                    manifest_digest: event
                        .payload
                        .get("manifest_digest")
                        .and_then(Value::as_str)
                        .map(ToString::to_string)
                        .or_else(|| {
                            receipt
                                .as_ref()
                                .map(|receipt| receipt.manifest_digest.clone())
                        }),
                    receipt_id: receipt.as_ref().map(|receipt| receipt.receipt_id.clone()),
                    delivery_status: receipt
                        .as_ref()
                        .map(|receipt| runtime_delivery_status_name(receipt.status).to_string()),
                    receipt,
                    error: event
                        .payload
                        .get("error")
                        .and_then(Value::as_str)
                        .map(ToString::to_string),
                }
            })
            .collect(),
        error: view.error,
    }
}

fn runtime_delivery_status(status: DeliveryStatus) -> RuntimeDeliveryStatus {
    match status {
        DeliveryStatus::Pending => RuntimeDeliveryStatus::Pending,
        DeliveryStatus::Staged => RuntimeDeliveryStatus::Staged,
        DeliveryStatus::Submitted => RuntimeDeliveryStatus::Submitted,
        DeliveryStatus::Published => RuntimeDeliveryStatus::Published,
        DeliveryStatus::Failed => RuntimeDeliveryStatus::Failed,
        DeliveryStatus::Rejected => RuntimeDeliveryStatus::Rejected,
        DeliveryStatus::Cancelled => RuntimeDeliveryStatus::Cancelled,
        DeliveryStatus::Expired => RuntimeDeliveryStatus::Expired,
    }
}

fn runtime_delivery_status_name(status: RuntimeDeliveryStatus) -> &'static str {
    match status {
        RuntimeDeliveryStatus::Pending => "pending",
        RuntimeDeliveryStatus::Staged => "staged",
        RuntimeDeliveryStatus::Submitted => "submitted",
        RuntimeDeliveryStatus::Published => "published",
        RuntimeDeliveryStatus::Failed => "failed",
        RuntimeDeliveryStatus::Rejected => "rejected",
        RuntimeDeliveryStatus::Cancelled => "cancelled",
        RuntimeDeliveryStatus::Expired => "expired",
    }
}

fn summarize_plan(prepared: &PreparedPublishPlan) -> RuntimePlanSummary {
    RuntimePlanSummary {
        version: prepared.plan.version,
        digest: prepared.plan.digest.clone(),
        snapshot_digest: prepared.plan.snapshot_digest.clone(),
        execution_backend: prepared.plan.execution_backend.id.clone(),
        nodes: prepared
            .plan
            .nodes
            .iter()
            .map(|node| RuntimePlanNodeSummary {
                id: node.id.clone(),
                stage: runtime_stage(node.stage),
                adapter_id: node.adapter.id.clone(),
                operation: match &node.operation {
                    publish_domain::PlanOperation::RunProgram { program, .. } => program.clone(),
                    publish_domain::PlanOperation::AdapterAction { action, .. } => action.clone(),
                },
                irreversible: node.irreversible,
            })
            .collect(),
    }
}

fn runtime_stage(stage: PlanStage) -> RuntimePlanStage {
    match stage {
        PlanStage::InspectSource => RuntimePlanStage::InspectSource,
        PlanStage::PrepareIdentity => RuntimePlanStage::PrepareIdentity,
        PlanStage::Build => RuntimePlanStage::Build,
        PlanStage::CollectArtifacts => RuntimePlanStage::CollectArtifacts,
        PlanStage::ProcessArtifacts => RuntimePlanStage::ProcessArtifacts,
        PlanStage::PersistManifest => RuntimePlanStage::PersistManifest,
        PlanStage::StageRoutes => RuntimePlanStage::StageRoutes,
        PlanStage::PublishRoutes => RuntimePlanStage::PublishRoutes,
        PlanStage::ObserveRoutes => RuntimePlanStage::ObserveRoutes,
    }
}

fn preflight_blocked_reason(
    preflight: &crate::commands::PublishOutputPreflightResult,
) -> Option<String> {
    if preflight.validation.status == PublishOutputValidationStatus::Incompatible {
        return Some(
            preflight
                .validation
                .issue
                .map(|issue| format!("publish output is incompatible: {issue:?}"))
                .unwrap_or_else(|| "publish output is incompatible".to_string()),
        );
    }
    if preflight.access.status == PublishOutputAccessStatus::Denied {
        return Some(
            preflight
                .access
                .detail
                .clone()
                .unwrap_or_else(|| "publish output access is denied".to_string()),
        );
    }
    if preflight
        .access
        .remote_location
        .as_ref()
        .is_some_and(|location| location.kind == RemoteLocationKind::Remote)
    {
        return Some("remote publish output is not supported by the local destination".to_string());
    }
    if preflight.output_dir.trim().is_empty() {
        return Some("publish output directory is empty".to_string());
    }
    None
}

fn local_delivery_root(provider_output_directory: &str) -> Result<String, AppError> {
    let output = Path::new(provider_output_directory);
    let name = output
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .ok_or_else(|| {
            AppError::validation_with_code(
                "provider output directory must have a terminal path component",
                "publish_runtime_provider_output_invalid",
            )
        })?;
    Ok(output
        .with_file_name(format!("{name}.one-publish-deliveries"))
        .to_string_lossy()
        .to_string())
}

fn delivery_root_blocked_reason(delivery_root: &Path) -> Option<String> {
    let mut probe_directory = delivery_root;
    loop {
        match fs::symlink_metadata(probe_directory) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() || !metadata.is_dir() {
                    return Some(format!(
                        "local delivery destination {} is not a directory",
                        probe_directory.display()
                    ));
                }
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let Some(parent) = probe_directory.parent() else {
                    return Some(format!(
                        "local delivery destination {} has no accessible parent",
                        delivery_root.display()
                    ));
                };
                probe_directory = parent;
            }
            Err(error) => {
                return Some(format!(
                    "local delivery destination {} cannot be inspected: {error}",
                    probe_directory.display()
                ));
            }
        }
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let probe = probe_directory.join(format!(
        ".one-publish-write-probe-{}-{timestamp}",
        std::process::id()
    ));
    match File::options().write(true).create_new(true).open(&probe) {
        Ok(file) => {
            drop(file);
            if let Err(error) = fs::remove_file(&probe) {
                return Some(format!(
                    "local delivery destination {} could not remove its access probe: {error}",
                    probe_directory.display()
                ));
            }
            None
        }
        Err(error) => Some(format!(
            "local delivery destination {} is not writable: {error}",
            probe_directory.display()
        )),
    }
}

fn project_identity(repository_path: &str, spec: &PublishSpec) -> Result<String, AppError> {
    let repository = canonical_repository(Path::new(repository_path))?;
    let project = Path::new(&spec.project_path);
    let project = if project.is_absolute() {
        project.to_path_buf()
    } else {
        repository.join(project)
    };
    let project = fs::canonicalize(&project).map_err(|error| {
        AppError::validation_with_code(
            format!(
                "failed to resolve publish project {}: {error}",
                project.display()
            ),
            "publish_runtime_project_unavailable",
        )
    })?;
    let relative = project.strip_prefix(&repository).map_err(|_| {
        AppError::validation_with_code(
            "publish project must be inside the selected repository",
            "publish_runtime_project_outside_repository",
        )
    })?;
    let relative = if relative.as_os_str().is_empty() {
        ".".to_string()
    } else {
        relative.to_string_lossy().replace('\\', "/")
    };
    let mut identity = Vec::new();
    append_digest_field(&mut identity, repository_namespace(&repository)?.as_bytes());
    append_digest_field(&mut identity, spec.provider_id.as_bytes());
    append_digest_field(&mut identity, relative.as_bytes());
    Ok(format!("project:{}", publish_domain::sha256_hex(&identity)))
}

fn repository_namespace(repository: &Path) -> Result<String, AppError> {
    if let Some(remote) = git_optional_text(repository, &["config", "--get", "remote.origin.url"])?
        .and_then(|remote| normalize_remote_namespace(&remote))
    {
        return Ok(format!("remote:{remote}"));
    }

    let roots = git_text(repository, &["rev-list", "--max-parents=0", "HEAD"])?;
    let mut roots = roots
        .lines()
        .map(str::trim)
        .filter(|root| !root.is_empty())
        .collect::<Vec<_>>();
    roots.sort_unstable();
    if roots.is_empty() {
        return Err(source_snapshot_error(
            "git returned no root commits for the selected repository",
        ));
    }
    Ok(format!("history:{}", roots.join(":")))
}

fn normalize_remote_namespace(remote: &str) -> Option<String> {
    let remote = remote
        .split(['?', '#'])
        .next()
        .map(str::trim)
        .filter(|remote| !remote.is_empty())?;
    if remote.starts_with('/')
        || remote.starts_with("./")
        || remote.starts_with("../")
        || (remote.as_bytes().get(1) == Some(&b':')
            && remote
                .as_bytes()
                .get(2)
                .is_some_and(|separator| matches!(separator, b'/' | b'\\')))
    {
        return None;
    }

    let (host, path) = if let Some((scheme, remainder)) = remote.split_once("://") {
        if scheme.eq_ignore_ascii_case("file") {
            return None;
        }
        let (authority, path) = remainder.split_once('/')?;
        (authority.rsplit('@').next()?, path)
    } else {
        let (authority, path) = remote.split_once(':')?;
        (authority.rsplit('@').next()?, path)
    };
    let host = host.trim().to_ascii_lowercase();
    let path = path.trim_matches('/').strip_suffix(".git").unwrap_or(path);
    let path = path.trim_matches('/');
    (!host.is_empty() && !path.is_empty()).then(|| format!("{host}/{path}"))
}

fn provider_source_root(repository: &Path, spec: &PublishSpec) -> Result<PathBuf, AppError> {
    let provider = provider_registry()
        .get(&spec.provider_id)
        .map_err(AppError::from)?;
    let working_directory = provider.resolve_working_dir(spec).ok_or_else(|| {
        AppError::validation_with_code(
            format!(
                "provider {} did not resolve a project working directory",
                spec.provider_id
            ),
            "publish_runtime_project_unavailable",
        )
    })?;
    let working_directory = if working_directory.is_absolute() {
        working_directory
    } else {
        repository.join(working_directory)
    };
    let source_root = fs::canonicalize(&working_directory).map_err(|error| {
        AppError::validation_with_code(
            format!(
                "failed to resolve publish project directory {}: {error}",
                working_directory.display()
            ),
            "publish_runtime_project_unavailable",
        )
    })?;
    if !source_root.is_dir() {
        return Err(AppError::validation_with_code(
            format!(
                "publish project directory {} is not a directory",
                source_root.display()
            ),
            "publish_runtime_project_unavailable",
        ));
    }
    if !source_root.starts_with(repository) {
        return Err(AppError::validation_with_code(
            "publish project must be inside the selected repository",
            "publish_runtime_project_outside_repository",
        ));
    }
    Ok(source_root)
}

fn canonical_repository(repository: &Path) -> Result<PathBuf, AppError> {
    let repository = fs::canonicalize(repository).map_err(|error| {
        AppError::repository_with_code(
            format!(
                "failed to resolve selected repository {}: {error}",
                repository.display()
            ),
            "publish_runtime_repository_unavailable",
        )
    })?;
    if !repository.is_dir() {
        return Err(AppError::repository_with_code(
            format!(
                "selected repository {} is not a directory",
                repository.display()
            ),
            "publish_runtime_repository_unavailable",
        ));
    }
    Ok(repository)
}

#[derive(Clone)]
struct PreparedSourceGuard {
    repository: PathBuf,
    source_root: PathBuf,
    provider_id: String,
    excluded_roots: Vec<PathBuf>,
    expected: SourceSnapshot,
}

impl PreparedSourceGuard {
    fn from_snapshot(snapshot: &PlanningInputSnapshot) -> Result<Self, AppError> {
        let release_value = |key: &str| {
            snapshot
                .release_input
                .get(key)
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    AppError::publish_with_code(
                        format!("prepared runtime source identity is missing {key}"),
                        "publish_runtime_source_identity_missing",
                    )
                })
        };
        let repository = canonical_repository(Path::new(release_value("repository_path")?))?;
        let source_root = fs::canonicalize(repository.join(release_value("source_root")?))
            .map_err(|error| {
                AppError::publish_with_code(
                    format!("prepared runtime source root is unavailable: {error}"),
                    "publish_runtime_source_identity_missing",
                )
            })?;
        if !source_root.is_dir() || !source_root.starts_with(&repository) {
            return Err(AppError::publish_with_code(
                "prepared runtime source root is outside the selected repository",
                "publish_runtime_source_identity_missing",
            ));
        }
        let provider_id = release_value("provider_id")?.to_string();
        let excluded_roots = source_excluded_roots(
            &repository,
            &source_root,
            release_value("provider_output_directory")?,
            release_value("delivery_directory")?,
        )?;
        Ok(Self {
            repository,
            source_root,
            provider_id,
            excluded_roots,
            expected: snapshot.source.clone(),
        })
    }

    fn validate(&self) -> Result<(), AppError> {
        let current = capture_source_snapshot(
            &self.repository,
            &self.source_root,
            &self.provider_id,
            &self.excluded_roots,
        )?;
        if current.revision != self.expected.revision
            || current.workspace_digest != self.expected.workspace_digest
            || current.dirty != self.expected.dirty
            || current.reproducible != self.expected.reproducible
        {
            return Err(AppError::publish_with_code(
                "source changed since runtime preparation; prepare the selected configuration again",
                "publish_runtime_source_changed",
            ));
        }
        Ok(())
    }

    fn validate_for_execution(&self) -> Result<(), PublishError> {
        self.validate()
            .map_err(|error| PublishError::Execution(error.to_string()))
    }
}

fn capture_source_snapshot(
    repository: &Path,
    source_root: &Path,
    provider_id: &str,
    excluded_roots: &[PathBuf],
) -> Result<SourceSnapshot, AppError> {
    let revision = git_text(repository, &["rev-parse", "--verify", "HEAD"])?;
    if revision.is_empty() {
        return Err(source_snapshot_error("git returned an empty HEAD revision"));
    }

    let tracked_paths = git_bytes(
        repository,
        &["diff", "--name-only", "-z", "--no-ext-diff", "HEAD", "--"],
    )?;
    let untracked_output = git_bytes(
        repository,
        &["ls-files", "--others", "--exclude-standard", "-z"],
    )?;
    let ignored_output = git_bytes(
        repository,
        &[
            "ls-files",
            "--others",
            "--ignored",
            "--exclude-standard",
            "--directory",
            "-z",
        ],
    )?;
    let mut changed_paths = BTreeSet::new();
    changed_paths.extend(parse_git_paths(&tracked_paths)?);
    changed_paths.extend(parse_git_paths(&untracked_output)?);
    let ignored_paths = parse_git_paths(&ignored_output)?;

    let mut declared_inputs = BTreeSet::new();
    let mut environment_inputs = BTreeSet::new();
    let provider = provider_registry()
        .get(provider_id)
        .map_err(AppError::from)?;
    for relative in changed_paths {
        let absolute = repository.join(&relative);
        let Ok(source_relative) = absolute.strip_prefix(source_root) else {
            continue;
        };
        if is_excluded_source_path(&absolute, excluded_roots) {
            continue;
        }
        let classification = provider.classify_source_input(source_relative);
        if classification == ProviderSourceInputKind::Generated {
            continue;
        }
        if classification == ProviderSourceInputKind::DeclaredNonSecret
            && !is_sensitive_source_path(source_relative)
        {
            declared_inputs.insert(relative);
        } else {
            environment_inputs.insert(relative);
        }
    }
    for relative in ignored_paths {
        let absolute = repository.join(&relative);
        let Ok(source_relative) = absolute.strip_prefix(source_root) else {
            continue;
        };
        if is_excluded_source_path(&absolute, excluded_roots)
            || provider.classify_source_input(source_relative) == ProviderSourceInputKind::Generated
        {
            continue;
        }
        environment_inputs.insert(relative);
    }

    let dirty = !declared_inputs.is_empty() || !environment_inputs.is_empty();
    let workspace_digest = if dirty {
        let mut hasher = Sha256::new();
        for relative in declared_inputs {
            hash_source_input(&mut hasher, repository, &relative)?;
        }
        for relative in environment_inputs {
            update_digest_field(&mut hasher, b"environment-path");
            update_digest_field(
                &mut hasher,
                relative.to_string_lossy().replace('\\', "/").as_bytes(),
            );
        }
        Some(hex::encode(hasher.finalize()))
    } else {
        None
    };

    Ok(SourceSnapshot {
        revision,
        workspace_digest,
        dirty,
        captured_at: chrono::Utc::now().to_rfc3339(),
        // clean 快照引用不可变 VCS revision，可复现；dirty 快照依赖工作区内容，不可复现。
        reproducible: !dirty,
    })
}

fn source_excluded_roots(
    repository: &Path,
    source_root: &Path,
    provider_output_directory: &str,
    delivery_directory: &str,
) -> Result<Vec<PathBuf>, AppError> {
    [provider_output_directory, delivery_directory]
        .into_iter()
        .map(|value| normalize_execution_path(repository, Path::new(value)))
        .map(|result| {
            result.and_then(|root| {
                if repository.starts_with(&root) || source_root.starts_with(&root) {
                    Err(AppError::validation_with_code(
                        format!(
                            "publish output {} cannot contain the selected source root {}",
                            root.display(),
                            source_root.display()
                        ),
                        "publish_runtime_provider_output_invalid",
                    ))
                } else {
                    Ok(root)
                }
            })
        })
        .collect()
}

fn normalize_execution_path(repository: &Path, path: &Path) -> Result<PathBuf, AppError> {
    let candidate = if path.is_absolute() {
        path.to_path_buf()
    } else {
        repository.join(path)
    };
    let mut normalized = PathBuf::new();
    for component in candidate.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(Path::new(std::path::MAIN_SEPARATOR_STR)),
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    return Err(AppError::validation_with_code(
                        format!(
                            "publish path {} escapes the filesystem root",
                            path.display()
                        ),
                        "publish_runtime_provider_output_invalid",
                    ));
                }
            }
            Component::Normal(value) => normalized.push(value),
        }
    }
    let mut existing = normalized.as_path();
    let mut missing = Vec::new();
    while !existing.exists() {
        let name = existing.file_name().ok_or_else(|| {
            AppError::validation_with_code(
                format!("publish path {} has no existing ancestor", path.display()),
                "publish_runtime_provider_output_invalid",
            )
        })?;
        missing.push(name.to_os_string());
        existing = existing.parent().ok_or_else(|| {
            AppError::validation_with_code(
                format!("publish path {} has no existing ancestor", path.display()),
                "publish_runtime_provider_output_invalid",
            )
        })?;
    }
    let mut canonical = fs::canonicalize(existing).map_err(|error| {
        AppError::validation_with_code(
            format!(
                "failed to resolve publish path ancestor {}: {error}",
                existing.display()
            ),
            "publish_runtime_provider_output_invalid",
        )
    })?;
    for component in missing.into_iter().rev() {
        canonical.push(component);
    }
    Ok(canonical)
}

fn parse_git_paths(output: &[u8]) -> Result<Vec<PathBuf>, AppError> {
    output
        .split(|byte| *byte == 0)
        .filter(|path| !path.is_empty())
        .map(|raw_path| {
            let relative = std::str::from_utf8(raw_path).map_err(|error| {
                source_snapshot_error(format!("source path is not valid UTF-8: {error}"))
            })?;
            let path = PathBuf::from(relative);
            if path.is_absolute()
                || path
                    .components()
                    .any(|component| matches!(component, Component::ParentDir))
            {
                return Err(source_snapshot_error(format!(
                    "git returned an invalid repository-relative source path {relative}"
                )));
            }
            Ok(path)
        })
        .collect()
}

fn is_excluded_source_path(absolute: &Path, excluded_roots: &[PathBuf]) -> bool {
    excluded_roots.iter().any(|root| absolute.starts_with(root))
}

fn is_sensitive_source_path(relative: &Path) -> bool {
    let file_name = relative
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    let lower_name = file_name.to_ascii_lowercase();
    let extension = relative
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    let sensitive_config_extension = matches!(
        extension.as_str(),
        "json" | "jsonc" | "toml" | "yaml" | "yml" | "ini" | "conf" | "config"
    );
    let has_sensitive_stem = |stem: &str| {
        lower_name == stem
            || (lower_name.starts_with(&format!("{stem}.")) && sensitive_config_extension)
    };

    lower_name == ".env"
        || lower_name.starts_with(".env.")
        || lower_name == ".npmrc"
        || lower_name == ".netrc"
        || lower_name == ".pypirc"
        || lower_name == "local.settings.json"
        || has_sensitive_stem("appsettings")
        || has_sensitive_stem("credential")
        || has_sensitive_stem("credentials")
        || has_sensitive_stem("secret")
        || has_sensitive_stem("secrets")
        || matches!(
            extension.as_str(),
            "key" | "pem" | "p12" | "pfx" | "jks" | "keystore"
        )
}

fn hash_source_input(
    hasher: &mut Sha256,
    repository: &Path,
    relative: &Path,
) -> Result<(), AppError> {
    let relative = relative.to_string_lossy().replace('\\', "/");
    update_digest_field(hasher, relative.as_bytes());
    let source_path = repository.join(&relative);
    let metadata = match fs::symlink_metadata(&source_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            update_digest_field(hasher, b"missing");
            return Ok(());
        }
        Err(error) => {
            return Err(source_snapshot_error(format!(
                "failed to inspect source input {}: {error}",
                source_path.display()
            )));
        }
    };
    if metadata.file_type().is_symlink() {
        return Err(source_snapshot_error(format!(
            "provider-declared source input cannot be a symlink: {}",
            source_path.display()
        )));
    }
    if !metadata.is_file() {
        return Err(source_snapshot_error(format!(
            "provider-declared source input is not a file: {}",
            source_path.display()
        )));
    }

    update_digest_field(hasher, b"file");
    hasher.update(metadata.len().to_be_bytes());
    let mut file = File::open(&source_path).map_err(|error| {
        source_snapshot_error(format!(
            "failed to open source input {}: {error}",
            source_path.display()
        ))
    })?;
    let mut buffer = [0_u8; 64 * 1024];
    let mut bytes_read = 0_u64;
    loop {
        let count = file.read(&mut buffer).map_err(|error| {
            source_snapshot_error(format!(
                "failed to read source input {}: {error}",
                source_path.display()
            ))
        })?;
        if count == 0 {
            break;
        }
        bytes_read = bytes_read.checked_add(count as u64).ok_or_else(|| {
            source_snapshot_error(format!(
                "source input is too large to snapshot: {}",
                source_path.display()
            ))
        })?;
        hasher.update(&buffer[..count]);
    }
    if bytes_read != metadata.len() {
        return Err(source_snapshot_error(format!(
            "source input changed while its snapshot was captured: {}",
            source_path.display()
        )));
    }
    Ok(())
}

fn update_digest_field(hasher: &mut Sha256, value: &[u8]) {
    hasher.update((value.len() as u64).to_be_bytes());
    hasher.update(value);
}

fn git_text(repository: &Path, args: &[&str]) -> Result<String, AppError> {
    let bytes = git_bytes(repository, args)?;
    String::from_utf8(bytes)
        .map(|value| value.trim().to_string())
        .map_err(|error| source_snapshot_error(format!("git output is not valid UTF-8: {error}")))
}

fn git_optional_text(repository: &Path, args: &[&str]) -> Result<Option<String>, AppError> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repository)
        .args(args)
        .output()
        .map_err(|error| source_snapshot_error(format!("failed to execute git: {error}")))?;
    if output.status.success() {
        return String::from_utf8(output.stdout)
            .map(|value| {
                let value = value.trim().to_string();
                (!value.is_empty()).then_some(value)
            })
            .map_err(|error| {
                source_snapshot_error(format!("git output is not valid UTF-8: {error}"))
            });
    }
    if output.status.code() == Some(1) {
        return Ok(None);
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(source_snapshot_error(format!(
        "git {} failed: {}",
        args.join(" "),
        if stderr.is_empty() {
            format!("exit status {}", output.status)
        } else {
            stderr
        }
    )))
}

fn git_bytes(repository: &Path, args: &[&str]) -> Result<Vec<u8>, AppError> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repository)
        .args(args)
        .output()
        .map_err(|error| source_snapshot_error(format!("failed to execute git: {error}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(source_snapshot_error(format!(
            "git {} failed: {}",
            args.join(" "),
            if stderr.is_empty() {
                format!("exit status {}", output.status)
            } else {
                stderr
            }
        )));
    }
    Ok(output.stdout)
}

fn append_digest_field(buffer: &mut Vec<u8>, value: &[u8]) {
    buffer.extend_from_slice(&(value.len() as u64).to_be_bytes());
    buffer.extend_from_slice(value);
}

fn source_snapshot_error(message: impl Into<String>) -> AppError {
    AppError::publish_with_code(message, "publish_runtime_source_snapshot_failed")
}

fn artifact_store_root() -> PathBuf {
    std::env::temp_dir().join("one-publish").join("artifacts")
}

fn new_attempt_identity(runtime_token: &str) -> AttemptIdentity {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let sequence = ATTEMPT_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let seed = publish_domain::sha256_hex(
        format!(
            "{}:{}:{}:{}",
            std::process::id(),
            timestamp,
            sequence,
            publish_domain::sha256_hex(runtime_token.as_bytes())
        )
        .as_bytes(),
    );
    AttemptIdentity {
        attempt_id: format!("attempt-{}", &seed[..24]),
        backend_run_id: format!("local-run-{}", &seed[24..48]),
    }
}

fn runtime_error(error: PublishError) -> AppError {
    AppError::publish_with_code(error.to_string(), "publish_runtime_error")
}

fn runtime_serialization_error(error: serde_json::Error) -> AppError {
    AppError::publish_with_code(
        format!("failed to serialize publish runtime contract: {error}"),
        "publish_runtime_serialization_failed",
    )
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::process::Command;
    use std::sync::{Arc, Mutex};

    use publish_runner_core::{PreparedPublishPlan, PublishRuntime, StartPublishAttempt};

    use crate::commands::{PublishResult, RenderedPublishCommand, SealedBuildCommand};
    use crate::spec::{PublishSpec, SpecValue, SPEC_VERSION};
    use crate::tauri_release::{ReleaseGate, TauriReleaseConfig};

    use super::{
        capture_source_snapshot, normalize_remote_namespace, project_identity, AttemptIdentity,
        PreparePublishRuntimeRequest, ProviderExecutionPort, ResolvedPublishConfiguration,
        RuntimeAttemptStatus, RuntimePlanStage, StartPublishRuntimeRequest,
    };

    /// 测试隔离：每次调用使用独立的租约协调器，避免并行测试因相同内容
    /// 摘要（相同 ReleaseNamespace）在进程级单例上互相阻断。
    fn start_runtime_with_port(
        request: StartPublishRuntimeRequest,
        execution_port: Arc<dyn ProviderExecutionPort>,
        identity: AttemptIdentity,
    ) -> Result<super::PublishRuntimeResult, crate::errors::AppError> {
        super::start_runtime_with_port(
            request,
            execution_port,
            identity,
            Arc::new(publish_runner_core::PublishLeaseCoordinator::new()),
        )
    }

    struct FakeProviderExecution {
        output_directory: std::path::PathBuf,
        output_is_file: bool,
        failure: Option<String>,
        source_change: Option<(std::path::PathBuf, Vec<u8>)>,
    }

    impl ProviderExecutionPort for FakeProviderExecution {
        fn execute(&self, spec: PublishSpec) -> Result<PublishResult, crate::errors::AppError> {
            let command = RenderedPublishCommand {
                program: "fake-publisher".to_string(),
                args: Vec::new(),
                working_dir: None,
                display_command: "fake-publisher".to_string(),
                env: Vec::new(),
            };
            if let Some(error) = &self.failure {
                return Ok(PublishResult {
                    provider_id: spec.provider_id,
                    success: false,
                    cancelled: false,
                    error: Some(error.clone()),
                    command,
                    output_log: error.clone(),
                    output_dir: self.output_directory.to_string_lossy().to_string(),
                    file_count: 0,
                    warnings: None,
                });
            }

            if let Some((path, contents)) = &self.source_change {
                std::fs::write(path, contents).expect("change source during provider execution");
            }

            let file_count = if self.output_is_file {
                std::fs::create_dir_all(
                    self.output_directory
                        .parent()
                        .expect("fake output file parent"),
                )
                .expect("create fake provider output parent");
                std::fs::write(&self.output_directory, b"application")
                    .expect("write fake provider output file");
                1
            } else {
                std::fs::create_dir_all(self.output_directory.join("nested"))
                    .expect("create fake provider output");
                std::fs::write(self.output_directory.join("app.bin"), b"application")
                    .expect("write top-level artifact");
                std::fs::write(
                    self.output_directory.join("nested").join("metadata.json"),
                    br#"{"version":1}"#,
                )
                .expect("write nested artifact");
                2
            };
            Ok(PublishResult {
                provider_id: spec.provider_id,
                success: true,
                cancelled: false,
                error: None,
                command,
                output_log: "published".to_string(),
                output_dir: self.output_directory.to_string_lossy().to_string(),
                file_count,
                warnings: None,
            })
        }

        fn execute_build(
            &self,
            request: SealedBuildCommand,
        ) -> Result<PublishResult, crate::errors::AppError> {
            panic!(
                "non-tauri providers must not execute sealed build commands: {}",
                request.program
            );
        }
    }

    /// Tauri 密封构建的受控 fixture：记录端口收到的结构化命令，
    /// 并在 Provider 原生 bundle 目录写出可分类的桌面产物。
    struct FakeTauriBuild {
        output_directory: std::path::PathBuf,
        failure: Option<String>,
        requests: Mutex<Vec<SealedBuildCommand>>,
    }

    impl FakeTauriBuild {
        fn new(output_directory: std::path::PathBuf) -> Self {
            Self {
                output_directory,
                failure: None,
                requests: Mutex::new(Vec::new()),
            }
        }

        fn failing(output_directory: std::path::PathBuf, error: &str) -> Self {
            Self {
                failure: Some(error.to_string()),
                ..Self::new(output_directory)
            }
        }

        fn requests(&self) -> Vec<SealedBuildCommand> {
            self.requests.lock().expect("fake build requests").clone()
        }
    }

    impl ProviderExecutionPort for FakeTauriBuild {
        fn execute(&self, _spec: PublishSpec) -> Result<PublishResult, crate::errors::AppError> {
            panic!("tauri runtime must not fall back to the legacy publish spec pipeline");
        }

        fn execute_build(
            &self,
            request: SealedBuildCommand,
        ) -> Result<PublishResult, crate::errors::AppError> {
            self.requests
                .lock()
                .expect("fake build requests")
                .push(request.clone());
            let command = RenderedPublishCommand {
                program: request.program.clone(),
                args: request.args.clone(),
                working_dir: Some(request.working_directory.to_string_lossy().to_string()),
                display_command: format!("{} {}", request.program, request.args.join(" ")),
                env: Vec::new(),
            };
            if let Some(error) = &self.failure {
                return Ok(PublishResult {
                    provider_id: request.provider_id,
                    success: false,
                    cancelled: false,
                    error: Some(error.clone()),
                    command,
                    output_log: error.clone(),
                    output_dir: self.output_directory.to_string_lossy().to_string(),
                    file_count: 0,
                    warnings: None,
                });
            }

            std::fs::create_dir_all(self.output_directory.join("dmg"))
                .expect("create dmg bundle directory");
            std::fs::create_dir_all(self.output_directory.join("macos"))
                .expect("create macos bundle directory");
            std::fs::write(
                self.output_directory.join("dmg").join("Demo.dmg"),
                b"installer",
            )
            .expect("write installer bundle");
            std::fs::write(
                self.output_directory.join("macos").join("Demo.app.tar.gz"),
                b"updater-archive",
            )
            .expect("write updater archive");
            std::fs::write(
                self.output_directory
                    .join("macos")
                    .join("Demo.app.tar.gz.sig"),
                b"updater-signature",
            )
            .expect("write updater signature");
            Ok(PublishResult {
                provider_id: request.provider_id,
                success: true,
                cancelled: false,
                error: None,
                command,
                output_log: "built".to_string(),
                output_dir: self.output_directory.to_string_lossy().to_string(),
                file_count: 3,
                warnings: None,
            })
        }
    }

    #[test]
    fn selected_revision_prepares_its_local_command_plan_and_blocking_state() {
        let repository = tempfile::tempdir().expect("create repository");
        let project_path = repository.path().join("App.csproj");
        std::fs::write(&project_path, "<Project />").expect("write project file");
        initialize_git_repository(repository.path());
        let output_directory = repository.path().join("publish-output");
        let spec = PublishSpec {
            version: SPEC_VERSION,
            provider_id: "dotnet".to_string(),
            project_path: project_path.to_string_lossy().to_string(),
            parameters: BTreeMap::from([
                (
                    "configuration".to_string(),
                    SpecValue::String("Release".to_string()),
                ),
                (
                    "output".to_string(),
                    SpecValue::String(output_directory.to_string_lossy().to_string()),
                ),
            ]),
        };
        let resolved = ResolvedPublishConfiguration {
            composition: crate::store::PublishComposition::local_default(),
            provider_id: "dotnet".to_string(),
            parameters: serde_json::to_value(&spec.parameters).expect("serialize parameters"),
            blocked_reason: None,
        };

        let prepared = super::prepare_runtime(
            PreparePublishRuntimeRequest {
                promoted_manifest_digest: None,
                repository_id: "repository-A".to_string(),
                repository_path: repository.path().to_string_lossy().to_string(),
                configuration_id: "configuration-A".to_string(),
                configuration_revision_id: "revision-A".to_string(),
                spec,
            },
            resolved,
        )
        .expect("prepare selected configuration");

        assert_eq!(prepared.configuration_id, "configuration-A");
        assert_eq!(prepared.configuration_revision_id, "revision-A");
        assert!(prepared.command.display_command.contains("dotnet publish"));
        assert_eq!(
            prepared
                .plan
                .nodes
                .iter()
                .map(|node| node.stage)
                .collect::<Vec<_>>(),
            vec![
                RuntimePlanStage::Build,
                RuntimePlanStage::PersistManifest,
                RuntimePlanStage::StageRoutes,
                RuntimePlanStage::PublishRoutes,
            ]
        );
        assert!(prepared.blocked_reason.is_none());
        assert!(!prepared.runtime_token.is_empty());
    }

    #[test]
    fn derived_default_output_does_not_change_the_selected_configuration_revision() {
        let repository = tempfile::tempdir().expect("create repository");
        let project_path = repository.path().join("App.csproj");
        std::fs::write(&project_path, "<Project />").expect("write project file");
        initialize_git_repository(repository.path());
        let output_directory = repository.path().join("publish-output");
        let spec = PublishSpec {
            version: SPEC_VERSION,
            provider_id: "dotnet".to_string(),
            project_path: project_path.to_string_lossy().to_string(),
            parameters: BTreeMap::from([
                (
                    "configuration".to_string(),
                    SpecValue::String("Release".to_string()),
                ),
                (
                    "output".to_string(),
                    SpecValue::String(output_directory.to_string_lossy().to_string()),
                ),
            ]),
        };
        let resolved = ResolvedPublishConfiguration {
            composition: crate::store::PublishComposition::local_default(),
            provider_id: "dotnet".to_string(),
            parameters: serde_json::json!({ "configuration": "Release" }),
            blocked_reason: None,
        };

        let prepared = super::prepare_runtime(
            PreparePublishRuntimeRequest {
                promoted_manifest_digest: None,
                repository_id: "repository-A".to_string(),
                repository_path: repository.path().to_string_lossy().to_string(),
                configuration_id: "configuration-A".to_string(),
                configuration_revision_id: "revision-A".to_string(),
                spec,
            },
            resolved,
        )
        .expect("prepare revision with derived output");

        assert!(prepared.blocked_reason.is_none());
        assert!(!prepared.runtime_token.is_empty());
    }

    #[test]
    fn unavailable_local_destination_blocks_the_prepared_runtime() {
        let repository = tempfile::tempdir().expect("create repository");
        let project_path = repository.path().join("App.csproj");
        std::fs::write(&project_path, "<Project />").expect("write project file");
        initialize_git_repository(repository.path());
        let output_directory = repository.path().join("publish-output");
        let delivery_directory = std::path::PathBuf::from(
            super::local_delivery_root(&output_directory.to_string_lossy())
                .expect("derive local destination"),
        );
        std::fs::write(&delivery_directory, "not a directory")
            .expect("occupy destination path with a file");
        let spec = PublishSpec {
            version: SPEC_VERSION,
            provider_id: "dotnet".to_string(),
            project_path: project_path.to_string_lossy().to_string(),
            parameters: BTreeMap::from([
                (
                    "configuration".to_string(),
                    SpecValue::String("Release".to_string()),
                ),
                (
                    "output".to_string(),
                    SpecValue::String(output_directory.to_string_lossy().to_string()),
                ),
            ]),
        };
        let resolved = ResolvedPublishConfiguration {
            composition: crate::store::PublishComposition::local_default(),
            provider_id: "dotnet".to_string(),
            parameters: serde_json::to_value(&spec.parameters).expect("serialize parameters"),
            blocked_reason: None,
        };

        let prepared = super::prepare_runtime(
            PreparePublishRuntimeRequest {
                promoted_manifest_digest: None,
                repository_id: "repository-A".to_string(),
                repository_path: repository.path().to_string_lossy().to_string(),
                configuration_id: "configuration-A".to_string(),
                configuration_revision_id: "revision-A".to_string(),
                spec,
            },
            resolved,
        )
        .expect("blocked destination still yields a visible plan");

        assert!(prepared
            .blocked_reason
            .as_deref()
            .is_some_and(|reason| reason.contains("delivery destination")
                && reason.contains("not a directory")));
        assert!(prepared.runtime_token.is_empty());
    }

    #[test]
    fn empty_provider_output_still_prepares_a_visible_blocked_plan() {
        let repository = tempfile::tempdir().expect("create repository");
        std::fs::write(repository.path().join("App.csproj"), "<Project />")
            .expect("write fixture project");
        initialize_git_repository(repository.path());
        let project_path = repository.path().join("go.mod");
        std::fs::write(&project_path, "module example.invalid/app\n").expect("write go project");
        let spec = PublishSpec {
            version: SPEC_VERSION,
            provider_id: "go".to_string(),
            project_path: project_path.to_string_lossy().to_string(),
            parameters: BTreeMap::new(),
        };

        let prepared = super::prepare_runtime(
            PreparePublishRuntimeRequest {
                promoted_manifest_digest: None,
                repository_id: "repository-A".to_string(),
                repository_path: repository.path().to_string_lossy().to_string(),
                configuration_id: "configuration-A".to_string(),
                configuration_revision_id: "revision-A".to_string(),
                spec,
            },
            ResolvedPublishConfiguration {
                composition: crate::store::PublishComposition::local_default(),
                provider_id: "go".to_string(),
                parameters: serde_json::json!({}),
                blocked_reason: None,
            },
        )
        .expect("blocked configuration still has a deterministic preview");

        assert!(prepared.command.display_command.contains("go build"));
        assert!(prepared
            .blocked_reason
            .as_deref()
            .is_some_and(|reason| reason.contains("output directory is empty")));
        assert!(!prepared.plan.nodes.is_empty());
        assert!(prepared.runtime_token.is_empty());
    }

    fn write_tauri_app(repository: &std::path::Path, app_prefix: &str, version: &str) {
        let app_root = repository.join(app_prefix);
        std::fs::create_dir_all(app_root.join("src-tauri")).expect("create tauri app directories");
        std::fs::write(
            app_root.join("src-tauri").join("tauri.conf.json"),
            format!(r#"{{"productName":"Demo","version":"{version}"}}"#),
        )
        .expect("write tauri config");
        std::fs::write(
            app_root.join("src-tauri").join("Cargo.toml"),
            format!("[package]\nname = \"demo\"\nversion = \"{version}\"\n"),
        )
        .expect("write cargo manifest");
        std::fs::write(
            app_root.join("package.json"),
            r#"{"packageManager":"pnpm@10.0.0"}"#,
        )
        .expect("write package manifest");
        std::fs::write(app_root.join("pnpm-lock.yaml"), "").expect("write lockfile");
    }

    fn tauri_prepare_request(
        repository: &std::path::Path,
        config_path: &std::path::Path,
    ) -> (PreparePublishRuntimeRequest, ResolvedPublishConfiguration) {
        let spec = PublishSpec {
            version: SPEC_VERSION,
            provider_id: "tauri".to_string(),
            project_path: config_path.to_string_lossy().to_string(),
            parameters: BTreeMap::new(),
        };
        (
            PreparePublishRuntimeRequest {
                promoted_manifest_digest: None,
                repository_id: "repository-A".to_string(),
                repository_path: repository.to_string_lossy().to_string(),
                configuration_id: "configuration-A".to_string(),
                configuration_revision_id: "revision-A".to_string(),
                spec: spec.clone(),
            },
            ResolvedPublishConfiguration {
                composition: crate::store::PublishComposition::local_default(),
                provider_id: "tauri".to_string(),
                parameters: serde_json::to_value(&spec.parameters).expect("serialize parameters"),
                blocked_reason: None,
            },
        )
    }

    #[test]
    fn tauri_configuration_prepares_the_generic_tauri_provider_plan() {
        let repository = tempfile::tempdir().expect("create repository");
        write_tauri_app(repository.path(), ".", "1.2.3");
        initialize_git_repository(repository.path());
        let (request, resolved) = tauri_prepare_request(
            repository.path(),
            &repository.path().join("src-tauri/tauri.conf.json"),
        );

        let prepared =
            super::prepare_runtime(request, resolved).expect("prepare tauri configuration");

        assert!(prepared.blocked_reason.is_none());
        assert!(!prepared.runtime_token.is_empty());
        assert!(prepared
            .command
            .display_command
            .contains("pnpm tauri build"));
        let tauri_nodes = prepared
            .plan
            .nodes
            .iter()
            .filter(|node| node.adapter_id == "tauri")
            .map(|node| (node.stage, node.operation.as_str()))
            .collect::<Vec<_>>();
        assert_eq!(
            tauri_nodes,
            vec![
                (RuntimePlanStage::InspectSource, "inspect_tauri_project"),
                (RuntimePlanStage::Build, "tauri-driver:pnpm"),
            ]
        );
    }

    #[test]
    fn missing_tauri_configuration_blocks_the_prepared_runtime() {
        let repository = tempfile::tempdir().expect("create repository");
        std::fs::write(repository.path().join("README.md"), "# fixture\n")
            .expect("write fixture file");
        initialize_git_repository(repository.path());
        let (request, resolved) = tauri_prepare_request(
            repository.path(),
            &repository.path().join("src-tauri/tauri.conf.json"),
        );

        let prepared = super::prepare_runtime(request, resolved)
            .expect("missing config still prepares a view");

        assert!(prepared
            .blocked_reason
            .as_deref()
            .is_some_and(|reason| reason.contains("tauri_candidate_not_found")));
        assert!(prepared.runtime_token.is_empty());
    }

    #[test]
    fn stale_tauri_binding_is_blocked_instead_of_rebinding_to_another_candidate() {
        let repository = tempfile::tempdir().expect("create repository");
        write_tauri_app(repository.path(), "apps/desktop", "1.0.0");
        write_tauri_app(repository.path(), "apps/kiosk", "2.0.0");
        initialize_git_repository(repository.path());
        let (request, resolved) = tauri_prepare_request(
            repository.path(),
            &repository
                .path()
                .join("apps/removed/src-tauri/tauri.conf.json"),
        );

        let prepared =
            super::prepare_runtime(request, resolved).expect("stale binding still prepares a view");

        assert!(prepared
            .blocked_reason
            .as_deref()
            .is_some_and(|reason| reason.contains("tauri_candidate_binding_stale")));
        assert!(prepared.runtime_token.is_empty());
    }

    #[test]
    fn bound_tauri_candidate_wins_over_discovery_order() {
        let repository = tempfile::tempdir().expect("create repository");
        write_tauri_app(repository.path(), "apps/desktop", "1.0.0");
        // kiosk 无 JS 标记，仅 src-tauri/Cargo.toml：驱动应解析为 cargo。
        let kiosk_root = repository.path().join("apps/kiosk");
        std::fs::create_dir_all(kiosk_root.join("src-tauri")).expect("create kiosk app");
        std::fs::write(
            kiosk_root.join("src-tauri").join("tauri.conf.json"),
            r#"{"productName":"Kiosk","version":"2.0.0"}"#,
        )
        .expect("write kiosk config");
        std::fs::write(
            kiosk_root.join("src-tauri").join("Cargo.toml"),
            "[package]\nname = \"kiosk\"\nversion = \"2.0.0\"\n",
        )
        .expect("write kiosk manifest");
        initialize_git_repository(repository.path());
        let (request, resolved) = tauri_prepare_request(
            repository.path(),
            &kiosk_root.join("src-tauri/tauri.conf.json"),
        );

        let prepared = super::prepare_runtime(request, resolved).expect("prepare bound candidate");

        assert!(prepared.blocked_reason.is_none());
        let build_node = prepared
            .plan
            .nodes
            .iter()
            .find(|node| node.adapter_id == "tauri" && node.stage == RuntimePlanStage::Build)
            .expect("tauri build node");
        assert_eq!(build_node.operation, "tauri-driver:cargo");
    }

    #[test]
    fn conflicting_tauri_build_driver_blocks_preparation() {
        let repository = tempfile::tempdir().expect("create repository");
        write_tauri_app(repository.path(), ".", "1.2.3");
        std::fs::write(repository.path().join("yarn.lock"), "").expect("write second lockfile");
        initialize_git_repository(repository.path());
        let (request, resolved) = tauri_prepare_request(
            repository.path(),
            &repository.path().join("src-tauri/tauri.conf.json"),
        );

        let prepared = super::prepare_runtime(request, resolved)
            .expect("driver conflict still prepares a view");

        assert!(prepared
            .blocked_reason
            .as_deref()
            .is_some_and(|reason| reason.contains("tauri_build_driver_conflict")));
        assert!(prepared.runtime_token.is_empty());
    }

    fn tauri_release_config(gates: Vec<ReleaseGate>) -> TauriReleaseConfig {
        TauriReleaseConfig {
            app_config_path: "src-tauri/tauri.conf.json".to_string(),
            release_gates: gates,
            ..TauriReleaseConfig::default()
        }
    }

    fn with_release_settings(
        mut resolved: ResolvedPublishConfiguration,
        config: TauriReleaseConfig,
    ) -> ResolvedPublishConfiguration {
        resolved.parameters[crate::tauri_release::RELEASE_SETTINGS_PARAMETER] =
            serde_json::to_value(config).expect("serialize release settings");
        resolved
    }

    fn gate(program: &str, args: &[&str]) -> ReleaseGate {
        ReleaseGate {
            program: program.to_string(),
            args: args.iter().map(|arg| (*arg).to_string()).collect(),
        }
    }

    fn tauri_bundle_directory(repository: &std::path::Path) -> std::path::PathBuf {
        repository
            .join("src-tauri")
            .join("target")
            .join("release")
            .join("bundle")
    }

    fn decoded_runtime_token(prepared: &super::PreparedPublishRuntime) -> PreparedPublishPlan {
        serde_json::from_str(&prepared.runtime_token).expect("decode prepared runtime token")
    }

    #[test]
    fn tauri_revision_release_settings_drive_gates_without_blocking_parameter_match() {
        let repository = tempfile::tempdir().expect("create repository");
        write_tauri_app(repository.path(), ".", "1.2.3");
        initialize_git_repository(repository.path());
        let (request, mut resolved) = tauri_prepare_request(
            repository.path(),
            &repository.path().join("src-tauri/tauri.conf.json"),
        );
        resolved.parameters[crate::tauri_release::RELEASE_SETTINGS_PARAMETER] =
            serde_json::to_value(tauri_release_config(vec![gate(
                "git",
                &["rev-parse", "HEAD"],
            )]))
            .expect("serialize release settings");

        let prepared = super::prepare_runtime(request, resolved)
            .expect("prepare tauri configuration from revision release settings");

        assert!(
            prepared.blocked_reason.is_none(),
            "release settings are not command parameters and must not read as drift: {:?}",
            prepared.blocked_reason
        );
        assert!(prepared
            .plan
            .nodes
            .iter()
            .any(|node| node.operation == "run_release_gate"));
    }

    #[test]
    fn corrupt_revision_release_settings_block_the_prepared_runtime() {
        let repository = tempfile::tempdir().expect("create repository");
        write_tauri_app(repository.path(), ".", "1.2.3");
        initialize_git_repository(repository.path());
        let (request, mut resolved) = tauri_prepare_request(
            repository.path(),
            &repository.path().join("src-tauri/tauri.conf.json"),
        );
        resolved.parameters[crate::tauri_release::RELEASE_SETTINGS_PARAMETER] =
            serde_json::json!({ "enabledTargets": "not-an-array" });

        let prepared = super::prepare_runtime(request, resolved)
            .expect("corrupt settings still prepare a blocked view");

        assert!(prepared
            .blocked_reason
            .as_deref()
            .is_some_and(|reason| reason.contains("tauri_release_settings_invalid")));
        assert!(prepared.runtime_token.is_empty());
    }

    #[test]
    fn tauri_plan_seals_release_gates_between_inspect_and_build() {
        let repository = tempfile::tempdir().expect("create repository");
        write_tauri_app(repository.path(), ".", "1.2.3");
        initialize_git_repository(repository.path());
        let (request, resolved) = tauri_prepare_request(
            repository.path(),
            &repository.path().join("src-tauri/tauri.conf.json"),
        );

        let prepared = super::prepare_runtime(
            request,
            with_release_settings(
                resolved,
                tauri_release_config(vec![
                    gate("git", &["rev-parse", "HEAD"]),
                    gate("git", &["status", "--porcelain"]),
                ]),
            ),
        )
        .expect("prepare tauri configuration with release gates");

        assert!(prepared.blocked_reason.is_none());
        let tauri_nodes = prepared
            .plan
            .nodes
            .iter()
            .filter(|node| node.adapter_id == "tauri")
            .map(|node| (node.stage, node.operation.as_str()))
            .collect::<Vec<_>>();
        assert_eq!(
            tauri_nodes,
            vec![
                (RuntimePlanStage::InspectSource, "inspect_tauri_project"),
                (RuntimePlanStage::PrepareIdentity, "run_release_gate"),
                (RuntimePlanStage::PrepareIdentity, "run_release_gate"),
                (RuntimePlanStage::Build, "tauri-driver:pnpm"),
            ]
        );
        let sealed = decoded_runtime_token(&prepared);
        assert_eq!(
            sealed
                .snapshot
                .release_input
                .get("version")
                .and_then(serde_json::Value::as_str),
            Some("1.2.3"),
            "tauri release identity must use the provider-resolved version"
        );
    }

    #[test]
    fn tauri_release_gates_apply_across_relative_path_spellings() {
        let repository = tempfile::tempdir().expect("create repository");
        write_tauri_app(repository.path(), ".", "1.2.3");
        initialize_git_repository(repository.path());
        let (request, resolved) = tauri_prepare_request(
            repository.path(),
            &repository.path().join("src-tauri/tauri.conf.json"),
        );
        let mut config = tauri_release_config(vec![gate("git", &["rev-parse", "HEAD"])]);
        config.app_config_path = "./src-tauri/tauri.conf.json".to_string();

        let prepared = super::prepare_runtime(request, with_release_settings(resolved, config))
            .expect("prepare tauri configuration");

        assert_eq!(
            prepared
                .plan
                .nodes
                .iter()
                .filter(|node| node.operation == "run_release_gate")
                .count(),
            1,
            "a ./-spelled binding still targets the same app and must keep its gates"
        );
    }

    #[test]
    fn tauri_release_gates_bound_to_another_app_are_not_sealed() {
        let repository = tempfile::tempdir().expect("create repository");
        write_tauri_app(repository.path(), ".", "1.2.3");
        initialize_git_repository(repository.path());
        let (request, resolved) = tauri_prepare_request(
            repository.path(),
            &repository.path().join("src-tauri/tauri.conf.json"),
        );
        let mut config = tauri_release_config(vec![gate("git", &["rev-parse", "HEAD"])]);
        config.app_config_path = "apps/other/src-tauri/tauri.conf.json".to_string();

        let prepared = super::prepare_runtime(request, with_release_settings(resolved, config))
            .expect("prepare tauri configuration");

        assert!(prepared
            .plan
            .nodes
            .iter()
            .all(|node| node.operation != "run_release_gate"));
    }

    #[test]
    fn tauri_gate_failure_blocks_build_and_delivery_with_the_root_cause() {
        let repository = tempfile::tempdir().expect("create repository");
        write_tauri_app(repository.path(), ".", "1.2.3");
        initialize_git_repository(repository.path());
        let (request, resolved) = tauri_prepare_request(
            repository.path(),
            &repository.path().join("src-tauri/tauri.conf.json"),
        );
        let prepared = super::prepare_runtime(
            request,
            with_release_settings(
                resolved,
                tauri_release_config(vec![gate(
                    "git",
                    &["rev-parse", "--verify", "one-publish-missing-gate-ref"],
                )]),
            ),
        )
        .expect("prepare tauri configuration with a failing gate");
        let bundle_directory = tauri_bundle_directory(repository.path());
        let build = Arc::new(FakeTauriBuild::new(bundle_directory.clone()));

        let result = start_runtime_with_port(
            StartPublishRuntimeRequest {
                runtime_token: prepared.runtime_token,
            },
            Arc::clone(&build) as Arc<dyn ProviderExecutionPort>,
            AttemptIdentity {
                attempt_id: "attempt-gate-failed".to_string(),
                backend_run_id: "run-gate-failed".to_string(),
            },
        )
        .expect("gate failure must reduce to a failed attempt");

        assert_eq!(result.attempt.status, RuntimeAttemptStatus::Failed);
        assert!(result.attempt.manifest.is_none());
        assert!(result.attempt.receipts.is_empty());
        assert!(result
            .attempt
            .error
            .as_deref()
            .is_some_and(|error| error.contains("release gate failed")));
        assert!(
            build.requests().is_empty(),
            "a failed gate must stop the build side effect"
        );
        assert!(
            !bundle_directory.exists(),
            "no bundle output may appear after a failed gate"
        );
        assert!(result.publish_result.is_none());
    }

    #[test]
    fn tauri_build_runs_the_sealed_driver_command_after_its_gates() {
        let repository = tempfile::tempdir().expect("create repository");
        write_tauri_app(repository.path(), ".", "1.2.3");
        initialize_git_repository(repository.path());
        let (request, resolved) = tauri_prepare_request(
            repository.path(),
            &repository.path().join("src-tauri/tauri.conf.json"),
        );
        let prepared = super::prepare_runtime(
            request,
            with_release_settings(
                resolved,
                tauri_release_config(vec![gate("git", &["rev-parse", "HEAD"])]),
            ),
        )
        .expect("prepare tauri configuration");
        let bundle_directory = tauri_bundle_directory(repository.path());
        let build = Arc::new(FakeTauriBuild::new(bundle_directory.clone()));

        let result = start_runtime_with_port(
            StartPublishRuntimeRequest {
                runtime_token: prepared.runtime_token,
            },
            Arc::clone(&build) as Arc<dyn ProviderExecutionPort>,
            AttemptIdentity {
                attempt_id: "attempt-tauri".to_string(),
                backend_run_id: "run-tauri".to_string(),
            },
        )
        .expect("start tauri runtime");

        assert_eq!(result.attempt.status, RuntimeAttemptStatus::Published);
        let canonical_repository =
            std::fs::canonicalize(repository.path()).expect("canonicalize repository");
        let requests = build.requests();
        assert_eq!(requests.len(), 1, "the sealed build runs exactly once");
        assert_eq!(requests[0].program, "pnpm");
        assert_eq!(
            requests[0].args,
            vec![
                "tauri".to_string(),
                "build".to_string(),
                "--config".to_string(),
                canonical_repository
                    .join("src-tauri/tauri.conf.json")
                    .to_string_lossy()
                    .to_string(),
            ]
        );
        assert_eq!(requests[0].working_directory, canonical_repository);
        assert_eq!(
            result
                .attempt
                .manifest
                .as_ref()
                .map(|manifest| manifest.artifact_count),
            Some(4)
        );
        assert_eq!(result.attempt.receipts.len(), 1);
        let delivery_directory =
            std::path::PathBuf::from(&result.attempt.receipts[0].external_reference);
        assert!(delivery_directory.join("dmg").join("Demo.dmg").is_file());
        assert!(
            bundle_directory.join("dmg").join("Demo.dmg").is_file(),
            "delivery must not replace or clean the provider-native bundle output"
        );
        assert!(result
            .publish_result
            .as_ref()
            .is_some_and(|publish| publish.success));
    }

    #[test]
    fn tauri_manifest_entries_carry_roles_platform_and_architecture() {
        let repository = tempfile::tempdir().expect("create repository");
        write_tauri_app(repository.path(), ".", "1.2.3");
        initialize_git_repository(repository.path());
        let (request, resolved) = tauri_prepare_request(
            repository.path(),
            &repository.path().join("src-tauri/tauri.conf.json"),
        );
        let prepared =
            super::prepare_runtime(request, resolved).expect("prepare tauri configuration");
        let sealed = decoded_runtime_token(&prepared);
        let release_value = |key: &str| {
            sealed
                .snapshot
                .release_input
                .get(key)
                .and_then(serde_json::Value::as_str)
                .expect("sealed release input value")
                .to_string()
        };
        let bundle_directory = tauri_bundle_directory(repository.path());
        let source_guard = super::PreparedSourceGuard::from_snapshot(&sealed.snapshot)
            .expect("restore source guard");
        let registry = super::build_registry(
            &sealed.snapshot,
            &release_value("delivery_directory"),
            Some(super::SelectedProviderExecution {
                port: Arc::new(FakeTauriBuild::new(bundle_directory)),
                result: Arc::new(Mutex::new(None)),
                output_directory: std::path::PathBuf::from(release_value(
                    "provider_output_directory",
                )),
                source_guard,
            }),
        )
        .expect("build execution registry");

        let view = PublishRuntime::new(registry)
            .start_attempt(
                &sealed,
                StartPublishAttempt::new(
                    "attempt-roles",
                    "run-roles",
                    super::release_identity(&sealed.snapshot).expect("release identity"),
                ),
                &publish_runner_core::AttemptExecutionContext::at(0),
            )
            .expect("run tauri attempt");

        let manifest = view.manifest.expect("sealed artifact manifest");
        let entries = manifest
            .artifacts
            .iter()
            .map(|entry| {
                (
                    entry.file_name.as_str(),
                    entry.role.as_str(),
                    entry.media_type.as_str(),
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(
            entries,
            vec![
                ("dmg/Demo.dmg", "installer", "application/x-apple-diskimage"),
                (
                    "macos/Demo.app.tar.gz",
                    "updater-archive",
                    "application/gzip"
                ),
                (
                    "macos/Demo.app.tar.gz.sig",
                    "updater-signature",
                    "application/octet-stream"
                ),
                ("SHA256SUMS", "checksum-manifest", "text/plain"),
            ]
        );
        for entry in &manifest.artifacts {
            // 校验和清单覆盖全部平台，其余产物携带构建主机的平台与架构。
            if entry.role == "checksum-manifest" {
                assert_eq!(entry.platform, "any");
                assert_eq!(entry.architecture, "any");
            } else {
                assert_eq!(entry.platform, std::env::consts::OS);
                assert_eq!(entry.architecture, std::env::consts::ARCH);
            }
            assert!(
                std::path::Path::new(&entry.locator).is_file(),
                "manifest locator must point at the stored artifact: {}",
                entry.locator
            );
        }
    }

    #[test]
    fn tauri_build_failure_stops_delivery_and_keeps_the_root_cause() {
        let repository = tempfile::tempdir().expect("create repository");
        write_tauri_app(repository.path(), ".", "1.2.3");
        initialize_git_repository(repository.path());
        let (request, resolved) = tauri_prepare_request(
            repository.path(),
            &repository.path().join("src-tauri/tauri.conf.json"),
        );
        let prepared =
            super::prepare_runtime(request, resolved).expect("prepare tauri configuration");
        let bundle_directory = tauri_bundle_directory(repository.path());
        let build = Arc::new(FakeTauriBuild::failing(
            bundle_directory,
            "tauri build exited with code 101",
        ));

        let result = start_runtime_with_port(
            StartPublishRuntimeRequest {
                runtime_token: prepared.runtime_token,
            },
            Arc::clone(&build) as Arc<dyn ProviderExecutionPort>,
            AttemptIdentity {
                attempt_id: "attempt-build-failed".to_string(),
                backend_run_id: "run-build-failed".to_string(),
            },
        )
        .expect("build failure must reduce to a failed attempt");

        assert_eq!(result.attempt.status, RuntimeAttemptStatus::Failed);
        assert!(result.attempt.manifest.is_none());
        assert!(result.attempt.receipts.is_empty());
        assert!(result
            .attempt
            .error
            .as_deref()
            .is_some_and(|error| error.contains("tauri build exited with code 101")));
        assert!(!result.publish_result.expect("failed build result").success);
    }

    #[test]
    fn tauri_workspace_build_records_head_dirty_state_and_a_stable_digest() {
        let repository = tempfile::tempdir().expect("create repository");
        write_tauri_app(repository.path(), ".", "1.2.3");
        initialize_git_repository(repository.path());
        let draft = repository.path().join("notes.md");
        std::fs::write(&draft, "uncommitted draft").expect("write uncommitted source");
        let request_pair = || {
            tauri_prepare_request(
                repository.path(),
                &repository.path().join("src-tauri/tauri.conf.json"),
            )
        };

        let (request, resolved) = request_pair();
        let first = super::prepare_runtime(request, resolved).expect("prepare workspace build");
        let (request, resolved) = request_pair();
        let second = super::prepare_runtime(request, resolved)
            .expect("re-prepare unchanged workspace build");

        let first_source = decoded_runtime_token(&first).snapshot.source;
        let second_source = decoded_runtime_token(&second).snapshot.source;
        let head = {
            let output = Command::new("git")
                .arg("-C")
                .arg(repository.path())
                .args(["rev-parse", "HEAD"])
                .output()
                .expect("read fixture HEAD");
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        };
        assert_eq!(first_source.revision, head);
        assert!(first_source.dirty);
        assert!(!first_source.reproducible);
        assert!(first_source.workspace_digest.is_some());
        assert_eq!(
            first_source.workspace_digest,
            second_source.workspace_digest
        );

        let bundle_directory = tauri_bundle_directory(repository.path());
        let result = start_runtime_with_port(
            StartPublishRuntimeRequest {
                runtime_token: second.runtime_token,
            },
            Arc::new(FakeTauriBuild::new(bundle_directory)),
            AttemptIdentity {
                attempt_id: "attempt-workspace".to_string(),
                backend_run_id: "run-workspace".to_string(),
            },
        )
        .expect("run workspace build");

        assert_eq!(result.attempt.status, RuntimeAttemptStatus::Published);
        assert_eq!(
            std::fs::read_to_string(&draft).expect("read uncommitted source"),
            "uncommitted draft",
            "workspace builds must not save or modify uncommitted changes"
        );
    }

    #[test]
    fn tauri_build_rejects_an_operation_that_drifts_from_the_sealed_driver() {
        use publish_adapters::AdapterExecutionContext;

        let repository = tempfile::tempdir().expect("create repository");
        write_tauri_app(repository.path(), ".", "1.2.3");
        let provider = super::TauriRuntimeProvider::new(
            "src-tauri/tauri.conf.json".to_string(),
            "pnpm".to_string(),
            repository.path().to_path_buf(),
            None,
        );
        let settings = publish_domain::AdapterSettings::new(1)
            .with_value(
                "config_path",
                serde_json::Value::String("src-tauri/tauri.conf.json".to_string()),
            )
            .with_value(
                "build_driver",
                serde_json::Value::String("pnpm".to_string()),
            );
        let drifted = publish_domain::PlanNode {
            id: "project.build".to_string(),
            stage: publish_domain::PlanStage::Build,
            adapter: publish_domain::AdapterIdentity::new(
                publish_domain::AdapterKind::ProjectProvider,
                "tauri",
                1,
            ),
            binding_id: "project".to_string(),
            settings,
            operation: publish_domain::PlanOperation::RunProgram {
                program: "tauri-driver:yarn".to_string(),
                args: vec![
                    "tauri".to_string(),
                    "build".to_string(),
                    "--config".to_string(),
                    "src-tauri/tauri.conf.json".to_string(),
                ],
                working_directory: None,
                environment_references: BTreeMap::new(),
            },
            depends_on: Vec::new(),
            artifact_inputs: Vec::new(),
            artifact_outputs: Vec::new(),
            side_effects: Vec::new(),
            irreversible: false,
        };
        let credentials = BTreeMap::new();
        let context = AdapterExecutionContext {
            attempt_id: "attempt-drift",
            plan_digest: "plan-digest",
            snapshot_digest: "snapshot-digest",
            artifacts: &[],
            manifest: None,
            envelopes: &[],
            receipts: &[],
            credentials: &credentials,
        };

        let error = publish_adapters::AdapterContract::execute_node(&provider, &drifted, &context)
            .expect_err("a drifted build operation must never execute");

        assert!(
            error
                .to_string()
                .contains("is not the sealed tauri build operation"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn project_identity_rejects_parent_traversal_outside_the_repository() {
        let workspace = tempfile::tempdir().expect("create workspace");
        let repository = workspace.path().join("repository");
        let outside = workspace.path().join("outside");
        std::fs::create_dir_all(&repository).expect("create repository");
        std::fs::create_dir_all(&outside).expect("create outside directory");
        std::fs::write(repository.join("App.csproj"), "<Project />")
            .expect("write repository project");
        std::fs::write(outside.join("Outside.csproj"), "<Project />")
            .expect("write outside project");
        initialize_git_repository(&repository);
        let traversing_project = repository.join("..").join("outside").join("Outside.csproj");
        let spec = PublishSpec {
            version: SPEC_VERSION,
            provider_id: "dotnet".to_string(),
            project_path: traversing_project.to_string_lossy().to_string(),
            parameters: BTreeMap::from([
                (
                    "configuration".to_string(),
                    SpecValue::String("Release".to_string()),
                ),
                (
                    "output".to_string(),
                    SpecValue::String(repository.join("output").to_string_lossy().to_string()),
                ),
            ]),
        };
        let resolved = ResolvedPublishConfiguration {
            composition: crate::store::PublishComposition::local_default(),
            provider_id: "dotnet".to_string(),
            parameters: serde_json::to_value(&spec.parameters).expect("serialize parameters"),
            blocked_reason: None,
        };

        let error = super::prepare_runtime(
            PreparePublishRuntimeRequest {
                promoted_manifest_digest: None,
                repository_id: "repository-A".to_string(),
                repository_path: repository.to_string_lossy().to_string(),
                configuration_id: "configuration-A".to_string(),
                configuration_revision_id: "revision-A".to_string(),
                spec,
            },
            resolved,
        )
        .expect_err("parent traversal must not identify a project outside the repository");

        assert_eq!(
            error.code.as_deref(),
            Some("publish_runtime_project_outside_repository")
        );
    }

    #[test]
    fn project_identity_is_portable_across_git_checkouts() {
        let workspace = tempfile::tempdir().expect("create workspace");
        let repository = workspace.path().join("repository");
        let checkout = workspace.path().join("checkout");
        std::fs::create_dir_all(&repository).expect("create repository");
        std::fs::write(repository.join("App.csproj"), "<Project />").expect("write project file");
        initialize_git_repository(&repository);
        let clone = Command::new("git")
            .args(["clone", "--quiet"])
            .arg(&repository)
            .arg(&checkout)
            .output()
            .expect("clone repository fixture");
        assert!(
            clone.status.success(),
            "git clone failed: {}",
            String::from_utf8_lossy(&clone.stderr)
        );
        let first_spec = PublishSpec {
            version: SPEC_VERSION,
            provider_id: "dotnet".to_string(),
            project_path: repository.join("App.csproj").to_string_lossy().to_string(),
            parameters: BTreeMap::new(),
        };
        let second_spec = PublishSpec {
            project_path: checkout.join("App.csproj").to_string_lossy().to_string(),
            ..first_spec.clone()
        };

        let first = project_identity(&repository.to_string_lossy(), &first_spec)
            .expect("identify source checkout");
        let second = project_identity(&checkout.to_string_lossy(), &second_spec)
            .expect("identify cloned checkout");

        assert_eq!(first, second);
        assert!(first.starts_with("project:"));
        let repository_path = repository.to_string_lossy().to_string();
        assert!(!first.contains(&repository_path));
    }

    #[test]
    fn project_identity_separates_different_git_histories() {
        let first_repository = tempfile::tempdir().expect("create first repository");
        let second_repository = tempfile::tempdir().expect("create second repository");
        std::fs::write(
            first_repository.path().join("App.csproj"),
            "<Project First='true' />",
        )
        .expect("write first project");
        std::fs::write(
            second_repository.path().join("App.csproj"),
            "<Project Second='true' />",
        )
        .expect("write second project");
        initialize_git_repository(first_repository.path());
        initialize_git_repository(second_repository.path());
        let spec_for = |repository: &std::path::Path| PublishSpec {
            version: SPEC_VERSION,
            provider_id: "dotnet".to_string(),
            project_path: repository.join("App.csproj").to_string_lossy().to_string(),
            parameters: BTreeMap::new(),
        };

        let first = project_identity(
            &first_repository.path().to_string_lossy(),
            &spec_for(first_repository.path()),
        )
        .expect("identify first history");
        let second = project_identity(
            &second_repository.path().to_string_lossy(),
            &spec_for(second_repository.path()),
        )
        .expect("identify second history");

        assert_ne!(first, second);
    }

    #[test]
    fn remote_namespace_omits_credentials_query_and_git_suffix() {
        assert_eq!(
            normalize_remote_namespace(
                "https://build-user:secret@GitHub.COM/sperictao/one-publish.git?token=ignored"
            )
            .as_deref(),
            Some("github.com/sperictao/one-publish")
        );
        assert_eq!(
            normalize_remote_namespace("git@GitHub.COM:sperictao/one-publish.git").as_deref(),
            Some("github.com/sperictao/one-publish")
        );
        assert!(normalize_remote_namespace("C:\\source\\one-publish").is_none());
    }

    #[test]
    fn dirty_source_snapshot_has_a_stable_workspace_digest() {
        let repository = tempfile::tempdir().expect("create repository");
        std::fs::write(repository.path().join("App.csproj"), "<Project />")
            .expect("write project file");
        initialize_git_repository(repository.path());
        std::fs::write(repository.path().join("Program.cs"), "first")
            .expect("write untracked source input");

        let first = capture_source_snapshot(repository.path(), repository.path(), "dotnet", &[])
            .expect("capture dirty source");
        let repeated = capture_source_snapshot(repository.path(), repository.path(), "dotnet", &[])
            .expect("recapture unchanged dirty source");

        assert!(first.dirty);
        assert!(!first.reproducible);
        assert!(first.workspace_digest.is_some());
        assert_eq!(first.workspace_digest, repeated.workspace_digest);

        std::fs::write(repository.path().join("Program.cs"), "second")
            .expect("change untracked source input");
        let changed = capture_source_snapshot(repository.path(), repository.path(), "dotnet", &[])
            .expect("capture changed source");
        assert_ne!(first.workspace_digest, changed.workspace_digest);
    }

    #[test]
    fn source_snapshot_never_reads_credential_inputs() {
        let repository = tempfile::tempdir().expect("create repository");
        std::fs::write(repository.path().join("App.csproj"), "<Project />")
            .expect("write project file");
        initialize_git_repository(repository.path());
        std::fs::write(repository.path().join(".gitignore"), ".env.local\n")
            .expect("ignore local environment file");
        let credential = repository.path().join(".env.local");
        std::fs::write(&credential, "TOKEN=first-secret").expect("write credential input");

        let first = capture_source_snapshot(repository.path(), repository.path(), "dotnet", &[])
            .expect("capture credential path without reading its contents");
        std::fs::write(&credential, "TOKEN=a-different-secret")
            .expect("change credential contents");
        let changed = capture_source_snapshot(repository.path(), repository.path(), "dotnet", &[])
            .expect("recapture credential path without reading its contents");

        assert!(first.dirty);
        assert!(!first.reproducible);
        assert!(first.workspace_digest.is_some());
        assert_eq!(first.workspace_digest, changed.workspace_digest);
    }

    #[test]
    fn provider_declared_source_named_secrets_changes_the_workspace_digest() {
        let repository = tempfile::tempdir().expect("create repository");
        std::fs::write(repository.path().join("App.csproj"), "<Project />")
            .expect("write project file");
        initialize_git_repository(repository.path());
        let source = repository.path().join("secrets.rs");
        std::fs::write(&source, "pub const LABEL: &str = \"first\";")
            .expect("write provider-declared Rust source");

        let first = capture_source_snapshot(repository.path(), repository.path(), "cargo", &[])
            .expect("capture provider-declared source");
        std::fs::write(&source, "pub const LABEL: &str = \"second\";")
            .expect("change provider-declared Rust source");
        let changed = capture_source_snapshot(repository.path(), repository.path(), "cargo", &[])
            .expect("capture changed provider-declared source");

        assert_ne!(first.workspace_digest, changed.workspace_digest);
    }

    #[test]
    fn clean_tracked_environment_files_do_not_dirty_the_source_snapshot() {
        let repository = tempfile::tempdir().expect("create repository");
        std::fs::write(repository.path().join("App.csproj"), "<Project />")
            .expect("write project file");
        initialize_git_repository(repository.path());
        std::fs::write(
            repository.path().join(".npmrc"),
            "registry=https://example.invalid\n",
        )
        .expect("write tracked environment file");
        run_git_fixture(repository.path(), &["add", ".npmrc"]);
        run_git_fixture(
            repository.path(),
            &[
                "-c",
                "user.name=One Publish Tests",
                "-c",
                "user.email=tests@one-publish.invalid",
                "commit",
                "--quiet",
                "-m",
                "track environment fixture",
            ],
        );

        let snapshot = capture_source_snapshot(repository.path(), repository.path(), "tauri", &[])
            .expect("capture clean tracked environment file");

        assert!(!snapshot.dirty);
        assert!(snapshot.workspace_digest.is_none());
        assert!(snapshot.reproducible);
    }

    #[test]
    fn source_snapshot_includes_arbitrary_project_resources() {
        let repository = tempfile::tempdir().expect("create repository");
        std::fs::write(repository.path().join("App.csproj"), "<Project />")
            .expect("write project file");
        initialize_git_repository(repository.path());
        let resource = repository.path().join("wwwroot").join("app.css");
        std::fs::create_dir_all(resource.parent().expect("resource parent"))
            .expect("create resource directory");
        std::fs::write(&resource, "body { color: red; }").expect("write resource");

        let first = capture_source_snapshot(repository.path(), repository.path(), "dotnet", &[])
            .expect("capture arbitrary project resource");
        std::fs::write(&resource, "body { color: blue; }").expect("change resource");
        let changed = capture_source_snapshot(repository.path(), repository.path(), "dotnet", &[])
            .expect("capture changed project resource");

        assert!(first.dirty);
        assert_ne!(first.workspace_digest, changed.workspace_digest);
    }

    #[test]
    fn source_snapshot_does_not_ignore_nested_source_directories_named_build() {
        let repository = tempfile::tempdir().expect("create repository");
        std::fs::write(repository.path().join("App.csproj"), "<Project />")
            .expect("write project file");
        initialize_git_repository(repository.path());
        let template = repository
            .path()
            .join("src")
            .join("build")
            .join("template.txt");
        std::fs::create_dir_all(template.parent().expect("template parent"))
            .expect("create template directory");
        std::fs::write(&template, "first").expect("write template");

        let first = capture_source_snapshot(repository.path(), repository.path(), "java", &[])
            .expect("capture nested build source directory");
        std::fs::write(&template, "second").expect("change template");
        let changed = capture_source_snapshot(repository.path(), repository.path(), "java", &[])
            .expect("capture changed template");

        assert!(first.dirty);
        assert!(!first.reproducible);
        assert_eq!(first.workspace_digest, changed.workspace_digest);
    }

    #[test]
    fn undeclared_inputs_are_environment_dependent_and_never_content_hashed() {
        let repository = tempfile::tempdir().expect("create repository");
        std::fs::write(repository.path().join("App.csproj"), "<Project />")
            .expect("write project file");
        initialize_git_repository(repository.path());
        let environment_input = repository.path().join("config.toml");
        std::fs::write(&environment_input, "token = 'first-secret'")
            .expect("write undeclared environment input");

        let first = capture_source_snapshot(repository.path(), repository.path(), "cargo", &[])
            .expect("capture undeclared environment input");
        std::fs::write(&environment_input, "token = 'other-secret'")
            .expect("change undeclared environment input");
        let changed = capture_source_snapshot(repository.path(), repository.path(), "cargo", &[])
            .expect("recapture undeclared environment input");

        assert!(first.dirty);
        assert!(!first.reproducible);
        assert_eq!(first.workspace_digest, changed.workspace_digest);
    }

    #[test]
    fn source_snapshot_is_scoped_to_the_selected_project_root() {
        let repository = tempfile::tempdir().expect("create repository");
        std::fs::write(repository.path().join("App.csproj"), "<Project />")
            .expect("write root project file");
        initialize_git_repository(repository.path());
        let selected = repository.path().join("apps").join("selected");
        let sibling = repository.path().join("apps").join("sibling");
        std::fs::create_dir_all(&selected).expect("create selected project");
        std::fs::create_dir_all(&sibling).expect("create sibling project");
        std::fs::write(selected.join("Selected.csproj"), "<Project />")
            .expect("write selected project");
        std::fs::write(selected.join("Program.cs"), "selected").expect("write selected source");
        let sibling_source = sibling.join("Program.cs");
        std::fs::write(&sibling_source, "first").expect("write sibling source");

        let first = capture_source_snapshot(repository.path(), &selected, "dotnet", &[])
            .expect("capture selected project");
        std::fs::write(&sibling_source, "second").expect("change sibling source");
        let changed = capture_source_snapshot(repository.path(), &selected, "dotnet", &[])
            .expect("recapture selected project");

        assert_eq!(first.workspace_digest, changed.workspace_digest);
    }

    #[test]
    fn provider_output_cannot_contain_the_selected_project_root() {
        let repository = tempfile::tempdir().expect("create repository");
        std::fs::write(repository.path().join("App.csproj"), "<Project />")
            .expect("write root project file");
        initialize_git_repository(repository.path());
        let project = repository.path().join("apps").join("selected");
        std::fs::create_dir_all(&project).expect("create selected project");
        let project_path = project.join("Selected.csproj");
        std::fs::write(&project_path, "<Project />").expect("write selected project");
        let output = repository.path().join("apps");
        let spec = PublishSpec {
            version: SPEC_VERSION,
            provider_id: "dotnet".to_string(),
            project_path: project_path.to_string_lossy().to_string(),
            parameters: BTreeMap::from([
                (
                    "configuration".to_string(),
                    SpecValue::String("Release".to_string()),
                ),
                (
                    "output".to_string(),
                    SpecValue::String(output.to_string_lossy().to_string()),
                ),
            ]),
        };
        let resolved = ResolvedPublishConfiguration {
            composition: crate::store::PublishComposition::local_default(),
            provider_id: "dotnet".to_string(),
            parameters: serde_json::to_value(&spec.parameters).expect("serialize parameters"),
            blocked_reason: None,
        };

        let error = super::prepare_runtime(
            PreparePublishRuntimeRequest {
                promoted_manifest_digest: None,
                repository_id: "repository-A".to_string(),
                repository_path: repository.path().to_string_lossy().to_string(),
                configuration_id: "configuration-A".to_string(),
                configuration_revision_id: "revision-A".to_string(),
                spec,
            },
            resolved,
        )
        .expect_err("provider output must not contain the selected source root");

        assert_eq!(
            error.code.as_deref(),
            Some("publish_runtime_provider_output_invalid")
        );
    }

    #[test]
    fn source_snapshot_excludes_the_provider_output_tree() {
        let repository = tempfile::tempdir().expect("create repository");
        std::fs::write(repository.path().join("App.csproj"), "<Project />")
            .expect("write project file");
        initialize_git_repository(repository.path());
        let output_directory = repository.path().join("publish-output");
        std::fs::create_dir_all(&output_directory).expect("create provider output");
        std::fs::write(output_directory.join("Generated.cs"), "generated")
            .expect("write generated provider output");

        let snapshot = capture_source_snapshot(
            repository.path(),
            repository.path(),
            "dotnet",
            std::slice::from_ref(&output_directory),
        )
        .expect("exclude provider output from source identity");

        assert!(!snapshot.dirty);
        assert!(snapshot.workspace_digest.is_none());
        assert!(snapshot.reproducible);
    }

    #[test]
    fn legacy_revision_without_composition_materializes_the_local_default() {
        let revision: crate::store::PublishConfigurationRevision = serde_json::from_value(
            serde_json::json!({
                "id": "revision-legacy",
                "sequence": 1,
                "createdAt": "2026-01-01T00:00:00Z",
                "providerId": "dotnet",
                "parameters": {}
            }),
        )
        .expect("deserialize a pre-composition revision");

        assert_eq!(
            revision.composition,
            crate::store::PublishComposition::local_default()
        );
    }

    #[test]
    fn composition_selection_carries_routes_backend_store_and_credentials() {
        let mut composition = crate::store::PublishComposition::local_default();
        composition
            .delivery_routes
            .push(crate::store::RevisionDeliveryRoute {
                route_id: "sftp-mirror".to_string(),
                required: false,
                destination: crate::store::RevisionAdapterBinding {
                    adapter_id: super::SFTP_DESTINATION_ID.to_string(),
                    settings_version: 1,
                    settings: serde_json::json!({
                        "host": "mirror.example.invalid",
                        "port": 22,
                        "username": "publisher",
                        "remote_path": "/srv/releases",
                        "artifact_roles": ["provider-output:*"]
                    }),
                    credentials: BTreeMap::from([(
                        "ssh_private_key".to_string(),
                        "keychain:one-publish/sftp-mirror".to_string(),
                    )]),
                },
            });

        let selection = super::composition_selection(
            &composition,
            super::AdapterBinding::new(
                "project",
                super::AdapterIdentity::new(
                    super::AdapterKind::ProjectProvider,
                    super::TAURI_PROVIDER_ID,
                    1,
                ),
                super::AdapterSettings::new(1),
            ),
            true,
            "/tmp/delivery-root",
        )
        .expect("materialize the revision composition");

        assert_eq!(
            selection.execution_backend.adapter.id,
            super::LOCAL_BACKEND_ID
        );
        assert_eq!(
            selection.artifact_store.adapter.id,
            super::TEMPORARY_STORE_ID
        );
        assert_eq!(
            selection
                .artifact_processors
                .iter()
                .map(|binding| binding.adapter.id.as_str())
                .collect::<Vec<_>>(),
            vec![super::CHECKSUM_PROCESSOR_ID]
        );
        assert_eq!(
            selection
                .delivery_routes
                .iter()
                .map(|route| (
                    route.route_id(),
                    route.binding.adapter.id.as_str(),
                    route.required
                ))
                .collect::<Vec<_>>(),
            vec![
                ("local-delivery", super::LOCAL_DESTINATION_ID, true),
                ("sftp-mirror", super::SFTP_DESTINATION_ID, false),
            ]
        );
        // 本地路线目录缺省时由运行时补全；凭据引用随绑定进入计划输入。
        assert_eq!(
            selection.delivery_routes[0]
                .binding
                .settings
                .string("directory", "local")
                .expect("local route directory"),
            "/tmp/delivery-root"
        );
        assert_eq!(
            selection.delivery_routes[1]
                .binding
                .credentials
                .get("ssh_private_key")
                .map(String::as_str),
            Some("keychain:one-publish/sftp-mirror")
        );
    }

    #[test]
    fn unknown_composition_adapter_is_a_specific_registry_error() {
        let mut composition = crate::store::PublishComposition::local_default();
        composition.execution_backend.adapter_id = "jenkins".to_string();
        let selection = super::composition_selection(
            &composition,
            super::AdapterBinding::new(
                "project",
                super::AdapterIdentity::new(
                    super::AdapterKind::ProjectProvider,
                    super::SELECTED_PROVIDER_ID,
                    1,
                ),
                super::AdapterSettings::new(1)
                    .with_value("spec_json", serde_json::Value::String("{}".to_string())),
            ),
            false,
            "/tmp/delivery-root",
        )
        .expect("selection does not gate adapter availability");

        let snapshot = super::PlanningInputSnapshot {
            version: super::PLANNING_INPUT_SNAPSHOT_VERSION,
            configuration_revision: "revision-test".to_string(),
            runtime_revision: super::RUNTIME_REVISION.to_string(),
            release_input: BTreeMap::new(),
            source: super::SourceSnapshot {
                revision: "0000000000000000000000000000000000000000".to_string(),
                workspace_digest: None,
                dirty: false,
                captured_at: "2026-01-01T00:00:00Z".to_string(),
                reproducible: true,
            },
            external_preconditions: BTreeMap::new(),
            promoted_manifest_digest: None,
            adapters: selection,
        };

        let error = match super::build_registry(&snapshot, "/tmp/delivery-root", None) {
            Ok(_) => panic!("unknown backend must be a specific capability error"),
            Err(error) => error,
        };
        assert!(error.to_string().contains("jenkins"));
    }

    #[test]
    fn cancel_requests_every_attempt_registered_for_a_token_and_slots_unregister() {
        let token = "sealed-token-cancel-fixture";
        let first = super::RegisteredCancellation::register(token).expect("register first slot");
        let second = super::RegisteredCancellation::register(token).expect("register second slot");
        assert!(!first.signal.is_requested());

        let requested =
            super::cancel_publish_runtime(super::CancelPublishRuntimeRequest {
                runtime_token: token.to_string(),
            })
            .expect("cancel a registered token");
        assert!(requested);
        assert!(first.signal.is_requested());
        assert!(second.signal.is_requested());

        drop(first);
        drop(second);
        let requested =
            super::cancel_publish_runtime(super::CancelPublishRuntimeRequest {
                runtime_token: token.to_string(),
            })
            .expect("cancel after every slot unregistered");
        assert!(!requested, "dropped executions must leave no cancellation slot");
    }

    #[test]
    fn local_attempt_seals_one_manifest_and_reduces_a_stable_published_receipt() {
        let repository = tempfile::tempdir().expect("create repository");
        let delivery = tempfile::tempdir().expect("create delivery parent");
        let output_directory = delivery.path().join("publish-output");
        let prepared = prepare_test_runtime(repository.path(), &output_directory);
        let ids = AttemptIdentity {
            attempt_id: "attempt-A".to_string(),
            backend_run_id: "backend-run-A".to_string(),
        };

        let execute = || {
            start_runtime_with_port(
                StartPublishRuntimeRequest {
                    runtime_token: prepared.runtime_token.clone(),
                },
                Arc::new(FakeProviderExecution {
                    output_directory: output_directory.clone(),
                    output_is_file: false,
                    failure: None,
                    source_change: None,
                }),
                ids.clone(),
            )
            .expect("run prepared local attempt")
        };

        let first = execute();
        let second = execute();

        assert_eq!(first.attempt.status, RuntimeAttemptStatus::Published);
        let manifest = first.attempt.manifest.expect("sealed manifest");
        assert_eq!(manifest.artifact_count, 2);
        assert_eq!(
            first.attempt.manifest_digest.as_deref(),
            Some(manifest.digest.as_str())
        );
        assert_eq!(first.attempt.receipts.len(), 1);
        assert_eq!(first.attempt.receipts[0].version, 1);
        assert_eq!(first.attempt.receipts[0].revision, 1);
        assert_eq!(
            first.attempt.receipts[0].status,
            super::RuntimeDeliveryStatus::Published
        );
        assert_eq!(first.attempt.receipts[0].manifest_digest, manifest.digest);
        let delivery_directory =
            std::path::PathBuf::from(&first.attempt.receipts[0].external_reference);
        assert_ne!(delivery_directory, output_directory);
        let expected_attempt_directory = format!(
            "attempt-{}",
            &publish_domain::sha256_hex(b"attempt-A")[..24]
        );
        assert_eq!(
            delivery_directory
                .file_name()
                .and_then(|name| name.to_str()),
            Some(expected_attempt_directory.as_str())
        );
        assert_eq!(
            std::fs::read(delivery_directory.join("app.bin")).expect("read delivered artifact"),
            b"application"
        );
        assert_eq!(
            first.attempt.receipts[0].receipt_id, second.attempt.receipts[0].receipt_id,
            "the sealed attempt inputs must yield a stable receipt id"
        );
        assert!(first
            .attempt
            .events
            .iter()
            .any(|event| event.manifest_digest.as_deref() == Some(manifest.digest.as_str())));
        let receipt_event = first
            .attempt
            .events
            .iter()
            .find(|event| event.kind == "delivery_receipt_observed")
            .expect("receipt revision event");
        assert_eq!(
            receipt_event
                .receipt
                .as_ref()
                .map(|receipt| receipt.receipt_id.as_str()),
            Some(first.attempt.receipts[0].receipt_id.as_str())
        );
        assert_eq!(first.publish_result.expect("provider result").file_count, 2);
    }

    #[test]
    fn go_file_output_seals_and_delivers_one_artifact() {
        let repository = tempfile::tempdir().expect("create repository");
        let delivery = tempfile::tempdir().expect("create delivery parent");
        let output_file = delivery.path().join("one-publish-app");
        std::fs::write(repository.path().join("App.csproj"), "<Project />")
            .expect("write git fixture file");
        initialize_git_repository(repository.path());
        let go_module = repository.path().join("go.mod");
        std::fs::write(&go_module, "module example.invalid/one-publish\n")
            .expect("write go module");
        let spec = PublishSpec {
            version: SPEC_VERSION,
            provider_id: "go".to_string(),
            project_path: go_module.to_string_lossy().to_string(),
            parameters: BTreeMap::from([(
                "output".to_string(),
                SpecValue::String(output_file.to_string_lossy().to_string()),
            )]),
        };
        let prepared = super::prepare_runtime(
            PreparePublishRuntimeRequest {
                promoted_manifest_digest: None,
                repository_id: "repository-A".to_string(),
                repository_path: repository.path().to_string_lossy().to_string(),
                configuration_id: "configuration-go".to_string(),
                configuration_revision_id: "revision-go".to_string(),
                spec: spec.clone(),
            },
            ResolvedPublishConfiguration {
                composition: crate::store::PublishComposition::local_default(),
                provider_id: "go".to_string(),
                parameters: serde_json::to_value(&spec.parameters).expect("serialize parameters"),
                blocked_reason: None,
            },
        )
        .expect("prepare Go file output runtime");

        let result = start_runtime_with_port(
            StartPublishRuntimeRequest {
                runtime_token: prepared.runtime_token,
            },
            Arc::new(FakeProviderExecution {
                output_directory: output_file.clone(),
                output_is_file: true,
                failure: None,
                source_change: None,
            }),
            AttemptIdentity {
                attempt_id: "attempt-go-file".to_string(),
                backend_run_id: "backend-go-file".to_string(),
            },
        )
        .expect("run Go file output runtime");

        assert_eq!(result.attempt.status, RuntimeAttemptStatus::Published);
        assert_eq!(
            result
                .attempt
                .manifest
                .as_ref()
                .map(|manifest| manifest.artifact_count),
            Some(1)
        );
        assert_eq!(result.attempt.receipts.len(), 1);
        let delivered = std::path::PathBuf::from(&result.attempt.receipts[0].external_reference)
            .join(output_file.file_name().expect("output file name"));
        assert_eq!(
            std::fs::read(delivered).expect("read delivered Go artifact"),
            b"application"
        );
    }

    #[test]
    fn provider_failure_is_reduced_without_manifest_receipt_or_fake_success() {
        let repository = tempfile::tempdir().expect("create repository");
        let delivery = tempfile::tempdir().expect("create delivery parent");
        let output_directory = delivery.path().join("publish-output");
        let prepared = prepare_test_runtime(repository.path(), &output_directory);

        let failed = start_runtime_with_port(
            StartPublishRuntimeRequest {
                runtime_token: prepared.runtime_token,
            },
            Arc::new(FakeProviderExecution {
                output_directory,
                output_is_file: false,
                failure: Some("provider exited with code 17".to_string()),
                source_change: None,
            }),
            AttemptIdentity {
                attempt_id: "attempt-failed".to_string(),
                backend_run_id: "backend-run-failed".to_string(),
            },
        )
        .expect("reduce provider failure");

        assert_eq!(failed.attempt.status, RuntimeAttemptStatus::Failed);
        assert!(failed.attempt.manifest.is_none());
        assert!(failed.attempt.receipts.is_empty());
        assert!(failed
            .attempt
            .error
            .as_deref()
            .is_some_and(|error| error.contains("provider exited with code 17")));
        assert!(
            !failed
                .publish_result
                .expect("failed provider result")
                .success
        );
    }

    #[test]
    fn start_rejects_source_changes_before_provider_execution() {
        let repository = tempfile::tempdir().expect("create repository");
        let delivery = tempfile::tempdir().expect("create delivery parent");
        let output_directory = delivery.path().join("publish-output");
        let prepared = prepare_test_runtime(repository.path(), &output_directory);
        std::fs::write(
            repository.path().join("App.csproj"),
            "<Project Changed='true' />",
        )
        .expect("change source after preparation");

        let error = start_runtime_with_port(
            StartPublishRuntimeRequest {
                runtime_token: prepared.runtime_token,
            },
            Arc::new(FakeProviderExecution {
                output_directory: output_directory.clone(),
                output_is_file: false,
                failure: None,
                source_change: None,
            }),
            AttemptIdentity {
                attempt_id: "attempt-source-changed".to_string(),
                backend_run_id: "backend-source-changed".to_string(),
            },
        )
        .expect_err("source changes must invalidate a prepared runtime");

        assert_eq!(
            error.code.as_deref(),
            Some("publish_runtime_source_changed")
        );
        assert!(!output_directory.exists());
    }

    #[test]
    fn source_changes_during_provider_execution_fail_before_manifest_binding() {
        let repository = tempfile::tempdir().expect("create repository");
        let delivery = tempfile::tempdir().expect("create delivery parent");
        let output_directory = delivery.path().join("publish-output");
        let prepared = prepare_test_runtime(repository.path(), &output_directory);

        let result = start_runtime_with_port(
            StartPublishRuntimeRequest {
                runtime_token: prepared.runtime_token,
            },
            Arc::new(FakeProviderExecution {
                output_directory,
                output_is_file: false,
                failure: None,
                source_change: Some((
                    repository.path().join("App.csproj"),
                    b"<Project Changed='during-build' />".to_vec(),
                )),
            }),
            AttemptIdentity {
                attempt_id: "attempt-source-race".to_string(),
                backend_run_id: "backend-source-race".to_string(),
            },
        )
        .expect("started source race must reduce to a failed attempt");

        assert_eq!(result.attempt.status, RuntimeAttemptStatus::Failed);
        assert!(result.attempt.manifest.is_none());
        assert!(result.attempt.receipts.is_empty());
        assert!(result
            .attempt
            .error
            .as_deref()
            .is_some_and(|error| error.contains("source changed")));
    }

    fn prepare_test_runtime(
        repository: &std::path::Path,
        output_directory: &std::path::Path,
    ) -> super::PreparedPublishRuntime {
        let project_path = repository.join("App.csproj");
        std::fs::write(&project_path, "<Project />").expect("write project file");
        initialize_git_repository(repository);
        let spec = PublishSpec {
            version: SPEC_VERSION,
            provider_id: "dotnet".to_string(),
            project_path: project_path.to_string_lossy().to_string(),
            parameters: BTreeMap::from([
                (
                    "configuration".to_string(),
                    SpecValue::String("Release".to_string()),
                ),
                (
                    "output".to_string(),
                    SpecValue::String(output_directory.to_string_lossy().to_string()),
                ),
            ]),
        };
        let resolved = ResolvedPublishConfiguration {
            composition: crate::store::PublishComposition::local_default(),
            provider_id: "dotnet".to_string(),
            parameters: serde_json::to_value(&spec.parameters).expect("serialize parameters"),
            blocked_reason: None,
        };
        super::prepare_runtime(
            PreparePublishRuntimeRequest {
                promoted_manifest_digest: None,
                repository_id: "repository-A".to_string(),
                repository_path: repository.to_string_lossy().to_string(),
                configuration_id: "configuration-A".to_string(),
                configuration_revision_id: "revision-A".to_string(),
                spec,
            },
            resolved,
        )
        .expect("prepare selected configuration")
    }

    fn initialize_git_repository(repository: &std::path::Path) {
        run_git_fixture(repository, &["init", "--quiet"]);
        run_git_fixture(repository, &["add", "-A"]);
        run_git_fixture(
            repository,
            &[
                "-c",
                "user.name=One Publish Tests",
                "-c",
                "user.email=tests@one-publish.invalid",
                "commit",
                "--quiet",
                "-m",
                "fixture",
            ],
        );
    }

    fn run_git_fixture(repository: &std::path::Path, args: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(repository)
            .args(args)
            .output()
            .expect("run git fixture command");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
