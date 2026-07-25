use std::collections::BTreeMap;
use std::sync::Arc;

use publish_adapters::{
    AdapterConformanceFixture, AdapterContract, AdapterExecutionContext, AdapterExecutionOutput,
    AdapterRegistry, ArtifactProcessor, FakeRemoteBackend, LocalDirectoryDestination,
    LocalExecutionBackend, ProjectProvider, StaticCredentialSource, TemporaryArtifactStore,
    ARTIFACT_CANDIDATE_CAPABILITY, ARTIFACT_VERIFIED_CAPABILITY, FAKE_REMOTE_BACKEND_ID,
    STRUCTURED_PLAN_EXECUTION_CAPABILITY,
};
use publish_domain::{
    sha256_hex, AdapterBinding, AdapterDescriptor, AdapterIdentity, AdapterKind, AdapterSchema,
    AdapterSelection, AdapterSettings, ArtifactCandidate, Capability, CapabilityRequirement,
    CredentialKind, PlanNode, PlanNodeTemplate, PlanStage, PlanningInputSnapshot,
    PublishAttemptStatus, PublishError, PublishingCapability, ReleaseIdentity, SourceSnapshot,
    PLANNING_INPUT_SNAPSHOT_VERSION,
};
use publish_runner_core::{PublishRuntime, StartPublishAttempt};
use serde_json::Value;

const ARTIFACT_BYTES: &[u8] = b"one-publish credentialed artifact\n";
const SIGNING_REQUIREMENT: &str = "signing-key";
const LOCAL_REFERENCE: &str = "keychain://one-publish/signing";
const REMOTE_REFERENCE: &str = "actions://secrets/ONE_PUBLISH_SIGNING";
const SIGNING_SECRET: &str = "signing-secret-material-do-not-leak";

/// 需要凭据的 fixture 处理器：用解析出的签名材料为首个产物派生签名产物，
/// 并断言自己只收到 schema 声明的凭据。
struct SigningProcessor {
    descriptor: AdapterDescriptor,
}

impl SigningProcessor {
    fn new() -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ArtifactProcessor,
                "signing-processor",
                1,
                AdapterSchema::new(1).with_credential(
                    SIGNING_REQUIREMENT,
                    CredentialKind::SigningKey,
                    "signs collected artifacts before delivery",
                ),
                PublishingCapability {
                    provides: vec![Capability::new(ARTIFACT_VERIFIED_CAPABILITY, 1)],
                    requires: vec![CapabilityRequirement::exact(
                        ARTIFACT_CANDIDATE_CAPABILITY,
                        1,
                    )],
                },
            ),
        }
    }
}

impl AdapterContract for SigningProcessor {
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
        Ok(vec![PlanNodeTemplate::adapter_action(
            "sign",
            PlanStage::ProcessArtifacts,
            "sign_artifacts",
            BTreeMap::new(),
        )
        .with_artifact_io(
            vec!["artifact:*".to_string()],
            vec!["signature".to_string()],
        )])
    }

    fn execute_node(
        &self,
        _node: &PlanNode,
        context: &AdapterExecutionContext<'_>,
    ) -> Result<AdapterExecutionOutput, PublishError> {
        assert_eq!(
            context.credentials.keys().collect::<Vec<_>>(),
            vec![SIGNING_REQUIREMENT],
            "processors receive exactly the credentials their schema declares"
        );
        let key = &context.credentials[SIGNING_REQUIREMENT];
        assert_eq!(key.kind, CredentialKind::SigningKey);
        let artifact = context.artifacts.first().ok_or_else(|| {
            PublishError::Execution("signing requires at least one artifact".to_string())
        })?;
        let signature =
            sha256_hex(format!("{}:{}", key.value.expose(), artifact.digest).as_bytes());
        Ok(AdapterExecutionOutput {
            artifacts: vec![ArtifactCandidate::new(
                "signature",
                format!("{}.sig", artifact.file_name),
                "text/plain",
                "any",
                "any",
                signature.into_bytes(),
            )],
            ..AdapterExecutionOutput::default()
        })
    }
}

impl ArtifactProcessor for SigningProcessor {}

/// 无凭据要求的 fixture Provider：断言未声明凭据的 Adapter 收到空集。
struct FixtureProvider {
    descriptor: AdapterDescriptor,
}

impl FixtureProvider {
    fn new() -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ProjectProvider,
                "fixture-project",
                1,
                AdapterSchema::new(1),
                PublishingCapability {
                    provides: vec![Capability::new(ARTIFACT_CANDIDATE_CAPABILITY, 1)],
                    requires: vec![CapabilityRequirement::exact(
                        STRUCTURED_PLAN_EXECUTION_CAPABILITY,
                        1,
                    )],
                },
            ),
        }
    }
}

