use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;

use publish_adapters::{
    AdapterConformanceFixture, AdapterContract, AdapterExecutionContext, AdapterExecutionOutput,
    AdapterRegistry, DeliveryDestination, DeliveryProbe, FakeSftpServer, LocalExecutionBackend,
    SftpDeliveryDestination, StaticCredentialSource, SFTP_DELIVERY_RECORD_NAME,
    SFTP_DESTINATION_ID,
};
use publish_domain::{
    sha256_hex, AdapterBinding, AdapterIdentity, AdapterKind, AdapterSelection, AdapterSettings,
    ArtifactManifest, ArtifactManifestEntry, CredentialKind, CredentialValue, DeliveryEnvelope,
    DeliveryIdempotencyIdentity, DeliveryReceipt, DeliveryStatus, PlanNode, PlanStage,
    PlanningInputSnapshot, PublishError, PublishFailureCategory, ReleaseIdentity,
    ResolvedCredential, SourceSnapshot, PLANNING_INPUT_SNAPSHOT_VERSION,
};
use serde_json::Value;

const ROUTE_ID: &str = "sftp-route";
const KEY_REFERENCE: &str = "release-server-key";
const KEY_VALUE: &str =
    "-----BEGIN OPENSSH PRIVATE KEY-----\nfixture-key\n-----END OPENSSH PRIVATE KEY-----";
const CREDENTIAL_NAME: &str = "ssh_private_key";

/// 单测夹具：隔离的内存 SFTP 测试服务器、密封产物文件与解析好的凭据。
struct Fixture {
    server: Arc<FakeSftpServer>,
    destination: SftpDeliveryDestination,
    root: tempfile::TempDir,
    credentials: BTreeMap<String, ResolvedCredential>,
}

impl Fixture {
    fn new() -> Self {
        let server = Arc::new(FakeSftpServer::new());
        Self {
            destination: SftpDeliveryDestination::new(server.clone()),
            server,
            root: tempfile::tempdir().expect("fixture root"),
            credentials: BTreeMap::from([(
                CREDENTIAL_NAME.to_string(),
                ResolvedCredential {
                    kind: CredentialKind::SshPrivateKey,
                    value: CredentialValue::new(KEY_VALUE),
                },
            )]),
        }
    }

    /// 物化 destination 的三个路线节点：stage、publish、observe。
    fn nodes(&self, settings: &AdapterSettings) -> Vec<PlanNode> {
        self.nodes_for(&snapshot(), settings)
    }

    fn nodes_for(
        &self,
        snapshot: &PlanningInputSnapshot,
        settings: &AdapterSettings,
    ) -> Vec<PlanNode> {
        let templates = self
            .destination
            .plan_fragment(snapshot, settings)
            .expect("plan fragment");
        templates
            .into_iter()
            .map(|template| PlanNode {
                id: format!("{ROUTE_ID}.{}", template.local_id),
                stage: template.stage,
                adapter: self.destination.descriptor().identity(),
                binding_id: ROUTE_ID.to_string(),
                settings: settings.clone(),
                operation: template.operation,
                depends_on: Vec::new(),
                artifact_inputs: template.artifact_inputs,
                artifact_outputs: template.artifact_outputs,
                side_effects: template.side_effects,
                cancellable: template.cancellable,
                cleanup_owned_staging: template.cleanup_owned_staging,
                irreversible: template.irreversible,
            })
            .collect()
    }

    fn execute(
        &self,
        node: &PlanNode,
        manifest: &ArtifactManifest,
        envelopes: &[DeliveryEnvelope],
        receipts: &[DeliveryReceipt],
    ) -> Result<AdapterExecutionOutput, PublishError> {
        let context = AdapterExecutionContext {
            attempt_id: "attempt-sftp",
            plan_digest: "plan-digest",
            snapshot_digest: manifest.planning_snapshot_digest.as_str(),
            artifacts: &[],
            manifest: Some(manifest),
            envelopes,
            receipts,
            credentials: &self.credentials,
        };
        self.destination.execute_node(node, &context)
    }

    /// 依次执行 stage 与 publish，返回 (envelope, publish 输出)。
    fn stage_then_publish(
        &self,
        settings: &AdapterSettings,
        manifest: &ArtifactManifest,
    ) -> (
        Vec<DeliveryEnvelope>,
        Result<AdapterExecutionOutput, PublishError>,
    ) {
        let nodes = self.nodes(settings);
        let staged = self
            .execute(&nodes[0], manifest, &[], &[])
            .expect("stage envelope");
        let publish = self.execute(&nodes[1], manifest, &staged.envelopes, &[]);
        (staged.envelopes, publish)
    }
}

fn settings() -> AdapterSettings {
    AdapterSettings::new(1)
        .with_value("host", Value::String("files.example.com".to_string()))
        .with_value("port", Value::from(2022u64))
        .with_value("username", Value::String("deploy".to_string()))
        .with_value("remote_path", Value::String("/srv/releases".to_string()))
        .with_value(
            "artifact_roles",
            Value::Array(vec![Value::String("installer".to_string())]),
        )
}

fn snapshot() -> PlanningInputSnapshot {
    snapshot_with_release_input(BTreeMap::from([(
        "version".to_string(),
        Value::String("1.2.3".to_string()),
    )]))
}

