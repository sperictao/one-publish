use std::collections::{BTreeMap, BTreeSet};

use publish_adapters::{
    AdapterExecutionContext, AdapterExecutionOutput, AdapterRegistry, PlanNodeExecutor,
};
use publish_domain::{
    sha256_hex, ArtifactCandidate, ArtifactManifest, DeliveryReceipt, PlanNode,
    PlanningInputSnapshot, PublishError, PublishEvent, PublishOutcome, PublishPlan,
    PUBLISH_EVENT_VERSION, PUBLISH_PLAN_VERSION,
};
use publish_planner::PublishPlanner;
use serde_json::Value;

pub struct PublishRuntime {
    registry: AdapterRegistry,
}

impl PublishRuntime {
    pub fn new(registry: AdapterRegistry) -> Self {
        Self { registry }
    }

    pub fn prepare(&self, snapshot: &PlanningInputSnapshot) -> Result<PublishPlan, PublishError> {
        PublishPlanner::new(&self.registry).prepare(snapshot)
    }

    pub fn start(
        &self,
        plan: &PublishPlan,
        attempt_id: &str,
    ) -> Result<PublishOutcome, PublishError> {
        validate_plan(plan)?;
        preflight_adapter_contracts(&self.registry, plan)?;
        if attempt_id.trim().is_empty() {
            return Err(PublishError::Execution(
                "publish attempt id cannot be empty".to_string(),
            ));
        }

        let mut executor = RuntimeNodeExecutor::new(&self.registry, plan, attempt_id);
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
    fn new(registry: &'a AdapterRegistry, plan: &'a PublishPlan, attempt_id: &'a str) -> Self {
        Self {
            registry,
            attempt_id,
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
        let missing = plan
            .nodes
            .iter()
            .filter(|node| !self.executed_nodes.contains(&node.id))
            .map(|node| node.id.clone())
            .collect::<Vec<_>>();
        if !missing.is_empty() {
            return Err(PublishError::IncompletePlanExecution { missing });
        }

        let manifest = self.manifest.ok_or(PublishError::MissingArtifactManifest)?;
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

        Ok(PublishOutcome {
            manifest,
            events: self.events,
            receipts: self.receipts,
        })
    }

    fn merge_output(
        &mut self,
        node: &PlanNode,
        output: AdapterExecutionOutput,
    ) -> Result<(), PublishError> {
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
        self.append_event(node);
        Ok(())
    }

    fn append_event(&mut self, node: &PlanNode) {
        let sequence = self.events.len() as u64 + 1;
        let payload = BTreeMap::from([(
            "adapter".to_string(),
            Value::String(node.adapter.display_name()),
        )]);
        let event_id = sha256_hex(
            format!(
                "{}:{}:{}:{}",
                self.attempt_id, self.plan_digest, node.id, sequence
            )
            .as_bytes(),
        );
        self.events.push(PublishEvent {
            version: PUBLISH_EVENT_VERSION,
            event_id,
            attempt_id: self.attempt_id.to_string(),
            sequence,
            plan_digest: self.plan_digest.to_string(),
            plan_node_id: node.id.clone(),
            kind: "plan_node_completed".to_string(),
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
        let output = self.registry.execute_node(node, &context)?;
        self.merge_output(node, output)?;
        self.executed_nodes.insert(node.id.clone());
        Ok(())
    }
}
