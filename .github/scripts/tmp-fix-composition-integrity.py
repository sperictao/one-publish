from pathlib import Path

# publish_runtime.rs: shared composition structural/compatibility validation.
path = Path('src-tauri/src/publish_runtime.rs')
text = path.read_text()
text = text.replace(
    '    PublishComposition, RevisionAdapterBinding, LOCAL_BACKEND_ID, LOCAL_DESTINATION_ID,\n    TEMPORARY_STORE_ID,\n',
    '    PublishComposition, RevisionAdapterBinding, CURRENT_SETTINGS_VERSION, LOCAL_BACKEND_ID,\n    LOCAL_DESTINATION_ID, TEMPORARY_STORE_ID,\n',
    1,
)
marker = "pub(crate) fn project_binding_selector<'a>("
start = text.index(marker)
end = text.index('\n}\n', start) + 3
helper = r'''

fn composition_adapter_role(catalog: &PublishAdapterCatalog, adapter_id: &str) -> Option<&'static str> {
    if catalog.execution_backends.iter().any(|id| id == adapter_id) {
        Some("execution_backend")
    } else if catalog.artifact_stores.iter().any(|id| id == adapter_id) {
        Some("artifact_store")
    } else if catalog.artifact_processors.iter().any(|id| id == adapter_id)
        || adapter_id == publish_adapters::CUSTOM_COMMAND_PROCESSOR_ID
    {
        Some("artifact_processor")
    } else if catalog
        .delivery_destinations
        .iter()
        .any(|id| id == adapter_id)
    {
        Some("delivery_destination")
    } else {
        None
    }
}

fn composition_adapter_supported(
    catalog: &PublishAdapterCatalog,
    role: &str,
    adapter_id: &str,
) -> bool {
    match role {
        "execution_backend" => catalog.execution_backends.iter().any(|id| id == adapter_id),
        "artifact_store" => catalog.artifact_stores.iter().any(|id| id == adapter_id),
        "artifact_processor" => {
            catalog.artifact_processors.iter().any(|id| id == adapter_id)
                || adapter_id == publish_adapters::CUSTOM_COMMAND_PROCESSOR_ID
        }
        "delivery_destination" => catalog
            .delivery_destinations
            .iter()
            .any(|id| id == adapter_id),
        _ => false,
    }
}

fn composition_binding_invalid_reason(
    catalog: &PublishAdapterCatalog,
    role: &str,
    binding: &RevisionAdapterBinding,
) -> Option<String> {
    let adapter_id = binding.adapter_id.trim();
    if adapter_id.is_empty() || adapter_id != binding.adapter_id {
        return Some(format!("composition_adapter_id_invalid:{role}"));
    }
    if binding.settings_version == 0 {
        return Some(format!(
            "composition_settings_version_invalid:{role}:{adapter_id}:0"
        ));
    }
    if !binding.settings.is_object() {
        return Some(format!("composition_settings_invalid:{role}:{adapter_id}"));
    }
    if binding.credentials.iter().any(|(requirement, reference)| {
        requirement.trim().is_empty() || reference.trim().is_empty()
    }) {
        return Some(format!(
            "composition_credential_binding_invalid:{role}:{adapter_id}"
        ));
    }
    if let Some(actual_role) = composition_adapter_role(catalog, adapter_id) {
        if actual_role != role {
            return Some(format!(
                "composition_adapter_kind_mismatch:{role}:{adapter_id}:{actual_role}"
            ));
        }
    }
    None
}

/// Stable composition-shape validation. These failures are invalid regardless of
/// which Adapter versions are installed, so imports must reject them instead of
/// persisting a configuration that can never form an unambiguous plan.
pub(crate) fn composition_invalid_reason(composition: &PublishComposition) -> Option<String> {
    let catalog = builtin_adapter_catalog();
    if let Some(reason) = composition_binding_invalid_reason(
        &catalog,
        "execution_backend",
        &composition.execution_backend,
    ) {
        return Some(reason);
    }
    if let Some(reason) = composition_binding_invalid_reason(
        &catalog,
        "artifact_store",
        &composition.artifact_store,
    ) {
        return Some(reason);
    }
    for processor in &composition.artifact_processors {
        if let Some(reason) =
            composition_binding_invalid_reason(&catalog, "artifact_processor", processor)
        {
            return Some(reason);
        }
    }
    if composition.delivery_routes.is_empty() {
        return Some("composition_routes_missing".to_string());
    }

    let mut route_ids = BTreeSet::new();
    for route in &composition.delivery_routes {
        let route_id = route.route_id.trim();
        if route_id.is_empty() || route_id != route.route_id {
            return Some("composition_route_id_invalid".to_string());
        }
        if matches!(route_id, "project" | "backend" | "store")
            || route_id.starts_with("processor-")
        {
            return Some(format!("composition_route_id_reserved:{route_id}"));
        }
        if !route_ids.insert(route_id) {
            return Some(format!("composition_route_id_duplicate:{route_id}"));
        }
        if let Some(reason) = composition_binding_invalid_reason(
            &catalog,
            "delivery_destination",
            &route.destination,
        ) {
            return Some(reason);
        }
    }
    None
}

/// Runtime compatibility validation. Unknown Adapters or newer settings schemas
/// are preserved as blocked configurations so an older app does not destroy
/// forward-compatible backup data.
pub(crate) fn composition_blocked_reason(composition: &PublishComposition) -> Option<String> {
    if let Some(reason) = composition_invalid_reason(composition) {
        return Some(reason);
    }

    let catalog = builtin_adapter_catalog();
    let binding_reason = |role: &str, binding: &RevisionAdapterBinding| {
        if !composition_adapter_supported(&catalog, role, &binding.adapter_id) {
            return Some(format!(
                "composition_adapter_unavailable:{role}:{}",
                binding.adapter_id
            ));
        }
        if binding.settings_version != CURRENT_SETTINGS_VERSION {
            return Some(format!(
                "composition_settings_version_unsupported:{role}:{}:{}",
                binding.adapter_id, binding.settings_version
            ));
        }
        None
    };

    if let Some(reason) = binding_reason("execution_backend", &composition.execution_backend) {
        return Some(reason);
    }
    if let Some(reason) = binding_reason("artifact_store", &composition.artifact_store) {
        return Some(reason);
    }
    for processor in &composition.artifact_processors {
        if let Some(reason) = binding_reason("artifact_processor", processor) {
            return Some(reason);
        }
    }
    for route in &composition.delivery_routes {
        if let Some(reason) = binding_reason("delivery_destination", &route.destination) {
            return Some(reason);
        }
    }
    None
}
'''
text = text[:end] + helper + text[end:]
path.write_text(text)

