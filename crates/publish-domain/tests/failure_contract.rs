use publish_domain::{
    DeliveryIdempotencyIdentity, PublishError, PublishFailure, PublishFailureCategory,
    ReleaseIdentity, SourceSnapshot, PUBLISH_FAILURE_VERSION,
};

fn release_identity() -> ReleaseIdentity {
    ReleaseIdentity::new(
        "tauri:app",
        SourceSnapshot {
            revision: "0123456789abcdef".to_string(),
            workspace_digest: None,
            dirty: false,
            captured_at: "2026-07-21T10:00:00Z".to_string(),
            reproducible: true,
        },
        "1.2.3",
        "stable",
        None,
    )
}

#[test]
fn only_transient_and_rate_limited_categories_allow_automatic_retry() {
    let eligible = [
        PublishFailureCategory::Transient,
        PublishFailureCategory::RateLimited,
    ];
    let blocking = [
        PublishFailureCategory::Authentication,
        PublishFailureCategory::Authorization,
        PublishFailureCategory::Validation,
        PublishFailureCategory::Conflict,
        PublishFailureCategory::Policy,
        PublishFailureCategory::Unsupported,
        PublishFailureCategory::Rejected,
        PublishFailureCategory::Unknown,
    ];

    assert!(eligible
        .iter()
        .all(|category| category.allows_automatic_retry()));
    assert!(blocking
        .iter()
        .all(|category| !category.allows_automatic_retry()));
}

#[test]
fn classified_failures_serialize_category_code_retry_safety_and_retry_after() {
    let failure = PublishFailure {
        version: PUBLISH_FAILURE_VERSION,
        category: PublishFailureCategory::RateLimited,
        native_code: "HTTP-429".to_string(),
        message: "secondary rate limit exceeded".to_string(),
        retry_safe: false,
        retry_after_seconds: Some(30),
    };

    let serialized = serde_json::to_string(&failure).expect("serialize failure");
    assert!(serialized.contains("rate_limited"));
    assert!(serialized.contains("HTTP-429"));
    assert!(serialized.contains("retry_after_seconds"));

    let roundtripped: PublishFailure =
        serde_json::from_str(&serialized).expect("deserialize failure");
    assert_eq!(roundtripped, failure);
}

#[test]
fn classified_publish_errors_expose_structured_failures_without_string_matching() {
    let failure = PublishFailure {
        version: PUBLISH_FAILURE_VERSION,
        category: PublishFailureCategory::Transient,
        native_code: "ECONNRESET".to_string(),
        message: "connection reset while uploading".to_string(),
        retry_safe: true,
        retry_after_seconds: None,
    };
    let error = PublishError::Classified {
        failure: failure.clone(),
    };

    let PublishError::Classified { failure: observed } = &error else {
        panic!("classified failures must stay structured");
    };
    assert_eq!(observed, &failure);
    let message = error.to_string();
    assert!(message.contains("transient"));
    assert!(message.contains("ECONNRESET"));
}

#[test]
fn delivery_idempotency_identity_binds_attempt_node_release_manifest_and_route() {
    let identity = DeliveryIdempotencyIdentity {
        attempt_id: "attempt-1".to_string(),
        plan_node_id: "primary.publish".to_string(),
        release_identity: release_identity(),
        manifest_digest: "a".repeat(64),
        route_id: "primary".to_string(),
    };

    let serialized = serde_json::to_string(&identity).expect("serialize identity");
    let roundtripped: DeliveryIdempotencyIdentity =
        serde_json::from_str(&serialized).expect("deserialize identity");
    assert_eq!(roundtripped, identity);
}