fn snapshot_with_release_input(release_input: BTreeMap<String, Value>) -> PlanningInputSnapshot {
    PlanningInputSnapshot {
        version: PLANNING_INPUT_SNAPSHOT_VERSION,
        configuration_revision: "configuration-revision-1".to_string(),
        runtime_revision: "runtime-revision-1".to_string(),
        release_input,
        source: SourceSnapshot {
            revision: "0123456789abcdef".to_string(),
            workspace_digest: None,
            dirty: false,
            captured_at: "2026-07-26T10:00:00Z".to_string(),
            reproducible: true,
        },
        external_preconditions: BTreeMap::new(),
        promoted_manifest_digest: None,
        adapters: AdapterSelection {
            project_provider: AdapterBinding::new(
                "project",
                AdapterIdentity::new(AdapterKind::ProjectProvider, "fixture-project", 1),
                AdapterSettings::new(1),
            ),
            artifact_processors: vec![],
            execution_backend: AdapterBinding::new(
                "backend",
                AdapterIdentity::new(AdapterKind::ExecutionBackend, "local-execution", 1),
                AdapterSettings::new(1),
            ),
            artifact_store: AdapterBinding::new(
                "store",
                AdapterIdentity::new(AdapterKind::ArtifactStore, "temporary-artifact-store", 1),
                AdapterSettings::new(1),
            ),
            delivery_routes: vec![],
        },
    }
}

/// 把产物写进夹具目录并封存为 Artifact Manifest；条目顺序即声明顺序。
fn manifest_with(root: &Path, entries: &[(&str, &str, &[u8])]) -> ArtifactManifest {
    let sealed = entries
        .iter()
        .map(|(role, file_name, bytes)| {
            let path = root.join(file_name.replace('/', "_"));
            std::fs::write(&path, bytes).expect("write fixture artifact");
            ArtifactManifestEntry {
                role: role.to_string(),
                file_name: file_name.to_string(),
                media_type: "application/octet-stream".to_string(),
                platform: "macos".to_string(),
                architecture: "aarch64".to_string(),
                size: bytes.len() as u64,
                digest: sha256_hex(bytes),
                locator: path.to_string_lossy().to_string(),
                retention: "604800s".to_string(),
            }
        })
        .collect();
    ArtifactManifest::seal(sha256_hex(b"snapshot"), sealed).expect("seal manifest")
}

fn desktop_manifest(root: &Path) -> ArtifactManifest {
    manifest_with(
        root,
        &[
            ("installer", "Demo.dmg", b"dmg-bytes"),
            ("installer", "Demo.msi", b"msi-bytes"),
            ("build-support", "build-log.txt", b"local build residue"),
        ],
    )
}

fn classified_category(error: &PublishError) -> PublishFailureCategory {
    match error {
        PublishError::Classified { failure } => failure.category,
        other => panic!("expected a classified failure, got {other}"),
    }
}

fn sftp_identity() -> AdapterIdentity {
    AdapterIdentity::new(AdapterKind::DeliveryDestination, SFTP_DESTINATION_ID, 1)
}

/// 注册好 SFTP destination 的注册表：发布配置模块通过它组合 schema、
/// 校验设置并解析凭据引用（ADR-0030/0053）。
fn module_registry(fixture: &Fixture) -> AdapterRegistry {
    let conformance = AdapterConformanceFixture::new(snapshot());
    let mut registry = AdapterRegistry::new();
    registry
        .register_delivery_destination(
            Arc::new(SftpDeliveryDestination::new(fixture.server.clone())),
            &conformance,
        )
        .expect("register the sftp destination");
    registry
        .register_execution_backend(
            Arc::new(LocalExecutionBackend::with_credential_source(Arc::new(
                StaticCredentialSource::new().with_secret(
                    KEY_REFERENCE,
                    CredentialKind::SshPrivateKey,
                    KEY_VALUE,
                ),
            ))),
            &conformance,
        )
        .expect("register the execution backend");
    registry
}

// ---------------------------------------------------------------------------
// 发布配置模块交互：创建、查看、更新、删除，以及 schema 驱动的错误与阻断状态
// ---------------------------------------------------------------------------

/// Issue T17 验收：发布配置模块按版本化 Adapter Schema 创建、查看、更新和
/// 删除 SFTP Route；整个配置生命周期不触碰远端服务器。
#[test]
fn configuration_module_manages_sftp_routes_through_the_versioned_schema() {
    let fixture = Fixture::new();
    let registry = module_registry(&fixture);
    let identity = sftp_identity();

    // 创建：新路线从版本化默认值开始，schema 校验即通过。
    let created = fixture.destination.default_settings();
    let created = registry
        .migrate_and_validate_settings(&identity, &created)
        .expect("default settings are valid");
    assert_eq!(created.schema_version, 1);

    // 查看：只读摘要展示非秘密目标身份；未配置时也非空。
    let summary = fixture
        .destination
        .summarize_settings(&settings())
        .expect("summarize configured settings");
    assert_eq!(summary, "sftp://deploy@files.example.com:2022/srv/releases");
    let unconfigured = fixture
        .destination
        .summarize_settings(&created)
        .expect("summarize default settings");
    assert!(!unconfigured.trim().is_empty());

    // 更新：修改后的设置重新通过迁移与校验，结果保持确定性。
    let updated = settings().with_value("port", Value::from(22u64));
    let migrated = registry
        .migrate_and_validate_settings(&identity, &updated)
        .expect("updated settings are valid");
    assert_eq!(migrated, updated);

    // 删除：路线移除属于配置修订；Adapter 不持有任何路线状态需要清理，
    // 且整个配置生命周期从未触碰远端服务器。
    assert_eq!(fixture.server.total_calls(), 0);
}

