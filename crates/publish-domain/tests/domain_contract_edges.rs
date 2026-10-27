//! 契约验证的错误分支（Issue #223）：能力声明、Adapter 设置访问器、计划
//! 操作、清单条目与自动化运行修订的畸形输入都必须显式失败，而不是静默
//! 接受（ADR-0046/0055）。

use std::collections::BTreeMap;

use publish_domain::{
    canonical_digest, sha256_hex, validate_automation_runtime_revision_identifier, AdapterBinding,
    AdapterDescriptor, AdapterIdentity, AdapterKind, AdapterSchema, AdapterSchemaValueType,
    AdapterSelection, AdapterSettings, ArtifactManifest, ArtifactManifestEntry,
    AutomationRuntimeRevision, Capability, CapabilityRequirement, DeliveryRoute, PlanNodePlatform,
    PlanNodeTemplate, PlanOperation, PlanSideEffect, PlanStage, PublishError, PublishingCapability,
    RuntimeAdapterRevision, RuntimeComponentRevision, ARTIFACT_MANIFEST_VERSION,
    AUTOMATION_RUNTIME_REVISION_VERSION,
};
use serde_json::json;

#[test]
fn capability_declaration_rejects_empty_duplicate_and_inverted_entries() {
    let capabilities = |provides: Vec<Capability>, requires: Vec<CapabilityRequirement>| {
        PublishingCapability { provides, requires }
    };

    for capability in [Capability::new(" ", 1), Capability::new("cap", 0)] {
        assert!(capabilities(vec![capability], vec![])
            .validate("adapter-x")
            .expect_err("provided capabilities need an id and a positive version")
            .to_string()
            .contains("non-empty id and positive version"));
    }

    assert!(capabilities(
        vec![Capability::new("cap", 1), Capability::new("cap", 1)],
        vec![]
    )
    .validate("adapter-x")
    .expect_err("one capability cannot be declared twice")
    .to_string()
    .contains("declared more than once"));

    for requirement in [
        CapabilityRequirement {
            id: " ".to_string(),
            minimum_version: 1,
            maximum_version: 1,
        },
        CapabilityRequirement {
            id: "cap".to_string(),
            minimum_version: 0,
            maximum_version: 1,
        },
        CapabilityRequirement {
            id: "cap".to_string(),
            minimum_version: 3,
            maximum_version: 1,
        },
    ] {
        assert!(capabilities(vec![], vec![requirement])
            .validate("adapter-x")
            .expect_err("requirements need an id and a valid version range")
            .to_string()
            .contains("valid id and version range"));
    }

    capabilities(
        vec![Capability::new("cap", 2)],
        vec![CapabilityRequirement::exact("dep", 1)],
    )
    .validate("adapter-x")
    .expect("well-formed capability declarations pass");
}

#[test]
fn adapter_settings_accessors_report_the_expected_shape() {
    let settings = AdapterSettings::new(1)
        .with_value("count", json!("not-a-number"))
        .with_value("flag", json!("not-a-bool"))
        .with_value("names", json!(["ok", 7]));

    fn assert_setting_error<T>(result: Result<T, PublishError>, key: &str) {
        let error = result.err().expect("malformed settings must fail");
        assert!(error.to_string().contains(key), "{error}");
    }

    assert_setting_error(settings.unsigned_number("count", "adapter-x"), "count");
    assert_setting_error(settings.unsigned_number("missing", "adapter-x"), "missing");
    assert_setting_error(settings.boolean("flag", "adapter-x"), "flag");
    assert_setting_error(settings.string_list("names", "adapter-x"), "names");
}

#[test]
fn delivery_routes_expose_binding_identity_and_optionality() {
    let binding = AdapterBinding::new(
        "route-binding",
        AdapterIdentity::new(AdapterKind::DeliveryDestination, "local", 1),
        AdapterSettings::new(1),
    );
    let optional = DeliveryRoute::optional(binding);
    assert!(!optional.required);
    assert_eq!(optional.route_id(), "route-binding");
}

#[test]
fn plan_operation_validation_catches_empty_programs_and_actions() {
    let empty_program = PlanOperation::RunProgram {
        program: "  ".to_string(),
        args: vec![],
        working_directory: None,
        environment_references: BTreeMap::new(),
    };
    assert!(empty_program
        .validate()
        .expect_err("empty programs are rejected")
        .to_string()
        .contains("program cannot be empty"));

    let empty_action = PlanOperation::AdapterAction {
        action: " ".to_string(),
        inputs: BTreeMap::new(),
    };
    assert!(empty_action
        .validate()
        .expect_err("empty adapter actions are rejected")
        .to_string()
        .contains("adapter action cannot be empty"));
}

