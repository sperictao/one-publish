//! 决议 #87 验收：模板投影的触发时现场规划。
//!
//! 同一触发上下文（同一 tag、同一提交）重放必须产出相同的 snapshot/plan
//! 摘要；脏 checkout、前缀不匹配的 tag 与手动触发都必须显式失败。

mod common;

use common::{fixture_checkout, fixture_projection};
use one_publish_runner::{
    installed_runner, prepare_from_projection, validate_prepared_attempt, TriggerContext,
    TriggerInput,
};
use publish_domain::{AutomationTriggerPolicy, PlanNodePlatform};
use publish_runner_core::ShardHandoff;
use serde_json::Value;

#[test]
fn replaying_the_same_trigger_context_seals_identical_attempt_identities() {
    let checkout = fixture_checkout(&[]);
    let projection = fixture_projection();
    let context = TriggerContext {
        repository_root: checkout.path().to_path_buf(),
        trigger: TriggerInput::Tag("v1.2.3".to_string()),
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
fn shard_execution_skips_unassigned_nodes_instead_of_failing() {
    let checkout = fixture_checkout(&[]);
    let projection = fixture_projection();
    let attempt = prepare_from_projection(
        &projection,
        &TriggerContext {
            repository_root: checkout.path().to_path_buf(),
            trigger: TriggerInput::Tag("v1.2.3".to_string()),
        },
    )
    .expect("plan on site");

    // fixture 计划的节点都落在宿主平台族与汇聚亲和上；把段分配到一个没有
    // 任何节点的平台族时，整段全部跳过——未分配节点不是失败（决议 #85）。
    let absent = if cfg!(target_os = "windows") {
        PlanNodePlatform::Macos
    } else {
        PlanNodePlatform::Windows
    };
    let segment = installed_runner(&attempt)
        .expect("assemble the installed runner")
        .execute_shard(&attempt, "attempt-shard", absent, ShardHandoff::default())
        .expect("an unassigned shard completes without executing anything");
    assert!(segment.events.is_empty());
    assert!(segment.manifest.is_none());
}

#[test]
fn dirty_checkouts_and_foreign_trigger_contexts_are_rejected() {
    let checkout = fixture_checkout(&[]);
    let projection = fixture_projection();

    let mismatched = prepare_from_projection(
        &projection,
        &TriggerContext {
            repository_root: checkout.path().to_path_buf(),
            trigger: TriggerInput::Tag("nightly-1.2.3".to_string()),
        },
    )
    .expect_err("a tag outside the bound prefix must be rejected");
    assert!(mismatched.to_string().contains("tag prefix"));

    let missing_tag = prepare_from_projection(
        &projection,
        &TriggerContext {
            repository_root: checkout.path().to_path_buf(),
            trigger: TriggerInput::Tag("  ".to_string()),
        },
    )
    .expect_err("tag-push planning requires the pushed tag");
    assert!(missing_tag.to_string().contains("pushed tag"));

    // 触发形态与安装策略互验（决议 #89）：tag 绑定拒绝手动输入，反之亦然。
    let mismatched_shape = prepare_from_projection(
        &projection,
        &TriggerContext {
            repository_root: checkout.path().to_path_buf(),
            trigger: TriggerInput::Manual {
                version: "1.2.3".to_string(),
            },
        },
    )
    .expect_err("a tag binding cannot plan from a manual input");
    assert!(mismatched_shape.to_string().contains("manual dispatch"));

    let mut manual = fixture_projection();
    manual.trigger_policy = AutomationTriggerPolicy::Manual;
    let manual_error = prepare_from_projection(
        &manual,
        &TriggerContext {
            repository_root: checkout.path().to_path_buf(),
            trigger: TriggerInput::Tag("v1.2.3".to_string()),
        },
    )
    .expect_err("a manual binding cannot plan from a pushed tag");
    assert!(manual_error.to_string().contains("manual binding"));

    // 手动 dispatch 以显式版本现场规划，与 tag 路径同构（决议 #89）。
    let manual_attempt = prepare_from_projection(
        &manual,
        &TriggerContext {
            repository_root: checkout.path().to_path_buf(),
            trigger: TriggerInput::Manual {
                version: "1.2.3".to_string(),
            },
        },
    )
    .expect("manual dispatch plans on site");
    assert_eq!(
        manual_attempt
            .prepared
            .snapshot
            .release_input
            .get("version"),
        Some(&serde_json::Value::String("1.2.3".to_string()))
    );

    std::fs::write(checkout.path().join("uncommitted.txt"), "dirty\n")
        .expect("write uncommitted file");
    let dirty = prepare_from_projection(
        &projection,
        &TriggerContext {
            repository_root: checkout.path().to_path_buf(),
            trigger: TriggerInput::Tag("v1.2.3".to_string()),
        },
    )
    .expect_err("dirty checkouts must be rejected");
    assert!(dirty.to_string().contains("clean checkout"));
}
