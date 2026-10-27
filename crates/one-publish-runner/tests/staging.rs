//! staging.rs 的退化路径覆盖：损坏清单、不可移植路径与缺失目录都必须
//! 以结构化错误呈现，而不是静默吞掉或 panic（分片暂存是跨段交付的根）。

use std::fs;

use one_publish_runner::{load_shard_segments, load_staged_artifacts, stage_shard_artifacts};
use publish_domain::{ArtifactCandidate, PublishError};

fn candidate(file_name: &str) -> ArtifactCandidate {
    ArtifactCandidate::new(
        "installer",
        file_name,
        "application/octet-stream",
        "macos",
        "aarch64",
        b"bytes".to_vec(),
    )
}

#[test]
fn load_staged_artifacts_returns_empty_for_a_missing_root() {
    let root = tempfile::tempdir().expect("temp root");
    let artifacts = load_staged_artifacts(&root.path().join("absent"))
        .expect("a missing staging root is simply empty");
    assert!(artifacts.is_empty());
}

#[test]
fn staging_round_trips_candidates_in_segment_order() {
    let root = tempfile::tempdir().expect("temp root");
    stage_shard_artifacts(root.path(), "macos", &[candidate("app.dmg")])
        .expect("stage macos segment");
    stage_shard_artifacts(root.path(), "windows", &[candidate("app.msi")])
        .expect("stage windows segment");

    let artifacts = load_staged_artifacts(root.path()).expect("reload staged artifacts");
    let names: Vec<&str> = artifacts.iter().map(|a| a.file_name.as_str()).collect();
    assert_eq!(names, ["app.dmg", "app.msi"]);
}

#[test]
fn staging_rejects_non_portable_candidate_file_names() {
    let root = tempfile::tempdir().expect("temp root");
    let error = stage_shard_artifacts(root.path(), "macos", &[candidate("../escape.dmg")])
        .expect_err("an escaping file name cannot be staged");
    assert!(matches!(error, PublishError::Execution(_)));
    assert!(error.to_string().contains("not portable"));
}

#[test]
fn load_staged_artifacts_reports_corrupt_manifests() {
    let root = tempfile::tempdir().expect("temp root");
    let segment = root.path().join("macos");
    fs::create_dir_all(&segment).expect("create segment");
    fs::write(segment.join("candidates.json"), "{not json").expect("write corrupt manifest");

    let error = load_staged_artifacts(root.path())
        .expect_err("a corrupt manifest must surface as an error");
    assert!(matches!(error, PublishError::Io { .. }));
}

#[test]
fn load_staged_artifacts_rejects_records_with_unsafe_paths() {
    let root = tempfile::tempdir().expect("temp root");
    let segment = root.path().join("macos");
    fs::create_dir_all(segment.join("files")).expect("create files dir");
    fs::write(
        segment.join("candidates.json"),
        r#"[{"role":"installer","file_name":"app.dmg","media_type":"application/octet-stream","platform":"macos","architecture":"aarch64","path":"../../etc/passwd","executable":false}]"#,
    )
    .expect("write unsafe manifest");

    let error =
        load_staged_artifacts(root.path()).expect_err("a record escaping the segment must fail");
    assert!(matches!(error, PublishError::Execution(_)));
    assert!(error.to_string().contains("not portable"));
}

#[test]
fn load_staged_artifacts_reports_missing_candidate_bytes() {
    let root = tempfile::tempdir().expect("temp root");
    let segment = root.path().join("macos");
    fs::create_dir_all(segment.join("files")).expect("create files dir");
    fs::write(
        segment.join("candidates.json"),
        r#"[{"role":"installer","file_name":"app.dmg","media_type":"application/octet-stream","platform":"macos","architecture":"aarch64","path":"files/0-app.dmg","executable":false}]"#,
    )
    .expect("write manifest pointing at absent bytes");

    let error =
        load_staged_artifacts(root.path()).expect_err("a manifest without its bytes must fail");
    assert!(matches!(error, PublishError::Io { .. }));
}

#[test]
fn load_shard_segments_returns_empty_for_a_missing_root() {
    let root = tempfile::tempdir().expect("temp root");
    let events = load_shard_segments(&root.path().join("absent"))
        .expect("a missing segments root is simply empty");
    assert!(events.is_empty());
}

#[test]
fn load_shard_segments_reports_undecodable_files() {
    let root = tempfile::tempdir().expect("temp root");
    fs::write(root.path().join("shard-0.json"), "{not json").expect("write corrupt segment");

    let error =
        load_shard_segments(root.path()).expect_err("corrupt segments must surface as an error");
    assert!(matches!(error, PublishError::Io { .. }));
}

#[test]
fn segment_directories_without_manifests_are_skipped() {
    let root = tempfile::tempdir().expect("temp root");
    fs::create_dir_all(root.path().join("empty-segment")).expect("empty segment");
    let artifacts = load_staged_artifacts(root.path()).expect("load skips bare segments");
    assert!(artifacts.is_empty());
}

#[test]
fn staging_reports_io_failures_when_staging_roots_are_occupied() {
    let root = tempfile::tempdir().expect("temp root");

    // files/ 被同名文件占用：建目录失败必须以 io 错误呈现。
    let segment = root.path().join("macos");
    fs::create_dir_all(&segment).expect("segment root");
    fs::write(segment.join("files"), b"occupied").expect("occupy files root");
    let error = stage_shard_artifacts(
        root.path(),
        "macos",
        std::slice::from_ref(&candidate("app.dmg")),
    )
    .expect_err("an occupied files root fails staging");
    assert!(
        error.to_string().contains("create staging macos"),
        "unexpected error: {error}"
    );

    // 产物子目录父路径被占用：嵌套候选的父目录创建同样失败关闭。
    let segment = root.path().join("linux");
    fs::create_dir_all(segment.join("files")).expect("files root");
    fs::write(segment.join("files").join("0-dmg"), b"occupied").expect("occupy nested parent");
    let error = stage_shard_artifacts(
        root.path(),
        "linux",
        std::slice::from_ref(&candidate("dmg/app.dmg")),
    )
    .expect_err("an occupied nested parent fails staging");
    assert!(
        error.to_string().contains("create staging parent"),
        "unexpected error: {error}"
    );
}
