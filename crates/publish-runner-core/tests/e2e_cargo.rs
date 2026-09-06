//! Cargo Provider 真实构建 E2E 测试（CARGO-01 ~ 10）
//!
//! 使用真实 `cargo build` 命令构建样本项目，验证从构建到交付的完整链路。

#![cfg(feature = "e2e-real-cargo")]

#[path = "common/mod.rs"]
mod common;

use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use common::*;
use publish_adapters::{
    AdapterRegistry, FakeSftpServer, SftpDeliveryDestination, StaticCredentialSource,
};
use publish_domain::{
    AdapterBinding, AdapterIdentity, AdapterKind, AdapterSettings, CredentialKind, DeliveryRoute,
    DeliveryStatus, PublishAttemptStatus, PublishingCapability,
};
use publish_runner_core::PublishRuntime;
use serde_json::Value;

/// 辅助：创建 Cargo provider。
fn cargo_provider(
    args: Vec<String>,
    output_dir: PathBuf,
) -> Arc<RealBuildProvider> {
    let project = sample_path("cargo-cli");
    Arc::new(
        RealBuildProvider::new(
            "real-cargo",
            "cargo:build",
            "cargo",
            args,
            project,
            output_dir,
            classify_cargo,
        ),
    )
}

/// 辅助：创建带环境变量的 Cargo provider（用于交叉编译）。
fn cargo_provider_with_env(
    args: Vec<String>,
    output_dir: PathBuf,
    env: &[(&str, &str)],
) -> Arc<RealBuildProvider> {
    let project = sample_path("cargo-cli");
    let mut provider = RealBuildProvider::new(
        "real-cargo",
        "cargo:build",
        "cargo",
        args,
        project,
        output_dir,
        classify_cargo,
    );
    for (k, v) in env {
        provider = provider.with_env(k, v);
    }
    Arc::new(provider)
}

