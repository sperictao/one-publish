use std::collections::{BTreeMap, BTreeSet};
use std::sync::Mutex;

use publish_adapters::{
    AdapterExecutionContext, AdapterExecutionOutput, AdapterRegistry, PlanNodeExecutor,
};
use publish_domain::{
    sha256_hex, ArtifactCandidate, ArtifactManifest, DeliveryReceipt, PlanNode,
    PlanningInputSnapshot, PublishAttemptStatus, PublishAttemptView, PublishError, PublishEvent,
    PublishOutcome, PublishPlan, ReleaseAttempt, ReleaseIdentity, PUBLISH_EVENT_VERSION,
    PUBLISH_PLAN_VERSION, RELEASE_ATTEMPT_VERSION,
};
use publish_planner::PublishPlanner;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PreparedPublishPlan {
    pub snapshot: PlanningInputSnapshot,
    pub plan: PublishPlan,
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
        match self.registry.execute_plan(
            &prepared.plan.execution_backend,
            &prepared.plan,
            &mut executor,
        ) {
            Ok(()) => Ok(executor.finish_attempt(&prepared.plan, attempt)),
            Err(error) => Ok(executor.finish_failed_attempt(attempt, error)),
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
    artifacts: Vec<ArtifactCandidate>,
    manifest: Option<ArtifactManifest>,
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
            artifacts: Vec::new(),
            manifest: None,
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
        Ok(self.into_outcome())
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

    fn into_outcome(self) -> PublishOutcome {
        PublishOutcome {
            manifest: self
                .manifest
                .expect("validated runtime execution must have an artifact manifest"),
            events: self.events,
            receipts: self.receipts,
        }
    }

    fn finish_attempt(self, plan: &PublishPlan, attempt: ReleaseAttempt) -> PublishAttemptView {
        if let Err(error) = self.validate_completion(plan) {
            return self.finish_failed_attempt(attempt, error);
        }

        let outcome = self.into_outcome();
        let mut attempt = attempt;
        attempt.manifest_digest = Some(outcome.manifest.digest.clone());
        PublishAttemptView {
            attempt,
            status: reduce_attempt_status(&outcome.events),
            manifest: Some(outcome.manifest),
            events: outcome.events,
            receipts: outcome.receipts,
            error: None,
        }
    }

    fn finish_failed_attempt(
        mut self,
        mut attempt: ReleaseAttempt,
        error: PublishError,
    ) -> PublishAttemptView {
        let message = error.to_string();
        if !self
            .events
            .last()
            .is_some_and(|event| event.kind == "plan_node_failed")
        {
            self.append_failure_event("runtime", None, &message);
        }
        attempt.manifest_digest = self
            .manifest
            .as_ref()
            .map(|manifest| manifest.digest.clone());
        PublishAttemptView {
            attempt,
            status: reduce_attempt_status(&self.events),
            manifest: self.manifest,
            events: self.events,
            receipts: self.receipts,
            error: Some(message),
        }
    }

    fn merge_output(
        &mut self,
        node: &PlanNode,
        output: AdapterExecutionOutput,
    ) -> Result<(), PublishError> {
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
        if let Some(receipt) = output.receipts.first() {
            payload.insert(
                "receipt_id".to_string(),
                Value::String(receipt.receipt_id.clone()),
            );
            payload.insert(
                "receipt_revision".to_string(),
                Value::Number(receipt.revision.into()),
            );
            payload.insert(
                "delivery_status".to_string(),
                Value::String(delivery_status_name(receipt.status).to_string()),
            );
        }
        self.artifacts.extend(output.artifacts);
        if let Some(manifest) = output.manifest {
            if self.manifest.is_some() {
                return Err(PublishError::Execution(
                    "artifact manifest can only be sealed once".to_string(),
                ));
            }
            manifest.validate()?;
            self.manifest = Some(manifest);
        }
        self.receipts.extend(output.receipts);
        self.append_event(&node.id, "plan_node_completed", payload);
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

        let context = AdapterExecutionContext {
            attempt_id: self.attempt_id,
            plan_digest: self.plan_digest,
            snapshot_digest: self.snapshot_digest,
            artifacts: &self.artifacts,
            manifest: self.manifest.as_ref(),
            receipts: &self.receipts,
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

fn reduce_attempt_status(events: &[PublishEvent]) -> PublishAttemptStatus {
    if events.iter().any(|event| event.kind == "plan_node_failed") {
        return PublishAttemptStatus::Failed;
    }
    if events.iter().any(|event| {
        event.payload.get("delivery_status").and_then(Value::as_str) == Some("published")
    }) {
        return PublishAttemptStatus::Published;
    }
    PublishAttemptStatus::Running
}

fn delivery_status_name(status: publish_domain::DeliveryStatus) -> &'static str {
    match status {
        publish_domain::DeliveryStatus::Pending => "pending",
        publish_domain::DeliveryStatus::Staged => "staged",
        publish_domain::DeliveryStatus::Submitted => "submitted",
        publish_domain::DeliveryStatus::Published => "published",
        publish_domain::DeliveryStatus::Failed => "failed",
        publish_domain::DeliveryStatus::Rejected => "rejected",
        publish_domain::DeliveryStatus::Cancelled => "cancelled",
        publish_domain::DeliveryStatus::Expired => "expired",
    }
}
