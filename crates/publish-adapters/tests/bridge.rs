//! SelectedProjectProvider 执行桥的错误契约：密封节点形态校验、结果合同
//! （取消/失败/输出目录一致性）与产物收集的文件系统守卫都必须显式分类，
//! 不得被吞成泛型失败。

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use publish_adapters::{
    AdapterContract, AdapterExecutionContext, CancellationSignal, CleanCheckoutGuard,
    DirectProviderExecutionPort, ProviderExecution, ProviderExecutionOutcome,
    ProviderExecutionPort, SealedBuildCommand, SelectedProjectProvider, SELECTED_PROVIDER_ID,
    SELECTED_PROVIDER_PROGRAM,
};
use publish_domain::{
    AdapterBinding, AdapterIdentity, AdapterKind, AdapterSelection, AdapterSettings, DeliveryRoute,
    PlanNode, PlanNodePlatform, PlanOperation, PlanStage, PlanningInputSnapshot, PublishError,
    SourceSnapshot, PLANNING_INPUT_SNAPSHOT_VERSION,
};
use serde_json::Value;

const SPEC: &str = "{\"provider\":\"fixture\"}";

struct StubPort {
    spec_result: Result<ProviderExecutionOutcome, PublishError>,
}

impl ProviderExecutionPort for StubPort {
    fn execute_spec(
        &self,
        _spec_json: &str,
        _cancellation: &CancellationSignal,
    ) -> Result<ProviderExecutionOutcome, PublishError> {
        self.spec_result.clone()
    }

    fn execute_build(
        &self,
        _request: SealedBuildCommand,
        _cancellation: &CancellationSignal,
    ) -> Result<ProviderExecutionOutcome, PublishError> {
        unreachable!("the legacy spec bridge never issues structured builds")
    }
}

fn stub_port(outcome: ProviderExecutionOutcome) -> Arc<dyn ProviderExecutionPort> {
    Arc::new(StubPort {
        spec_result: Ok(outcome),
    })
}

fn failing_port(error: PublishError) -> Arc<dyn ProviderExecutionPort> {
    Arc::new(StubPort {
        spec_result: Err(error),
    })
}

fn sealed_node(settings: AdapterSettings) -> PlanNode {
    PlanNode {
        id: "project.build".to_string(),
        stage: PlanStage::Build,
        adapter: AdapterIdentity::new(AdapterKind::ProjectProvider, SELECTED_PROVIDER_ID, 1),
        binding_id: "project".to_string(),
        settings,
        operation: PlanOperation::RunProgram {
            program: SELECTED_PROVIDER_PROGRAM.to_string(),
            args: Vec::new(),
            working_directory: None,
            environment_references: BTreeMap::new(),
        },
        depends_on: Vec::new(),
        artifact_inputs: Vec::new(),
        artifact_outputs: vec!["provider-output:*".to_string()],
        side_effects: Vec::new(),
        cancellable: true,
        cleanup_owned_staging: false,
        irreversible: false,
        platform: PlanNodePlatform::Any,
    }
}

fn spec_settings(spec: &str) -> AdapterSettings {
    AdapterSettings::new(1).with_value("spec_json", Value::String(spec.to_string()))
}

fn execution(output_directory: PathBuf, port: Arc<dyn ProviderExecutionPort>) -> ProviderExecution {
    ProviderExecution {
        port,
        output_directory,
        artifact_filter: None,
        clear_stale_artifacts: false,
        source_guard: Arc::new(CleanCheckoutGuard),
    }
}

fn execute(provider: &SelectedProjectProvider, node: &PlanNode) -> Result<(), PublishError> {
    let credentials = BTreeMap::new();
    let context = AdapterExecutionContext {
        attempt_id: "attempt-bridge",
        plan_digest: "plan-digest",
        snapshot_digest: "snapshot-digest",
        artifacts: &[],
        manifest: None,
        envelopes: &[],
        receipts: &[],
        credentials: &credentials,
        cancellation: CancellationSignal::new(),
    };
    provider.execute_node(node, &context).map(|_| ())
}

