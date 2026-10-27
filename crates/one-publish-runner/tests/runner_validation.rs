//! 独立 runner 的密封守卫：投影、预备尝试与本机运行时修订的逐项校验
//! 必须显式分类——损坏的分发产物不得静默进入执行面。

use std::collections::BTreeMap;

use one_publish_runner::{
    current_runtime_revision, installed_registry, validate_prepared_attempt, validate_projection,
    verify_installed_projection, PreparedAttempt, RunnerPorts, RunnerProjection, StandaloneRunner,
    RUNNER_PROJECTION_VERSION,
};
use publish_domain::{
    AdapterBinding, AdapterIdentity, AdapterKind, AdapterSelection, AdapterSettings,
    AutomationRuntimeRevision, AutomationTriggerPolicy, DeliveryRoute, PlanningInputSnapshot,
    PublishError, RuntimeComponentRevision, SourceSnapshot, PLANNING_INPUT_SNAPSHOT_VERSION,
};
use serde_json::Value;

fn fixture_snapshot(store_directory: &str, delivery_directory: &str) -> PlanningInputSnapshot {
    let empty = AdapterSettings::new(1);
    PlanningInputSnapshot {
        version: PLANNING_INPUT_SNAPSHOT_VERSION,
        configuration_revision: "configuration-revision-1".to_string(),
        runtime_revision: String::new(),
        release_input: BTreeMap::from([(
            "version".to_string(),
            Value::String("1.0.0".to_string()),
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
                AdapterIdentity::new(AdapterKind::ProjectProvider, "tauri", 1),
                empty
                    .clone()
                    .with_value(
                        "config_path",
                        Value::String("src-tauri/tauri.conf.json".to_string()),
                    )
                    .with_value("build_driver", Value::String("cargo".to_string())),
            ),
            artifact_processors: vec![AdapterBinding::new(
                "processor",
                AdapterIdentity::new(AdapterKind::ArtifactProcessor, "checksum", 1),
                empty.clone(),
            )],
            execution_backend: AdapterBinding::new(
                "backend",
                AdapterIdentity::new(AdapterKind::ExecutionBackend, "local-execution", 1),
                empty.clone(),
            ),
            artifact_store: AdapterBinding::new(
                "store",
                AdapterIdentity::new(AdapterKind::ArtifactStore, "temporary-artifact-store", 1),
                AdapterSettings::new(1)
                    .with_value("root_directory", Value::String(store_directory.to_string()))
                    .with_value("retention_seconds", Value::from(604_800u64)),
            ),
            delivery_routes: vec![DeliveryRoute::required(AdapterBinding::new(
                "destination",
                AdapterIdentity::new(AdapterKind::DeliveryDestination, "local-directory", 1),
                empty.with_value("directory", Value::String(delivery_directory.to_string())),
            ))],
        },
    }
}

fn runtime_revision(snapshot: &PlanningInputSnapshot) -> AutomationRuntimeRevision {
    current_runtime_revision(
        snapshot
            .adapters
            .ordered_bindings()
            .into_iter()
            .map(|binding| binding.adapter.clone()),
    )
    .expect("seal fixture runtime revision")
}

fn fixture_projection(snapshot: &PlanningInputSnapshot) -> RunnerProjection {
    RunnerProjection {
        version: RUNNER_PROJECTION_VERSION,
        binding_id: "binding-1".to_string(),
        configuration_id: "config-1".to_string(),
        configuration_revision_id: "config-revision-1".to_string(),
        trigger_policy: AutomationTriggerPolicy::Manual,
        runtime_revision: runtime_revision(snapshot),
        release_input: BTreeMap::new(),
        adapters: snapshot.adapters.clone(),
        secret_bindings: BTreeMap::new(),
    }
}

fn prepared_attempt() -> PreparedAttempt {
    let temp = tempfile::tempdir().expect("temp dirs").keep();
    let mut snapshot = fixture_snapshot(
        &temp.join("store").to_string_lossy(),
        &temp.join("out").to_string_lossy(),
    );
    let revision = runtime_revision(&snapshot);
    snapshot.runtime_revision = revision.identifier();
    let registry = installed_registry(&snapshot, RunnerPorts::default(), &BTreeMap::new())
        .expect("materialize the shipped adapters");
    StandaloneRunner::new(registry, revision)
        .expect("runner fixture")
        .prepare_attempt(&snapshot)
        .expect("prepare fixture attempt")
}

#[test]
fn projection_rejects_unsupported_versions_and_blank_identities() {
    let temp = tempfile::tempdir().expect("temp dirs");
    let snapshot = fixture_snapshot(
        &temp.path().join("store").to_string_lossy(),
        &temp.path().join("out").to_string_lossy(),
    );
    let projection = fixture_projection(&snapshot);

    let mut wrong_version = projection.clone();
    wrong_version.version = 99;
    assert!(matches!(
        validate_projection(&wrong_version),
        Err(PublishError::InvalidPlan(_))
    ));

    for (field, blank) in [
        (
            "binding",
            Box::new(|p: &mut RunnerProjection| p.binding_id.clear())
                as Box<dyn Fn(&mut RunnerProjection)>,
        ),
        (
            "configuration",
            Box::new(|p: &mut RunnerProjection| p.configuration_id.clear()),
        ),
        (
            "configuration revision",
            Box::new(|p: &mut RunnerProjection| p.configuration_revision_id.clear()),
        ),
    ] {
        let mut mutated = projection.clone();
        blank(&mut mutated);
        match validate_projection(&mutated) {
            Err(PublishError::InvalidPlan(message)) => {
                assert!(message.contains(field), "{field}: {message}")
            }
            other => panic!("expected InvalidPlan for blank {field}, got {other:?}"),
        }
    }
}

#[test]
fn projection_rejects_a_runtime_revision_that_cannot_self_verify() {
    let temp = tempfile::tempdir().expect("temp dirs");
    let snapshot = fixture_snapshot(
        &temp.path().join("store").to_string_lossy(),
        &temp.path().join("out").to_string_lossy(),
    );
    let mut projection = fixture_projection(&snapshot);
    projection.runtime_revision.digest = "0".repeat(64);

    assert!(matches!(
        validate_projection(&projection),
        Err(PublishError::InvalidRuntimeRevision(_))
    ));
}

#[test]
fn installed_projection_verification_matches_the_shipped_runtime() {
    let temp = tempfile::tempdir().expect("temp dirs");
    let snapshot = fixture_snapshot(
        &temp.path().join("store").to_string_lossy(),
        &temp.path().join("out").to_string_lossy(),
    );
    let projection = fixture_projection(&snapshot);
    verify_installed_projection(&projection).expect("the pinned revision matches this binary");

    // 钉了不同 runner 组件版本的自洽修订：归一比较仍检出（决议 #86）。
    let mut foreign = projection.clone();
    foreign.runtime_revision = AutomationRuntimeRevision::seal(
        RuntimeComponentRevision::new("9.9.9", projection.runtime_revision.runner.digest.clone()),
        projection.runtime_revision.plan_contract.clone(),
        projection.runtime_revision.adapters.clone(),
    )
    .expect("seal a self-consistent foreign revision");
    match verify_installed_projection(&foreign) {
        Err(PublishError::InvalidRuntimeRevision(message)) => {
            assert!(message.contains("installed runner provides"))
        }
        other => panic!("expected InvalidRuntimeRevision, got {other:?}"),
    }
}

#[test]
fn prepared_attempt_validation_tracks_each_sealed_fact() {
    let attempt = prepared_attempt();
    validate_prepared_attempt(&attempt).expect("a freshly prepared attempt validates");

    // 密封快照钉住的运行时修订与 attempt 声明不一致。
    let mut mutated = attempt.clone();
    mutated.prepared.snapshot.runtime_revision = "runtime-v1-other".to_string();
    assert!(matches!(
        validate_prepared_attempt(&mutated),
        Err(PublishError::InvalidRuntimeRevision(_))
    ));

    // 快照版本不受支持。
    let mut mutated = attempt.clone();
    mutated.prepared.snapshot.version = 99;
    assert!(matches!(
        validate_prepared_attempt(&mutated),
        Err(PublishError::UnsupportedSnapshotVersion { .. })
    ));

    // 计划声明的快照摘要与实物不符。
    let mut mutated = attempt.clone();
    mutated.prepared.plan.snapshot_digest = "0".repeat(64);
    assert!(matches!(
        validate_prepared_attempt(&mutated),
        Err(PublishError::InvalidPlan(_))
    ));

    // 计划版本不受支持。
    let mut mutated = attempt.clone();
    mutated.prepared.plan.version = 99;
    assert!(matches!(
        validate_prepared_attempt(&mutated),
        Err(PublishError::UnsupportedPlanVersion { .. })
    ));

    // 计划摘要被篡改：重算摘要拒绝。
    let mut mutated = attempt.clone();
    mutated.prepared.plan.digest = "0".repeat(64);
    assert!(matches!(
        validate_prepared_attempt(&mutated),
        Err(PublishError::PlanDigestMismatch { .. })
    ));

    // Attempt 携带的运行时修订自身不完整。
    let mut mutated = attempt;
    mutated.runtime_revision.digest = "0".repeat(64);
    assert!(matches!(
        validate_prepared_attempt(&mutated),
        Err(PublishError::InvalidRuntimeRevision(_))
    ));
}

#[test]
fn registry_rejects_adapters_the_runner_does_not_ship() {
    let temp = tempfile::tempdir().expect("temp dirs");
    let mut snapshot = fixture_snapshot(
        &temp.path().join("store").to_string_lossy(),
        &temp.path().join("out").to_string_lossy(),
    );
    snapshot
        .adapters
        .artifact_processors
        .push(AdapterBinding::new(
            "processor",
            AdapterIdentity::new(AdapterKind::ArtifactProcessor, "unshipped-processor", 1),
            AdapterSettings::new(1),
        ));

    let error = installed_registry(&snapshot, RunnerPorts::default(), &BTreeMap::new())
        .err()
        .expect("a projection cannot conjure adapters the binary lacks");
    assert!(matches!(error, PublishError::AdapterNotRegistered { .. }));
}

#[test]
fn prepare_attempt_rejects_snapshots_without_the_pinned_revision() {
    let temp = tempfile::tempdir().expect("temp dirs");
    let mut snapshot = fixture_snapshot(
        &temp.path().join("store").to_string_lossy(),
        &temp.path().join("out").to_string_lossy(),
    );
    let revision = runtime_revision(&snapshot);
    let registry = installed_registry(&snapshot, RunnerPorts::default(), &BTreeMap::new())
        .expect("materialize adapters");
    let runner = StandaloneRunner::new(registry, revision).expect("runner");

    // 缺省钉住：规划输入必须携带明确的 Runtime Revision（决议 #86）。
    let error = runner
        .prepare_attempt(&snapshot)
        .expect_err("an unpinned snapshot must fail closed");
    assert!(
        error
            .to_string()
            .contains("missing its pinned runtime revision"),
        "unexpected error: {error}"
    );

    // 钉住别的修订：预备尝试不得跨越修订边界执行。
    snapshot.runtime_revision = "runtime-v1-ghost".to_string();
    let error = runner
        .prepare_attempt(&snapshot)
        .expect_err("a foreign pinned revision must fail closed");
    assert!(
        error.to_string().contains("this runner provides"),
        "unexpected error: {error}"
    );
}

#[test]
fn execute_rejects_attempts_pinned_to_another_runner_revision() {
    let attempt = prepared_attempt();
    let temp = tempfile::tempdir().expect("temp dirs");
    let mut snapshot = fixture_snapshot(
        &temp.path().join("store-b").to_string_lossy(),
        &temp.path().join("out-b").to_string_lossy(),
    );
    // 不同的 Adapter 选择产生不同的修订身份（github-release 不在
    // built-in 身份集合内，加入它会改变修订摘要）。
    snapshot
        .adapters
        .delivery_routes
        .push(DeliveryRoute::optional(AdapterBinding::new(
            "github-mirror",
            AdapterIdentity::new(AdapterKind::DeliveryDestination, "github-release", 1),
            AdapterSettings::new(1),
        )));
    snapshot.runtime_revision = runtime_revision(&snapshot).identifier();
    let registry = installed_registry(&snapshot, RunnerPorts::default(), &BTreeMap::new())
        .expect("materialize second registry");
    let other = StandaloneRunner::new(registry, runtime_revision(&snapshot)).expect("runner");

    let error = other
        .execute(&attempt, "attempt-revision-mismatch")
        .expect_err("attempts pinned to another revision must fail closed");
    assert!(
        error.to_string().contains("but this runner provides"),
        "unexpected error: {error}"
    );
}

#[test]
fn execute_rejects_a_prepared_attempt_that_no_longer_matches_its_snapshot() {
    let mut attempt = prepared_attempt();
    let temp = tempfile::tempdir().expect("temp dirs");
    let mut snapshot = fixture_snapshot(
        &temp.path().join("store-c").to_string_lossy(),
        &temp.path().join("out-c").to_string_lossy(),
    );
    let revision = runtime_revision(&snapshot);
    snapshot.runtime_revision = revision.identifier();
    let registry = installed_registry(&snapshot, RunnerPorts::default(), &BTreeMap::new())
        .expect("materialize registry");
    // 同一修订的 runner 消费被篡改过的 PreparedAttempt：重放规划逐字比对。
    attempt.prepared.snapshot = snapshot.clone();
    let runner = StandaloneRunner::new(registry, revision).expect("runner");
    attempt.prepared.plan.nodes.pop();
    attempt.prepared.plan.digest = attempt
        .prepared
        .plan
        .recomputed_digest()
        .expect("reseal tampered plan");

    let error = runner
        .execute(&attempt, "attempt-stale-prepared")
        .expect_err("a drifted prepared plan must fail closed");
    assert!(
        error
            .to_string()
            .contains("no longer matches its sealed planning input"),
        "unexpected error: {error}"
    );
}

#[test]
fn installed_registry_materializes_every_shipped_destination() {
    let temp = tempfile::tempdir().expect("temp dirs");
    for id in ["github-release", "sftp"] {
        let mut snapshot = fixture_snapshot(
            &temp.path().join(format!("store-{id}")).to_string_lossy(),
            &temp.path().join(format!("out-{id}")).to_string_lossy(),
        );
        snapshot.adapters.delivery_routes = vec![DeliveryRoute::required(AdapterBinding::new(
            "remote",
            AdapterIdentity::new(AdapterKind::DeliveryDestination, id, 1),
            AdapterSettings::new(1),
        ))];
        installed_registry(&snapshot, RunnerPorts::default(), &BTreeMap::new())
            .unwrap_or_else(|error| panic!("{id} must materialize: {error}"));
    }

    // 本地目录缺 directory 设置：构造点显式拒绝而不是物化出空路径。
    let mut snapshot = fixture_snapshot(
        &temp.path().join("store-local").to_string_lossy(),
        &temp.path().join("out-local").to_string_lossy(),
    );
    snapshot.adapters.delivery_routes[0].binding.settings = AdapterSettings::new(1);
    let error = installed_registry(&snapshot, RunnerPorts::default(), &BTreeMap::new())
        .err()
        .expect("a directory-less local destination must fail closed");
    assert!(
        error.to_string().contains("directory is required"),
        "unexpected error: {error}"
    );
}

#[test]
fn installed_registry_rejects_missing_required_settings_and_unshipped_adapters() {
    let temp = tempfile::tempdir().expect("temp dirs");
    let mut snapshot = fixture_snapshot(
        &temp.path().join("store-d").to_string_lossy(),
        &temp.path().join("out-d").to_string_lossy(),
    );

    // Provider 缺 config_path：物化前显式拒绝。
    snapshot.adapters.project_provider.settings = AdapterSettings::new(1);
    let error = installed_registry(&snapshot, RunnerPorts::default(), &BTreeMap::new())
        .err()
        .expect("providers without required settings must fail closed");
    assert!(
        error.to_string().contains("config_path is required"),
        "unexpected error: {error}"
    );

    // 产物存储缺 root_directory：同样显式拒绝。
    let mut snapshot = fixture_snapshot(
        &temp.path().join("store-e").to_string_lossy(),
        &temp.path().join("out-e").to_string_lossy(),
    );
    snapshot.adapters.artifact_store.settings = AdapterSettings::new(1);
    let error = installed_registry(&snapshot, RunnerPorts::default(), &BTreeMap::new())
        .err()
        .expect("stores without a root directory must fail closed");
    assert!(
        error.to_string().contains("root_directory is required"),
        "unexpected error: {error}"
    );

    // 未随二进制分发的 Destination 身份：不可由投影凭空创建。
    let mut snapshot = fixture_snapshot(
        &temp.path().join("store-f").to_string_lossy(),
        &temp.path().join("out-f").to_string_lossy(),
    );
    snapshot.adapters.delivery_routes[0].binding.adapter =
        AdapterIdentity::new(AdapterKind::DeliveryDestination, "unshipped-destination", 1);
    let error = installed_registry(&snapshot, RunnerPorts::default(), &BTreeMap::new())
        .err()
        .expect("unshipped destinations must fail closed");
    assert!(matches!(error, PublishError::AdapterNotRegistered { .. }));
}

#[test]
fn env_credential_source_joins_declared_requirements_with_secret_bindings() {
    let temp = tempfile::tempdir().expect("temp dirs");
    let secret = "ONE_PUBLISH_RUNNER_TEST_GH_TOKEN";
    std::env::set_var(secret, "gh-token-value");

    let mut snapshot = fixture_snapshot(
        &temp.path().join("store-g").to_string_lossy(),
        &temp.path().join("out-g").to_string_lossy(),
    );
    // 执行后端换成带凭据源的 Fake GitHub Actions：只有它消费 env 解析条目。
    snapshot.adapters.execution_backend.adapter = AdapterIdentity::new(
        AdapterKind::ExecutionBackend,
        publish_adapters::FAKE_GITHUB_ACTIONS_BACKEND_ID,
        1,
    );
    let github_route = AdapterBinding::new(
        "github-route",
        AdapterIdentity::new(AdapterKind::DeliveryDestination, "github-release", 1),
        AdapterSettings::new(1),
    )
    .with_credential("github_token", "github-token-ref");
    snapshot.adapters.delivery_routes = vec![
        // 已声明凭据 + 有 Secret 映射：进入 env 解析条目。
        DeliveryRoute::required(github_route.clone()),
        // 未声明的凭据要求被跳过；声明了但缺 Secret 映射的引用也被跳过——
        // 两条臂都不在物化期报错，由执行期凭据解析按分类显式失败。
        DeliveryRoute::optional(
            AdapterBinding::new(
                "sftp-orphan",
                AdapterIdentity::new(AdapterKind::DeliveryDestination, "sftp", 1),
                AdapterSettings::new(1),
            )
            .with_credential("undeclared-requirement", "ghost-ref"),
        ),
    ];
    let secret_bindings = BTreeMap::from([("github-token-ref".to_string(), secret.to_string())]);
    let registry = installed_registry(&snapshot, RunnerPorts::default(), &secret_bindings)
        .expect("materialize registry with env credential source");

    // 已映射引用经 env 解析出声明类型的凭据。
    let resolved = registry
        .resolve_binding_credentials(&snapshot.adapters.execution_backend.adapter, &github_route)
        .expect("resolve mapped credential");
    assert!(resolved.contains_key("github_token"));

    // 缺 Secret 映射的引用解析为 ReferenceMissing——跳过臂的正确后果。
    let unmapped = AdapterBinding::new(
        "github-unmapped",
        AdapterIdentity::new(AdapterKind::DeliveryDestination, "github-release", 1),
        AdapterSettings::new(1),
    )
    .with_credential("github_token", "unmapped-ref");
    let error = registry
        .resolve_binding_credentials(&snapshot.adapters.execution_backend.adapter, &unmapped)
        .expect_err("unmapped references must resolve as missing");
    assert!(
        matches!(error, PublishError::CredentialReferenceMissing { .. }),
        "unexpected error: {error}"
    );
}

#[test]
fn installed_registry_materializes_selected_provider_and_custom_processors() {
    let temp = tempfile::tempdir().expect("temp dirs");
    let mut snapshot = fixture_snapshot(
        &temp.path().join("store-h").to_string_lossy(),
        &temp.path().join("out-h").to_string_lossy(),
    );
    snapshot.adapters.project_provider = AdapterBinding::new(
        "project",
        AdapterIdentity::new(
            AdapterKind::ProjectProvider,
            publish_adapters::SELECTED_PROVIDER_ID,
            1,
        ),
        AdapterSettings::new(1).with_value(
            "spec_json",
            Value::String("{\"program\":\"selected:builder\"}".to_string()),
        ),
    );
    snapshot.adapters.artifact_processors = vec![
        AdapterBinding::new(
            "checksum",
            AdapterIdentity::new(AdapterKind::ArtifactProcessor, "checksum", 1),
            AdapterSettings::new(1),
        ),
        AdapterBinding::new(
            "custom",
            AdapterIdentity::new(
                AdapterKind::ArtifactProcessor,
                publish_adapters::CUSTOM_COMMAND_PROCESSOR_ID,
                1,
            ),
            AdapterSettings::new(1).with_value("program", Value::String("custom:sign".to_string())),
        ),
    ];
    installed_registry(&snapshot, RunnerPorts::default(), &BTreeMap::new())
        .expect("selected provider and custom processors must materialize");
}
