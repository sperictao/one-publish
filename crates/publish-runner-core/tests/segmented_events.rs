//! 决议 #85/#88 验收：分片执行的节点子集语义与事件流的多段归约。
//!
//! 每个 backend run（job）一个事件段：段内 sequence 单调连续，跨段只要求
//! 同一 attempt 与 plan digest；乱序段与重复段拉取都不改写证据——reducer
//! 以稳定 Event ID 去重后归约出同一投影。

use std::collections::BTreeMap;

use publish_domain::{
    PlanNodeExecutionState, PlanNodePlatform, PlanRoute, PublishEvent, PUBLISH_EVENT_VERSION,
};
use publish_runner_core::{platform_segment_name, reduce_publish_events};
use serde_json::Value;

fn segment_event(
    backend_run_id: &str,
    sequence: u64,
    plan_node_id: &str,
    kind: &str,
) -> PublishEvent {
    PublishEvent {
        version: PUBLISH_EVENT_VERSION,
        event_id: format!("{backend_run_id}#{sequence}"),
        attempt_id: "attempt-shard".to_string(),
        backend_run_id: backend_run_id.to_string(),
        sequence,
        plan_digest: "plan-digest".to_string(),
        plan_node_id: plan_node_id.to_string(),
        kind: kind.to_string(),
        payload: BTreeMap::new(),
    }
}

fn routes() -> Vec<PlanRoute> {
    vec![PlanRoute {
        route_id: "local-delivery".to_string(),
        required: true,
    }]
}

fn build_segment() -> Vec<PublishEvent> {
    vec![
        segment_event("attempt-shard/linux", 1, "project.build-x86_64", "plan_node_started"),
        segment_event(
            "attempt-shard/linux",
            2,
            "project.build-x86_64",
            "plan_node_completed",
        ),
    ]
}

fn aggregate_segment() -> Vec<PublishEvent> {
    vec![
        segment_event("attempt-shard/any", 1, "store.persist", "plan_node_started"),
        segment_event("attempt-shard/any", 2, "store.persist", "plan_node_completed"),
    ]
}

#[test]
fn out_of_order_segments_reduce_to_the_same_projection() {
    let ordered = [build_segment(), aggregate_segment()].concat();
    let reversed = [aggregate_segment(), build_segment()].concat();
    let interleaved = vec![
        build_segment()[0].clone(),
        aggregate_segment()[0].clone(),
        build_segment()[1].clone(),
        aggregate_segment()[1].clone(),
    ];

    let expected = reduce_publish_events(&ordered, &routes()).expect("reduce ordered segments");
    for events in [reversed, interleaved] {
        let projection = reduce_publish_events(&events, &routes()).expect("reduce reordered");
        assert_eq!(projection.node_states, expected.node_states);
    }
    assert_eq!(
        expected.node_states.get("project.build-x86_64"),
        Some(&PlanNodeExecutionState::Completed)
    );
    assert_eq!(
        expected.node_states.get("store.persist"),
        Some(&PlanNodeExecutionState::Completed)
    );
}

#[test]
fn duplicate_segment_pulls_deduplicate_by_stable_event_id() {
    // 补拉重复段（同一 artifact 被拉取两次）不改写证据、不重复计数。
    let mut events = [build_segment(), aggregate_segment()].concat();
    events.extend(build_segment());
    let projection = reduce_publish_events(&events, &routes()).expect("reduce duplicated pulls");
    assert_eq!(projection.node_states.len(), 2);

    // 同一 Event ID 携带冲突证据必须显式失败，而不是被静默覆盖。
    let mut conflicting = build_segment();
    let mut tampered = build_segment()[1].clone();
    tampered.kind = "plan_node_failed".to_string();
    conflicting.push(tampered);
    let error = reduce_publish_events(&conflicting, &routes())
        .expect_err("conflicting duplicate event ids must fail");
    assert!(error.to_string().contains("conflicting evidence"));
}

#[test]
fn segment_gaps_and_foreign_attempts_are_rejected() {
    // 段内 sequence 跳号 = 缺失证据，触发补拉而不是继续归约。
    let mut gapped = build_segment();
    gapped.remove(0);
    let error = reduce_publish_events(&gapped, &routes())
        .expect_err("a segment gap must be detected");
    assert!(error.to_string().contains("expected 1"));

    let mut foreign = [build_segment(), aggregate_segment()].concat();
    foreign[2].attempt_id = "another-attempt".to_string();
    let error = reduce_publish_events(&foreign, &routes())
        .expect_err("segments from another attempt must be rejected");
    assert!(error.to_string().contains("one sealed attempt"));
}

#[test]
fn manifest_evidence_merges_consistently_across_segments() {
    let mut events = [build_segment(), aggregate_segment()].concat();
    let mut sealed = segment_event("attempt-shard/any", 3, "store.persist", "manifest_sealed");
    sealed.payload.insert(
        "manifest_digest".to_string(),
        Value::String("manifest-digest".to_string()),
    );
    events.push(sealed);
    reduce_publish_events(&events, &routes()).expect("manifest evidence merges");

    let mut conflicting_manifest =
        segment_event("attempt-shard/linux", 3, "project.build-x86_64", "manifest_sealed");
    conflicting_manifest.payload.insert(
        "manifest_digest".to_string(),
        Value::String("another-manifest".to_string()),
    );
    events.push(conflicting_manifest);
    let error = reduce_publish_events(&events, &routes())
        .expect_err("conflicting manifests across segments must fail");
    assert!(error.to_string().contains("conflicting artifact manifests"));
}

#[test]
fn truncated_segments_from_a_hard_cancel_still_reduce() {
    // 强取消（决议 #89）：runner 协作清理不保证、事件段可能截尾。段内连续
    // 前缀仍是合法证据——未完结节点保持 Started，归约不失败。
    let mut events = build_segment();
    events.push(segment_event(
        "attempt-shard/any",
        1,
        "store.persist",
        "plan_node_started",
    ));
    let projection =
        reduce_publish_events(&events, &routes()).expect("truncated segments reduce");
    assert_eq!(
        projection.node_states.get("store.persist"),
        Some(&PlanNodeExecutionState::Started)
    );
    assert_eq!(
        projection.node_states.get("project.build-x86_64"),
        Some(&PlanNodeExecutionState::Completed)
    );
    assert_eq!(
        projection.status,
        publish_domain::PublishAttemptStatus::Running
    );
}

#[test]
fn segment_names_are_stable_per_affinity() {
    for (platform, name) in [
        (PlanNodePlatform::Any, "any"),
        (PlanNodePlatform::Linux, "linux"),
        (PlanNodePlatform::Macos, "macos"),
        (PlanNodePlatform::Windows, "windows"),
    ] {
        assert_eq!(platform_segment_name(platform), name);
    }
}
