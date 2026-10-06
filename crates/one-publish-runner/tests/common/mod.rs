//! Runner 集成测试共享夹具：已提交的干净 checkout 与 Tauri 模板投影。

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use one_publish_runner::{current_runtime_revision, RunnerProjection, RUNNER_PROJECTION_VERSION};
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

/// 全部文件已提交的干净 checkout；`files` 为 README 之外追加的相对路径与内容。
pub fn fixture_checkout(files: &[(&str, &str)]) -> tempfile::TempDir {
    let temp = tempfile::tempdir().expect("temp checkout");
    run_git(temp.path(), &["init", "--quiet", "-b", "main"]);
    run_git(temp.path(), &["config", "user.name", "One Publish Tests"]);
    run_git(
        temp.path(),
        &["config", "user.email", "tests@one-publish.invalid"],
    );
    for &(relative, content) in [("README.md", "fixture\n")].iter().chain(files) {
        let path = temp.path().join(relative);
        std::fs::create_dir_all(path.parent().expect("fixture file parent"))
            .expect("create fixture directory");
        std::fs::write(path, content).expect("write fixture file");
    }
    run_git(temp.path(), &["add", "--all"]);
    run_git(temp.path(), &["commit", "--quiet", "-m", "fixture"]);
    temp
}

pub fn fixture_projection() -> RunnerProjection {
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
                publish_adapters::GITHUB_ACTIONS_BACKEND_ID,
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
