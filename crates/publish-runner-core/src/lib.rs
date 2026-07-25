use std::collections::{BTreeMap, BTreeSet};
use std::sync::Mutex;

use publish_adapters::{
    AdapterExecutionContext, AdapterExecutionOutput, AdapterRegistry, PlanNodeExecutor,
};
use publish_domain::{
    declares_artifact_role, sha256_hex, AdapterBinding, AdapterIdentity, AdapterKind,
    ArtifactCandidate, ArtifactManifest, DeliveryEnvelope, DeliveryReceipt, DeliveryStatus,
    PlanNode, PlanStage, PlanningInputSnapshot, PublishAttemptStatus, PublishAttemptView,
    PublishError, PublishEvent, PublishOutcome, PublishPlan, ReleaseAttempt, ReleaseIdentity,
    DELIVERY_RECEIPT_VERSION, PUBLISH_EVENT_VERSION, PUBLISH_PLAN_VERSION, RELEASE_ATTEMPT_VERSION,
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
    pub receipts: Vec<DeliveryReceipt>,
    pub error: Option<String>,
}

pub fn reduce_publish_events(
    events: &[PublishEvent],
) -> Result<ReducedPublishEvents, PublishError> {
    let mut manifest_digest = None;
    let mut receipts = BTreeMap::<String, DeliveryReceipt>::new();
    let mut failure = None;
    let mut event_identity: Option<(String, String, String)> = None;

    for (index, event) in events.iter().enumerate() {
        if event.version != PUBLISH_EVENT_VERSION {
            return Err(PublishError::Execution(format!(
                "unsupported publish event version {}; expected {}",
                event.version, PUBLISH_EVENT_VERSION
            )));
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
                        receipts.insert(receipt.receipt_id.clone(), receipt);
                    }
                    _ => {
                        validate_initial_receipt_revision(&receipt)?;
                        receipts.insert(receipt.receipt_id.clone(), receipt);
                    }
                }
            }
            "plan_node_failed" => {
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

    if failure.is_none() {
        if let Some(receipt) = receipts
            .values()
            .find(|receipt| is_failed_delivery_status(receipt.status))
        {
            failure = Some(format!(
                "delivery receipt {} is {}",
                receipt.receipt_id,
                delivery_status_name(receipt.status)
            ));
        }
    }

    let status = if failure.is_some() {
        PublishAttemptStatus::Failed
    } else if !receipts.is_empty()
        && receipts
            .values()
            .all(|receipt| receipt.status == DeliveryStatus::Published)
    {
        PublishAttemptStatus::Published
    } else {
        PublishAttemptStatus::Running
    };

    Ok(ReducedPublishEvents {
        status,
        manifest_digest,
        receipts: receipts.into_values().collect(),
        error: failure,
    })
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

pub struct PublishRuntime {
    registry: AdapterRegistry,
    started_attempts: Mutex<BTreeSet<String>>,
}

impl PublishRuntime {
    pub fn new(registry: AdapterRegistry) -> Self {
        Self {
            registry,
            started_attempts: Mutex::new(BTreeSet::new()),
        }
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
            RuntimeNodeExecutor::new(&self.registry, &prepared.plan, &attempt_id, &backend_run_id);
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
    artifacts: Vec<ArtifactCandidate>,
    manifest: Option<ArtifactManifest>,
    envelopes: Vec<DeliveryEnvelope>,
    receipts: Vec<DeliveryReceipt>,
    events: Vec<PublishEvent>,
    executed_nodes: BTreeSet<String>,
    expected_nodes: BTreeMap<&'a str, &'a PlanNode>,
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
            artifacts: Vec::new(),
            manifest: None,
            envelopes: Vec::new(),
            receipts: Vec::new(),
            events: Vec::new(),
            executed_nodes: BTreeSet::new(),
            expected_nodes: plan
                .nodes
                .iter()
                .map(|node| (node.id.as_str(), node))
                .collect(),
        }
    }

    fn finish(self, plan: &PublishPlan) -> Result<PublishOutcome, PublishError> {
        self.validate_completion(plan)?;
        self.into_outcome()
    }

    fn validate_completion(&self, plan: &PublishPlan) -> Result<(), PublishError> {
        let missing = plan
            .nodes
            .iter()
            .filter(|node| !self.executed_nodes.contains(&node.id))
            .map(|node| node.id.clone())
            .collect::<Vec<_>>();
        if !missing.is_empty() {
            return Err(PublishError::IncompletePlanExecution { missing });
        }

        let manifest = self
            .manifest
            .as_ref()
            .ok_or(PublishError::MissingArtifactManifest)?;
        if self.receipts.is_empty() {
            return Err(PublishError::MissingDeliveryReceipt);
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
        let projection = reduce_publish_events(&self.events)?;
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
        if let Err(error) = self.validate_completion(plan) {
            return self.finish_failed_attempt(attempt, error);
        }

        let projection = reduce_publish_events(&self.events)?;
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
        let projection = reduce_publish_events(&self.events)?;
        attempt.manifest_digest = projection.manifest_digest.clone();
        Ok(PublishAttemptView {
            attempt,
            status: projection.status,
            manifest: self.manifest,
            events: self.events,
            receipts: projection.receipts,
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
        if projection.receipts.is_empty() {
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
        if self.executed_nodes.contains(&node.id) {
            return Err(PublishError::Execution(format!(
                "plan node {} executed more than once",
                node.id
            )));
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

        let Some(&binding) = self.bindings.get(node.binding_id.as_str()) else {
            return Err(PublishError::InvalidPlan(format!(
                "plan node {} references unknown binding {}",
                node.id, node.binding_id
            )));
        };
        let credentials = match self
            .registry
            .resolve_binding_credentials(self.execution_backend, binding)
        {
            Ok(credentials) => credentials,
            Err(error) => {
                self.append_failure_event(&node.id, Some(&node.adapter), &error.to_string());
                return Err(error);
            }
        };
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
        let output = match self.registry.execute_node(node, &context) {
            Ok(output) => output,
            Err(error) => {
                self.append_failure_event(&node.id, Some(&node.adapter), &error.to_string());
                return Err(error);
            }
        };
        if let Err(error) = self.merge_output(node, output) {
            self.append_failure_event(&node.id, Some(&node.adapter), &error.to_string());
            return Err(error);
        }
        self.executed_nodes.insert(node.id.clone());
        Ok(())
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
