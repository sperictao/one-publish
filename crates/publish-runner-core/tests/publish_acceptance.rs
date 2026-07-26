//! Issue T20 验收：以一条完整用户场景验收通用发布平台——同一 Tauri
//! Artifact Manifest 从一次构建投递到本地目录、GitHub Release 与 SFTP，
//! 经历部分失败、控制面重启、安全续传、并行租约协调与 Artifact Promotion
//! （ADR-0022/0038/0040/0041/0042/0051/0055/0057）。
//!
//! GitHub 与 SFTP 使用受控边界（FakeGitHubReleaseApi、FakeSftpServer），
//! 不创建真实生产 Release；Tauri 构建经受控执行端口运行密封计划节点，
//! 与生产桌面 shell 的执行端口角色一致（计划合同全部来自内置 Tauri Provider）。

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use publish_adapters::{
    AdapterConformanceFixture, AdapterContract, AdapterExecutionContext, AdapterExecutionOutput,
    AdapterRegistry, ChecksumProcessor, FakeGitHubReleaseApi, FakeSftpServer,
    GitHubReleaseDestination, LocalDirectoryDestination, LocalExecutionBackend, ProjectProvider,
    SftpDeliveryDestination, StaticCredentialSource, TauriBuildDriver, TauriProjectProvider,
    TemporaryArtifactStore, CHECKSUM_MANIFEST_ROLE, CHECKSUM_PROCESSOR_ID, TAURI_INSPECT_ACTION,
    TAURI_PROVIDER_ID,
};
use publish_domain::{
    sha256_hex, AdapterBinding, AdapterIdentity, AdapterKind, AdapterSelection, AdapterSettings,
    ArtifactCandidate, ArtifactManifest, CredentialKind, DeliveryRoute, DeliveryStatus, PlanNode,
    PlanOperation, PlanStage, PlanningInputSnapshot, ProjectCandidate, PublishAttemptStatus,
    PublishError, PublishEvent, PublishFailureCategory, PublishResource, PublishResourceKind,
    PublishResourceLease, ReleaseAttempt, ReleaseIdentity, SourceSnapshot,
    PLANNING_INPUT_SNAPSHOT_VERSION,
};
use publish_runner_core::{
    recover_attempt_view, AttemptExecutionContext, PreparedPublishPlan, PublishLeaseCoordinator,
    PublishRuntime, StartPublishAttempt,
};
use serde_json::Value;

const INSTALLER_ROLE: &str = "installer";
const INSTALLER_FILE_NAME: &str = "Demo_1.0.0_aarch64.dmg";
const INSTALLER_BYTES: &[u8] = b"one-publish t20 controlled tauri installer\n";
const CONFIG_PATH: &str = "src-tauri/tauri.conf.json";
const GITHUB_TOKEN_REFERENCE: &str = "release-github-token";
const GITHUB_TOKEN_VALUE: &str = "ghp_t20-acceptance-token";
const SFTP_KEY_REFERENCE: &str = "release-server-key";
const SFTP_KEY_VALUE: &str =
    "-----BEGIN OPENSSH PRIVATE KEY-----\nt20-key\n-----END OPENSSH PRIVATE KEY-----";

/// 受控 Tauri 执行端口：发现、检查、版本语义与计划合同全部委托内置
/// TauriProjectProvider；只有密封构建节点的进程执行被替换为确定性产物，
/// 并统计构建次数——多路线、续传与 Promotion 必须复用同一次构建（ADR-0022）。
struct ControlledTauriProvider {
    provider: TauriProjectProvider,
    repository_root: PathBuf,
    builds: Arc<AtomicUsize>,
}

impl ControlledTauriProvider {
    fn new(repository_root: impl Into<PathBuf>, builds: Arc<AtomicUsize>) -> Self {
        Self {
            provider: TauriProjectProvider::new(),
            repository_root: repository_root.into(),
            builds,
        }
    }
}

impl AdapterContract for ControlledTauriProvider {
    fn descriptor(&self) -> &publish_domain::AdapterDescriptor {
        self.provider.descriptor()
    }

    fn default_settings(&self) -> AdapterSettings {
        self.provider.default_settings()
    }

    fn validate_settings(&self, settings: &AdapterSettings) -> Result<(), PublishError> {
        self.provider.validate_settings(settings)
    }

