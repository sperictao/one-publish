use std::collections::BTreeMap;
use std::sync::Arc;

use publish_adapters::{
    AdapterConformanceFixture, AdapterRegistry, ExecutionBackend, FakeAutomationBackend,
    LocalExecutionBackend,
};
use publish_domain::{
    AdapterBinding, AdapterIdentity, AdapterKind, AdapterSelection, AdapterSettings,
    AutomationBindingProjection, AutomationProjection, AutomationTriggerPolicy, DeliveryRoute,
    PlanningInputSnapshot, PublishError, SourceSnapshot, AUTOMATION_PROJECTION_BUNDLE_VERSION,
    PLANNING_INPUT_SNAPSHOT_VERSION,
};
use serde_json::Value;

fn binding_projection(binding_id: &str, revision_id: &str) -> AutomationBindingProjection {
    AutomationBindingProjection {
        binding_id: binding_id.to_string(),
        configuration_id: "configuration-1".to_string(),
        configuration_revision_id: revision_id.to_string(),
        trigger_policy: AutomationTriggerPolicy::TagPush {
            tag_prefix: "v".to_string(),
        },
        runtime_revision: "plan-v1.adapter-v1.fake-automation@1".to_string(),
        projection: AutomationProjection {
            public_settings: BTreeMap::from([(
                "configuration".to_string(),
                Value::String("Release".to_string()),
            )]),
            protected_variables: BTreeMap::new(),
            secret_references: BTreeMap::from([(
                "RELEASE_TOKEN".to_string(),
                "keychain://one-publish/release-token".to_string(),
            )]),
        },
    }
}

#[test]
fn fake_backend_renders_a_deterministic_bundle_with_owned_binding_files() {
    let backend = FakeAutomationBackend::new();
    let bindings = vec![
        binding_projection("binding-stable", "revision-1"),
        binding_projection("binding-nightly", "revision-2"),
    ];

    let first = backend
        .render_automation_bundle(&bindings)
        .expect("render automation bundle");
    let reordered = backend
        .render_automation_bundle(&[bindings[1].clone(), bindings[0].clone()])
        .expect("render reordered bundle");

    assert_eq!(first.version, AUTOMATION_PROJECTION_BUNDLE_VERSION);
    assert_eq!(first.digest, reordered.digest);
    first.validate().expect("sealed bundle validates");

    let manifest = first
        .files
        .get("one-publish/automation/bundle.json")
        .expect("bundle manifest file");
    assert_eq!(manifest.binding_id, None);
    assert!(manifest.content.contains("binding-stable"));
    assert!(manifest.content.contains("binding-nightly"));

    let stable = first
        .files
        .get("one-publish/automation/binding-stable.json")
        .expect("stable binding projection file");
    assert_eq!(stable.binding_id.as_deref(), Some("binding-stable"));
    assert!(stable.content.contains("revision-1"));
    assert!(stable.content.contains("tag_push"));
    assert!(stable
        .content
        .contains("keychain://one-publish/release-token"));
}

#[test]
fn fake_backend_rejects_rendering_an_empty_binding_set() {
    let backend = FakeAutomationBackend::new();

    assert!(matches!(
        backend.render_automation_bundle(&[]),
        Err(PublishError::Execution(message)) if message.contains("binding")
    ));
}

#[test]
fn local_backend_reports_the_missing_automation_projection_capability() {
    let backend = LocalExecutionBackend::new();

    let result =
        backend.render_automation_bundle(&[binding_projection("binding-stable", "revision-1")]);

    assert!(matches!(
        result,
        Err(PublishError::MissingCapability { capability, .. })
            if capability == "automation-projection"
    ));
}

#[test]
fn fake_backend_registers_through_the_conformance_harness() {
    let mut registry = AdapterRegistry::new();
    let fixture = AdapterConformanceFixture::new(fixture_snapshot());

    registry
        .register_execution_backend(Arc::new(FakeAutomationBackend::new()), &fixture)
        .expect("fake automation backend passes conformance");
}

fn fixture_snapshot() -> PlanningInputSnapshot {
    let empty = AdapterSettings::new(1);
    PlanningInputSnapshot {
        version: PLANNING_INPUT_SNAPSHOT_VERSION,
        configuration_revision: "revision-1".to_string(),
        runtime_revision: "runner-1".to_string(),
        release_input: BTreeMap::new(),
        source: SourceSnapshot {
            revision: "0123456789abcdef".to_string(),
            workspace_digest: None,
            dirty: false,
            captured_at: "2026-07-21T10:00:00Z".to_string(),
            reproducible: true,
        },
        external_preconditions: BTreeMap::new(),
        adapters: AdapterSelection {
            project_provider: AdapterBinding::new(
                "project",
                AdapterIdentity::new(AdapterKind::ProjectProvider, "project", 1),
                empty.clone(),
            ),
            artifact_processors: vec![],
            execution_backend: AdapterBinding::new(
                "backend",
                AdapterIdentity::new(AdapterKind::ExecutionBackend, "fake-automation", 1),
                empty.clone(),
            ),
            artifact_store: AdapterBinding::new(
                "store",
                AdapterIdentity::new(AdapterKind::ArtifactStore, "store", 1),
                empty.clone(),
            ),
            delivery_routes: vec![DeliveryRoute::required(AdapterBinding::new(
                "destination",
                AdapterIdentity::new(AdapterKind::DeliveryDestination, "destination", 1),
                empty,
            ))],
        },
    }
}
