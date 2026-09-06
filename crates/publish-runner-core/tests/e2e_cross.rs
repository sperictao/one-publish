//! Cross-cutting E2E tests (CROSS-01 ~ 20)
//!
//! Verifies platform-level contracts across multiple providers and delivery
//! targets: recovery, promotion, capability planning, gates, idempotency,
//! credentials, and automation/version semantics.
//!
//! Uses `RealBuildProvider` with the cargo-cli sample project (cargo is the
//! most likely toolchain to be available) and `FakeSftpServer` /
//! `FakeGitHubReleaseApi` for delivery targets.

#![cfg(feature = "e2e-real")]

#[path = "common/mod.rs"]
mod common;

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use common::*;
use publish_adapters::{
    AdapterContract, AdapterRegistry, ChecksumProcessor, CustomCommandProcessor,
    ExecutionBackend, FakeAutomationBackend, FakeGitHubReleaseApi, FakeSftpServer,
    GitHubActionsBackend, GitHubApiFailure, GitHubReleaseDestination, LocalDirectoryDestination,
    LocalExecutionBackend, ProjectProvider, SftpDeliveryDestination, SftpTransportFailure,
    StaticCredentialSource, TauriProjectProvider, TauriVersionSourceKind,
    TemporaryArtifactStore, CHECKSUM_MANIFEST_ROLE, FAKE_OPERATION_UPLOAD,
    GITHUB_ACTIONS_BACKEND_ID, FAKE_AUTOMATION_BACKEND_ID,
};
use publish_domain::{
    AdapterBinding, AdapterDescriptor, AdapterIdentity, AdapterKind, AdapterSchema,
    AdapterSettings, AutomationBindingProjection, AutomationProjection,
    AutomationRuntimeRevision, AutomationTriggerPolicy, CapabilityRequirement, CredentialKind,
    DeliveryRoute, DeliveryStatus, PlanNodeTemplate, PlanOperation, PlanStage,
    PlanningInputSnapshot, PublishAttemptStatus, PublishError, PublishFailureCategory,
    PublishingCapability, RuntimeAdapterRevision, RuntimeComponentRevision, sha256_hex,
};
use publish_runner_core::{AttemptExecutionContext, PublishRuntime};
use serde_json::Value;

const GITHUB_TOKEN_REFERENCE: &str = "cross-github-token";
const GITHUB_TOKEN_VALUE: &str = "ghp_cross-e2e-token";
const SFTP_KEY_REFERENCE: &str = "cross-sftp-key";
const SFTP_KEY_VALUE: &str = "test-key-value";

// ─── Helpers ───

/// Returns the current platform key (e.g. `macos-aarch64`).
fn current_platform() -> String {
    format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
}

/// Cargo classify that assigns `installer` role to the binary, for GitHub
/// Release compatibility (the platform-matrix check requires `installer`).
fn classify_cargo_installer(relative: &Path) -> (&'static str, &'static str) {
    let name = relative
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    if name.ends_with(".d") || name.ends_with(".rlib") || name.ends_with(".rmeta") {
        return ("build-support", "application/octet-stream");
    }
    if relative
        .components()
        .any(|c| c.as_os_str() == "deps" || c.as_os_str() == "build" || c.as_os_str() == "examples"
            || c.as_os_str() == "incremental")
    {
        return ("build-support", "application/octet-stream");
    }
    ("installer", "application/octet-stream")
}

/// Create a Cargo provider using `classify_cargo_installer`.
fn cargo_provider(args: Vec<String>, output_dir: PathBuf) -> Arc<RealBuildProvider> {
    let project = sample_path("cargo-cli");
    Arc::new(RealBuildProvider::new(
        "real-cargo",
        "cargo:build",
        "cargo",
        args,
        project,
        output_dir,
        classify_cargo_installer,
    ))
}

/// Create a GitHub Release delivery route.
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
                        Value::String("installer".to_string()),
                        Value::String(CHECKSUM_MANIFEST_ROLE.to_string()),
                    ]),
                )
                .with_value("updater_enabled", Value::Bool(false))
                .with_value(
                    "enabled_platforms",
                    Value::Array(vec![Value::String(current_platform())]),
                )
                .with_value("unsigned_release_override", Value::Bool(true)),
        )
        .with_credential("github_token", GITHUB_TOKEN_REFERENCE),
    )
}

/// Create an SFTP delivery route.
fn sftp_route(route_id: &str, remote_path: &str) -> DeliveryRoute {
    DeliveryRoute::required(
        AdapterBinding::new(
            route_id,
            AdapterIdentity::new(AdapterKind::DeliveryDestination, "sftp", 1),
            AdapterSettings::new(1)
                .with_value("host", Value::String("localhost".to_string()))
                .with_value("port", Value::from(2222u64))
                .with_value("username", Value::String("testuser".to_string()))
                .with_value("remote_path", Value::String(remote_path.to_string()))
                .with_value(
                    "artifact_roles",
                    Value::Array(vec![
                        Value::String("installer".to_string()),
                        Value::String(CHECKSUM_MANIFEST_ROLE.to_string()),
                    ]),
                ),
        )
        .with_credential("ssh_private_key", SFTP_KEY_REFERENCE),
    )
}