#[test]
fn plan_node_platform_host_matches_the_build_target_family() {
    let expected = if cfg!(target_os = "macos") {
        PlanNodePlatform::Macos
    } else if cfg!(target_os = "windows") {
        PlanNodePlatform::Windows
    } else {
        PlanNodePlatform::Linux
    };
    assert_eq!(PlanNodePlatform::host(), expected);
}

#[test]
fn plan_node_templates_carry_explicit_lifecycle_flags() {
    let node = PlanNodeTemplate::command("build", PlanStage::Build, "cargo", vec![])
        .non_cancellable()
        .with_owned_staging_cleanup()
        .irreversible()
        .with_platform(PlanNodePlatform::Linux)
        .with_artifact_io(vec!["src".to_string()], vec!["bin".to_string()])
        .with_side_effects(vec![PlanSideEffect::FileSystem]);

    assert!(!node.cancellable);
    assert!(node.cleanup_owned_staging);
    assert!(node.irreversible);
    assert_eq!(node.platform, PlanNodePlatform::Linux);
    assert_eq!(node.artifact_inputs, vec!["src".to_string()]);
    assert_eq!(node.artifact_outputs, vec!["bin".to_string()]);
    assert_eq!(node.side_effects, vec![PlanSideEffect::FileSystem]);

    let action = PlanNodeTemplate::adapter_action(
        "observe",
        PlanStage::ObserveRoutes,
        "observe",
        BTreeMap::new(),
    );
    assert!(matches!(
        action.operation,
        PlanOperation::AdapterAction { .. }
    ));
    assert!(action.cancellable);
}

fn manifest_entry(file_name: &str) -> ArtifactManifestEntry {
    ArtifactManifestEntry {
        file_name: file_name.to_string(),
        role: "binary".to_string(),
        media_type: "application/octet-stream".to_string(),
        platform: "darwin".to_string(),
        architecture: "arm64".to_string(),
        size: 3,
        digest: sha256_hex(b"bin"),
        locator: "sha256/bin".to_string(),
        retention: "keep".to_string(),
        executable: Some(false),
    }
}

#[test]
fn manifests_reject_empty_seals_and_unsupported_versions() {
    assert!(ArtifactManifest::seal("snapshot", vec![])
        .expect_err("empty artifact sets cannot be sealed")
        .to_string()
        .contains("empty artifact manifest"));

    let mut unsupported =
        ArtifactManifest::seal("snapshot", vec![manifest_entry("app")]).expect("seal a manifest");
    unsupported.version = 999;
    assert!(unsupported
        .validate()
        .expect_err("unsupported manifest versions are rejected")
        .to_string()
        .contains("unsupported artifact manifest version"));

    let empty = ArtifactManifest {
        version: ARTIFACT_MANIFEST_VERSION,
        planning_snapshot_digest: "snapshot".to_string(),
        artifacts: vec![],
        digest: "d".repeat(64),
    };
    assert!(empty
        .validate()
        .expect_err("empty manifests fail validation")
        .to_string()
        .contains("cannot be empty"));
}

#[test]
fn manifest_entries_require_locators_retention_and_sha256_digests() {
    let mut missing_locator = manifest_entry("app");
    missing_locator.locator = " ".to_string();
    assert!(missing_locator
        .validate()
        .expect_err("locators are required")
        .to_string()
        .contains("locator and retention are required"));

    let mut bad_digest = manifest_entry("app");
    bad_digest.digest = "not-a-digest".to_string();
    assert!(bad_digest
        .validate()
        .expect_err("digests must be sha256")
        .to_string()
        .contains("SHA-256"));

    let mut missing_role = manifest_entry("app");
    missing_role.role = " ".to_string();
    assert!(missing_role
        .validate()
        .expect_err("artifact metadata is required")
        .to_string()
        .contains("role, media type, platform, and architecture are required"));
}

fn digest(label: &str) -> String {
    sha256_hex(label.as_bytes())
}

fn component(version: &str, label: &str) -> RuntimeComponentRevision {
    RuntimeComponentRevision::new(version, digest(label))
}

fn backend_revision() -> RuntimeAdapterRevision {
    RuntimeAdapterRevision::new(
        AdapterIdentity::new(AdapterKind::ExecutionBackend, "backend", 1),
        digest("backend@1"),
    )
}