impl AdapterContract for FixtureProvider {
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
        Ok(vec![PlanNodeTemplate::adapter_action(
            "collect",
            PlanStage::CollectArtifacts,
            "collect_artifacts",
            BTreeMap::new(),
        )
        .with_artifact_io(
            vec![],
            vec!["desktop-installer".to_string()],
        )])
    }

    fn execute_node(
        &self,
        _node: &PlanNode,
        context: &AdapterExecutionContext<'_>,
    ) -> Result<AdapterExecutionOutput, PublishError> {
        assert!(
            context.credentials.is_empty(),
            "adapters without declared requirements must not receive credentials"
        );
        Ok(AdapterExecutionOutput {
            artifacts: vec![ArtifactCandidate::new(
                "desktop-installer",
                "app.bin",
                "application/octet-stream",
                "test-os",
                "test-arch",
                ARTIFACT_BYTES.to_vec(),
            )],
            ..AdapterExecutionOutput::default()
        })
    }
}

impl ProjectProvider for FixtureProvider {}

enum Backend {
    Local(StaticCredentialSource),
    Remote(StaticCredentialSource),
}

impl Backend {
    fn identity(&self) -> AdapterIdentity {
        let id = match self {
            Backend::Local(_) => "local-execution",
            Backend::Remote(_) => FAKE_REMOTE_BACKEND_ID,
        };
        AdapterIdentity::new(AdapterKind::ExecutionBackend, id, 1)
    }
}

#[test]
fn a_credentialed_processor_publishes_while_every_surface_keeps_references_only() {
    let store_dir = tempfile::tempdir().expect("create store");
    let delivery_dir = tempfile::tempdir().expect("create delivery");
    let (runtime, snapshot) = fixture_runtime(
        store_dir.path(),
        delivery_dir.path(),
        Backend::Local(StaticCredentialSource::new().with_secret(
            LOCAL_REFERENCE,
            CredentialKind::SigningKey,
            SIGNING_SECRET,
        )),
        Some(LOCAL_REFERENCE),
    );

    let prepared = runtime.prepare_attempt(&snapshot).expect("prepare attempt");
    let attempt = runtime
        .start_attempt(
            &prepared,
            StartPublishAttempt::new("attempt-signed", "run-signed", release_identity(&snapshot)),
        )
        .expect("run credentialed pipeline");

    assert_eq!(attempt.status, PublishAttemptStatus::Published);
    let manifest = attempt.manifest.as_ref().expect("sealed manifest");
    let signature = manifest
        .artifacts
        .iter()
        .find(|artifact| artifact.role == "signature")
        .expect("signature artifact derived through the resolved credential");
    assert_eq!(signature.file_name, "app.bin.sig");

    // 秘密泄漏断言：计划、快照、事件、Manifest、Receipt 和完整尝试视图（备份面）
    // 只允许出现非秘密引用，绝不允许出现解析值。
    let serialized_plan = serde_json::to_string(&prepared).expect("serialize prepared plan");
    assert!(serialized_plan.contains(LOCAL_REFERENCE));
    let attempt_view = serde_json::to_value(&attempt).expect("serialize attempt view");
    for (surface, serialized) in [
        ("prepared plan and snapshot", serialized_plan),
        ("attempt view", attempt_view.to_string()),
        (
            "events",
            serde_json::to_string(&attempt.events).expect("serialize events"),
        ),
        (
            "manifest",
            serde_json::to_string(manifest).expect("serialize manifest"),
        ),
        (
            "receipts",
            serde_json::to_string(&attempt.receipts).expect("serialize receipts"),
        ),
    ] {
        assert!(
            !serialized.contains(SIGNING_SECRET),
            "{surface} must never contain the resolved secret"
        );
    }
}

#[test]
fn unbound_or_undeclared_credential_references_block_planning() {
    let store_dir = tempfile::tempdir().expect("create store");
    let delivery_dir = tempfile::tempdir().expect("create delivery");
    let (runtime, snapshot) = fixture_runtime(
        store_dir.path(),
        delivery_dir.path(),
        Backend::Local(StaticCredentialSource::new()),
        None,
    );
    assert!(matches!(
        runtime.prepare(&snapshot),
        Err(PublishError::CredentialNotBound { requirement, .. })
            if requirement == SIGNING_REQUIREMENT
    ));

    let (runtime, mut snapshot) = fixture_runtime(
        store_dir.path(),
        delivery_dir.path(),
        Backend::Local(StaticCredentialSource::new()),
        Some(LOCAL_REFERENCE),
    );
    snapshot.adapters.project_provider = snapshot
        .adapters
        .project_provider
        .clone()
        .with_credential("rogue-secret", LOCAL_REFERENCE);
    assert!(matches!(
        runtime.prepare(&snapshot),
        Err(PublishError::CredentialNotDeclared { name, .. }) if name == "rogue-secret"
    ));

    assert!(store_dir
        .path()
        .read_dir()
        .expect("read store")
        .next()
        .is_none());
    assert!(delivery_dir
        .path()
        .read_dir()
        .expect("read delivery")
        .next()
        .is_none());
}

