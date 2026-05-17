//! Integration tests for the provider registry and spec model.
//!
//! Tests the public provider registry API (listing, lookup, schema)
//! and the PublishSpec model (construction, validation).

use one_publish_lib::provider::registry::provider_registry;
use one_publish_lib::spec::{PublishSpec, SpecValue, SPEC_VERSION};
use std::collections::BTreeMap;

// ─── Provider Registry ───

#[test]
fn registry_is_singleton() {
    let r1 = provider_registry() as *const _;
    let r2 = provider_registry() as *const _;
    assert_eq!(r1, r2, "provider_registry should return the same instance");
}

#[test]
fn registry_has_providers() {
    let registry = provider_registry();
    let providers = registry.catalog_entries();

    assert!(
        !providers.is_empty(),
        "registry should have at least one provider"
    );

    // Each provider should have required fields
    for entry in providers {
        assert!(!entry.id.is_empty(), "provider should have an id");
        assert!(
            !entry.display_name.is_empty(),
            "provider should have a display_name"
        );
    }
}

#[test]
fn registry_get_dotnet_provider() {
    let registry = provider_registry();
    let result = registry.get("dotnet");

    // dotnet may or may not be registered (depends on build)
    // But the registry.get() should not panic
    match result {
        Ok(provider) => {
            assert_eq!(provider.manifest().id, "dotnet");
        }
        Err(_) => {
            // Provider not found — acceptable
        }
    }
}

#[test]
fn registry_list_includes_known_providers() {
    let registry = provider_registry();
    let ids = registry.known_ids();

    // At least one of the built-in providers should be present
    let known = ["dotnet", "cargo", "go", "java_gradle"];
    let has_known = known.iter().any(|k| ids.contains(&k.to_string()));
    assert!(
        has_known,
        "registry should include at least one known provider, got: {:?}",
        ids
    );
}

#[test]
fn provider_catalog_entries_are_well_formed() {
    let registry = provider_registry();
    let entries = registry.catalog_entries();

    for entry in entries {
        assert!(!entry.id.is_empty(), "catalog entry should have an id");
        assert!(!entry.label.is_empty(), "catalog entry should have a label");
        assert!(!entry.command_example.is_empty(), "catalog entry should have a command_example");
    }
}

// ─── PublishSpec ───

#[test]
fn spec_construction() {
    let mut params = BTreeMap::new();
    params.insert("configuration".to_string(), SpecValue::String("Release".to_string()));
    params.insert("selfContained".to_string(), SpecValue::Bool(true));

    let spec = PublishSpec {
        version: SPEC_VERSION,
        provider_id: "dotnet".to_string(),
        project_path: "/test/project.csproj".to_string(),
        parameters: params,
    };

    assert_eq!(spec.version, SPEC_VERSION);
    assert_eq!(spec.provider_id, "dotnet");
    assert_eq!(spec.project_path, "/test/project.csproj");
    assert_eq!(spec.parameters.len(), 2);
}

#[test]
fn spec_with_empty_parameters() {
    let spec = PublishSpec {
        version: SPEC_VERSION,
        provider_id: "cargo".to_string(),
        project_path: "/test/Cargo.toml".to_string(),
        parameters: BTreeMap::new(),
    };

    assert!(spec.parameters.is_empty());
}

#[test]
fn spec_handles_all_value_types() {
    let mut params = BTreeMap::new();
    params.insert("string".to_string(), SpecValue::String("hello".to_string()));
    params.insert("bool_true".to_string(), SpecValue::Bool(true));
    params.insert("bool_false".to_string(), SpecValue::Bool(false));
    params.insert("number".to_string(), SpecValue::Number(42.0));

    let spec = PublishSpec {
        version: SPEC_VERSION,
        provider_id: "dotnet".to_string(),
        project_path: "/test".to_string(),
        parameters: params,
    };

    assert_eq!(spec.parameters.len(), 4);

    match spec.parameters.get("string").unwrap() {
        SpecValue::String(s) => assert_eq!(s, "hello"),
        _ => panic!("expected string"),
    }

    match spec.parameters.get("bool_true").unwrap() {
        SpecValue::Bool(b) => assert!(b),
        _ => panic!("expected bool true"),
    }

    match spec.parameters.get("number").unwrap() {
        SpecValue::Number(n) => assert!((*n - 42.0).abs() < f64::EPSILON),
        _ => panic!("expected number"),
    }
}