# source.rs: all source kinds surface composition incompatibility before prepare.
path = Path('src-tauri/src/publish_runtime/source.rs')
text = path.read_text()
anchor = '''    if content.settings_version != CURRENT_SETTINGS_VERSION {
        return Some(format!(
            "settings_version_unsupported:{}",
            content.settings_version
        ));
    }

    None
}
'''
replacement = '''    if content.settings_version != CURRENT_SETTINGS_VERSION {
        return Some(format!(
            "settings_version_unsupported:{}",
            content.settings_version
        ));
    }

    if let Some(reason) = super::composition_blocked_reason(&content.composition) {
        return Some(reason);
    }

    None
}
'''
assert anchor in text, 'source compatibility anchor not found'
text = text.replace(anchor, replacement, 1)
path.write_text(text)

# store/types.rs: imported/migrated/internal profiles expose the same blocked state.
path = Path('src-tauri/src/store/types.rs')
text = path.read_text()
anchor = '''        if revision.settings_version != CURRENT_SETTINGS_VERSION {
            return Some(format!(
                "settings_version_unsupported:{}",
                revision.settings_version
            ));
        }

        None
    }
'''
replacement = '''        if revision.settings_version != CURRENT_SETTINGS_VERSION {
            return Some(format!(
                "settings_version_unsupported:{}",
                revision.settings_version
            ));
        }

        if let Some(reason) = crate::publish_runtime::composition_blocked_reason(&revision.composition)
        {
            return Some(reason);
        }

        None
    }
'''
assert anchor in text, 'store blocked-reason anchor not found'
text = text.replace(anchor, replacement, 1)
path.write_text(text)

# config_export.rs: reject only globally invalid composition shapes at import.
path = Path('src-tauri/src/config_export.rs')
text = path.read_text()
anchor = '''        if profile_contains_sensitive_field(profile) {
            return Err(ImportError::ValidationFailed(format!(
                "profile '{}' contains credential fields",
                profile.name
            )));
        }

        if let Some(project_binding) = profile.project_binding.as_deref() {
'''
replacement = '''        if profile_contains_sensitive_field(profile) {
            return Err(ImportError::ValidationFailed(format!(
                "profile '{}' contains credential fields",
                profile.name
            )));
        }

        if let Some(composition) = profile.composition.as_ref() {
            if let Some(reason) = crate::publish_runtime::composition_invalid_reason(composition) {
                return Err(ImportError::ValidationFailed(format!(
                    "profile '{}' has invalid composition: {reason}",
                    profile.name
                )));
            }
        }

        if let Some(project_binding) = profile.project_binding.as_deref() {
'''
assert anchor in text, 'config import validation anchor not found'
text = text.replace(anchor, replacement, 1)