#[test]
fn configuration_module_sees_schema_validation_errors_for_bad_updates() {
    let fixture = Fixture::new();
    let cases: Vec<(AdapterSettings, &str)> = vec![
        (settings().with_value("port", Value::from(0u64)), "port"),
        (
            settings().with_value("port", Value::from(70_000u64)),
            "port",
        ),
        (
            settings().with_value("host", Value::String("files.example.com/path".to_string())),
            "host",
        ),
        (
            settings().with_value("host", Value::String("bad host".to_string())),
            "host",
        ),
        (
            settings().with_value("username", Value::String("de\"ploy".to_string())),
            "username",
        ),
        (
            settings().with_value("remote_path", Value::String("/srv/../etc".to_string())),
            "remote_path",
        ),
        (
            settings().with_value("remote_path", Value::String("/srv/\nreleases".to_string())),
            "remote_path",
        ),
        (
            settings().with_value("artifact_roles", Value::Array(vec![])),
            "artifact_roles",
        ),
        (
            settings().with_value(
                "artifact_roles",
                Value::Array(vec![Value::String(String::new())]),
            ),
            "artifact_roles",
        ),
        (
            settings().with_value("mode", Value::String("fast".to_string())),
            "mode",
        ),
        (
            settings().with_value("port", Value::String("22".to_string())),
            "port",
        ),
    ];
    for (invalid, field) in cases {
        let error = fixture
            .destination
            .validate_settings(&invalid)
            .expect_err("invalid settings must be rejected");
        assert!(
            matches!(error, PublishError::InvalidAdapterSettings { .. }),
            "expected a settings validation error for {field}, got {error}"
        );
        assert!(
            error.to_string().contains(field),
            "error for {field} must name the field: {error}"
        );
    }
}

/// 不受支持的 schema 版本是阻断状态：配置模块显示阻断而不是静默改写设置
/// （ADR-0030/0031）。
#[test]
fn unsupported_schema_versions_surface_as_a_blocking_state() {
    let fixture = Fixture::new();
    let registry = module_registry(&fixture);
    let stale =
        AdapterSettings::new(2).with_value("host", Value::String("files.example.com".to_string()));

    let error = registry
        .migrate_and_validate_settings(&sftp_identity(), &stale)
        .expect_err("unknown schema versions block the route");
    match error {
        PublishError::UnsupportedSchemaVersion {
            actual, current, ..
        } => {
            assert_eq!(actual, 2);
            assert_eq!(current, 1);
        }
        other => panic!("expected a schema version block, got {other}"),
    }
}

/// Credential Reference 合同：schema 声明 ssh_private_key 要求，绑定只携带
/// 非秘密引用，解析经当前执行后端完成且值不进入可序列化面（ADR-0029）。
#[test]
fn credential_references_bind_and_resolve_through_the_execution_backend() {
    let fixture = Fixture::new();
    let registry = module_registry(&fixture);
    let requirement = fixture
        .destination
        .descriptor()
        .schema
        .credentials
        .get(CREDENTIAL_NAME)
        .expect("the sftp schema declares its ssh key requirement");
    assert_eq!(requirement.kind, CredentialKind::SshPrivateKey);
    assert!(!requirement.purpose.trim().is_empty());

    let unbound = AdapterBinding::new(ROUTE_ID, sftp_identity(), settings());
    let error = registry
        .validate_credential_bindings(&unbound)
        .expect_err("the ssh key requirement must be bound");
    assert!(matches!(error, PublishError::CredentialNotBound { .. }));

    let undeclared = AdapterBinding::new(ROUTE_ID, sftp_identity(), settings())
        .with_credential(CREDENTIAL_NAME, KEY_REFERENCE)
        .with_credential("password", "release-server-password");
    let error = registry
        .validate_credential_bindings(&undeclared)
        .expect_err("undeclared credential names are rejected");
    assert!(matches!(error, PublishError::CredentialNotDeclared { .. }));

    let bound = AdapterBinding::new(ROUTE_ID, sftp_identity(), settings())
        .with_credential(CREDENTIAL_NAME, KEY_REFERENCE);
    let backend = AdapterIdentity::new(AdapterKind::ExecutionBackend, "local-execution", 1);
    let resolved = registry
        .resolve_binding_credentials(&backend, &bound)
        .expect("resolve the ssh key through the execution backend");
    assert_eq!(
        resolved
            .get(CREDENTIAL_NAME)
            .expect("resolved ssh key")
            .value
            .expose(),
        KEY_VALUE
    );
    let serialized = serde_json::to_string(&bound).expect("bindings serialize");
    assert!(serialized.contains(KEY_REFERENCE));
    assert!(!serialized.contains(KEY_VALUE));
}

#[test]
fn credential_kind_mismatches_are_rejected_before_execution() {
    let fixture = Fixture::new();
    let conformance = AdapterConformanceFixture::new(snapshot());
    let mut registry = AdapterRegistry::new();
    registry
        .register_delivery_destination(
            Arc::new(SftpDeliveryDestination::new(fixture.server.clone())),
            &conformance,
        )
        .expect("register the sftp destination");
    registry
        .register_execution_backend(
            Arc::new(LocalExecutionBackend::with_credential_source(Arc::new(
                StaticCredentialSource::new().with_secret(
                    KEY_REFERENCE,
                    CredentialKind::Token,
                    "a-plain-token",
                ),
            ))),
            &conformance,
        )
        .expect("register the execution backend");

    let bound = AdapterBinding::new(ROUTE_ID, sftp_identity(), settings())
        .with_credential(CREDENTIAL_NAME, KEY_REFERENCE);
    let backend = AdapterIdentity::new(AdapterKind::ExecutionBackend, "local-execution", 1);
    let error = registry
        .resolve_binding_credentials(&backend, &bound)
        .expect_err("a token cannot satisfy an ssh private key requirement");
    assert!(matches!(error, PublishError::CredentialKindMismatch { .. }));
}

