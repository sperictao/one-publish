//! Java Gradle Provider 真实构建 E2E 测试（JAVA-01 ~ 10）
//!
//! 使用真实 `gradle build` 命令构建样本项目，验证从构建到交付的完整链路。

#![cfg(feature = "e2e-real-java")]

#[path = "common/mod.rs"]
mod common;

use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use common::*;
use publish_adapters::{
    AdapterRegistry, FakeGitHubReleaseApi, FakeSftpServer, GitHubReleaseDestination,
    RemoteGitHubRelease, SftpDeliveryDestination, StaticCredentialSource,
    CHECKSUM_MANIFEST_ROLE,
};
use publish_domain::{
    AdapterBinding, AdapterIdentity, AdapterKind, AdapterSettings, CredentialKind, DeliveryRoute,
    DeliveryStatus, PublishAttemptStatus, PublishFailureCategory,
};
use publish_runner_core::PublishRuntime;
use serde_json::Value;

const GITHUB_TOKEN_REFERENCE: &str = "java-github-token";
const GITHUB_TOKEN_VALUE: &str = "ghp-java-e2e-token";

/// 辅助：创建 Java Gradle provider。
fn java_provider(args: Vec<String>, output_dir: PathBuf) -> Arc<RealBuildProvider> {
    let project = sample_path("java-gradle-app");
    Arc::new(RealBuildProvider::new(
        "real-java",
        "gradle:build",
        "gradle",
        args,
        project,
        output_dir,
        classify_java,
    ))
}

/// 辅助：创建基于 boot 项目的 Java Gradle provider。
fn java_boot_provider(args: Vec<String>, output_dir: PathBuf) -> Arc<RealBuildProvider> {
    let project = sample_path("java-gradle-boot");
    Arc::new(RealBuildProvider::new(
        "real-java",
        "gradle:build",
        "gradle",
        args,
        project,
        output_dir,
        classify_java,
    ))
}

/// 辅助：构建 GitHub Release 路线绑定（Required）。
fn github_route(route_id: &str, tag_prefix: &str) -> DeliveryRoute {
    DeliveryRoute::required(github_route_binding(route_id, tag_prefix))
}

/// 辅助：构建 GitHub Release 适配器绑定。
fn github_route_binding(route_id: &str, tag_prefix: &str) -> AdapterBinding {
    AdapterBinding::new(
        route_id,
        AdapterIdentity::new(AdapterKind::DeliveryDestination, "github-release", 1),
        AdapterSettings::new(1)
            .with_value("repository", Value::String("acme/java-demo".to_string()))
            .with_value("visibility", Value::String("public".to_string()))
            .with_value("tag_prefix", Value::String(tag_prefix.to_string()))
            .with_value(
                "allowed_asset_roles",
                Value::Array(vec![
                    Value::String("build-output".to_string()),
                    Value::String(CHECKSUM_MANIFEST_ROLE.to_string()),
                ]),
            )
            .with_value("updater_enabled", Value::Bool(false))
            .with_value(
                "enabled_platforms",
                Value::Array(vec![Value::String("linux-x86_64".to_string())]),
            )
            .with_value("unsigned_release_override", Value::Bool(false)),
    )
    .with_credential("github_token", GITHUB_TOKEN_REFERENCE)
}

/// 辅助：构建 SFTP 路线绑定。
fn sftp_route(route_id: &str) -> DeliveryRoute {
    DeliveryRoute::required(
        AdapterBinding::new(
            route_id,
            AdapterIdentity::new(AdapterKind::DeliveryDestination, "sftp", 1),
            AdapterSettings::new(1)
                .with_value("host", Value::String("localhost".to_string()))
                .with_value("port", Value::from(2222u64))
                .with_value("username", Value::String("testuser".to_string()))
                .with_value("remote_path", Value::String("/upload".to_string()))
                .with_value(
                    "artifact_roles",
                    Value::Array(vec![
                        Value::String("build-output".to_string()),
                        Value::String(CHECKSUM_MANIFEST_ROLE.to_string()),
                    ]),
                ),
        )
        .with_credential("ssh_private_key", "sftp-key"),
    )
}

