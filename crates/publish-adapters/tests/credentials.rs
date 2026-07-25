use std::collections::BTreeMap;
use std::sync::Arc;

use publish_adapters::{
    verify_adapter_conformance, AdapterConformanceFixture, AdapterContract, AdapterRegistry,
    CredentialResolveFailure, CredentialSource, ExecutionBackend, LocalExecutionBackend,
    ProjectProvider, StaticCredentialSource,
};
use publish_domain::{
    AdapterBinding, AdapterDescriptor, AdapterIdentity, AdapterKind, AdapterSchema,
    AdapterSelection, AdapterSettings, CredentialKind, PlanNodeTemplate, PlanningInputSnapshot,
    PublishError, PublishingCapability, SourceSnapshot, PLANNING_INPUT_SNAPSHOT_VERSION,
};

const TOKEN_REFERENCE: &str = "keychain://one-publish/release-token";
const TOKEN_SECRET: &str = "gh-token-secret-material";

struct CredentialedProvider {
    descriptor: AdapterDescriptor,
}

impl CredentialedProvider {
    fn new(schema: AdapterSchema) -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ProjectProvider,
                "credentialed-project",
                1,
                schema,
                PublishingCapability {
                    provides: vec![],
                    requires: vec![],
                },
            ),
        }
    }

    fn with_token_requirement() -> Self {
        Self::new(AdapterSchema::new(1).with_credential(
            "release-token",
            CredentialKind::Token,
            "publishes GitHub releases",
        ))
    }
}

impl AdapterContract for CredentialedProvider {
    fn descriptor(&self) -> &AdapterDescriptor {
        &self.descriptor
    }

    fn default_settings(&self) -> AdapterSettings {
        AdapterSettings::new(1)
    }

    fn plan_fragment(
        &self,
        _snapshot: &PlanningInputSnapshot,
        _settings: &AdapterSettings,
    ) -> Result<Vec<PlanNodeTemplate>, PublishError> {
        Ok(vec![])
    }
}

impl ProjectProvider for CredentialedProvider {}

#[test]
fn static_sources_resolve_secrets_and_report_denied_or_missing_references() {
    let source = StaticCredentialSource::new()
        .with_secret(TOKEN_REFERENCE, CredentialKind::Token, TOKEN_SECRET)
        .with_denied("keychain://one-publish/locked");

    let resolved = source.resolve(TOKEN_REFERENCE).expect("resolve secret");
    assert_eq!(resolved.kind, CredentialKind::Token);
    assert_eq!(resolved.value.expose(), TOKEN_SECRET);

    assert!(matches!(
        source.resolve("keychain://one-publish/locked"),
        Err(CredentialResolveFailure::AccessDenied)
    ));
    assert!(matches!(
        source.resolve("keychain://one-publish/unknown"),
        Err(CredentialResolveFailure::Missing)
    ));
}

#[test]
fn a_local_backend_without_a_credential_source_reports_missing_references() {
    let backend = LocalExecutionBackend::new();
    assert!(matches!(
        backend.resolve_credential(TOKEN_REFERENCE),
        Err(CredentialResolveFailure::Missing)
    ));

    let sourced = LocalExecutionBackend::with_credential_source(Arc::new(
        StaticCredentialSource::new().with_secret(
            TOKEN_REFERENCE,
            CredentialKind::Token,
            TOKEN_SECRET,
        ),
    ));
    let resolved = sourced
        .resolve_credential(TOKEN_REFERENCE)
        .expect("resolve through the local source");
    assert_eq!(resolved.value.expose(), TOKEN_SECRET);
}

#[test]
fn the_registry_resolves_exactly_the_declared_credentials_through_the_backend() {
    let registry = fixture_registry(
        CredentialedProvider::with_token_requirement(),
        StaticCredentialSource::new().with_secret(
            TOKEN_REFERENCE,
            CredentialKind::Token,
            TOKEN_SECRET,
        ),
    );
    let binding = provider_binding().with_credential("release-token", TOKEN_REFERENCE);

    registry
        .validate_credential_bindings(&binding)
        .expect("statically valid credential bindings");
    let resolved = registry
        .resolve_binding_credentials(&backend_identity(), &binding)
        .expect("resolve declared credentials");

    assert_eq!(
        resolved.keys().collect::<Vec<_>>(),
        vec!["release-token"],
        "adapters receive exactly the credentials their schema declares"
    );
    assert_eq!(resolved["release-token"].value.expose(), TOKEN_SECRET);
}

#[test]
fn unbound_and_undeclared_credentials_are_blocked_statically() {
    let registry = fixture_registry(
        CredentialedProvider::with_token_requirement(),
        StaticCredentialSource::new(),
    );

    let unbound = provider_binding();
    assert!(matches!(
        registry.validate_credential_bindings(&unbound),
        Err(PublishError::CredentialNotBound { requirement, .. })
            if requirement == "release-token"
    ));

    let undeclared = provider_binding()
        .with_credential("release-token", TOKEN_REFERENCE)
        .with_credential("extra-secret", "keychain://one-publish/extra");
    assert!(matches!(
        registry.validate_credential_bindings(&undeclared),
        Err(PublishError::CredentialNotDeclared { name, .. }) if name == "extra-secret"
    ));
}

