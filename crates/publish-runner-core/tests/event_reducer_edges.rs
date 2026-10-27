//! 事件归约与交付 Envelope 恢复的错误分支（Issue #223）：密封计划只接受
//! 结构上自洽的证据——错版事件、悬空路线引用、倒退/冲突的 Receipt 修订、
//! 无路线绑定的失败/取消事件、与密封 Manifest 不符的交付证据都必须显式
//! 报错，而不是静默降级或 last-write-wins 覆盖（ADR-0027/0039/0056/0057）。

use std::collections::{BTreeMap, BTreeSet};

use publish_domain::{
    AdapterIdentity, AdapterKind, AdapterSettings, DeliveryEnvelope, DeliveryStatus, PlanNode,
    PlanNodePlatform, PlanOperation, PlanRoute, PlanStage, PublishError, PublishEvent, PublishPlan,
    PublishResource, PublishResourceKind, PublishResourceLease, ReleaseAttempt, ReleaseIdentity,
    SourceSnapshot, DELIVERY_RECEIPT_VERSION, PUBLISH_EVENT_VERSION, PUBLISH_PLAN_VERSION,
    PUBLISH_RESOURCE_LEASE_VERSION, RELEASE_ATTEMPT_VERSION,
};
use publish_runner_core::{
    recover_delivery_envelopes, reduce_publish_events, AttemptEventLog, PublishLeaseCoordinator,
};
use serde_json::{json, Value};

const MANIFEST_DIGEST: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

fn routes(ids: &[&str]) -> Vec<PlanRoute> {
    ids.iter()
        .map(|route_id| PlanRoute {
            route_id: (*route_id).to_string(),
            required: true,
        })
        .collect()
}

fn event(sequence: u64, kind: &str, payload: BTreeMap<String, Value>) -> PublishEvent {
    PublishEvent {
        version: PUBLISH_EVENT_VERSION,
        event_id: format!("event-{sequence}"),
        attempt_id: "attempt-edges".to_string(),
        backend_run_id: "backend-edges".to_string(),
        sequence,
        plan_digest: "plan-edges".to_string(),
        plan_node_id: "publish-routes".to_string(),
        kind: kind.to_string(),
        payload,
    }
}

fn manifest_event(sequence: u64) -> PublishEvent {
    event(
        sequence,
        "plan_node_completed",
        BTreeMap::from([(
            "manifest_digest".to_string(),
            Value::String(MANIFEST_DIGEST.to_string()),
        )]),
    )
}

fn receipt_payload(
    receipt_id: &str,
    revision: u32,
    route_id: &str,
    status: DeliveryStatus,
    manifest_digest: &str,
    external_reference: &str,
) -> BTreeMap<String, Value> {
    BTreeMap::from([(
        "receipt".to_string(),
        json!({
            "version": DELIVERY_RECEIPT_VERSION,
            "receipt_id": receipt_id,
            "revision": revision,
            "route_id": route_id,
            "manifest_digest": manifest_digest,
            "status": status,
            "external_reference": external_reference,
        }),
    )])
}

fn receipt_event(
    sequence: u64,
    receipt_id: &str,
    revision: u32,
    route_id: &str,
    status: DeliveryStatus,
) -> PublishEvent {
    event(
        sequence,
        "delivery_receipt_observed",
        receipt_payload(
            receipt_id,
            revision,
            route_id,
            status,
            MANIFEST_DIGEST,
            "local://stable",
        ),
    )
}

#[test]
fn reducer_rejects_unsupported_event_versions() {
    let mut malformed = manifest_event(1);
    malformed.version = PUBLISH_EVENT_VERSION + 1;
    assert_eq!(
        reduce_publish_events(&[malformed], &routes(&["route-a"]))
            .expect_err("foreign event versions must fail"),
        PublishError::UnsupportedEventVersion {
            actual: PUBLISH_EVENT_VERSION + 1,
            expected: PUBLISH_EVENT_VERSION,
        }
    );
}

#[test]
fn reducer_rejects_receipt_events_with_missing_or_malformed_receipts() {
    let missing = event(1, "delivery_receipt_observed", BTreeMap::new());
    assert!(reduce_publish_events(&[missing], &routes(&["route-a"]))
        .expect_err("receipt evidence without its receipt payload")
        .to_string()
        .contains("missing its delivery receipt"));

    let malformed = event(
        1,
        "delivery_receipt_observed",
        BTreeMap::from([("receipt".to_string(), json!(42))]),
    );
    assert!(reduce_publish_events(&[malformed], &routes(&["route-a"]))
        .expect_err("receipt payloads that fail to deserialize")
        .to_string()
        .contains("invalid delivery receipt"));
}

