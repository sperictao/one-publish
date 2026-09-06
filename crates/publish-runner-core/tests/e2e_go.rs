//! Go Provider 真实构建 E2E 测试（GO-01 ~ 10）
//!
//! 使用真实 `go build` 命令构建样本项目，验证从构建到交付的完整链路。

#![cfg(feature = "e2e-real-go")]

#[path = "common/mod.rs"]
mod common;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use common::*;
use publish_adapters::{
    AdapterRegistry, FakeGitHubReleaseApi, FakeSftpServer, GitHubReleaseDestination,
    SftpDeliveryDestination, StaticCredentialSource, CHECKSUM_MANIFEST_ROLE,
};
use publish_domain::{
    AdapterBinding, AdapterIdentity, AdapterKind, AdapterSettings, CredentialKind, DeliveryRoute,
    DeliveryStatus, PublishAttemptStatus,
};
use publish_runner_core::PublishRuntime;
use serde_json::Value;

/// 辅助：创建 Go provider（go-cli 样本）。
fn go_provider(args: Vec<String>, output_dir: PathBuf) -> Arc<RealBuildProvider> {
    let project = sample_path("go-cli");
    Arc::new(RealBuildProvider::new(
        "real-go",
        "go:build",
        "go",
        args,
        project,
        output_dir,
        classify_go,
    ))
}

/// 辅助：创建带环境变量的 Go provider（用于交叉编译）。
fn go_provider_with_env(
    args: Vec<String>,
    output_dir: PathBuf,
    env: &[(&str, &str)],
) -> Arc<RealBuildProvider> {
    let project = sample_path("go-cli");
    let mut provider = RealBuildProvider::new(
        "real-go",
        "go:build",
        "go",
        args,
        project,
        output_dir,
        classify_go,
    );
    for (k, v) in env {
        provider = provider.with_env(k, v);
    }
    Arc::new(provider)
}

/// Go 产物分类（installer 角色）：用于 GitHub Release 路线。
fn classify_go_installer(_relative: &Path) -> (&'static str, &'static str) {
    ("installer", "application/octet-stream")
}

/// 辅助：清理并创建 bin 目录。
fn prepare_bin_dir(project: &Path) -> PathBuf {
    let bin_dir = project.join("bin");
    let _ = fs::remove_dir_all(&bin_dir);
    fs::create_dir_all(&bin_dir).expect("create bin dir");
    bin_dir
}

/// 辅助：构建包含 SFTP 凭据的注册表（Local + SFTP 目标）。
fn build_registry_with_sftp(
    provider: Arc<RealBuildProvider>,
    store_dir: &Path,
    delivery_dir: &Path,
    sftp: Arc<FakeSftpServer>,
    snapshot: &publish_domain::PlanningInputSnapshot,
) -> AdapterRegistry {
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
            Arc::new(publish_adapters::TemporaryArtifactStore::new(store_dir)),
            &fixture,
        )
        .expect("register store");
    registry
        .register_delivery_destination(
            Arc::new(publish_adapters::LocalDirectoryDestination::new(delivery_dir)),
            &fixture,
        )
        .expect("register local");
    registry
        .register_delivery_destination(
            Arc::new(SftpDeliveryDestination::new(sftp)),
            &fixture,
        )
        .expect("register sftp");
    registry
}

