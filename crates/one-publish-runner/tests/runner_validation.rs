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
