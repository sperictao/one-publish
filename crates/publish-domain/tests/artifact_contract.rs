use publish_domain::{ArtifactCandidate, ArtifactManifest, ArtifactManifestEntry, PublishError};

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
