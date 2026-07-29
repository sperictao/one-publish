use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use publish_domain::{
    sha256_hex, AdapterDescriptor, AdapterKind, AdapterSchema, AdapterSettings, ArtifactManifest,
    ArtifactManifestEntry, Capability, CapabilityRequirement, DeliveryEnvelope,
    DeliveryIdempotencyIdentity, DeliveryReceipt, PlanNode, PlanNodeTemplate, PlanSideEffect,
    PlanStage, PlanningInputSnapshot, PublishError, PublishPlan, PublishingCapability,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    action_name, execute_plan_in_order, require_action, AdapterContract, AdapterExecutionContext,
    AdapterExecutionOutput, ArtifactStore, DeliveryDestination, DeliveryProbe, ExecutionBackend,
    PlanNodeExecutor, RemovedArtifactSet, RetainedArtifactSet, RetentionHold, RetentionSweepReport,
    ARTIFACT_VERIFIED_CAPABILITY, STRUCTURED_PLAN_EXECUTION_CAPABILITY,
};

const STORED_ARTIFACT: &str = "stored-artifact";
const DELIVERY_DIRECTORY_KEY: &str = "delivery_directory";
const DELIVERY_MANIFEST_MARKER: &str = ".one-publish-manifest-digest";
const SET_RECORD_DIRECTORY: &str = "manifests";
const LEASE_DIRECTORY: &str = "leases";
const DEFAULT_RETENTION_SECONDS: u64 = 604_800;
const BIND_PROMOTED_MANIFEST_ACTION: &str = "bind_promoted_manifest";
static CONTENT_TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

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
        execute_plan_in_order(plan, executor)
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
                AdapterSchema::new(1)
                    .with_required_string("root_directory")
                    .with_required_number("retention_seconds"),
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

    fn root_directory(&self, settings: &AdapterSettings) -> Result<PathBuf, PublishError> {
        Ok(PathBuf::from(settings.string(
            "root_directory",
            &self.descriptor.identity().display_name(),
        )?))
    }

    /// Artifact Promotion 的封存绑定：验证既有集合的记录与每个产物字节仍然可用，
    /// 然后原样输出同一 Manifest。任何失效都进入 Unresumable Delivery——要求新的
    /// 构建尝试，这里没有任何重建路径（ADR-0038/0040）。
    fn bind_promoted_manifest(
        &self,
        node: &PlanNode,
    ) -> Result<AdapterExecutionOutput, PublishError> {
        let publish_domain::PlanOperation::AdapterAction { inputs, .. } = &node.operation else {
            return Err(PublishError::Execution(format!(
                "node {} is not an adapter action",
                node.id
            )));
        };
        let digest = inputs
            .get("manifest_digest")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                PublishError::Execution(format!(
                    "node {} does not declare the promoted manifest digest",
                    node.id
                ))
            })?;
        let unresumable = |reason: String| PublishError::UnresumableDelivery {
            manifest_digest: digest.to_string(),
            reason,
        };

        let root = self.root_directory(&node.settings)?;
        let record_path = set_record_path(&root, digest);
        if !record_path.exists() {
            return Err(unresumable(
                "the artifact set record is no longer stored".to_string(),
            ));
        }
        let record: StoredArtifactSetRecord =
            read_json(&record_path).map_err(|error| unresumable(error.to_string()))?;
        record
            .manifest
            .validate()
            .map_err(|error| unresumable(error.to_string()))?;
        if record.manifest.digest != digest {
            return Err(unresumable(format!(
                "the stored record seals a different artifact set {}",
                record.manifest.digest
            )));
        }
        for entry in &record.manifest.artifacts {
            verify_file(Path::new(&entry.locator), &entry.digest)
                .map_err(|error| unresumable(error.to_string()))?;
        }
        Ok(AdapterExecutionOutput {
            manifest: Some(record.manifest),
            ..AdapterExecutionOutput::default()
        })
    }
}

impl AdapterContract for TemporaryArtifactStore {
    fn descriptor(&self) -> &AdapterDescriptor {
        &self.descriptor
    }