// ---------------------------------------------------------------------------
// 计划片段与 staging：路线专属 Delivery Envelope 派生
// ---------------------------------------------------------------------------

#[test]
fn plan_fragment_seals_three_route_nodes_with_declared_side_effects() {
    let fixture = Fixture::new();
    let nodes = fixture.nodes(&settings());

    assert_eq!(nodes.len(), 3);
    assert_eq!(nodes[0].stage, PlanStage::StageRoutes);
    assert_eq!(nodes[1].stage, PlanStage::PublishRoutes);
    assert_eq!(nodes[2].stage, PlanStage::ObserveRoutes);
    assert!(nodes[0].side_effects.is_empty());
    assert_eq!(
        nodes[1].side_effects,
        vec![publish_domain::PlanSideEffect::Network]
    );
    assert!(nodes[1].irreversible);
    assert!(!nodes[2].irreversible);
    for node in &nodes {
        assert_eq!(
            node.artifact_inputs,
            vec!["artifact-manifest".to_string()],
            "route nodes consume the sealed manifest"
        );
    }
}

#[test]
fn plan_fragment_requires_a_release_version_input() {
    let fixture = Fixture::new();
    let error = fixture
        .destination
        .plan_fragment(&snapshot_with_release_input(BTreeMap::new()), &settings())
        .expect_err("a release version is a required single-release input");
    assert!(error.to_string().contains("version"));
}

#[test]
fn staging_builds_a_route_owned_envelope_with_a_delivery_record() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let nodes = fixture.nodes(&settings());

    let output = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect("stage the sftp delivery envelope");

    assert_eq!(output.envelopes.len(), 1);
    let envelope = &output.envelopes[0];
    assert_eq!(envelope.route_id, ROUTE_ID);
    assert_eq!(envelope.manifest_digest, manifest.digest);
    assert_eq!(
        envelope
            .content
            .get("remote_directory")
            .and_then(Value::as_str),
        Some("/srv/releases/1.2.3")
    );
    assert_eq!(
        envelope.content.get("target").and_then(Value::as_str),
        Some("sftp://deploy@files.example.com:2022")
    );

    let files = envelope
        .content
        .get("files")
        .and_then(Value::as_array)
        .expect("selected delivery files");
    let names: Vec<&str> = files
        .iter()
        .filter_map(|file| file.get("name").and_then(Value::as_str))
        .collect();
    // 交付记录先行提交，其后只有匹配 artifact_roles 的产物；构建残留不进入
    // 远端路径（角色选择与 ADR-0012 同源）。
    assert_eq!(
        names,
        vec![SFTP_DELIVERY_RECORD_NAME, "Demo.dmg", "Demo.msi"]
    );

    let record = envelope
        .content
        .get("delivery_record")
        .expect("the staged delivery record");
    assert_eq!(
        record.get("manifest_digest").and_then(Value::as_str),
        Some(manifest.digest.as_str())
    );
    let recorded_files = record
        .get("files")
        .and_then(Value::as_object)
        .expect("recorded file digests");
    assert_eq!(recorded_files.len(), 2);
    assert_eq!(
        recorded_files.get("Demo.dmg").and_then(Value::as_str),
        Some(sha256_hex(b"dmg-bytes").as_str())
    );

    // 记录条目自身的摘要与大小指向序列化后的记录字节。
    let record_bytes = serde_json::to_vec_pretty(record).expect("serialize the delivery record");
    assert_eq!(
        files[0].get("digest").and_then(Value::as_str),
        Some(sha256_hex(&record_bytes).as_str())
    );
    assert_eq!(
        files[0].get("size").and_then(Value::as_u64),
        Some(record_bytes.len() as u64)
    );
}

#[test]
fn staging_rejects_routes_without_a_configured_target() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    for (incomplete, field) in [
        (
            settings().with_value("host", Value::String(String::new())),
            "host",
        ),
        (
            settings().with_value("username", Value::String(String::new())),
            "username",
        ),
        (
            settings().with_value("remote_path", Value::String(String::new())),
            "remote_path",
        ),
    ] {
        let nodes = fixture.nodes(&incomplete);
        let error = fixture
            .execute(&nodes[0], &manifest, &[], &[])
            .expect_err("staging requires a fully configured target");
        assert_eq!(
            classified_category(&error),
            PublishFailureCategory::Validation
        );
        assert!(
            error.to_string().contains(field),
            "error must name {field}: {error}"
        );
    }
}

#[test]
fn staging_rejects_versions_that_escape_the_release_directory() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    for version in ["", "1.2.3/../../etc", "a/b", "..", "1.\"2\""] {
        let snapshot = snapshot_with_release_input(BTreeMap::from([(
            "version".to_string(),
            Value::String(version.to_string()),
        )]));
        let result = fixture
            .destination
            .plan_fragment(&snapshot, &settings())
            .and_then(|_| {
                let nodes = fixture.nodes_for(&snapshot, &settings());
                fixture.execute(&nodes[0], &manifest, &[], &[])
            });
        let error = result.expect_err("versions cannot escape the release directory");
        assert!(
            error.to_string().contains("version"),
            "error for {version:?} must mention the version: {error}"
        );
    }
}