    fn plan_fragment(
        &self,
        snapshot: &PlanningInputSnapshot,
        settings: &AdapterSettings,
    ) -> Result<Vec<publish_domain::PlanNodeTemplate>, PublishError> {
        self.provider.plan_fragment(snapshot, settings)
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
                        "tauri build driver drifted from {build_driver} to {}",
                        inspection.build_driver.name()
                    )));
                }
                Ok(AdapterExecutionOutput::default())
            }
            PlanOperation::RunProgram { program, args, .. } => {
                let driver = TauriBuildDriver::parse(build_driver).ok_or_else(|| {
                    PublishError::Execution(format!("unknown tauri build driver {build_driver}"))
                })?;
                if *program != driver.program_id()
                    || *args != driver.build_command_args(config_path)
                {
                    return Err(PublishError::InvalidPlan(format!(
                        "node {} is not the sealed tauri build operation",
                        node.id
                    )));
                }
                self.builds.fetch_add(1, Ordering::SeqCst);
                Ok(AdapterExecutionOutput {
                    artifacts: vec![ArtifactCandidate::new(
                        INSTALLER_ROLE,
                        INSTALLER_FILE_NAME,
                        "application/x-apple-diskimage",
                        "macos",
                        "aarch64",
                        INSTALLER_BYTES.to_vec(),
                    )],
                    ..AdapterExecutionOutput::default()
                })
            }
            _ => Err(PublishError::Execution(format!(
                "node {} is not a tauri provider operation",
                node.id
            ))),
        }
    }
}

impl ProjectProvider for ControlledTauriProvider {
    fn discover_candidates(
        &self,
        repository_root: &Path,
    ) -> Result<Vec<ProjectCandidate>, PublishError> {
        self.provider.discover_candidates(repository_root)
    }
}

/// 场景共享环境：Tauri 仓库、产物存储、本地交付目录与受控 GitHub、SFTP
/// 边界在"控制面进程"之间持续存在；每次 control_plane 调用都构建全新的
/// 注册表与 Runtime，模拟一次控制面启动。
struct AcceptanceHarness {
    repository: tempfile::TempDir,
    store: tempfile::TempDir,
    local_delivery: tempfile::TempDir,
    github: Arc<FakeGitHubReleaseApi>,
    sftp: Arc<FakeSftpServer>,
    builds: Arc<AtomicUsize>,
    snapshot: PlanningInputSnapshot,
}

fn write_file(path: &Path, content: &str) {
    fs::create_dir_all(path.parent().expect("file parent")).expect("create parent directory");
    fs::write(path, content).expect("write file");
}

impl AcceptanceHarness {
    fn new() -> Self {
        let repository = tempfile::tempdir().expect("create tauri repository");
        write_file(
            &repository.path().join(CONFIG_PATH),
            r#"{"productName":"Demo","version":"1.0.0"}"#,
        );
        write_file(
            &repository.path().join("package.json"),
            r#"{"packageManager":"pnpm@10.0.0","version":"1.0.0"}"#,
        );
        write_file(&repository.path().join("pnpm-lock.yaml"), "");
        write_file(
            &repository.path().join("src-tauri/Cargo.toml"),
            "[package]\nname = \"demo\"\nversion = \"1.0.0\"\n",
        );
        let store = tempfile::tempdir().expect("create artifact store root");
        let local_delivery = tempfile::tempdir().expect("create local delivery root");
        let harness = Self {
            snapshot: base_snapshot(store.path(), local_delivery.path()),
            repository,
            store,
            local_delivery,
            github: Arc::new(FakeGitHubReleaseApi::new()),
            sftp: Arc::new(FakeSftpServer::new()),
            builds: Arc::new(AtomicUsize::new(0)),
        };
        harness.sftp.require_credentials("deploy", SFTP_KEY_VALUE);
        harness
    }

