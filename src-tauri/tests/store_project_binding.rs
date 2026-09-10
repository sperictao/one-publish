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
    assert_eq!(updated.revisions.len(), 2, "binding backfill is revision content");
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