#[test]
fn reducer_rejects_receipts_and_route_events_bound_to_unknown_routes() {
    let known = routes(&["route-a"]);

    let orphan_receipt = vec![
        manifest_event(1),
        receipt_event(2, "receipt-b", 1, "route-b", DeliveryStatus::Submitted),
    ];
    assert!(reduce_publish_events(&orphan_receipt, &known)
        .expect_err("receipts cannot reference routes outside the sealed plan")
        .to_string()
        .contains("unknown route route-b"));

    for (kind, label) in [("route_failed", "failed"), ("route_cancelled", "cancelled")] {
        let no_route = event(1, kind, BTreeMap::new());
        assert!(
            reduce_publish_events(&[no_route], &known)
                .expect_err("route events require a route id")
                .to_string()
                .contains(&format!("missing its {label} route id")),
            "kind: {kind}"
        );

        let orphan = event(
            1,
            kind,
            BTreeMap::from([("route_id".to_string(), json!("ghost-route"))]),
        );
        let message = reduce_publish_events(&[orphan], &known)
            .expect_err("route events cannot reference routes outside the sealed plan")
            .to_string();
        assert!(message.contains("unknown route ghost-route"), "{message}");
    }
}

#[test]
fn reducer_rejects_backwards_and_conflicting_receipt_revisions() {
    let moved_backwards = vec![
        manifest_event(1),
        receipt_event(2, "receipt-a", 1, "route-a", DeliveryStatus::Submitted),
        receipt_event(3, "receipt-a", 2, "route-a", DeliveryStatus::Published),
        event(
            4,
            "delivery_receipt_observed",
            receipt_payload(
                "receipt-a",
                1,
                "route-a",
                DeliveryStatus::Cancelled,
                MANIFEST_DIGEST,
                "local://stable",
            ),
        ),
    ];
    let known = routes(&["route-a"]);
    let message = reduce_publish_events(&moved_backwards, &known)
        .expect_err("receipt revisions must never move backwards")
        .to_string();
    assert!(
        message.contains("revision moved backwards from 2 to 1"),
        "{message}"
    );

    let conflicting_revision = vec![
        manifest_event(1),
        receipt_event(2, "receipt-a", 1, "route-a", DeliveryStatus::Submitted),
        event(
            3,
            "delivery_receipt_observed",
            receipt_payload(
                "receipt-a",
                1,
                "route-a",
                DeliveryStatus::Published,
                MANIFEST_DIGEST,
                "local://forged",
            ),
        ),
    ];
    assert!(reduce_publish_events(&conflicting_revision, &known)
        .expect_err("one revision cannot carry two pieces of evidence")
        .to_string()
        .contains("conflicting evidence"));
}

#[test]
fn reducer_rejects_staged_to_pending_lifecycle_regressions() {
    let regression = vec![
        manifest_event(1),
        receipt_event(2, "receipt-a", 1, "route-a", DeliveryStatus::Staged),
        receipt_event(3, "receipt-a", 2, "route-a", DeliveryStatus::Pending),
    ];
    let message = reduce_publish_events(&regression, &routes(&["route-a"]))
        .expect_err("staged deliveries cannot regress to pending")
        .to_string();
    assert!(
        message.contains("invalid lifecycle transition staged -> pending"),
        "{message}"
    );
}

#[test]
fn reducer_projects_plan_node_failures_with_a_fallback_message() {
    let events = vec![
        manifest_event(1),
        event(2, "plan_node_failed", BTreeMap::new()),
    ];
    let projection = reduce_publish_events(&events, &routes(&["route-a"]))
        .expect("node failures still reduce to a failed attempt");
    assert_eq!(
        projection.status,
        publish_domain::PublishAttemptStatus::Failed
    );
    assert_eq!(
        projection.error.as_deref(),
        Some("publish plan node publish-routes failed")
    );
}

#[test]
fn reducer_rejects_receipts_bound_to_a_different_manifest() {
    let events = vec![
        manifest_event(1),
        event(
            2,
            "delivery_receipt_observed",
            receipt_payload(
                "receipt-a",
                1,
                "route-a",
                DeliveryStatus::Submitted,
                &"b".repeat(64),
                "local://stable",
            ),
        ),
    ];
    let message = reduce_publish_events(&events, &routes(&["route-a"]))
        .expect_err("receipts must stay bound to the sealed manifest")
        .to_string();
    assert!(message.contains("references manifest"), "{message}");
}