/// JAVA-01: 基础 JAR 构建发布到本地目录（含 Checksum）。
#[test]
fn java_01_jar_build_to_local() {
    if !toolchain_available("gradle") {
        eprintln!("skipping: gradle not installed");
        return;
    }

    let project = sample_path("java-gradle-app");
    let output_dir = project.join("build").join("libs");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = java_provider(vec!["build".to_string()], output_dir);
    let snapshot = build_snapshot("real-java", store_dir.path(), delivery_dir.path(), "0.1.0");
    let registry = build_local_registry(provider, store_dir.path(), delivery_dir.path(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt = run_publish(&runtime, &snapshot, "java-gradle-app", "0.1.0", "java-01");

    let manifest = assert_published(&attempt);
    assert_manifest_has_role(manifest, "build-output");
    assert_manifest_has_role(manifest, "checksum-manifest");

    // 验证 SHA256SUMS 在交付目录中
    let receipt = &attempt.receipts[0];
    let checksums_path = PathBuf::from(receipt.external_reference.as_str()).join("SHA256SUMS");
    assert!(
        checksums_path.exists(),
        "SHA256SUMS should exist in delivery directory"
    );
    let checksums_content = fs::read_to_string(&checksums_path).expect("read SHA256SUMS");
    assert!(
        !checksums_content.is_empty(),
        "SHA256SUMS should not be empty"
    );
}

/// JAVA-02: bootJar + Checksum 发布到 SFTP（需要 Docker）。
#[cfg(feature = "e2e-real-sftp")]
#[test]
fn java_02_bootjar_to_sftp() {
    if !toolchain_available("gradle") {
        eprintln!("skipping: gradle not installed");
        return;
    }
    if !docker_available() {
        eprintln!("skipping: docker not available");
        return;
    }

    let project = sample_path("java-gradle-boot");
    let output_dir = project.join("build").join("libs");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = java_boot_provider(vec!["bootJar".to_string()], output_dir);
    let sftp = Arc::new(FakeSftpServer::new());

    let mut snapshot = build_snapshot("real-java", store_dir.path(), delivery_dir.path(), "0.1.0");
    // 替换交付路线为 SFTP
    snapshot.adapters.delivery_routes = vec![sftp_route("sftp-route")];

    let fixture = publish_adapters::AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(provider, &fixture)
        .expect("register provider");
    registry
        .register_artifact_processor(Arc::new(publish_adapters::ChecksumProcessor::new()), &fixture)
        .expect("register checksum");
    registry
        .register_execution_backend(
            Arc::new(publish_adapters::LocalExecutionBackend::with_credential_source(Arc::new(
                StaticCredentialSource::new().with_secret(
                    "sftp-key",
                    CredentialKind::SshPrivateKey,
                    "test-key-value",
                ),
            ))),
            &fixture,
        )
        .expect("register backend");
    registry
        .register_artifact_store(
            Arc::new(publish_adapters::TemporaryArtifactStore::new(store_dir.path())),
            &fixture,
        )
        .expect("register store");
    registry
        .register_delivery_destination(
            Arc::new(SftpDeliveryDestination::new(sftp.clone())),
            &fixture,
        )
        .expect("register sftp");
    let runtime = PublishRuntime::new(registry);

    let attempt = run_publish(&runtime, &snapshot, "java-gradle-boot", "0.1.0", "java-02");

    let manifest = assert_published(&attempt);
    assert_manifest_has_role(manifest, "build-output");

    // 验证 SFTP 远端有文件
    let remote_files = sftp.paths();
    assert!(
        !remote_files.is_empty(),
        "SFTP remote should have files, got: {remote_files:?}"
    );
}

/// JAVA-03: 带系统属性多路线交付（Local Required + GitHub Release Optional）。
#[cfg(feature = "e2e-real-github")]
#[test]
fn java_03_properties_multi_route() {
    if !toolchain_available("gradle") {
        eprintln!("skipping: gradle not installed");
        return;
    }

    let project = sample_path("java-gradle-app");
    let output_dir = project.join("build").join("libs");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = java_provider(
        vec![
            "build".to_string(),
            "-Dcustom=value".to_string(),
        ],
        output_dir,
    );
    let github = Arc::new(FakeGitHubReleaseApi::new());

    let mut snapshot = build_snapshot("real-java", store_dir.path(), delivery_dir.path(), "0.1.0");
    // 添加 GitHub Release 作为 Optional 路线
    snapshot.adapters.delivery_routes.push(DeliveryRoute::optional(
        github_route_binding("github-route", "v"),
    ));

    let fixture = publish_adapters::AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = build_local_registry(provider, store_dir.path(), delivery_dir.path(), &snapshot);
    registry
        .register_delivery_destination(
            Arc::new(GitHubReleaseDestination::new(github.clone())),
            &fixture,
        )
        .expect("register github");
    let runtime = PublishRuntime::new(registry);

    let attempt = run_publish(&runtime, &snapshot, "java-gradle-app", "0.1.0", "java-03");

    // Local 路线必须 Published
    let local_receipt = attempt
        .receipts
        .iter()
        .find(|r| r.route_id == "local-route")
        .expect("local route receipt");
    assert_eq!(local_receipt.status, DeliveryStatus::Published);

    // 构建只执行一次：Manifest 只封存一次
    let manifest = attempt.manifest.as_ref().expect("manifest");
    assert_manifest_has_role(manifest, "build-output");
}

/// JAVA-04: 离线模式构建发布到本地目录（含 Checksum）。
#[test]
fn java_04_offline_build_to_local() {
    if !toolchain_available("gradle") {
        eprintln!("skipping: gradle not installed");
        return;
    }

    let project = sample_path("java-gradle-app");
    let output_dir = project.join("build").join("libs");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = java_provider(
        vec!["build".to_string(), "--offline".to_string()],
        output_dir,
    );
    let snapshot = build_snapshot("real-java", store_dir.path(), delivery_dir.path(), "0.1.0");
    let registry = build_local_registry(provider, store_dir.path(), delivery_dir.path(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt = run_publish(&runtime, &snapshot, "java-gradle-app", "0.1.0", "java-04");

    let manifest = assert_published(&attempt);
    assert_manifest_has_role(manifest, "build-output");
    assert_manifest_has_role(manifest, "checksum-manifest");
}

/// JAVA-05: 自定义任务构建 + Checksum 发布到本地目录。
#[test]
fn java_05_custom_task_to_local() {
    if !toolchain_available("gradle") {
        eprintln!("skipping: gradle not installed");
        return;
    }

    let project = sample_path("java-gradle-app");
    let output_dir = project.join("build").join("libs");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = java_provider(vec!["build".to_string()], output_dir);
    let snapshot = build_snapshot("real-java", store_dir.path(), delivery_dir.path(), "0.1.0");
    let registry = build_local_registry(provider, store_dir.path(), delivery_dir.path(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt = run_publish(&runtime, &snapshot, "java-gradle-app", "0.1.0", "java-05");

    let manifest = assert_published(&attempt);
    assert_manifest_has_role(manifest, "build-output");
    assert_manifest_has_role(manifest, "checksum-manifest");
}

/// JAVA-06: 强制重新执行任务（--rerun-tasks）构建发布到本地目录。
#[test]
fn java_06_rerun_tasks_to_local() {
    if !toolchain_available("gradle") {
        eprintln!("skipping: gradle not installed");
        return;
    }

    let project = sample_path("java-gradle-app");
    let output_dir = project.join("build").join("libs");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = java_provider(
        vec!["build".to_string(), "--rerun-tasks".to_string()],
        output_dir,
    );
    let snapshot = build_snapshot("real-java", store_dir.path(), delivery_dir.path(), "0.1.0");
    let registry = build_local_registry(provider, store_dir.path(), delivery_dir.path(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt = run_publish(&runtime, &snapshot, "java-gradle-app", "0.1.0", "java-06");

    let manifest = assert_published(&attempt);
    assert_manifest_has_role(manifest, "build-output");
    assert_manifest_has_role(manifest, "checksum-manifest");
}

/// JAVA-07: 产物推广 Local -> GitHub Release（不重新构建）。
#[cfg(feature = "e2e-real-github")]
#[test]
fn java_07_artifact_promotion() {
    if !toolchain_available("gradle") {
        eprintln!("skipping: gradle not installed");
        return;
    }

    let project = sample_path("java-gradle-app");
    let output_dir = project.join("build").join("libs");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    // 第一次发布：构建到 Local
    let provider = java_provider(vec!["build".to_string()], output_dir);
    let snapshot = build_snapshot("real-java", store_dir.path(), delivery_dir.path(), "0.1.0");
    let registry = build_local_registry(provider, store_dir.path(), delivery_dir.path(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt1 = run_publish(&runtime, &snapshot, "java-gradle-app", "0.1.0", "java-07-1");
    let manifest1 = assert_published(&attempt1);
    let original_digest = manifest1.digest.clone();

    // 第二次发布：推广到 GitHub Release（不重新构建）
    let github = Arc::new(FakeGitHubReleaseApi::new());
    let mut snapshot2 = build_snapshot("real-java", store_dir.path(), delivery_dir.path(), "0.1.0");
    snapshot2.promoted_manifest_digest = Some(original_digest.clone());
    snapshot2.adapters.delivery_routes = vec![github_route("github-route", "v")];

    let fixture = publish_adapters::AdapterConformanceFixture::new(snapshot2.clone());
    let mut registry2 = AdapterRegistry::new();
    registry2
        .register_artifact_processor(Arc::new(publish_adapters::ChecksumProcessor::new()), &fixture)
        .expect("register checksum");
    registry2
        .register_execution_backend(
            Arc::new(publish_adapters::LocalExecutionBackend::with_credential_source(Arc::new(
                StaticCredentialSource::new().with_secret(
                    GITHUB_TOKEN_REFERENCE,
                    CredentialKind::Token,
                    GITHUB_TOKEN_VALUE,
                ),
            ))),
            &fixture,
        )
        .expect("register backend");
    registry2
        .register_artifact_store(
            Arc::new(publish_adapters::TemporaryArtifactStore::new(store_dir.path())),
            &fixture,
        )
        .expect("register store");
    registry2
        .register_delivery_destination(
            Arc::new(GitHubReleaseDestination::new(github.clone())),
            &fixture,
        )
        .expect("register github");
    let runtime2 = PublishRuntime::new(registry2);

    let attempt2 = run_publish(&runtime2, &snapshot2, "java-gradle-app", "0.1.0", "java-07-2");
    let manifest2 = attempt2.manifest.as_ref().expect("manifest");
    // 推广：digest 应与原 Manifest 一致
    assert_eq!(
        manifest2.digest, original_digest,
        "promoted manifest digest should match original"
    );

    // GitHub Release 应有创建的 release
    let release = github.release("v0.1.0").expect("github release should exist");
    assert!(!release.draft, "release should be published (not draft)");
}

/// JAVA-08: 部分交付恢复--GitHub Release 冲突阻断。
#[cfg(feature = "e2e-real-github")]
#[test]
fn java_08_partial_delivery_github_conflict() {
    if !toolchain_available("gradle") {
        eprintln!("skipping: gradle not installed");
        return;
    }

    let project = sample_path("java-gradle-app");
    let output_dir = project.join("build").join("libs");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = java_provider(vec!["build".to_string()], output_dir);
    let github = Arc::new(FakeGitHubReleaseApi::new());

    // 预置一个冲突的远端 Release：不带我们的 Manifest 标记
    github.seed_release(RemoteGitHubRelease {
        id: 100,
        tag: "v0.1.0".to_string(),
        url: "https://github.com/acme/java-demo/releases/tag/v0.1.0".to_string(),
        body: "a foreign release without our manifest marker".to_string(),
        draft: false,
        prerelease: false,
        assets: vec![],
    });

    let mut snapshot = build_snapshot("real-java", store_dir.path(), delivery_dir.path(), "0.1.0");
    // Local (Required) + GitHub Release (Required)
    snapshot.adapters.delivery_routes.push(github_route("github-route", "v"));

    let fixture = publish_adapters::AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = build_local_registry(provider, store_dir.path(), delivery_dir.path(), &snapshot);
    registry
        .register_delivery_destination(
            Arc::new(GitHubReleaseDestination::new(github.clone())),
            &fixture,
        )
        .expect("register github");
    let runtime = PublishRuntime::new(registry);

    let attempt = run_publish(&runtime, &snapshot, "java-gradle-app", "0.1.0", "java-08");

    // 应该是 PartialDelivery（Local 成功，GitHub Release 冲突失败）
    assert_eq!(
        attempt.status,
        PublishAttemptStatus::PartialDelivery,
        "expected PartialDelivery, got {:?}",
        attempt.status
    );

    // Local 路线应该 Published
    let local_receipt = attempt
        .receipts
        .iter()
        .find(|r| r.route_id == "local-route")
        .expect("local route receipt");
    assert_eq!(local_receipt.status, DeliveryStatus::Published);

    // GitHub Release 路线应该 Failed（冲突）
    let github_route_view = attempt
        .routes
        .iter()
        .find(|r| r.route_id == "github-route")
        .expect("github route view");
    assert_eq!(
        github_route_view.status,
        DeliveryStatus::Failed,
        "github route should be Failed"
    );
    let failure = github_route_view.failure.as_ref().expect("classified failure");
    assert_eq!(
        failure.category,
        PublishFailureCategory::Conflict,
        "github route failure should be classified as Conflict"
    );

    // 冲突时远端 Release 保持原样（不覆盖）
    let release = github.release("v0.1.0").expect("remote release");
    assert_eq!(
        release.body,
        "a foreign release without our manifest marker",
        "conflicting release body should be unchanged"
    );
    assert!(release.assets.is_empty(), "no assets should be uploaded");
}

/// JAVA-09: 排除测试任务构建（-x test）发布到本地目录。
#[test]
fn java_09_exclude_test_to_local() {
    if !toolchain_available("gradle") {
        eprintln!("skipping: gradle not installed");
        return;
    }

    let project = sample_path("java-gradle-app");
    let output_dir = project.join("build").join("libs");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = java_provider(
        vec!["build".to_string(), "-x".to_string(), "test".to_string()],
        output_dir,
    );
    let snapshot = build_snapshot("real-java", store_dir.path(), delivery_dir.path(), "0.1.0");
    let registry = build_local_registry(provider, store_dir.path(), delivery_dir.path(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt = run_publish(&runtime, &snapshot, "java-gradle-app", "0.1.0", "java-09");

    let manifest = assert_published(&attempt);
    assert_manifest_has_role(manifest, "build-output");
    assert_manifest_has_role(manifest, "checksum-manifest");
}

/// JAVA-10: 多 JAR 产物构建发布到本地目录（验证 JAR 被收集）。
#[test]
fn java_10_multiple_jar_products() {
    if !toolchain_available("gradle") {
        eprintln!("skipping: gradle not installed");
        return;
    }

    let project = sample_path("java-gradle-app");
    let output_dir = project.join("build").join("libs");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = java_provider(vec!["build".to_string()], output_dir);
    let snapshot = build_snapshot("real-java", store_dir.path(), delivery_dir.path(), "0.1.0");
    let registry = build_local_registry(provider, store_dir.path(), delivery_dir.path(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt = run_publish(&runtime, &snapshot, "java-gradle-app", "0.1.0", "java-10");

    let manifest = assert_published(&attempt);
    assert_manifest_has_role(manifest, "build-output");
    assert_manifest_has_role(manifest, "checksum-manifest");

    // 验证至少有一个 JAR 产物被收集
    let has_jar = manifest
        .artifacts
        .iter()
        .any(|a| a.file_name.ends_with(".jar"));
    assert!(
        has_jar,
        "manifest should contain at least one JAR artifact, found: {:?}",
        manifest
            .artifacts
            .iter()
            .map(|a| a.file_name.as_str())
            .collect::<Vec<_>>()
    );
}