/// GO-01: 单平台构建发布到本地目录 + Checksum。
#[test]
fn go_01_single_platform_build_to_local() {
    if !toolchain_available("go") {
        eprintln!("skipping: go not installed");
        return;
    }

    let project = sample_path("go-cli");
    let output_dir = prepare_bin_dir(&project);
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = go_provider(
        vec!["build".to_string(), "-o".to_string(), "./bin/app".to_string()],
        output_dir,
    );
    let snapshot = build_snapshot("real-go", store_dir.path(), delivery_dir.path(), "0.1.0");
    let registry = build_local_registry(provider, store_dir.path(), delivery_dir.path(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt = run_publish(&runtime, &snapshot, "go-cli", "0.1.0", "go-01");

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
    assert!(!checksums_content.is_empty(), "SHA256SUMS should not be empty");
}

/// GO-02: 交叉编译发布到 SFTP（GOOS=linux GOARCH=amd64）。
#[cfg(feature = "e2e-real-sftp")]
#[test]
fn go_02_cross_compile_to_sftp() {
    if !toolchain_available("go") {
        eprintln!("skipping: go not installed");
        return;
    }

    let project = sample_path("go-cli");
    let output_dir = prepare_bin_dir(&project);
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = go_provider_with_env(
        vec![
            "build".to_string(),
            "-o".to_string(),
            "./bin/app-linux".to_string(),
        ],
        output_dir,
        &[("GOOS", "linux"), ("GOARCH", "amd64")],
    );
    let sftp = Arc::new(FakeSftpServer::new());

    let mut snapshot = build_snapshot("real-go", store_dir.path(), delivery_dir.path(), "0.1.0");
    // 替换交付路线为 SFTP
    snapshot.adapters.delivery_routes = vec![DeliveryRoute::required(
        AdapterBinding::new(
            "sftp-route",
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
                        Value::String("checksum-manifest".to_string()),
                    ]),
                ),
        )
        .with_credential("ssh_private_key", "sftp-key"),
    )];

    let registry = build_registry_with_sftp(
        provider,
        store_dir.path(),
        delivery_dir.path(),
        sftp.clone(),
        &snapshot,
    );
    let runtime = PublishRuntime::new(registry);

    let attempt = run_publish(&runtime, &snapshot, "go-cli", "0.1.0", "go-02");

    let manifest = assert_published(&attempt);
    assert_manifest_has_role(manifest, "build-output");

    // 验证 SFTP 远端有文件
    let remote_files = sftp.paths();
    assert!(
        !remote_files.is_empty(),
        "SFTP remote should have files, got: {remote_files:?}"
    );
}

/// GO-03: ldflags 版本注入构建 + Checksum。
#[test]
fn go_03_ldflags_version_injection() {
    if !toolchain_available("go") {
        eprintln!("skipping: go not installed");
        return;
    }

    let project = sample_path("go-cli");
    let output_dir = prepare_bin_dir(&project);
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = go_provider(
        vec![
            "build".to_string(),
            "-o".to_string(),
            "./bin/app".to_string(),
            "-ldflags".to_string(),
            "-X main.version=1.0.0".to_string(),
        ],
        output_dir,
    );
    let snapshot = build_snapshot("real-go", store_dir.path(), delivery_dir.path(), "0.1.0");
    let registry = build_local_registry(provider, store_dir.path(), delivery_dir.path(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt = run_publish(&runtime, &snapshot, "go-cli", "0.1.0", "go-03");

    let manifest = assert_published(&attempt);
    assert_manifest_has_role(manifest, "build-output");
    assert_manifest_has_role(manifest, "checksum-manifest");
}

/// GO-04: 双路线交付 Local + GitHub Release。
#[cfg(feature = "e2e-real-github")]
#[test]
fn go_04_dual_route_local_and_github_release() {
    if !toolchain_available("go") {
        eprintln!("skipping: go not installed");
        return;
    }

    let project = sample_path("go-cli");
    let output_dir = prepare_bin_dir(&project);
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    // GitHub Release 路线要求 installer 角色；使用自定义分类函数。
    let provider = Arc::new(RealBuildProvider::new(
        "real-go",
        "go:build",
        "go",
        vec![
            "build".to_string(),
            "-o".to_string(),
            "./bin/app".to_string(),
        ],
        project,
        output_dir,
        classify_go_installer,
    ));
    let github = Arc::new(FakeGitHubReleaseApi::new());

    let platform_key = format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH);
    let mut snapshot = build_snapshot("real-go", store_dir.path(), delivery_dir.path(), "0.1.0");
    // 添加 GitHub Release 路线（Required）
    snapshot.adapters.delivery_routes.push(DeliveryRoute::required(
        AdapterBinding::new(
            "github-route",
            AdapterIdentity::new(AdapterKind::DeliveryDestination, "github-release", 1),
            AdapterSettings::new(1)
                .with_value("repository", Value::String("acme/go-cli".to_string()))
                .with_value("visibility", Value::String("public".to_string()))
                .with_value("tag_prefix", Value::String("v".to_string()))
                .with_value(
                    "allowed_asset_roles",
                    Value::Array(vec![
                        Value::String("installer".to_string()),
                        Value::String(CHECKSUM_MANIFEST_ROLE.to_string()),
                    ]),
                )
                .with_value("updater_enabled", Value::Bool(false))
                .with_value(
                    "enabled_platforms",
                    Value::Array(vec![Value::String(platform_key)]),
                )
                .with_value("unsigned_release_override", Value::Bool(true)),
        )
        .with_credential("github_token", "github-token-ref"),
    ));

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
                    "github-token-ref",
                    CredentialKind::Token,
                    "ghp_test-token-value",
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
            Arc::new(publish_adapters::LocalDirectoryDestination::new(delivery_dir.path())),
            &fixture,
        )
        .expect("register local");
    registry
        .register_delivery_destination(
            Arc::new(GitHubReleaseDestination::new(github.clone())),
            &fixture,
        )
        .expect("register github");
    let runtime = PublishRuntime::new(registry);

    let attempt = run_publish(&runtime, &snapshot, "go-cli", "0.1.0", "go-04");

    // 两条路线都应 Published
    assert_eq!(
        attempt.status,
        PublishAttemptStatus::Published,
        "attempt should be Published, got {:?}",
        attempt.status
    );
    let manifest = attempt.manifest.as_ref().expect("manifest");
    assert_manifest_has_role(manifest, "installer");
    assert_manifest_has_role(manifest, "checksum-manifest");

    // Local 路线 Published
    let local_receipt = attempt
        .receipts
        .iter()
        .find(|r| r.route_id == "local-route")
        .expect("local route receipt");
    assert_eq!(local_receipt.status, DeliveryStatus::Published);

    // GitHub 路线 Published
    let github_receipt = attempt
        .receipts
        .iter()
        .find(|r| r.route_id == "github-route")
        .expect("github route receipt");
    assert_eq!(github_receipt.status, DeliveryStatus::Published);

    // Fake GitHub 应有 Release 与资产
    let release = github.release("v0.1.0").expect("release should exist");
    assert!(
        !release.assets.is_empty(),
        "release should have assets, got: {:?}",
        release.assets
    );
}

