from pathlib import Path


def fn_span(text: str, name: str):
    candidates = [f"pub(crate) fn {name}(", f"fn {name}("]
    idx = next((text.find(candidate) for candidate in candidates if text.find(candidate) >= 0), -1)
    assert idx >= 0, f"function {name} not found"
    start = text.rfind("\n", 0, idx) + 1
    # Include contiguous Rust doc comments immediately above the function.
    doc_start = start
    while doc_start > 0:
        prev_end = doc_start - 1
        prev_start = text.rfind("\n", 0, prev_end) + 1
        line = text[prev_start:prev_end].strip()
        if line.startswith("///"):
            doc_start = prev_start
        else:
            break
    brace = text.find("{", idx)
    assert brace >= 0, f"opening brace for {name} not found"
    depth = 0
    i = brace
    while i < len(text):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                while end < len(text) and text[end] == "\n":
                    end += 1
                return doc_start, end
        i += 1
    raise AssertionError(f"closing brace for {name} not found")


def replace_fn(text: str, name: str, replacement: str) -> str:
    start, end = fn_span(text, name)
    return text[:start] + replacement.rstrip() + "\n\n" + text[end:]


def remove_fn(text: str, name: str) -> str:
    start, end = fn_span(text, name)
    return text[:start] + text[end:]


# Registry availability/schema compatibility belongs to the effective runtime registry,
# not to the context-free configuration/store validation layer.
path = Path("src-tauri/src/publish_runtime.rs")
text = path.read_text()
text = text.replace(
    "    PublishComposition, RevisionAdapterBinding, CURRENT_SETTINGS_VERSION, LOCAL_BACKEND_ID,\n    LOCAL_DESTINATION_ID, TEMPORARY_STORE_ID,\n",
    "    PublishComposition, RevisionAdapterBinding, LOCAL_BACKEND_ID, LOCAL_DESTINATION_ID,\n    TEMPORARY_STORE_ID,\n",
    1,
)
text = remove_fn(text, "composition_adapter_role")
text = remove_fn(text, "composition_adapter_supported")
text = replace_fn(
    text,
    "composition_binding_invalid_reason",
    '''fn composition_binding_invalid_reason(
    role: &str,
    binding: &RevisionAdapterBinding,
) -> Option<String> {
    let adapter_id = binding.adapter_id.trim();
    if adapter_id.is_empty() || adapter_id != binding.adapter_id {
        return Some(format!("composition_adapter_id_invalid:{role}"));
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
    None
}''',
)
text = replace_fn(
    text,
    "composition_invalid_reason",
    '''/// Stable composition-shape validation. These failures do not depend on which
/// Adapters are registered, so imports/store/source may reject or block them without
/// guessing runtime capabilities.
pub(crate) fn composition_invalid_reason(composition: &PublishComposition) -> Option<String> {
    if let Some(reason) =
        composition_binding_invalid_reason("execution_backend", &composition.execution_backend)
    {
        return Some(reason);
    }
    if let Some(reason) =
        composition_binding_invalid_reason("artifact_store", &composition.artifact_store)
    {
        return Some(reason);
    }
    for processor in &composition.artifact_processors {
        if let Some(reason) = composition_binding_invalid_reason("artifact_processor", processor) {
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
        if let Some(reason) =
            composition_binding_invalid_reason("delivery_destination", &route.destination)
        {
            return Some(reason);
        }
    }
    None
}''',
)
text = remove_fn(text, "composition_blocked_reason")
path.write_text(text)

# Source and Store only apply context-free structural validation. Availability,
# kind selection and adapter settings schema are validated by AdapterRegistry/Planner.
for filename in [
    "src-tauri/src/publish_runtime/source.rs",
    "src-tauri/src/store/types.rs",
]:
    path = Path(filename)
    text = path.read_text()
    count = text.count("composition_blocked_reason")
    assert count == 1, f"expected one composition_blocked_reason use in {filename}, got {count}"
    text = text.replace("composition_blocked_reason", "composition_invalid_reason", 1)
    path.write_text(text)

# Import tests: keep malformed shape rejection, but defer adapter registry compatibility.
path = Path("src-tauri/src/config_export.rs")
text = path.read_text()
old = '''        let mut wrong_kind = crate::store::PublishComposition::local_default();
        wrong_kind.execution_backend.adapter_id = crate::store::TEMPORARY_STORE_ID.to_string();
        cases.push((wrong_kind, "composition_adapter_kind_mismatch"));
'''
new = '''        let mut invalid_adapter_id = crate::store::PublishComposition::local_default();
        invalid_adapter_id.execution_backend.adapter_id = " ".to_string();
        cases.push((invalid_adapter_id, "composition_adapter_id_invalid"));
'''
assert old in text, "wrong-kind structural test anchor not found"
text = text.replace(old, new, 1)

replacement = r'''    #[test]
    fn adapter_registry_compatibility_is_deferred_to_runtime() {
        let cases = [
            {
                let mut composition = crate::store::PublishComposition::local_default();
                composition.execution_backend.adapter_id = "future-execution".to_string();
                composition
            },
            {
                let mut composition = crate::store::PublishComposition::local_default();
                composition.execution_backend.settings_version = 999;
                composition
            },
            {
                let mut composition = crate::store::PublishComposition::local_default();
                // Adapter IDs are namespaced by kind in AdapterRegistry. A built-in Store ID
                // can therefore also be a valid custom ExecutionBackend ID in another registry.
                composition.execution_backend.adapter_id =
                    crate::store::TEMPORARY_STORE_ID.to_string();
                composition
            },
        ];

        for (index, composition) in cases.into_iter().enumerate() {
            let name = format!("Deferred registry compatibility {index}");
            let profile = ConfigProfile {
                name: name.clone(),
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
            validate_import(&export)
                .expect("registry-dependent compatibility must be deferred to runtime");

            let mut store = RepoPublishConfig::default();
            let imported = store
                .import_profile(crate::store::ConfigurationImport {
                    name,
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
            assert_eq!(imported.blocked_reason, None);
        }
    }
'''
text = replace_fn(
    text,
    "unknown_and_future_adapter_compatibility_is_preserved_as_blocked",
    replacement,
)
path.write_text(text)
