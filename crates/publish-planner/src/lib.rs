use std::collections::BTreeSet;

use publish_adapters::AdapterRegistry;
use publish_domain::{
    AdapterBinding, AdapterSettings, PlanNode, PlanNodeTemplate, PlanningInputSnapshot,
    PublishError, PublishPlan, PLANNING_INPUT_SNAPSHOT_VERSION,
};

pub struct PublishPlanner<'a> {
    registry: &'a AdapterRegistry,
}

impl<'a> PublishPlanner<'a> {
    pub fn new(registry: &'a AdapterRegistry) -> Self {
        Self { registry }
    }

    pub fn prepare(&self, snapshot: &PlanningInputSnapshot) -> Result<PublishPlan, PublishError> {
        if snapshot.version != PLANNING_INPUT_SNAPSHOT_VERSION {
            return Err(PublishError::UnsupportedSnapshotVersion {
                actual: snapshot.version,
                expected: PLANNING_INPUT_SNAPSHOT_VERSION,
            });
        }
        if snapshot.adapters.delivery_destinations.is_empty() {
            return Err(PublishError::InvalidPlan(
                "at least one delivery destination is required".to_string(),
            ));
        }

        let prepared = self.prepare_bindings(snapshot)?;
        self.registry
            .validate_capabilities(prepared.iter().map(|binding| &binding.binding.adapter))?;
        let nodes = self.compose_nodes(snapshot, &prepared)?;
        let adapters = prepared
            .iter()
            .map(|prepared| AdapterBinding {
                binding_id: prepared.binding.binding_id.clone(),
                adapter: prepared.binding.adapter.clone(),
                settings: prepared.settings.clone(),
                credentials: prepared.binding.credentials.clone(),
            })
            .collect();
        PublishPlan::seal(
            snapshot.digest()?,
            adapters,
            snapshot.adapters.execution_backend.adapter.clone(),
            nodes,
        )
    }

    fn prepare_bindings<'b>(
        &self,
        snapshot: &'b PlanningInputSnapshot,
    ) -> Result<Vec<PreparedBinding<'b>>, PublishError> {
        snapshot
            .adapters
            .ordered_bindings()
            .into_iter()
            .map(|binding| {
                let settings = self
                    .registry
                    .migrate_and_validate_settings(&binding.adapter, &binding.settings)?;
                self.registry.validate_credential_bindings(binding)?;
                Ok(PreparedBinding { binding, settings })
            })
            .collect()
    }

    fn compose_nodes(
        &self,
        snapshot: &PlanningInputSnapshot,
        prepared: &[PreparedBinding<'_>],
    ) -> Result<Vec<PlanNode>, PublishError> {
        let mut templates = Vec::new();
        for (binding_order, prepared_binding) in prepared.iter().enumerate() {
            let fragment = self.registry.plan_fragment(
                &prepared_binding.binding.adapter,
                snapshot,
                &prepared_binding.settings,
            )?;
            for (fragment_order, template) in fragment.into_iter().enumerate() {
                templates.push((binding_order, fragment_order, prepared_binding, template));
            }
        }
        templates.sort_by_key(|(binding_order, fragment_order, _, template)| {
            (template.stage, *binding_order, *fragment_order)
        });

        let mut ids = BTreeSet::new();
        let mut previous_id: Option<String> = None;
        templates
            .into_iter()
            .map(|(_, _, prepared_binding, template)| {
                make_plan_node(
                    prepared_binding.binding,
                    &prepared_binding.settings,
                    template,
                    &mut ids,
                    &mut previous_id,
                )
            })
            .collect()
    }
}

struct PreparedBinding<'a> {
    binding: &'a AdapterBinding,
    settings: AdapterSettings,
}

fn make_plan_node(
    binding: &AdapterBinding,
    settings: &AdapterSettings,
    template: PlanNodeTemplate,
    ids: &mut BTreeSet<String>,
    previous_id: &mut Option<String>,
) -> Result<PlanNode, PublishError> {
    template.operation.validate()?;
    let id = format!("{}.{}", binding.binding_id, template.local_id);
    if !ids.insert(id.clone()) {
        return Err(PublishError::InvalidPlan(format!(
            "plan node id {id} is not unique"
        )));
    }
    let depends_on = previous_id.iter().cloned().collect();
    *previous_id = Some(id.clone());
    Ok(PlanNode {
        id,
        stage: template.stage,
        adapter: binding.adapter.clone(),
        binding_id: binding.binding_id.clone(),
        settings: settings.clone(),
        operation: template.operation,
        depends_on,
        artifact_inputs: template.artifact_inputs,
        artifact_outputs: template.artifact_outputs,
        side_effects: template.side_effects,
        irreversible: template.irreversible,
    })
}
