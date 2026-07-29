use std::collections::{BTreeMap, BTreeSet};

use publish_adapters::AdapterRegistry;
use publish_domain::{
    AdapterBinding, AdapterKind, AdapterSettings, PlanNode, PlanNodeTemplate, PlanRoute,
    PlanningInputSnapshot, PublishError, PublishPlan, PLANNING_INPUT_SNAPSHOT_VERSION,
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
        if let Some(digest) = &snapshot.promoted_manifest_digest {
            if !publish_domain::is_sha256_digest(digest) {
                return Err(PublishError::InvalidPlan(
                    "promoted manifest digest must be a 64-character SHA-256 value".to_string(),
                ));
            }
        }
        if snapshot.adapters.delivery_routes.is_empty() {
            return Err(PublishError::InvalidPlan(
                "at least one delivery route is required".to_string(),
            ));
        }
        let routes = snapshot
            .adapters
            .delivery_routes
            .iter()
            .map(|route| PlanRoute {
                route_id: route.route_id().to_string(),
                required: route.required,
            })
            .collect::<Vec<_>>();

        let prepared = self.prepare_bindings(snapshot)?;
        self.registry
            .validate_capabilities(prepared.iter().map(|binding| &binding.binding.adapter))?;
        let nodes = self.compose_nodes(snapshot, &prepared, &routes)?;
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
            routes,
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
        routes: &[PlanRoute],
    ) -> Result<Vec<PlanNode>, PublishError> {
        let mut templates = Vec::new();
        for (binding_order, prepared_binding) in prepared.iter().enumerate() {
            // Promotion 在创建时绑定既有 Manifest：Provider 构建与全部会改变产物的
            // 处理器不贡献节点，能力与设置校验仍覆盖完整选择（ADR-0040）。
            if snapshot.promoted_manifest_digest.is_some()
                && matches!(
                    prepared_binding.binding.adapter.kind,
                    AdapterKind::ProjectProvider | AdapterKind::ArtifactProcessor
                )
            {
                continue;
            }
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

        // 路线节点只链接同一路线内的前驱与共享前缀的最后一个节点；共享节点保持
        // 线性链。这样一条路线的失败不会通过依赖阻断其他路线（ADR-0022）。
        let route_ids = routes
            .iter()
            .map(|route| route.route_id.as_str())
            .collect::<BTreeSet<_>>();
        let mut ids = BTreeSet::new();
        let mut previous_shared: Option<String> = None;
        let mut previous_by_route: BTreeMap<String, String> = BTreeMap::new();
        templates
            .into_iter()
            .map(|(_, _, prepared_binding, template)| {
                let binding_id = prepared_binding.binding.binding_id.as_str();
                let previous = if route_ids.contains(binding_id) {
                    previous_by_route
                        .get(binding_id)
                        .or(previous_shared.as_ref())
                } else {
                    previous_shared.as_ref()
                };
                let node = make_plan_node(
                    prepared_binding.binding,
                    &prepared_binding.settings,
                    template,
                    &mut ids,
                    previous.cloned(),
                )?;
                if route_ids.contains(binding_id) {
                    previous_by_route.insert(binding_id.to_string(), node.id.clone());
                } else {
                    previous_shared = Some(node.id.clone());
                }
                Ok(node)
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
    previous_id: Option<String>,
) -> Result<PlanNode, PublishError> {
    template.operation.validate()?;
    let id = format!("{}.{}", binding.binding_id, template.local_id);
    if !ids.insert(id.clone()) {
        return Err(PublishError::InvalidPlan(format!(
            "plan node id {id} is not unique"
        )));
    }
    Ok(PlanNode {
        id,
        stage: template.stage,
        adapter: binding.adapter.clone(),
        binding_id: binding.binding_id.clone(),
        settings: settings.clone(),
        operation: template.operation,
        depends_on: previous_id.into_iter().collect(),
        artifact_inputs: template.artifact_inputs,
        artifact_outputs: template.artifact_outputs,
        side_effects: template.side_effects,
        cancellable: template.cancellable,
        cleanup_owned_staging: template.cleanup_owned_staging,
        irreversible: template.irreversible,
    })
}
