//! E2E 真实构建测试的共享基础设施。
//!
//! 提供：
//! - `RealBuildProvider`：将真实工具链命令（cargo / dotnet / go / gradle）
//!   桥接到 Publish Plan 架构的 ProjectProvider 实现
//! - 注册表构建工具
//! - 快照与运行时构造工具
//! - 共享断言工具
//! - 环境检测与跳过工具

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use publish_adapters::{
    AdapterConformanceFixture, AdapterContract, AdapterExecutionContext, AdapterExecutionOutput,
    AdapterRegistry, ChecksumProcessor, LocalDirectoryDestination, LocalExecutionBackend,
    ProjectProvider, StaticCredentialSource, TemporaryArtifactStore,
};
use publish_domain::{
    sha256_hex, AdapterBinding, AdapterDescriptor, AdapterIdentity, AdapterKind, AdapterSchema,
    AdapterSelection, AdapterSettings, ArtifactCandidate, Capability, CapabilityRequirement,
    CredentialKind, DeliveryRoute, DeliveryStatus, PlanNode, PlanNodeTemplate, PlanOperation,
    PlanStage, PlanningInputSnapshot, PublishAttemptStatus, PublishAttemptView, PublishError,
    PublishPlan, PublishingCapability, ReleaseIdentity, SourceSnapshot,
    PLANNING_INPUT_SNAPSHOT_VERSION,
};
use publish_runner_core::{AttemptExecutionContext, PublishRuntime, StartPublishAttempt};
use serde_json::Value;

// ─── 常量 ───

pub const PROVIDER_OUTPUT_ROLE: &str = "provider-output";

// ─── 环境检测 ───

