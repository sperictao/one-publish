//! 进行中构建的取消（ADR-0041）：取消请求必须终止 Provider 构建的整棵进程树，
//! 尝试以 Cancelled 而不是 Failed 结束。
#![cfg(unix)]

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::{Duration, Instant};

use publish_adapters::{
    AdapterConformanceFixture, AdapterRegistry, CancellationSignal, ChecksumProcessor,
    CleanCheckoutGuard, DirectProviderExecutionPort, LocalDirectoryDestination,
    LocalExecutionBackend, ProviderExecution, ProviderExecutionOutcome, ProviderExecutionPort,
    SealedBuildCommand, SelectedProjectProvider, TemporaryArtifactStore, CHECKSUM_PROCESSOR_ID,
    LOCAL_DESTINATION_ID, SELECTED_PROVIDER_ID,
};
use publish_domain::{
    AdapterBinding, AdapterIdentity, AdapterKind, AdapterSelection, AdapterSettings, DeliveryRoute,
    DeliveryStatus, PlanningInputSnapshot, PublishAttemptStatus, PublishError, ReleaseIdentity,
    SourceSnapshot, PLANNING_INPUT_SNAPSHOT_VERSION,
};
use publish_runner_core::{AttemptExecutionContext, PublishRuntime, StartPublishAttempt};
use serde_json::Value;

const SPEC_JSON: &str = "{}";
/// 前台 sleep 响应 SIGINT；非交互 sh 的后台 sleep 忽略 SIGINT，只能被强制终止。
const BUILD_SCRIPT: &str = r#"echo $$ > "$1"; sleep 30 & sleep 30; wait"#;

/// 把遗留规格桥接到 headless 直执行端口：构建是一棵真实的进程树。
struct ShellBuildPort {
    pid_file: PathBuf,
    working_directory: PathBuf,
    output_directory: PathBuf,
}

impl ProviderExecutionPort for ShellBuildPort {
    fn execute_spec(
        &self,
        _spec_json: &str,
        cancellation: &CancellationSignal,
    ) -> Result<ProviderExecutionOutcome, PublishError> {
        self.execute_build(
            SealedBuildCommand {
                provider_id: "shell-build".to_string(),
                program: "sh".to_string(),
                args: vec![
                    "-c".to_string(),
                    BUILD_SCRIPT.to_string(),
                    "build".to_string(),
                    self.pid_file.to_string_lossy().to_string(),
                ],
                working_directory: self.working_directory.clone(),
                output_directory: self.output_directory.clone(),
            },
            cancellation,
        )
    }

    fn execute_build(
        &self,
        request: SealedBuildCommand,
        cancellation: &CancellationSignal,
    ) -> Result<ProviderExecutionOutcome, PublishError> {
        DirectProviderExecutionPort.execute_build(request, cancellation)
    }
}

fn snapshot(store: &Path, delivery: &Path) -> PlanningInputSnapshot {
    let empty = AdapterSettings::new(1);
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
            captured_at: "2026-10-06T10:00:00Z".to_string(),
            reproducible: true,
        },
        external_preconditions: BTreeMap::new(),
        promoted_manifest_digest: None,
        adapters: AdapterSelection {
            project_provider: AdapterBinding::new(
                "project",
                AdapterIdentity::new(AdapterKind::ProjectProvider, SELECTED_PROVIDER_ID, 1),
                AdapterSettings::new(1)
                    .with_value("spec_json", Value::String(SPEC_JSON.to_string())),
            ),
            artifact_processors: vec![AdapterBinding::new(
                "processor",
                AdapterIdentity::new(AdapterKind::ArtifactProcessor, CHECKSUM_PROCESSOR_ID, 1),
                empty.clone(),
            )],
            execution_backend: AdapterBinding::new(
                "backend",
                AdapterIdentity::new(AdapterKind::ExecutionBackend, "local-execution", 1),
                empty,
            ),
            artifact_store: AdapterBinding::new(
                "store",
                AdapterIdentity::new(AdapterKind::ArtifactStore, "temporary-artifact-store", 1),
                AdapterSettings::new(1)
                    .with_value(
                        "root_directory",
                        Value::String(store.to_string_lossy().to_string()),
                    )
                    .with_value("retention_seconds", Value::from(604_800u64)),
            ),
            delivery_routes: vec![DeliveryRoute {
                binding: AdapterBinding::new(
                    "primary",
                    AdapterIdentity::new(AdapterKind::DeliveryDestination, LOCAL_DESTINATION_ID, 1),
                    AdapterSettings::new(1).with_value(
                        "directory",
                        Value::String(delivery.join("primary").to_string_lossy().to_string()),
                    ),
                ),
                required: true,
            }],
        },
    }
}

