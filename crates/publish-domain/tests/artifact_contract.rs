use publish_domain::{
    declares_artifact_role, sha256_hex, ArtifactCandidate, ArtifactManifest, ArtifactManifestEntry,
    DeliveryEnvelope, PublishError,
};

fn manifest_entry(role: &str, file_name: &str, bytes: &[u8]) -> ArtifactManifestEntry {
    ArtifactManifestEntry {
        role: role.to_string(),
        file_name: file_name.to_string(),
        media_type: "application/octet-stream".to_string(),
        platform: "test-os".to_string(),
        architecture: "test-arch".to_string(),
        size: bytes.len() as u64,
        digest: sha256_hex(bytes),
        locator: format!("/tmp/store/{file_name}"),
        retention: "temporary".to_string(),
    }
}

#[test]
fn artifact_file_names_cannot_escape_store_or_delivery_roots() {
    let artifact = ArtifactCandidate::new(
        "desktop-installer",
        "../escaped.bin",
        "application/octet-stream",
        "test-os",
        "test-arch",
        b"artifact".to_vec(),
    );

    assert!(matches!(
        artifact.verify(),
        Err(PublishError::InvalidArtifact { .. })
    ));
}

#[test]
fn manifest_entries_enforce_the_same_portable_file_name_boundary() {
    let result = ArtifactManifest::seal(
        "snapshot-digest",
        vec![ArtifactManifestEntry {
            role: "desktop-installer".to_string(),
            file_name: "../escaped.bin".to_string(),
            media_type: "application/octet-stream".to_string(),
            platform: "test-os".to_string(),
            architecture: "test-arch".to_string(),
            size: 8,
            digest: "0".repeat(64),
            locator: "/tmp/store/escaped.bin".to_string(),
            retention: "temporary".to_string(),
        }],
    );

    assert!(matches!(result, Err(PublishError::InvalidArtifact { .. })));
}

#[test]
fn artifact_paths_can_preserve_safe_output_subdirectories() {
    let artifact = ArtifactCandidate::new(
        "runtime-library",
        "runtimes/linux-x64/native.so",
        "application/octet-stream",
        "linux",
        "x86_64",
        b"artifact".to_vec(),
    );

    artifact
        .verify()
        .expect("safe relative artifact paths stay within adapter roots");
}

#[test]
fn artifact_content_changes_form_a_new_artifact_set_identity() {
    let original = ArtifactManifest::seal(
        "snapshot-digest",
        vec![manifest_entry("desktop-installer", "app.bin", b"artifact")],
    )
    .expect("seal original manifest");
    let changed_bytes = ArtifactManifest::seal(
        "snapshot-digest",
        vec![manifest_entry("desktop-installer", "app.bin", b"tampered")],
    )
    .expect("seal changed-content manifest");

    assert_ne!(original.digest, changed_bytes.digest);
}

#[test]
fn manifest_entry_changes_form_a_new_artifact_set_identity() {
    let original = ArtifactManifest::seal(
        "snapshot-digest",
        vec![manifest_entry("desktop-installer", "app.bin", b"artifact")],
    )
    .expect("seal original manifest");
    let changed_role = ArtifactManifest::seal(
        "snapshot-digest",
        vec![manifest_entry("updater-archive", "app.bin", b"artifact")],
    )
    .expect("seal changed-role manifest");

    assert_ne!(original.digest, changed_role.digest);
}

#[test]
fn sealed_manifests_detect_post_seal_mutation() {
    let mut manifest = ArtifactManifest::seal(
        "snapshot-digest",
        vec![manifest_entry("desktop-installer", "app.bin", b"artifact")],
    )
    .expect("seal manifest");
    manifest.artifacts[0].role = "updater-archive".to_string();

    assert!(matches!(
        manifest.validate(),
        Err(PublishError::Execution(message)) if message.contains("digest mismatch")
    ));
}

#[test]
fn manifests_reject_conflicting_entries_for_one_file_name() {
    let result = ArtifactManifest::seal(
        "snapshot-digest",
        vec![
            manifest_entry("desktop-installer", "app.bin", b"artifact"),
            manifest_entry("updater-archive", "app.bin", b"different bytes"),
        ],
    );

    assert!(matches!(
        result,
        Err(PublishError::InvalidArtifact { artifact, .. }) if artifact == "app.bin"
    ));
}

#[test]
fn role_declarations_match_exact_entries_and_namespace_wildcards() {
    let exact = vec!["desktop-installer".to_string()];
    assert!(declares_artifact_role(&exact, "desktop-installer"));
    assert!(!declares_artifact_role(&exact, "updater-archive"));

    let wildcard = vec!["provider-output:*".to_string()];
    assert!(declares_artifact_role(&wildcard, "desktop-installer"));
    assert!(declares_artifact_role(&wildcard, "updater-archive"));

    assert!(!declares_artifact_role(&[], "desktop-installer"));
}

#[test]
fn delivery_envelopes_require_route_and_manifest_identity() {
    let envelope = DeliveryEnvelope::new("route-a", "a".repeat(64));
    envelope
        .validate()
        .expect("route-owned envelopes carry route and manifest identity");

    assert!(matches!(
        DeliveryEnvelope::new("", "a".repeat(64)).validate(),
        Err(PublishError::Execution(_))
    ));
    assert!(matches!(
        DeliveryEnvelope::new("route-a", "").validate(),
        Err(PublishError::Execution(_))
    ));
}
