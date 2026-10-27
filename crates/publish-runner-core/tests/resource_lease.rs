use std::collections::BTreeSet;

use publish_domain::{
    PublishError, PublishResource, PublishResourceKind, PUBLISH_RESOURCE_LEASE_VERSION,
};
use publish_runner_core::PublishLeaseCoordinator;

const TTL: u64 = 300;

fn repository(key: &str) -> PublishResource {
    PublishResource::new(PublishResourceKind::RepositoryWrite, key)
}

fn namespace(key: &str) -> PublishResource {
    PublishResource::new(PublishResourceKind::ReleaseNamespace, key)
}

fn artifact(key: &str) -> PublishResource {
    PublishResource::new(PublishResourceKind::ArtifactIdentity, key)
}

fn resources(values: &[PublishResource]) -> BTreeSet<PublishResource> {
    values.iter().cloned().collect()
}

/// 资源集合不相交的 Attempt 可以同时持有租约并行执行；同一仓库不再互斥。
#[test]
fn disjoint_resource_sets_hold_leases_concurrently() {
    let coordinator = PublishLeaseCoordinator::new();
    let stable = coordinator
        .acquire(
            "attempt-stable",
            resources(&[repository("acme/app"), namespace("acme-app/stable/1.0.0")]),
            100,
            TTL,
        )
        .expect("stable attempt acquires its lease");
    let nightly = coordinator
        .acquire(
            "attempt-nightly",
            resources(&[namespace("acme-app/nightly/20260725")]),
            100,
            TTL,
        )
        .expect("nightly attempt with disjoint resources acquires concurrently");

    assert_eq!(stable.version, PUBLISH_RESOURCE_LEASE_VERSION);
    assert_eq!(stable.owner_attempt_id, "attempt-stable");
    assert_eq!(stable.acquired_at_seconds, 100);
    assert_eq!(stable.expires_at_seconds, 100 + TTL);
    assert!(stable.renewals.is_empty());
    assert_ne!(stable.lease_id, nightly.lease_id);
    assert!(coordinator.active_lease("attempt-stable", 200).is_ok());
    assert!(coordinator.active_lease("attempt-nightly", 200).is_ok());
}

/// 竞争同一仓库写入、发布命名空间或产物身份的 Attempt 被明确阻断，
/// 错误指名冲突资源与当前持有者。
#[test]
fn competing_attempts_are_blocked_per_conflicting_resource() {
    for contested in [
        repository("acme/app"),
        namespace("acme-app/stable/1.0.0"),
        artifact(&"a".repeat(64)),
    ] {
        let coordinator = PublishLeaseCoordinator::new();
        coordinator
            .acquire(
                "attempt-first",
                resources(std::slice::from_ref(&contested)),
                100,
                TTL,
            )
            .expect("first attempt acquires the resource");

        let blocked = coordinator
            .acquire(
                "attempt-second",
                resources(&[contested.clone(), namespace("unrelated")]),
                150,
                TTL,
            )
            .expect_err("second attempt competing for the same resource is blocked");
        match blocked {
            PublishError::LeaseResourceConflict {
                requester,
                holder,
                resource,
            } => {
                assert_eq!(requester, "attempt-second");
                assert_eq!(holder, "attempt-first");
                assert_eq!(resource, contested.display_name());
            }
            other => panic!("expected a lease resource conflict, got {other}"),
        }
        // 阻断不留痕迹：冲突方没有得到任何租约。
        assert!(coordinator.active_lease("attempt-second", 150).is_err());
    }
}