    fn default_settings(&self) -> AdapterSettings {
        AdapterSettings::new(1)
            .with_value("root_directory", Value::String(self.default_root.clone()))
            .with_value("retention_seconds", Value::from(DEFAULT_RETENTION_SECONDS))
    }

    fn plan_fragment(
        &self,
        snapshot: &PlanningInputSnapshot,
        _settings: &AdapterSettings,
    ) -> Result<Vec<PlanNodeTemplate>, PublishError> {
        // Promotion 在同一 PersistManifest 阶段绑定既有集合而不是重新封存：
        // 下游路线消费 Manifest 的数据流保持不变（ADR-0038/0040）。
        if let Some(digest) = &snapshot.promoted_manifest_digest {
            return Ok(vec![PlanNodeTemplate::adapter_action(
                "bind",
                PlanStage::PersistManifest,
                BIND_PROMOTED_MANIFEST_ACTION,
                BTreeMap::from([("manifest_digest".to_string(), Value::String(digest.clone()))]),
            )
            .with_artifact_io(vec![], vec!["artifact-manifest".to_string()])]);
        }
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
        if action_name(node)? == BIND_PROMOTED_MANIFEST_ACTION {
            return self.bind_promoted_manifest(node);
        }
        require_action(node, "persist_manifest")?;
        let adapter = self.descriptor.identity().display_name();
        let root = self.root_directory(&node.settings)?;
        let retention_seconds = node
            .settings
            .unsigned_number("retention_seconds", &adapter)?;
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
                retention: format!("{retention_seconds}s"),
            });
        }

        let manifest = ArtifactManifest::seal(context.snapshot_digest, entries)?;
        persist_set_record(&root, &manifest, retention_seconds)?;
        Ok(AdapterExecutionOutput {
            manifest: Some(manifest),
            ..AdapterExecutionOutput::default()
        })
    }
}

impl ArtifactStore for TemporaryArtifactStore {
    fn acquire_artifact_set_lease(
        &self,
        settings: &AdapterSettings,
        attempt_id: &str,
        manifest_digest: &str,
        valid_until: &str,
    ) -> Result<(), PublishError> {
        if attempt_id.trim().is_empty() {
            return Err(PublishError::Execution(
                "artifact set leases require a publish attempt id".to_string(),
            ));
        }
        parse_rfc3339_utc_seconds(valid_until)?;
        let root = self.root_directory(settings)?;
        if !set_record_path(&root, manifest_digest).exists() {
            return Err(PublishError::Execution(format!(
                "artifact set {manifest_digest} is not stored here; only stored sets can be leased"
            )));
        }
        let directory = root.join(LEASE_DIRECTORY);
        create_directory(&directory)?;
        let lease = StoredArtifactSetLease {
            attempt_id: attempt_id.to_string(),
            manifest_digest: manifest_digest.to_string(),
            valid_until: valid_until.to_string(),
        };
        write_json(&lease_path(&root, attempt_id), &lease)
    }