    /// 启动一个控制面进程：注册表按当前快照重新组装，租约权威由调用方
    /// 注入（重启场景用 PublishLeaseCoordinator::restore 的恢复结果）。
    fn control_plane(&self, leases: Arc<PublishLeaseCoordinator>) -> PublishRuntime {
        let fixture = AdapterConformanceFixture::new(self.snapshot.clone());
        let mut registry = AdapterRegistry::new();
        registry
            .register_project_provider(
                Arc::new(ControlledTauriProvider::new(
                    self.repository.path(),
                    Arc::clone(&self.builds),
                )),
                &fixture,
            )
            .expect("register controlled tauri provider");
        registry
            .register_artifact_processor(Arc::new(ChecksumProcessor::new()), &fixture)
            .expect("register checksum processor");
        registry
            .register_execution_backend(
                Arc::new(LocalExecutionBackend::with_credential_source(Arc::new(
                    StaticCredentialSource::new()
                        .with_secret(
                            GITHUB_TOKEN_REFERENCE,
                            CredentialKind::Token,
                            GITHUB_TOKEN_VALUE,
                        )
                        .with_secret(
                            SFTP_KEY_REFERENCE,
                            CredentialKind::SshPrivateKey,
                            SFTP_KEY_VALUE,
                        ),
                ))),
                &fixture,
            )
            .expect("register local execution backend");
        registry
            .register_artifact_store(
                Arc::new(TemporaryArtifactStore::new(self.store.path())),
                &fixture,
            )
            .expect("register temporary artifact store");
        registry
            .register_delivery_destination(
                Arc::new(LocalDirectoryDestination::new(self.local_delivery.path())),
                &fixture,
            )
            .expect("register local directory destination");
        registry
            .register_delivery_destination(
                Arc::new(GitHubReleaseDestination::new(self.github.clone())),
                &fixture,
            )
            .expect("register github release destination");
        registry
            .register_delivery_destination(
                Arc::new(SftpDeliveryDestination::new(self.sftp.clone())),
                &fixture,
            )
            .expect("register sftp destination");
        PublishRuntime::with_lease_coordinator(registry, leases)
    }

    fn release_identity(&self, version: &str, channel: &str) -> ReleaseIdentity {
        ReleaseIdentity::new(
            format!("{TAURI_PROVIDER_ID}:{CONFIG_PATH}"),
            self.snapshot.source.clone(),
            version,
            channel,
            None,
        )
    }

    /// 同一配置的 Nightly 发布输入：版本、GitHub 标签与 SFTP 路径都进入
    /// 独立命名空间，与 Stable 尝试的资源不相交。
    fn nightly_snapshot(&self) -> PlanningInputSnapshot {
        let mut snapshot = self.snapshot.clone();
        snapshot.release_input.insert(
            "version".to_string(),
            Value::String("1.0.0-nightly.20260726".to_string()),
        );
        snapshot
            .release_input
            .insert("channel".to_string(), Value::String("nightly".to_string()));
        snapshot
    }

    /// Promotion 快照：绑定既有 Manifest 摘要，三条路线全部进入新的
    /// 交付命名空间（新本地目录、promoted 标签前缀、新 SFTP 路径）。
    fn promotion_snapshot(&self, manifest_digest: &str) -> PlanningInputSnapshot {
        let mut snapshot = self.snapshot.clone();
        snapshot.promoted_manifest_digest = Some(manifest_digest.to_string());
        snapshot
            .release_input
            .insert("channel".to_string(), Value::String("promoted".to_string()));
        snapshot.adapters.delivery_routes = vec![
            local_route("local-route", &self.local_delivery.path().join("promoted")),
            github_route("github-route", "promoted-v"),
            sftp_route("sftp-route", "/srv/promoted"),
        ];
        snapshot
    }
}

fn local_route(route_id: &str, directory: &Path) -> DeliveryRoute {
    DeliveryRoute::required(AdapterBinding::new(
        route_id,
        AdapterIdentity::new(AdapterKind::DeliveryDestination, "local-directory", 1),
        AdapterSettings::new(1).with_value(
            "directory",
            Value::String(directory.to_string_lossy().to_string()),
        ),
    ))
}

fn github_route(route_id: &str, tag_prefix: &str) -> DeliveryRoute {
    DeliveryRoute::required(
        AdapterBinding::new(
            route_id,
            AdapterIdentity::new(AdapterKind::DeliveryDestination, "github-release", 1),
            AdapterSettings::new(1)
                .with_value("repository", Value::String("acme/demo".to_string()))
                .with_value("visibility", Value::String("public".to_string()))
                .with_value("tag_prefix", Value::String(tag_prefix.to_string()))
                .with_value(
                    "allowed_asset_roles",
                    Value::Array(vec![
                        Value::String(INSTALLER_ROLE.to_string()),
                        Value::String(CHECKSUM_MANIFEST_ROLE.to_string()),
                    ]),
                )
                .with_value("updater_enabled", Value::Bool(false))
                .with_value(
                    "enabled_platforms",
                    Value::Array(vec![Value::String("macos-aarch64".to_string())]),
                )
                .with_value("unsigned_release_override", Value::Bool(false)),
        )
        .with_credential("github_token", GITHUB_TOKEN_REFERENCE),
    )
}