/// 续租延长期限并把每次续租记入不可变历史。
#[test]
fn renewal_extends_the_deadline_and_records_history() {
    let coordinator = PublishLeaseCoordinator::new();
    coordinator
        .acquire("attempt-1", resources(&[repository("acme/app")]), 100, TTL)
        .expect("acquire");

    let renewed = coordinator
        .renew("attempt-1", 300, TTL)
        .expect("renew an active lease");
    assert_eq!(renewed.expires_at_seconds, 300 + TTL);
    assert_eq!(renewed.renewals.len(), 1);
    assert_eq!(renewed.renewals[0].renewed_at_seconds, 300);
    assert_eq!(renewed.renewals[0].expires_at_seconds, 300 + TTL);

    let renewed_again = coordinator
        .renew("attempt-1", 500, TTL)
        .expect("renew again");
    assert_eq!(renewed_again.renewals.len(), 2);
    assert!(coordinator.active_lease("attempt-1", 799).is_ok());
}

/// 过期租约不能续租：所有权不确定时必须显式失败，而不是静默延长。
#[test]
fn expired_leases_cannot_be_renewed() {
    let coordinator = PublishLeaseCoordinator::new();
    coordinator
        .acquire("attempt-1", resources(&[repository("acme/app")]), 100, TTL)
        .expect("acquire");

    let lost = coordinator
        .renew("attempt-1", 100 + TTL, TTL)
        .expect_err("renewing an expired lease fails explicitly");
    assert!(matches!(
        lost,
        PublishError::LeaseLost { ref attempt_id, .. } if attempt_id == "attempt-1"
    ));
}

/// 持有者异常退出后按期限恢复：租约过期前资源仍被保护，
/// 过期后其他 Attempt 可以接管，原持有者随后显式失败。
#[test]
fn expired_leases_are_recovered_by_takeover() {
    let coordinator = PublishLeaseCoordinator::new();
    coordinator
        .acquire(
            "attempt-crashed",
            resources(&[repository("acme/app")]),
            100,
            TTL,
        )
        .expect("acquire before the abnormal exit");

    // 未过期：资源仍受保护。
    assert!(coordinator
        .acquire(
            "attempt-next",
            resources(&[repository("acme/app")]),
            399,
            TTL
        )
        .is_err());

    // 过期后接管成功；原持有者的所有权检查与续租都显式失败。
    let takeover = coordinator
        .acquire(
            "attempt-next",
            resources(&[repository("acme/app")]),
            400,
            TTL,
        )
        .expect("expired resources are recoverable by a new owner");
    assert_eq!(takeover.owner_attempt_id, "attempt-next");
    assert!(matches!(
        coordinator.active_lease("attempt-crashed", 401),
        Err(PublishError::LeaseLost { .. })
    ));
    assert!(matches!(
        coordinator.renew("attempt-crashed", 401, TTL),
        Err(PublishError::LeaseLost { .. })
    ));
}

/// 同一 Attempt 崩溃重启后可在过期前重新取得自己的租约继续工作（恢复规则），
/// 但活跃租约不允许并发的第二次获取。
#[test]
fn an_owner_recovers_its_own_expired_lease() {
    let coordinator = PublishLeaseCoordinator::new();
    coordinator
        .acquire("attempt-1", resources(&[repository("acme/app")]), 100, TTL)
        .expect("acquire");

    // 活跃期内重复获取是调用方错误：所有权应通过续租维持。
    assert!(coordinator
        .acquire("attempt-1", resources(&[repository("acme/app")]), 200, TTL)
        .is_err());

    // 过期后同一 owner 重新获取得到新租约，续租历史重新开始。
    let recovered = coordinator
        .acquire("attempt-1", resources(&[repository("acme/app")]), 500, TTL)
        .expect("the same owner re-acquires after expiry");
    assert_eq!(recovered.acquired_at_seconds, 500);
    assert!(recovered.renewals.is_empty());
}

