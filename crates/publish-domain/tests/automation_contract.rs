use std::collections::{BTreeMap, BTreeSet};

use publish_domain::{
    AdapterIdentity, AdapterKind, AutomationBundleFile, AutomationFileChangeKind,
    AutomationProjectionBundle, PublishError, AUTOMATION_PROJECTION_BUNDLE_VERSION,
};

fn fake_backend_identity() -> AdapterIdentity {
    AdapterIdentity::new(AdapterKind::ExecutionBackend, "fake-automation", 1)
}

fn bundle_file(content: &str, binding_id: Option<&str>) -> AutomationBundleFile {
    AutomationBundleFile {
        content: content.to_string(),
        binding_id: binding_id.map(str::to_string),
    }
}

fn sealed_fixture_bundle() -> AutomationProjectionBundle {
    AutomationProjectionBundle::seal(
        fake_backend_identity(),
        BTreeMap::from([
            (
                "one-publish/automation/bundle.json".to_string(),
                bundle_file("{\"bindings\":[\"binding-stable\"]}", None),
            ),
            (
                "one-publish/automation/binding-stable.json".to_string(),
                bundle_file("{\"revision\":\"revision-1\"}", Some("binding-stable")),
            ),
        ]),
    )
    .expect("seal fixture bundle")
}

#[test]
fn sealed_bundle_digest_is_deterministic_and_content_sensitive() {
    let first = sealed_fixture_bundle();
    let second = sealed_fixture_bundle();

    assert_eq!(first.version, AUTOMATION_PROJECTION_BUNDLE_VERSION);
    assert_eq!(first.digest, second.digest);
    assert_eq!(first.digest.len(), 64);

    let mut changed_content_files = first.files.clone();
    changed_content_files.insert(
        "one-publish/automation/binding-stable.json".to_string(),
        bundle_file("{\"revision\":\"revision-2\"}", Some("binding-stable")),
    );
    let changed_content =
        AutomationProjectionBundle::seal(fake_backend_identity(), changed_content_files)
            .expect("seal changed-content bundle");
    assert_ne!(first.digest, changed_content.digest);

    let mut moved_files = BTreeMap::new();
    for (path, file) in first.files.clone() {
        moved_files.insert(format!("moved/{path}"), file);
    }
    let moved = AutomationProjectionBundle::seal(fake_backend_identity(), moved_files)
        .expect("seal moved bundle");
    assert_ne!(first.digest, moved.digest);
}

#[test]
fn bundle_validation_rejects_tampered_files_and_foreign_versions() {
    let mut tampered = sealed_fixture_bundle();
    tampered.files.insert(
        "one-publish/automation/binding-stable.json".to_string(),
        bundle_file("tampered", Some("binding-stable")),
    );
    assert!(matches!(
        tampered.validate(),
        Err(PublishError::Execution(message)) if message.contains("digest")
    ));

    let mut foreign_version = sealed_fixture_bundle();
    foreign_version.version = 99;
    assert!(matches!(
        foreign_version.validate(),
        Err(PublishError::Execution(message)) if message.contains("99")
    ));

    sealed_fixture_bundle()
        .validate()
        .expect("untouched sealed bundles stay valid");
}

#[test]
fn seal_rejects_empty_bundles_and_unportable_paths() {
    assert!(matches!(
        AutomationProjectionBundle::seal(fake_backend_identity(), BTreeMap::new()),
        Err(PublishError::Execution(message)) if message.contains("empty")
    ));

    for unsafe_path in [
        "../escape.json",
        "/absolute.json",
        "nested\\windows.json",
        "dir/../up.json",
    ] {
        let result = AutomationProjectionBundle::seal(
            fake_backend_identity(),
            BTreeMap::from([(unsafe_path.to_string(), bundle_file("{}", None))]),
        );
        assert!(
            matches!(result, Err(PublishError::InvalidArtifact { .. })),
            "path {unsafe_path} must be rejected"
        );
    }
}

#[test]
fn diff_reports_added_updated_and_removed_files_in_path_order() {
    let bundle = sealed_fixture_bundle();

    let actual_files = BTreeMap::from([
        (
            "one-publish/automation/bundle.json".to_string(),
            "{\"bindings\":[\"binding-legacy\"]}".to_string(),
        ),
        (
            "one-publish/automation/binding-legacy.json".to_string(),
            "{\"revision\":\"revision-0\"}".to_string(),
        ),
    ]);
    let previously_owned = BTreeSet::from([
        "one-publish/automation/bundle.json".to_string(),
        "one-publish/automation/binding-legacy.json".to_string(),
    ]);

    let changes = bundle.diff_against(&actual_files, &previously_owned);

    let described = changes
        .iter()
        .map(|change| (change.path.as_str(), change.kind))
        .collect::<Vec<_>>();
    assert_eq!(
        described,
        vec![
            (
                "one-publish/automation/binding-legacy.json",
                AutomationFileChangeKind::Removed
            ),
            (
                "one-publish/automation/binding-stable.json",
                AutomationFileChangeKind::Added
            ),
            (
                "one-publish/automation/bundle.json",
                AutomationFileChangeKind::Updated
            ),
        ]
    );

    let removed = &changes[0];
    assert_eq!(
        removed.current_content.as_deref(),
        Some("{\"revision\":\"revision-0\"}")
    );
    assert_eq!(removed.expected_content, None);

    let added = &changes[1];
    assert_eq!(added.current_content, None);
    assert_eq!(
        added.expected_content.as_deref(),
        Some("{\"revision\":\"revision-1\"}")
    );

    let updated = &changes[2];
    assert_eq!(
        updated.current_content.as_deref(),
        Some("{\"bindings\":[\"binding-legacy\"]}")
    );
    assert_eq!(
        updated.expected_content.as_deref(),
        Some("{\"bindings\":[\"binding-stable\"]}")
    );
}

#[test]
fn matching_repository_files_produce_an_empty_diff() {
    let bundle = sealed_fixture_bundle();
    let actual_files = bundle
        .files
        .iter()
        .map(|(path, file)| (path.clone(), file.content.clone()))
        .collect::<BTreeMap<_, _>>();
    let previously_owned = actual_files.keys().cloned().collect::<BTreeSet<_>>();

    assert!(bundle
        .diff_against(&actual_files, &previously_owned)
        .is_empty());

    let missing_previous_state = bundle.diff_against(&actual_files, &BTreeSet::new());
    assert!(missing_previous_state.is_empty());
}