#[test]
fn missing_denied_and_mismatched_references_map_to_distinct_diagnostics() {
    let registry = fixture_registry(
        CredentialedProvider::with_token_requirement(),
        StaticCredentialSource::new()
            .with_secret(
                "keychain://one-publish/signing",
                CredentialKind::SigningKey,
                "signing-secret-material",
            )
            .with_denied("keychain://one-publish/locked"),
    );

    let missing = provider_binding().with_credential("release-token", TOKEN_REFERENCE);
    let error = registry
        .resolve_binding_credentials(&backend_identity(), &missing)
        .expect_err("missing reference");
    assert!(matches!(
        &error,
        PublishError::CredentialReferenceMissing { reference, .. }
            if reference == TOKEN_REFERENCE
    ));
    assert!(error.to_string().contains(TOKEN_REFERENCE));

    let denied =
        provider_binding().with_credential("release-token", "keychain://one-publish/locked");
    assert!(matches!(
        registry.resolve_binding_credentials(&backend_identity(), &denied),
        Err(PublishError::CredentialAccessDenied { reference, .. })
            if reference == "keychain://one-publish/locked"
    ));

    let mismatched =
        provider_binding().with_credential("release-token", "keychain://one-publish/signing");
    let error = registry
        .resolve_binding_credentials(&backend_identity(), &mismatched)
        .expect_err("kind mismatch");
    assert!(matches!(
        &error,
        PublishError::CredentialKindMismatch {
            expected: CredentialKind::Token,
            actual: CredentialKind::SigningKey,
            ..
        }
    ));
    assert!(
        !error.to_string().contains("signing-secret-material"),
        "diagnostics must never leak resolved values"
    );
}

#[test]
fn conformance_rejects_credential_declarations_without_name_or_purpose() {
    let fixture = AdapterConformanceFixture::new(fixture_snapshot());

    let unnamed = CredentialedProvider::new(AdapterSchema::new(1).with_credential(
        " ",
        CredentialKind::Token,
        "publishes releases",
    ));
    assert!(matches!(
        verify_adapter_conformance(&unnamed, AdapterKind::ProjectProvider, &fixture),
        Err(PublishError::InvalidAdapter { message, .. }) if message.contains("credential")
    ));

    let unexplained = CredentialedProvider::new(AdapterSchema::new(1).with_credential(
        "release-token",
        CredentialKind::Token,
        " ",
    ));
    assert!(matches!(
        verify_adapter_conformance(&unexplained, AdapterKind::ProjectProvider, &fixture),
        Err(PublishError::InvalidAdapter { message, .. }) if message.contains("credential")
    ));
}

fn provider_binding() -> AdapterBinding {
    AdapterBinding::new(
        "project",
        AdapterIdentity::new(AdapterKind::ProjectProvider, "credentialed-project", 1),
        AdapterSettings::new(1),
    )
}

fn backend_identity() -> AdapterIdentity {
    AdapterIdentity::new(AdapterKind::ExecutionBackend, "local-execution", 1)
}

fn fixture_registry(
    provider: CredentialedProvider,
    source: StaticCredentialSource,
) -> AdapterRegistry {
    let fixture = AdapterConformanceFixture::new(fixture_snapshot());
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(Arc::new(provider), &fixture)
        .expect("register credentialed provider");
    registry
        .register_execution_backend(
            Arc::new(LocalExecutionBackend::with_credential_source(Arc::new(
                source,
            ))),
            &fixture,
        )
        .expect("register local backend");
    registry
}

fn fixture_snapshot() -> PlanningInputSnapshot {
    let empty = AdapterSettings::new(1);
    PlanningInputSnapshot {
        version: PLANNING_INPUT_SNAPSHOT_VERSION,
        configuration_revision: "config-revision-1".to_string(),
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
                AdapterIdentity::new(AdapterKind::ProjectProvider, "credentialed-project", 1),
                empty.clone(),
            ),
            artifact_processors: vec![],
            execution_backend: AdapterBinding::new(
                "backend",
                AdapterIdentity::new(AdapterKind::ExecutionBackend, "local-execution", 1),
                empty.clone(),
            ),
            artifact_store: AdapterBinding::new(
                "store",
                AdapterIdentity::new(AdapterKind::ArtifactStore, "temporary-artifact-store", 1),
                empty.clone(),
            ),
            delivery_destinations: vec![AdapterBinding::new(
                "destination",
                AdapterIdentity::new(AdapterKind::DeliveryDestination, "local-directory", 1),
                empty,
            )],
        },
    }
}
