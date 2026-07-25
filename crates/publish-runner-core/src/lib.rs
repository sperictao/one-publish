use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use publish_adapters::{
    AdapterExecutionContext, AdapterExecutionOutput, AdapterRegistry, DeliveryProbe,
    PlanNodeExecutor,
};
use publish_domain::{
    declares_artifact_role, sha256_hex, AdapterBinding, AdapterIdentity, AdapterKind,
    ArtifactCandidate, ArtifactManifest, DeliveryEnvelope, DeliveryIdempotencyIdentity,
    DeliveryReceipt, DeliveryStatus, LeaseRenewal, PlanNode, PlanNodeExecutionState, PlanRoute,
    PlanStage, PlanningInputSnapshot, PublishAttemptStatus, PublishAttemptView, PublishError,
    PublishEvent, PublishFailure, PublishOutcome, PublishPlan, PublishResource,
    PublishResourceLease, ReleaseAttempt, ReleaseIdentity, RouteDeliveryView,
    DELIVERY_RECEIPT_VERSION, PUBLISH_EVENT_VERSION, PUBLISH_FAILURE_VERSION, PUBLISH_PLAN_VERSION,
    PUBLISH_RESOURCE_LEASE_VERSION, RELEASE_ATTEMPT_VERSION,
};
use publish_planner::PublishPlanner;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PreparedPublishPlan {
    pub snapshot: PlanningInputSnapshot,
    pub plan: PublishPlan,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReducedPublishEvents {
    pub status: PublishAttemptStatus,
    pub manifest_digest: Option<String>,
    /// 每个 Receipt 的当前修订；完整不可变修订历史在 receipt_history 里。
    pub receipts: Vec<DeliveryReceipt>,
    pub receipt_history: Vec<DeliveryReceipt>,
    /// 事件历史观察到的计划节点状态（ADR-0057）。
    pub node_states: BTreeMap<String, PlanNodeExecutionState>,
    pub routes: Vec<RouteDeliveryView>,
    pub warnings: Vec<String>,
    pub error: Option<String>,
}

/// 路线失败或取消的事件证据：可见错误、终态（Failed 或 Cancelled）与
/// 可选的结构化 Publish Failure Classification。
#[derive(Debug, Clone, PartialEq, Eq)]
struct RouteFailureEvidence {
    error: String,
    status: DeliveryStatus,
    failure: Option<PublishFailure>,
}

pub fn reduce_publish_events(
    events: &[PublishEvent],
    routes: &[PlanRoute],
) -> Result<ReducedPublishEvents, PublishError> {
    let mut manifest_digest = None;
    let mut receipts = BTreeMap::<String, DeliveryReceipt>::new();
    let mut receipt_history = Vec::new();
    let mut node_states = BTreeMap::new();
    let mut route_failures = BTreeMap::<String, RouteFailureEvidence>::new();
    let mut failure = None;
    let mut event_identity: Option<(String, String, String)> = None;
    let known_routes = routes
        .iter()
        .map(|route| route.route_id.as_str())
        .collect::<BTreeSet<_>>();

    for (index, event) in events.iter().enumerate() {
        if event.version != PUBLISH_EVENT_VERSION {
            return Err(PublishError::UnsupportedEventVersion {
                actual: event.version,
                expected: PUBLISH_EVENT_VERSION,
            });
        }
        let expected_sequence = index as u64 + 1;
        if event.sequence != expected_sequence {
            return Err(PublishError::Execution(format!(
                "publish event sequence {} is invalid; expected {expected_sequence}",
                event.sequence
            )));
        }
        let current_identity = (
            event.attempt_id.clone(),
            event.backend_run_id.clone(),
            event.plan_digest.clone(),
        );
        if let Some(expected_identity) = &event_identity {
            if expected_identity != &current_identity {
                return Err(PublishError::Execution(
                    "publish events do not belong to one sealed attempt".to_string(),
                ));
            }
        } else {
            event_identity = Some(current_identity);
        }

        if let Some(digest) = event.payload.get("manifest_digest").and_then(Value::as_str) {
            if let Some(existing) = &manifest_digest {
                if existing != digest {
                    return Err(PublishError::Execution(format!(
                        "publish events bind conflicting artifact manifests {existing} and {digest}"
                    )));
                }
            } else {
                manifest_digest = Some(digest.to_string());
            }
        }

        match event.kind.as_str() {
            "delivery_receipt_observed" => {
                let receipt_value = event.payload.get("receipt").ok_or_else(|| {
                    PublishError::Execution(format!(
                        "publish event {} is missing its delivery receipt revision",
                        event.event_id
                    ))
                })?;
                let receipt: DeliveryReceipt = serde_json::from_value(receipt_value.clone())
                    .map_err(|error| {
                        PublishError::Execution(format!(
                            "publish event {} contains an invalid delivery receipt: {error}",
                            event.event_id
                        ))
                    })?;
                validate_receipt_revision(&receipt)?;
                if !known_routes.contains(receipt.route_id.as_str()) {
                    return Err(PublishError::Execution(format!(
                        "delivery receipt {} references unknown route {}",
                        receipt.receipt_id, receipt.route_id
                    )));
                }
                // 之后的交付观察取代先前的路线失败：安全重试成功让路线离开失败状态。
                route_failures.remove(receipt.route_id.as_str());
                match receipts.get(&receipt.receipt_id) {
                    Some(existing) if receipt.revision < existing.revision => {
                        return Err(PublishError::Execution(format!(
                            "delivery receipt {} revision moved backwards from {} to {}",
                            receipt.receipt_id, existing.revision, receipt.revision
                        )));
                    }
                    Some(existing) if receipt.revision == existing.revision => {
                        if existing != &receipt {
                            return Err(PublishError::Execution(format!(
                                "delivery receipt {} revision {} has conflicting evidence",
                                receipt.receipt_id, receipt.revision
                            )));
                        }
                    }
                    Some(existing) => {
                        validate_receipt_transition(existing, &receipt)?;
                        receipt_history.push(receipt.clone());
                        receipts.insert(receipt.receipt_id.clone(), receipt);
                    }
                    _ => {
                        validate_initial_receipt_revision(&receipt)?;
                        receipt_history.push(receipt.clone());
                        receipts.insert(receipt.receipt_id.clone(), receipt);
                    }
                }
            }
            "route_failed" => {
                let route_id = event
                    .payload
                    .get("route_id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        PublishError::Execution(format!(
                            "publish event {} is missing its failed route id",
                            event.event_id
                        ))
                    })?;
                if !known_routes.contains(route_id) {
                    return Err(PublishError::Execution(format!(
                        "publish event {} references unknown route {route_id}",
                        event.event_id
                    )));
                }
                let error = event
                    .payload
                    .get("error")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("delivery route {route_id} failed"));
                // 结构化分类只从事件证据反序列化，绝不从错误字符串推断；畸形或
                // 版本不符的分类证据是损坏的历史，必须显式报错而不是静默降级（ADR-0056）。
                let failure = event
                    .payload
                    .get("failure")
                    .map(|value| {
                        let failure: PublishFailure = serde_json::from_value(value.clone())
                            .map_err(|error| {
                                PublishError::Execution(format!(
                                    "publish event {} carries an invalid failure classification: {error}",
                                    event.event_id
                                ))
                            })?;
                        if failure.version != PUBLISH_FAILURE_VERSION {
                            return Err(PublishError::UnsupportedFailureVersion {
                                actual: failure.version,
                                expected: PUBLISH_FAILURE_VERSION,
                            });
                        }
                        Ok(failure)
                    })
                    .transpose()?;
                // 最新失败证据覆盖旧值：重试再次失败时呈现当前原因。
                route_failures.insert(
                    route_id.to_string(),
                    RouteFailureEvidence {
                        error,
                        status: DeliveryStatus::Failed,
                        failure,
                    },
                );
                node_states.insert(event.plan_node_id.clone(), PlanNodeExecutionState::Failed);
            }
            // 取消只作用于尚未开始的工作：被取消的节点没有执行，因此只留下
            // 路线级取消证据，不产生节点执行状态；之后同步到的交付观察会像
            // 覆盖失败一样覆盖取消——不可逆边界后的真实副作用赢（ADR-0011/0041）。
            "route_cancelled" => {
                let route_id = event
                    .payload
                    .get("route_id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        PublishError::Execution(format!(
                            "publish event {} is missing its cancelled route id",
                            event.event_id
                        ))
                    })?;
                if !known_routes.contains(route_id) {
                    return Err(PublishError::Execution(format!(
                        "publish event {} references unknown route {route_id}",
                        event.event_id
                    )));
                }
                let error = event
                    .payload
                    .get("error")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("delivery route {route_id} was cancelled"));
                route_failures.insert(
                    route_id.to_string(),
                    RouteFailureEvidence {
                        error,
                        status: DeliveryStatus::Cancelled,
                        failure: None,
                    },
                );
            }
            "plan_node_completed" => {
                node_states.insert(
                    event.plan_node_id.clone(),
                    PlanNodeExecutionState::Completed,
                );
            }
            "plan_node_failed" => {
                node_states.insert(event.plan_node_id.clone(), PlanNodeExecutionState::Failed);
                if failure.is_none() {
                    failure = Some(
                        event
                            .payload
                            .get("error")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                            .unwrap_or_else(|| {
                                format!("publish plan node {} failed", event.plan_node_id)
                            }),
                    );
                }
            }
            _ => {}
        }
    }

    if let Some(expected_manifest) = manifest_digest.as_deref() {
        if let Some(receipt) = receipts
            .values()
            .find(|receipt| receipt.manifest_digest != expected_manifest)
        {
            return Err(PublishError::Execution(format!(
                "delivery receipt {} references manifest {}, expected {expected_manifest}",
                receipt.receipt_id, receipt.manifest_digest
            )));
        }
    }

    let route_views = project_route_views(routes, &receipts, &route_failures);
    let aggregate = aggregate_route_status(&route_views, failure.as_deref());

    Ok(ReducedPublishEvents {
        status: aggregate.status,
        manifest_digest,
        receipts: receipts.into_values().collect(),
        receipt_history,
        node_states,
        routes: route_views,
        warnings: aggregate.warnings,
        error: failure.or(aggregate.error),
    })
}