#[test]
fn staging_rejects_artifact_names_that_cannot_be_delivered() {
    let fixture = Fixture::new();
    let nodes = fixture.nodes(&settings());

    let nested = manifest_with(
        fixture.root.path(),
        &[("installer", "nested/Demo.dmg", b"dmg-bytes")],
    );
    let error = fixture
        .execute(&nodes[0], &nested, &[], &[])
        .expect_err("artifact names must stay inside the release directory");
    assert_eq!(
        classified_category(&error),
        PublishFailureCategory::Validation
    );

    let reserved = manifest_with(
        fixture.root.path(),
        &[("installer", SFTP_DELIVERY_RECORD_NAME, b"impostor")],
    );
    let error = fixture
        .execute(&nodes[0], &reserved, &[], &[])
        .expect_err("the delivery record name is reserved");
    assert_eq!(
        classified_category(&error),
        PublishFailureCategory::Validation
    );
    assert!(error.to_string().contains(SFTP_DELIVERY_RECORD_NAME));
    // 同名冲突条目在 Manifest 封存时已被域层拒绝，无需路线级分支。
}

#[test]
fn staging_requires_at_least_one_matching_artifact_role() {
    let fixture = Fixture::new();
    let manifest = manifest_with(
        fixture.root.path(),
        &[("build-support", "build-log.txt", b"residue")],
    );
    let nodes = fixture.nodes(&settings());
    let error = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect_err("an empty delivery selection cannot publish");
    assert_eq!(
        classified_category(&error),
        PublishFailureCategory::Validation
    );
}

// ---------------------------------------------------------------------------
// Publish：临时上传、摘要校验、原子提交、断线恢复、复用与冲突
// ---------------------------------------------------------------------------

const RELEASE_DIRECTORY: &str = "srv/releases/1.2.3";
const EXTERNAL_REFERENCE: &str = "sftp://deploy@files.example.com:2022/srv/releases/1.2.3";

fn final_path(name: &str) -> String {
    format!("{RELEASE_DIRECTORY}/{name}")
}

fn temp_path(name: &str) -> String {
    format!(
        "{RELEASE_DIRECTORY}/{name}.{}.part",
        &sha256_hex(b"attempt-sftp")[..16]
    )
}

fn record_bytes(envelope: &DeliveryEnvelope) -> Vec<u8> {
    let record = envelope
        .content
        .get("delivery_record")
        .expect("staged delivery record");
    serde_json::to_vec_pretty(record).expect("serialize the delivery record")
}

/// 预置一份与 envelope 完全一致的完整远端交付。
fn seed_complete_delivery(fixture: &Fixture, envelope: &DeliveryEnvelope) {
    fixture.server.seed_file(
        &final_path(SFTP_DELIVERY_RECORD_NAME),
        &record_bytes(envelope),
    );
    fixture
        .server
        .seed_file(&final_path("Demo.dmg"), b"dmg-bytes");
    fixture
        .server
        .seed_file(&final_path("Demo.msi"), b"msi-bytes");
}

#[test]
fn publishing_uploads_via_temporary_names_and_commits_atomically() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let (_, publish) = fixture.stage_then_publish(&settings(), &manifest);
    let output = publish.expect("publish the sftp delivery");

    // Receipt 记录非秘密目标身份、远端引用、摘要与生命周期。
    assert_eq!(output.receipts.len(), 1);
    let receipt = &output.receipts[0];
    assert_eq!(receipt.status, DeliveryStatus::Submitted);
    assert_eq!(receipt.revision, 1);
    assert_eq!(receipt.manifest_digest, manifest.digest);
    assert_eq!(receipt.external_reference, EXTERNAL_REFERENCE);
    assert_eq!(receipt.route_id, ROUTE_ID);

    // 最终路径只包含交付记录与所选产物；没有 .part 残留。
    assert_eq!(
        fixture.server.paths(),
        vec![
            final_path("Demo.dmg"),
            final_path("Demo.msi"),
            final_path(SFTP_DELIVERY_RECORD_NAME),
        ]
    );
    assert_eq!(
        fixture.server.file(&final_path("Demo.dmg")),
        Some(b"dmg-bytes".to_vec())
    );

    // 每个字节都先写入临时远端名称，摘要校验后才原子改名到最终路径。
    for written in fixture.server.written_paths() {
        assert!(
            written.ends_with(".part"),
            "uploads must target temporary names, wrote {written}"
        );
    }
    let record: Value = serde_json::from_slice(
        &fixture
            .server
            .file(&final_path(SFTP_DELIVERY_RECORD_NAME))
            .expect("committed delivery record"),
    )
    .expect("parse the delivery record");
    assert_eq!(
        record.get("manifest_digest").and_then(Value::as_str),
        Some(manifest.digest.as_str())
    );
}