fn sftp_route(route_id: &str, remote_path: &str) -> DeliveryRoute {
    DeliveryRoute::required(
        AdapterBinding::new(
            route_id,
            AdapterIdentity::new(AdapterKind::DeliveryDestination, "sftp", 1),
            AdapterSettings::new(1)
                .with_value("host", Value::String("files.example.com".to_string()))
                .with_value("port", Value::from(22u64))
                .with_value("username", Value::String("deploy".to_string()))
                .with_value("remote_path", Value::String(remote_path.to_string()))
                .with_value(
                    "artifact_roles",
                    Value::Array(vec![
                        Value::String(INSTALLER_ROLE.to_string()),
                        Value::String(CHECKSUM_MANIFEST_ROLE.to_string()),
                    ]),
                ),
        )
        .with_credential("ssh_private_key", SFTP_KEY_REFERENCE),
    )
}

fn base_snapshot(store_root: &Path, local_delivery_root: &Path) -> PlanningInputSnapshot {
    PlanningInputSnapshot {
        version: PLANNING_INPUT_SNAPSHOT_VERSION,
        configuration_revision: "configuration-revision-1".to_string(),
        runtime_revision: "runtime-revision-1".to_string(),
        release_input: BTreeMap::from([
            ("version".to_string(), Value::String("1.0.0".to_string())),
            (
                "platform_code_signing".to_string(),
                Value::String("signed".to_string()),
            ),
        ]),
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
                AdapterIdentity::new(AdapterKind::ProjectProvider, TAURI_PROVIDER_ID, 1),
                AdapterSettings::new(1)
                    .with_value("config_path", Value::String(CONFIG_PATH.to_string()))
                    .with_value("build_driver", Value::String("pnpm".to_string())),
            ),
            artifact_processors: vec![AdapterBinding::new(
                "checksums",
                AdapterIdentity::new(AdapterKind::ArtifactProcessor, CHECKSUM_PROCESSOR_ID, 1),
                AdapterSettings::new(1),
            )],
            execution_backend: AdapterBinding::new(
                "backend",
                AdapterIdentity::new(AdapterKind::ExecutionBackend, "local-execution", 1),
                AdapterSettings::new(1),
            ),
            artifact_store: AdapterBinding::new(
                "store",
                AdapterIdentity::new(AdapterKind::ArtifactStore, "temporary-artifact-store", 1),
                AdapterSettings::new(1)
                    .with_value(
                        "root_directory",
                        Value::String(store_root.to_string_lossy().to_string()),
                    )
                    .with_value("retention_seconds", Value::from(604_800u64)),
            ),
            delivery_routes: vec![
                local_route("local-route", &local_delivery_root.join("stable")),
                github_route("github-route", "v"),
                sftp_route("sftp-route", "/srv/releases"),
            ],
        },
    }
}

fn start_attempt(
    runtime: &PublishRuntime,
    harness: &AcceptanceHarness,
    snapshot: &PlanningInputSnapshot,
    attempt_id: &str,
    version: &str,
    channel: &str,
    now_seconds: u64,
) -> (PreparedPublishPlan, publish_domain::PublishAttemptView) {
    let prepared = runtime
        .prepare_attempt(snapshot)
        .expect("prepare publish attempt");
    let view = runtime
        .start_attempt(
            &prepared,
            StartPublishAttempt::new(
                attempt_id,
                format!("run-{attempt_id}"),
                harness.release_identity(version, channel),
            ),
            &AttemptExecutionContext::at(now_seconds),
        )
        .expect("start publish attempt");
    (prepared, view)
}

fn route_view<'a>(
    view: &'a publish_domain::PublishAttemptView,
    route_id: &str,
) -> &'a publish_domain::RouteDeliveryView {
    view.routes
        .iter()
        .find(|route| route.route_id == route_id)
        .unwrap_or_else(|| panic!("route {route_id} is missing from the attempt view"))
}

/// Stable 尝试声明的租约资源：仓库写、发布命名空间、产物身份与目标命名空间。
fn stable_resources() -> BTreeSet<PublishResource> {
    BTreeSet::from([
        PublishResource::new(PublishResourceKind::RepositoryWrite, "acme/demo"),
        PublishResource::new(PublishResourceKind::ReleaseNamespace, "demo/stable/1.0.0"),
        PublishResource::new(
            PublishResourceKind::DestinationNamespace,
            "github:acme/demo:v1.0.0",
        ),
        PublishResource::new(
            PublishResourceKind::DestinationNamespace,
            "sftp:files.example.com:/srv/releases/1.0.0",
        ),
    ])
}