/// 把最终 Receipt 与路线失败证据投影为逐路线视图；无任何证据的路线保持 Pending。
fn project_route_views(
    routes: &[PlanRoute],
    receipts: &BTreeMap<String, DeliveryReceipt>,
    route_failures: &BTreeMap<String, RouteFailureEvidence>,
) -> Vec<RouteDeliveryView> {
    routes
        .iter()
        .map(|route| {
            let mut view = RouteDeliveryView {
                route_id: route.route_id.clone(),
                required: route.required,
                status: DeliveryStatus::Pending,
                external_reference: None,
                error: None,
                failure: None,
            };
            let route_receipts = receipts
                .values()
                .filter(|receipt| receipt.route_id == route.route_id)
                .collect::<Vec<_>>();
            for receipt in &route_receipts {
                view.external_reference = Some(receipt.external_reference.clone());
                if is_failed_delivery_status(receipt.status) && view.error.is_none() {
                    view.status = receipt.status;
                    view.error = Some(failed_receipt_message(receipt));
                }
            }
            // 路线状态取全部 Receipt 中最落后的生命周期阶段：只有全部 Published
            // 才呈现 Published，上传或 Staged 不等同于成功（ADR-0039）。
            if view.error.is_none() {
                if let Some(least_advanced) = route_receipts
                    .iter()
                    .map(|receipt| receipt.status)
                    .min_by_key(|status| delivery_status_rank(*status))
                {
                    view.status = least_advanced;
                }
            }
            if let Some(evidence) = route_failures.get(&route.route_id) {
                view.error = Some(evidence.error.clone());
                view.failure = evidence.failure.clone();
                if !is_failed_delivery_status(view.status) {
                    view.status = evidence.status;
                }
            }
            view
        })
        .collect()
}

struct AggregatedRouteStatus {
    status: PublishAttemptStatus,
    warnings: Vec<String>,
    error: Option<String>,
}

/// 聚合规则（ADR-0022/0039/0041）：只有 Published 满足 Required Route；Required
/// 失败且至少一条路线成功进入 Partial Delivery；Optional 失败只产生警告，
/// Optional 未完结也不阻止已满足的 Required 结果聚合为 Published。尚无任何
/// 交付且全部未完成路线都被取消时，尝试是 Cancelled 而不是 Failed。
fn aggregate_route_status(
    routes: &[RouteDeliveryView],
    global_failure: Option<&str>,
) -> AggregatedRouteStatus {
    let failed = |view: &RouteDeliveryView| view.error.is_some();
    let published = |view: &RouteDeliveryView| view.status == DeliveryStatus::Published;
    let describe_failure = |prefix: &str, view: &RouteDeliveryView| {
        format!(
            "{prefix}delivery route {} failed: {}",
            view.route_id,
            view.error.as_deref().unwrap_or("unknown failure")
        )
    };
    // 未完成路线全部来自取消（而不是真实失败）时，无交付的结果是 Cancelled。
    let only_cancelled = routes.iter().any(failed)
        && routes
            .iter()
            .filter(|view| failed(view))
            .all(|view| view.status == DeliveryStatus::Cancelled);

    let warnings = routes
        .iter()
        .filter(|view| !view.required && failed(view))
        .map(|view| describe_failure("optional ", view))
        .collect::<Vec<_>>();
    let required_failures = routes
        .iter()
        .filter(|view| view.required && failed(view))
        .map(|view| describe_failure("required ", view))
        .collect::<Vec<_>>();

    if global_failure.is_some() {
        return AggregatedRouteStatus {
            status: PublishAttemptStatus::Failed,
            warnings,
            error: None,
        };
    }
    let status = if !routes.is_empty() && routes.iter().all(failed) {
        if only_cancelled {
            PublishAttemptStatus::Cancelled
        } else {
            PublishAttemptStatus::Failed
        }
    } else if !required_failures.is_empty() {
        if routes.iter().any(published) {
            PublishAttemptStatus::PartialDelivery
        } else if only_cancelled {
            PublishAttemptStatus::Cancelled
        } else {
            PublishAttemptStatus::Failed
        }
    } else if routes.iter().any(published)
        && routes.iter().filter(|view| view.required).all(published)
    {
        PublishAttemptStatus::Published
    } else {
        PublishAttemptStatus::Running
    };
    let error = match status {
        PublishAttemptStatus::Failed | PublishAttemptStatus::PartialDelivery => {
            let failures = if required_failures.is_empty() {
                routes
                    .iter()
                    .filter(|view| failed(view))
                    .map(|view| describe_failure("", view))
                    .collect::<Vec<_>>()
            } else {
                required_failures
            };
            (!failures.is_empty()).then(|| failures.join("; "))
        }
        _ => None,
    };
    AggregatedRouteStatus {
        status,
        warnings,
        error,
    }
}

fn validate_receipt_revision(receipt: &DeliveryReceipt) -> Result<(), PublishError> {
    if receipt.version != DELIVERY_RECEIPT_VERSION
        || receipt.revision == 0
        || receipt.receipt_id.trim().is_empty()
        || receipt.route_id.trim().is_empty()
        || receipt.manifest_digest.trim().is_empty()
        || receipt.external_reference.trim().is_empty()
    {
        return Err(PublishError::Execution(format!(
            "delivery receipt {} has invalid immutable revision evidence",
            receipt.receipt_id
        )));
    }
    Ok(())
}

fn validate_initial_receipt_revision(receipt: &DeliveryReceipt) -> Result<(), PublishError> {
    if receipt.revision != 1 {
        return Err(PublishError::Execution(format!(
            "delivery receipt {} must start at revision 1, got {}",
            receipt.receipt_id, receipt.revision
        )));
    }
    Ok(())
}

fn validate_receipt_transition(
    previous: &DeliveryReceipt,
    next: &DeliveryReceipt,
) -> Result<(), PublishError> {
    let expected_revision = previous.revision.checked_add(1).ok_or_else(|| {
        PublishError::Execution(format!(
            "delivery receipt {} exhausted its revision range",
            previous.receipt_id
        ))
    })?;
    if next.revision != expected_revision {
        return Err(PublishError::Execution(format!(
            "delivery receipt {} revision {} is not continuous after revision {}",
            next.receipt_id, next.revision, previous.revision
        )));
    }
    if next.route_id != previous.route_id
        || next.manifest_digest != previous.manifest_digest
        || next.external_reference != previous.external_reference
    {
        return Err(PublishError::Execution(format!(
            "delivery receipt {} changed its stable identity at revision {}",
            next.receipt_id, next.revision
        )));
    }
    if !is_valid_delivery_transition(previous.status, next.status) {
        return Err(PublishError::Execution(format!(
            "delivery receipt {} has invalid lifecycle transition {} -> {}",
            next.receipt_id,
            delivery_status_name(previous.status),
            delivery_status_name(next.status)
        )));
    }
    Ok(())
}

fn is_valid_delivery_transition(previous: DeliveryStatus, next: DeliveryStatus) -> bool {
    match previous {
        DeliveryStatus::Pending => true,
        DeliveryStatus::Staged => !matches!(next, DeliveryStatus::Pending),
        DeliveryStatus::Submitted => {
            !matches!(next, DeliveryStatus::Pending | DeliveryStatus::Staged)
        }
        DeliveryStatus::Published
        | DeliveryStatus::Failed
        | DeliveryStatus::Rejected
        | DeliveryStatus::Cancelled
        | DeliveryStatus::Expired => false,
    }
}

fn is_failed_delivery_status(status: DeliveryStatus) -> bool {
    matches!(
        status,
        DeliveryStatus::Failed
            | DeliveryStatus::Rejected
            | DeliveryStatus::Cancelled
            | DeliveryStatus::Expired
    )
}

fn failed_receipt_message(receipt: &DeliveryReceipt) -> String {
    format!(
        "delivery receipt {} is {}",
        receipt.receipt_id,
        delivery_status_name(receipt.status)
    )
}

/// 控制面事件账本：以版本化、追加且可去重的 Publish Event 作为一次发布尝试
/// 的唯一状态事实。乱序批次按因果序号归位，重复事件被吸收，同一序号的冲突
/// 证据被拒绝而不是 last-write-wins 覆盖；无法解释的缺口阻断状态归约并按
/// 范围报告，供控制面显式请求缺失区间（ADR-0057）。
pub struct AttemptEventLog {
    attempt_id: String,
    backend_run_id: String,
    plan_digest: String,
    events: BTreeMap<u64, PublishEvent>,
    sequences_by_event_id: BTreeMap<String, u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EventSyncReport {
    pub accepted: usize,
    pub duplicates: usize,
    /// 同步后仍无法解释的序号缺口（闭区间）；非空时归约保持阻断。
    pub missing: Vec<(u64, u64)>,
}

impl AttemptEventLog {
    pub fn new(attempt: &ReleaseAttempt) -> Result<Self, PublishError> {
        if attempt.version != RELEASE_ATTEMPT_VERSION {
            return Err(PublishError::UnsupportedAttemptVersion {
                actual: attempt.version,
                expected: RELEASE_ATTEMPT_VERSION,
            });
        }
        Ok(Self {
            attempt_id: attempt.attempt_id.clone(),
            backend_run_id: attempt.backend_run_id.clone(),
            plan_digest: attempt.plan_digest.clone(),
            events: BTreeMap::new(),
            sequences_by_event_id: BTreeMap::new(),
        })
    }