fn runtime(
    snapshot: &PlanningInputSnapshot,
    port: ShellBuildPort,
    store: &Path,
    delivery: &Path,
) -> PublishRuntime {
    let fixture = AdapterConformanceFixture::new(snapshot.clone());
    let output_directory = port.output_directory.clone();
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(
            Arc::new(SelectedProjectProvider::with_execution(
                SPEC_JSON.to_string(),
                Some(ProviderExecution {
                    port: Arc::new(port),
                    output_directory,
                    artifact_filter: None,
                    clear_stale_artifacts: false,
                    source_guard: Arc::new(CleanCheckoutGuard),
                }),
            )),
            &fixture,
        )
        .expect("register selected provider");
    registry
        .register_artifact_processor(Arc::new(ChecksumProcessor::new()), &fixture)
        .expect("register checksum processor");
    registry
        .register_execution_backend(Arc::new(LocalExecutionBackend::new()), &fixture)
        .expect("register local backend");
    registry
        .register_artifact_store(Arc::new(TemporaryArtifactStore::new(store)), &fixture)
        .expect("register temporary store");
    registry
        .register_delivery_destination(Arc::new(LocalDirectoryDestination::new(delivery)), &fixture)
        .expect("register local directory destination");
    PublishRuntime::new(registry)
}

/// 验收：构建运行中取消，尝试在 10 秒内以 Cancelled 结束，构建的子进程与
/// 孙进程无一存活，且构建节点不被记为失败。
#[test]
fn cancelling_a_running_build_stops_its_process_tree_and_ends_cancelled() {
    let workspace = tempfile::tempdir().expect("create build workspace");
    let store = tempfile::tempdir().expect("create temporary store");
    let delivery = tempfile::tempdir().expect("create delivery parent");
    let pid_file = workspace.path().join("build.pid");
    let snapshot = snapshot(store.path(), delivery.path());
    let runtime = runtime(
        &snapshot,
        ShellBuildPort {
            pid_file: pid_file.clone(),
            working_directory: workspace.path().to_path_buf(),
            output_directory: workspace.path().join("provider-output"),
        },
        store.path(),
        delivery.path(),
    );
    let prepared = runtime.prepare_attempt(&snapshot).expect("prepare attempt");
    let cancellation = CancellationSignal::new();

    let (finished, attempt) = mpsc::channel();
    let started = Instant::now();
    thread::scope(|scope| {
        let context = AttemptExecutionContext::at(100).with_cancellation(cancellation.clone());
        let (runtime, prepared, snapshot) = (&runtime, &prepared, &snapshot);
        scope.spawn(move || {
            let view = runtime.start_attempt(
                prepared,
                StartPublishAttempt::new(
                    "attempt-cancel-running-build",
                    "run-cancel-running-build",
                    ReleaseIdentity::new(
                        "selected:app",
                        snapshot.source.clone(),
                        "1.0.0",
                        "stable",
                        None,
                    ),
                ),
                &context,
            );
            let _ = finished.send(view);
        });

        let leader = wait_for_pid_file(&pid_file);
        let descendants = wait_for_children(leader, 2);
        cancellation.request();

        let view = attempt
            .recv_timeout(Duration::from_secs(10))
            .expect("a cancelled build must end the attempt within 10 s")
            .expect("finish the cancelled attempt");
        assert!(started.elapsed() < Duration::from_secs(10));
        assert_eq!(view.status, PublishAttemptStatus::Cancelled);
        assert!(view.error.is_none(), "{:?}", view.error);
        assert!(view.manifest.is_none());
        assert!(!view
            .events
            .iter()
            .any(|event| event.kind == "plan_node_failed"));
        assert_eq!(view.routes[0].status, DeliveryStatus::Cancelled);
        for pid in std::iter::once(leader).chain(descendants) {
            assert_process_gone(pid);
        }
    });
}

fn wait_for_pid_file(path: &Path) -> u32 {
    for _ in 0..100 {
        if let Some(pid) = std::fs::read_to_string(path)
            .ok()
            .and_then(|contents| contents.trim().parse().ok())
        {
            return pid;
        }
        thread::sleep(Duration::from_millis(50));
    }
    panic!("build did not start");
}

/// 轮询直到 `parent` 派生出至少 `count` 个直接子进程，返回其 PID。
fn wait_for_children(parent: u32, count: usize) -> Vec<u32> {
    for _ in 0..100 {
        let output = Command::new("ps")
            .args(["-A", "-o", "pid=,ppid="])
            .output()
            .expect("list processes");
        let children = String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|line| {
                let mut fields = line.split_whitespace();
                let pid = fields.next()?.parse::<u32>().ok()?;
                let ppid = fields.next()?.parse::<u32>().ok()?;
                (ppid == parent).then_some(pid)
            })
            .collect::<Vec<_>>();
        if children.len() >= count {
            return children;
        }
        thread::sleep(Duration::from_millis(50));
    }
    panic!("build {parent} did not start {count} children");
}

/// 进程已退出（不存在或仅剩待回收的僵尸）；给信号投递留出短暂余量。
fn assert_process_gone(pid: u32) {
    for _ in 0..20 {
        let output = Command::new("ps")
            .args(["-o", "stat=", "-p", &pid.to_string()])
            .output()
            .expect("inspect process");
        let state = String::from_utf8_lossy(&output.stdout);
        if state.trim().is_empty() || state.trim_start().starts_with('Z') {
            return;
        }
        thread::sleep(Duration::from_millis(100));
    }
    panic!("process {pid} survived build cancellation");
}