    fn release_artifact_set_lease(
        &self,
        settings: &AdapterSettings,
        attempt_id: &str,
    ) -> Result<(), PublishError> {
        let path = lease_path(&self.root_directory(settings)?, attempt_id);
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(PublishError::Io {
                operation: format!("release artifact set lease {}", path.display()),
                message: error.to_string(),
            }),
        }
    }

    fn enforce_retention(
        &self,
        settings: &AdapterSettings,
        now: &str,
    ) -> Result<RetentionSweepReport, PublishError> {
        let root = self.root_directory(settings)?;
        let now_seconds = parse_rfc3339_utc_seconds(now)?;

        let mut active_leases = BTreeMap::new();
        for (path, lease) in
            read_json_directory::<StoredArtifactSetLease>(&root.join(LEASE_DIRECTORY))?
        {
            if parse_rfc3339_utc_seconds(&lease.valid_until)? >= now_seconds {
                active_leases
                    .entry(lease.manifest_digest.clone())
                    .or_insert(lease);
            } else {
                remove_file(&path)?;
            }
        }

        let mut retained = Vec::new();
        let mut kept_artifacts = BTreeSet::new();
        let mut expired = Vec::new();
        for (path, record) in
            read_json_directory::<StoredArtifactSetRecord>(&root.join(SET_RECORD_DIRECTORY))?
        {
            let digest = record.manifest.digest.clone();
            let hold = if let Some(lease) = active_leases.get(&digest) {
                Some(RetentionHold::LeasedByAttempt {
                    attempt_id: lease.attempt_id.clone(),
                    valid_until: lease.valid_until.clone(),
                })
            } else if parse_rfc3339_utc_seconds(&record.retain_until)? > now_seconds {
                Some(RetentionHold::WithinRetention {
                    retain_until: record.retain_until.clone(),
                })
            } else {
                None
            };
            match hold {
                Some(reason) => {
                    kept_artifacts.extend(
                        record
                            .manifest
                            .artifacts
                            .iter()
                            .map(|entry| entry.digest.clone()),
                    );
                    retained.push(RetainedArtifactSet {
                        manifest_digest: digest,
                        reason,
                    });
                }
                None => expired.push((path, record)),
            }
        }

        let mut removed = Vec::new();
        let mut deleted_artifacts = BTreeSet::new();
        for (path, record) in &expired {
            let mut removed_artifacts = Vec::new();
            for entry in &record.manifest.artifacts {
                if !kept_artifacts.contains(&entry.digest)
                    && deleted_artifacts.insert(entry.digest.clone())
                {
                    remove_directory(&root.join(&entry.digest))?;
                    removed_artifacts.push(entry.digest.clone());
                }
            }
            remove_file(path)?;
            removed.push(RemovedArtifactSet {
                manifest_digest: record.manifest.digest.clone(),
                removed_artifacts,
            });
        }

        Ok(RetentionSweepReport { retained, removed })
    }
}

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
        fs::write(
            directory.join(DELIVERY_MANIFEST_MARKER),
            manifest.digest.as_bytes(),
        )
        .map_err(|error| PublishError::Io {
            operation: format!("write local delivery marker {}", directory.display()),
            message: error.to_string(),
        })?;

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
        let directory = local_attempt_directory(
            &node.settings,
            context.attempt_id,
            &self.descriptor.identity().display_name(),
        )?;
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

impl DeliveryDestination for LocalDirectoryDestination {
    fn validate_staged_envelope(
        &self,
        node: &PlanNode,
        context: &AdapterExecutionContext<'_>,
        envelope: &DeliveryEnvelope,
    ) -> Result<(), PublishError> {
        let manifest = context
            .manifest
            .ok_or(PublishError::MissingArtifactManifest)?;
        let expected = self.stage_envelope(node, context, manifest)?.envelopes;
        if expected.len() != 1 || expected.first() != Some(envelope) {
            return Err(PublishError::Execution(format!(
                "synchronized delivery envelope for route {} does not match its sealed local-directory settings",
                node.binding_id
            )));
        }
        Ok(())
    }

    fn probe_delivery(
        &self,
        settings: &AdapterSettings,
        identity: &DeliveryIdempotencyIdentity,
        _credentials: &BTreeMap<String, publish_domain::ResolvedCredential>,
    ) -> Result<DeliveryProbe, PublishError> {
        let directory = local_attempt_directory(
            settings,
            &identity.attempt_id,
            &self.descriptor.identity().display_name(),
        )?;
        if !directory.try_exists().map_err(|error| PublishError::Io {
            operation: format!("inspect local delivery {}", directory.display()),
            message: error.to_string(),
        })? {
            return Ok(DeliveryProbe::Absent);
        }
        let marker = directory.join(DELIVERY_MANIFEST_MARKER);
        let persisted_digest = match fs::read_to_string(&marker) {
            Ok(digest) => digest,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(DeliveryProbe::Conflicting {
                    external_reference: directory.to_string_lossy().to_string(),
                });
            }
            Err(error) => {
                return Err(PublishError::Io {
                    operation: format!("read local delivery marker {}", marker.display()),
                    message: error.to_string(),
                });
            }
        };
        if persisted_digest == identity.manifest_digest {
            Ok(DeliveryProbe::Matching {
                external_reference: directory.to_string_lossy().to_string(),
            })
        } else {
            Ok(DeliveryProbe::Conflicting {
                external_reference: directory.to_string_lossy().to_string(),
            })
        }
    }
}