/// 验收标准 1：一次 Tauri 构建和 Processor 管道只生成一个封存 Manifest，
/// 本地目录、GitHub Release 与 SFTP 三条 Route 消费相同摘要与相同字节。
#[test]
fn one_tauri_build_and_processor_pipeline_seal_one_manifest_for_three_routes() {
    let harness = AcceptanceHarness::new();
    let runtime = harness.control_plane(Arc::new(PublishLeaseCoordinator::new()));
    let (_, view) = start_attempt(
        &runtime,
        &harness,
        &harness.snapshot,
        "attempt-stable",
        "1.0.0",
        "stable",
        0,
    );

    assert_eq!(view.status, PublishAttemptStatus::Published);
    assert!(view.warnings.is_empty());
    assert_eq!(harness.builds.load(Ordering::SeqCst), 1);

    // 一个封存 Manifest：构建产物加处理器派生的校验和清单。
    let manifest = view.manifest.as_ref().expect("sealed artifact manifest");
    let roles = manifest
        .artifacts
        .iter()
        .map(|entry| entry.role.as_str())
        .collect::<Vec<_>>();
    assert_eq!(roles, vec![INSTALLER_ROLE, CHECKSUM_MANIFEST_ROLE]);
    let installer = &manifest.artifacts[0];
    assert_eq!(installer.file_name, INSTALLER_FILE_NAME);
    assert_eq!(installer.digest, sha256_hex(INSTALLER_BYTES));

    // 三条 Route 各交出 Published Receipt，且全部绑定同一 Manifest 摘要。
    assert_eq!(view.receipts.len(), 3);
    for route_id in ["local-route", "github-route", "sftp-route"] {
        let receipt = view
            .receipts
            .iter()
            .find(|receipt| receipt.route_id == route_id)
            .unwrap_or_else(|| panic!("route {route_id} has no delivery receipt"));
        assert_eq!(receipt.status, DeliveryStatus::Published);
        assert_eq!(receipt.manifest_digest, manifest.digest);
    }

    // 本地目录收到与封存产物一致的字节。
    let local = route_view(&view, "local-route");
    let delivered_root = PathBuf::from(
        local
            .external_reference
            .as_ref()
            .expect("local delivery reference"),
    );
    assert_eq!(
        fs::read(delivered_root.join(INSTALLER_FILE_NAME)).expect("read delivered installer"),
        INSTALLER_BYTES
    );
    let checksums =
        fs::read_to_string(delivered_root.join("SHA256SUMS")).expect("read delivered checksums");
    assert!(checksums.contains(INSTALLER_FILE_NAME));

    // GitHub Release 已发布且资产摘要与 Manifest 一致（受控边界，无真实 Release）。
    let release = harness.github.release("v1.0.0").expect("github release");
    assert!(!release.draft);
    assert!(!release.prerelease);
    let uploaded = release
        .assets
        .iter()
        .find(|asset| asset.name == INSTALLER_FILE_NAME)
        .expect("uploaded installer asset");
    assert_eq!(uploaded.digest, installer.digest);
    assert!(release
        .assets
        .iter()
        .any(|asset| asset.name == "SHA256SUMS"));

    // SFTP 收到相同字节并完成原子改名（无 .part 残留）。
    assert_eq!(
        harness
            .sftp
            .file(&format!("srv/releases/1.0.0/{INSTALLER_FILE_NAME}")),
        Some(INSTALLER_BYTES.to_vec())
    );
    assert!(harness
        .sftp
        .paths()
        .iter()
        .all(|path| !path.ends_with(".part")));

    // 事件与 Receipt 证据不携带任何已解析的凭据值（ADR-0029）。
    let events = serde_json::to_string(&view.events).expect("serialize events");
    assert!(!events.contains(GITHUB_TOKEN_VALUE));
    assert!(!events.contains(SFTP_KEY_VALUE));
}

