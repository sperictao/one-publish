use one_publish_lib::store::RepoPublishConfig;

#[test]
fn rebind_preserves_revision_version_metadata() {
    let mut config = RepoPublishConfig::default();
    let created = config
        .create_profile(
            "Legacy".to_string(),
            "dotnet".to_string(),
            serde_json::json!({ "configuration": "Release" }),
            None,
            Some("dotnet:src/Old/Old.csproj".to_string()),
            "2026-09-10T10:00:00Z".to_string(),
        )
        .expect("create profile")
        .clone();

    {
        let profile = config
            .profiles
            .iter_mut()
            .find(|profile| profile.id == created.id)
            .expect("profile");
        let revision = profile
            .revisions
            .iter_mut()
            .find(|revision| revision.id == profile.current_revision_id)
            .expect("current revision");
        revision.contract_version = 77;
        revision.provider_version = "legacy-provider".to_string();
        revision.settings_version = 88;
    }

    config
        .rebind_profile_project(
            &created.id,
            Some("dotnet:src/New/New.csproj".to_string()),
            "2026-09-10T11:00:00Z".to_string(),
        )
        .expect("rebind profile");

    let profile = config.profile(&created.id).expect("profile");
    assert_eq!(profile.revisions.len(), 2);
    let rebound = profile.current_revision().expect("rebound revision");
    assert_eq!(rebound.sequence, 2);
    assert_eq!(rebound.contract_version, 77);
    assert_eq!(rebound.provider_version, "legacy-provider");
    assert_eq!(rebound.settings_version, 88);
    assert_eq!(rebound.provider_id, "dotnet");
    assert_eq!(
        rebound.parameters,
        serde_json::json!({ "configuration": "Release" })
    );
    assert_eq!(
        rebound.project_binding.as_deref(),
        Some("dotnet:src/New/New.csproj")
    );
    assert_eq!(
        profile.blocked_reason.as_deref(),
        Some("configuration_contract_version_unsupported:77")
    );
}