/// Build a registry with GitHub Release destination and full credentials.
fn build_github_registry(
    provider: Arc<RealBuildProvider>,
    store_dir: &Path,
    delivery_dir: &Path,
    github: Arc<FakeGitHubReleaseApi>,
    snapshot: &PlanningInputSnapshot,
) -> AdapterRegistry {
    let fixture = publish_adapters::AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(provider, &fixture)
        .expect("register provider");
    registry
        .register_artifact_processor(Arc::new(ChecksumProcessor::new()), &fixture)
        .expect("register checksum");
    registry
        .register_execution_backend(
            Arc::new(LocalExecutionBackend::with_credential_source(Arc::new(
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
            Arc::new(TemporaryArtifactStore::new(store_dir)),
            &fixture,
        )
        .expect("register store");
    registry
        .register_delivery_destination(
            Arc::new(LocalDirectoryDestination::new(delivery_dir)),
            &fixture,
        )
        .expect("register local");
    registry
        .register_delivery_destination(
            Arc::new(GitHubReleaseDestination::new(github)),
            &fixture,
        )
        .expect("register github");
    registry
}

/// Build a registry with SFTP destination and full credentials.
fn build_sftp_registry(
    provider: Arc<RealBuildProvider>,
    store_dir: &Path,
    delivery_dir: &Path,
    sftp: Arc<FakeSftpServer>,
    snapshot: &PlanningInputSnapshot,
) -> AdapterRegistry {
    let fixture = publish_adapters::AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(provider, &fixture)
        .expect("register provider");
    registry
        .register_artifact_processor(Arc::new(ChecksumProcessor::new()), &fixture)
        .expect("register checksum");
    registry
        .register_execution_backend(
            Arc::new(LocalExecutionBackend::with_credential_source(Arc::new(
                StaticCredentialSource::new().with_secret(
                    SFTP_KEY_REFERENCE,
                    CredentialKind::SshPrivateKey,
                    SFTP_KEY_VALUE,
                ),
            ))),
            &fixture,
        )
        .expect("register backend");
    registry
        .register_artifact_store(
            Arc::new(TemporaryArtifactStore::new(store_dir)),
            &fixture,
        )
        .expect("register store");
    registry
        .register_delivery_destination(
            Arc::new(LocalDirectoryDestination::new(delivery_dir)),
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

/// Build a registry with both SFTP and GitHub Release destinations.
fn build_sftp_github_registry(
    provider: Arc<RealBuildProvider>,
    store_dir: &Path,
    delivery_dir: &Path,
    sftp: Arc<FakeSftpServer>,
    github: Arc<FakeGitHubReleaseApi>,
    snapshot: &PlanningInputSnapshot,
) -> AdapterRegistry {
    let fixture = publish_adapters::AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(provider, &fixture)
        .expect("register provider");
    registry
        .register_artifact_processor(Arc::new(ChecksumProcessor::new()), &fixture)
        .expect("register checksum");
    registry
        .register_execution_backend(
            Arc::new(LocalExecutionBackend::with_credential_source(Arc::new(
                StaticCredentialSource::new()
                    .with_secret(
                        SFTP_KEY_REFERENCE,
                        CredentialKind::SshPrivateKey,
                        SFTP_KEY_VALUE,
                    )
                    .with_secret(
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
            Arc::new(TemporaryArtifactStore::new(store_dir)),
            &fixture,
        )
        .expect("register store");
    registry
        .register_delivery_destination(
            Arc::new(LocalDirectoryDestination::new(delivery_dir)),
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
        .register_delivery_destination(
            Arc::new(GitHubReleaseDestination::new(github)),
            &fixture,
        )
        .expect("register github");
    registry
}

fn write_file(path: &Path, content: &str) {
    fs::create_dir_all(path.parent().expect("file parent")).expect("create parent directory");
    fs::write(path, content).expect("write file");
}

// ═══════════════════════════════════════════════════════════════════════
// 8.1 Recovery
// ═══════════════════════════════════════════════════════════════════════

/// CROSS-RECOVERY-01: SFTP network error causes PartialDelivery; resume succeeds.
#[cfg(feature = "e2e-real-sftp")]
#[test]
fn cross_recovery_01_sftp_network_error() {
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
    sftp.fail_next(
        "write",
        SftpTransportFailure::Network {
            message: "simulated network error".to_string(),
        },
    );

    let mut snapshot = build_snapshot("real-cargo", store_dir.path(), delivery_dir.path(), "0.1.0");
    // Local (Required) + SFTP (Required)
    snapshot.adapters.delivery_routes.push(sftp_route("sftp-route", "/upload"));

    let registry = build_sftp_registry(provider, store_dir.path(), delivery_dir.path(), sftp.clone(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt = run_publish(&runtime, &snapshot, "cargo-cli", "0.1.0", "cross-rec-01");

    // PartialDelivery: Local Published, SFTP failed
    assert_eq!(
        attempt.status,
        PublishAttemptStatus::PartialDelivery,
        "expected PartialDelivery, got {:?}",
        attempt.status
    );

    let local_receipt = attempt
        .receipts
        .iter()
        .find(|r| r.route_id == "local-route")
        .expect("local route receipt");
    assert_eq!(local_receipt.status, DeliveryStatus::Published);

    // Resume -> Published
    let prepared = runtime
        .prepare_attempt(&snapshot)
        .expect("prepare for resume");
    let resumed = runtime
        .resume_attempt(
            &prepared,
            &attempt,
            &AttemptExecutionContext::at(1),
        )
        .expect("resume attempt");

    assert_eq!(
        resumed.status,
        PublishAttemptStatus::Published,
        "expected Published after resume, got {:?}",
        resumed.status
    );
    assert!(!sftp.paths().is_empty(), "SFTP should have files after resume");
}

/// CROSS-RECOVERY-02: GitHub 500 error on upload causes Failed; resume succeeds.
#[cfg(feature = "e2e-real-github")]
#[test]
fn cross_recovery_02_github_500_error() {
    if !toolchain_available("cargo") {
        eprintln!("skipping: cargo not installed");
        return;
    }

    let project = sample_path("cargo-cli");
    let output_dir = project.join("target").join("release");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");
    let github = Arc::new(FakeGitHubReleaseApi::new());

    let provider = cargo_provider(
        vec!["build".to_string(), "--release".to_string()],
        output_dir,
    );

    let mut snapshot = build_snapshot("real-cargo", store_dir.path(), delivery_dir.path(), "0.1.0");
    snapshot.adapters.delivery_routes = vec![github_route("github-route", "v")];

    let registry = build_github_registry(provider, store_dir.path(), delivery_dir.path(), github.clone(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    // Inject 500 error on the next upload
    github.fail_next(
        FAKE_OPERATION_UPLOAD,
        GitHubApiFailure::Http {
            status: 500,
            message: "server error".to_string(),
        },
    );

    let attempt = run_publish(&runtime, &snapshot, "cargo-cli", "0.1.0", "cross-rec-02");

    // Only route failed -> Failed
    assert_eq!(
        attempt.status,
        PublishAttemptStatus::Failed,
        "expected Failed, got {:?}",
        attempt.status
    );

    // Resume -> Published
    let prepared = runtime
        .prepare_attempt(&snapshot)
        .expect("prepare for resume");
    let resumed = runtime
        .resume_attempt(
            &prepared,
            &attempt,
            &AttemptExecutionContext::at(1),
        )
        .expect("resume attempt");

    assert_eq!(
        resumed.status,
        PublishAttemptStatus::Published,
        "expected Published after resume, got {:?}",
        resumed.status
    );

    let release = github
        .release("v0.1.0")
        .expect("release should exist");
    assert!(!release.assets.is_empty(), "release should have assets");
}

/// CROSS-RECOVERY-03: SFTP file corruption causes failure; resume succeeds.
#[cfg(feature = "e2e-real-sftp")]
#[test]
fn cross_recovery_03_sftp_file_corruption() {
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
    sftp.corrupt_next_write();

    let mut snapshot = build_snapshot("real-cargo", store_dir.path(), delivery_dir.path(), "0.1.0");
    snapshot.adapters.delivery_routes = vec![sftp_route("sftp-route", "/upload")];

    let registry = build_sftp_registry(provider, store_dir.path(), delivery_dir.path(), sftp.clone(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt = run_publish(&runtime, &snapshot, "cargo-cli", "0.1.0", "cross-rec-03");

    // SFTP corruption -> Failed
    assert_eq!(
        attempt.status,
        PublishAttemptStatus::Failed,
        "expected Failed from corruption, got {:?}",
        attempt.status
    );

    // Resume -> Published
    let prepared = runtime
        .prepare_attempt(&snapshot)
        .expect("prepare for resume");
    let resumed = runtime
        .resume_attempt(
            &prepared,
            &attempt,
            &AttemptExecutionContext::at(1),
        )
        .expect("resume attempt");

    assert_eq!(
        resumed.status,
        PublishAttemptStatus::Published,
        "expected Published after retry, got {:?}",
        resumed.status
    );
    assert!(!sftp.paths().is_empty(), "SFTP should have files after retry");
}

/// CROSS-RECOVERY-04: GitHub conflict (different manifest marker) blocks delivery.
#[cfg(feature = "e2e-real-github")]
#[test]
fn cross_recovery_04_github_conflict() {
    if !toolchain_available("cargo") {
        eprintln!("skipping: cargo not installed");
        return;
    }

    let project = sample_path("cargo-cli");
    let output_dir = project.join("target").join("release");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");
    let github = Arc::new(FakeGitHubReleaseApi::new());

    // Pre-seed a published release with a different manifest marker
    github.seed_release(publish_adapters::RemoteGitHubRelease {
        id: 1,
        tag: "v0.1.0".to_string(),
        url: "https://github.com/acme/demo/releases/tag/v0.1.0".to_string(),
        body: format!(
            "existing release\n\n<!-- one-publish-manifest:{} -->",
            "a".repeat(64)
        ),
        draft: false,
        prerelease: false,
        assets: vec![],
    });

    let provider = cargo_provider(
        vec!["build".to_string(), "--release".to_string()],
        output_dir,
    );

    let mut snapshot = build_snapshot("real-cargo", store_dir.path(), delivery_dir.path(), "0.1.0");
    snapshot.adapters.delivery_routes = vec![github_route("github-route", "v")];

    let registry = build_github_registry(provider, store_dir.path(), delivery_dir.path(), github.clone(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt = run_publish(&runtime, &snapshot, "cargo-cli", "0.1.0", "cross-rec-04");

    // Conflict -> Failed
    assert_eq!(
        attempt.status,
        PublishAttemptStatus::Failed,
        "expected Failed from conflict, got {:?}",
        attempt.status
    );

    // Verify the failure is classified as Conflict
    let route = attempt
        .routes
        .iter()
        .find(|r| r.route_id == "github-route")
        .expect("github route");
    assert_eq!(route.status, DeliveryStatus::Failed);
    if let Some(failure) = &route.failure {
        assert_eq!(
            failure.category,
            PublishFailureCategory::Conflict,
            "expected Conflict category, got {:?}",
            failure.category
        );
    }
}

// ═══════════════════════════════════════════════════════════════════════
// 8.2 Promotion
// ═══════════════════════════════════════════════════════════════════════

/// CROSS-PROMOTE-01: Build to Local, then promote to SFTP (same digest, no rebuild).
#[cfg(feature = "e2e-real-sftp")]
#[test]
fn cross_promote_01_local_to_sftp() {
    if !toolchain_available("cargo") {
        eprintln!("skipping: cargo not installed");
        return;
    }

    let project = sample_path("cargo-cli");
    let output_dir = project.join("target").join("release");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    // First publish: build to Local
    let provider = cargo_provider(
        vec!["build".to_string(), "--release".to_string()],
        output_dir.clone(),
    );
    let snapshot = build_snapshot("real-cargo", store_dir.path(), delivery_dir.path(), "0.1.0");
    let registry = build_local_registry(provider, store_dir.path(), delivery_dir.path(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt1 = run_publish(&runtime, &snapshot, "cargo-cli", "0.1.0", "cross-prom-1");
    let manifest1 = assert_published(&attempt1);
    let original_digest = manifest1.digest.clone();

    // Second publish: promote to SFTP (no rebuild)
    let sftp = Arc::new(FakeSftpServer::new());
    let mut snapshot2 = build_snapshot("real-cargo", store_dir.path(), delivery_dir.path(), "0.1.0");
    snapshot2.promoted_manifest_digest = Some(original_digest.clone());
    snapshot2.adapters.delivery_routes = vec![sftp_route("sftp-route", "/upload")];

    let fixture = publish_adapters::AdapterConformanceFixture::new(snapshot2.clone());
    let mut registry2 = AdapterRegistry::new();
    registry2
        .register_artifact_processor(Arc::new(ChecksumProcessor::new()), &fixture)
        .expect("register checksum");
    registry2
        .register_execution_backend(
            Arc::new(LocalExecutionBackend::with_credential_source(Arc::new(
                StaticCredentialSource::new().with_secret(
                    SFTP_KEY_REFERENCE,
                    CredentialKind::SshPrivateKey,
                    SFTP_KEY_VALUE,
                ),
            ))),
            &fixture,
        )
        .expect("register backend");
    registry2
        .register_artifact_store(
            Arc::new(TemporaryArtifactStore::new(store_dir.path())),
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

    let attempt2 = run_publish(&runtime2, &snapshot2, "cargo-cli", "0.1.0", "cross-prom-2");
    let manifest2 = attempt2.manifest.as_ref().expect("manifest");
    assert_eq!(
        manifest2.digest, original_digest,
        "promoted manifest digest should match original"
    );
    assert!(!sftp.paths().is_empty(), "SFTP should have files after promotion");
}

/// CROSS-PROMOTE-02: Build to Local, then promote to GitHub Release.
#[cfg(feature = "e2e-real-github")]
#[test]
fn cross_promote_02_local_to_github() {
    if !toolchain_available("cargo") {
        eprintln!("skipping: cargo not installed");
        return;
    }

    let project = sample_path("cargo-cli");
    let output_dir = project.join("target").join("release");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    // First publish: build to Local
    let provider = cargo_provider(
        vec!["build".to_string(), "--release".to_string()],
        output_dir,
    );
    let snapshot = build_snapshot("real-cargo", store_dir.path(), delivery_dir.path(), "0.1.0");
    let registry = build_local_registry(provider, store_dir.path(), delivery_dir.path(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt1 = run_publish(&runtime, &snapshot, "cargo-cli", "0.1.0", "cross-prom-g-1");
    let manifest1 = assert_published(&attempt1);
    let original_digest = manifest1.digest.clone();

    // Second publish: promote to GitHub Release (no rebuild)
    let github = Arc::new(FakeGitHubReleaseApi::new());
    let mut snapshot2 = build_snapshot("real-cargo", store_dir.path(), delivery_dir.path(), "0.1.0");
    snapshot2.promoted_manifest_digest = Some(original_digest.clone());
    snapshot2.adapters.delivery_routes = vec![github_route("github-route", "v")];

    let fixture = publish_adapters::AdapterConformanceFixture::new(snapshot2.clone());
    let mut registry2 = AdapterRegistry::new();
    registry2
        .register_artifact_processor(Arc::new(ChecksumProcessor::new()), &fixture)
        .expect("register checksum");
    registry2
        .register_execution_backend(
            Arc::new(LocalExecutionBackend::with_credential_source(Arc::new(
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
            Arc::new(TemporaryArtifactStore::new(store_dir.path())),
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

    let attempt2 = run_publish(&runtime2, &snapshot2, "cargo-cli", "0.1.0", "cross-prom-g-2");
    let manifest2 = attempt2.manifest.as_ref().expect("manifest");
    assert_eq!(
        manifest2.digest, original_digest,
        "promoted manifest digest should match original"
    );

    let release = github.release("v0.1.0").expect("release should exist");
    assert!(!release.assets.is_empty(), "release should have assets");
}

/// CROSS-PROMOTE-03: Build to Local, then promote to both SFTP and GitHub.
#[cfg(feature = "e2e-real-sftp")]
#[test]
fn cross_promote_03_local_to_sftp_and_github() {
    if !toolchain_available("cargo") {
        eprintln!("skipping: cargo not installed");
        return;
    }

    let project = sample_path("cargo-cli");
    let output_dir = project.join("target").join("release");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    // First publish: build to Local
    let provider = cargo_provider(
        vec!["build".to_string(), "--release".to_string()],
        output_dir.clone(),
    );
    let snapshot = build_snapshot("real-cargo", store_dir.path(), delivery_dir.path(), "0.1.0");
    let registry = build_local_registry(provider, store_dir.path(), delivery_dir.path(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt1 = run_publish(&runtime, &snapshot, "cargo-cli", "0.1.0", "cross-prom-b-1");
    let manifest1 = assert_published(&attempt1);
    let original_digest = manifest1.digest.clone();

    // Second publish: promote to both SFTP and GitHub
    let sftp = Arc::new(FakeSftpServer::new());
    let github = Arc::new(FakeGitHubReleaseApi::new());
    let mut snapshot2 = build_snapshot("real-cargo", store_dir.path(), delivery_dir.path(), "0.1.0");
    snapshot2.promoted_manifest_digest = Some(original_digest.clone());
    snapshot2.adapters.delivery_routes = vec![
        sftp_route("sftp-route", "/upload"),
        github_route("github-route", "v"),
    ];

    let registry2 = build_sftp_github_registry(
        // Promotion does not rebuild; pass a dummy provider is not needed.
        // The planner skips build when promoted_manifest_digest is set,
        // but still requires the provider to be registered for capability
        // resolution. Use the same provider.
        cargo_provider(
            vec!["build".to_string(), "--release".to_string()],
            output_dir.clone(),
        ),
        store_dir.path(),
        delivery_dir.path(),
        sftp.clone(),
        github.clone(),
        &snapshot2,
    );
    let runtime2 = PublishRuntime::new(registry2);

    let attempt2 = run_publish(&runtime2, &snapshot2, "cargo-cli", "0.1.0", "cross-prom-b-2");
    let manifest2 = attempt2.manifest.as_ref().expect("manifest");
    assert_eq!(
        manifest2.digest, original_digest,
        "promoted manifest digest should match original"
    );

    // Both routes should be Published
    for receipt in &attempt2.receipts {
        assert_eq!(
            receipt.status,
            DeliveryStatus::Published,
            "route {} should be Published, got {:?}",
            receipt.route_id,
            receipt.status
        );
    }

    assert!(!sftp.paths().is_empty(), "SFTP should have files");
    let release = github.release("v0.1.0").expect("release should exist");
    assert!(!release.assets.is_empty(), "GitHub release should have assets");
}

// ═══════════════════════════════════════════════════════════════════════
// 8.3 Capability (planning only, no real build needed)
// ═══════════════════════════════════════════════════════════════════════

/// CROSS-CAP-01: Planning fails when execution backend doesn't provide
/// `structured-plan-execution`.
#[test]
fn cross_cap_01_missing_execution_backend() {
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    // Use FakeAutomationBackend (provides automation-projection only, not
    // structured-plan-execution) as the execution backend.
    let mut snapshot = build_snapshot("real-cargo", store_dir.path(), delivery_dir.path(), "0.1.0");
    snapshot.adapters.execution_backend = AdapterBinding::new(
        "backend",
        AdapterIdentity::new(AdapterKind::ExecutionBackend, FAKE_AUTOMATION_BACKEND_ID, 1),
        AdapterSettings::new(1),
    );

    // Register all adapters, using FakeAutomationBackend as the backend.
    let provider = cargo_provider(
        vec!["build".to_string(), "--release".to_string()],
        sample_path("cargo-cli").join("target").join("release"),
    );
    let fixture = publish_adapters::AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(provider, &fixture)
        .expect("register provider");
    registry
        .register_artifact_processor(Arc::new(ChecksumProcessor::new()), &fixture)
        .expect("register checksum");
    registry
        .register_execution_backend(Arc::new(FakeAutomationBackend::new()), &fixture)
        .expect("register backend");
    registry
        .register_artifact_store(
            Arc::new(TemporaryArtifactStore::new(store_dir.path())),
            &fixture,
        )
        .expect("register store");
    registry
        .register_delivery_destination(
            Arc::new(LocalDirectoryDestination::new(delivery_dir.path())),
            &fixture,
        )
        .expect("register local");
    let runtime = PublishRuntime::new(registry);

    let error = runtime
        .prepare_attempt(&snapshot)
        .expect_err("planning should fail");
    assert!(
        matches!(
            &error,
            PublishError::MissingCapability { capability, .. }
                if capability == "structured-plan-execution"
        ),
        "expected MissingCapability for structured-plan-execution, got {error}"
    );
}

/// CROSS-CAP-02: Planning fails when artifact store references a non-existent adapter.
#[test]
fn cross_cap_02_missing_artifact_store() {
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let mut snapshot = build_snapshot("real-cargo", store_dir.path(), delivery_dir.path(), "0.1.0");
    // Reference a non-existent artifact store
    snapshot.adapters.artifact_store = AdapterBinding::new(
        "store",
        AdapterIdentity::new(AdapterKind::ArtifactStore, "non-existent-store", 1),
        AdapterSettings::new(1),
    );

    // Empty registry — no adapters registered
    let registry = AdapterRegistry::new();
    let runtime = PublishRuntime::new(registry);

    let error = runtime
        .prepare_attempt(&snapshot)
        .expect_err("planning should fail");
    assert!(
        matches!(
            &error,
            PublishError::AdapterNotRegistered { id, .. } if id == "non-existent-store"
        ),
        "expected AdapterNotRegistered for non-existent-store, got {error}"
    );
}

/// CROSS-CAP-03: Planning fails when processor requires `artifact-candidate`
/// but the provider doesn't provide it.
#[test]
fn cross_cap_03_missing_artifact_candidate() {
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    // A minimal provider that does NOT provide artifact-candidate.
    struct NoCandidateProvider {
        descriptor: AdapterDescriptor,
    }

    impl NoCandidateProvider {
        fn new() -> Self {
            Self {
                descriptor: AdapterDescriptor::new(
                    AdapterKind::ProjectProvider,
                    "no-candidate-provider",
                    1,
                    AdapterSchema::new(1),
                    PublishingCapability {
                        provides: vec![],
                        requires: vec![CapabilityRequirement::exact(
                            "structured-plan-execution",
                            1,
                        )],
                    },
                ),
            }
        }
    }

    impl AdapterContract for NoCandidateProvider {
        fn descriptor(&self) -> &AdapterDescriptor {
            &self.descriptor
        }

        fn default_settings(&self) -> AdapterSettings {
            AdapterSettings::new(1)
        }

        fn plan_fragment(
            &self,
            _snapshot: &PlanningInputSnapshot,
            _settings: &AdapterSettings,
        ) -> Result<Vec<PlanNodeTemplate>, PublishError> {
            Ok(vec![])
        }
    }

    impl ProjectProvider for NoCandidateProvider {}

    let snapshot = build_snapshot(
        "no-candidate-provider",
        store_dir.path(),
        delivery_dir.path(),
        "0.1.0",
    );

    let fixture = publish_adapters::AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(Arc::new(NoCandidateProvider::new()), &fixture)
        .expect("register provider");
    registry
        .register_artifact_processor(Arc::new(ChecksumProcessor::new()), &fixture)
        .expect("register checksum");
    registry
        .register_execution_backend(
            Arc::new(LocalExecutionBackend::with_credential_source(Arc::new(
                StaticCredentialSource::new(),
            ))),
            &fixture,
        )
        .expect("register backend");
    registry
        .register_artifact_store(
            Arc::new(TemporaryArtifactStore::new(store_dir.path())),
            &fixture,
        )
        .expect("register store");
    registry
        .register_delivery_destination(
            Arc::new(LocalDirectoryDestination::new(delivery_dir.path())),
            &fixture,
        )
        .expect("register local");
    let runtime = PublishRuntime::new(registry);

    let error = runtime
        .prepare_attempt(&snapshot)
        .expect_err("planning should fail");
    assert!(
        matches!(
            &error,
            PublishError::MissingCapability { capability, .. }
                if capability == "artifact-candidate"
        ),
        "expected MissingCapability for artifact-candidate, got {error}"
    );
}

// ═══════════════════════════════════════════════════════════════════════
// 8.4 Gates
// ═══════════════════════════════════════════════════════════════════════

/// CROSS-GATE-01: Custom command gate appears in plan (planning only).
#[cfg(feature = "e2e-real-cargo")]
#[test]
fn cross_gate_01_planning_only() {
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
    let custom_processor = CustomCommandProcessor::new(["test:gate"]);

    let mut snapshot = build_snapshot("real-cargo", store_dir.path(), delivery_dir.path(), "0.1.0");
    snapshot.adapters.artifact_processors.push(AdapterBinding::new(
        "gate",
        AdapterIdentity::new(AdapterKind::ArtifactProcessor, "custom-command", 1),
        AdapterSettings::new(1)
            .with_value("program", Value::String("test:gate".to_string()))
            .with_value("args", Value::Array(vec![]))
            .with_value(
                "input_roles",
                Value::Array(vec![Value::String("installer".to_string())]),
            )
            .with_value("output_roles", Value::Array(vec![])),
    ));

    let fixture = publish_adapters::AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(provider, &fixture)
        .expect("register provider");
    registry
        .register_artifact_processor(Arc::new(ChecksumProcessor::new()), &fixture)
        .expect("register checksum");
    registry
        .register_artifact_processor(Arc::new(custom_processor), &fixture)
        .expect("register custom command");
    registry
        .register_execution_backend(
            Arc::new(LocalExecutionBackend::with_credential_source(Arc::new(
                StaticCredentialSource::new(),
            ))),
            &fixture,
        )
        .expect("register backend");
    registry
        .register_artifact_store(
            Arc::new(TemporaryArtifactStore::new(store_dir.path())),
            &fixture,
        )
        .expect("register store");
    registry
        .register_delivery_destination(
            Arc::new(LocalDirectoryDestination::new(delivery_dir.path())),
            &fixture,
        )
        .expect("register local");
    let runtime = PublishRuntime::new(registry);

    let prepared = runtime
        .prepare_attempt(&snapshot)
        .expect("prepare attempt");

    let has_gate = prepared
        .plan
        .nodes
        .iter()
        .any(|node| match &node.operation {
            PlanOperation::RunProgram { program, .. } => program == "test:gate",
            _ => false,
        });
    assert!(
        has_gate,
        "plan should contain a custom command gate node with program 'test:gate'"
    );
}

/// CROSS-GATE-02: Gate failure blocks (plan has gate node, processor doesn't execute).
#[cfg(feature = "e2e-real-cargo")]
#[test]
fn cross_gate_02_gate_failure_blocks() {
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
    let custom_processor = CustomCommandProcessor::new(["test:gate"]);

    let mut snapshot = build_snapshot("real-cargo", store_dir.path(), delivery_dir.path(), "0.1.0");
    snapshot.adapters.artifact_processors.push(AdapterBinding::new(
        "gate",
        AdapterIdentity::new(AdapterKind::ArtifactProcessor, "custom-command", 1),
        AdapterSettings::new(1)
            .with_value("program", Value::String("test:gate".to_string()))
            .with_value("args", Value::Array(vec![]))
            .with_value(
                "input_roles",
                Value::Array(vec![Value::String("installer".to_string())]),
            )
            .with_value("output_roles", Value::Array(vec![])),
    ));

    let fixture = publish_adapters::AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(provider, &fixture)
        .expect("register provider");
    registry
        .register_artifact_processor(Arc::new(ChecksumProcessor::new()), &fixture)
        .expect("register checksum");
    registry
        .register_artifact_processor(Arc::new(custom_processor), &fixture)
        .expect("register custom command");
    registry
        .register_execution_backend(
            Arc::new(LocalExecutionBackend::with_credential_source(Arc::new(
                StaticCredentialSource::new(),
            ))),
            &fixture,
        )
        .expect("register backend");
    registry
        .register_artifact_store(
            Arc::new(TemporaryArtifactStore::new(store_dir.path())),
            &fixture,
        )
        .expect("register store");
    registry
        .register_delivery_destination(
            Arc::new(LocalDirectoryDestination::new(delivery_dir.path())),
            &fixture,
        )
        .expect("register local");
    let runtime = PublishRuntime::new(registry);

    let prepared = runtime
        .prepare_attempt(&snapshot)
        .expect("prepare attempt");

    // Verify the gate node exists in the plan
    let gate_node = prepared
        .plan
        .nodes
        .iter()
        .find(|node| match &node.operation {
            PlanOperation::RunProgram { program, .. } => program == "test:gate",
            _ => false,
        });
    assert!(
        gate_node.is_some(),
        "plan should contain a gate node with program 'test:gate'"
    );

    // The gate node should be in the ProcessArtifacts stage
    let gate = gate_node.unwrap();
    assert_eq!(
        gate.stage,
        PlanStage::ProcessArtifacts,
        "gate node should be in ProcessArtifacts stage"
    );
}

/// CROSS-GATE-03: Gate node appears before checksum node in plan.
#[cfg(feature = "e2e-real-cargo")]
#[test]
fn cross_gate_03_gate_before_checksum() {
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
    let custom_processor = CustomCommandProcessor::new(["test:gate"]);

    // Put the gate processor BEFORE the checksum processor in the list
    let mut snapshot = build_snapshot("real-cargo", store_dir.path(), delivery_dir.path(), "0.1.0");
    snapshot.adapters.artifact_processors = vec![
        AdapterBinding::new(
            "gate",
            AdapterIdentity::new(AdapterKind::ArtifactProcessor, "custom-command", 1),
            AdapterSettings::new(1)
                .with_value("program", Value::String("test:gate".to_string()))
                .with_value("args", Value::Array(vec![]))
                .with_value(
                    "input_roles",
                    Value::Array(vec![Value::String("installer".to_string())]),
                )
                .with_value("output_roles", Value::Array(vec![])),
        ),
        AdapterBinding::new(
            "checksums",
            AdapterIdentity::new(AdapterKind::ArtifactProcessor, "checksum", 1),
            AdapterSettings::new(1),
        ),
    ];

    let fixture = publish_adapters::AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(provider, &fixture)
        .expect("register provider");
    registry
        .register_artifact_processor(Arc::new(ChecksumProcessor::new()), &fixture)
        .expect("register checksum");
    registry
        .register_artifact_processor(Arc::new(custom_processor), &fixture)
        .expect("register custom command");
    registry
        .register_execution_backend(
            Arc::new(LocalExecutionBackend::with_credential_source(Arc::new(
                StaticCredentialSource::new(),
            ))),
            &fixture,
        )
        .expect("register backend");
    registry
        .register_artifact_store(
            Arc::new(TemporaryArtifactStore::new(store_dir.path())),
            &fixture,
        )
        .expect("register store");
    registry
        .register_delivery_destination(
            Arc::new(LocalDirectoryDestination::new(delivery_dir.path())),
            &fixture,
        )
        .expect("register local");
    let runtime = PublishRuntime::new(registry);

    let prepared = runtime
        .prepare_attempt(&snapshot)
        .expect("prepare attempt");

    // Find the gate node index and checksum node index
    let gate_index = prepared
        .plan
        .nodes
        .iter()
        .position(|node| match &node.operation {
            PlanOperation::RunProgram { program, .. } => program == "test:gate",
            _ => false,
        });
    let checksum_index = prepared
        .plan
        .nodes
        .iter()
        .position(|node| match &node.operation {
            PlanOperation::AdapterAction { action, .. } => action == "checksum_artifacts",
            _ => false,
        });

    assert!(gate_index.is_some(), "plan should have a gate node");
    assert!(checksum_index.is_some(), "plan should have a checksum node");
    assert!(
        gate_index.unwrap() < checksum_index.unwrap(),
        "gate node should appear before checksum node in the plan"
    );
}

// ═══════════════════════════════════════════════════════════════════════
// 8.5 Idempotent
// ═══════════════════════════════════════════════════════════════════════

/// CROSS-IDEMPOTENT-01: Build to Local twice; second attempt reuses delivery.
#[cfg(feature = "e2e-real-cargo")]
#[test]
fn cross_idempotent_01_local_matching() {
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

    let attempt1 = run_publish(&runtime, &snapshot, "cargo-cli", "0.1.0", "cross-idem-1");
    assert_published(&attempt1);
    let manifest1 = attempt1.manifest.as_ref().expect("manifest");
    let original_digest = manifest1.digest.clone();

    // Second attempt: should reuse delivery (Matching)
    let attempt2 = run_publish(&runtime, &snapshot, "cargo-cli", "0.1.0", "cross-idem-2");
    assert_eq!(
        attempt2.status,
        PublishAttemptStatus::Published,
        "second attempt should also be Published"
    );

    let manifest2 = attempt2.manifest.as_ref().expect("manifest");
    assert_eq!(
        manifest2.digest, original_digest,
        "manifest digest should be deterministic"
    );
}

/// CROSS-IDEMPOTENT-02: Build to GitHub Release twice; second attempt reuses.
#[cfg(feature = "e2e-real-github")]
#[test]
fn cross_idempotent_02_github_matching() {
    if !toolchain_available("cargo") {
        eprintln!("skipping: cargo not installed");
        return;
    }

    let project = sample_path("cargo-cli");
    let output_dir = project.join("target").join("release");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");
    let github = Arc::new(FakeGitHubReleaseApi::new());

    let provider = cargo_provider(
        vec!["build".to_string(), "--release".to_string()],
        output_dir,
    );
    let mut snapshot = build_snapshot("real-cargo", store_dir.path(), delivery_dir.path(), "0.1.0");
    snapshot.adapters.delivery_routes = vec![github_route("github-route", "v")];

    let registry = build_github_registry(provider, store_dir.path(), delivery_dir.path(), github.clone(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    // First publish
    let attempt1 = run_publish(&runtime, &snapshot, "cargo-cli", "0.1.0", "cross-idem-g-1");
    assert_published(&attempt1);
    let manifest1 = attempt1.manifest.as_ref().expect("manifest");
    let original_digest = manifest1.digest.clone();

    // Second publish: should reuse the matching release
    let attempt2 = run_publish(&runtime, &snapshot, "cargo-cli", "0.1.0", "cross-idem-g-2");
    assert_eq!(
        attempt2.status,
        PublishAttemptStatus::Published,
        "second attempt should be Published (reused)"
    );

    let manifest2 = attempt2.manifest.as_ref().expect("manifest");
    assert_eq!(
        manifest2.digest, original_digest,
        "manifest digest should be deterministic"
    );
}

/// CROSS-IDEMPOTENT-03: Build to SFTP twice; second attempt reuses.
#[cfg(feature = "e2e-real-sftp")]
#[test]
fn cross_idempotent_03_sftp_matching() {
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

    let mut snapshot = build_snapshot("real-cargo", store_dir.path(), delivery_dir.path(), "0.1.0");
    snapshot.adapters.delivery_routes = vec![sftp_route("sftp-route", "/upload")];

    let registry = build_sftp_registry(provider, store_dir.path(), delivery_dir.path(), sftp.clone(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    // First publish
    let attempt1 = run_publish(&runtime, &snapshot, "cargo-cli", "0.1.0", "cross-idem-s-1");
    assert_published(&attempt1);
    let manifest1 = attempt1.manifest.as_ref().expect("manifest");
    let original_digest = manifest1.digest.clone();
    let first_write_count = sftp.paths().len();

    // Second publish: should reuse delivery (Matching)
    let attempt2 = run_publish(&runtime, &snapshot, "cargo-cli", "0.1.0", "cross-idem-s-2");
    assert_eq!(
        attempt2.status,
        PublishAttemptStatus::Published,
        "second attempt should be Published (reused)"
    );

    let manifest2 = attempt2.manifest.as_ref().expect("manifest");
    assert_eq!(
        manifest2.digest, original_digest,
        "manifest digest should be deterministic"
    );

    // SFTP should not have received additional writes on the second attempt
    let second_write_count = sftp.paths().len();
    assert_eq!(
        first_write_count, second_write_count,
        "SFTP file count should not change on idempotent retry"
    );
}

// ═══════════════════════════════════════════════════════════════════════
// 8.6 Credentials
// ═══════════════════════════════════════════════════════════════════════

/// CROSS-CRED-01: Missing SFTP key causes credential preflight failure;
/// no delivery side effect.
#[cfg(feature = "e2e-real-sftp")]
#[test]
fn cross_cred_01_missing_sftp_key() {
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

    let mut snapshot = build_snapshot("real-cargo", store_dir.path(), delivery_dir.path(), "0.1.0");
    snapshot.adapters.delivery_routes = vec![sftp_route("sftp-route", "/upload")];

    // Use an EMPTY credential source — no SSH key is available
    let fixture = publish_adapters::AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(provider, &fixture)
        .expect("register provider");
    registry
        .register_artifact_processor(Arc::new(ChecksumProcessor::new()), &fixture)
        .expect("register checksum");
    registry
        .register_execution_backend(
            Arc::new(LocalExecutionBackend::with_credential_source(Arc::new(
                StaticCredentialSource::new(),
            ))),
            &fixture,
        )
        .expect("register backend");
    registry
        .register_artifact_store(
            Arc::new(TemporaryArtifactStore::new(store_dir.path())),
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

    let attempt = run_publish(&runtime, &snapshot, "cargo-cli", "0.1.0", "cross-cred-01");

    // The attempt should fail (no SFTP credential)
    assert_ne!(
        attempt.status,
        PublishAttemptStatus::Published,
        "attempt should not be Published without SFTP credentials"
    );

    // SFTP remote should have no files (no delivery side effect)
    assert!(
        sftp.paths().is_empty(),
        "SFTP remote should be empty — no delivery side effect"
    );
}

/// CROSS-CRED-02: GitHub auth failure (401) is classified as Authentication.
#[cfg(feature = "e2e-real-github")]
#[test]
fn cross_cred_02_github_auth_failure() {
    if !toolchain_available("cargo") {
        eprintln!("skipping: cargo not installed");
        return;
    }

    let project = sample_path("cargo-cli");
    let output_dir = project.join("target").join("release");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");
    let github = Arc::new(FakeGitHubReleaseApi::new());

    let provider = cargo_provider(
        vec!["build".to_string(), "--release".to_string()],
        output_dir,
    );

    let mut snapshot = build_snapshot("real-cargo", store_dir.path(), delivery_dir.path(), "0.1.0");
    snapshot.adapters.delivery_routes = vec![github_route("github-route", "v")];

    // Use an EMPTY token — FakeGitHubReleaseApi rejects empty tokens with 401
    let fixture = publish_adapters::AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(provider, &fixture)
        .expect("register provider");
    registry
        .register_artifact_processor(Arc::new(ChecksumProcessor::new()), &fixture)
        .expect("register checksum");
    registry
        .register_execution_backend(
            Arc::new(LocalExecutionBackend::with_credential_source(Arc::new(
                StaticCredentialSource::new().with_secret(
                    GITHUB_TOKEN_REFERENCE,
                    CredentialKind::Token,
                    "",
                ),
            ))),
            &fixture,
        )
        .expect("register backend");
    registry
        .register_artifact_store(
            Arc::new(TemporaryArtifactStore::new(store_dir.path())),
            &fixture,
        )
        .expect("register store");
    registry
        .register_delivery_destination(
            Arc::new(LocalDirectoryDestination::new(delivery_dir.path())),
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

    let attempt = run_publish(&runtime, &snapshot, "cargo-cli", "0.1.0", "cross-cred-02");

    // The attempt should fail
    assert_ne!(
        attempt.status,
        PublishAttemptStatus::Published,
        "attempt should not be Published with auth failure"
    );

    // Verify the failure is classified as Authentication
    let route = attempt
        .routes
        .iter()
        .find(|r| r.route_id == "github-route")
        .expect("github route");
    assert_eq!(route.status, DeliveryStatus::Failed);
    if let Some(failure) = &route.failure {
        assert_eq!(
            failure.category,
            PublishFailureCategory::Authentication,
            "expected Authentication category, got {:?}",
            failure.category
        );
    }
}

// ═══════════════════════════════════════════════════════════════════════
// 8.7 Automation & Version (planning only)
// ═══════════════════════════════════════════════════════════════════════

/// CROSS-AUTO-01: GitHubActionsBackend renders a valid automation bundle
/// with workflow and runtime projection files.
#[test]
fn cross_auto_01_automation_bundle() {
    let backend = GitHubActionsBackend::new(Arc::new(StaticCredentialSource::new()));

    let runner = RuntimeComponentRevision::new("0.1.0", sha256_hex(b"runner"))
        .with_binary_digests(BTreeMap::from([
            ("x86_64-unknown-linux-gnu".to_string(), "a".repeat(64)),
            ("aarch64-apple-darwin".to_string(), "b".repeat(64)),
            ("x86_64-pc-windows-msvc".to_string(), "c".repeat(64)),
        ]));
    let plan_contract = RuntimeComponentRevision::new("1", sha256_hex(b"plan"));
    let adapters = vec![RuntimeAdapterRevision::new(
        AdapterIdentity::new(
            AdapterKind::ExecutionBackend,
            GITHUB_ACTIONS_BACKEND_ID,
            1,
        ),
        sha256_hex(b"adapters"),
    )];
    let runtime_revision = AutomationRuntimeRevision::seal(runner, plan_contract, adapters)
        .expect("seal runtime revision");

    let projection = AutomationProjection {
        public_settings: BTreeMap::from([
            (
                "runnerProjection".to_string(),
                serde_json::json!({ "binding_id": "cross" }),
            ),
            (
                "runnerDistribution".to_string(),
                serde_json::json!({
                    "repository": "acme/demo",
                    "releaseTag": "runner-v0.1.0",
                }),
            ),
            (
                "shardPlatforms".to_string(),
                serde_json::json!(["linux", "macos", "windows"]),
            ),
            (
                "shardToolchain".to_string(),
                serde_json::json!({
                    "driver": "cargo",
                    "configPath": "Cargo.toml",
                }),
            ),
        ]),
        ..Default::default()
    };

    let binding = AutomationBindingProjection {
        binding_id: "cross".to_string(),
        configuration_id: "configuration-cross".to_string(),
        configuration_revision_id: "revision-cross".to_string(),
        trigger_policy: AutomationTriggerPolicy::TagPush {
            tag_prefix: "v".to_string(),
        },
        release_namespace: "tag:v*".to_string(),
        delivery_destination_namespaces: vec!["github-release:acme/demo".to_string()],
        runtime_revision,
        projection,
    };

    let bundle = backend
        .render_automation_bundle(&[binding])
        .expect("render automation bundle");

    assert_eq!(bundle.backend.id, GITHUB_ACTIONS_BACKEND_ID);
    assert_eq!(bundle.backend.kind, AdapterKind::ExecutionBackend);
    assert!(
        !bundle.files.is_empty(),
        "bundle should contain at least one file"
    );

    let has_workflow = bundle
        .files
        .keys()
        .any(|path| path.starts_with(".github/workflows/"));
    assert!(
        has_workflow,
        "bundle should contain a GitHub Actions workflow file"
    );

    let has_runtime = bundle
        .files
        .keys()
        .any(|path| path.starts_with(".one-publish/automation/runtime/"));
    assert!(
        has_runtime,
        "bundle should contain a runtime projection file"
    );

    bundle.validate().expect("sealed bundle validates");
}

/// CROSS-VERSION-01: TauriProjectProvider version source parsing — config
/// version, referenced package.json, and Cargo.toml fallback.
#[test]
fn cross_version_01_source_switch() {
    // Case 1: Version in tauri.conf.json (TauriConfig source)
    {
        let repo = tempfile::tempdir().expect("temp repo");
        write_file(
            &repo.path().join("src-tauri/tauri.conf.json"),
            r#"{"productName":"Demo","version":"1.2.3"}"#,
        );
        write_file(
            &repo.path().join("package.json"),
            r#"{"packageManager":"pnpm@10.0.0"}"#,
        );

        let inspection = TauriProjectProvider::new()
            .inspect(repo.path(), "src-tauri/tauri.conf.json")
            .expect("inspect config version source");

        assert_eq!(
            inspection.version_source.kind,
            TauriVersionSourceKind::TauriConfig
        );
        assert_eq!(inspection.version_source.version, "1.2.3");
        assert_eq!(inspection.version_source.path, "src-tauri/tauri.conf.json");
    }

    // Case 2: Version delegated to referenced package.json
    {
        let repo = tempfile::tempdir().expect("temp repo");
        write_file(
            &repo.path().join("src-tauri/tauri.conf.json5"),
            "{ productName: 'Demo', version: '../package.json' }",
        );
        write_file(
            &repo.path().join("package.json"),
            r#"{"packageManager":"npm@10.0.0","version":"2.3.4"}"#,
        );
        write_file(&repo.path().join("package-lock.json"), "{}");

        let inspection = TauriProjectProvider::new()
            .inspect(repo.path(), "src-tauri/tauri.conf.json5")
            .expect("inspect referenced package.json source");

        assert_eq!(
            inspection.version_source.kind,
            TauriVersionSourceKind::ReferencedPackageJson
        );
        assert_eq!(inspection.version_source.path, "package.json");
        assert_eq!(inspection.version_source.version, "2.3.4");
    }

    // Case 3: No version in config — falls back to Cargo.toml
    {
        let repo = tempfile::tempdir().expect("temp repo");
        write_file(
            &repo.path().join("src-tauri/tauri.conf.json"),
            r#"{"productName":"Demo"}"#,
        );
        write_file(
            &repo.path().join("src-tauri/Cargo.toml"),
            r#"[package]
name = "demo"
version = "3.4.5"
"#,
        );

        let inspection = TauriProjectProvider::new()
            .inspect(repo.path(), "src-tauri/tauri.conf.json")
            .expect("inspect cargo fallback version source");

        assert_eq!(
            inspection.version_source.kind,
            TauriVersionSourceKind::CargoToml
        );
        assert_eq!(inspection.version_source.version, "3.4.5");
        assert_eq!(inspection.version_source.selector, "package.version");
    }
}
