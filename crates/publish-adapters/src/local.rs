use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use publish_domain::{
    sha256_hex, AdapterDescriptor, AdapterKind, AdapterSchema, AdapterSettings, ArtifactManifest,
    ArtifactManifestEntry, Capability, CapabilityRequirement, DeliveryReceipt, PlanNode,
    PlanNodeTemplate, PlanSideEffect, PlanStage, PlanningInputSnapshot, PublishError, PublishPlan,
    PublishingCapability,
};
use serde_json::Value;

use crate::{
    AdapterContract, AdapterExecutionContext, AdapterExecutionOutput, ArtifactStore,
    DeliveryDestination, ExecutionBackend, PlanNodeExecutor,
};

const STRUCTURED_PLAN_EXECUTION: &str = "structured-plan-execution";
const ARTIFACT_VERIFIED: &str = "artifact-verified";
const STORED_ARTIFACT: &str = "stored-artifact";

pub struct LocalExecutionBackend {
    descriptor: AdapterDescriptor,
}

impl LocalExecutionBackend {
    pub fn new() -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ExecutionBackend,
                "local-execution",
                1,
                AdapterSchema::new(1),
                PublishingCapability {
                    provides: vec![Capability::new(STRUCTURED_PLAN_EXECUTION, 1)],
                    requires: vec![],
                },
            ),
        }
    }
}

impl Default for LocalExecutionBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl AdapterContract for LocalExecutionBackend {
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

    fn execute_plan(
        &self,
        plan: &PublishPlan,
        executor: &mut dyn PlanNodeExecutor,
    ) -> Result<(), PublishError> {
        for node in &plan.nodes {
            executor.execute_node(node)?;
        }
        Ok(())
    }
}

impl ExecutionBackend for LocalExecutionBackend {}

pub struct TemporaryArtifactStore {
    descriptor: AdapterDescriptor,
    default_root: String,
}

impl TemporaryArtifactStore {
    pub fn new(default_root: impl AsRef<Path>) -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ArtifactStore,
                "temporary-artifact-store",
                1,
                AdapterSchema::new(1).with_required_string("root_directory"),
                PublishingCapability {
                    provides: vec![Capability::new(STORED_ARTIFACT, 1)],
                    requires: vec![CapabilityRequirement::exact(ARTIFACT_VERIFIED, 1)],
                },
            ),
            default_root: default_root.as_ref().to_string_lossy().to_string(),
        }
    }
}

impl AdapterContract for TemporaryArtifactStore {
    fn descriptor(&self) -> &AdapterDescriptor {
        &self.descriptor
    }

    fn default_settings(&self) -> AdapterSettings {
        AdapterSettings::new(1)
            .with_value("root_directory", Value::String(self.default_root.clone()))
    }

    fn plan_fragment(
        &self,
        _snapshot: &PlanningInputSnapshot,
        _settings: &AdapterSettings,
    ) -> Result<Vec<PlanNodeTemplate>, PublishError> {
        Ok(vec![PlanNodeTemplate::adapter_action(
            "persist",
            PlanStage::PersistManifest,
            "persist_manifest",
            BTreeMap::new(),
        )
        .with_artifact_io(
            vec!["artifact:*".to_string()],
            vec!["artifact-manifest".to_string()],
        )
        .with_side_effects(vec![PlanSideEffect::FileSystem])])
    }

    fn execute_node(
        &self,
        node: &PlanNode,
        context: &AdapterExecutionContext<'_>,
    ) -> Result<AdapterExecutionOutput, PublishError> {
        require_action(node, "persist_manifest")?;
        let root = PathBuf::from(
            node.settings
                .string("root_directory", &self.descriptor.identity().display_name())?,
        );
        create_directory(&root)?;

        let mut entries = Vec::with_capacity(context.artifacts.len());
        for artifact in context.artifacts {
            artifact.verify()?;
            let artifact_directory = root.join(&artifact.digest);
            create_directory(&artifact_directory)?;
            let stored_path = artifact_directory.join(&artifact.file_name);
            if let Some(parent) = stored_path.parent() {
                create_directory(parent)?;
            }
            persist_content_addressed(&stored_path, &artifact.bytes, &artifact.digest)?;
            entries.push(ArtifactManifestEntry {
                role: artifact.role.clone(),
                file_name: artifact.file_name.clone(),
                media_type: artifact.media_type.clone(),
                platform: artifact.platform.clone(),
                architecture: artifact.architecture.clone(),
                size: artifact.size,
                digest: artifact.digest.clone(),
                locator: stored_path.to_string_lossy().to_string(),
                retention: "temporary".to_string(),
            });
        }

        Ok(AdapterExecutionOutput {
            manifest: Some(ArtifactManifest::seal(context.snapshot_digest, entries)?),
            ..AdapterExecutionOutput::default()
        })
    }
}

impl ArtifactStore for TemporaryArtifactStore {}

pub struct LocalDirectoryDestination {
    descriptor: AdapterDescriptor,
    default_directory: String,
}