#[test]
fn publishing_resumes_an_interrupted_delivery_without_reuploading_committed_files() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let nodes = fixture.nodes(&settings());
    let staged = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect("stage envelope");
    let envelope = &staged.envelopes[0];

    // 上一次尝试已提交记录与 Demo.dmg，Demo.msi 只留下部分写入的临时文件。
    fixture.server.seed_file(
        &final_path(SFTP_DELIVERY_RECORD_NAME),
        &record_bytes(envelope),
    );
    fixture
        .server
        .seed_file(&final_path("Demo.dmg"), b"dmg-bytes");
    fixture.server.seed_file(&temp_path("Demo.msi"), b"msi");

    fixture
        .execute(&nodes[1], &manifest, &staged.envelopes, &[])
        .expect("resume the interrupted delivery");

    // 已提交文件原样复用（没有任何新的写入指向它），残损临时文件被替换。
    assert!(fixture
        .server
        .written_paths()
        .iter()
        .all(|path| !path.contains("Demo.dmg")));
    assert_eq!(fixture.server.calls("remove"), 1);
    assert_eq!(
        fixture.server.file(&final_path("Demo.msi")),
        Some(b"msi-bytes".to_vec())
    );
    assert!(fixture.server.file(&temp_path("Demo.msi")).is_none());
}

#[test]
fn publishing_reuses_a_complete_matching_delivery_without_side_effects() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let nodes = fixture.nodes(&settings());
    let staged = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect("stage envelope");
    seed_complete_delivery(&fixture, &staged.envelopes[0]);

    let output = fixture
        .execute(&nodes[1], &manifest, &staged.envelopes, &[])
        .expect("reuse the matching delivery");

    assert_eq!(output.receipts[0].status, DeliveryStatus::Submitted);
    assert!(fixture.server.written_paths().is_empty());
    assert_eq!(fixture.server.calls("rename"), 0);
    assert_eq!(fixture.server.calls("remove"), 0);
}

#[test]
fn publishing_blocks_on_conflicting_remote_files_and_never_overwrites() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    fixture
        .server
        .seed_file(&final_path("Demo.dmg"), b"someone-elses-bytes");

    let (_, publish) = fixture.stage_then_publish(&settings(), &manifest);
    let error = publish.expect_err("conflicting remote content must block");
    assert_eq!(
        classified_category(&error),
        PublishFailureCategory::Conflict
    );
    assert!(error.to_string().contains("Demo.dmg"));
    assert_eq!(
        fixture.server.file(&final_path("Demo.dmg")),
        Some(b"someone-elses-bytes".to_vec())
    );
}

#[test]
fn publishing_blocks_on_a_foreign_delivery_record_before_uploading_artifacts() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    fixture.server.seed_file(
        &final_path(SFTP_DELIVERY_RECORD_NAME),
        b"{\"manifest_digest\":\"another-release\"}",
    );

    let (_, publish) = fixture.stage_then_publish(&settings(), &manifest);
    let error = publish.expect_err("a foreign delivery record must block");
    assert_eq!(
        classified_category(&error),
        PublishFailureCategory::Conflict
    );
    // 记录先行提交：冲突在任何产物字节移动之前被发现。
    assert!(fixture.server.written_paths().is_empty());
    assert!(fixture.server.file(&final_path("Demo.dmg")).is_none());
}

#[test]
fn permission_failures_block_without_automatic_retry() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    fixture.server.deny_writes_under(RELEASE_DIRECTORY);

    let (_, publish) = fixture.stage_then_publish(&settings(), &manifest);
    let error = publish.expect_err("read-only targets must block");
    let category = classified_category(&error);
    assert_eq!(category, PublishFailureCategory::Authorization);
    assert!(!category.allows_automatic_retry());
}

#[test]
fn authentication_failures_block_without_automatic_retry() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    fixture
        .server
        .require_credentials("deploy", "a-different-key");

    let (_, publish) = fixture.stage_then_publish(&settings(), &manifest);
    let error = publish.expect_err("rejected credentials must block");
    let category = classified_category(&error);
    assert_eq!(category, PublishFailureCategory::Authentication);
    assert!(!category.allows_automatic_retry());
}

/// 断线恢复：网络中断分类为 Transient（副作用不确定，retry_safe=false），
/// 留下的部分写入在下一次执行中被清理并重传。
#[test]
fn network_interruptions_stay_transient_and_recover_on_the_next_run() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let nodes = fixture.nodes(&settings());
    let staged = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect("stage envelope");
    fixture.server.fail_next_write_after(3);

    let error = fixture
        .execute(&nodes[1], &manifest, &staged.envelopes, &[])
        .expect_err("the interrupted upload must fail");
    let failure = match &error {
        PublishError::Classified { failure } => failure.clone(),
        other => panic!("expected a classified failure, got {other}"),
    };
    assert_eq!(failure.category, PublishFailureCategory::Transient);
    assert!(!failure.retry_safe);
    assert_eq!(failure.retry_after_seconds, None);
    assert!(failure.category.allows_automatic_retry());

    // 远端留下部分写入的临时记录文件；重试清理后完成交付。
    assert!(fixture
        .server
        .file(&temp_path(SFTP_DELIVERY_RECORD_NAME))
        .is_some());
    fixture
        .execute(&nodes[1], &manifest, &staged.envelopes, &[])
        .expect("recover after the disconnection");
    assert_eq!(
        fixture.server.paths(),
        vec![
            final_path("Demo.dmg"),
            final_path("Demo.msi"),
            final_path(SFTP_DELIVERY_RECORD_NAME),
        ]
    );
}

