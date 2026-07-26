use publish_domain::{
    sha256_hex, AdapterIdentity, AdapterKind, AutomationRuntimeRevision, RuntimeAdapterRevision,
    RuntimeComponentRevision, AUTOMATION_RUNTIME_REVISION_VERSION,
};

fn digest(label: &str) -> String {
    sha256_hex(label.as_bytes())
}

fn fixed_revision() -> AutomationRuntimeRevision {
    AutomationRuntimeRevision::seal(
        RuntimeComponentRevision::new("0.1.0", digest("one-publish-runner@0.1.0")),
        RuntimeComponentRevision::new("1", digest("publish-plan-contract@1")),
        vec![
            RuntimeAdapterRevision::new(
                AdapterIdentity::new(AdapterKind::ExecutionBackend, "fake-github-actions", 1),
                digest("fake-github-actions@1"),
            ),
            RuntimeAdapterRevision::new(
                AdapterIdentity::new(AdapterKind::ProjectProvider, "fake-project", 1),
                digest("fake-project@1"),
            ),
        ],
    )
    .expect("seal fixed runtime revision")
}

#[test]
fn runtime_revision_seals_runner_plan_and_adapter_digests() {
    let revision = fixed_revision();

    assert_eq!(revision.version, AUTOMATION_RUNTIME_REVISION_VERSION);
    assert_eq!(revision.runner.version, "0.1.0");
    assert_eq!(revision.plan_contract.version, "1");
    assert_eq!(revision.adapters.len(), 2);
    assert_eq!(revision.digest.len(), 64);
    assert_eq!(
        revision.identifier(),
        format!("runtime-v1-{}", revision.digest)
    );
    revision.validate().expect("sealed revision validates");
}

#[test]
fn runtime_revision_rejects_missing_or_floating_components() {
    let missing_digest = AutomationRuntimeRevision::seal(
        RuntimeComponentRevision::new("0.1.0", ""),
        RuntimeComponentRevision::new("1", digest("publish-plan-contract@1")),
        vec![],
    )
    .expect_err("runner digest is required");
    assert!(missing_digest.to_string().contains("digest"));

    let floating_runner = AutomationRuntimeRevision::seal(
        RuntimeComponentRevision::new("latest", digest("floating-runner")),
        RuntimeComponentRevision::new("1", digest("publish-plan-contract@1")),
        vec![],
    )
    .expect_err("floating runner versions are forbidden");
    assert!(floating_runner.to_string().contains("floating"));
}

#[test]
fn runtime_revision_detects_tampered_component_and_revision_digests() {
    let mut component_tampered = fixed_revision();
    component_tampered.runner.digest = digest("different-runner");
    assert!(component_tampered
        .validate()
        .expect_err("component changes invalidate the sealed revision")
        .to_string()
        .contains("digest mismatch"));

    let mut revision_tampered = fixed_revision();
    revision_tampered.digest = digest("different-runtime-revision");
    assert!(revision_tampered
        .validate()
        .expect_err("revision digest changes are rejected")
        .to_string()
        .contains("digest mismatch"));
}
