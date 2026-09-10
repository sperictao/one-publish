use one_publish_lib::store::RepoPublishConfig;

#[test]
fn update_profile_backfills_project_binding_even_when_other_content_is_unchanged() {
    let mut config = RepoPublishConfig::default();
    let created = config
        .create_profile(
            "Legacy".to_string(),
            "dotnet".to_string(),
            serde_json::json!({ "configuration": "Release" }),
            None,
            None,
            "2026-09-10T10:00:00Z".to_string(),
        )
        .expect("create legacy unbound profile")
        .clone();
    let original_revision_id = created.current_revision_id.clone();

    config
        .update_profile(
            &created.id,
            "Legacy".to_string(),
            "dotnet".to_string(),
            serde_json::json!({ "configuration": "Release" }),
            None,
            None,
            Some("dotnet:src/App/App.csproj".to_string()),
            "2026-09-10T11:00:00Z".to_string(),
        )
        .expect("backfill project binding");

    let updated = config.profile(&created.id).expect("updated profile");
    assert_eq!(
        updated.revisions.len(),
        2,
        "binding backfill is revision content"
    );
    assert_ne!(updated.current_revision_id, original_revision_id);
    let current = updated.current_revision().expect("current revision");
    assert_eq!(current.sequence, 2);
    assert_eq!(
        current.project_binding.as_deref(),
        Some("dotnet:src/App/App.csproj")
    );
    assert_eq!(
        current.parameters,
        serde_json::json!({ "configuration": "Release" })
    );
}

#[test]
fn update_profile_same_provider_preserves_existing_binding() {
    let mut config = RepoPublishConfig::default();
    let profile_id = create_bound_dotnet_profile(&mut config);

    config
        .update_profile(
            &profile_id,
            "Bound".to_string(),
            "dotnet".to_string(),
            serde_json::json!({ "configuration": "Release" }),
            None,
            None,
            Some("dotnet:src/Other/Other.csproj".to_string()),
            "2026-09-10T12:00:00Z".to_string(),
        )
        .expect("save same provider profile");

    let profile = config.profile(&profile_id).expect("profile");
    assert_eq!(profile.revisions.len(), 2, "ordinary save must not rebind");
    assert_eq!(
        profile
            .current_revision()
            .expect("current revision")
            .project_binding
            .as_deref(),
        Some("dotnet:src/App/App.csproj")
    );
}

#[test]
fn update_profile_provider_switch_uses_new_provider_binding() {
    let mut config = RepoPublishConfig::default();
    let profile_id = create_bound_dotnet_profile(&mut config);

    config
        .update_profile(
            &profile_id,
            "Bound".to_string(),
            "cargo".to_string(),
            serde_json::json!({ "release": true }),
            None,
            None,
            Some("cargo:Cargo.toml".to_string()),
            "2026-09-10T12:00:00Z".to_string(),
        )
        .expect("switch provider with new binding");

    let profile = config.profile(&profile_id).expect("profile");
    assert_eq!(
        profile.revisions.len(),
        3,
        "provider switch creates a revision"
    );
    let current = profile.current_revision().expect("current revision");
    assert_eq!(current.sequence, 3);
    assert_eq!(current.provider_id, "cargo");
    assert_eq!(current.project_binding.as_deref(), Some("cargo:Cargo.toml"));
}

#[test]
fn update_profile_provider_switch_without_binding_does_not_inherit_old_binding() {
    let mut config = RepoPublishConfig::default();
    let profile_id = create_bound_dotnet_profile(&mut config);

    config
        .update_profile(
            &profile_id,
            "Bound".to_string(),
            "cargo".to_string(),
            serde_json::json!({ "release": true }),
            None,
            None,
            None,
            "2026-09-10T12:00:00Z".to_string(),
        )
        .expect("switch provider without resolved binding");

    let profile = config.profile(&profile_id).expect("profile");
    assert_eq!(
        profile.revisions.len(),
        3,
        "provider switch creates a revision"
    );
    let current = profile.current_revision().expect("current revision");
    assert_eq!(current.provider_id, "cargo");
    assert_eq!(
        current.project_binding, None,
        "old provider binding must not leak"
    );
}

fn create_bound_dotnet_profile(config: &mut RepoPublishConfig) -> String {
    let created = config
        .create_profile(
            "Bound".to_string(),
            "dotnet".to_string(),
            serde_json::json!({ "configuration": "Release" }),
            None,
            None,
            "2026-09-10T10:00:00Z".to_string(),
        )
        .expect("create profile")
        .clone();

    config
        .update_profile(
            &created.id,
            "Bound".to_string(),
            "dotnet".to_string(),
            serde_json::json!({ "configuration": "Release" }),
            None,
            None,
            Some("dotnet:src/App/App.csproj".to_string()),
            "2026-09-10T11:00:00Z".to_string(),
        )
        .expect("backfill binding");

    created.id
}