/// 传输损坏：写入成功但读回摘要不一致时，删除临时文件并按 Transient 重试。
#[test]
fn corrupted_uploads_are_removed_and_stay_retryable() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let nodes = fixture.nodes(&settings());
    let staged = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect("stage envelope");
    fixture.server.corrupt_next_write();

    let error = fixture
        .execute(&nodes[1], &manifest, &staged.envelopes, &[])
        .expect_err("corrupted uploads must not be committed");
    assert_eq!(
        classified_category(&error),
        PublishFailureCategory::Transient
    );
    assert!(fixture
        .server
        .file(&temp_path(SFTP_DELIVERY_RECORD_NAME))
        .is_none());
    assert!(fixture
        .server
        .file(&final_path(SFTP_DELIVERY_RECORD_NAME))
        .is_none());

    fixture
        .execute(&nodes[1], &manifest, &staged.envelopes, &[])
        .expect("retry after the corrupted upload");
}

#[test]
fn transport_failures_map_to_the_closed_failure_classification() {
    use publish_adapters::{classify_sftp_failure, SftpTransportFailure};

    let network = classify_sftp_failure(&SftpTransportFailure::Network {
        message: "connection reset".to_string(),
    });
    assert_eq!(network.category, PublishFailureCategory::Transient);
    assert!(!network.retry_safe);
    assert_eq!(network.retry_after_seconds, None);

    let authentication = classify_sftp_failure(&SftpTransportFailure::Authentication {
        message: "denied".to_string(),
    });
    assert_eq!(
        authentication.category,
        PublishFailureCategory::Authentication
    );
    assert!(authentication.retry_safe);

    let permission = classify_sftp_failure(&SftpTransportFailure::PermissionDenied {
        message: "read only".to_string(),
    });
    assert_eq!(permission.category, PublishFailureCategory::Authorization);

    let protocol = classify_sftp_failure(&SftpTransportFailure::Protocol {
        message: "unexpected".to_string(),
    });
    assert_eq!(protocol.category, PublishFailureCategory::Unknown);
    assert!(!protocol.retry_safe);

    for failure in [&network, &authentication, &permission, &protocol] {
        assert_eq!(
            failure.category.allows_automatic_retry(),
            failure.category == PublishFailureCategory::Transient,
            "only transient sftp failures are retry eligible"
        );
    }
}

#[test]
fn injected_protocol_failures_surface_as_blocking_unknown_errors() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    fixture.server.fail_next(
        publish_adapters::FAKE_SFTP_OPERATION_MKDIR,
        publish_adapters::SftpTransportFailure::Protocol {
            message: "server misbehaved".to_string(),
        },
    );
    let (_, publish) = fixture.stage_then_publish(&settings(), &manifest);
    let error = publish.expect_err("protocol failures must block");
    let category = classified_category(&error);
    assert_eq!(category, PublishFailureCategory::Unknown);
    assert!(!category.allows_automatic_retry());
}

// ---------------------------------------------------------------------------
// 幂等探测与远端观察
// ---------------------------------------------------------------------------

fn probe_identity(manifest_digest: &str) -> DeliveryIdempotencyIdentity {
    DeliveryIdempotencyIdentity {
        attempt_id: "attempt-sftp".to_string(),
        plan_node_id: format!("{ROUTE_ID}.publish"),
        release_identity: ReleaseIdentity::new(
            "fixture-project",
            SourceSnapshot {
                revision: "0123456789abcdef".to_string(),
                workspace_digest: None,
                dirty: false,
                captured_at: "2026-07-26T10:00:00Z".to_string(),
                reproducible: true,
            },
            "1.2.3",
            "stable",
            None,
        ),
        manifest_digest: manifest_digest.to_string(),
        route_id: ROUTE_ID.to_string(),
    }
}

#[test]
fn probing_reports_absent_matching_and_conflicting_remote_state() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let identity = probe_identity(&manifest.digest);

    // 远端没有交付记录：可以安全执行。
    assert_eq!(
        fixture
            .destination
            .probe_delivery(&settings(), &identity, &fixture.credentials)
            .expect("probe the empty target"),
        DeliveryProbe::Absent
    );

    // 我方未完成交付（记录已提交、文件缺失）：安全续传。
    let nodes = fixture.nodes(&settings());
    let staged = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect("stage envelope");
    fixture.server.seed_file(
        &final_path(SFTP_DELIVERY_RECORD_NAME),
        &record_bytes(&staged.envelopes[0]),
    );
    assert_eq!(
        fixture
            .destination
            .probe_delivery(&settings(), &identity, &fixture.credentials)
            .expect("probe the unfinished delivery"),
        DeliveryProbe::Absent
    );

    // 完整且摘要一致：复用既有交付。
    seed_complete_delivery(&fixture, &staged.envelopes[0]);
    assert_eq!(
        fixture
            .destination
            .probe_delivery(&settings(), &identity, &fixture.credentials)
            .expect("probe the complete delivery"),
        DeliveryProbe::Matching {
            external_reference: EXTERNAL_REFERENCE.to_string(),
        }
    );

    // 另一份发布占用同一路径：冲突阻断。
    assert_eq!(
        fixture
            .destination
            .probe_delivery(
                &settings(),
                &probe_identity("another-manifest-digest"),
                &fixture.credentials
            )
            .expect("probe the conflicting delivery"),
        DeliveryProbe::Conflicting {
            external_reference: EXTERNAL_REFERENCE.to_string(),
        }
    );
}

#[test]
fn probing_treats_unreadable_delivery_records_as_conflicts() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    fixture
        .server
        .seed_file(&final_path(SFTP_DELIVERY_RECORD_NAME), b"not json at all");
    assert_eq!(
        fixture
            .destination
            .probe_delivery(
                &settings(),
                &probe_identity(&manifest.digest),
                &fixture.credentials
            )
            .expect("probe the unmanaged directory"),
        DeliveryProbe::Conflicting {
            external_reference: EXTERNAL_REFERENCE.to_string(),
        }
    );
}