/// 控制面异常退出后凭持久化租约记录恢复协调器：活跃租约继续受保护并可续租。
#[test]
fn coordinator_restores_persisted_leases_after_abnormal_exit() {
    let coordinator = PublishLeaseCoordinator::new();
    coordinator
        .acquire("attempt-1", resources(&[repository("acme/app")]), 100, TTL)
        .expect("acquire");
    let persisted = coordinator.leases();

    let restored = PublishLeaseCoordinator::restore(persisted).expect("restore from records");
    assert!(restored.active_lease("attempt-1", 200).is_ok());
    assert!(restored
        .acquire("attempt-2", resources(&[repository("acme/app")]), 200, TTL)
        .is_err());
    assert!(restored.renew("attempt-1", 300, TTL).is_ok());
}

/// 恢复时拒绝互相冲突的活跃租约记录：损坏的持久化状态必须显式报错。
#[test]
fn restore_rejects_overlapping_active_leases() {
    let coordinator = PublishLeaseCoordinator::new();
    let first = coordinator
        .acquire("attempt-1", resources(&[repository("acme/app")]), 100, TTL)
        .expect("acquire");
    let mut second = first.clone();
    second.lease_id = "lease-forged".to_string();
    second.owner_attempt_id = "attempt-2".to_string();

    assert!(PublishLeaseCoordinator::restore(vec![first, second]).is_err());
}

/// 正常完成或取消后释放租约：资源立即可被下一次尝试使用。
#[test]
fn released_resources_are_immediately_available() {
    let coordinator = PublishLeaseCoordinator::new();
    coordinator
        .acquire("attempt-1", resources(&[repository("acme/app")]), 100, TTL)
        .expect("acquire");
    coordinator.release("attempt-1").expect("release");

    assert!(matches!(
        coordinator.active_lease("attempt-1", 101),
        Err(PublishError::LeaseLost { .. })
    ));
    assert!(coordinator
        .acquire("attempt-2", resources(&[repository("acme/app")]), 101, TTL)
        .is_ok());
    // 重复释放是调用方错误。
    assert!(coordinator.release("attempt-1").is_err());
}

#[test]
fn release_and_reacquire_in_the_same_second_creates_a_new_lease_epoch() {
    let coordinator = PublishLeaseCoordinator::new();
    let first = coordinator
        .acquire("attempt-1", resources(&[repository("acme/app")]), 100, TTL)
        .expect("acquire first lease epoch");
    coordinator
        .release("attempt-1")
        .expect("release first epoch");

    let second = coordinator
        .acquire("attempt-1", resources(&[repository("acme/app")]), 100, TTL)
        .expect("reacquire in the same second");

    assert_ne!(first.lease_id, second.lease_id);
    assert_eq!(first.acquired_at_seconds, second.acquired_at_seconds);
}

/// Journal 恢复按 lease_id 幂等：同一租约的较新续租快照覆盖旧快照，
/// 较旧快照落地为无操作。
#[test]
fn restore_active_lease_is_idempotent_per_lease_epoch() {
    // 源协调器产生 Journal 记录序列：取得租约 → 续租。
    let source = PublishLeaseCoordinator::new();
    source
        .acquire("attempt-1", resources(&[repository("acme/app")]), 100, TTL)
        .expect("acquire");
    let acquired = source.leases()[0].clone();
    source.renew("attempt-1", 200, TTL).expect("renew");
    let renewed = source.leases()[0].clone();

    // 新协调器按序重放 Journal：较新续租快照覆盖先到的旧快照。
    let coordinator = PublishLeaseCoordinator::new();
    coordinator
        .restore_active_lease(acquired.clone())
        .expect("the first journal record restores into an empty registry");
    coordinator
        .restore_active_lease(renewed)
        .expect("a newer snapshot of the same lease replaces it");
    assert_eq!(
        coordinator
            .active_lease("attempt-1", 450)
            .expect("the extended deadline survives restore")
            .expires_at_seconds,
        200 + TTL
    );

    // 乱序到达的较旧快照是过时重放：不得回退已恢复的期限。
    coordinator
        .restore_active_lease(acquired)
        .expect("an older snapshot of the same lease is a no-op");
    assert_eq!(
        coordinator
            .active_lease("attempt-1", 450)
            .expect("the newer deadline is not rewound")
            .expires_at_seconds,
        200 + TTL
    );
}