fn fixture_snapshot() -> PlanningInputSnapshot {
    let empty = AdapterSettings::new(1);
    PlanningInputSnapshot {
        version: PLANNING_INPUT_SNAPSHOT_VERSION,
        configuration_revision: "revision-1".to_string(),
        runtime_revision: "runner-1".to_string(),
        release_input: BTreeMap::new(),
        source: SourceSnapshot {
            revision: "0123456789abcdef".to_string(),
            workspace_digest: None,
            dirty: false,
            captured_at: "2026-07-24T10:00:00Z".to_string(),
            reproducible: true,
        },
        external_preconditions: BTreeMap::new(),
        promoted_manifest_digest: None,
        adapters: AdapterSelection {
            project_provider: AdapterBinding::new(
                "project",
                AdapterIdentity::new(AdapterKind::ProjectProvider, SELECTED_PROVIDER_ID, 1),
                empty.clone(),
            ),
            artifact_processors: vec![],
            execution_backend: AdapterBinding::new(
                "backend",
                AdapterIdentity::new(AdapterKind::ExecutionBackend, "backend", 1),
                empty.clone(),
            ),
            artifact_store: AdapterBinding::new(
                "store",
                AdapterIdentity::new(AdapterKind::ArtifactStore, "store", 1),
                empty.clone(),
            ),
            delivery_routes: vec![DeliveryRoute::required(AdapterBinding::new(
                "destination",
                AdapterIdentity::new(AdapterKind::DeliveryDestination, "destination", 1),
                empty,
            ))],
        },
    }
}

#[test]
fn plan_fragment_requires_the_sealed_spec_setting() {
    let provider = SelectedProjectProvider::with_execution(SPEC.to_string(), None);
    let snapshot = fixture_snapshot();

    let error = provider
        .plan_fragment(&snapshot, &AdapterSettings::new(1))
        .expect_err("a settings revision without spec_json cannot plan");
    assert!(matches!(error, PublishError::InvalidAdapterSettings { .. }));
}

#[test]
fn execute_node_rejects_operations_that_are_not_the_sealed_command() {
    let provider = SelectedProjectProvider::with_execution(SPEC.to_string(), None);
    let mut node = sealed_node(spec_settings(SPEC));
    node.operation = PlanOperation::AdapterAction {
        action: "inspect".to_string(),
        inputs: BTreeMap::new(),
    };

    let error = execute(&provider, &node).expect_err("adapter actions are not the sealed command");
    assert!(matches!(error, PublishError::Execution(_)));

    node = sealed_node(spec_settings(SPEC));
    node.operation = PlanOperation::RunProgram {
        program: SELECTED_PROVIDER_PROGRAM.to_string(),
        args: vec!["--extra".to_string()],
        working_directory: None,
        environment_references: BTreeMap::new(),
    };

    let error =
        execute(&provider, &node).expect_err("injected args deviate from the sealed operation");
    assert!(matches!(error, PublishError::Execution(_)));
}

#[test]
fn execute_node_requires_the_planned_spec_setting() {
    let provider = SelectedProjectProvider::with_execution(SPEC.to_string(), None);
    let node = sealed_node(AdapterSettings::new(1));

    let error =
        execute(&provider, &node).expect_err("a node without spec_json cannot replay the spec");
    assert!(matches!(error, PublishError::InvalidAdapterSettings { .. }));
}

#[test]
fn execute_node_rejects_a_node_whose_sealed_spec_drifted() {
    let provider = SelectedProjectProvider::with_execution(SPEC.to_string(), None);
    let node = sealed_node(spec_settings("{\"provider\":\"drifted\"}"));

    // 计划内 spec 与运行时注入 spec 不一致：计划已陈旧，InvalidPlan 强制重新 prepare。
    let error = execute(&provider, &node).expect_err("spec drift must invalidate the plan");
    assert!(matches!(error, PublishError::InvalidPlan(_)));
}