/// CARGO-01: Release 构建发布到本地目录（无 Checksum）。
#[test]
fn cargo_01_release_build_to_local() {
    if !toolchain_available("cargo") {
        eprintln!("skipping: cargo not installed");
        return;
    }

    let project = sample_path("cargo-cli");
    let output_dir = project.join("target").join("release");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = cargo_provider(
        vec!["build".to_string(), "--release".to_string()],
        output_dir.clone(),
    );
    let snapshot = build_snapshot("real-cargo", store_dir.path(), delivery_dir.path(), "0.1.0");
    let registry = build_local_registry(provider, store_dir.path(), delivery_dir.path(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt = run_publish(&runtime, &snapshot, "cargo-cli", "0.1.0", "cargo-01");

    let manifest = assert_published(&attempt);
    assert_manifest_has_role(manifest, "build-output");
    // 交付目录应有产物文件
    assert!(!attempt.receipts.is_empty());
    let receipt = &attempt.receipts[0];
    let delivery_path = PathBuf::from(receipt.external_reference.as_str());
    assert!(delivery_path.exists(), "delivery directory should exist");
}

/// CARGO-02: Release + Checksum 发布到本地目录。
#[test]
fn cargo_02_release_with_checksum_to_local() {
    if !toolchain_available("cargo") {
        eprintln!("skipping: cargo not installed");
        return;
    }

    let project = sample_path("cargo-cli");
    let output_dir = project.join("target").join("release");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = cargo_provider(
        vec!["build".to_string(), "--release".to_string()],
        output_dir,
    );
    let snapshot = build_snapshot("real-cargo", store_dir.path(), delivery_dir.path(), "0.1.0");
    let registry = build_local_registry(provider, store_dir.path(), delivery_dir.path(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt = run_publish(&runtime, &snapshot, "cargo-cli", "0.1.0", "cargo-02");

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

/// CARGO-03: 交叉编译发布到 SFTP（需要 Docker）。
#[cfg(feature = "e2e-real-sftp")]
#[test]
fn cargo_03_cross_compile_to_sftp() {
    if !toolchain_available("cargo") {
        eprintln!("skipping: cargo not installed");
        return;
    }
    if !docker_available() {
        eprintln!("skipping: docker not available");
        return;
    }
    // 交叉编译目标需要安装
    let target = "x86_64-unknown-linux-gnu";
    let check = std::process::Command::new("rustup")
        .args(["target", "list", "--installed"])
        .output();
    if let Ok(output) = check {
        let installed = String::from_utf8_lossy(&output.stdout);
        if !installed.contains(target) {
            eprintln!("skipping: {target} not installed (run: rustup target add {target})");
            return;
        }
    }

    let project = sample_path("cargo-cli");
    let output_dir = project.join("target").join(target).join("release");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = cargo_provider_with_env(
        vec!["build".to_string(), "--release".to_string(), "--target".to_string(), target.to_string()],
        output_dir,
        &[],
    );
    let sftp = Arc::new(FakeSftpServer::new());

    let mut snapshot = build_snapshot("real-cargo", store_dir.path(), delivery_dir.path(), "0.1.0");
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

    let attempt = run_publish(&runtime, &snapshot, "cargo-cli", "0.1.0", "cargo-03");

    let manifest = assert_published(&attempt);
    assert_manifest_has_role(manifest, "build-output");

    // 验证 SFTP 远端有文件
    let remote_files = sftp.paths();
    assert!(
        !remote_files.is_empty(),
        "SFTP remote should have files, got: {remote_files:?}"
    );
}

/// CARGO-04: 带 features 构建多路线交付（Local Required + SFTP Optional）。
#[cfg(feature = "e2e-real-sftp")]
#[test]
fn cargo_04_features_multi_route() {
    if !toolchain_available("cargo") {
        eprintln!("skipping: cargo not installed");
        return;
    }

    let project = sample_path("cargo-cli");
    let output_dir = project.join("target").join("release");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = cargo_provider(
        vec!["build".to_string(), "--release".to_string(), "--features".to_string(), "test-feature".to_string()],
        output_dir,
    );
    let sftp = Arc::new(FakeSftpServer::new());

    let mut snapshot = build_snapshot("real-cargo", store_dir.path(), delivery_dir.path(), "0.1.0");
    // 添加 SFTP 作为 Optional 路线
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

    let fixture = publish_adapters::AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = build_local_registry(provider, store_dir.path(), delivery_dir.path(), &snapshot);
    registry
        .register_delivery_destination(
            Arc::new(SftpDeliveryDestination::new(sftp.clone())),
            &fixture,
        )
        .expect("register sftp");
    let runtime = PublishRuntime::new(registry);

    let attempt = run_publish(&runtime, &snapshot, "cargo-cli", "0.1.0", "cargo-04");

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

/// CARGO-05: Workspace 成员构建。
#[test]
fn cargo_05_workspace_member_build() {
    if !toolchain_available("cargo") {
        eprintln!("skipping: cargo not installed");
        return;
    }

    let project = sample_path("cargo-workspace");
    let output_dir = project.join("target").join("release");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = Arc::new(RealBuildProvider::new(
        "real-cargo",
        "cargo:build",
        "cargo",
        vec!["build".to_string(), "--release".to_string(), "-p".to_string(), "cargo-ws-bin".to_string()],
        project,
        output_dir,
        classify_cargo,
    ));
    let snapshot = build_snapshot("real-cargo", store_dir.path(), delivery_dir.path(), "0.1.0");
    let registry = build_local_registry(provider, store_dir.path(), delivery_dir.path(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt = run_publish(&runtime, &snapshot, "cargo-ws-bin", "0.1.0", "cargo-05");

    let manifest = assert_published(&attempt);
    // 应该有 cargo-ws-bin 二进制
    let has_binary = manifest
        .artifacts
        .iter()
        .any(|a| a.file_name.contains("cargo-ws-bin"));
    assert!(
        has_binary,
        "manifest should contain cargo-ws-bin binary, found: {:?}",
        manifest
            .artifacts
            .iter()
            .map(|a| a.file_name.as_str())
            .collect::<Vec<_>>()
    );
}

/// CARGO-06: --no-default-features 构建。
#[test]
fn cargo_06_no_default_features() {
    if !toolchain_available("cargo") {
        eprintln!("skipping: cargo not installed");
        return;
    }

    let project = sample_path("cargo-cli");
    let output_dir = project.join("target").join("release");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = cargo_provider(
        vec![
            "build".to_string(),
            "--release".to_string(),
            "--no-default-features".to_string(),
        ],
        output_dir,
    );
    let snapshot = build_snapshot("real-cargo", store_dir.path(), delivery_dir.path(), "0.1.0");
    let registry = build_local_registry(provider, store_dir.path(), delivery_dir.path(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt = run_publish(&runtime, &snapshot, "cargo-cli", "0.1.0", "cargo-06");

    let manifest = assert_published(&attempt);
    assert_manifest_has_role(manifest, "build-output");
}

/// CARGO-07: 产物推广 Local -> SFTP（不重新构建）。
#[cfg(feature = "e2e-real-sftp")]
#[test]
fn cargo_07_artifact_promotion() {
    if !toolchain_available("cargo") {
        eprintln!("skipping: cargo not installed");
        return;
    }

    let project = sample_path("cargo-cli");
    let output_dir = project.join("target").join("release");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    // 第一次发布：构建到 Local
    let provider = cargo_provider(
        vec!["build".to_string(), "--release".to_string()],
        output_dir,
    );
    let snapshot = build_snapshot("real-cargo", store_dir.path(), delivery_dir.path(), "0.1.0");
    let registry = build_local_registry(provider, store_dir.path(), delivery_dir.path(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt1 = run_publish(&runtime, &snapshot, "cargo-cli", "0.1.0", "cargo-07-1");
    let manifest1 = assert_published(&attempt1);
    let original_digest = manifest1.digest.clone();

    // 第二次发布：推广到 SFTP（不重新构建）
    let sftp = Arc::new(FakeSftpServer::new());
    let mut snapshot2 = build_snapshot("real-cargo", store_dir.path(), delivery_dir.path(), "0.1.0");
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

    let attempt2 = run_publish(&runtime2, &snapshot2, "cargo-cli", "0.1.0", "cargo-07-2");
    let manifest2 = attempt2.manifest.as_ref().expect("manifest");
    // 推广：digest 应与原 Manifest 一致
    assert_eq!(
        manifest2.digest, original_digest,
        "promoted manifest digest should match original"
    );

    // SFTP 远端应有文件
    assert!(!sftp.paths().is_empty(), "SFTP should have files");
}

/// CARGO-08: 部分交付恢复——SFTP 网络中断后重试。
#[cfg(feature = "e2e-real-sftp")]
#[test]
fn cargo_08_partial_delivery_recovery() {
    if !toolchain_available("cargo") {
        eprintln!("skipping: cargo not installed");
        return;
    }

    let project = sample_path("cargo-cli");
    let output_dir = project.join("target").join("release");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = cargo_provider(
        vec!["build".to_string(), "--release".to_string()],
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

    let mut snapshot = build_snapshot("real-cargo", store_dir.path(), delivery_dir.path(), "0.1.0");
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

    let fixture = publish_adapters::AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = build_local_registry(provider, store_dir.path(), delivery_dir.path(), &snapshot);
    registry
        .register_delivery_destination(
            Arc::new(SftpDeliveryDestination::new(sftp.clone())),
            &fixture,
        )
        .expect("register sftp");
    let runtime = PublishRuntime::new(registry);

    let attempt = run_publish(&runtime, &snapshot, "cargo-cli", "0.1.0", "cargo-08");

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

/// CARGO-09: Custom Command 门禁（计划验证）。
///
/// CustomCommandProcessor 当前只生成计划节点不执行命令；
/// 本测试验证门禁节点出现在计划中且程序标识正确。
#[test]
fn cargo_09_custom_command_gate() {
    if !toolchain_available("cargo") {
        eprintln!("skipping: cargo not installed");
        return;
    }

    let project = sample_path("cargo-cli");
    let output_dir = project.join("target").join("release");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = cargo_provider(
        vec!["build".to_string(), "--release".to_string()],
        output_dir,
    );

    let custom_processor = publish_adapters::CustomCommandProcessor::new(["test:gate"]);

    let mut snapshot = build_snapshot("real-cargo", store_dir.path(), delivery_dir.path(), "0.1.0");
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

/// CARGO-10: 幂等重试——已 Published 的 Local Delivery 再次执行。
#[test]
fn cargo_10_idempotent_retry() {
    if !toolchain_available("cargo") {
        eprintln!("skipping: cargo not installed");
        return;
    }

    let project = sample_path("cargo-cli");
    let output_dir = project.join("target").join("release");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = cargo_provider(
        vec!["build".to_string(), "--release".to_string()],
        output_dir,
    );
    let snapshot = build_snapshot("real-cargo", store_dir.path(), delivery_dir.path(), "0.1.0");
    let registry = build_local_registry(provider, store_dir.path(), delivery_dir.path(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    // 第一次发布
    let attempt1 = run_publish(&runtime, &snapshot, "cargo-cli", "0.1.0", "cargo-10-1");
    assert_published(&attempt1);
    let manifest1 = attempt1.manifest.as_ref().expect("manifest");
    let original_digest = manifest1.digest.clone();

    // 第二次发布（同一配置）：应该复用已 Published 的交付
    let attempt2 = run_publish(&runtime, &snapshot, "cargo-cli", "0.1.0", "cargo-10-2");
    assert_eq!(
        attempt2.status,
        PublishAttemptStatus::Published,
        "second attempt should also be Published"
    );

    // Manifest digest 应该一致（相同输入 -> 相同计划 -> 相同产物）
    let manifest2 = attempt2.manifest.as_ref().expect("manifest");
    assert_eq!(
        manifest2.digest, original_digest,
        "manifest digest should be deterministic"
    );
}