    /// 原子同步一批本地或远端事件：整批验证通过后才提交，被拒绝的批次不留痕迹。
    pub fn sync(&mut self, incoming: &[PublishEvent]) -> Result<EventSyncReport, PublishError> {
        let mut staged = BTreeMap::<u64, PublishEvent>::new();
        let mut duplicates = 0usize;
        for event in incoming {
            self.validate_event(event)?;
            match self
                .events
                .get(&event.sequence)
                .or_else(|| staged.get(&event.sequence))
            {
                Some(existing) if existing == event => duplicates += 1,
                Some(_) => {
                    return Err(PublishError::Execution(format!(
                        "publish event sequence {} carries conflicting evidence for attempt {}",
                        event.sequence, self.attempt_id
                    )));
                }
                None => {
                    let known_sequence =
                        self.sequences_by_event_id.get(&event.event_id).or_else(|| {
                            staged
                                .values()
                                .find(|staged_event| staged_event.event_id == event.event_id)
                                .map(|staged_event| &staged_event.sequence)
                        });
                    if known_sequence.is_some() {
                        return Err(PublishError::Execution(format!(
                            "publish event {} appears under conflicting sequences",
                            event.event_id
                        )));
                    }
                    staged.insert(event.sequence, event.clone());
                }
            }
        }

        let accepted = staged.len();
        for (sequence, event) in staged {
            self.sequences_by_event_id
                .insert(event.event_id.clone(), sequence);
            self.events.insert(sequence, event);
        }
        Ok(EventSyncReport {
            accepted,
            duplicates,
            missing: self.missing_ranges(),
        })
    }

    fn validate_event(&self, event: &PublishEvent) -> Result<(), PublishError> {
        if event.version != PUBLISH_EVENT_VERSION {
            return Err(PublishError::UnsupportedEventVersion {
                actual: event.version,
                expected: PUBLISH_EVENT_VERSION,
            });
        }
        if event.attempt_id != self.attempt_id
            || event.backend_run_id != self.backend_run_id
            || event.plan_digest != self.plan_digest
        {
            return Err(PublishError::Execution(format!(
                "publish event {} does not belong to attempt {} (backend run {}, plan {})",
                event.event_id, self.attempt_id, self.backend_run_id, self.plan_digest
            )));
        }
        if event.sequence == 0 || event.event_id.trim().is_empty() {
            return Err(PublishError::Execution(format!(
                "publish events require a stable event id and a positive causal sequence, got {} at {}",
                event.event_id, event.sequence
            )));
        }
        Ok(())
    }

    /// 已知最大序号之下仍未收到的序号闭区间；因果序列从 1 开始。
    pub fn missing_ranges(&self) -> Vec<(u64, u64)> {
        let mut missing = Vec::new();
        let mut expected = 1u64;
        for &sequence in self.events.keys() {
            if sequence > expected {
                missing.push((expected, sequence - 1));
            }
            expected = sequence + 1;
        }
        missing
    }

    /// 以外部声明的最高序号为界报告缺口：尾部截断只有对照后端或远端存储
    /// 声明的高水位才可检测，报告结果供控制面显式请求缺失范围（ADR-0057）。
    pub fn missing_ranges_through(&self, last_known_sequence: u64) -> Vec<(u64, u64)> {
        let mut missing = self.missing_ranges();
        let next = self
            .events
            .keys()
            .next_back()
            .map_or(1, |sequence| sequence + 1);
        if next <= last_known_sequence {
            missing.push((next, last_known_sequence));
        }
        missing
    }

    /// 去重后的因果序列，按序号升序。
    pub fn events(&self) -> Vec<PublishEvent> {
        self.events.values().cloned().collect()
    }

    /// 确定性归约当前状态；存在无法解释的缺口时阻断并报告缺失范围。
    pub fn reduce(&self, routes: &[PlanRoute]) -> Result<ReducedPublishEvents, PublishError> {
        let missing = self.missing_ranges();
        if !missing.is_empty() {
            return Err(PublishError::EventSequenceGap { missing });
        }
        reduce_publish_events(&self.events(), routes)
    }
}

/// 控制面重启后仅凭持久化的 Attempt 记录与事件历史重建当前状态。Attempt
/// 身份保持稳定（ADR-0040）；Manifest 本体不随事件传输，恢复出的 digest 由
/// 产物存储另行验证（ADR-0057），因此视图的 manifest 字段为空。
pub fn recover_attempt_view(
    attempt: &ReleaseAttempt,
    routes: &[PlanRoute],
    events: &[PublishEvent],
) -> Result<PublishAttemptView, PublishError> {
    let mut log = AttemptEventLog::new(attempt)?;
    log.sync(events)?;
    let projection = log.reduce(routes)?;

    let mut recovered = attempt.clone();
    // Manifest 绑定只能写入一次：既有绑定与事件归约不一致就是身份冲突（ADR-0040）。
    match (
        recovered.manifest_digest.as_deref(),
        projection.manifest_digest.as_deref(),
    ) {
        (Some(bound), Some(reduced)) if bound != reduced => {
            return Err(PublishError::Execution(format!(
                "release attempt {} is bound to artifact manifest {bound}, but its events reduce to {reduced}",
                recovered.attempt_id
            )));
        }
        (None, Some(_)) => recovered.manifest_digest = projection.manifest_digest.clone(),
        _ => {}
    }
    // 推广的尝试可以只带交付观察：Receipt 引用的 Manifest 摘要必须与最终绑定一致。
    if let Some(bound) = recovered.manifest_digest.as_deref() {
        if let Some(receipt) = projection
            .receipts
            .iter()
            .find(|receipt| receipt.manifest_digest != bound)
        {
            return Err(PublishError::Execution(format!(
                "delivery receipt {} references manifest {}, but attempt {} is bound to {bound}",
                receipt.receipt_id, receipt.manifest_digest, recovered.attempt_id
            )));
        }
    }

    Ok(PublishAttemptView {
        attempt: recovered,
        status: projection.status,
        manifest: None,
        events: log.events(),
        receipts: projection.receipts,
        receipt_history: projection.receipt_history,
        node_states: projection.node_states,
        routes: projection.routes,
        warnings: projection.warnings,
        error: projection.error,
    })
}

/// 发布资源租约协调器（ADR-0042）：以资源集合的交集判定冲突，取代仓库级
/// 全局互斥。租约记录在释放前一直保留——过期不删除，让失去所有权的
/// Attempt 在校验时得到明确的 LeaseLost，而不是被误判为"无需租约"。
/// 时间是显式输入，协调器不读系统时钟；持久化与恢复由控制面通过
/// `leases`/`restore` 完成。
pub struct PublishLeaseCoordinator {
    leases: Mutex<BTreeMap<String, PublishResourceLease>>,
}

impl Default for PublishLeaseCoordinator {
    fn default() -> Self {
        Self::new()
    }
}

impl PublishLeaseCoordinator {
    pub fn new() -> Self {
        Self {
            leases: Mutex::new(BTreeMap::new()),
        }
    }

    /// 异常退出后凭持久化租约记录重建协调器；互相冲突的活跃记录是
    /// 损坏的状态，必须显式报错而不是静默择一。
    pub fn restore(leases: Vec<PublishResourceLease>) -> Result<Self, PublishError> {
        let coordinator = Self::new();
        {
            let mut held = coordinator.lock_leases()?;
            for lease in leases {
                lease.validate()?;
                for existing in held.values() {
                    if let Some(resource) = conflicting_resource(existing, &lease.resources) {
                        return Err(PublishError::LeaseResourceConflict {
                            requester: lease.owner_attempt_id.clone(),
                            holder: existing.owner_attempt_id.clone(),
                            resource,
                        });
                    }
                }
                if held.insert(lease.owner_attempt_id.clone(), lease).is_some() {
                    return Err(PublishError::Execution(
                        "persisted lease records carry conflicting evidence for one attempt"
                            .to_string(),
                    ));
                }
            }
        }
        Ok(coordinator)
    }

    /// 为一次发布尝试取得资源租约：任一资源被未过期租约持有即明确阻断；
    /// 过期租约让位（含同一 owner 的过期租约，即崩溃后的恢复规则）。
    pub fn acquire(
        &self,
        owner_attempt_id: &str,
        resources: BTreeSet<PublishResource>,
        now_seconds: u64,
        ttl_seconds: u64,
    ) -> Result<PublishResourceLease, PublishError> {
        validate_lease_ttl(ttl_seconds)?;
        let mut held = self.lock_leases()?;
        if let Some(existing) = held.get(owner_attempt_id) {
            if !existing.is_expired(now_seconds) {
                return Err(PublishError::Execution(format!(
                    "publish attempt {owner_attempt_id} already holds an active lease; ownership is maintained through renewal"
                )));
            }
        }
        for existing in held.values() {
            if existing.owner_attempt_id == owner_attempt_id || existing.is_expired(now_seconds) {
                continue;
            }
            if let Some(resource) = conflicting_resource(existing, &resources) {
                return Err(PublishError::LeaseResourceConflict {
                    requester: owner_attempt_id.to_string(),
                    holder: existing.owner_attempt_id.clone(),
                    resource,
                });
            }
        }
        let mut lease_identity = format!("{owner_attempt_id}:{now_seconds}");
        for resource in &resources {
            lease_identity.push(':');
            lease_identity.push_str(&resource.display_name());
        }
        let lease = PublishResourceLease {
            version: PUBLISH_RESOURCE_LEASE_VERSION,
            lease_id: sha256_hex(lease_identity.as_bytes()),
            owner_attempt_id: owner_attempt_id.to_string(),
            resources,
            acquired_at_seconds: now_seconds,
            expires_at_seconds: now_seconds + ttl_seconds,
            renewals: Vec::new(),
        };
        lease.validate()?;
        held.insert(owner_attempt_id.to_string(), lease.clone());
        Ok(lease)
    }