fn edge_attempt() -> ReleaseAttempt {
    ReleaseAttempt {
        version: RELEASE_ATTEMPT_VERSION,
        attempt_id: "attempt-edges".to_string(),
        configuration_revision: "config-1".to_string(),
        planning_snapshot_digest: "snapshot-edges".to_string(),
        plan_version: PUBLISH_PLAN_VERSION,
        plan_digest: "plan-edges".to_string(),
        release_identity: ReleaseIdentity::new(
            "edge-project:app",
            SourceSnapshot {
                revision: "0123456789abcdef".to_string(),
                workspace_digest: None,
                dirty: false,
                captured_at: "2026-10-27T10:00:00Z".to_string(),
                reproducible: true,
            },
            "1.0.0",
            "stable",
            None,
        ),
        execution_backend: AdapterIdentity::new(
            AdapterKind::ExecutionBackend,
            "local-execution",
            1,
        ),
        runtime_revision: "runner-1".to_string(),
        backend_run_id: "backend-edges".to_string(),
        manifest_digest: None,
    }
}

#[test]
fn event_log_rejects_events_without_a_stable_identity() {
    let mut log = AttemptEventLog::new(&edge_attempt()).expect("open ledger");

    let mut zero_sequence = event(1, "plan_node_started", BTreeMap::new());
    zero_sequence.sequence = 0;
    assert!(log
        .sync(&[zero_sequence])
        .expect_err("causal sequences start at one")
        .to_string()
        .contains("positive causal sequence"));

    let mut anonymous = event(1, "plan_node_started", BTreeMap::new());
    anonymous.event_id = "   ".to_string();
    assert!(log
        .sync(&[anonymous])
        .expect_err("events require a stable event id")
        .to_string()
        .contains("stable event id"));
}

fn lease_record(owner: &str, key: &str, expires_at: u64) -> PublishResourceLease {
    PublishResourceLease {
        version: PUBLISH_RESOURCE_LEASE_VERSION,
        lease_id: format!("lease-{owner}-{key}"),
        owner_attempt_id: owner.to_string(),
        resources: BTreeSet::from([PublishResource::new(
            PublishResourceKind::RepositoryWrite,
            key,
        )]),
        acquired_at_seconds: 100,
        expires_at_seconds: expires_at,
        renewals: vec![],
    }
}

#[test]
fn lease_restore_rejects_duplicate_owner_records_and_default_starts_empty() {
    let default = PublishLeaseCoordinator::default();
    assert!(default.leases().is_empty());

    let duplicates = vec![
        lease_record("attempt-1", "repo-a", 300),
        lease_record("attempt-1", "repo-b", 300),
    ];
    assert!(PublishLeaseCoordinator::restore(duplicates)
        .err()
        .expect("one attempt cannot carry two persisted lease records")
        .to_string()
        .contains("conflicting evidence for one attempt"));
}

#[test]
fn release_if_held_reports_whether_the_attempt_owned_resources() {
    let coordinator = PublishLeaseCoordinator::new();
    assert!(!coordinator
        .release_if_held("attempt-missing")
        .expect("releasing an absent lease is a no-op"));

    coordinator
        .acquire(
            "attempt-held",
            BTreeSet::from([PublishResource::new(
                PublishResourceKind::ReleaseNamespace,
                "ns-1",
            )]),
            100,
            60,
        )
        .expect("acquire a lease");
    assert!(coordinator
        .release_if_held("attempt-held")
        .expect("release reports durable ownership"));
    assert!(!coordinator
        .release_if_held("attempt-held")
        .expect("the second release is again a no-op"));
}

fn staging_node(id: &str, route_id: &str) -> PlanNode {
    PlanNode {
        id: id.to_string(),
        stage: PlanStage::StageRoutes,
        adapter: AdapterIdentity::new(AdapterKind::DeliveryDestination, "local-delivery", 1),
        binding_id: route_id.to_string(),
        settings: AdapterSettings::new(1),
        operation: PlanOperation::AdapterAction {
            action: "stage_routes".to_string(),
            inputs: BTreeMap::new(),
        },
        depends_on: vec![],
        artifact_inputs: vec![],
        artifact_outputs: vec![],
        side_effects: vec![],
        cancellable: true,
        cleanup_owned_staging: false,
        irreversible: false,
        platform: PlanNodePlatform::Any,
    }
}