#[test]
fn execute_node_requires_an_execution_port() {
    let provider = SelectedProjectProvider::with_execution(SPEC.to_string(), None);
    let node = sealed_node(spec_settings(SPEC));

    let error = execute(&provider, &node).expect_err("planning-only runtimes cannot execute");
    assert!(matches!(error, PublishError::Execution(_)));
}

#[test]
fn execute_node_maps_port_errors_to_execution() {
    let temp = tempfile::tempdir().expect("temp output");
    let provider = SelectedProjectProvider::with_execution(
        SPEC.to_string(),
        Some(execution(
            temp.path().to_path_buf(),
            failing_port(PublishError::Execution("port exploded".to_string())),
        )),
    );
    let node = sealed_node(spec_settings(SPEC));

    let error = execute(&provider, &node).expect_err("port failures surface as execution errors");
    match error {
        PublishError::Execution(message) => assert!(message.contains("port exploded")),
        other => panic!("expected Execution, got {other:?}"),
    }
}

#[test]
fn execute_node_reports_cancelled_outcomes_as_cancellation() {
    let temp = tempfile::tempdir().expect("temp output");
    let output = temp.path().join("out");
    let provider = SelectedProjectProvider::with_execution(
        SPEC.to_string(),
        Some(execution(
            output.clone(),
            stub_port(ProviderExecutionOutcome {
                success: false,
                cancelled: true,
                error: None,
                output_dir: output.to_string_lossy().to_string(),
            }),
        )),
    );
    let node = sealed_node(spec_settings(SPEC));

    // 取消是结果而非失败：运行核心据此把节点记为 cancelled（ADR-0041）。
    let error = execute(&provider, &node).expect_err("cancelled builds report Cancelled");
    assert!(matches!(error, PublishError::Cancelled(_)));
}

#[test]
fn execute_node_reports_failed_outcomes_as_execution_errors() {
    let temp = tempfile::tempdir().expect("temp output");
    let output = temp.path().join("out");
    let provider = SelectedProjectProvider::with_execution(
        SPEC.to_string(),
        Some(execution(
            output.clone(),
            stub_port(ProviderExecutionOutcome {
                success: false,
                cancelled: false,
                error: None,
                output_dir: output.to_string_lossy().to_string(),
            }),
        )),
    );
    let node = sealed_node(spec_settings(SPEC));

    let error = execute(&provider, &node).expect_err("failed builds are execution errors");
    match error {
        PublishError::Execution(message) => {
            assert!(message.contains("provider execution failed"))
        }
        other => panic!("expected Execution, got {other:?}"),
    }
}

#[test]
fn execute_node_rejects_an_outcome_pointing_at_a_different_output() {
    let temp = tempfile::tempdir().expect("temp output");
    let expected = temp.path().join("declared");
    let provider = SelectedProjectProvider::with_execution(
        SPEC.to_string(),
        Some(execution(
            expected,
            stub_port(ProviderExecutionOutcome {
                success: true,
                cancelled: false,
                error: None,
                output_dir: temp.path().join("elsewhere").to_string_lossy().to_string(),
            }),
        )),
    );
    let node = sealed_node(spec_settings(SPEC));

    let error = execute(&provider, &node)
        .expect_err("artifacts outside the declared output directory are refused");
    match error {
        PublishError::Execution(message) => assert!(message.contains("expected")),
        other => panic!("expected Execution, got {other:?}"),
    }
}