#[test]
fn unresolvable_references_block_the_attempt_before_any_side_effect() {
    for (source, expected_fragment) in [
        (StaticCredentialSource::new(), "is not available"),
        (
            StaticCredentialSource::new().with_denied(LOCAL_REFERENCE),
            "cannot be accessed",
        ),
        (
            StaticCredentialSource::new().with_secret(
                LOCAL_REFERENCE,
                CredentialKind::Token,
                SIGNING_SECRET,
            ),
            "expected SigningKey",
        ),
    ] {
        let store_dir = tempfile::tempdir().expect("create store");
        let delivery_dir = tempfile::tempdir().expect("create delivery");
        let (runtime, snapshot) = fixture_runtime(
            store_dir.path(),
            delivery_dir.path(),
            Backend::Local(source),
            Some(LOCAL_REFERENCE),
        );
        let prepared = runtime.prepare_attempt(&snapshot).expect("prepare attempt");

        let attempt = runtime
            .start_attempt(
                &prepared,
                StartPublishAttempt::new(
                    "attempt-blocked",
                    "run-blocked",
                    release_identity(&snapshot),
                ),
            )
            .expect("credential failures stay inspectable attempts");

        assert_eq!(attempt.status, PublishAttemptStatus::Failed);
        let error = attempt.error.as_deref().expect("credential diagnostics");
        assert!(
            error.contains(expected_fragment),
            "unexpected diagnostics: {error}"
        );
        assert!(
            error.contains(LOCAL_REFERENCE),
            "diagnostics must name the unavailable reference: {error}"
        );
        assert!(
            !error.contains(SIGNING_SECRET),
            "diagnostics must never leak resolved values"
        );
        assert!(
            !attempt
                .events
                .iter()
                .any(|event| event.kind == "plan_node_completed"),
            "credential preflight must block before any node runs"
        );
        assert!(
            store_dir
                .path()
                .read_dir()
                .expect("read store")
                .next()
                .is_none(),
            "credential failures must block before store side effects"
        );
        assert!(
            delivery_dir
                .path()
                .read_dir()
                .expect("read delivery")
                .next()
                .is_none(),
            "credential failures must block before delivery side effects"
        );
    }
}

#[test]
fn local_and_remote_backends_resolve_the_same_logical_credential_equivalently() {
    let local_store = tempfile::tempdir().expect("create local store");
    let local_delivery = tempfile::tempdir().expect("create local delivery");
    let (local_runtime, local_snapshot) = fixture_runtime(
        local_store.path(),
        local_delivery.path(),
        Backend::Local(StaticCredentialSource::new().with_secret(
            LOCAL_REFERENCE,
            CredentialKind::SigningKey,
            SIGNING_SECRET,
        )),
        Some(LOCAL_REFERENCE),
    );

    let remote_store = tempfile::tempdir().expect("create remote store");
    let remote_delivery = tempfile::tempdir().expect("create remote delivery");
    let (remote_runtime, remote_snapshot) = fixture_runtime(
        remote_store.path(),
        remote_delivery.path(),
        Backend::Remote(StaticCredentialSource::new().with_secret(
            REMOTE_REFERENCE,
            CredentialKind::SigningKey,
            SIGNING_SECRET,
        )),
        Some(REMOTE_REFERENCE),
    );

    let local_attempt = local_runtime
        .start_attempt(
            &local_runtime
                .prepare_attempt(&local_snapshot)
                .expect("prepare local attempt"),
            StartPublishAttempt::new(
                "attempt-local",
                "run-local",
                release_identity(&local_snapshot),
            ),
        )
        .expect("publish through the local backend");
    let remote_attempt = remote_runtime
        .start_attempt(
            &remote_runtime
                .prepare_attempt(&remote_snapshot)
                .expect("prepare remote attempt"),
            StartPublishAttempt::new(
                "attempt-remote",
                "run-remote",
                release_identity(&remote_snapshot),
            ),
        )
        .expect("publish through the fake remote backend");

    assert_eq!(local_attempt.status, PublishAttemptStatus::Published);
    assert_eq!(remote_attempt.status, PublishAttemptStatus::Published);

    let signature_digest = |attempt: &publish_domain::PublishAttemptView| {
        attempt
            .manifest
            .as_ref()
            .expect("sealed manifest")
            .artifacts
            .iter()
            .find(|artifact| artifact.role == "signature")
            .expect("signature artifact")
            .digest
            .clone()
    };
    assert_eq!(
        signature_digest(&local_attempt),
        signature_digest(&remote_attempt),
        "both backends must resolve the same logical credential to equivalent results"
    );

    for attempt in [&local_attempt, &remote_attempt] {
        let serialized = serde_json::to_string(attempt).expect("serialize attempt view");
        assert!(!serialized.contains(SIGNING_SECRET));
    }
}