impl LocalDirectoryDestination {
    pub fn new(default_directory: impl AsRef<Path>) -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::DeliveryDestination,
                "local-directory",
                1,
                AdapterSchema::new(1).with_required_string("directory"),
                PublishingCapability {
                    provides: vec![],
                    requires: vec![CapabilityRequirement::exact(STORED_ARTIFACT, 1)],
                },
            ),
            default_directory: default_directory.as_ref().to_string_lossy().to_string(),
        }
    }
}

impl AdapterContract for LocalDirectoryDestination {
    fn descriptor(&self) -> &AdapterDescriptor {
        &self.descriptor
    }

    fn default_settings(&self) -> AdapterSettings {
        AdapterSettings::new(1)
            .with_value("directory", Value::String(self.default_directory.clone()))
    }

    fn plan_fragment(
        &self,
        _snapshot: &PlanningInputSnapshot,
        _settings: &AdapterSettings,
    ) -> Result<Vec<PlanNodeTemplate>, PublishError> {
        Ok(vec![
            PlanNodeTemplate::adapter_action(
                "stage",
                PlanStage::StageRoutes,
                "stage_local_directory",
                BTreeMap::new(),
            )
            .with_artifact_io(vec!["artifact-manifest".to_string()], vec![]),
            PlanNodeTemplate::adapter_action(
                "publish",
                PlanStage::PublishRoutes,
                "publish_local_directory",
                BTreeMap::new(),
            )
            .with_artifact_io(vec!["artifact-manifest".to_string()], vec![])
            .with_side_effects(vec![PlanSideEffect::FileSystem])
            .irreversible(),
        ])
    }

    fn execute_node(
        &self,
        node: &PlanNode,
        context: &AdapterExecutionContext<'_>,
    ) -> Result<AdapterExecutionOutput, PublishError> {
        if action_name(node)? == "stage_local_directory" {
            return Ok(AdapterExecutionOutput::default());
        }
        require_action(node, "publish_local_directory")?;
        let manifest = context
            .manifest
            .ok_or(PublishError::MissingArtifactManifest)?;
        let directory = PathBuf::from(
            node.settings
                .string("directory", &self.descriptor.identity().display_name())?,
        );
        create_directory(&directory)?;

        for artifact in &manifest.artifacts {
            let source = Path::new(&artifact.locator);
            let destination = directory.join(&artifact.file_name);
            if let Some(parent) = destination.parent() {
                create_directory(parent)?;
            }
            copy_verified(source, &destination, &artifact.digest)?;
        }

        let receipt_id = sha256_hex(
            format!(
                "{}:{}:{}:{}",
                context.attempt_id, node.id, node.binding_id, manifest.digest
            )
            .as_bytes(),
        );
        Ok(AdapterExecutionOutput {
            receipts: vec![DeliveryReceipt::published(
                receipt_id,
                node.binding_id.clone(),
                manifest.digest.clone(),
                directory.to_string_lossy(),
            )],
            ..AdapterExecutionOutput::default()
        })
    }
}

impl DeliveryDestination for LocalDirectoryDestination {}

fn action_name(node: &PlanNode) -> Result<&str, PublishError> {
    match &node.operation {
        publish_domain::PlanOperation::AdapterAction { action, .. } => Ok(action),
        _ => Err(PublishError::Execution(format!(
            "node {} is not an adapter action",
            node.id
        ))),
    }
}

fn require_action(node: &PlanNode, expected: &str) -> Result<(), PublishError> {
    let actual = action_name(node)?;
    if actual != expected {
        return Err(PublishError::Execution(format!(
            "node {} expected action {expected}, got {actual}",
            node.id
        )));
    }
    Ok(())
}

fn create_directory(path: &Path) -> Result<(), PublishError> {
    fs::create_dir_all(path).map_err(|error| PublishError::Io {
        operation: format!("create directory {}", path.display()),
        message: error.to_string(),
    })
}

fn persist_content_addressed(
    path: &Path,
    bytes: &[u8],
    expected_digest: &str,
) -> Result<(), PublishError> {
    if path.exists() {
        return verify_file(path, expected_digest);
    }
    fs::write(path, bytes).map_err(|error| PublishError::Io {
        operation: format!("write artifact {}", path.display()),
        message: error.to_string(),
    })?;
    verify_file(path, expected_digest)
}

fn copy_verified(
    source: &Path,
    destination: &Path,
    expected_digest: &str,
) -> Result<(), PublishError> {
    verify_file(source, expected_digest)?;
    if destination.exists() {
        return verify_file(destination, expected_digest);
    }
    fs::copy(source, destination).map_err(|error| PublishError::Io {
        operation: format!("copy {} to {}", source.display(), destination.display()),
        message: error.to_string(),
    })?;
    verify_file(destination, expected_digest)
}

fn verify_file(path: &Path, expected_digest: &str) -> Result<(), PublishError> {
    let bytes = fs::read(path).map_err(|error| PublishError::Io {
        operation: format!("read artifact {}", path.display()),
        message: error.to_string(),
    })?;
    let actual = sha256_hex(&bytes);
    if actual != expected_digest {
        return Err(PublishError::ArtifactDigestMismatch {
            artifact: path.display().to_string(),
            expected: expected_digest.to_string(),
            actual,
        });
    }
    Ok(())
}