fn envelope_plan(nodes: Vec<PlanNode>) -> PublishPlan {
    PublishPlan {
        version: PUBLISH_PLAN_VERSION,
        snapshot_digest: "snapshot-envelopes".to_string(),
        adapters: vec![],
        execution_backend: AdapterIdentity::new(
            AdapterKind::ExecutionBackend,
            "local-execution",
            1,
        ),
        routes: routes(&["route-a"]),
        nodes,
        digest: "plan-envelopes".to_string(),
    }
}

fn envelope_event(sequence: u64, plan_node_id: &str, kind: &str, envelopes: Value) -> PublishEvent {
    let mut envelope_event = event(sequence, kind, BTreeMap::new());
    envelope_event.plan_node_id = plan_node_id.to_string();
    envelope_event
        .payload
        .insert("delivery_envelopes".to_string(), envelopes);
    envelope_event
}

#[test]
fn recover_delivery_envelopes_rejects_evidence_outside_node_completion() {
    let plan = envelope_plan(vec![staging_node("stage-route-a", "route-a")]);

    let premature = envelope_event(1, "stage-route-a", "plan_node_started", json!([]));
    assert!(
        recover_delivery_envelopes(&[premature], &plan, MANIFEST_DIGEST)
            .expect_err("envelope evidence before node completion")
            .to_string()
            .contains("before node completion")
    );

    let mut wrong_node_plan = envelope_plan(vec![staging_node("stage-route-a", "route-a")]);
    wrong_node_plan.nodes[0].stage = PlanStage::PublishRoutes;
    let orphan = envelope_event(1, "stage-route-a", "plan_node_completed", json!([]));
    assert!(
        recover_delivery_envelopes(&[orphan], &wrong_node_plan, MANIFEST_DIGEST)
            .expect_err("envelopes cannot attach to non-staging nodes")
            .to_string()
            .contains("non-staging plan node")
    );

    let malformed = envelope_event(1, "stage-route-a", "plan_node_completed", json!("oops"));
    assert!(
        recover_delivery_envelopes(&[malformed], &plan, MANIFEST_DIGEST)
            .expect_err("malformed envelope evidence")
            .to_string()
            .contains("invalid delivery envelope evidence")
    );
}

#[test]
fn recover_delivery_envelopes_enforces_sealed_route_and_manifest_binding() {
    let plan = envelope_plan(vec![staging_node("stage-route-a", "route-a")]);

    let wrong_route = envelope_event(
        1,
        "stage-route-a",
        "plan_node_completed",
        json!([DeliveryEnvelope::new("route-b", MANIFEST_DIGEST)]),
    );
    assert!(
        recover_delivery_envelopes(&[wrong_route], &plan, MANIFEST_DIGEST)
            .expect_err("envelopes must stay inside their sealed route")
            .to_string()
            .contains("outside its sealed route or manifest")
    );

    let wrong_manifest = envelope_event(
        1,
        "stage-route-a",
        "plan_node_completed",
        json!([DeliveryEnvelope::new("route-a", &"f".repeat(64))]),
    );
    assert!(
        recover_delivery_envelopes(&[wrong_manifest], &plan, MANIFEST_DIGEST)
            .expect_err("envelopes must stay bound to the sealed manifest")
            .to_string()
            .contains("outside its sealed route or manifest")
    );

    let forged = DeliveryEnvelope::new("route-a", MANIFEST_DIGEST)
        .with_content("path", json!("delivered/forged"));
    let conflict = vec![
        envelope_event(
            1,
            "stage-route-a",
            "plan_node_completed",
            json!([DeliveryEnvelope::new("route-a", MANIFEST_DIGEST)]),
        ),
        envelope_event(2, "stage-route-a", "plan_node_completed", json!([forged])),
    ];
    assert!(
        recover_delivery_envelopes(&conflict, &plan, MANIFEST_DIGEST)
            .expect_err("one route cannot carry two conflicting envelopes")
            .to_string()
            .contains("conflicting delivery envelope evidence")
    );
}

#[test]
fn recover_delivery_envelopes_deduplicates_identical_evidence() {
    let plan = envelope_plan(vec![staging_node("stage-route-a", "route-a")]);
    let envelope = || DeliveryEnvelope::new("route-a", MANIFEST_DIGEST);
    let replayed = vec![
        envelope_event(
            1,
            "stage-route-a",
            "plan_node_completed",
            json!([envelope()]),
        ),
        envelope_event(
            2,
            "stage-route-a",
            "plan_node_completed",
            json!([envelope()]),
        ),
    ];
    let recovered =
        recover_delivery_envelopes(&replayed, &plan, MANIFEST_DIGEST).expect("recover envelopes");
    assert_eq!(recovered, vec![envelope()]);
}
