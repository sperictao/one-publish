from pathlib import Path

path = Path('src-tauri/src/config_export.rs')
text = path.read_text()

old = '''fn sanitize_backup_parameters(parameters: &mut BTreeMap<String, serde_json::Value>) {
    parameters.retain(|key, _| !crate::security::is_sensitive_key(key));
    for value in parameters.values_mut() {
        remove_sensitive_fields(value);
    }
    crate::security::sanitize_json_map(parameters);
}

fn contains_sensitive_field(value: &serde_json::Value) -> bool {
'''
new = '''fn sanitize_backup_parameters(parameters: &mut BTreeMap<String, serde_json::Value>) {
    parameters.retain(|key, _| !crate::security::is_sensitive_key(key));
    for value in parameters.values_mut() {
        remove_sensitive_fields(value);
    }
    crate::security::sanitize_json_map(parameters);
}

fn sanitize_backup_composition(composition: &mut crate::store::PublishComposition) {
    let sanitize_binding = |binding: &mut crate::store::RevisionAdapterBinding| {
        remove_sensitive_fields(&mut binding.settings);
    };

    sanitize_binding(&mut composition.execution_backend);
    sanitize_binding(&mut composition.artifact_store);
    for processor in &mut composition.artifact_processors {
        sanitize_binding(processor);
    }
    for route in &mut composition.delivery_routes {
        sanitize_binding(&mut route.destination);
    }
}

fn contains_sensitive_field(value: &serde_json::Value) -> bool {
'''
assert old in text, 'sanitize helper anchor not found'
text = text.replace(old, new, 1)

old = '''fn profile_contains_sensitive_field(profile: &ConfigProfile) -> bool {
    profile.parameters.iter().any(|(key, value)| {
        crate::security::is_sensitive_key(key) || contains_sensitive_field(value)
    })
}
'''
new = '''fn composition_contains_sensitive_settings(
    composition: &crate::store::PublishComposition,
) -> bool {
    let binding_contains_sensitive_settings = |binding: &crate::store::RevisionAdapterBinding| {
        contains_sensitive_field(&binding.settings)
    };

    binding_contains_sensitive_settings(&composition.execution_backend)
        || binding_contains_sensitive_settings(&composition.artifact_store)
        || composition
            .artifact_processors
            .iter()
            .any(binding_contains_sensitive_settings)
        || composition
            .delivery_routes
            .iter()
            .any(|route| binding_contains_sensitive_settings(&route.destination))
}

fn profile_contains_sensitive_field(profile: &ConfigProfile) -> bool {
    profile.parameters.iter().any(|(key, value)| {
        crate::security::is_sensitive_key(key) || contains_sensitive_field(value)
    }) || profile
        .composition
        .as_ref()
        .is_some_and(composition_contains_sensitive_settings)
}
'''
assert old in text, 'profile sensitive helper anchor not found'
text = text.replace(old, new, 1)

old = '''            let mut parameters = parameters
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect::<BTreeMap<_, _>>();
            sanitize_backup_parameters(&mut parameters);
            let created_at = DateTime::parse_from_rfc3339(&profile.created_at)
'''
new = '''            let mut parameters = parameters
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect::<BTreeMap<_, _>>();
            sanitize_backup_parameters(&mut parameters);
            let mut composition = revision.composition.clone();
            sanitize_backup_composition(&mut composition);
            let created_at = DateTime::parse_from_rfc3339(&profile.created_at)
'''
assert old in text, 'export composition clone anchor not found'
text = text.replace(old, new, 1)

old = '''                settings_version: revision.settings_version,
                parameters,
                composition: Some(revision.composition.clone()),
                project_binding: revision.project_binding.clone(),
'''
new = '''                settings_version: revision.settings_version,
                parameters,
                composition: Some(composition),
                project_binding: revision.project_binding.clone(),
'''
assert old in text, 'export composition assignment anchor not found'
text = text.replace(old, new, 1)

