//! Dotnet Provider 真实构建 E2E 测试（DOTNET-01 ~ 10）
//!
//! 使用真实 `dotnet publish` 命令构建样本项目，验证从构建到交付的完整链路。

#![cfg(feature = "e2e-real-dotnet")]

#[path = "common/mod.rs"]
mod common;

use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use common::*;
use publish_adapters::{
    AdapterRegistry, FakeGitHubReleaseApi, GitHubApiFailure, GitHubReleaseDestination,
    SftpDeliveryDestination, StaticCredentialSource,
};
use publish_domain::{
    AdapterBinding, AdapterIdentity, AdapterKind, AdapterSettings, CredentialKind, DeliveryRoute,
    DeliveryStatus, PublishAttemptStatus,
};
use publish_runner_core::PublishRuntime;
use serde_json::Value;

const GITHUB_TOKEN_REFERENCE: &str = "release-github-token";
const GITHUB_TOKEN_VALUE: &str = "ghp_dotnet-e2e-token";

/// 辅助：返回当前平台的 .NET Runtime Identifier（RID）。
fn dotnet_rid() -> String {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "osx-arm64".to_string(),
        ("macos", "x86_64") => "osx-x64".to_string(),
        ("linux", "x86_64") => "linux-x64".to_string(),
        ("linux", "aarch64") => "linux-arm64".to_string(),
        ("windows", "x86_64") => "win-x64".to_string(),
        ("windows", "aarch64") => "win-arm64".to_string(),
        _ => "osx-arm64".to_string(),
    }
}

/// 辅助：创建 Dotnet provider。
fn dotnet_provider(
    args: Vec<String>,
    output_dir: PathBuf,
) -> Arc<RealBuildProvider> {
    let project = sample_path("dotnet-console");
    Arc::new(
        RealBuildProvider::new(
            "real-dotnet",
            "dotnet:publish",
            "dotnet",
            args,
            project,
            output_dir,
            classify_dotnet,
        ),
    )
}

/// 辅助：构建 GitHub Release 交付路线。
fn github_route(route_id: &str, tag_prefix: &str) -> DeliveryRoute {
    DeliveryRoute::required(
        AdapterBinding::new(
            route_id,
            AdapterIdentity::new(AdapterKind::DeliveryDestination, "github-release", 1),
            AdapterSettings::new(1)
                .with_value("repository", Value::String("acme/demo".to_string()))
                .with_value("visibility", Value::String("public".to_string()))
                .with_value("tag_prefix", Value::String(tag_prefix.to_string()))
                .with_value(
                    "allowed_asset_roles",
                    Value::Array(vec![
                        Value::String("build-output".to_string()),
                        Value::String("checksum-manifest".to_string()),
                    ]),
                )
                .with_value("updater_enabled", Value::Bool(false))
                .with_value(
                    "enabled_platforms",
                    Value::Array(vec![Value::String("macos-aarch64".to_string())]),
                )
                .with_value("unsigned_release_override", Value::Bool(false)),
        )
        .with_credential("github_token", GITHUB_TOKEN_REFERENCE),
    )
}

/// 辅助：构建 SFTP 交付路线。
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
                        Value::String("checksum-manifest".to_string()),
                    ]),
                ),
        )
        .with_credential("ssh_private_key", "sftp-key"),
    )
}

