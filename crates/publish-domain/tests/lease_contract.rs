use std::collections::BTreeSet;

use publish_domain::{
    LeaseRenewal, PublishError, PublishResource, PublishResourceKind, PublishResourceLease,
    PUBLISH_RESOURCE_LEASE_VERSION,
};

fn lease_fixture() -> PublishResourceLease {
    PublishResourceLease {
        version: PUBLISH_RESOURCE_LEASE_VERSION,
        lease_id: "lease-1".to_string(),
        owner_attempt_id: "attempt-1".to_string(),
        resources: BTreeSet::from([
            PublishResource::new(PublishResourceKind::RepositoryWrite, "github.com/acme/app"),
            PublishResource::new(
                PublishResourceKind::ReleaseNamespace,
                "acme-app/stable/1.0.0",
            ),
        ]),
        acquired_at_seconds: 100,
        expires_at_seconds: 400,
        renewals: Vec::new(),
    }
}

/// 租约是版本化合同：所有者、资源范围、期限与续租记录必须完整（ADR-0042）。
#[test]
fn lease_requires_owner_scope_and_deadline() {
    let lease = lease_fixture();
    assert!(lease.validate().is_ok());

    let mut missing_owner = lease.clone();
    missing_owner.owner_attempt_id = "  ".to_string();
    assert!(missing_owner.validate().is_err());

    let mut missing_scope = lease.clone();
    missing_scope.resources.clear();
    assert!(missing_scope.validate().is_err());

    let mut inverted_deadline = lease.clone();
    inverted_deadline.expires_at_seconds = lease.acquired_at_seconds;
    assert!(inverted_deadline.validate().is_err());

    let mut wrong_version = lease;
    wrong_version.version = PUBLISH_RESOURCE_LEASE_VERSION + 1;
    assert!(matches!(
        wrong_version.validate(),
        Err(PublishError::UnsupportedLeaseVersion { .. })
    ));
}

/// 空的资源 key 不构成真实共享资源，必须被拒绝。
#[test]
fn lease_rejects_empty_resource_keys() {
    let mut lease = lease_fixture();
    lease.resources.insert(PublishResource::new(
        PublishResourceKind::ArtifactIdentity,
        "  ",
    ));
    assert!(lease.validate().is_err());
}

/// 期限判断只依赖显式时间输入：到期时刻本身即失效。
#[test]
fn lease_expiry_is_deterministic_over_explicit_time() {
    let lease = lease_fixture();
    assert!(!lease.is_expired(399));
    assert!(lease.is_expired(400));
    assert!(lease.is_expired(401));
}

/// 续租记录是不可变历史：每次续租都追加时间与新期限。
#[test]
fn lease_renewals_are_recorded_history() {
    let mut lease = lease_fixture();
    lease.renewals.push(LeaseRenewal {
        renewed_at_seconds: 300,
        expires_at_seconds: 700,
    });
    lease.expires_at_seconds = 700;
    assert!(lease.validate().is_ok());
    assert_eq!(lease.renewals.len(), 1);
}

/// 租约与资源随控制面持久化：序列化往返必须保持全部字段。
#[test]
fn lease_round_trips_through_serialization() {
    let mut lease = lease_fixture();
    lease.renewals.push(LeaseRenewal {
        renewed_at_seconds: 300,
        expires_at_seconds: 700,
    });
    lease.expires_at_seconds = 700;

    let serialized = serde_json::to_string(&lease).expect("serialize lease");
    let deserialized: PublishResourceLease =
        serde_json::from_str(&serialized).expect("deserialize lease");
    assert_eq!(deserialized, lease);
}

/// 四类租约资源覆盖仓库写入、发布命名空间、产物身份与目标命名空间；
/// 冲突判定只看种类与 key 的相等性，不含任何目标特例。
#[test]
fn resources_conflict_only_on_identical_kind_and_key() {
    let repository = PublishResource::new(PublishResourceKind::RepositoryWrite, "repo");
    let same_repository = PublishResource::new(PublishResourceKind::RepositoryWrite, "repo");
    let other_repository = PublishResource::new(PublishResourceKind::RepositoryWrite, "other");
    let namespace = PublishResource::new(PublishResourceKind::ReleaseNamespace, "repo");
    let artifact = PublishResource::new(PublishResourceKind::ArtifactIdentity, "repo");
    let destination = PublishResource::new(PublishResourceKind::DestinationNamespace, "repo");

    assert_eq!(repository, same_repository);
    assert_ne!(repository, other_repository);
    // 同一 key 在不同种类下是不同资源。
    let distinct = BTreeSet::from([repository.clone(), namespace, artifact, destination]);
    assert_eq!(distinct.len(), 4);
    assert!(repository.display_name().contains("repo"));
}