#[test]
fn execute_node_reports_a_missing_output_directory() {
    let temp = tempfile::tempdir().expect("temp output");
    let output = temp.path().join("never-created");
    let provider = SelectedProjectProvider::with_execution(
        SPEC.to_string(),
        Some(execution(
            output.clone(),
            stub_port(ProviderExecutionOutcome {
                success: true,
                cancelled: false,
                error: None,
                output_dir: output.to_string_lossy().to_string(),
            }),
        )),
    );
    let node = sealed_node(spec_settings(SPEC));

    let error = execute(&provider, &node)
        .expect_err("a build that left no output directory is an I/O error");
    assert!(matches!(error, PublishError::Io { .. }));
}

#[cfg(unix)]
#[test]
fn execute_node_rejects_a_symlinked_output_root() {
    use std::os::unix::fs::symlink;

    let temp = tempfile::tempdir().expect("temp output");
    let real = temp.path().join("real");
    fs::create_dir_all(&real).expect("create real output");
    fs::write(real.join("app.bin"), b"binary").expect("write artifact");
    let link = temp.path().join("linked");
    symlink(&real, &link).expect("link the output directory");

    let provider = SelectedProjectProvider::with_execution(
        SPEC.to_string(),
        Some(execution(
            link.clone(),
            stub_port(ProviderExecutionOutcome {
                success: true,
                cancelled: false,
                error: None,
                output_dir: link.to_string_lossy().to_string(),
            }),
        )),
    );
    let node = sealed_node(spec_settings(SPEC));

    let error = execute(&provider, &node)
        .expect_err("symlinked outputs escape the artifact trust boundary");
    match error {
        PublishError::Execution(message) => assert!(message.contains("symbolic link")),
        other => panic!("expected Execution, got {other:?}"),
    }
}

#[cfg(unix)]
#[test]
fn execute_node_rejects_symlinks_inside_the_output_tree() {
    use std::os::unix::fs::symlink;

    let temp = tempfile::tempdir().expect("temp output");
    let output = temp.path().join("out");
    fs::create_dir_all(&output).expect("create output");
    fs::write(output.join("app.bin"), b"binary").expect("write artifact");
    fs::write(temp.path().join("payload"), b"outside").expect("write outside file");
    symlink(temp.path().join("payload"), output.join("link")).expect("plant symlink");

    let provider = SelectedProjectProvider::with_execution(
        SPEC.to_string(),
        Some(execution(
            output.clone(),
            stub_port(ProviderExecutionOutcome {
                success: true,
                cancelled: false,
                error: None,
                output_dir: output.to_string_lossy().to_string(),
            }),
        )),
    );
    let node = sealed_node(spec_settings(SPEC));

    let error = execute(&provider, &node)
        .expect_err("symlinked entries could smuggle files from outside the output");
    match error {
        PublishError::Execution(message) => assert!(message.contains("symbolic links")),
        other => panic!("expected Execution, got {other:?}"),
    }
}

#[test]
fn execute_node_collects_a_single_file_output_root() {
    // Provider 的原生输出可以是单文件（例如单个 dmg）：清单以父目录为根收集。
    let temp = tempfile::tempdir().expect("temp output");
    let output = temp.path().join("app.dmg");
    fs::write(&output, b"dmg bytes").expect("write single-file output");

    let provider = SelectedProjectProvider::with_execution(
        SPEC.to_string(),
        Some(execution(
            output.clone(),
            stub_port(ProviderExecutionOutcome {
                success: true,
                cancelled: false,
                error: None,
                output_dir: output.to_string_lossy().to_string(),
            }),
        )),
    );
    let node = sealed_node(spec_settings(SPEC));

    let credentials = BTreeMap::new();
    let context = AdapterExecutionContext {
        attempt_id: "attempt-bridge",
        plan_digest: "plan-digest",
        snapshot_digest: "snapshot-digest",
        artifacts: &[],
        manifest: None,
        envelopes: &[],
        receipts: &[],
        credentials: &credentials,
        cancellation: CancellationSignal::new(),
    };
    let result = provider
        .execute_node(&node, &context)
        .expect("single-file outputs collect one artifact");
    assert_eq!(result.artifacts.len(), 1);
    assert_eq!(result.artifacts[0].file_name, "app.dmg");
}