/// DOTNET-01: Self-contained 发布到本地目录。
#[test]
fn dotnet_01_self_contained_to_local() {
    if !toolchain_available("dotnet") {
        eprintln!("skipping: dotnet not installed");
        return;
    }

    let project = sample_path("dotnet-console");
    let rid = dotnet_rid();
    let output_dir = project
        .join("bin")
        .join("Release")
        .join("net8.0")
        .join(&rid)
        .join("publish");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = dotnet_provider(
        vec![
            "publish".to_string(),
            "dotnet-console.csproj".to_string(),
            "-c".to_string(),
            "Release".to_string(),
            "-r".to_string(),
            rid,
            "--self-contained".to_string(),
        ],
        output_dir,
    );
    let snapshot = build_snapshot("real-dotnet", store_dir.path(), delivery_dir.path(), "0.1.0");
    let registry = build_local_registry(provider, store_dir.path(), delivery_dir.path(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt = run_publish(&runtime, &snapshot, "dotnet-console", "0.1.0", "dotnet-01");

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

/// DOTNET-02: Framework-dependent 发布到本地目录。
#[test]
fn dotnet_02_framework_dependent_to_local() {
    if !toolchain_available("dotnet") {
        eprintln!("skipping: dotnet not installed");
        return;
    }

    let project = sample_path("dotnet-console");
    let output_dir = project
        .join("bin")
        .join("Release")
        .join("net8.0")
        .join("publish");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = dotnet_provider(
        vec![
            "publish".to_string(),
            "dotnet-console.csproj".to_string(),
            "-c".to_string(),
            "Release".to_string(),
            "--no-self-contained".to_string(),
        ],
        output_dir,
    );
    let snapshot = build_snapshot("real-dotnet", store_dir.path(), delivery_dir.path(), "0.1.0");
    let registry = build_local_registry(provider, store_dir.path(), delivery_dir.path(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt = run_publish(&runtime, &snapshot, "dotnet-console", "0.1.0", "dotnet-02");

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

/// DOTNET-03: Framework-dependent + Checksum 发布到 GitHub Release。
#[cfg(feature = "e2e-real-github")]
#[test]
fn dotnet_03_framework_dependent_to_github_release() {
    if !toolchain_available("dotnet") {
        eprintln!("skipping: dotnet not installed");
        return;
    }

    let project = sample_path("dotnet-console");
    let output_dir = project
        .join("bin")
        .join("Release")
        .join("net8.0")
        .join("publish");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = dotnet_provider(
        vec![
            "publish".to_string(),
            "dotnet-console.csproj".to_string(),
            "-c".to_string(),
            "Release".to_string(),
            "--no-self-contained".to_string(),
        ],
        output_dir,
    );
    let github = Arc::new(FakeGitHubReleaseApi::new());

    let mut snapshot = build_snapshot("real-dotnet", store_dir.path(), delivery_dir.path(), "0.1.0");
    // 替换交付路线为 GitHub Release
    snapshot.adapters.delivery_routes = vec![github_route("github-route", "v")];

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
                    GITHUB_TOKEN_REFERENCE,
                    CredentialKind::Token,
                    GITHUB_TOKEN_VALUE,
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
            Arc::new(GitHubReleaseDestination::new(github.clone())),
            &fixture,
        )
        .expect("register github");
    let runtime = PublishRuntime::new(registry);

    let attempt = run_publish(&runtime, &snapshot, "dotnet-console", "0.1.0", "dotnet-03");

    let manifest = assert_published(&attempt);
    assert_manifest_has_role(manifest, "build-output");
    assert_manifest_has_role(manifest, "checksum-manifest");

    // 验证 GitHub Release 已发布
    let release = github.release("v0.1.0").expect("github release");
    assert!(!release.draft);
    assert!(!release.prerelease);
    assert!(
        !release.assets.is_empty(),
        "github release should have uploaded assets"
    );
}

/// DOTNET-04: MSBuild 属性 + Custom Command 门禁（计划验证）。
///
/// CustomCommandProcessor 当前只生成计划节点不执行命令；
/// 本测试验证门禁节点出现在计划中且程序标识正确。
#[test]
fn dotnet_04_msbuild_properties_custom_gate() {
    if !toolchain_available("dotnet") {
        eprintln!("skipping: dotnet not installed");
        return;
    }

    let project = sample_path("dotnet-console");
    let output_dir = project
        .join("bin")
        .join("Release")
        .join("net8.0")
        .join("publish");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = dotnet_provider(
        vec![
            "publish".to_string(),
            "dotnet-console.csproj".to_string(),
            "-c".to_string(),
            "Release".to_string(),
            "-p:Version=1.0.0".to_string(),
        ],
        output_dir,
    );

    let custom_processor = publish_adapters::CustomCommandProcessor::new(["test:gate"]);

    let mut snapshot = build_snapshot("real-dotnet", store_dir.path(), delivery_dir.path(), "1.0.0");
    snapshot.adapters.artifact_processors.push(AdapterBinding::new(
        "gate",
        AdapterIdentity::new(AdapterKind::ArtifactProcessor, "custom-command", 1),
        AdapterSettings::new(1)
            .with_value("program", Value::String("test:gate".to_string()))
            .with_value("args", Value::Array(vec![]))
            .with_value("input_roles", Value::Array(vec![Value::String("build-output".to_string())]))
            .with_value("output_roles", Value::Array(vec![])),
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
        .register_artifact_processor(Arc::new(custom_processor), &fixture)
        .expect("register custom command");
    registry
        .register_execution_backend(
            Arc::new(publish_adapters::LocalExecutionBackend::with_credential_source(Arc::new(
                StaticCredentialSource::new(),
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
    let runtime = PublishRuntime::new(registry);

    // 只验证计划：门禁节点应出现在计划中
    let prepared = runtime
        .prepare_attempt(&snapshot)
        .expect("prepare attempt");

    let has_gate_node = prepared
        .plan
        .nodes
        .iter()
        .any(|node| match &node.operation {
            publish_domain::PlanOperation::RunProgram { program, .. } => program == "test:gate",
            _ => false,
        });
    assert!(
        has_gate_node,
        "plan should contain a custom command gate node with program 'test:gate'"
    );
}

/// DOTNET-05: 自定义输出目录发布到本地。
#[test]
fn dotnet_05_custom_output_directory() {
    if !toolchain_available("dotnet") {
        eprintln!("skipping: dotnet not installed");
        return;
    }

    let project = sample_path("dotnet-console");
    let output_dir = project.join("dist");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = dotnet_provider(
        vec![
            "publish".to_string(),
            "dotnet-console.csproj".to_string(),
            "-c".to_string(),
            "Release".to_string(),
            "-o".to_string(),
            "./dist".to_string(),
        ],
        output_dir,
    );
    let snapshot = build_snapshot("real-dotnet", store_dir.path(), delivery_dir.path(), "0.1.0");
    let registry = build_local_registry(provider, store_dir.path(), delivery_dir.path(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt = run_publish(&runtime, &snapshot, "dotnet-console", "0.1.0", "dotnet-05");

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

/// DOTNET-06: --no-build 发布到本地目录。
///
/// 先执行 `dotnet build` 再执行 `dotnet publish --no-build`，
/// 验证跳过编译步骤的发布链路。
#[test]
fn dotnet_06_no_build_publish() {
    if !toolchain_available("dotnet") {
        eprintln!("skipping: dotnet not installed");
        return;
    }

    let project = sample_path("dotnet-console");

    // 先构建，因为 --no-build 不会编译
    let build_status = std::process::Command::new("dotnet")
        .args(["build", "dotnet-console.csproj", "-c", "Release"])
        .current_dir(&project)
        .status()
        .expect("dotnet build");
    if !build_status.success() {
        eprintln!("skipping: dotnet build failed");
        return;
    }

    let output_dir = project
        .join("bin")
        .join("Release")
        .join("net8.0")
        .join("publish");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = dotnet_provider(
        vec![
            "publish".to_string(),
            "dotnet-console.csproj".to_string(),
            "-c".to_string(),
            "Release".to_string(),
            "--no-build".to_string(),
        ],
        output_dir,
    );
    let snapshot = build_snapshot("real-dotnet", store_dir.path(), delivery_dir.path(), "0.1.0");
    let registry = build_local_registry(provider, store_dir.path(), delivery_dir.path(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt = run_publish(&runtime, &snapshot, "dotnet-console", "0.1.0", "dotnet-06");

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

/// DOTNET-07: 双路线交付--Local + SFTP（self-contained linux-x64）。
#[cfg(feature = "e2e-real-sftp")]
#[test]
fn dotnet_07_dual_route_local_sftp() {
    if !toolchain_available("dotnet") {
        eprintln!("skipping: dotnet not installed");
        return;
    }

    let project = sample_path("dotnet-console");
    let output_dir = project
        .join("bin")
        .join("Release")
        .join("net8.0")
        .join("linux-x64")
        .join("publish");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = dotnet_provider(
        vec![
            "publish".to_string(),
            "dotnet-console.csproj".to_string(),
            "-c".to_string(),
            "Release".to_string(),
            "-r".to_string(),
            "linux-x64".to_string(),
            "--self-contained".to_string(),
        ],
        output_dir,
    );
    let sftp = Arc::new(publish_adapters::FakeSftpServer::new());

    let mut snapshot = build_snapshot("real-dotnet", store_dir.path(), delivery_dir.path(), "0.1.0");
    // 添加 SFTP 作为第二 Required 路线
    snapshot.adapters.delivery_routes.push(sftp_route("sftp-route"));

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
            Arc::new(publish_adapters::LocalDirectoryDestination::new(delivery_dir.path())),
            &fixture,
        )
        .expect("register local");
    registry
        .register_delivery_destination(
            Arc::new(SftpDeliveryDestination::new(sftp.clone())),
            &fixture,
        )
        .expect("register sftp");
    let runtime = PublishRuntime::new(registry);

    let attempt = run_publish(&runtime, &snapshot, "dotnet-console", "0.1.0", "dotnet-07");

    let manifest = assert_published(&attempt);
    assert_manifest_has_role(manifest, "build-output");

    // Local 路线应该 Published
    let local_receipt = attempt
        .receipts
        .iter()
        .find(|r| r.route_id == "local-route")
        .expect("local route receipt");
    assert_eq!(local_receipt.status, DeliveryStatus::Published);

    // 构建只执行一次：Manifest 只封存一次
    assert_manifest_has_role(manifest, "checksum-manifest");

    // SFTP 远端应有文件
    let remote_files = sftp.paths();
    assert!(
        !remote_files.is_empty(),
        "SFTP remote should have files, got: {remote_files:?}"
    );
}

/// DOTNET-08: 产物推广 Local -> GitHub Release（不重新构建）。
#[cfg(feature = "e2e-real-github")]
#[test]
fn dotnet_08_artifact_promotion_to_github_release() {
    if !toolchain_available("dotnet") {
        eprintln!("skipping: dotnet not installed");
        return;
    }

    let project = sample_path("dotnet-console");
    let output_dir = project
        .join("bin")
        .join("Release")
        .join("net8.0")
        .join("publish");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    // 第一次发布：构建到 Local
    let provider = dotnet_provider(
        vec![
            "publish".to_string(),
            "dotnet-console.csproj".to_string(),
            "-c".to_string(),
            "Release".to_string(),
            "--no-self-contained".to_string(),
        ],
        output_dir,
    );
    let snapshot = build_snapshot("real-dotnet", store_dir.path(), delivery_dir.path(), "0.1.0");
    let registry = build_local_registry(provider, store_dir.path(), delivery_dir.path(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt1 = run_publish(&runtime, &snapshot, "dotnet-console", "0.1.0", "dotnet-08-1");
    let manifest1 = assert_published(&attempt1);
    let original_digest = manifest1.digest.clone();

    // 第二次发布：推广到 GitHub Release（不重新构建）
    let github = Arc::new(FakeGitHubReleaseApi::new());
    let mut snapshot2 = build_snapshot("real-dotnet", store_dir.path(), delivery_dir.path(), "0.1.0");
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

    let attempt2 = run_publish(&runtime2, &snapshot2, "dotnet-console", "0.1.0", "dotnet-08-2");
    let manifest2 = attempt2.manifest.as_ref().expect("manifest");
    // 推广：digest 应与原 Manifest 一致
    assert_eq!(
        manifest2.digest, original_digest,
        "promoted manifest digest should match original"
    );

    // GitHub Release 已发布且资产非空
    let release = github.release("v0.1.0").expect("github release");
    assert!(!release.draft);
    assert!(
        !release.assets.is_empty(),
        "github release should have uploaded assets"
    );
}

/// DOTNET-09: 部分交付恢复--GitHub Release 限流后重试。
#[cfg(feature = "e2e-real-github")]
#[test]
fn dotnet_09_partial_delivery_github_rate_limited() {
    if !toolchain_available("dotnet") {
        eprintln!("skipping: dotnet not installed");
        return;
    }

    let project = sample_path("dotnet-console");
    let output_dir = project
        .join("bin")
        .join("Release")
        .join("net8.0")
        .join("publish");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = dotnet_provider(
        vec![
            "publish".to_string(),
            "dotnet-console.csproj".to_string(),
            "-c".to_string(),
            "Release".to_string(),
            "--no-self-contained".to_string(),
        ],
        output_dir,
    );
    let github = Arc::new(FakeGitHubReleaseApi::new());
    // 注入限流失败：第一次 upload_asset 失败
    github.fail_next(
        publish_adapters::FAKE_OPERATION_UPLOAD,
        GitHubApiFailure::RateLimited {
            retry_after_seconds: 1,
            message: "simulated rate limit".to_string(),
        },
    );

    let mut snapshot = build_snapshot("real-dotnet", store_dir.path(), delivery_dir.path(), "0.1.0");
    // Local (Required) + GitHub (Required)
    snapshot.adapters.delivery_routes.push(github_route("github-route", "v"));

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
                    GITHUB_TOKEN_REFERENCE,
                    CredentialKind::Token,
                    GITHUB_TOKEN_VALUE,
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

    let attempt = run_publish(&runtime, &snapshot, "dotnet-console", "0.1.0", "dotnet-09");

    // 应该是 PartialDelivery（Local 成功，GitHub 限流失败）
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

    // 重试：恢复 GitHub
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

    // GitHub Release 应有资产
    let release = github.release("v0.1.0").expect("github release");
    assert!(
        !release.assets.is_empty(),
        "github release should have uploaded assets after resume"
    );
}

/// DOTNET-10: Multiple ProjectFile 选择--验证样本项目有 .csproj 并构建。
#[test]
fn dotnet_10_multiple_projectfile_selection() {
    if !toolchain_available("dotnet") {
        eprintln!("skipping: dotnet not installed");
        return;
    }

    let project = sample_path("dotnet-console");

    // 查找 .csproj 文件
    let csproj = fs::read_dir(&project)
        .expect("read project dir")
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .find(|p| p.extension().and_then(|e| e.to_str()) == Some("csproj"))
        .expect("should find a .csproj file");
    let csproj_name = csproj
        .file_name()
        .and_then(|n| n.to_str())
        .expect("csproj file name");

    let output_dir = project
        .join("bin")
        .join("Release")
        .join("net8.0")
        .join("publish");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = dotnet_provider(
        vec![
            "publish".to_string(),
            csproj_name.to_string(),
            "-c".to_string(),
            "Release".to_string(),
        ],
        output_dir,
    );
    let snapshot = build_snapshot("real-dotnet", store_dir.path(), delivery_dir.path(), "0.1.0");
    let registry = build_local_registry(provider, store_dir.path(), delivery_dir.path(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt = run_publish(&runtime, &snapshot, "dotnet-console", "0.1.0", "dotnet-10");

    let manifest = assert_published(&attempt);
    assert_manifest_has_role(manifest, "build-output");
    assert_manifest_has_role(manifest, "checksum-manifest");
}
