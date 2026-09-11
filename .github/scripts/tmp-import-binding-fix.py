from pathlib import Path

# 1) Import validation: current-compatible revisions must use bindings owned by provider.
path = Path('src-tauri/src/config_export.rs')
text = path.read_text()
old = '''        let current_provider_version = &provider.manifest().version;
        if profile.contract_version != crate::store::PUBLISH_CONFIGURATION_CONTRACT_VERSION
            || &profile.provider_version != current_provider_version
            || profile.settings_version != crate::store::CURRENT_SETTINGS_VERSION
        {
            continue;
        }

        // Validate parameters against schema
'''
new = '''        let current_provider_version = &provider.manifest().version;
        if profile.contract_version != crate::store::PUBLISH_CONFIGURATION_CONTRACT_VERSION
            || &profile.provider_version != current_provider_version
            || profile.settings_version != crate::store::CURRENT_SETTINGS_VERSION
        {
            continue;
        }

        if let Some(project_binding) = profile.project_binding.as_deref() {
            if crate::publish_runtime::project_binding_selector(&profile.provider_id, project_binding)
                .is_none()
            {
                return Err(ImportError::ValidationFailed(format!(
                    "profile '{}' project binding '{}' does not belong to provider '{}'",
                    profile.name, project_binding, profile.provider_id
                )));
            }
        }

        // Validate parameters against schema
'''
assert old in text, 'config_export compatibility anchor not found'
text = text.replace(old, new, 1)

# Preserve future-version import semantics while proving the binding check is version-gated.
old = '''            provider_id: "dotnet".to_string(),
            provider_version: "999".to_string(),
            parameters: BTreeMap::from([(
'''
new = '''            provider_id: "dotnet".to_string(),
            provider_version: "999".to_string(),
            project_binding: Some("cargo:App.csproj".to_string()),
            parameters: BTreeMap::from([(
'''
assert old in text, 'future-version test anchor not found'
text = text.replace(old, new, 1)

anchor = '''    #[test]
    fn validate_rejects_invalid_parameter_type() {
'''
insert = '''    #[test]
    fn validate_rejects_current_project_binding_not_owned_by_provider() {
        for project_binding in ["cargo:App.csproj", "dotnet:"] {
            let profile = ConfigProfile {
                name: "Binding mismatch".to_string(),
                provider_id: "dotnet".to_string(),
                project_binding: Some(project_binding.to_string()),
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

            let error = validate_import(&config)
                .expect_err("current project binding must belong to its provider");
            assert!(error.to_string().contains("does not belong to provider"));
        }
    }

'''
assert anchor in text, 'config_export test insertion anchor not found'
text = text.replace(anchor, insert + anchor, 1)
path.write_text(text)

# 2) Store fallback: legacy/migrated/internal records surface the same blocked reason.
path = Path('src-tauri/src/store/types.rs')
text = path.read_text()
old = '''        let provider = match registry.get(&revision.provider_id) {
            Ok(provider) => provider,
            Err(_) => return Some(format!("provider_unavailable:{}", revision.provider_id)),
        };

        if revision.provider_version != provider.manifest().version {
'''
new = '''        let provider = match registry.get(&revision.provider_id) {
            Ok(provider) => provider,
            Err(_) => return Some(format!("provider_unavailable:{}", revision.provider_id)),
        };

        if let Some(project_binding) = revision.project_binding.as_deref() {
            if crate::publish_runtime::project_binding_selector(&revision.provider_id, project_binding)
                .is_none()
            {
                return Some(format!(
                    "project_binding_provider_mismatch:{project_binding}"
                ));
            }
        }

        if revision.provider_version != provider.manifest().version {
'''
assert old in text, 'store blocked reason anchor not found'
text = text.replace(old, new, 1)
path.write_text(text)

# 3) Regression: direct/internal imported records are marked blocked even without command validation.
path = Path('src-tauri/src/store/tests.rs')
text = path.read_text()
append = '''

#[test]
fn imported_profile_with_foreign_project_binding_is_marked_blocked() {
    let mut config = RepoPublishConfig::default();
    let profile = config
        .import_profile(ConfigurationImport {
            name: "foreign-binding".to_string(),
            provider_id: "dotnet".to_string(),
            contract_version: crate::store::PUBLISH_CONFIGURATION_CONTRACT_VERSION,
            provider_version: "1".to_string(),
            settings_version: crate::store::CURRENT_SETTINGS_VERSION,
            parameters: serde_json::json!({}),
            composition: crate::store::PublishComposition::local_default(),
            project_binding: Some("cargo:App.csproj".to_string()),
            profile_group: None,
            created_at: "2026-09-11T00:00:00Z".to_string(),
            is_system_default: false,
        })
        .expect("import profile")
        .expect("profile should be added");

    assert_eq!(
        profile.blocked_reason.as_deref(),
        Some("project_binding_provider_mismatch:cargo:App.csproj")
    );
}
'''
assert 'fn imported_profile_with_foreign_project_binding_is_marked_blocked()' not in text
path.write_text(text.rstrip() + append.rstrip() + '\n')