#[test]
fn stale_cleanup_falls_through_without_a_filter_or_a_missing_directory() {
    let temp = tempfile::tempdir().expect("temp output");
    let output = temp.path().join("absent");

    // 无筛选：clear_stale_artifacts 提前返回，端口错误照常到达执行层。
    let mut setup = execution(
        output.clone(),
        stub_port(ProviderExecutionOutcome {
            success: true,
            cancelled: false,
            error: None,
            output_dir: "mismatch".to_string(),
        }),
    );
    setup.clear_stale_artifacts = true;
    let provider = SelectedProjectProvider::with_execution(SPEC.to_string(), Some(setup));
    let node = sealed_node(spec_settings(SPEC));
    let error =
        execute(&provider, &node).expect_err("cleanup without a filter must not eat the outcome");
    match error {
        PublishError::Execution(message) => assert!(message.contains("expected")),
        other => panic!("expected Execution, got {other:?}"),
    }

    // 有筛选但输出目录不存在：清理安全跳过，产物收集报 I/O 而非清理失败。
    let mut setup = execution(
        output,
        stub_port(ProviderExecutionOutcome {
            success: true,
            cancelled: false,
            error: None,
            output_dir: "mismatch".to_string(),
        }),
    );
    setup.clear_stale_artifacts = true;
    setup.artifact_filter = Some(|entry| entry.file_name() == "stale.jar");
    let provider = SelectedProjectProvider::with_execution(SPEC.to_string(), Some(setup));
    let error =
        execute(&provider, &node).expect_err("cleanup on a missing directory must not fail early");
    match error {
        PublishError::Execution(message) => assert!(message.contains("expected")),
        other => panic!("expected Execution, got {other:?}"),
    }
}

#[test]
fn direct_execution_reports_spawn_failures() {
    let temp = tempfile::tempdir().expect("temp workspace");
    let error = DirectProviderExecutionPort
        .execute_build(
            SealedBuildCommand {
                provider_id: "fixture-provider".to_string(),
                program: "one-publish-no-such-program".to_string(),
                args: Vec::new(),
                working_directory: temp.path().to_path_buf(),
                output_directory: temp.path().join("out"),
            },
            &CancellationSignal::new(),
        )
        .expect_err("an unspawnable program is a port error, not a panic");
    match error {
        PublishError::Execution(message) => {
            assert!(message.contains("failed to run sealed build"))
        }
        other => panic!("expected Execution, got {other:?}"),
    }
}

#[test]
fn output_paths_inside_the_root_are_accepted() {
    // 防回归：合法嵌套产物照常收集且路径用正斜杠进入清单。
    let temp = tempfile::tempdir().expect("temp output");
    let output = temp.path().join("out");
    fs::create_dir_all(output.join("nested")).expect("create nested output");
    fs::write(output.join("nested").join("app.jar"), b"jar").expect("write artifact");

    let provider = SelectedProjectProvider::with_execution(
        SPEC.to_string(),
        Some(execution(
            output.clone(),
            stub_port(ProviderExecutionOutcome {
                success: true,
                cancelled: false,
                error: None,
                output_dir: output.to_string_lossy().to_string(),
            }),
        )),
    );
    let node = sealed_node(spec_settings(SPEC));

    let credentials = BTreeMap::new();
    let context = AdapterExecutionContext {
        attempt_id: "attempt-bridge",
        plan_digest: "plan-digest",
        snapshot_digest: "snapshot-digest",
        artifacts: &[],
        manifest: None,
        envelopes: &[],
        receipts: &[],
        credentials: &credentials,
        cancellation: CancellationSignal::new(),
    };
    let result = provider
        .execute_node(&node, &context)
        .expect("nested artifacts collect normally");
    assert_eq!(result.artifacts.len(), 1);
    assert_eq!(result.artifacts[0].file_name, "nested/app.jar");
}