/// GO-05: 多二进制项目构建（go-multi-binary）。
#[test]
fn go_05_multi_binary_project() {
    if !toolchain_available("go") {
        eprintln!("skipping: go not installed");
        return;
    }

    let project = sample_path("go-multi-binary");
    let output_dir = prepare_bin_dir(&project);
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = Arc::new(RealBuildProvider::new(
        "real-go",
        "go:build",
        "go",
        vec![
            "build".to_string(),
            "-o".to_string(),
            "./bin/app1".to_string(),
            "./cmd/app1".to_string(),
        ],
        project,
        output_dir,
        classify_go,
    ));
    let snapshot = build_snapshot("real-go", store_dir.path(), delivery_dir.path(), "0.1.0");
    let registry = build_local_registry(provider, store_dir.path(), delivery_dir.path(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt = run_publish(&runtime, &snapshot, "go-multi-binary", "0.1.0", "go-05");

    let manifest = assert_published(&attempt);
    // 应该有 app1 二进制
    let has_app1 = manifest
        .artifacts
        .iter()
        .any(|a| a.file_name.contains("app1"));
    assert!(
        has_app1,
        "manifest should contain app1 binary, found: {:?}",
        manifest
            .artifacts
            .iter()
            .map(|a| a.file_name.as_str())
            .collect::<Vec<_>>()
    );
}

/// GO-06: trimpath 可复现构建（构建两次比较摘要）。
#[test]
fn go_06_trimpath_reproducible_build() {
    if !toolchain_available("go") {
        eprintln!("skipping: go not installed");
        return;
    }

    let project = sample_path("go-cli");

    // 第一次构建
    let output_dir_1 = prepare_bin_dir(&project);
    let store_dir_1 = tempfile::tempdir().expect("store dir 1");
    let delivery_dir_1 = tempfile::tempdir().expect("delivery dir 1");

    let provider_1 = go_provider(
        vec![
            "build".to_string(),
            "-o".to_string(),
            "./bin/app".to_string(),
            "-trimpath".to_string(),
        ],
        output_dir_1,
    );
    let snapshot_1 = build_snapshot("real-go", store_dir_1.path(), delivery_dir_1.path(), "0.1.0");
    let registry_1 =
        build_local_registry(provider_1, store_dir_1.path(), delivery_dir_1.path(), &snapshot_1);
    let runtime_1 = PublishRuntime::new(registry_1);

    let attempt_1 = run_publish(&runtime_1, &snapshot_1, "go-cli", "0.1.0", "go-06-1");
    let manifest_1 = assert_published(&attempt_1);
    let digest_1 = manifest_1.digest.clone();

    // 第二次构建（相同参数，独立目录）
    let output_dir_2 = prepare_bin_dir(&project);
    let store_dir_2 = tempfile::tempdir().expect("store dir 2");
    let delivery_dir_2 = tempfile::tempdir().expect("delivery dir 2");

    let provider_2 = go_provider(
        vec![
            "build".to_string(),
            "-o".to_string(),
            "./bin/app".to_string(),
            "-trimpath".to_string(),
        ],
        output_dir_2,
    );
    let snapshot_2 = build_snapshot("real-go", store_dir_2.path(), delivery_dir_2.path(), "0.1.0");
    let registry_2 =
        build_local_registry(provider_2, store_dir_2.path(), delivery_dir_2.path(), &snapshot_2);
    let runtime_2 = PublishRuntime::new(registry_2);

    let attempt_2 = run_publish(&runtime_2, &snapshot_2, "go-cli", "0.1.0", "go-06-2");
    let manifest_2 = assert_published(&attempt_2);
    let digest_2 = manifest_2.digest.clone();

    // trimpath 构建应产生相同的 Manifest 摘要
    assert_eq!(
        digest_1, digest_2,
        "trimpath builds should produce identical manifest digests"
    );
}

/// GO-07: 产物推广 Local -> SFTP（不重新构建）。
#[cfg(feature = "e2e-real-sftp")]
#[test]
fn go_07_artifact_promotion() {
    if !toolchain_available("go") {
        eprintln!("skipping: go not installed");
        return;
    }

    let project = sample_path("go-cli");
    let output_dir = prepare_bin_dir(&project);
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    // 第一次发布：构建到 Local
    let provider = go_provider(
        vec!["build".to_string(), "-o".to_string(), "./bin/app".to_string()],
        output_dir,
    );
    let snapshot = build_snapshot("real-go", store_dir.path(), delivery_dir.path(), "0.1.0");
    let registry = build_local_registry(provider, store_dir.path(), delivery_dir.path(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt1 = run_publish(&runtime, &snapshot, "go-cli", "0.1.0", "go-07-1");
    let manifest1 = assert_published(&attempt1);
    let original_digest = manifest1.digest.clone();

    // 第二次发布：推广到 SFTP（不重新构建）
    let sftp = Arc::new(FakeSftpServer::new());
    let mut snapshot2 = build_snapshot("real-go", store_dir.path(), delivery_dir.path(), "0.1.0");
    snapshot2.promoted_manifest_digest = Some(original_digest.clone());
    snapshot2.adapters.delivery_routes = vec![DeliveryRoute::required(
        AdapterBinding::new(
            "sftp-route",
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
                        Value::String("checksum-manifest".to_string()),
                    ]),
                ),
        )
        .with_credential("ssh_private_key", "sftp-key"),
    )];

    let fixture = publish_adapters::AdapterConformanceFixture::new(snapshot2.clone());
    let mut registry2 = AdapterRegistry::new();
    registry2
        .register_artifact_processor(Arc::new(publish_adapters::ChecksumProcessor::new()), &fixture)
        .expect("register checksum");
    registry2
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
    registry2
        .register_artifact_store(
            Arc::new(publish_adapters::TemporaryArtifactStore::new(store_dir.path())),
            &fixture,
        )
        .expect("register store");
    registry2
        .register_delivery_destination(
            Arc::new(SftpDeliveryDestination::new(sftp.clone())),
            &fixture,
        )
        .expect("register sftp");
    let runtime2 = PublishRuntime::new(registry2);

    let attempt2 = run_publish(&runtime2, &snapshot2, "go-cli", "0.1.0", "go-07-2");
    let manifest2 = attempt2.manifest.as_ref().expect("manifest");
    // 推广：digest 应与原 Manifest 一致
    assert_eq!(
        manifest2.digest, original_digest,
        "promoted manifest digest should match original"
    );

    // SFTP 远端应有文件
    assert!(!sftp.paths().is_empty(), "SFTP should have files");
}

/// GO-08: 部分交付恢复--SFTP 写入失败后重试。
#[cfg(feature = "e2e-real-sftp")]
#[test]
fn go_08_partial_delivery_recovery() {
    if !toolchain_available("go") {
        eprintln!("skipping: go not installed");
        return;
    }

    let project = sample_path("go-cli");
    let output_dir = prepare_bin_dir(&project);
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = go_provider(
        vec!["build".to_string(), "-o".to_string(), "./bin/app".to_string()],
        output_dir,
    );
    let sftp = Arc::new(FakeSftpServer::new());
    // 注入故障：第一次 write 失败
    sftp.fail_next(
        "write",
        publish_adapters::SftpTransportFailure::Network {
            message: "simulated network error".to_string(),
        },
    );

    let mut snapshot = build_snapshot("real-go", store_dir.path(), delivery_dir.path(), "0.1.0");
    // Local (Required) + SFTP (Required)
    snapshot.adapters.delivery_routes.push(DeliveryRoute::required(
        AdapterBinding::new(
            "sftp-route",
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
                        Value::String("checksum-manifest".to_string()),
                    ]),
                ),
        )
        .with_credential("ssh_private_key", "sftp-key"),
    ));

    let registry = build_registry_with_sftp(
        provider,
        store_dir.path(),
        delivery_dir.path(),
        sftp.clone(),
        &snapshot,
    );
    let runtime = PublishRuntime::new(registry);

    let attempt = run_publish(&runtime, &snapshot, "go-cli", "0.1.0", "go-08");

    // 应该是 PartialDelivery（Local 成功，SFTP 失败）
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

    // 重试：恢复 SFTP
    let prepared = runtime
        .prepare_attempt(&snapshot)
        .expect("prepare for resume");
    let resumed = runtime
        .resume_attempt(
            &prepared,
            &attempt,
            &publish_runner_core::AttemptExecutionContext::at(1),
        )
        .expect("resume attempt");

    // 重试后应该 Published
    assert_eq!(
        resumed.status,
        PublishAttemptStatus::Published,
        "expected Published after resume, got {:?}",
        resumed.status
    );

    // SFTP 远端应有文件
    assert!(!sftp.paths().is_empty(), "SFTP should have files after resume");
}