/// 验收标准 2：注入一个 Required Route 失败后，尝试状态是 Partial
/// Delivery；其他已发布 Route 的交付与外部状态保持不变（ADR-0022/0041）。
#[test]
fn an_injected_required_route_failure_is_partial_delivery_with_published_routes_untouched() {
    let harness = AcceptanceHarness::new();
    let runtime = harness.control_plane(Arc::new(PublishLeaseCoordinator::new()));
    // 传输中断使 SFTP 在部分写入后失败，分类为 Transient（ADR-0056）。
    harness.sftp.fail_next_write_after(3);

    let (_, view) = start_attempt(
        &runtime,
        &harness,
        &harness.snapshot,
        "attempt-partial",
        "1.0.0",
        "stable",
        0,
    );

    assert_eq!(view.status, PublishAttemptStatus::PartialDelivery);
    let sftp = route_view(&view, "sftp-route");
    assert_eq!(
        sftp.failure.as_ref().expect("classified failure").category,
        PublishFailureCategory::Transient
    );

    // 已发布路线保持 Published；GitHub Release 与本地目录的真实副作用不被抹去。
    assert_eq!(
        route_view(&view, "local-route").status,
        DeliveryStatus::Published
    );
    assert_eq!(
        route_view(&view, "github-route").status,
        DeliveryStatus::Published
    );
    let release = harness.github.release("v1.0.0").expect("github release");
    assert!(!release.draft);
    assert_eq!(harness.github.calls("publish_release"), 1);
    assert_eq!(harness.builds.load(Ordering::SeqCst), 1);
}

/// 控制面重启的持久化状态：Attempt 记录、事件历史、封存 Manifest 与
/// 租约记录都经 JSON 往返，模拟真实的进程退出与重启（ADR-0057）。
struct PersistedControlPlaneState {
    attempt: String,
    events: String,
    manifest: String,
    leases: String,
}

fn persist_control_plane_state(
    view: &publish_domain::PublishAttemptView,
    coordinator: &PublishLeaseCoordinator,
) -> PersistedControlPlaneState {
    PersistedControlPlaneState {
        attempt: serde_json::to_string(&view.attempt).expect("serialize attempt"),
        events: serde_json::to_string(&view.events).expect("serialize events"),
        manifest: serde_json::to_string(view.manifest.as_ref().expect("sealed manifest"))
            .expect("serialize manifest"),
        leases: serde_json::to_string(&coordinator.leases()).expect("serialize leases"),
    }
}

/// 验收标准 3：控制面重启后凭持久化记录恢复同一 Attempt（身份稳定，
/// ADR-0040），随后只安全重试失败 Route——构建、封存与已发布路线一律
/// 不再执行（ADR-0051）。
#[test]
fn a_control_plane_restart_recovers_the_attempt_and_safely_retries_only_the_failed_route() {
    let harness = AcceptanceHarness::new();
    let first_leases = Arc::new(PublishLeaseCoordinator::new());
    let first_process = harness.control_plane(Arc::clone(&first_leases));
    first_leases
        .acquire("attempt-restart", stable_resources(), 100, 600)
        .expect("acquire the stable lease");
    harness.sftp.fail_next_write_after(3);

    let (first_prepared, view) = start_attempt(
        &first_process,
        &harness,
        &harness.snapshot,
        "attempt-restart",
        "1.0.0",
        "stable",
        150,
    );
    assert_eq!(view.status, PublishAttemptStatus::PartialDelivery);
    let github_uploads_before_restart = harness.github.calls("upload_asset");

    // 进程退出：全部控制面状态只以持久化的 JSON 记录存在。
    let persisted = persist_control_plane_state(&view, &first_leases);
    drop(first_process);
    drop(first_leases);

    // 重启：恢复租约权威与事件账本，重建同一 Attempt 的视图。
    let restored_leases: Vec<PublishResourceLease> =
        serde_json::from_str(&persisted.leases).expect("restore lease records");
    let coordinator =
        Arc::new(PublishLeaseCoordinator::restore(restored_leases).expect("restore coordinator"));
    let second_process = harness.control_plane(Arc::clone(&coordinator));

    let attempt: ReleaseAttempt =
        serde_json::from_str(&persisted.attempt).expect("restore attempt record");
    let events: Vec<PublishEvent> =
        serde_json::from_str(&persisted.events).expect("restore event history");
    let second_prepared = second_process
        .prepare_attempt(&harness.snapshot)
        .expect("re-prepare the deterministic plan");
    // 确定性计划让重启后的进程得到同一份密封合同（ADR-0050）。
    assert_eq!(second_prepared.plan.digest, first_prepared.plan.digest);

    let mut recovered = recover_attempt_view(&attempt, &second_prepared.plan.routes, &events)
        .expect("recover the attempt view");
    assert_eq!(recovered.status, PublishAttemptStatus::PartialDelivery);
    assert_eq!(recovered.attempt.attempt_id, "attempt-restart");

    // Manifest 本体不随事件传输：从持久化副本恢复并重新验证摘要绑定（ADR-0057）。
    let manifest: ArtifactManifest =
        serde_json::from_str(&persisted.manifest).expect("restore sealed manifest");
    manifest.validate().expect("re-verify the manifest digest");
    assert_eq!(
        recovered.attempt.manifest_digest.as_deref(),
        Some(manifest.digest.as_str())
    );
    recovered.manifest = Some(manifest);

    // 原租约在停机期间过期；重启后同一 owner 依崩溃恢复规则重新取得（ADR-0042）。
    let now_after_restart = 900;
    coordinator
        .acquire(
            "attempt-restart",
            stable_resources(),
            now_after_restart,
            600,
        )
        .expect("the owner recovers its expired lease after restart");

    let resumed = second_process
        .resume_attempt(
            &second_prepared,
            &recovered,
            &AttemptExecutionContext::at(now_after_restart),
        )
        .expect("resume the failed route");
    assert_eq!(resumed.status, PublishAttemptStatus::Published);
    assert_eq!(resumed.attempt.attempt_id, "attempt-restart");

    // 只有失败的 SFTP 路线被重试：构建次数与 GitHub 侧调用都保持不变。
    assert_eq!(harness.builds.load(Ordering::SeqCst), 1);
    assert_eq!(
        harness.github.calls("upload_asset"),
        github_uploads_before_restart
    );
    assert_eq!(harness.github.calls("publish_release"), 1);
    assert_eq!(
        harness
            .sftp
            .file(&format!("srv/releases/1.0.0/{INSTALLER_FILE_NAME}")),
        Some(INSTALLER_BYTES.to_vec())
    );
    coordinator
        .release("attempt-restart")
        .expect("release the lease after completion");
}

