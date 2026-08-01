//! 决议 #87 验收：模板投影的触发时现场规划。
//!
//! 同一触发上下文（同一 tag、同一提交）重放必须产出相同的 snapshot/plan
//! 摘要；脏 checkout、前缀不匹配的 tag 与手动触发都必须显式失败。

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use one_publish_runner::{
    current_runtime_revision, prepare_from_projection, validate_prepared_attempt,
    RunnerProjection, TriggerContext, RUNNER_PROJECTION_VERSION,
};
use publish_domain::{
    AdapterBinding, AdapterIdentity, AdapterKind, AdapterSelection, AdapterSettings,
    AutomationTriggerPolicy, DeliveryRoute,
};
use serde_json::Value;

fn run_git(dir: &Path, args: &[&str]) {
    let output = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .expect("run git fixture command");
    assert!(
        output.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
}

fn fixture_checkout() -> tempfile::TempDir {
    let temp = tempfile::tempdir().expect("temp checkout");
    run_git(temp.path(), &["init", "--quiet", "-b", "main"]);
    run_git(temp.path(), &["config", "user.name", "One Publish Tests"]);
    run_git(
        temp.path(),
        &["config", "user.email", "tests@one-publish.invalid"],
    );
    std::fs::write(temp.path().join("README.md"), "fixture\n").expect("write fixture file");
    run_git(temp.path(), &["add", "--all"]);
    run_git(temp.path(), &["commit", "--quiet", "-m", "fixture"]);
    temp
}

fn fixture_projection() -> RunnerProjection {
    let adapters = AdapterSelection {
        project_provider: AdapterBinding::new(
            "project",
            AdapterIdentity::new(
                AdapterKind::ProjectProvider,
                publish_adapters::TAURI_PROVIDER_ID,
                1,
            ),
            AdapterSettings::new(1)
                .with_value(
                    "config_path",
                    Value::String("src-tauri/tauri.conf.json".to_string()),
                )
                .with_value("build_driver", Value::String("pnpm".to_string())),
        ),
        artifact_processors: vec![AdapterBinding::new(
            "checksums",
            AdapterIdentity::new(
                AdapterKind::ArtifactProcessor,
                publish_adapters::CHECKSUM_PROCESSOR_ID,
                1,
            ),
            AdapterSettings::new(1),
        )],
        execution_backend: AdapterBinding::new(
            "backend",
            AdapterIdentity::new(
                AdapterKind::ExecutionBackend,
                publish_adapters::GITHUB_ACTIONS_EXECUTION_BACKEND_ID,
                1,
            ),
            AdapterSettings::new(1),
        ),
        artifact_store: AdapterBinding::new(
            "store",
            AdapterIdentity::new(AdapterKind::ArtifactStore, "temporary-artifact-store", 1),
            AdapterSettings::new(1),
        ),
        delivery_routes: vec![DeliveryRoute::required(AdapterBinding::new(
            "local-delivery",
            AdapterIdentity::new(
                AdapterKind::DeliveryDestination,
                publish_adapters::LOCAL_DESTINATION_ID,
                1,
            ),
            AdapterSettings::new(1),
        ))],
    };
    let runtime_revision = current_runtime_revision(
        adapters
            .ordered_bindings()
            .into_iter()
            .map(|binding| binding.adapter.clone()),
    )
    .expect("seal fixture runtime revision");
    RunnerProjection {
        version: RUNNER_PROJECTION_VERSION,
        binding_id: "binding-stable".to_string(),
        configuration_id: "configuration-1".to_string(),
        configuration_revision_id: "configuration-revision-1".to_string(),
        trigger_policy: AutomationTriggerPolicy::TagPush {
            tag_prefix: "v".to_string(),
        },
        runtime_revision,
        release_input: BTreeMap::from([(
            "channel".to_string(),
            Value::String("stable".to_string()),
        )]),
        adapters,
        secret_bindings: BTreeMap::new(),
    }
}

#[test]
fn replaying_the_same_trigger_context_seals_identical_attempt_identities() {
    let checkout = fixture_checkout();
    let projection = fixture_projection();
    let context = TriggerContext {
        repository_root: checkout.path().to_path_buf(),
        tag: Some("v1.2.3".to_string()),
    };

    let first = prepare_from_projection(&projection, &context).expect("plan on site");
    let replayed = prepare_from_projection(&projection, &context).expect("replay planning");

    assert_eq!(first, replayed);
    validate_prepared_attempt(&first).expect("sealed attempt validates");
    assert_eq!(
        first.prepared.snapshot.release_input.get("version"),
        Some(&Value::String("1.2.3".to_string()))
    );
    assert_eq!(
        first.prepared.snapshot.release_input.get("channel"),
        Some(&Value::String("stable".to_string()))
    );
    assert!(!first.prepared.snapshot.source.dirty);
    assert!(first.prepared.snapshot.source.reproducible);
    // 运行时目录是 runner 注入的固定相对路径，不进入安装态模板。
    assert_eq!(
        first
            .prepared
            .snapshot
            .adapters
            .artifact_store
            .settings
            .values
            .get("root_directory"),
        Some(&Value::String(".one-publish-work/store".to_string()))
    );
    assert_eq!(
        first.prepared.snapshot.adapters.delivery_routes[0]
            .binding
            .settings
            .values
            .get("directory"),
        Some(&Value::String(".one-publish-work/delivery".to_string()))
    );
    assert_eq!(projection.adapters.artifact_store.settings.values.len(), 0);
}

#[test]
fn dirty_checkouts_and_foreign_trigger_contexts_are_rejected() {
    let checkout = fixture_checkout();
    let projection = fixture_projection();

    let mismatched = prepare_from_projection(
        &projection,
        &TriggerContext {
            repository_root: checkout.path().to_path_buf(),
            tag: Some("nightly-1.2.3".to_string()),
        },
    )
    .expect_err("a tag outside the bound prefix must be rejected");
    assert!(mismatched.to_string().contains("tag prefix"));

    let missing_tag = prepare_from_projection(
        &projection,
        &TriggerContext {
            repository_root: checkout.path().to_path_buf(),
            tag: None,
        },
    )
    .expect_err("tag-push planning requires the pushed tag");
    assert!(missing_tag.to_string().contains("pushed tag"));

    let mut manual = fixture_projection();
    manual.trigger_policy = AutomationTriggerPolicy::Manual;
    let manual_error = prepare_from_projection(
        &manual,
        &TriggerContext {
            repository_root: checkout.path().to_path_buf(),
            tag: None,
        },
    )
    .expect_err("manual dispatch is not wired yet");
    assert!(manual_error.to_string().contains("manual triggers"));

    std::fs::write(checkout.path().join("uncommitted.txt"), "dirty\n")
        .expect("write uncommitted file");
    let dirty = prepare_from_projection(
        &projection,
        &TriggerContext {
            repository_root: checkout.path().to_path_buf(),
            tag: Some("v1.2.3".to_string()),
        },
    )
    .expect_err("dirty checkouts must be rejected");
    assert!(dirty.to_string().contains("clean checkout"));
}