fn local_attempt_directory(
    settings: &AdapterSettings,
    attempt_id: &str,
    adapter: &str,
) -> Result<PathBuf, PublishError> {
    let delivery_root = PathBuf::from(settings.string("directory", adapter)?);
    let attempt_directory = format!("attempt-{}", &sha256_hex(attempt_id.as_bytes())[..24]);
    Ok(delivery_root.join(attempt_directory))
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
    let actual_digest = sha256_hex(bytes);
    if actual_digest != expected_digest {
        return Err(PublishError::ArtifactDigestMismatch {
            artifact: path.display().to_string(),
            expected: expected_digest.to_string(),
            actual: actual_digest,
        });
    }
    if path.exists() {
        return verify_file(path, expected_digest);
    }

    let sequence = CONTENT_TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("artifact");
    let entropy = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = path.with_file_name(format!(
        ".{file_name}.tmp-{}-{entropy}-{sequence}",
        std::process::id(),
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| PublishError::Io {
            operation: format!("create temporary artifact {}", temporary.display()),
            message: error.to_string(),
        })?;
    let write_result = file.write_all(bytes).and_then(|_| file.sync_all());
    drop(file);
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary);
        return Err(PublishError::Io {
            operation: format!("write temporary artifact {}", temporary.display()),
            message: error.to_string(),
        });
    }
    let publish_result = match fs::hard_link(&temporary, path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(PublishError::Io {
            operation: format!("publish artifact {}", path.display()),
            message: error.to_string(),
        }),
    };
    let cleanup_result = fs::remove_file(&temporary);
    publish_result?;
    cleanup_result.map_err(|error| PublishError::Io {
        operation: format!("remove temporary artifact {}", temporary.display()),
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

/// 按 Manifest digest 保存的产物集合记录：保留期限与集合内容一起可观察（ADR-0038）。
#[derive(Debug, Serialize, Deserialize)]
struct StoredArtifactSetRecord {
    manifest: ArtifactManifest,
    stored_at: String,
    retain_until: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredArtifactSetLease {
    attempt_id: String,
    manifest_digest: String,
    valid_until: String,
}

fn set_record_path(root: &Path, manifest_digest: &str) -> PathBuf {
    root.join(SET_RECORD_DIRECTORY)
        .join(format!("{manifest_digest}.json"))
}

/// 租约文件名使用 attempt id 的内容摘要，避免把外部标识拼进文件系统路径。
fn lease_path(root: &Path, attempt_id: &str) -> PathBuf {
    root.join(LEASE_DIRECTORY)
        .join(format!("{}.json", sha256_hex(attempt_id.as_bytes())))
}

/// 幂等保存产物集合记录：相同 digest 复用既有记录，内容不一致必须拒绝而不是覆盖。
fn persist_set_record(
    root: &Path,
    manifest: &ArtifactManifest,
    retention_seconds: u64,
) -> Result<(), PublishError> {
    let path = set_record_path(root, &manifest.digest);
    if path.exists() {
        let existing: StoredArtifactSetRecord = read_json(&path)?;
        if existing.manifest != *manifest {
            return Err(PublishError::Execution(format!(
                "artifact set record {} does not match the sealed manifest; refusing to overwrite the stored set",
                path.display()
            )));
        }
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        create_directory(parent)?;
    }
    let stored_at = current_epoch_seconds()?;
    let deadline_error = || {
        PublishError::Execution(format!(
            "retention window of {retention_seconds} seconds exceeds the representable retention deadline"
        ))
    };
    let deadline = i64::try_from(retention_seconds)
        .ok()
        .and_then(|seconds| stored_at.checked_add(seconds))
        .ok_or_else(deadline_error)?;
    let retain_until = format_rfc3339_utc_seconds(deadline);
    parse_rfc3339_utc_seconds(&retain_until).map_err(|_| deadline_error())?;
    write_json(
        &path,
        &StoredArtifactSetRecord {
            manifest: manifest.clone(),
            stored_at: format_rfc3339_utc_seconds(stored_at),
            retain_until,
        },
    )
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, PublishError> {
    let content = fs::read_to_string(path).map_err(|error| PublishError::Io {
        operation: format!("read {}", path.display()),
        message: error.to_string(),
    })?;
    serde_json::from_str(&content).map_err(|error| {
        PublishError::Execution(format!(
            "stored artifact store state {} is not readable: {error}",
            path.display()
        ))
    })
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), PublishError> {
    let content = serde_json::to_string_pretty(value).map_err(|error| {
        PublishError::Execution(format!("cannot serialize artifact store state: {error}"))
    })?;
    fs::write(path, content).map_err(|error| PublishError::Io {
        operation: format!("write {}", path.display()),
        message: error.to_string(),
    })
}

/// 读取目录内全部 JSON 状态文件，按文件名排序保证确定性；目录不存在视为空。
fn read_json_directory<T: serde::de::DeserializeOwned>(
    directory: &Path,
) -> Result<Vec<(PathBuf, T)>, PublishError> {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(PublishError::Io {
                operation: format!("list {}", directory.display()),
                message: error.to_string(),
            })
        }
    };
    let mut paths = entries
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension == "json")
        })
        .collect::<Vec<_>>();
    paths.sort();
    paths
        .into_iter()
        .map(|path| Ok((path.clone(), read_json(&path)?)))
        .collect()
}