#[test]
fn runtime_revisions_reject_empty_versions_and_malformed_binary_digests() {
    let empty_version = AutomationRuntimeRevision::seal(
        RuntimeComponentRevision::new(" ", digest("runner")),
        component("1", "plan"),
        vec![backend_revision()],
    )
    .expect_err("component versions are required");
    assert!(empty_version.to_string().contains("version is required"));

    let empty_target = component("0.1.0", "runner")
        .with_binary_digests(BTreeMap::from([(" ".to_string(), digest("binary"))]));
    assert!(AutomationRuntimeRevision::seal(
        empty_target,
        component("1", "plan"),
        vec![backend_revision()]
    )
    .expect_err("binary digests need a target triple")
    .to_string()
    .contains("target triple is required"));

    let bad_binary_digest = component("0.1.0", "runner").with_binary_digests(BTreeMap::from([(
        "aarch64-apple-darwin".to_string(),
        "oops".to_string(),
    )]));
    assert!(AutomationRuntimeRevision::seal(
        bad_binary_digest,
        component("1", "plan"),
        vec![backend_revision()]
    )
    .expect_err("binary digests must be sha256")
    .to_string()
    .contains("must be a lowercase SHA-256 digest"));

    let bad_adapter = RuntimeAdapterRevision::new(
        AdapterIdentity::new(AdapterKind::ExecutionBackend, "backend", 1),
        "not-a-digest",
    );
    assert!(AutomationRuntimeRevision::seal(
        component("0.1.0", "runner"),
        component("1", "plan"),
        vec![bad_adapter]
    )
    .expect_err("adapter digests must be sha256")
    .to_string()
    .contains("must be a lowercase SHA-256 digest"));
}

#[test]
fn runtime_revisions_enforce_contract_version_and_sorted_unique_adapters() {
    let revision = AutomationRuntimeRevision::seal(
        component("0.1.0", "runner"),
        component("1", "plan"),
        vec![
            RuntimeAdapterRevision::new(
                AdapterIdentity::new(AdapterKind::DeliveryDestination, "dest", 1),
                digest("dest@1"),
            ),
            backend_revision(),
        ],
    )
    .expect("seal sorts adapters deterministically");
    assert_eq!(
        revision.adapters[0].adapter.kind,
        AdapterKind::ExecutionBackend,
        "seal orders adapters by identity"
    );

    let mut wrong_version = revision.clone();
    wrong_version.version = AUTOMATION_RUNTIME_REVISION_VERSION + 1;
    assert!(wrong_version
        .validate()
        .expect_err("foreign contract versions are rejected")
        .to_string()
        .contains("unsupported contract version"));

    assert!(AutomationRuntimeRevision::seal(
        component("0.1.0", "runner"),
        component("1", "plan"),
        vec![]
    )
    .expect_err("a revision without adapters is incomplete")
    .to_string()
    .contains("at least one adapter revision"));

    assert!(AutomationRuntimeRevision::seal(
        component("0.1.0", "runner"),
        component("1", "plan"),
        vec![backend_revision(), backend_revision()]
    )
    .expect_err("duplicate adapter identities are rejected")
    .to_string()
    .contains("unique and sorted"));
}

#[test]
fn runtime_revision_identifiers_require_prefix_and_sha256_suffix() {
    let revision = AutomationRuntimeRevision::seal(
        component("0.1.0", "runner"),
        component("1", "plan"),
        vec![backend_revision()],
    )
    .expect("seal revision");
    validate_automation_runtime_revision_identifier(&revision.identifier())
        .expect("sealed identifiers validate");

    assert!(
        validate_automation_runtime_revision_identifier("runtime-v0-abc")
            .expect_err("wrong prefixes are rejected")
            .to_string()
            .contains("must start with")
    );

    assert!(
        validate_automation_runtime_revision_identifier("runtime-v1-not-a-digest")
            .expect_err("non-sha256 suffixes are rejected")
            .to_string()
            .contains("SHA-256")
    );
}

struct Unserializable;

impl serde::Serialize for Unserializable {
    fn serialize<S: serde::Serializer>(&self, _serializer: S) -> Result<S::Ok, S::Error> {
        Err(serde::ser::Error::custom("cannot serialize"))
    }
}

#[test]
fn canonical_digests_fail_when_contracts_cannot_serialize() {
    let error = canonical_digest(&Unserializable)
        .expect_err("unserializable contracts cannot produce digests");
    assert!(error.to_string().contains("cannot serialize contract"));
}