/// 同一 Attempt 携带不同 lease_id 的恢复记录说明 Journal 损坏：
/// 显式失败而不是把两个纪元合并。
#[test]
fn restore_active_lease_rejects_conflicting_lease_identities() {
    let coordinator = PublishLeaseCoordinator::new();
    coordinator
        .acquire("attempt-1", resources(&[repository("acme/app")]), 100, TTL)
        .expect("acquire");
    let mut forged = coordinator.leases()[0].clone();
    forged.lease_id = "lease-forged".to_string();

    let error = coordinator
        .restore_active_lease(forged)
        .expect_err("a different lease id for the same attempt is journal corruption");
    match error {
        PublishError::Execution(message) => {
            assert!(message.contains("conflicting active lease identities"))
        }
        other => panic!("expected Execution, got {other}"),
    }
}

/// 同一租约的资源范围在恢复记录间漂移同样是损坏：租约语义不允许
/// 中途改 scope。
#[test]
fn restore_active_lease_rejects_resource_scope_drift() {
    let coordinator = PublishLeaseCoordinator::new();
    coordinator
        .acquire("attempt-1", resources(&[repository("acme/app")]), 100, TTL)
        .expect("acquire");
    let mut drifted = coordinator.leases()[0].clone();
    drifted.resources = resources(&[namespace("acme-app/stable/1.0.0")]);

    let error = coordinator
        .restore_active_lease(drifted)
        .expect_err("a lease cannot change its resource scope");
    match error {
        PublishError::Execution(message) => {
            assert!(message.contains("changed its leased resources"))
        }
        other => panic!("expected Execution, got {other}"),
    }
}

/// 恢复另一 Attempt 的租约时仍执行互斥检查：与持有者冲突的
/// Journal 记录被拒绝，不相交的记录正常入册。
#[test]
fn restore_active_lease_enforces_mutual_exclusion_across_attempts() {
    let coordinator = PublishLeaseCoordinator::new();
    coordinator
        .acquire("attempt-1", resources(&[repository("acme/app")]), 100, TTL)
        .expect("acquire");

    let mut conflicting = coordinator.leases()[0].clone();
    conflicting.lease_id = "lease-other".to_string();
    conflicting.owner_attempt_id = "attempt-2".to_string();
    let error = coordinator
        .restore_active_lease(conflicting)
        .expect_err("a journal lease overlapping a held resource is refused");
    match error {
        PublishError::LeaseResourceConflict {
            requester,
            holder,
            resource,
        } => {
            assert_eq!(requester, "attempt-2");
            assert_eq!(holder, "attempt-1");
            assert_eq!(resource, repository("acme/app").display_name());
        }
        other => panic!("expected a lease resource conflict, got {other}"),
    }

    let mut disjoint = coordinator.leases()[0].clone();
    disjoint.lease_id = "lease-other".to_string();
    disjoint.owner_attempt_id = "attempt-2".to_string();
    disjoint.resources = resources(&[namespace("acme-app/nightly/20260725")]);
    coordinator
        .restore_active_lease(disjoint)
        .expect("disjoint journal leases restore alongside held ones");
    assert!(coordinator.active_lease("attempt-2", 200).is_ok());
}

/// 租约必须限定至少一项具体资源且期限为正：空范围的"全局锁"不被接受。
#[test]
fn acquire_rejects_empty_scope_and_zero_ttl() {
    let coordinator = PublishLeaseCoordinator::new();
    assert!(coordinator
        .acquire("attempt-1", BTreeSet::new(), 100, TTL)
        .is_err());
    assert!(coordinator
        .acquire("attempt-1", resources(&[repository("acme/app")]), 100, 0)
        .is_err());
    assert!(coordinator
        .acquire("  ", resources(&[repository("acme/app")]), 100, TTL)
        .is_err());
}
