use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use publish_domain::{
    sha256_hex, AdapterDescriptor, AdapterKind, AdapterSchema, AdapterSettings, ArtifactManifest,
    ArtifactManifestEntry, Capability, CapabilityRequirement, DeliveryEnvelope, DeliveryReceipt,
    PlanNode, PlanNodeTemplate, PlanSideEffect, PlanStage, PlanningInputSnapshot, PublishError,
    PublishPlan, PublishingCapability,
};
use serde_json::Value;

use crate::{
    action_name, require_action, AdapterContract, AdapterExecutionContext, AdapterExecutionOutput,
    ArtifactStore, DeliveryDestination, ExecutionBackend, PlanNodeExecutor,
    ARTIFACT_VERIFIED_CAPABILITY, STRUCTURED_PLAN_EXECUTION_CAPABILITY,
};

const STORED_ARTIFACT: &str = "stored-artifact";
const DELIVERY_DIRECTORY_KEY: &str = "delivery_directory";

pub struct LocalExecutionBackend {
    descriptor: AdapterDescriptor,
    credential_source: std::sync::Arc<dyn crate::CredentialSource>,
}

impl LocalExecutionBackend {
    /// 未注入来源时使用空来源：所有引用解析为 Missing，无需特例分支。
    pub fn new() -> Self {
        Self::with_credential_source(std::sync::Arc::new(crate::StaticCredentialSource::new()))
    }

    /// 注入本机解析方式（钥匙串、环境等）；后端本身不保存任何秘密值（ADR-0004）。
    pub fn with_credential_source(source: std::sync::Arc<dyn crate::CredentialSource>) -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ExecutionBackend,
                "local-execution",
                1,
                AdapterSchema::new(1),
                PublishingCapability {
                    provides: vec![Capability::new(STRUCTURED_PLAN_EXECUTION_CAPABILITY, 1)],
                    requires: vec![],
                },
            ),
            credential_source: source,
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

impl ExecutionBackend for LocalExecutionBackend {
    fn resolve_credential(
        &self,
        reference: &str,
    ) -> Result<publish_domain::ResolvedCredential, crate::CredentialResolveFailure> {
        self.credential_source.resolve(reference)
    }
}

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
                    requires: vec![CapabilityRequirement::exact(
                        ARTIFACT_VERIFIED_CAPABILITY,
                        1,
                    )],
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
        let manifest = context
            .manifest
            .ok_or(PublishError::MissingArtifactManifest)?;
        if action_name(node)? == "stage_local_directory" {
            return self.stage_envelope(node, context, manifest);
        }
        require_action(node, "publish_local_directory")?;
        let directory = staged_delivery_directory(node, context)?;
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

impl LocalDirectoryDestination {
    /// Staging 从封存 Manifest、发布输入和路线设置派生路线专属交付目录，
    /// 并把它作为 Delivery Envelope 记录；它不改写共享产物（ADR-0055）。
    fn stage_envelope(
        &self,
        node: &PlanNode,
        context: &AdapterExecutionContext<'_>,
        manifest: &ArtifactManifest,
    ) -> Result<AdapterExecutionOutput, PublishError> {
        let delivery_root = PathBuf::from(
            node.settings
                .string("directory", &self.descriptor.identity().display_name())?,
        );
        let attempt_directory = format!(
            "attempt-{}",
            &sha256_hex(context.attempt_id.as_bytes())[..24]
        );
        let directory = delivery_root.join(attempt_directory);
        Ok(AdapterExecutionOutput {
            envelopes: vec![DeliveryEnvelope::new(
                node.binding_id.clone(),
                manifest.digest.clone(),
            )
            .with_content(
                DELIVERY_DIRECTORY_KEY,
                Value::String(directory.to_string_lossy().to_string()),
            )],
            ..AdapterExecutionOutput::default()
        })
    }
}

fn staged_delivery_directory(
    node: &PlanNode,
    context: &AdapterExecutionContext<'_>,
) -> Result<PathBuf, PublishError> {
    context
        .envelopes
        .iter()
        .find(|envelope| envelope.route_id == node.binding_id)
        .and_then(|envelope| envelope.content.get(DELIVERY_DIRECTORY_KEY))
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .ok_or_else(|| {
            PublishError::Execution(format!(
                "route {} has no staged delivery envelope with a delivery directory",
                node.binding_id
            ))
        })
}

impl DeliveryDestination for LocalDirectoryDestination {}

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