anchor = '''    #[test]
    fn sanitize_removes_project_path() {
'''
insert = '''    #[test]
    fn backup_sanitizes_adapter_settings_but_preserves_credential_references() {
        let mut repo_config = RepoPublishConfig::default();
        let created = repo_config
            .create_profile(
                "Secure composition".to_string(),
                "dotnet".to_string(),
                serde_json::json!({}),
                None,
                None,
                "2026-09-11T00:00:00Z".to_string(),
            )
            .expect("create profile")
            .clone();

        let mut composition = crate::store::PublishComposition::local_default();
        composition.execution_backend.settings =
            serde_json::json!({ "apiToken": "backend-secret", "keep": "backend" });
        composition.execution_backend.credentials.insert(
            "github_token".to_string(),
            "opaque backend reference".to_string(),
        );
        composition.artifact_store.settings = serde_json::json!({
            "nested": { "password": "store-secret", "keep": "store" }
        });
        composition.artifact_store.credentials.insert(
            "store_password".to_string(),
            "opaque store reference".to_string(),
        );
        composition.artifact_processors[0].settings =
            serde_json::json!({ "privateKey": "processor-secret", "keep": "processor" });
        composition.artifact_processors[0].credentials.insert(
            "signing_key".to_string(),
            "opaque processor reference".to_string(),
        );
        composition.delivery_routes[0].destination.settings =
            serde_json::json!({ "token": "destination-secret", "keep": "destination" });
        composition.delivery_routes[0].destination.credentials.insert(
            "delivery_token".to_string(),
            "opaque destination reference".to_string(),
        );

        repo_config
            .update_profile(
                &created.id,
                "Secure composition".to_string(),
                "dotnet".to_string(),
                serde_json::json!({}),
                None,
                Some(composition),
                None,
                "2026-09-11T00:01:00Z".to_string(),
            )
            .expect("update profile composition");

        let backup = build_config_export(&repo_config, Utc::now()).expect("build backup");
        let json = serde_json::to_string(&backup).expect("serialize backup");

        for secret in [
            "backend-secret",
            "store-secret",
            "processor-secret",
            "destination-secret",
        ] {
            assert!(!json.contains(secret), "backup leaked {secret}: {json}");
        }
        for preserved in [
            "backend",
            "store",
            "processor",
            "destination",
            "opaque backend reference",
            "opaque store reference",
            "opaque processor reference",
            "opaque destination reference",
        ] {
            assert!(json.contains(preserved), "backup dropped {preserved}: {json}");
        }
    }

    #[test]
    fn validate_rejects_sensitive_adapter_settings_but_preserves_credential_references() {
        let mut clean_composition = crate::store::PublishComposition::local_default();
        clean_composition.execution_backend.credentials.insert(
            "github_token".to_string(),
            "opaque secret-store reference".to_string(),
        );
        let clean_profile = ConfigProfile {
            name: "Clean composition".to_string(),
            provider_id: "dotnet".to_string(),
            composition: Some(clean_composition.clone()),
            parameters: BTreeMap::new(),
            profile_group: None,
            created_at: Utc::now(),
            is_system_default: false,
            ..ConfigProfile::default()
        };
        let clean_config = ConfigExport {
            version: CONFIG_VERSION,
            exported_at: Utc::now(),
            profiles: vec![clean_profile],
        };
        assert!(validate_import(&clean_config).is_ok());

        clean_composition.delivery_routes[0].destination.settings = serde_json::json!({
            "nested": [{ "apiToken": "must-not-enter-storage" }]
        });
        let contaminated_profile = ConfigProfile {
            name: "Contaminated composition".to_string(),
            provider_id: "dotnet".to_string(),
            composition: Some(clean_composition),
            parameters: BTreeMap::new(),
            profile_group: None,
            created_at: Utc::now(),
            is_system_default: false,
            ..ConfigProfile::default()
        };
        let contaminated_config = ConfigExport {
            version: CONFIG_VERSION,
            exported_at: Utc::now(),
            profiles: vec![contaminated_profile],
        };

        let error = validate_import(&contaminated_config)
            .expect_err("adapter settings with credential fields must fail import");
        assert!(error.to_string().contains("credential fields"));
    }

'''
assert anchor in text, 'test insertion anchor not found'
text = text.replace(anchor, insert + anchor, 1)

path.write_text(text)