/// 检测工具链是否可用；不可用时返回 false。
pub fn toolchain_available(tool: &str) -> bool {
    std::process::Command::new(tool)
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// 检测 docker 是否可用。
pub fn docker_available() -> bool {
    toolchain_available("docker")
}

/// 检测 gh CLI 是否已认证。
pub fn gh_available() -> bool {
    std::process::Command::new("gh")
        .args(["auth", "status"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

// ─── RealBuildProvider ───

/// 将真实工具链构建命令桥接到 Publish Plan 的 ProjectProvider。
///
/// 与 FakeProjectProvider 的区别：`execute_node` 通过子进程运行真实命令
/// 并从输出目录收集产物字节，而非返回硬编码数据。
pub struct RealBuildProvider {
    descriptor: AdapterDescriptor,
    /// 计划节点使用的程序标识（如 "cargo:build"、"go:build"）。
    program_id: String,
    /// 真实可执行程序名（如 "cargo"、"go"）。
    real_program: String,
    /// 构建参数。
    args: Vec<String>,
    /// 构建工作目录（样本项目根）。
    working_dir: PathBuf,
    /// 构建产物所在目录（collect 从此目录递归收集）。
    output_dir: PathBuf,
    /// 产物分类函数。
    classify: fn(&Path) -> (&'static str, &'static str),
    /// 额外环境变量（如 GOOS / GOARCH）。
    env: BTreeMap<String, String>,
}

impl RealBuildProvider {
    pub fn new(
        provider_id: &str,
        program_id: &str,
        real_program: &str,
        args: Vec<String>,
        working_dir: PathBuf,
        output_dir: PathBuf,
        classify: fn(&Path) -> (&'static str, &'static str),
    ) -> Self {
        let descriptor = AdapterDescriptor::new(
            AdapterKind::ProjectProvider,
            provider_id,
            1,
            AdapterSchema::new(1),
            PublishingCapability {
                provides: vec![Capability::new("artifact-candidate", 1)],
                requires: vec![CapabilityRequirement::exact(
                    "structured-plan-execution",
                    1,
                )],
            },
        )
        .with_allowed_program(program_id);
        Self {
            descriptor,
            program_id: program_id.to_string(),
            real_program: real_program.to_string(),
            args,
            working_dir,
            output_dir,
            classify,
            env: BTreeMap::new(),
        }
    }

    /// 设置额外环境变量。
    pub fn with_env(mut self, key: &str, value: &str) -> Self {
        self.env.insert(key.to_string(), value.to_string());
        self
    }
}

impl AdapterContract for RealBuildProvider {
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
        Ok(vec![PlanNodeTemplate::command(
            "build",
            PlanStage::Build,
            &self.program_id,
            self.args.clone(),
        )
        .with_artifact_io(Vec::new(), vec!["provider-output:*".to_string()])
        .with_side_effects(vec![publish_domain::PlanSideEffect::FileSystem])])
    }

    fn execute_node(
        &self,
        node: &PlanNode,
        _context: &AdapterExecutionContext<'_>,
    ) -> Result<AdapterExecutionOutput, PublishError> {
        // 校验节点操作匹配密封计划
        match &node.operation {
            PlanOperation::RunProgram { program, args, .. }
                if program == &self.program_id && args == &self.args => {}
            _ => {
                return Err(PublishError::Execution(format!(
                    "node {} does not match the sealed build command",
                    node.id
                )))
            }
        }

        // 运行真实构建命令
        let mut command = std::process::Command::new(&self.real_program);
        command.args(&self.args).current_dir(&self.working_dir);
        for (key, value) in &self.env {
            command.env(key, value);
        }
        let status = command
            .status()
            .map_err(|e| {
                PublishError::Execution(format!(
                    "failed to run {real_program}: {e}",
                    real_program = self.real_program
                ))
            })?;

        if !status.success() {
            return Err(PublishError::Execution(format!(
                "{real_program} exited with {status}",
                real_program = self.real_program
            )));
        }

        // 从输出目录收集产物
        let artifacts = collect_artifacts(&self.output_dir, self.classify)?;

        Ok(AdapterExecutionOutput {
            artifacts,
            ..AdapterExecutionOutput::default()
        })
    }
}

impl ProjectProvider for RealBuildProvider {}

// ─── 产物收集 ───

/// 从目录递归收集所有文件为 ArtifactCandidate。
/// 与 bridge.rs 的 collect_artifacts_with 同构，但位于测试侧。
pub fn collect_artifacts(
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
                operation: format!(
                    "read provider output directory {}",
                    directory.display()
                ),
                message: error.to_string(),
            })?;
            for entry in entries {
                let entry = entry.map_err(|error| PublishError::Io {
                    operation: format!(
                        "read provider output entry in {}",
                        directory.display()
                    ),
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

// ─── 产物分类函数 ───

/// 通用分类：所有产物归为 provider-output。
pub fn classify_generic(_relative: &Path) -> (&'static str, &'static str) {
    (PROVIDER_OUTPUT_ROLE, "application/octet-stream")
}

/// Cargo 产物分类：二进制归 build-support，其余归 provider-output。
pub fn classify_cargo(relative: &Path) -> (&'static str, &'static str) {
    let name = relative.file_name().and_then(|n| n.to_str()).unwrap_or("");
    // 跳过非最终产物
    if name.ends_with(".d") || name.ends_with(".rlib") || name.ends_with(".rmeta") {
        return ("build-support", "application/octet-stream");
    }
    if relative
        .components()
        .any(|c| c.as_os_str() == "deps" || c.as_os_str() == "build" || c.as_os_str() == "examples"
            || c.as_os_str() == "incremental")
    {
        return ("build-support", "application/octet-stream");
    }
    ("build-output", "application/octet-stream")
}

/// Dotnet 产物分类。
pub fn classify_dotnet(relative: &Path) -> (&'static str, &'static str) {
    let name = relative.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if name.ends_with(".dll") {
        return ("build-output", "application/octet-stream");
    }
    if name.ends_with(".json") {
        return ("build-config", "application/json");
    }
    ("build-support", "application/octet-stream")
}

/// Go 产物分类。
pub fn classify_go(_relative: &Path) -> (&'static str, &'static str) {
    ("build-output", "application/octet-stream")
}

/// Java 产物分类：JAR 归 build-output。
pub fn classify_java(relative: &Path) -> (&'static str, &'static str) {
    let name = relative.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if name.ends_with(".jar") {
        return ("build-output", "application/java-archive");
    }
    ("build-support", "application/octet-stream")
}

/// Tauri 产物分类：安装包归 installer，更新签名归 updater-signature。
pub fn classify_tauri(relative: &Path) -> (&'static str, &'static str) {
    let name = relative.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if name.ends_with(".dmg")
        || name.ends_with(".msi")
        || name.ends_with(".AppImage")
        || name.ends_with(".deb")
        || name.ends_with(".rpm")
    {
        return ("installer", "application/octet-stream");
    }
    if name.ends_with(".sig") {
        return ("updater-signature", "application/octet-stream");
    }
    if name.ends_with(".app.tar.gz")
        || name.ends_with(".nsis.zip")
        || name.ends_with(".msi.zip")
    {
        return ("updater-archive", "application/octet-stream");
    }
    ("build-support", "application/octet-stream")
}

// ─── 注册表与运行时构建 ───

/// 构建一个标准本地运行时注册表：LocalExecutionBackend + TemporaryArtifactStore +
/// LocalDirectoryDestination + ChecksumProcessor + 指定的 ProjectProvider。
pub fn build_local_registry(
    provider: Arc<RealBuildProvider>,
    store_dir: &Path,
    delivery_dir: &Path,
    snapshot: &PlanningInputSnapshot,
) -> AdapterRegistry {
    let fixture = AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(provider, &fixture)
        .expect("register real provider");
    registry
        .register_artifact_processor(Arc::new(ChecksumProcessor::new()), &fixture)
        .expect("register checksum processor");
    registry
        .register_execution_backend(
            Arc::new(LocalExecutionBackend::with_credential_source(Arc::new(
                StaticCredentialSource::new(),
            ))),
            &fixture,
        )
        .expect("register local backend");
    registry
        .register_artifact_store(
            Arc::new(TemporaryArtifactStore::new(store_dir)),
            &fixture,
        )
        .expect("register temporary store");
    registry
        .register_delivery_destination(
            Arc::new(LocalDirectoryDestination::new(delivery_dir)),
            &fixture,
        )
        .expect("register local directory destination");
    registry
}

/// 构建一个包含 SFTP 交付目标的注册表。
#[cfg(feature = "e2e-real-sftp")]
pub fn build_registry_with_sftp(
    provider: Arc<RealBuildProvider>,
    store_dir: &Path,
    delivery_dir: &Path,
    sftp: Arc<publish_adapters::FakeSftpServer>,
    snapshot: &PlanningInputSnapshot,
) -> AdapterRegistry {
    use publish_adapters::SftpDeliveryDestination;

    let fixture = AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = build_local_registry(provider, store_dir, delivery_dir, snapshot);
    registry
        .register_delivery_destination(Arc::new(SftpDeliveryDestination::new(sftp)), &fixture)
        .expect("register sftp destination");
    registry
}

// ─── 快照构造 ───

/// 构建一个标准的 PlanningInputSnapshot。
pub fn build_snapshot(
    provider_id: &str,
    store_dir: &Path,
    delivery_dir: &Path,
    version: &str,
) -> PlanningInputSnapshot {
    PlanningInputSnapshot {
        version: PLANNING_INPUT_SNAPSHOT_VERSION,
        configuration_revision: "config-revision-1".to_string(),
        runtime_revision: "runner-1".to_string(),
        release_input: BTreeMap::from([(
            "version".to_string(),
            Value::String(version.to_string()),
        )]),
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
                AdapterIdentity::new(AdapterKind::ProjectProvider, provider_id, 1),
                AdapterSettings::new(1),
            ),
            artifact_processors: vec![AdapterBinding::new(
                "checksums",
                AdapterIdentity::new(AdapterKind::ArtifactProcessor, "checksum", 1),
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
                        Value::String(store_dir.to_string_lossy().to_string()),
                    )
                    .with_value("retention_seconds", Value::from(604_800u64)),
            ),
            delivery_routes: vec![DeliveryRoute::required(AdapterBinding::new(
                "local-route",
                AdapterIdentity::new(AdapterKind::DeliveryDestination, "local-directory", 1),
                AdapterSettings::new(1).with_value(
                    "directory",
                    Value::String(delivery_dir.to_string_lossy().to_string()),
                ),
            ))],
        },
    }
}

/// 构建一个不包含 Checksum 处理器的快照。
pub fn build_snapshot_no_checksum(
    provider_id: &str,
    store_dir: &Path,
    delivery_dir: &Path,
    version: &str,
) -> PlanningInputSnapshot {
    let mut snapshot = build_snapshot(provider_id, store_dir, delivery_dir, version);
    snapshot.adapters.artifact_processors = Vec::new();
    snapshot
}

// ─── 执行与断言 ───

/// 执行一次完整的发布尝试并返回结果。
pub fn run_publish(
    runtime: &PublishRuntime,
    snapshot: &PlanningInputSnapshot,
    candidate_identity: &str,
    version: &str,
    attempt_id: &str,
) -> PublishAttemptView {
    let prepared = runtime
        .prepare_attempt(snapshot)
        .expect("prepare publish attempt");

    runtime
        .start_attempt(
            &prepared,
            StartPublishAttempt::new(
                attempt_id.to_string(),
                format!("local-run-{attempt_id}"),
                ReleaseIdentity::new(
                    candidate_identity.to_string(),
                    snapshot.source.clone(),
                    version.to_string(),
                    "stable",
                    None,
                ),
            ),
            &AttemptExecutionContext::at(0),
        )
        .expect("start publish attempt")
}

/// 断言发布尝试成功且所有必需路线已 Published。
pub fn assert_published(
    attempt: &PublishAttemptView,
) -> &publish_domain::ArtifactManifest {
    assert_eq!(
        attempt.status,
        PublishAttemptStatus::Published,
        "attempt should be Published, got {:?}",
        attempt.status
    );
    let manifest = attempt
        .manifest
        .as_ref()
        .expect("sealed artifact manifest should exist");
    assert!(
        !manifest.artifacts.is_empty(),
        "manifest should contain at least one artifact"
    );
    for receipt in &attempt.receipts {
        assert_eq!(
            receipt.status,
            DeliveryStatus::Published,
            "route {} should be Published, got {:?}",
            receipt.route_id,
            receipt.status
        );
    }
    manifest
}

/// 断言交付目录中存在指定文件。
pub fn assert_delivered_file(receipt: &publish_domain::DeliveryReceipt, file_name: &str) {
    let dir = Path::new(receipt.external_reference.as_str());
    let path = dir.join(file_name);
    assert!(
        path.exists(),
        "delivered file {file_name} should exist at {}",
        path.display()
    );
}

/// 断言产物角色集合包含预期角色。
pub fn assert_manifest_has_role(
    manifest: &publish_domain::ArtifactManifest,
    role: &str,
) {
    assert!(
        manifest.artifacts.iter().any(|a| a.role == role),
        "manifest should contain artifact with role '{role}', found roles: {:?}",
        manifest
            .artifacts
            .iter()
            .map(|a| a.role.as_str())
            .collect::<Vec<_>>()
    );
}

// ─── 样本项目路径 ───

/// 返回样本项目根目录。
pub fn samples_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("samples")
}

/// 返回指定样本项目的路径。
pub fn sample_path(name: &str) -> PathBuf {
    samples_dir().join(name)
}