/// GO-09: Optional 路线失败不影响整体成功。
#[cfg(feature = "e2e-real-sftp")]
#[test]
fn go_09_optional_route_failure_does_not_affect_overall() {
    if !toolchain_available("go") {
        eprintln!("skipping: go not installed");
        return;
    }

    let project = sample_path("go-cli");
    let output_dir = prepare_bin_dir(&project);
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = go_provider(
        vec!["build".to_string(), "-o".to_string(), "./bin/app".to_string()],
        output_dir,
    );
    let sftp = Arc::new(FakeSftpServer::new());
    // 注入故障：第一次 write 失败
    sftp.fail_next(
        "write",
        publish_adapters::SftpTransportFailure::Network {
            message: "simulated network error".to_string(),
        },
    );

    let mut snapshot = build_snapshot("real-go", store_dir.path(), delivery_dir.path(), "0.1.0");
    // Local (Required) + SFTP (Optional)
    snapshot.adapters.delivery_routes.push(DeliveryRoute::optional(
        AdapterBinding::new(
            "sftp-route",
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
                        Value::String("checksum-manifest".to_string()),
                    ]),
                ),
        )
        .with_credential("ssh_private_key", "sftp-key"),
    ));

    let registry = build_registry_with_sftp(
        provider,
        store_dir.path(),
        delivery_dir.path(),
        sftp.clone(),
        &snapshot,
    );
    let runtime = PublishRuntime::new(registry);

    let attempt = run_publish(&runtime, &snapshot, "go-cli", "0.1.0", "go-09");

    // Optional 路线失败不影响整体：应为 Published
    assert_eq!(
        attempt.status,
        PublishAttemptStatus::Published,
        "expected Published with optional route failure, got {:?}",
        attempt.status
    );

    // Local 路线应该 Published
    let local_receipt = attempt
        .receipts
        .iter()
        .find(|r| r.route_id == "local-route")
        .expect("local route receipt");
    assert_eq!(local_receipt.status, DeliveryStatus::Published);

    // SFTP 路线应有错误
    let sftp_route = attempt
        .routes
        .iter()
        .find(|r| r.route_id == "sftp-route")
        .expect("sftp route view");
    assert!(
        sftp_route.error.is_some(),
        "SFTP optional route should have an error"
    );

    // 应有警告
    assert!(
        !attempt.warnings.is_empty(),
        "warnings should not be empty for optional route failure"
    );
}

/// GO-10: 构建标签（build tags）+ Checksum。
#[test]
fn go_10_build_tags() {
    if !toolchain_available("go") {
        eprintln!("skipping: go not installed");
        return;
    }

    let project = sample_path("go-cli");
    let output_dir = prepare_bin_dir(&project);
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = go_provider(
        vec![
            "build".to_string(),
            "-o".to_string(),
            "./bin/app".to_string(),
            "-tags".to_string(),
            "production".to_string(),
        ],
        output_dir,
    );
    let snapshot = build_snapshot("real-go", store_dir.path(), delivery_dir.path(), "0.1.0");
    let registry = build_local_registry(provider, store_dir.path(), delivery_dir.path(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt = run_publish(&runtime, &snapshot, "go-cli", "0.1.0", "go-10");

    let manifest = assert_published(&attempt);
    assert_manifest_has_role(manifest, "build-output");
    assert_manifest_has_role(manifest, "checksum-manifest");
}