fn remove_file(path: &Path) -> Result<(), PublishError> {
    fs::remove_file(path).map_err(|error| PublishError::Io {
        operation: format!("remove {}", path.display()),
        message: error.to_string(),
    })
}

fn remove_directory(path: &Path) -> Result<(), PublishError> {
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(PublishError::Io {
            operation: format!("remove {}", path.display()),
            message: error.to_string(),
        }),
    }
}

fn current_epoch_seconds() -> Result<i64, PublishError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .map_err(|error| PublishError::Execution(format!("system clock is unavailable: {error}")))
}

/// 解析严格 UTC RFC 3339 时刻（YYYY-MM-DDTHH:MM:SSZ）。解析后重新格式化并比对，
/// 用一条规则同时拒绝越界日期、闰日错误与其他变体写法。
fn parse_rfc3339_utc_seconds(value: &str) -> Result<i64, PublishError> {
    let invalid = || {
        PublishError::Execution(format!(
            "timestamp {value} must use the strict UTC RFC 3339 form YYYY-MM-DDTHH:MM:SSZ"
        ))
    };
    let bytes = value.as_bytes();
    if bytes.len() != 20
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
        || bytes[19] != b'Z'
    {
        return Err(invalid());
    }
    let field = |range: std::ops::Range<usize>| -> Result<i64, PublishError> {
        let digits = &value[range];
        if !digits.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(invalid());
        }
        digits.parse::<i64>().map_err(|_| invalid())
    };
    let (year, month, day) = (field(0..4)?, field(5..7)?, field(8..10)?);
    let (hour, minute, second) = (field(11..13)?, field(14..16)?, field(17..19)?);

    // Howard Hinnant 的 days_from_civil：公历日期到 epoch 天数的封闭算法。
    let years = if month <= 2 { year - 1 } else { year };
    let era = if years >= 0 { years } else { years - 399 } / 400;
    let year_of_era = years - era * 400;
    let month_index = if month > 2 { month - 3 } else { month + 9 };
    let day_of_year = (153 * month_index + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    let days = era * 146_097 + day_of_era - 719_468;
    let seconds = days * 86_400 + hour * 3_600 + minute * 60 + second;

    if format_rfc3339_utc_seconds(seconds) != value {
        return Err(invalid());
    }
    Ok(seconds)
}

/// 把 Unix epoch 秒格式化为严格 UTC RFC 3339（civil_from_days 的逆运算）。
fn format_rfc3339_utc_seconds(seconds: i64) -> String {
    let days = seconds.div_euclid(86_400);
    let time = seconds.rem_euclid(86_400);
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = if month <= 2 { year + 1 } else { year };
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        time / 3_600,
        (time % 3_600) / 60,
        time % 60
    )
}