    /// 续租延长期限并记录续租历史；过期租约不能续租，必须重新获取。
    pub fn renew(
        &self,
        owner_attempt_id: &str,
        now_seconds: u64,
        ttl_seconds: u64,
    ) -> Result<PublishResourceLease, PublishError> {
        validate_lease_ttl(ttl_seconds)?;
        let mut held = self.lock_leases()?;
        let lease = held
            .get_mut(owner_attempt_id)
            .ok_or_else(|| lease_not_held(owner_attempt_id))?;
        if lease.is_expired(now_seconds) {
            return Err(PublishError::LeaseLost {
                attempt_id: owner_attempt_id.to_string(),
                reason: format!(
                    "the lease expired at {} and cannot be renewed",
                    lease.expires_at_seconds
                ),
            });
        }
        lease.expires_at_seconds = now_seconds + ttl_seconds;
        lease.renewals.push(LeaseRenewal {
            renewed_at_seconds: now_seconds,
            expires_at_seconds: lease.expires_at_seconds,
        });
        Ok(lease.clone())
    }

    /// 正常完成或取消后释放租约；释放未持有的租约是调用方错误。
    pub fn release(&self, owner_attempt_id: &str) -> Result<(), PublishError> {
        let mut held = self.lock_leases()?;
        held.remove(owner_attempt_id)
            .map(|_| ())
            .ok_or_else(|| lease_not_held(owner_attempt_id))
    }

    /// 所有权校验：该 Attempt 持有且未过期的租约；否则显式 LeaseLost。
    pub fn active_lease(
        &self,
        owner_attempt_id: &str,
        now_seconds: u64,
    ) -> Result<PublishResourceLease, PublishError> {
        let held = self.lock_leases()?;
        let lease = held
            .get(owner_attempt_id)
            .ok_or_else(|| lease_not_held(owner_attempt_id))?;
        if lease.is_expired(now_seconds) {
            return Err(PublishError::LeaseLost {
                attempt_id: owner_attempt_id.to_string(),
                reason: format!("the lease expired at {}", lease.expires_at_seconds),
            });
        }
        Ok(lease.clone())
    }

    /// 执行前的所有权门槛（单次取锁）：留有租约记录的尝试必须未过期——
    /// 过期记录在释放前一直保留，让失去所有权的执行得到 LeaseLost；
    /// 无记录的尝试不受限（计划未声明共享资源，ADR-0042）。
    pub fn verify_ownership(
        &self,
        owner_attempt_id: &str,
        now_seconds: u64,
    ) -> Result<(), PublishError> {
        let held = self.lock_leases()?;
        match held.get(owner_attempt_id) {
            Some(lease) if lease.is_expired(now_seconds) => Err(PublishError::LeaseLost {
                attempt_id: owner_attempt_id.to_string(),
                reason: format!("the lease expired at {}", lease.expires_at_seconds),
            }),
            _ => Ok(()),
        }
    }

    /// 当前全部租约记录（含已过期未释放的），供控制面持久化。
    pub fn leases(&self) -> Vec<PublishResourceLease> {
        self.leases
            .lock()
            .map(|held| held.values().cloned().collect())
            .unwrap_or_default()
    }

