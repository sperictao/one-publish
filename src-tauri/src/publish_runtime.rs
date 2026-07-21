use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use publish_adapters::{
    AdapterConformanceFixture, AdapterContract, AdapterExecutionContext, AdapterExecutionOutput,
    AdapterRegistry, LocalDirectoryDestination, LocalExecutionBackend, ProjectProvider,
    TemporaryArtifactStore,
};
use publish_domain::{
    AdapterBinding, AdapterDescriptor, AdapterIdentity, AdapterKind, AdapterSchema,
    AdapterSelection, AdapterSettings, ArtifactCandidate, Capability, CapabilityRequirement,
    DeliveryStatus, PlanNode, PlanNodeTemplate, PlanOperation, PlanStage, PlanningInputSnapshot,
    PublishAttemptStatus, PublishAttemptView, PublishError, PublishingCapability, ReleaseIdentity,
    SourceSnapshot, PLANNING_INPUT_SNAPSHOT_VERSION,
};
use publish_runner_core::{PreparedPublishPlan, PublishRuntime, StartPublishAttempt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use crate::commands::{
    preflight_publish_output, render_provider_publish, PublishOutputAccessStatus,
    PublishOutputValidationStatus, RemoteLocationKind, RenderedPublishCommand,
};
use crate::errors::AppError;
use crate::spec::PublishSpec;

const SELECTED_PROVIDER_ID: &str = "selected-project-provider";
const SELECTED_PROVIDER_PROGRAM: &str = "selected-project-provider:publish";
const LOCAL_BACKEND_ID: &str = "local-execution";
const TEMPORARY_STORE_ID: &str = "temporary-artifact-store";
const LOCAL_DESTINATION_ID: &str = "local-directory";
const STRUCTURED_PLAN_EXECUTION: &str = "structured-plan-execution";
const ARTIFACT_VERIFIED: &str = "artifact-verified";
const RUNTIME_REVISION: &str = "one-publish-runtime-v1";
static ATTEMPT_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct PreparePublishRuntimeRequest {
    pub repository_id: String,
    pub repository_path: String,
    pub configuration_id: String,
    pub configuration_revision_id: String,
    pub spec: PublishSpec,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ResolvedPublishConfiguration {
    pub provider_id: String,
    pub parameters: Value,
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
    Failed,
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
    pub receipt_id: String,
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
}

struct SelectedProjectProvider {
    descriptor: AdapterDescriptor,
    spec_json: String,
    execution: Option<SelectedProviderExecution>,
}

impl SelectedProjectProvider {
    fn new(spec_json: String) -> Self {
        Self::with_execution(spec_json, None)
    }

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
        let spec: PublishSpec = serde_json::from_str(planned_spec).map_err(|error| {
            PublishError::Execution(format!("cannot decode sealed publish spec: {error}"))
        })?;
        let result = execution
            .port
            .execute(spec)
            .map_err(|error| PublishError::Execution(error.to_string()))?;
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

        Ok(AdapterExecutionOutput {
            artifacts: collect_artifacts(&execution.output_directory)?,
            ..AdapterExecutionOutput::default()
        })
    }
}

impl ProjectProvider for SelectedProjectProvider {}

pub(crate) fn prepare_runtime(
    request: PreparePublishRuntimeRequest,
    resolved: ResolvedPublishConfiguration,
) -> Result<PreparedPublishRuntime, AppError> {
    validate_prepare_request(&request)?;
    let command = render_provider_publish(request.spec.clone())?;
    let preflight = preflight_publish_output(request.spec.clone());
    let mut blocked_reason = resolved.blocked_reason;
    if request.spec.provider_id != resolved.provider_id
        || serde_json::to_value(&request.spec.parameters).map_err(runtime_serialization_error)?
            != resolved.parameters
    {
        blocked_reason = Some(
            "selected configuration revision no longer matches the publish inputs".to_string(),
        );
    }
    if blocked_reason.is_none() {
        blocked_reason = preflight_blocked_reason(&preflight);
    }

    let spec_json = serde_json::to_string(&request.spec).map_err(runtime_serialization_error)?;
    let snapshot = build_snapshot(&request, spec_json.clone(), &preflight.output_dir)?;
    let registry = build_registry(&snapshot, spec_json, &preflight.output_dir)?;
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
    tokio::task::spawn_blocking(move || start_runtime_with_port(request, port, identity))
        .await
        .map_err(|error| {
            AppError::publish_with_code(
                format!("publish runtime task failed: {error}"),
                "publish_runtime_task_failed",
            )
        })?
}

pub(crate) fn start_runtime_with_port(
    request: StartPublishRuntimeRequest,
    execution_port: Arc<dyn ProviderExecutionPort>,
    identity: AttemptIdentity,
) -> Result<PublishRuntimeResult, AppError> {
    if request.runtime_token.trim().is_empty() {
        return Err(AppError::validation_with_code(
            "prepared publish runtime token is required",
            "publish_runtime_token_missing",
        ));
    }
    let prepared: PreparedPublishPlan =
        serde_json::from_str(&request.runtime_token).map_err(runtime_serialization_error)?;
    let spec_json = prepared
        .snapshot
        .adapters
        .project_provider
        .settings
        .string(
            "spec_json",
            &prepared
                .snapshot
                .adapters
                .project_provider
                .adapter
                .display_name(),
        )
        .map_err(runtime_error)?
        .to_string();
    let output_directory = prepared
        .snapshot
        .adapters
        .delivery_destinations
        .first()
        .ok_or_else(|| {
            AppError::publish_with_code(
                "prepared runtime has no delivery destination",
                "publish_runtime_destination_missing",
            )
        })?
        .settings
        .string("directory", LOCAL_DESTINATION_ID)
        .map_err(runtime_error)?
        .to_string();
    let result = Arc::new(Mutex::new(None));
    let registry = build_execution_registry(
        &prepared.snapshot,
        spec_json,
        &output_directory,
        execution_port,
        Arc::clone(&result),
    )?;
    let release_identity = release_identity(&prepared.snapshot)?;
    let view = PublishRuntime::new(registry)
        .start_attempt(
            &prepared,
            StartPublishAttempt::new(
                identity.attempt_id,
                identity.backend_run_id,
                release_identity,
            ),
        )
        .map_err(runtime_error)?;
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
    output_directory: &str,
) -> Result<PlanningInputSnapshot, AppError> {
    let project_identity = project_identity(&request.repository_path, &request.spec)?;
    let source = capture_source_snapshot(Path::new(&request.repository_path));
    let release_input = BTreeMap::from([
        (
            "repository_id".to_string(),
            Value::String(request.repository_id.clone()),
        ),
        (
            "configuration_id".to_string(),
            Value::String(request.configuration_id.clone()),
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
    let empty_settings = AdapterSettings::new(1);

    Ok(PlanningInputSnapshot {
        version: PLANNING_INPUT_SNAPSHOT_VERSION,
        configuration_revision: request.configuration_revision_id.clone(),
        runtime_revision: RUNTIME_REVISION.to_string(),
        release_input,
        source,
        external_preconditions: BTreeMap::new(),
        adapters: AdapterSelection {
            project_provider: AdapterBinding::new(
                "project",
                AdapterIdentity::new(AdapterKind::ProjectProvider, SELECTED_PROVIDER_ID, 1),
                AdapterSettings::new(1).with_value("spec_json", Value::String(spec_json)),
            ),
            artifact_processors: Vec::new(),
            execution_backend: AdapterBinding::new(
                "backend",
                AdapterIdentity::new(AdapterKind::ExecutionBackend, LOCAL_BACKEND_ID, 1),
                empty_settings,
            ),
            artifact_store: AdapterBinding::new(
                "store",
                AdapterIdentity::new(AdapterKind::ArtifactStore, TEMPORARY_STORE_ID, 1),
                AdapterSettings::new(1).with_value(
                    "root_directory",
                    Value::String(artifact_store_root().to_string_lossy().to_string()),
                ),
            ),
            delivery_destinations: vec![AdapterBinding::new(
                "local-delivery",
                AdapterIdentity::new(AdapterKind::DeliveryDestination, LOCAL_DESTINATION_ID, 1),
                AdapterSettings::new(1)
                    .with_value("directory", Value::String(output_directory.to_string())),
            )],
        },
    })
}

fn build_registry(
    snapshot: &PlanningInputSnapshot,
    spec_json: String,
    output_directory: &str,
) -> Result<AdapterRegistry, AppError> {
    let fixture = AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(Arc::new(SelectedProjectProvider::new(spec_json)), &fixture)
        .map_err(runtime_error)?;
    registry
        .register_execution_backend(Arc::new(LocalExecutionBackend::new()), &fixture)
        .map_err(runtime_error)?;
    registry
        .register_artifact_store(
            Arc::new(TemporaryArtifactStore::new(artifact_store_root())),
            &fixture,
        )
        .map_err(runtime_error)?;
    registry
        .register_delivery_destination(
            Arc::new(LocalDirectoryDestination::new(output_directory)),
            &fixture,
        )
        .map_err(runtime_error)?;
    Ok(registry)
}

fn build_execution_registry(
    snapshot: &PlanningInputSnapshot,
    spec_json: String,
    output_directory: &str,
    port: Arc<dyn ProviderExecutionPort>,
    result: Arc<Mutex<Option<crate::commands::PublishResult>>>,
) -> Result<AdapterRegistry, AppError> {
    let fixture = AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(
            Arc::new(SelectedProjectProvider::with_execution(
                spec_json,
                Some(SelectedProviderExecution {
                    port,
                    result,
                    output_directory: PathBuf::from(output_directory),
                }),
            )),
            &fixture,
        )
        .map_err(runtime_error)?;
    registry
        .register_execution_backend(Arc::new(LocalExecutionBackend::new()), &fixture)
        .map_err(runtime_error)?;
    registry
        .register_artifact_store(
            Arc::new(TemporaryArtifactStore::new(artifact_store_root())),
            &fixture,
        )
        .map_err(runtime_error)?;
    registry
        .register_delivery_destination(
            Arc::new(LocalDirectoryDestination::new(output_directory)),
            &fixture,
        )
        .map_err(runtime_error)?;
    Ok(registry)
}

fn collect_artifacts(root: &Path) -> Result<Vec<ArtifactCandidate>, PublishError> {
    if !root.is_dir() {
        return Err(PublishError::Execution(format!(
            "provider output directory does not exist: {}",
            root.display()
        )));
    }
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
    files.sort();
    if files.is_empty() {
        return Err(PublishError::Execution(
            "provider execution produced no artifacts".to_string(),
        ));
    }

    files
        .into_iter()
        .map(|path| {
            let relative = path.strip_prefix(root).map_err(|_| {
                PublishError::Execution(format!(
                    "provider output escaped its root: {}",
                    path.display()
                ))
            })?;
            let bytes = fs::read(&path).map_err(|error| PublishError::Io {
                operation: format!("read provider artifact {}", path.display()),
                message: error.to_string(),
            })?;
            Ok(ArtifactCandidate::new(
                "provider-output",
                relative.to_string_lossy().replace('\\', "/"),
                "application/octet-stream",
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
            PublishAttemptStatus::Failed => RuntimeAttemptStatus::Failed,
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
                receipt_id: receipt.receipt_id,
                route_id: receipt.route_id,
                manifest_digest: receipt.manifest_digest,
                status: runtime_delivery_status(receipt.status),
                external_reference: receipt.external_reference,
            })
            .collect(),
        events: view
            .events
            .into_iter()
            .map(|event| RuntimePublishEventSummary {
                event_id: event.event_id,
                plan_node_id: event.plan_node_id,
                kind: event.kind,
                manifest_digest: event
                    .payload
                    .get("manifest_digest")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
                receipt_id: event
                    .payload
                    .get("receipt_id")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
                delivery_status: event
                    .payload
                    .get("delivery_status")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
                error: event
                    .payload
                    .get("error")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
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

fn project_identity(repository_path: &str, spec: &PublishSpec) -> Result<String, AppError> {
    let repository = Path::new(repository_path);
    let project = Path::new(&spec.project_path);
    let relative = project.strip_prefix(repository).map_err(|_| {
        AppError::validation_with_code(
            "publish project must be inside the selected repository",
            "publish_runtime_project_outside_repository",
        )
    })?;
    Ok(format!(
        "{}:{}",
        spec.provider_id,
        relative.to_string_lossy().replace('\\', "/")
    ))
}

fn capture_source_snapshot(repository: &Path) -> SourceSnapshot {
    let revision = git_output(repository, &["rev-parse", "HEAD"])
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "workspace".to_string());
    let dirty = git_output(repository, &["status", "--porcelain"])
        .map(|value| !value.is_empty())
        .unwrap_or(true);
    SourceSnapshot {
        revision,
        workspace_digest: None,
        dirty,
        captured_at: chrono::Utc::now().to_rfc3339(),
        reproducible: !dirty,
    }
}

fn git_output(repository: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repository)
        .args(args)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
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
    use std::sync::Arc;

    use crate::commands::{PublishResult, RenderedPublishCommand};
    use crate::spec::{PublishSpec, SpecValue, SPEC_VERSION};

    use super::{
        prepare_runtime, start_runtime_with_port, AttemptIdentity, PreparePublishRuntimeRequest,
        ProviderExecutionPort, ResolvedPublishConfiguration, RuntimeAttemptStatus,
        RuntimePlanStage, StartPublishRuntimeRequest,
    };

    struct FakeProviderExecution {
        output_directory: std::path::PathBuf,
        failure: Option<String>,
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

            std::fs::create_dir_all(self.output_directory.join("nested"))
                .expect("create fake provider output");
            std::fs::write(self.output_directory.join("app.bin"), b"application")
                .expect("write top-level artifact");
            std::fs::write(
                self.output_directory.join("nested").join("metadata.json"),
                br#"{"version":1}"#,
            )
            .expect("write nested artifact");
            Ok(PublishResult {
                provider_id: spec.provider_id,
                success: true,
                cancelled: false,
                error: None,
                command,
                output_log: "published".to_string(),
                output_dir: self.output_directory.to_string_lossy().to_string(),
                file_count: 2,
                warnings: None,
            })
        }
    }

    #[test]
    fn selected_revision_prepares_its_local_command_plan_and_blocking_state() {
        let repository = tempfile::tempdir().expect("create repository");
        let project_path = repository.path().join("App.csproj");
        std::fs::write(&project_path, "<Project />").expect("write project file");
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
            provider_id: "dotnet".to_string(),
            parameters: serde_json::to_value(&spec.parameters).expect("serialize parameters"),
            blocked_reason: None,
        };

        let prepared = prepare_runtime(
            PreparePublishRuntimeRequest {
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
    fn local_attempt_seals_one_manifest_and_reduces_a_stable_published_receipt() {
        let repository = tempfile::tempdir().expect("create repository");
        let output_directory = repository.path().join("publish-output");
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
                    failure: None,
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
        assert_eq!(
            first.attempt.receipts[0].status,
            super::RuntimeDeliveryStatus::Published
        );
        assert_eq!(first.attempt.receipts[0].manifest_digest, manifest.digest);
        assert_eq!(
            first.attempt.receipts[0].receipt_id, second.attempt.receipts[0].receipt_id,
            "the sealed attempt inputs must yield a stable receipt id"
        );
        assert!(first
            .attempt
            .events
            .iter()
            .any(|event| event.manifest_digest.as_deref() == Some(manifest.digest.as_str())));
        assert_eq!(first.publish_result.expect("provider result").file_count, 2);
    }

    #[test]
    fn provider_failure_is_reduced_without_manifest_receipt_or_fake_success() {
        let repository = tempfile::tempdir().expect("create repository");
        let output_directory = repository.path().join("publish-output");
        let prepared = prepare_test_runtime(repository.path(), &output_directory);

        let failed = start_runtime_with_port(
            StartPublishRuntimeRequest {
                runtime_token: prepared.runtime_token,
            },
            Arc::new(FakeProviderExecution {
                output_directory,
                failure: Some("provider exited with code 17".to_string()),
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
        assert_eq!(
            failed
                .publish_result
                .expect("failed provider result")
                .success,
            false
        );
    }

    fn prepare_test_runtime(
        repository: &std::path::Path,
        output_directory: &std::path::Path,
    ) -> super::PreparedPublishRuntime {
        let project_path = repository.join("App.csproj");
        std::fs::write(&project_path, "<Project />").expect("write project file");
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
            provider_id: "dotnet".to_string(),
            parameters: serde_json::to_value(&spec.parameters).expect("serialize parameters"),
            blocked_reason: None,
        };
        prepare_runtime(
            PreparePublishRuntimeRequest {
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
}