fn release_identity(snapshot: &PlanningInputSnapshot) -> ReleaseIdentity {
    ReleaseIdentity::new(
        "fixture-project:app",
        snapshot.source.clone(),
        "1.0.0",
        "stable",
        None,
    )
}

fn fixture_runtime(
    store_directory: &std::path::Path,
    delivery_directory: &std::path::Path,
    backend: Backend,
    signing_reference: Option<&str>,
) -> (PublishRuntime, PlanningInputSnapshot) {
    let backend_identity = backend.identity();
    let snapshot = fixture_snapshot(
        store_directory.to_string_lossy().as_ref(),
        delivery_directory.to_string_lossy().as_ref(),
        backend_identity.clone(),
        signing_reference,
    );
    let mut fixture = AdapterConformanceFixture::new(snapshot.clone());
    fixture.forbidden_values.push(SIGNING_SECRET.to_string());

    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(Arc::new(FixtureProvider::new()), &fixture)
        .expect("register fixture provider");
    registry
        .register_artifact_processor(Arc::new(SigningProcessor::new()), &fixture)
        .expect("register signing processor");
    match backend {
        Backend::Local(source) => registry
            .register_execution_backend(
                Arc::new(LocalExecutionBackend::with_credential_source(Arc::new(
                    source,
                ))),
                &fixture,
            )
            .expect("register local backend"),
        Backend::Remote(source) => registry
            .register_execution_backend(
                Arc::new(FakeRemoteBackend::new(Arc::new(source))),
                &fixture,
            )
            .expect("register fake remote backend"),
    }
    registry
        .register_artifact_store(
            Arc::new(TemporaryArtifactStore::new(store_directory)),
            &fixture,
        )
        .expect("register temporary store");
    registry
        .register_delivery_destination(
            Arc::new(LocalDirectoryDestination::new(delivery_directory)),
            &fixture,
        )
        .expect("register destination");
    (PublishRuntime::new(registry), snapshot)
}

fn fixture_snapshot(
    store_directory: &str,
    delivery_directory: &str,
    backend: AdapterIdentity,
    signing_reference: Option<&str>,
) -> PlanningInputSnapshot {
    let empty = AdapterSettings::new(1);
    let mut processor_binding = AdapterBinding::new(
        "processor-signing",
        AdapterIdentity::new(AdapterKind::ArtifactProcessor, "signing-processor", 1),
        empty.clone(),
    );
    if let Some(reference) = signing_reference {
        processor_binding = processor_binding.with_credential(SIGNING_REQUIREMENT, reference);
    }
    PlanningInputSnapshot {
        version: PLANNING_INPUT_SNAPSHOT_VERSION,
        configuration_revision: "config-revision-1".to_string(),
        runtime_revision: "runner-1".to_string(),
        release_input: BTreeMap::from([(
            "version".to_string(),
            Value::String("1.0.0".to_string()),
        )]),
        source: SourceSnapshot {
            revision: "0123456789abcdef".to_string(),
            workspace_digest: None,
            dirty: false,
            captured_at: "2026-07-21T10:00:00Z".to_string(),
            reproducible: true,
        },
        external_preconditions: BTreeMap::new(),
        adapters: AdapterSelection {
            project_provider: AdapterBinding::new(
                "project",
                AdapterIdentity::new(AdapterKind::ProjectProvider, "fixture-project", 1),
                empty.clone(),
            ),
            artifact_processors: vec![processor_binding],
            execution_backend: AdapterBinding::new("backend", backend, empty.clone()),
            artifact_store: AdapterBinding::new(
                "store",
                AdapterIdentity::new(AdapterKind::ArtifactStore, "temporary-artifact-store", 1),
                AdapterSettings::new(1)
                    .with_value("root_directory", Value::String(store_directory.to_string())),
            ),
            delivery_destinations: vec![AdapterBinding::new(
                "destination",
                AdapterIdentity::new(AdapterKind::DeliveryDestination, "local-directory", 1),
                AdapterSettings::new(1)
                    .with_value("directory", Value::String(delivery_directory.to_string())),
            )],
        },
    }
}