    fn lock_leases(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, BTreeMap<String, PublishResourceLease>>, PublishError>
    {
        self.leases.lock().map_err(|_| {
            PublishError::Execution("publish lease registry lock is poisoned".to_string())
        })
    }
}

/// 冲突判定的唯一实现：两份资源集合按种类与 key 的交集判定，无目标特例。
fn conflicting_resource(
    existing: &PublishResourceLease,
    requested: &BTreeSet<PublishResource>,
) -> Option<String> {
    existing
        .resources
        .intersection(requested)
        .next()
        .map(PublishResource::display_name)
}

fn lease_not_held(attempt_id: &str) -> PublishError {
    PublishError::LeaseLost {
        attempt_id: attempt_id.to_string(),
        reason: "no lease is held for this attempt".to_string(),
    }
}

fn validate_lease_ttl(ttl_seconds: u64) -> Result<(), PublishError> {
    if ttl_seconds == 0 {
        return Err(PublishError::Execution(
            "publish resource leases require a positive time-to-live".to_string(),
        ));
    }
    Ok(())
}

/// 协作取消信号（ADR-0041）：只表达"请求停止尚未开始的工作"。已开始的
/// 节点不被中断，已 Published 的路线与既有 Receipt 保持不变。
#[derive(Clone, Default)]
pub struct CancellationSignal(Arc<AtomicBool>);

impl CancellationSignal {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn request(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn is_requested(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// 一次尝试执行的显式环境：时间与取消信号都由调用方注入，
/// 运行核心不读系统时钟，也不隐藏取消状态。
pub struct AttemptExecutionContext {
    pub now_seconds: u64,
    pub cancellation: CancellationSignal,
}

impl AttemptExecutionContext {
    pub fn at(now_seconds: u64) -> Self {
        Self {
            now_seconds,
            cancellation: CancellationSignal::default(),
        }
    }

    pub fn with_cancellation(mut self, cancellation: CancellationSignal) -> Self {
        self.cancellation = cancellation;
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StartPublishAttempt {
    pub attempt_id: String,
    pub backend_run_id: String,
    pub release_identity: ReleaseIdentity,
}

impl StartPublishAttempt {
    pub fn new(
        attempt_id: impl Into<String>,
        backend_run_id: impl Into<String>,
        release_identity: ReleaseIdentity,
    ) -> Self {
        Self {
            attempt_id: attempt_id.into(),
            backend_run_id: backend_run_id.into(),
            release_identity,
        }
    }
}

/// 一次续传请求对失败路线的完整处置：重试、复用远端一致交付或带原因阻断。
#[derive(Default)]
struct RouteRetryDecisions {
    retry_routes: BTreeSet<String>,
    reused_deliveries: Vec<ReusedDelivery>,
    blocked: Vec<String>,
}

/// 幂等探测确认远端摘要一致后可直接复用的交付：路线、其交付节点与外部引用。
struct ReusedDelivery {
    route_id: String,
    publish_node_id: String,
    external_reference: String,
}

/// 续传互斥占位：构造时登记尝试，Drop 时释放，让并发 resume 显式失败
/// 而不是重复执行外部副作用。
struct ResumeSlot<'a> {
    attempts: &'a Mutex<BTreeSet<String>>,
    attempt_id: String,
}

impl<'a> ResumeSlot<'a> {
    fn acquire(
        attempts: &'a Mutex<BTreeSet<String>>,
        attempt_id: &str,
    ) -> Result<Self, PublishError> {
        let mut resuming = attempts.lock().map_err(|_| {
            PublishError::Execution("publish attempt registry lock is poisoned".to_string())
        })?;
        if !resuming.insert(attempt_id.to_string()) {
            return Err(PublishError::Execution(format!(
                "publish attempt {attempt_id} is already being resumed"
            )));
        }
        Ok(Self {
            attempts,
            attempt_id: attempt_id.to_string(),
        })
    }
}

impl Drop for ResumeSlot<'_> {
    fn drop(&mut self) {
        if let Ok(mut resuming) = self.attempts.lock() {
            resuming.remove(&self.attempt_id);
        }
    }
}

pub struct PublishRuntime {
    registry: AdapterRegistry,
    /// 并发的唯一权威（ADR-0042）：按计划声明的具体资源协调，不设仓库级互斥。
    /// 可通过 with_lease_coordinator 与其他运行时实例共享同一权威。
    leases: Arc<PublishLeaseCoordinator>,
    started_attempts: Mutex<BTreeSet<String>>,
    /// 正在续传的尝试：阻止同一尝试的并发 resume 重复执行外部副作用。
    resuming_attempts: Mutex<BTreeSet<String>>,
}

impl PublishRuntime {
    pub fn new(registry: AdapterRegistry) -> Self {
        Self::with_lease_coordinator(registry, Arc::new(PublishLeaseCoordinator::new()))
    }

    pub fn with_lease_coordinator(
        registry: AdapterRegistry,
        leases: Arc<PublishLeaseCoordinator>,
    ) -> Self {
        Self {
            registry,
            leases,
            started_attempts: Mutex::new(BTreeSet::new()),
            resuming_attempts: Mutex::new(BTreeSet::new()),
        }
    }

    pub fn leases(&self) -> &PublishLeaseCoordinator {
        self.leases.as_ref()
    }

    /// 所有权门槛：委托租约协调器单锁校验（ADR-0042）。
    fn verify_attempt_ownership(
        &self,
        attempt_id: &str,
        now_seconds: u64,
    ) -> Result<(), PublishError> {
        self.leases.verify_ownership(attempt_id, now_seconds)
    }

    pub fn prepare(&self, snapshot: &PlanningInputSnapshot) -> Result<PublishPlan, PublishError> {
        PublishPlanner::new(&self.registry).prepare(snapshot)
    }

    pub fn prepare_attempt(
        &self,
        snapshot: &PlanningInputSnapshot,
    ) -> Result<PreparedPublishPlan, PublishError> {
        Ok(PreparedPublishPlan {
            snapshot: snapshot.clone(),
            plan: self.prepare(snapshot)?,
        })
    }

    pub fn start_attempt(
        &self,
        prepared: &PreparedPublishPlan,
        request: StartPublishAttempt,
        context: &AttemptExecutionContext,
    ) -> Result<PublishAttemptView, PublishError> {
        if request.attempt_id.trim().is_empty() || request.backend_run_id.trim().is_empty() {
            return Err(PublishError::Execution(
                "publish attempt and backend run ids cannot be empty".to_string(),
            ));
        }
        let current_plan = self.prepare(&prepared.snapshot)?;
        if current_plan != prepared.plan {
            return Err(PublishError::InvalidPlan(
                "prepared publish plan no longer matches its planning input snapshot".to_string(),
            ));
        }
        // 任何副作用之前先确认资源所有权（ADR-0042）。
        self.verify_attempt_ownership(&request.attempt_id, context.now_seconds)?;
        let mut started_attempts = self.started_attempts.lock().map_err(|_| {
            PublishError::Execution("publish attempt registry lock is poisoned".to_string())
        })?;
        if !started_attempts.insert(request.attempt_id.clone()) {
            return Err(PublishError::AttemptAlreadyStarted {
                attempt_id: request.attempt_id,
            });
        }
        drop(started_attempts);

        let attempt = ReleaseAttempt {
            version: RELEASE_ATTEMPT_VERSION,
            attempt_id: request.attempt_id,
            configuration_revision: prepared.snapshot.configuration_revision.clone(),
            planning_snapshot_digest: prepared.plan.snapshot_digest.clone(),
            plan_version: prepared.plan.version,
            plan_digest: prepared.plan.digest.clone(),
            release_identity: request.release_identity,
            execution_backend: prepared.plan.execution_backend.clone(),
            runtime_revision: prepared.snapshot.runtime_revision.clone(),
            backend_run_id: request.backend_run_id,
            manifest_digest: None,
        };
        let attempt_id = attempt.attempt_id.clone();
        let backend_run_id = attempt.backend_run_id.clone();
        let mut executor =
            RuntimeNodeExecutor::new(&self.registry, &prepared.plan, &attempt_id, &backend_run_id)
                .with_cancellation(context.cancellation.clone());
        if let Err(error) = verify_plan_credentials(&self.registry, &prepared.plan) {
            return executor.finish_failed_attempt(attempt, error);
        }
        match self.registry.execute_plan(
            &prepared.plan.execution_backend,
            &prepared.plan,
            &mut executor,
        ) {
            Ok(()) => executor.finish_attempt(&prepared.plan, attempt),
            Err(error) => executor.finish_failed_attempt(attempt, error),
        }
    }

    /// 安全续传一次失败或部分交付的发布尝试：只有分类允许自动重试且幂等探测
    /// 确认安全的失败路线才重新交付；共享构建、处理、封存与成功路线一律不再
    /// 执行（ADR-0022/0040/0051/0056）。
    pub fn resume_attempt(
        &self,
        prepared: &PreparedPublishPlan,
        view: &PublishAttemptView,
        context: &AttemptExecutionContext,
    ) -> Result<PublishAttemptView, PublishError> {
        let current_plan = self.prepare(&prepared.snapshot)?;
        if current_plan != prepared.plan {
            return Err(PublishError::InvalidPlan(
                "prepared publish plan no longer matches its planning input snapshot".to_string(),
            ));
        }
        let attempt = &view.attempt;
        if attempt.version != RELEASE_ATTEMPT_VERSION {
            return Err(PublishError::UnsupportedAttemptVersion {
                actual: attempt.version,
                expected: RELEASE_ATTEMPT_VERSION,
            });
        }
        // 续传不得改变尝试身份：视图必须属于这份封存计划（ADR-0040）。
        if attempt.plan_digest != prepared.plan.digest
            || attempt.planning_snapshot_digest != prepared.plan.snapshot_digest
            || attempt.plan_version != prepared.plan.version
            || attempt.execution_backend != prepared.plan.execution_backend
            || attempt.configuration_revision != prepared.snapshot.configuration_revision
            || attempt.runtime_revision != prepared.snapshot.runtime_revision
        {
            return Err(PublishError::InvalidPlan(
                "resume must keep the publish attempt identity stable; the view belongs to a different plan"
                    .to_string(),
            ));
        }
        let manifest = view
            .manifest
            .clone()
            .ok_or(PublishError::MissingArtifactManifest)?;
        if attempt.manifest_digest.as_deref() != Some(manifest.digest.as_str()) {
            return Err(PublishError::Execution(format!(
                "resume manifest {} does not match the attempt's sealed manifest binding",
                manifest.digest
            )));
        }

        // 同一尝试同一时刻只允许一次续传：并发 resume 会重复执行外部副作用。
        let _resume_slot = ResumeSlot::acquire(&self.resuming_attempts, &attempt.attempt_id)?;

        // 续传同样先确认资源所有权，再评估或触碰任何远端状态（ADR-0042）。
        self.verify_attempt_ownership(&attempt.attempt_id, context.now_seconds)?;

        // 路线状态只从追加事件历史确定性归约，不信任调用者预先算好的视图（ADR-0057）。
        let projection = reduce_publish_events(&view.events, &prepared.plan.routes)?;
        if projection.manifest_digest.as_deref() != Some(manifest.digest.as_str()) {
            return Err(PublishError::Execution(
                "the attempt's events did not bind the manifest offered for resume".to_string(),
            ));
        }

        let decisions = self.evaluate_failed_routes(prepared, attempt, &manifest, &projection)?;
        if decisions.retry_routes.is_empty() && decisions.reused_deliveries.is_empty() {
            let reasons = if decisions.blocked.is_empty() {
                vec!["the attempt has no failed delivery route".to_string()]
            } else {
                decisions.blocked
            };
            return Err(PublishError::AutomaticRetryBlocked { reasons });
        }

        let mut executor = RuntimeNodeExecutor::new(
            &self.registry,
            &prepared.plan,
            &attempt.attempt_id,
            &attempt.backend_run_id,
        )
        .with_cancellation(context.cancellation.clone());
        executor.events = view.events.clone();
        executor.manifest = Some(manifest.clone());
        executor.receipts = view.receipt_history.clone();
        let reused_route_ids = decisions
            .reused_deliveries
            .iter()
            .map(|reused| reused.route_id.clone())
            .collect::<BTreeSet<_>>();
        for route in &projection.routes {
            let Some(error) = &route.error else { continue };
            if !decisions.retry_routes.contains(&route.route_id)
                && !reused_route_ids.contains(&route.route_id)
            {
                executor
                    .failed_routes
                    .insert(route.route_id.clone(), error.clone());
            }
        }
        for node in &prepared.plan.nodes {
            if decisions.retry_routes.contains(&node.binding_id)
                || executor.failed_routes.contains_key(&node.binding_id)
            {
                continue;
            }
            if reused_route_ids.contains(&node.binding_id)
                || projection.node_states.get(&node.id) == Some(&PlanNodeExecutionState::Completed)
            {
                executor.resume_completed.insert(node.id.clone());
                continue;
            }
            return Err(PublishError::Execution(format!(
                "plan node {} has no completed evidence in the attempt history; it cannot be resumed safely",
                node.id
            )));
        }
        for reused in decisions.reused_deliveries {
            executor.reuse_receipt(&reused, &manifest.digest)?;
        }

        let attempt = attempt.clone();
        match self.registry.execute_plan(
            &prepared.plan.execution_backend,
            &prepared.plan,
            &mut executor,
        ) {
            Ok(()) => executor.finish_attempt(&prepared.plan, attempt),
            Err(error) => executor.finish_failed_attempt(attempt, error),
        }
    }

    /// 逐条评估失败路线的自动重试资格：先看结构化分类，再做幂等探测；
    /// 四种探测结果分别对应重试、复用、冲突阻断与不可探测阻断（ADR-0051/0056）。
    fn evaluate_failed_routes(
        &self,
        prepared: &PreparedPublishPlan,
        attempt: &ReleaseAttempt,
        manifest: &ArtifactManifest,
        projection: &ReducedPublishEvents,
    ) -> Result<RouteRetryDecisions, PublishError> {
        let mut decisions = RouteRetryDecisions::default();
        for route in &projection.routes {
            let Some(error) = &route.error else { continue };
            let route_id = route.route_id.as_str();
            let eligible = route
                .failure
                .as_ref()
                .is_some_and(|failure| failure.category.allows_automatic_retry());
            if !eligible {
                let category = route
                    .failure
                    .as_ref()
                    .map_or("unclassified", |failure| failure.category.name());
                decisions.blocked.push(format!(
                    "route {route_id} is blocked: {category} failures are not eligible for automatic retry ({error})"
                ));
                continue;
            }

            let binding = prepared
                .plan
                .adapters
                .iter()
                .find(|binding| binding.binding_id == route_id)
                .ok_or_else(|| {
                    PublishError::InvalidPlan(format!(
                        "plan route {route_id} does not reference a delivery destination binding"
                    ))
                })?;
            let publish_node_id = prepared
                .plan
                .nodes
                .iter()
                .find(|node| node.binding_id == route_id && node.stage == PlanStage::PublishRoutes)
                .map(|node| node.id.clone())
                .ok_or_else(|| {
                    PublishError::InvalidPlan(format!(
                        "plan route {route_id} has no publish_routes node to probe"
                    ))
                })?;
            let identity = DeliveryIdempotencyIdentity {
                attempt_id: attempt.attempt_id.clone(),
                plan_node_id: publish_node_id.clone(),
                release_identity: attempt.release_identity.clone(),
                manifest_digest: manifest.digest.clone(),
                route_id: route_id.to_string(),
            };
            // 探测错误按路线隔离：一条路线探测不到不阻断其他路线的评估（ADR-0022）。
            let probe =
                match self
                    .registry
                    .probe_delivery(&binding.adapter, &binding.settings, &identity)
                {
                    Ok(probe) => probe,
                    Err(error) => {
                        decisions.blocked.push(format!(
                            "route {route_id} is blocked: the idempotency probe failed ({error})"
                        ));
                        continue;
                    }
                };
            match probe {
                DeliveryProbe::Absent => {
                    decisions.retry_routes.insert(route_id.to_string());
                }
                DeliveryProbe::Matching { external_reference } => {
                    decisions.reused_deliveries.push(ReusedDelivery {
                        route_id: route_id.to_string(),
                        publish_node_id,
                        external_reference,
                    });
                }
                DeliveryProbe::Conflicting { external_reference } => {
                    decisions.blocked.push(format!(
                        "route {route_id} is blocked: remote state at {external_reference} conflicts with manifest {}; resuming would overwrite another release",
                        manifest.digest
                    ));
                }
                DeliveryProbe::Unprobeable { reason } => {
                    decisions.blocked.push(format!(
                        "route {route_id} is blocked: remote state cannot be probed ({reason})"
                    ));
                }
            }
        }
        Ok(decisions)
    }

    pub fn start(
        &self,
        plan: &PublishPlan,
        attempt_id: &str,
    ) -> Result<PublishOutcome, PublishError> {
        self.execute(plan, attempt_id, attempt_id)
    }

    fn execute(
        &self,
        plan: &PublishPlan,
        attempt_id: &str,
        backend_run_id: &str,
    ) -> Result<PublishOutcome, PublishError> {
        validate_plan(plan)?;
        preflight_adapter_contracts(&self.registry, plan)?;
        verify_plan_credentials(&self.registry, plan)?;
        if attempt_id.trim().is_empty() {
            return Err(PublishError::Execution(
                "publish attempt id cannot be empty".to_string(),
            ));
        }

        let mut executor =
            RuntimeNodeExecutor::new(&self.registry, plan, attempt_id, backend_run_id);
        self.registry
            .execute_plan(&plan.execution_backend, plan, &mut executor)?;
        executor.finish(plan)
    }
}

fn preflight_adapter_contracts(
    registry: &AdapterRegistry,
    plan: &PublishPlan,
) -> Result<(), PublishError> {
    registry.descriptor(&plan.execution_backend)?;
    let mut bindings = BTreeMap::new();
    for binding in &plan.adapters {
        if binding.binding_id.trim().is_empty()
            || bindings
                .insert(binding.binding_id.as_str(), binding)
                .is_some()
        {
            return Err(PublishError::InvalidPlan(
                "planned adapter binding ids must be non-empty and unique".to_string(),
            ));
        }
        let migrated =
            registry.migrate_and_validate_settings(&binding.adapter, &binding.settings)?;
        if migrated != binding.settings {
            return Err(PublishError::InvalidPlan(format!(
                "planned adapter {} contains settings that require migration",
                binding.binding_id
            )));
        }
    }
    registry.validate_capabilities(plan.adapters.iter().map(|binding| &binding.adapter))?;
    if !plan.adapters.iter().any(|binding| {
        binding.adapter == plan.execution_backend
            && binding.adapter.kind == publish_domain::AdapterKind::ExecutionBackend
    }) {
        return Err(PublishError::InvalidPlan(
            "execution backend is not present in planned adapter bindings".to_string(),
        ));
    }
    for node in &plan.nodes {
        registry.validate_plan_node(node)?;
        let migrated = registry.migrate_and_validate_settings(&node.adapter, &node.settings)?;
        if migrated != node.settings {
            return Err(PublishError::InvalidPlan(format!(
                "plan node {} contains settings that require migration",
                node.id
            )));
        }
        let Some(binding) = bindings.get(node.binding_id.as_str()) else {
            return Err(PublishError::InvalidPlan(format!(
                "plan node {} references unknown binding {}",
                node.id, node.binding_id
            )));
        };
        if binding.adapter != node.adapter || binding.settings != node.settings {
            return Err(PublishError::InvalidPlan(format!(
                "plan node {} does not match its sealed adapter binding",
                node.id
            )));
        }
    }
    Ok(())
}

/// 凭据预检：在任何副作用前，通过当前执行后端解析计划里每个绑定声明的
/// 凭据要求；解析值立即丢弃，只留下可用性结论（ADR-0029、Issue T08）。
fn verify_plan_credentials(
    registry: &AdapterRegistry,
    plan: &PublishPlan,
) -> Result<(), PublishError> {
    for binding in &plan.adapters {
        registry.resolve_binding_credentials(&plan.execution_backend, binding)?;
    }
    Ok(())
}

fn validate_plan(plan: &PublishPlan) -> Result<(), PublishError> {
    if plan.version != PUBLISH_PLAN_VERSION {
        return Err(PublishError::UnsupportedPlanVersion {
            actual: plan.version,
            expected: PUBLISH_PLAN_VERSION,
        });
    }
    let actual = plan.recomputed_digest()?;
    if actual != plan.digest {
        return Err(PublishError::PlanDigestMismatch {
            expected: plan.digest.clone(),
            actual,
        });
    }
    let mut route_ids = BTreeSet::new();
    if plan.routes.is_empty() {
        return Err(PublishError::InvalidPlan(
            "sealed publish plans require at least one delivery route".to_string(),
        ));
    }
    for route in &plan.routes {
        if route.route_id.trim().is_empty() || !route_ids.insert(route.route_id.as_str()) {
            return Err(PublishError::InvalidPlan(
                "plan route ids must be non-empty and unique".to_string(),
            ));
        }
        if !plan.adapters.iter().any(|binding| {
            binding.binding_id == route.route_id
                && binding.adapter.kind == AdapterKind::DeliveryDestination
        }) {
            return Err(PublishError::InvalidPlan(format!(
                "plan route {} does not reference a delivery destination binding",
                route.route_id
            )));
        }
    }
    let mut seen = BTreeSet::new();
    for node in &plan.nodes {
        if node.id.trim().is_empty() || !seen.insert(node.id.clone()) {
            return Err(PublishError::InvalidPlan(
                "plan node ids must be non-empty and unique".to_string(),
            ));
        }
        node.operation.validate()?;
        if let Some(unknown_dependency) = node
            .depends_on
            .iter()
            .find(|dependency| !seen.contains(*dependency))
        {
            return Err(PublishError::InvalidPlan(format!(
                "plan node {} depends on unavailable earlier node {unknown_dependency}",
                node.id
            )));
        }
    }
    Ok(())
}

struct RuntimeNodeExecutor<'a> {
    registry: &'a AdapterRegistry,
    attempt_id: &'a str,
    backend_run_id: &'a str,
    plan_digest: &'a str,
    snapshot_digest: &'a str,
    execution_backend: &'a AdapterIdentity,
    bindings: BTreeMap<&'a str, &'a AdapterBinding>,
    routes: &'a [PlanRoute],
    artifacts: Vec<ArtifactCandidate>,
    manifest: Option<ArtifactManifest>,
    envelopes: Vec<DeliveryEnvelope>,
    receipts: Vec<DeliveryReceipt>,
    events: Vec<PublishEvent>,
    executed_nodes: BTreeSet<String>,
    /// 已失败路线：路线内后续节点被跳过，失败不阻断其他路线（ADR-0022）。
    failed_routes: BTreeMap<String, String>,
    skipped_nodes: BTreeSet<String>,
    /// 续传时依据既往事件证据直接视为已完成的节点：共享阶段与成功路线
    /// 不重新执行（ADR-0040、Issue T12）。
    resume_completed: BTreeSet<String>,
    expected_nodes: BTreeMap<&'a str, &'a PlanNode>,
    /// 协作取消：置位后未开始的节点不再执行（ADR-0041）。
    cancellation: CancellationSignal,
}

impl<'a> RuntimeNodeExecutor<'a> {
    fn new(
        registry: &'a AdapterRegistry,
        plan: &'a PublishPlan,
        attempt_id: &'a str,
        backend_run_id: &'a str,
    ) -> Self {
        Self {
            registry,
            attempt_id,
            backend_run_id,
            plan_digest: &plan.digest,
            snapshot_digest: &plan.snapshot_digest,
            execution_backend: &plan.execution_backend,
            bindings: plan
                .adapters
                .iter()
                .map(|binding| (binding.binding_id.as_str(), binding))
                .collect(),
            routes: &plan.routes,
            artifacts: Vec::new(),
            manifest: None,
            envelopes: Vec::new(),
            receipts: Vec::new(),
            events: Vec::new(),
            executed_nodes: BTreeSet::new(),
            failed_routes: BTreeMap::new(),
            skipped_nodes: BTreeSet::new(),
            resume_completed: BTreeSet::new(),
            expected_nodes: plan
                .nodes
                .iter()
                .map(|node| (node.id.as_str(), node))
                .collect(),
            cancellation: CancellationSignal::default(),
        }
    }

    fn with_cancellation(mut self, cancellation: CancellationSignal) -> Self {
        self.cancellation = cancellation;
        self
    }

    fn is_route_node(&self, node: &PlanNode) -> bool {
        self.routes
            .iter()
            .any(|route| route.route_id == node.binding_id)
    }

    fn finish(self, plan: &PublishPlan) -> Result<PublishOutcome, PublishError> {
        self.validate_completion(plan)?;
        self.into_outcome()
    }

    fn validate_completion(&self, plan: &PublishPlan) -> Result<(), PublishError> {
        let missing = plan
            .nodes
            .iter()
            .filter(|node| {
                !self.executed_nodes.contains(&node.id)
                    && !self.failed_routes.contains_key(&node.binding_id)
            })
            .map(|node| node.id.clone())
            .collect::<Vec<_>>();
        if !missing.is_empty() {
            return Err(PublishError::IncompletePlanExecution { missing });
        }

        let manifest = self
            .manifest
            .as_ref()
            .ok_or(PublishError::MissingArtifactManifest)?;
        for route in self.routes {
            if !self.failed_routes.contains_key(&route.route_id)
                && !self
                    .receipts
                    .iter()
                    .any(|receipt| receipt.route_id == route.route_id)
            {
                return Err(PublishError::MissingDeliveryReceipt);
            }
        }
        if let Some(receipt) = self
            .receipts
            .iter()
            .find(|receipt| receipt.manifest_digest != manifest.digest)
        {
            return Err(PublishError::Execution(format!(
                "delivery receipt {} references manifest {}, expected {}",
                receipt.receipt_id, receipt.manifest_digest, manifest.digest
            )));
        }

        Ok(())
    }

    fn into_outcome(self) -> Result<PublishOutcome, PublishError> {
        let projection = reduce_publish_events(&self.events, self.routes)?;
        self.validate_event_projection(&projection)?;
        Ok(PublishOutcome {
            manifest: self.manifest.ok_or(PublishError::MissingArtifactManifest)?,
            events: self.events,
            receipts: projection.receipts,
        })
    }

    fn finish_attempt(
        mut self,
        plan: &PublishPlan,
        mut attempt: ReleaseAttempt,
    ) -> Result<PublishAttemptView, PublishError> {
        if self.cancellation.is_requested() {
            return self.finish_cancelled_attempt(plan, attempt);
        }
        if let Err(error) = self.validate_completion(plan) {
            return self.finish_failed_attempt(attempt, error);
        }

        let projection = reduce_publish_events(&self.events, self.routes)?;
        if let Err(error) = self.validate_event_projection(&projection) {
            return self.finish_failed_attempt(attempt, error);
        }
        attempt.manifest_digest = projection.manifest_digest.clone();
        Ok(PublishAttemptView {
            attempt,
            status: projection.status,
            manifest: self.manifest.take(),
            events: self.events,
            receipts: projection.receipts,
            receipt_history: projection.receipt_history,
            node_states: projection.node_states,
            routes: projection.routes,
            warnings: projection.warnings,
            error: projection.error,
        })
    }

    fn finish_failed_attempt(
        mut self,
        mut attempt: ReleaseAttempt,
        error: PublishError,
    ) -> Result<PublishAttemptView, PublishError> {
        let message = error.to_string();
        if !self
            .events
            .last()
            .is_some_and(|event| event.kind == "plan_node_failed")
        {
            self.append_failure_event("runtime", None, &message);
        }
        let projection = reduce_publish_events(&self.events, self.routes)?;
        attempt.manifest_digest = projection.manifest_digest.clone();
        Ok(PublishAttemptView {
            attempt,
            status: projection.status,
            manifest: self.manifest,
            events: self.events,
            receipts: projection.receipts,
            receipt_history: projection.receipt_history,
            node_states: projection.node_states,
            routes: projection.routes,
            warnings: projection.warnings,
            error: projection.error.or(Some(message)),
        })
    }

    fn validate_event_projection(
        &self,
        projection: &ReducedPublishEvents,
    ) -> Result<(), PublishError> {
        let manifest = self
            .manifest
            .as_ref()
            .ok_or(PublishError::MissingArtifactManifest)?;
        if projection.manifest_digest.as_deref() != Some(manifest.digest.as_str()) {
            return Err(PublishError::Execution(
                "publish events did not bind the sealed artifact manifest".to_string(),
            ));
        }
        // 每条路线要么已失败（可见错误），要么必须交出至少一份 Receipt。
        if projection
            .routes
            .iter()
            .any(|view| view.error.is_none() && view.status == DeliveryStatus::Pending)
        {
            return Err(PublishError::MissingDeliveryReceipt);
        }
        Ok(())
    }

    fn merge_output(
        &mut self,
        node: &PlanNode,
        output: AdapterExecutionOutput,
    ) -> Result<(), PublishError> {
        validate_output_admission(node, &output, self.manifest.as_ref())?;
        if let Some(manifest) = output.manifest.as_ref() {
            manifest.validate()?;
        }

        let manifest_digest = output
            .manifest
            .as_ref()
            .map(|manifest| manifest.digest.as_str())
            .or_else(|| {
                self.manifest
                    .as_ref()
                    .map(|manifest| manifest.digest.as_str())
            });
        let mut validated_receipts = self.receipts.clone();
        for receipt in &output.receipts {
            validate_receipt_revision(receipt)?;
            if receipt.route_id != node.binding_id {
                return Err(PublishError::Execution(format!(
                    "delivery receipt {} references route {}, expected {}",
                    receipt.receipt_id, receipt.route_id, node.binding_id
                )));
            }
            if let Some(expected_manifest) = manifest_digest {
                if receipt.manifest_digest != expected_manifest {
                    return Err(PublishError::Execution(format!(
                        "delivery receipt {} references manifest {}, expected {expected_manifest}",
                        receipt.receipt_id, receipt.manifest_digest
                    )));
                }
            } else {
                return Err(PublishError::MissingArtifactManifest);
            }

            if let Some(existing) = validated_receipts
                .iter()
                .rev()
                .find(|existing| existing.receipt_id == receipt.receipt_id)
            {
                if receipt.revision < existing.revision {
                    return Err(PublishError::Execution(format!(
                        "delivery receipt {} revision moved backwards from {} to {}",
                        receipt.receipt_id, existing.revision, receipt.revision
                    )));
                }
                if receipt.revision == existing.revision {
                    if existing != receipt {
                        return Err(PublishError::Execution(format!(
                            "delivery receipt {} revision {} has conflicting evidence",
                            receipt.receipt_id, receipt.revision
                        )));
                    }
                } else {
                    validate_receipt_transition(existing, receipt)?;
                }
            } else {
                validate_initial_receipt_revision(receipt)?;
            }
            validated_receipts.push(receipt.clone());
        }

        let mut payload = BTreeMap::from([(
            "adapter".to_string(),
            Value::String(node.adapter.display_name()),
        )]);
        if let Some(manifest) = output.manifest.as_ref() {
            payload.insert(
                "manifest_digest".to_string(),
                Value::String(manifest.digest.clone()),
            );
        }
        self.artifacts.extend(output.artifacts);
        if let Some(manifest) = output.manifest {
            self.manifest = Some(manifest);
        }
        self.envelopes.extend(output.envelopes);
        let receipts = output.receipts;
        self.receipts.extend(receipts.iter().cloned());
        self.append_event(&node.id, "plan_node_completed", payload);
        for receipt in receipts {
            // 终态失败的 Receipt 让本路线失败并跳过其后续节点；证据本身保留。
            if is_failed_delivery_status(receipt.status) {
                self.failed_routes
                    .entry(receipt.route_id.clone())
                    .or_insert_with(|| failed_receipt_message(&receipt));
            }
            let receipt = serde_json::to_value(receipt).map_err(|error| {
                PublishError::Execution(format!(
                    "failed to serialize delivery receipt event: {error}"
                ))
            })?;
            self.append_event(
                &node.id,
                "delivery_receipt_observed",
                BTreeMap::from([("receipt".to_string(), receipt)]),
            );
        }
        Ok(())
    }

    /// 取消尚未解决的路线：路线还没有任何 Published Receipt 也没有失败证据时，
    /// 记录 route_cancelled 事件。已 Published 的路线与既有 Receipt 不被触碰。
    fn cancel_route_if_unresolved(&mut self, route_id: &str, plan_node_id: &str) {
        if self.failed_routes.contains_key(route_id)
            || self.receipts.iter().any(|receipt| {
                receipt.route_id == route_id && receipt.status == DeliveryStatus::Published
            })
        {
            return;
        }
        let message = format!("delivery route {route_id} was cancelled before delivery");
        self.append_event(
            plan_node_id,
            "route_cancelled",
            BTreeMap::from([
                ("route_id".to_string(), Value::String(route_id.to_string())),
                ("error".to_string(), Value::String(message.clone())),
            ]),
        );
        self.failed_routes.insert(route_id.to_string(), message);
    }

    /// 取消后的收尾：执行后端未提交给 executor 的路线节点在这里兜底记为取消，
    /// 随后一切状态由事件归约确定——已 Published 的路线保持 Published，
    /// Required 路线被取消而其他路线已成功时是 Partial Delivery，尚无任何
    /// 交付时是 Cancelled（ADR-0041）。
    fn finish_cancelled_attempt(
        mut self,
        plan: &PublishPlan,
        mut attempt: ReleaseAttempt,
    ) -> Result<PublishAttemptView, PublishError> {
        for route in &plan.routes {
            let plan_node_id = plan
                .nodes
                .iter()
                .find(|node| node.binding_id == route.route_id)
                .map(|node| node.id.clone())
                .unwrap_or_else(|| "runtime".to_string());
            self.cancel_route_if_unresolved(&route.route_id, &plan_node_id);
        }
        let projection = reduce_publish_events(&self.events, self.routes)?;
        attempt.manifest_digest = projection.manifest_digest.clone();
        Ok(PublishAttemptView {
            attempt,
            status: projection.status,
            manifest: self.manifest.take(),
            events: self.events,
            receipts: projection.receipts,
            receipt_history: projection.receipt_history,
            node_states: projection.node_states,
            routes: projection.routes,
            warnings: projection.warnings,
            error: projection.error,
        })
    }

    /// 路线节点失败：记录 route_failed 事件并隔离本路线，不再返回错误给执行后端。
    /// Classified 错误的结构化分类随事件持久化，供重试资格评估使用（ADR-0056）。
    fn fail_route(&mut self, node: &PlanNode, error: &PublishError) {
        let message = error.to_string();
        let mut payload = BTreeMap::from([
            (
                "route_id".to_string(),
                Value::String(node.binding_id.clone()),
            ),
            ("error".to_string(), Value::String(message.clone())),
            (
                "adapter".to_string(),
                Value::String(node.adapter.display_name()),
            ),
        ]);
        if let PublishError::Classified { failure } = error {
            // PublishFailure 是纯数据，序列化不会失败；万一失败，事件退化为
            // 未分类证据，读取端按 Unknown 阻断自动重试——降级方向是安全的。
            if let Ok(value) = serde_json::to_value(failure) {
                payload.insert("failure".to_string(), value);
            }
        }
        self.append_event(&node.id, "route_failed", payload);
        self.failed_routes.insert(node.binding_id.clone(), message);
    }

    /// 幂等探测确认远端摘要一致时复用既有交付：不重新执行副作用，把探测确认
    /// 的远端事实观察为 Published Receipt 修订追加进事件证据（ADR-0051）。
    fn reuse_receipt(
        &mut self,
        reused: &ReusedDelivery,
        manifest_digest: &str,
    ) -> Result<(), PublishError> {
        let ReusedDelivery {
            route_id,
            publish_node_id,
            external_reference,
        } = reused;
        let previous = self
            .receipts
            .iter()
            .rev()
            .find(|receipt| &receipt.route_id == route_id)
            .cloned();
        let receipt = match previous {
            Some(previous) => {
                if &previous.external_reference != external_reference {
                    return Err(PublishError::Execution(format!(
                        "route {route_id} cannot reuse remote delivery {external_reference}; its receipt is bound to {}",
                        previous.external_reference
                    )));
                }
                DeliveryReceipt {
                    revision: previous.revision.checked_add(1).ok_or_else(|| {
                        PublishError::Execution(format!(
                            "delivery receipt {} exhausted its revision range",
                            previous.receipt_id
                        ))
                    })?,
                    status: DeliveryStatus::Published,
                    ..previous
                }
            }
            None => DeliveryReceipt {
                version: DELIVERY_RECEIPT_VERSION,
                receipt_id: sha256_hex(
                    format!(
                        "{}:{publish_node_id}:{route_id}:{manifest_digest}",
                        self.attempt_id
                    )
                    .as_bytes(),
                ),
                revision: 1,
                route_id: route_id.to_string(),
                manifest_digest: manifest_digest.to_string(),
                status: DeliveryStatus::Published,
                external_reference: external_reference.clone(),
            },
        };
        self.receipts.push(receipt.clone());
        let value = serde_json::to_value(receipt).map_err(|error| {
            PublishError::Execution(format!(
                "failed to serialize delivery receipt event: {error}"
            ))
        })?;
        self.append_event(
            publish_node_id,
            "delivery_receipt_observed",
            BTreeMap::from([("receipt".to_string(), value)]),
        );
        Ok(())
    }

    fn append_failure_event(
        &mut self,
        plan_node_id: &str,
        adapter: Option<&publish_domain::AdapterIdentity>,
        error: &str,
    ) {
        let mut payload = BTreeMap::from([("error".to_string(), Value::String(error.to_string()))]);
        if let Some(adapter) = adapter {
            payload.insert("adapter".to_string(), Value::String(adapter.display_name()));
        }
        self.append_event(plan_node_id, "plan_node_failed", payload);
    }

    fn append_event(&mut self, plan_node_id: &str, kind: &str, payload: BTreeMap<String, Value>) {
        let sequence = self.events.len() as u64 + 1;
        let event_id = sha256_hex(
            format!(
                "{}:{}:{}:{}",
                self.attempt_id, self.plan_digest, plan_node_id, sequence
            )
            .as_bytes(),
        );
        self.events.push(PublishEvent {
            version: PUBLISH_EVENT_VERSION,
            event_id,
            attempt_id: self.attempt_id.to_string(),
            backend_run_id: self.backend_run_id.to_string(),
            sequence,
            plan_digest: self.plan_digest.to_string(),
            plan_node_id: plan_node_id.to_string(),
            kind: kind.to_string(),
            payload,
        });
    }
}

impl PlanNodeExecutor for RuntimeNodeExecutor<'_> {
    fn execute_node(&mut self, node: &PlanNode) -> Result<(), PublishError> {
        let Some(&expected) = self.expected_nodes.get(node.id.as_str()) else {
            return Err(PublishError::InvalidPlan(format!(
                "backend submitted node {} that is not part of the sealed plan",
                node.id
            )));
        };
        if expected != node {
            return Err(PublishError::InvalidPlan(format!(
                "backend modified sealed plan node {}",
                node.id
            )));
        }
        if self.executed_nodes.contains(&node.id) || self.skipped_nodes.contains(&node.id) {
            return Err(PublishError::Execution(format!(
                "plan node {} executed more than once",
                node.id
            )));
        }
        // 取消只停止尚未开始的工作：本节点不再执行；所属路线若尚无交付
        // 证据则记为取消，已 Published 的路线与既有 Receipt 保持不变（ADR-0041）。
        if self.cancellation.is_requested() {
            self.skipped_nodes.insert(node.id.clone());
            if self.is_route_node(node) {
                self.cancel_route_if_unresolved(&node.binding_id, &node.id);
            }
            return Ok(());
        }
        // 续传时既有事件证据已覆盖的节点直接视为完成：不重新构建、处理或交付。
        if self.resume_completed.contains(&node.id) {
            self.executed_nodes.insert(node.id.clone());
            return Ok(());
        }
        if self.failed_routes.contains_key(&node.binding_id) {
            self.skipped_nodes.insert(node.id.clone());
            return Ok(());
        }
        if let Some(missing_dependency) = node
            .depends_on
            .iter()
            .find(|dependency| !self.executed_nodes.contains(*dependency))
        {
            return Err(PublishError::Execution(format!(
                "plan node {} executed before dependency {missing_dependency}",
                node.id
            )));
        }

        match self.run_node(node) {
            Ok(()) => {
                self.executed_nodes.insert(node.id.clone());
                Ok(())
            }
            Err(error) if self.is_route_node(node) => {
                // 路线失败被隔离为可观察的路线级结果；其余路线继续执行（ADR-0022）。
                self.fail_route(node, &error);
                Ok(())
            }
            Err(error) => {
                self.append_failure_event(&node.id, Some(&node.adapter), &error.to_string());
                Err(error)
            }
        }
    }
}

impl RuntimeNodeExecutor<'_> {
    fn run_node(&mut self, node: &PlanNode) -> Result<(), PublishError> {
        let Some(&binding) = self.bindings.get(node.binding_id.as_str()) else {
            return Err(PublishError::InvalidPlan(format!(
                "plan node {} references unknown binding {}",
                node.id, node.binding_id
            )));
        };
        let credentials = self
            .registry
            .resolve_binding_credentials(self.execution_backend, binding)?;
        let context = AdapterExecutionContext {
            attempt_id: self.attempt_id,
            plan_digest: self.plan_digest,
            snapshot_digest: self.snapshot_digest,
            artifacts: &self.artifacts,
            manifest: self.manifest.as_ref(),
            envelopes: &self.envelopes,
            receipts: &self.receipts,
            credentials: &credentials,
        };
        let output = self.registry.execute_node(node, &context)?;
        self.merge_output(node, output)
    }
}

/// 输出准入：每类执行输出只被其所属阶段与 Adapter 类别接受，产物角色必须
/// 出现在节点声明中。这让"处理→封存→路线"的边界由数据规则而不是各 Adapter
/// 的自觉来保证（ADR-0027/0035/0055）。
fn validate_output_admission(
    node: &PlanNode,
    output: &AdapterExecutionOutput,
    sealed_manifest: Option<&ArtifactManifest>,
) -> Result<(), PublishError> {
    if !output.artifacts.is_empty() {
        if !matches!(
            node.stage,
            PlanStage::Build | PlanStage::CollectArtifacts | PlanStage::ProcessArtifacts
        ) {
            return Err(PublishError::Execution(format!(
                "plan node {} cannot modify the artifact set in the {:?} stage; artifact sets are sealed by the persist_manifest stage",
                node.id, node.stage
            )));
        }
        for artifact in &output.artifacts {
            if !declares_artifact_role(&node.artifact_outputs, &artifact.role) {
                return Err(PublishError::Execution(format!(
                    "plan node {} produced artifact {} with undeclared role {}",
                    node.id, artifact.file_name, artifact.role
                )));
            }
        }
    }

    if output.manifest.is_some() {
        if node.adapter.kind != AdapterKind::ArtifactStore
            || node.stage != PlanStage::PersistManifest
        {
            return Err(PublishError::Execution(format!(
                "plan node {} cannot seal the artifact manifest; only the artifact store seals it in the persist_manifest stage",
                node.id
            )));
        }
        if sealed_manifest.is_some() {
            return Err(PublishError::Execution(
                "artifact manifest can only be sealed once".to_string(),
            ));
        }
    }

    if !output.envelopes.is_empty() {
        if node.adapter.kind != AdapterKind::DeliveryDestination
            || node.stage != PlanStage::StageRoutes
        {
            return Err(PublishError::Execution(format!(
                "plan node {} cannot stage delivery envelopes",
                node.id
            )));
        }
        let manifest = sealed_manifest.ok_or(PublishError::MissingArtifactManifest)?;
        for envelope in &output.envelopes {
            envelope.validate()?;
            if envelope.route_id != node.binding_id {
                return Err(PublishError::Execution(format!(
                    "delivery envelope from node {} references route {}, expected {}",
                    node.id, envelope.route_id, node.binding_id
                )));
            }
            if envelope.manifest_digest != manifest.digest {
                return Err(PublishError::Execution(format!(
                    "delivery envelope for route {} references manifest {}, expected {}",
                    envelope.route_id, envelope.manifest_digest, manifest.digest
                )));
            }
        }
    }

    if !output.receipts.is_empty()
        && (node.adapter.kind != AdapterKind::DeliveryDestination
            || node.stage != PlanStage::PublishRoutes)
    {
        return Err(PublishError::Execution(format!(
            "plan node {} cannot emit delivery receipts",
            node.id
        )));
    }

    Ok(())
}

fn delivery_status_name(status: DeliveryStatus) -> &'static str {
    match status {
        DeliveryStatus::Pending => "pending",
        DeliveryStatus::Staged => "staged",
        DeliveryStatus::Submitted => "submitted",
        DeliveryStatus::Published => "published",
        DeliveryStatus::Failed => "failed",
        DeliveryStatus::Rejected => "rejected",
        DeliveryStatus::Cancelled => "cancelled",
        DeliveryStatus::Expired => "expired",
    }
}

/// 生命周期推进程度，仅用于在多个 Receipt 之间取最落后阶段；终态失败不参与排序。
fn delivery_status_rank(status: DeliveryStatus) -> u8 {
    match status {
        DeliveryStatus::Pending => 0,
        DeliveryStatus::Staged => 1,
        DeliveryStatus::Submitted => 2,
        DeliveryStatus::Published => 3,
        DeliveryStatus::Failed
        | DeliveryStatus::Rejected
        | DeliveryStatus::Cancelled
        | DeliveryStatus::Expired => 0,
    }
}
