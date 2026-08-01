use std::collections::BTreeMap;
use std::sync::Arc;

use publish_adapters::{
    AdapterConformanceFixture, AdapterContract, AdapterRegistry, ExecutionBackend,
    FakeAutomationBackend, FakeGitHubActionsBackend, LocalExecutionBackend, StaticCredentialSource,
};
use publish_domain::{
    sha256_hex, AdapterBinding, AdapterIdentity, AdapterKind, AdapterSelection, AdapterSettings,
    AutomationBindingProjection, AutomationProjection, AutomationRuntimeRevision,
    AutomationTriggerPolicy, DeliveryRoute, PlanningInputSnapshot, PublishError,
    RuntimeAdapterRevision, RuntimeComponentRevision, SourceSnapshot,
    AUTOMATION_PROJECTION_BUNDLE_VERSION, PLANNING_INPUT_SNAPSHOT_VERSION,
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
        release_namespace: "tag:v*".to_string(),
        delivery_destination_namespaces: vec!["github-release:repository".to_string()],
        runtime_revision: runtime_revision().into(),
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

fn runtime_revision() -> AutomationRuntimeRevision {
    AutomationRuntimeRevision::seal(
        // 决议 #86：投影渲染要求分发资产摘要已固化。
        RuntimeComponentRevision::new("0.1.0", sha256_hex(b"runner")).with_binary_digests(
            std::collections::BTreeMap::from([(
                "x86_64-unknown-linux-gnu".to_string(),
                sha256_hex(b"runner-binary"),
            )]),
        ),
        RuntimeComponentRevision::new("1", sha256_hex(b"plan")),
        vec![RuntimeAdapterRevision::new(
            AdapterIdentity::new(AdapterKind::ExecutionBackend, "fake-automation", 1),
            sha256_hex(b"adapter"),
        )],
    )
    .expect("seal fixture runtime")
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
fn fake_github_actions_backend_projects_and_executes_the_shared_runner_contract() {
    let backend = FakeGitHubActionsBackend::new(Arc::new(StaticCredentialSource::new()));
    let bundle = backend
        .render_automation_bundle(&[binding_projection("binding-stable", "revision-1")])
        .expect("render fake GitHub Actions projection");

    assert_eq!(bundle.backend.id, "fake-github-actions");
    assert!(bundle
        .files
        .contains_key("one-publish/automation/binding-stable.json"));
    assert!(backend
        .descriptor()
        .capabilities
        .provides
        .iter()
        .any(|capability| capability.id == "structured-plan-execution"));
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
        promoted_manifest_digest: None,
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