# Add focused import and blocked-state tests.
marker = '''    #[test]
    fn validate_rejects_invalid_parameter_type() {
'''
insert = r'''    #[test]
    fn validate_rejects_structurally_invalid_compositions() {
        let mut cases = Vec::new();

        let mut missing_routes = crate::store::PublishComposition::local_default();
        missing_routes.delivery_routes.clear();
        cases.push((missing_routes, "composition_routes_missing"));

        let mut duplicate_route = crate::store::PublishComposition::local_default();
        duplicate_route
            .delivery_routes
            .push(duplicate_route.delivery_routes[0].clone());
        cases.push((duplicate_route, "composition_route_id_duplicate"));

        let mut reserved_route = crate::store::PublishComposition::local_default();
        reserved_route.delivery_routes[0].route_id = "backend".to_string();
        cases.push((reserved_route, "composition_route_id_reserved"));

        let mut invalid_settings = crate::store::PublishComposition::local_default();
        invalid_settings.execution_backend.settings = serde_json::json!("not-an-object");
        cases.push((invalid_settings, "composition_settings_invalid"));

        let mut wrong_kind = crate::store::PublishComposition::local_default();
        wrong_kind.execution_backend.adapter_id = crate::store::TEMPORARY_STORE_ID.to_string();
        cases.push((wrong_kind, "composition_adapter_kind_mismatch"));

        for (composition, expected_reason) in cases {
            let profile = ConfigProfile {
                name: expected_reason.to_string(),
                provider_id: "dotnet".to_string(),
                composition: Some(composition),
                parameters: BTreeMap::new(),
                profile_group: None,
                created_at: Utc::now(),
                is_system_default: false,
                ..ConfigProfile::default()
            };
            let config = ConfigExport {
                version: CONFIG_VERSION,
                exported_at: Utc::now(),
                profiles: vec![profile],
            };

            let error = validate_import(&config).expect_err("invalid composition must fail import");
            assert!(
                error.to_string().contains(expected_reason),
                "unexpected validation error: {error}"
            );
        }
    }

    #[test]
    fn unknown_and_future_adapter_compatibility_is_preserved_as_blocked() {
        for (composition, expected_reason) in [
            ({
                let mut composition = crate::store::PublishComposition::local_default();
                composition.execution_backend.adapter_id = "future-execution".to_string();
                composition
            }, "composition_adapter_unavailable:execution_backend:future-execution"),
            ({
                let mut composition = crate::store::PublishComposition::local_default();
                composition.execution_backend.settings_version = 999;
                composition
            }, "composition_settings_version_unsupported:execution_backend:local-execution:999"),
        ] {
            let profile = ConfigProfile {
                name: expected_reason.to_string(),
                provider_id: "dotnet".to_string(),
                composition: Some(composition.clone()),
                parameters: BTreeMap::new(),
                profile_group: None,
                created_at: Utc::now(),
                is_system_default: false,
                ..ConfigProfile::default()
            };
            let export = ConfigExport {
                version: CONFIG_VERSION,
                exported_at: Utc::now(),
                profiles: vec![profile],
            };
            validate_import(&export).expect("forward-compatible composition should import");

            let mut store = RepoPublishConfig::default();
            let imported = store
                .import_profile(crate::store::ConfigurationImport {
                    name: expected_reason.to_string(),
                    provider_id: "dotnet".to_string(),
                    contract_version: crate::store::PUBLISH_CONFIGURATION_CONTRACT_VERSION,
                    provider_version: "1".to_string(),
                    settings_version: crate::store::CURRENT_SETTINGS_VERSION,
                    parameters: serde_json::json!({}),
                    composition,
                    project_binding: None,
                    profile_group: None,
                    created_at: "2026-09-11T00:00:00Z".to_string(),
                    is_system_default: false,
                })
                .expect("import profile")
                .expect("profile should be created");
            assert_eq!(imported.blocked_reason.as_deref(), Some(expected_reason));
        }
    }

'''
assert marker in text, 'config test insertion marker not found'
text = text.replace(marker, insert + marker, 1)
path.write_text(text)