#[test]
fn schema_builders_declare_typed_fields() {
    let schema = AdapterSchema::new(1)
        .with_required_string("repository")
        .with_required_number("port")
        .with_required_boolean("tls")
        .with_required_string_list("roles")
        .with_optional_string_list("tags");
    for (key, value_type, required) in [
        ("repository", AdapterSchemaValueType::String, true),
        ("port", AdapterSchemaValueType::Number, true),
        ("tls", AdapterSchemaValueType::Boolean, true),
        ("roles", AdapterSchemaValueType::StringList, true),
        ("tags", AdapterSchemaValueType::StringList, false),
    ] {
        let field = schema.fields.get(key).expect("declared field");
        assert_eq!(field.value_type, value_type);
        assert_eq!(field.required, required);
    }
}

#[test]
fn settings_accessors_reject_missing_and_mistyped_values() {
    let settings = AdapterSettings::new(1)
        .with_value("port", serde_json::json!("not-a-number"))
        .with_value("tls", serde_json::json!("not-a-bool"));
    let adapter = "test-adapter";

    assert!(matches!(
        settings.string("missing", adapter),
        Err(PublishError::InvalidAdapterSettings { .. })
    ));
    assert!(matches!(
        settings.unsigned_number("port", adapter),
        Err(PublishError::InvalidAdapterSettings { .. })
    ));
    assert!(matches!(
        settings.boolean("tls", adapter),
        Err(PublishError::InvalidAdapterSettings { .. })
    ));
}

#[test]
fn capability_requirements_accept_versions_inside_the_declared_range() {
    let requirement = CapabilityRequirement {
        id: "cap".to_string(),
        minimum_version: 2,
        maximum_version: 4,
    };
    assert!(!requirement.accepts(1));
    assert!(requirement.accepts(2));
    assert!(requirement.accepts(4));
    assert!(!requirement.accepts(5));
}

#[test]
fn delivery_routes_carry_required_semantics_and_binding_identity() {
    let binding = AdapterBinding::new(
        "route-a",
        AdapterIdentity::new(AdapterKind::DeliveryDestination, "dest", 1),
        AdapterSettings::new(1),
    );
    let required = DeliveryRoute::required(binding.clone());
    let optional = DeliveryRoute::optional(binding);
    assert!(required.required);
    assert!(!optional.required);
    assert_eq!(required.route_id(), "route-a");
    assert_eq!(optional.route_id(), "route-a");
}

#[test]
fn selection_orders_bindings_deterministically() {
    let identity = |kind, id| AdapterIdentity::new(kind, id, 1);
    let binding =
        |id: &str, kind| AdapterBinding::new(id.to_string(), kind, AdapterSettings::new(1));
    let selection = AdapterSelection {
        project_provider: binding("provider", identity(AdapterKind::ProjectProvider, "p")),
        artifact_processors: vec![binding(
            "proc",
            identity(AdapterKind::ArtifactProcessor, "a"),
        )],
        execution_backend: binding("backend", identity(AdapterKind::ExecutionBackend, "e")),
        artifact_store: binding("store", identity(AdapterKind::ArtifactStore, "s")),
        delivery_routes: vec![
            DeliveryRoute::required(binding(
                "route-1",
                identity(AdapterKind::DeliveryDestination, "d1"),
            )),
            DeliveryRoute::optional(binding(
                "route-2",
                identity(AdapterKind::DeliveryDestination, "d2"),
            )),
        ],
    };
    let ids: Vec<&str> = selection
        .ordered_bindings()
        .iter()
        .map(|binding| binding.binding_id.as_str())
        .collect();
    assert_eq!(
        ids,
        ["provider", "proc", "backend", "store", "route-1", "route-2"]
    );
}

#[test]
fn descriptor_identity_round_trips_kind_id_and_version() {
    let descriptor = AdapterDescriptor::new(
        AdapterKind::DeliveryDestination,
        "dest",
        7,
        AdapterSchema::new(1),
        PublishingCapability {
            provides: vec![],
            requires: vec![],
        },
    )
    .with_allowed_program("dest:ship");
    assert!(descriptor.allowed_programs.contains("dest:ship"));
    let identity = descriptor.identity();
    assert_eq!(identity.kind, AdapterKind::DeliveryDestination);
    assert_eq!(identity.id, "dest");
    assert_eq!(identity.version, 7);
    assert_eq!(
        descriptor.contract_version,
        publish_domain::ADAPTER_CONTRACT_VERSION
    );
}