/// 验收标准 4：资源不冲突的另一个 Attempt 与 Stable 尝试真正并发执行并
/// 各自完成，冲突资源的第三个 Attempt 被租约明确阻断（ADR-0042）。
#[test]
fn a_disjoint_attempt_runs_in_parallel_while_conflicting_resources_are_lease_blocked() {
    let harness = AcceptanceHarness::new();
    let coordinator = Arc::new(PublishLeaseCoordinator::new());
    let runtime = harness.control_plane(Arc::clone(&coordinator));

    coordinator
        .acquire("attempt-stable", stable_resources(), 100, 600)
        .expect("stable attempt acquires its lease");

    // Nightly 的发布命名空间、GitHub 标签与 SFTP 路径全部不相交：并行取得租约。
    let nightly_resources = BTreeSet::from([
        PublishResource::new(
            PublishResourceKind::ReleaseNamespace,
            "demo/nightly/1.0.0-nightly.20260726",
        ),
        PublishResource::new(
            PublishResourceKind::DestinationNamespace,
            "github:acme/demo:v1.0.0-nightly.20260726",
        ),
        PublishResource::new(
            PublishResourceKind::DestinationNamespace,
            "sftp:files.example.com:/srv/releases/1.0.0-nightly.20260726",
        ),
    ]);
    coordinator
        .acquire("attempt-nightly", nightly_resources, 120, 600)
        .expect("disjoint nightly attempt acquires concurrently");

    // 两个尝试在同一控制面上真正并发执行；共享的资源租约互不阻断。
    let nightly_snapshot = harness.nightly_snapshot();
    let (stable, nightly) = std::thread::scope(|scope| {
        let stable_task = scope.spawn(|| {
            start_attempt(
                &runtime,
                &harness,
                &harness.snapshot,
                "attempt-stable",
                "1.0.0",
                "stable",
                150,
            )
        });
        let nightly_task = scope.spawn(|| {
            start_attempt(
                &runtime,
                &harness,
                &nightly_snapshot,
                "attempt-nightly",
                "1.0.0-nightly.20260726",
                "nightly",
                150,
            )
        });
        (
            stable_task.join().expect("stable attempt thread").1,
            nightly_task.join().expect("nightly attempt thread").1,
        )
    });

    assert_eq!(stable.status, PublishAttemptStatus::Published);
    assert_eq!(nightly.status, PublishAttemptStatus::Published);
    let nightly_release = harness
        .github
        .release("v1.0.0-nightly.20260726")
        .expect("nightly github release");
    assert!(nightly_release.prerelease);
    // 每个尝试构建一次：并发不共享构建，也不重复构建。
    assert_eq!(harness.builds.load(Ordering::SeqCst), 2);

    // 争用 Stable 发布命名空间的第三个尝试被明确阻断，错误指名持有者与资源。
    let conflicting = BTreeSet::from([PublishResource::new(
        PublishResourceKind::ReleaseNamespace,
        "demo/stable/1.0.0",
    )]);
    let error = coordinator
        .acquire("attempt-conflicting", conflicting, 260, 600)
        .expect_err("conflicting resources are blocked");
    match error {
        PublishError::LeaseResourceConflict {
            requester, holder, ..
        } => {
            assert_eq!(requester, "attempt-conflicting");
            assert_eq!(holder, "attempt-stable");
        }
        other => panic!("expected a lease resource conflict, got {other}"),
    }

    coordinator
        .release("attempt-stable")
        .expect("release stable");
    coordinator
        .release("attempt-nightly")
        .expect("release nightly");
}

