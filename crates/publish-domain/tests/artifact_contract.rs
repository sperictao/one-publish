use publish_domain::{
    declares_artifact_role, looks_like_executable, sha256_hex, ArtifactCandidate, ArtifactManifest,
    ArtifactManifestEntry, DeliveryEnvelope, PublishError, ARTIFACT_MANIFEST_VERSION,
    LEGACY_ARTIFACT_MANIFEST_VERSION,
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
        executable: Some(false),
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
            executable: Some(false),
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

/// v1.0.3 封存的清单没有执行位：记录逐字节往返、digest 不变，已存集合
/// 仍可推广、未完成的尝试仍可续传。
#[test]
fn legacy_manifests_keep_their_sealed_identity() {
    let stored = concat!(
        r#"{"version":1,"planning_snapshot_digest":"snapshot-v1.0.3","artifacts":[{"#,
        r#""role":"provider-output","file_name":"go-demo","media_type":"application/octet-stream","#,
        r#""platform":"macos","architecture":"aarch64","size":10,"#,
        r#""digest":"d8b0f5b2a43a4dbd5d37ba12e1e0f0a5d0f2b4ba7c5c6e3a9b0b2c1d4e5f6a7b","#,
        r#""locator":"/tmp/one-publish/artifacts/d8/go-demo","retention":"604800s"}],"#,
        r#""digest":"0c2fb15eac942a63fd6d0e877fa59a6352d443c604b9943ba093d619124fe2e7"}"#,
    );
    let legacy: ArtifactManifest = serde_json::from_str(stored).expect("read a v1.0.3 manifest");

    legacy.validate().expect("legacy manifests stay valid");
    assert_eq!(legacy.version, LEGACY_ARTIFACT_MANIFEST_VERSION);
    assert_eq!(legacy.artifacts[0].executable, None);
    assert_eq!(
        serde_json::to_string(&legacy).expect("write the manifest back"),
        stored
    );
}

#[test]
fn sealed_manifests_record_the_executable_flag_as_part_of_their_identity() {
    let mut entry = manifest_entry("cli", "app", b"\x7fELF");
    let plain = ArtifactManifest::seal("snapshot-digest", vec![entry.clone()])
        .expect("seal non-executable entry");
    entry.executable = Some(true);
    let executable = ArtifactManifest::seal("snapshot-digest", vec![entry.clone()])
        .expect("seal executable entry");

    assert_eq!(executable.version, ARTIFACT_MANIFEST_VERSION);
    assert_ne!(plain.digest, executable.digest);

    entry.executable = None;
    assert!(matches!(
        ArtifactManifest::seal("snapshot-digest", vec![entry]),
        Err(PublishError::InvalidArtifact { .. })
    ));
}

#[test]
fn manifest_versions_fix_whether_entries_carry_the_executable_flag() {
    let sealed = ArtifactManifest::seal(
        "snapshot-digest",
        vec![manifest_entry("cli", "app", b"artifact")],
    )
    .expect("seal manifest");

    let mut unflagged = sealed.clone();
    unflagged.artifacts[0].executable = None;
    unflagged.digest = unflagged.recomputed_digest().expect("digest");
    assert!(matches!(
        unflagged.validate(),
        Err(PublishError::InvalidArtifact { .. })
    ));

    let mut flagged_legacy = sealed;
    flagged_legacy.version = LEGACY_ARTIFACT_MANIFEST_VERSION;
    flagged_legacy.digest = flagged_legacy.recomputed_digest().expect("digest");
    assert!(matches!(
        flagged_legacy.validate(),
        Err(PublishError::InvalidArtifact { .. })
    ));
}

#[test]
fn delivered_executable_bits_follow_the_sealed_flag_before_content() {
    let script = b"#!/bin/sh\necho hi\n";
    let mut entry = manifest_entry("cli", "notes.sh", script);
    assert!(!entry.delivers_executable(script));
    entry.executable = Some(true);
    assert!(entry.delivers_executable(b"plain text"));
    entry.executable = None;
    assert!(entry.delivers_executable(script));
    assert!(!entry.delivers_executable(b"plain text"));
}

#[test]
fn content_recognizes_unix_executable_images_and_scripts() {
    for executable in [
        &b"#!/bin/sh\n"[..],
        b"\x7fELF\x02\x01\x01",
        b"\xcf\xfa\xed\xfe\x0c\x00\x00\x01",
        b"\xfe\xed\xfa\xce",
        b"\xca\xfe\xba\xbe\x00\x00\x00\x02",
    ] {
        assert!(looks_like_executable(executable), "{executable:?}");
    }
    for other in [
        &b""[..],
        b"#",
        b"MZ\x90\x00",
        b"PK\x03\x04",
        // Java 8 class：与通用 Mach-O 同魔数，其后是 class 版本。
        b"\xca\xfe\xba\xbe\x00\x00\x00\x34",
        b"\xca\xfe\xba\xbe",
        b"plain text",
    ] {
        assert!(!looks_like_executable(other), "{other:?}");
    }
}
