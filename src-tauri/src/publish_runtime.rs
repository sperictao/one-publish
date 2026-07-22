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
use sha2::{Digest, Sha256};
use ts_rs::TS;

use crate::commands::{
    preflight_publish_output, render_provider_publish, PublishOutputAccessStatus,
    PublishOutputValidationStatus, RemoteLocationKind, RenderedPublishCommand,
};
use crate::errors::AppError;
use crate::provider::{registry::provider_registry, ProviderSourceInputKind};
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
    source_guard: PreparedSourceGuard,
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
        execution.source_guard.validate_for_execution()?;

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
    )?;
    let registry = build_registry(&snapshot, spec_json, &delivery_directory)?;
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

fn configuration_parameters_match(provider_id: &str, expected: &Value, actual: &Value) -> bool {
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
    let source_guard = PreparedSourceGuard::from_snapshot(&prepared.snapshot)?;
    source_guard.validate()?;
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
        &provider_output_directory,
        &delivery_directory,
        source_guard,
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
    provider_output_directory: &str,
    delivery_directory: &str,
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
                    .with_value("directory", Value::String(delivery_directory.to_string())),
            )],
        },
    })
}

fn build_registry(
    snapshot: &PlanningInputSnapshot,
    spec_json: String,
    delivery_directory: &str,
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
            Arc::new(LocalDirectoryDestination::new(delivery_directory)),
            &fixture,
        )
        .map_err(runtime_error)?;
    Ok(registry)
}

fn build_execution_registry(
    snapshot: &PlanningInputSnapshot,
    spec_json: String,
    provider_output_directory: &str,
    delivery_directory: &str,
    source_guard: PreparedSourceGuard,
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
                    output_directory: PathBuf::from(provider_output_directory),
                    source_guard,
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
            Arc::new(LocalDirectoryDestination::new(delivery_directory)),
            &fixture,
        )
        .map_err(runtime_error)?;
    Ok(registry)
}

fn collect_artifacts(root: &Path) -> Result<Vec<ArtifactCandidate>, PublishError> {
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
                version: receipt.version,
                receipt_id: receipt.receipt_id,
                revision: receipt.revision,
                route_id: receipt.route_id,
                manifest_digest: receipt.manifest_digest,
                status: runtime_delivery_status(receipt.status),
                external_reference: receipt.external_reference,
            })
            .collect(),
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
        reproducible: false,
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
    use std::sync::Arc;

    use crate::commands::{PublishResult, RenderedPublishCommand};
    use crate::spec::{PublishSpec, SpecValue, SPEC_VERSION};

    use super::{
        capture_source_snapshot, normalize_remote_namespace, prepare_runtime, project_identity,
        start_runtime_with_port, AttemptIdentity, PreparePublishRuntimeRequest,
        ProviderExecutionPort, ResolvedPublishConfiguration, RuntimeAttemptStatus,
        RuntimePlanStage, StartPublishRuntimeRequest,
    };

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
            provider_id: "dotnet".to_string(),
            parameters: serde_json::json!({ "configuration": "Release" }),
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

        let prepared = prepare_runtime(
            PreparePublishRuntimeRequest {
                repository_id: "repository-A".to_string(),
                repository_path: repository.path().to_string_lossy().to_string(),
                configuration_id: "configuration-A".to_string(),
                configuration_revision_id: "revision-A".to_string(),
                spec,
            },
            ResolvedPublishConfiguration {
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
            provider_id: "dotnet".to_string(),
            parameters: serde_json::to_value(&spec.parameters).expect("serialize parameters"),
            blocked_reason: None,
        };

        let error = prepare_runtime(
            PreparePublishRuntimeRequest {
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
        assert!(!snapshot.reproducible);
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
            provider_id: "dotnet".to_string(),
            parameters: serde_json::to_value(&spec.parameters).expect("serialize parameters"),
            blocked_reason: None,
        };

        let error = prepare_runtime(
            PreparePublishRuntimeRequest {
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
        assert!(!snapshot.reproducible);
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
        let prepared = prepare_runtime(
            PreparePublishRuntimeRequest {
                repository_id: "repository-A".to_string(),
                repository_path: repository.path().to_string_lossy().to_string(),
                configuration_id: "configuration-go".to_string(),
                configuration_revision_id: "revision-go".to_string(),
                spec: spec.clone(),
            },
            ResolvedPublishConfiguration {
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

    fn initialize_git_repository(repository: &std::path::Path) {
        run_git_fixture(repository, &["init", "--quiet"]);
        run_git_fixture(repository, &["add", "App.csproj"]);
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