/// 验收标准 5：Promotion 创建新 Attempt 与新 Release Identity，绑定既有
/// Manifest 并把相同字节交付到新的路线命名空间；构建调用次数为零
/// （ADR-0038/0040）。
#[test]
fn promotion_reuses_the_original_manifest_with_a_new_attempt_identity_and_zero_builds() {
    let harness = AcceptanceHarness::new();
    let runtime = harness.control_plane(Arc::new(PublishLeaseCoordinator::new()));
    let (_, build_view) = start_attempt(
        &runtime,
        &harness,
        &harness.snapshot,
        "attempt-build",
        "1.0.0",
        "stable",
        0,
    );
    let sealed = build_view.manifest.as_ref().expect("sealed manifest");
    let builds_after_build = harness.builds.load(Ordering::SeqCst);
    assert_eq!(builds_after_build, 1);

    // Promotion 快照绑定既有摘要；Provider 构建与处理器不进入计划（ADR-0040）。
    let promotion_snapshot = harness.promotion_snapshot(&sealed.digest);
    let prepared = runtime
        .prepare_attempt(&promotion_snapshot)
        .expect("prepare the promotion attempt");
    assert!(prepared
        .plan
        .nodes
        .iter()
        .all(|node| node.stage != PlanStage::Build));

    let promoted = runtime
        .start_attempt(
            &prepared,
            StartPublishAttempt::new(
                "attempt-promotion",
                "run-attempt-promotion",
                harness.release_identity("1.0.0", "promoted"),
            ),
            &AttemptExecutionContext::at(300),
        )
        .expect("start the promotion attempt");

    assert_eq!(promoted.status, PublishAttemptStatus::Published);
    // 新 Attempt 与新 Release Identity；Manifest 摘要与原尝试完全一致。
    assert_ne!(promoted.attempt.attempt_id, build_view.attempt.attempt_id);
    assert_ne!(
        promoted.attempt.release_identity,
        build_view.attempt.release_identity
    );
    assert_eq!(promoted.attempt.release_identity.channel, "promoted");
    let promoted_manifest = promoted.manifest.as_ref().expect("promoted manifest");
    assert_eq!(promoted_manifest.digest, sealed.digest);
    // 构建调用次数为零：计数与构建尝试后完全相同。
    assert_eq!(harness.builds.load(Ordering::SeqCst), builds_after_build);

    // 三条新路线收到与原始构建相同的字节。
    let promoted_release = harness
        .github
        .release("promoted-v1.0.0")
        .expect("promoted github release");
    let promoted_asset = promoted_release
        .assets
        .iter()
        .find(|asset| asset.name == INSTALLER_FILE_NAME)
        .expect("promoted installer asset");
    assert_eq!(promoted_asset.digest, sha256_hex(INSTALLER_BYTES));
    assert_eq!(
        harness
            .sftp
            .file(&format!("srv/promoted/1.0.0/{INSTALLER_FILE_NAME}")),
        Some(INSTALLER_BYTES.to_vec())
    );
    let local = route_view(&promoted, "local-route");
    let delivered_root = PathBuf::from(
        local
            .external_reference
            .as_ref()
            .expect("promoted local delivery reference"),
    );
    assert_eq!(
        fs::read(delivered_root.join(INSTALLER_FILE_NAME)).expect("read promoted installer"),
        INSTALLER_BYTES
    );
    // 原始 Stable 交付保持不变：Promotion 不触碰既有发布。
    assert!(harness.github.release("v1.0.0").is_some());
}