#[test]
fn probe_failures_surface_as_classified_errors() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    fixture
        .server
        .require_credentials("deploy", "a-different-key");
    let error = fixture
        .destination
        .probe_delivery(
            &settings(),
            &probe_identity(&manifest.digest),
            &fixture.credentials,
        )
        .expect_err("probing with rejected credentials fails");
    assert_eq!(
        classified_category(&error),
        PublishFailureCategory::Authentication
    );
}

#[test]
fn observation_confirms_published_state_with_a_second_receipt_revision() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let nodes = fixture.nodes(&settings());
    let staged = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect("stage envelope");
    let published = fixture
        .execute(&nodes[1], &manifest, &staged.envelopes, &[])
        .expect("publish the delivery");

    let output = fixture
        .execute(&nodes[2], &manifest, &staged.envelopes, &published.receipts)
        .expect("observe the published delivery");
    assert_eq!(output.receipts.len(), 1);
    let observed = &output.receipts[0];
    assert_eq!(observed.status, DeliveryStatus::Published);
    assert_eq!(observed.revision, 2);
    assert_eq!(observed.receipt_id, published.receipts[0].receipt_id);
    assert_eq!(observed.external_reference, EXTERNAL_REFERENCE);
}

#[test]
fn observation_fails_while_the_remote_delivery_is_incomplete() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let nodes = fixture.nodes(&settings());
    let staged = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect("stage envelope");
    let published = fixture
        .execute(&nodes[1], &manifest, &staged.envelopes, &[])
        .expect("publish the delivery");

    // 远端文件在观察前丢失：交付不可观察为 Published。
    let endpoint = publish_adapters::SftpEndpoint {
        host: "files.example.com".to_string(),
        port: 2022,
        username: "deploy".to_string(),
    };
    let key = CredentialValue::new(KEY_VALUE);
    publish_adapters::SftpTransport::remove(
        fixture.server.as_ref(),
        &key,
        &endpoint,
        &final_path("Demo.msi"),
    )
    .expect("drop a delivered file");

    let error = fixture
        .execute(&nodes[2], &manifest, &staged.envelopes, &published.receipts)
        .expect_err("incomplete deliveries are not observable as published");
    assert_eq!(
        classified_category(&error),
        PublishFailureCategory::Transient
    );

    let error = fixture
        .execute(&nodes[2], &manifest, &staged.envelopes, &[])
        .expect_err("observation requires a submitted receipt");
    assert!(matches!(error, PublishError::Execution(_)));
}

#[test]
fn observation_blocks_when_the_remote_record_conflicts() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let nodes = fixture.nodes(&settings());
    let staged = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect("stage envelope");
    let published = fixture
        .execute(&nodes[1], &manifest, &staged.envelopes, &[])
        .expect("publish the delivery");

    let endpoint = publish_adapters::SftpEndpoint {
        host: "files.example.com".to_string(),
        port: 2022,
        username: "deploy".to_string(),
    };
    let key = CredentialValue::new(KEY_VALUE);
    publish_adapters::SftpTransport::remove(
        fixture.server.as_ref(),
        &key,
        &endpoint,
        &final_path(SFTP_DELIVERY_RECORD_NAME),
    )
    .expect("drop the delivery record");
    fixture.server.seed_file(
        &final_path(SFTP_DELIVERY_RECORD_NAME),
        b"replaced by someone",
    );

    let error = fixture
        .execute(&nodes[2], &manifest, &staged.envelopes, &published.receipts)
        .expect_err("a replaced delivery record cannot be observed as ours");
    assert_eq!(
        classified_category(&error),
        PublishFailureCategory::Conflict
    );
}

// ---------------------------------------------------------------------------
// 秘密红线：私钥只在执行边界存在
// ---------------------------------------------------------------------------

#[test]
fn resolved_secrets_never_reach_envelopes_receipts_events_or_errors() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let (envelopes, publish) = fixture.stage_then_publish(&settings(), &manifest);
    let output = publish.expect("publish the delivery");

    let serialized_envelopes = serde_json::to_string(&envelopes).expect("envelopes serialize");
    assert!(!serialized_envelopes.contains(KEY_VALUE));
    let serialized_receipts = serde_json::to_string(&output.receipts).expect("receipts serialize");
    assert!(!serialized_receipts.contains(KEY_VALUE));

    // 失败路径的错误信息同样不携带秘密。
    let failing = Fixture::new();
    failing.server.require_credentials("deploy", "other-key");
    let (_, denied) = failing.stage_then_publish(&settings(), &manifest);
    let error = denied.expect_err("credentials are rejected");
    assert!(!error.to_string().contains(KEY_VALUE));

    // 私钥只在传输执行边界被观察到。
    assert!(fixture
        .server
        .observed_keys()
        .iter()
        .all(|observed| observed == KEY_VALUE));

    // 注册合规检查把私钥列为禁止值：设置与计划片段都不携带它。
    let mut conformance = AdapterConformanceFixture::new(snapshot());
    conformance.forbidden_values = vec![KEY_VALUE.to_string()];
    let mut registry = AdapterRegistry::new();
    registry
        .register_delivery_destination(
            Arc::new(SftpDeliveryDestination::new(fixture.server.clone())),
            &conformance,
        )
        .expect("the sftp destination carries no secrets in its contract surface");
}
