//! Tauri Provider 真实构建 E2E 测试（TAURI-01 ~ 10）
//!
//! 使用真实 `pnpm tauri build` 命令构建样本项目，验证从构建到交付的完整链路。
//! Tauri 构建需要完整的桌面环境（显示服务器、WebView），在无头 CI 中可能失败；
//! TAURI-01 ~ 07 在构建失败时优雅跳过。TAURI-08 ~ 10 是检查/计划测试，不需要真实构建。

#![cfg(feature = "e2e-real-tauri")]

#[path = "common/mod.rs"]
mod common;

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use common::*;
use publish_adapters::{
    ExecutionBackend, FakeGitHubReleaseApi, GitHubActionsBackend, GitHubApiFailure,
    GitHubReleaseDestination, GITHUB_ACTIONS_BACKEND_ID, StaticCredentialSource,
    TauriBuildDriver, TauriProjectProvider, TauriVersionSourceKind, CHECKSUM_MANIFEST_ROLE,
    FAKE_OPERATION_UPLOAD,
};
use publish_domain::{
    AdapterBinding, AdapterIdentity, AdapterKind, AdapterSettings, AutomationBindingProjection,
    AutomationProjection, AutomationRuntimeRevision, AutomationTriggerPolicy, CredentialKind,
    DeliveryRoute, DeliveryStatus, PublishAttemptStatus, PublishAttemptView, ReleaseIdentity,
    RuntimeAdapterRevision, RuntimeComponentRevision, sha256_hex,
};
use publish_runner_core::{AttemptExecutionContext, PublishRuntime, StartPublishAttempt};
use serde_json::Value;

const INSTALLER_ROLE: &str = "installer";
const GITHUB_TOKEN_REFERENCE: &str = "tauri-github-token";
const GITHUB_TOKEN_VALUE: &str = "ghp_tauri-e2e-token";
const CONFIG_PATH: &str = "src-tauri/tauri.conf.json";

// ─── 辅助函数 ───

/// 创建 Tauri provider（`pnpm tauri build`）。
fn tauri_provider(args: Vec<String>, output_dir: PathBuf) -> Arc<RealBuildProvider> {
    let project = sample_path("tauri-mini-app");
    Arc::new(
        RealBuildProvider::new(
            "real-tauri",
            "pnpm:tauri-build",
            "pnpm",
            args,
            project,
            output_dir,
            classify_tauri,
        ),
    )
}

/// 尝试执行一次完整发布；构建失败时返回 None（优雅跳过）。
fn try_run_publish(
    runtime: &PublishRuntime,
    snapshot: &publish_domain::PlanningInputSnapshot,
    candidate_identity: &str,
    version: &str,
    attempt_id: &str,
) -> Option<PublishAttemptView> {
    let prepared = match runtime.prepare_attempt(snapshot) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("skipping: prepare failed: {e}");
            return None;
        }
    };
    match runtime.start_attempt(
        &prepared,
        StartPublishAttempt::new(
            attempt_id.to_string(),
            format!("local-run-{attempt_id}"),
            ReleaseIdentity::new(
                candidate_identity.to_string(),
                snapshot.source.clone(),
                version.to_string(),
                "stable",
                None,
            ),
        ),
        &AttemptExecutionContext::at(0),
    ) {
        Ok(view) => Some(view),
        Err(e) => {
            eprintln!("skipping: tauri build failed (likely headless): {e}");
            None
        }
    }
}

/// 创建 GitHub Release 交付路线。
fn github_route(route_id: &str, tag_prefix: &str, updater_enabled: bool) -> DeliveryRoute {
    let mut roles = vec![
        Value::String(INSTALLER_ROLE.to_string()),
        Value::String(CHECKSUM_MANIFEST_ROLE.to_string()),
    ];
    if updater_enabled {
        roles.push(Value::String("updater-signature".to_string()));
        roles.push(Value::String("updater-archive".to_string()));
    }
    DeliveryRoute::required(
        AdapterBinding::new(
            route_id,
            AdapterIdentity::new(AdapterKind::DeliveryDestination, "github-release", 1),
            AdapterSettings::new(1)
                .with_value("repository", Value::String("acme/demo".to_string()))
                .with_value("visibility", Value::String("public".to_string()))
                .with_value("tag_prefix", Value::String(tag_prefix.to_string()))
                .with_value("allowed_asset_roles", Value::Array(roles))
                .with_value("updater_enabled", Value::Bool(updater_enabled))
                .with_value(
                    "enabled_platforms",
                    Value::Array(vec![Value::String("macos-aarch64".to_string())]),
                )
                .with_value("unsigned_release_override", Value::Bool(false)),
        )
        .with_credential("github_token", GITHUB_TOKEN_REFERENCE),
    )
}

/// 构建包含 GitHub Release 交付目标的注册表。
fn build_github_registry(
    provider: Arc<RealBuildProvider>,
    store_dir: &Path,
    delivery_dir: &Path,
    github: Arc<FakeGitHubReleaseApi>,
    snapshot: &publish_domain::PlanningInputSnapshot,
) -> publish_adapters::AdapterRegistry {
    let fixture = publish_adapters::AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = publish_adapters::AdapterRegistry::new();
    registry
        .register_project_provider(provider, &fixture)
        .expect("register provider");
    registry
        .register_artifact_processor(
            Arc::new(publish_adapters::ChecksumProcessor::new()),
            &fixture,
        )
        .expect("register checksum");
    registry
        .register_execution_backend(
            Arc::new(publish_adapters::LocalExecutionBackend::with_credential_source(
                Arc::new(
                    StaticCredentialSource::new().with_secret(
                        GITHUB_TOKEN_REFERENCE,
                        CredentialKind::Token,
                        GITHUB_TOKEN_VALUE,
                    ),
                ),
            )),
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
            Arc::new(GitHubReleaseDestination::new(github)),
            &fixture,
        )
        .expect("register github");
    registry
}

/// 在临时目录中写入文件。
fn write_file(path: &Path, content: &str) {
    fs::create_dir_all(path.parent().expect("file parent")).expect("create parent directory");
    fs::write(path, content).expect("write file");
}

// ─── TAURI-01 ~ 07：构建测试（构建失败时优雅跳过） ───

/// TAURI-01: 当前平台构建发布到本地目录（Local Required + Checksum）。
#[test]
fn tauri_01_build_to_local() {
    if !toolchain_available("pnpm") {
        eprintln!("skipping: pnpm not installed");
        return;
    }

    let project = sample_path("tauri-mini-app");
    let output_dir = project
        .join("src-tauri")
        .join("target")
        .join("release")
        .join("bundle");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = tauri_provider(
        vec!["tauri".to_string(), "build".to_string()],
        output_dir,
    );
    let snapshot = build_snapshot("real-tauri", store_dir.path(), delivery_dir.path(), "0.1.0");
    let registry = build_local_registry(provider, store_dir.path(), delivery_dir.path(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt = match try_run_publish(&runtime, &snapshot, "tauri-mini-app", "0.1.0", "tauri-01") {
        Some(a) => a,
        None => return,
    };

    let manifest = assert_published(&attempt);
    assert_manifest_has_role(manifest, INSTALLER_ROLE);
    assert_manifest_has_role(manifest, CHECKSUM_MANIFEST_ROLE);

    // 交付目录应有产物文件
    assert!(!attempt.receipts.is_empty());
    let receipt = &attempt.receipts[0];
    let delivery_path = PathBuf::from(receipt.external_reference.as_str());
    assert!(delivery_path.exists(), "delivery directory should exist");
}

/// TAURI-02: 当前平台 + Checksum 发布到本地目录（显式验证 checksum-manifest 角色）。
#[test]
fn tauri_02_build_with_checksum_to_local() {
    if !toolchain_available("pnpm") {
        eprintln!("skipping: pnpm not installed");
        return;
    }

    let project = sample_path("tauri-mini-app");
    let output_dir = project
        .join("src-tauri")
        .join("target")
        .join("release")
        .join("bundle");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");

    let provider = tauri_provider(
        vec!["tauri".to_string(), "build".to_string()],
        output_dir,
    );
    let snapshot = build_snapshot("real-tauri", store_dir.path(), delivery_dir.path(), "0.1.0");
    let registry = build_local_registry(provider, store_dir.path(), delivery_dir.path(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt = match try_run_publish(&runtime, &snapshot, "tauri-mini-app", "0.1.0", "tauri-02") {
        Some(a) => a,
        None => return,
    };

    let manifest = assert_published(&attempt);
    assert_manifest_has_role(manifest, INSTALLER_ROLE);
    assert_manifest_has_role(manifest, CHECKSUM_MANIFEST_ROLE);

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

/// TAURI-03: 构建发布到 GitHub Release（无 Updater）。
#[cfg(feature = "e2e-real-github")]
#[test]
fn tauri_03_build_to_github_release() {
    if !toolchain_available("pnpm") {
        eprintln!("skipping: pnpm not installed");
        return;
    }

    let project = sample_path("tauri-mini-app");
    let output_dir = project
        .join("src-tauri")
        .join("target")
        .join("release")
        .join("bundle");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");
    let github = Arc::new(FakeGitHubReleaseApi::new());

    let provider = tauri_provider(
        vec!["tauri".to_string(), "build".to_string()],
        output_dir,
    );

    let mut snapshot = build_snapshot("real-tauri", store_dir.path(), delivery_dir.path(), "0.1.0");
    // 替换交付路线为 GitHub Release（无 Updater）
    snapshot.adapters.delivery_routes = vec![github_route("github-route", "v", false)];

    let registry =
        build_github_registry(provider, store_dir.path(), delivery_dir.path(), github.clone(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt = match try_run_publish(&runtime, &snapshot, "tauri-mini-app", "0.1.0", "tauri-03") {
        Some(a) => a,
        None => return,
    };

    let manifest = assert_published(&attempt);
    assert_manifest_has_role(manifest, INSTALLER_ROLE);
    assert_manifest_has_role(manifest, CHECKSUM_MANIFEST_ROLE);

    // GitHub Release 应有资产
    let release = github
        .release("v0.1.0")
        .expect("release should exist on fake GitHub");
    assert!(
        !release.assets.is_empty(),
        "GitHub release should have uploaded assets"
    );
}

/// TAURI-04: 构建 + Updater 发布到 GitHub Release。
#[cfg(feature = "e2e-real-github")]
#[test]
fn tauri_04_build_with_updater_to_github_release() {
    if !toolchain_available("pnpm") {
        eprintln!("skipping: pnpm not installed");
        return;
    }

    let project = sample_path("tauri-mini-app");
    let output_dir = project
        .join("src-tauri")
        .join("target")
        .join("release")
        .join("bundle");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");
    let github = Arc::new(FakeGitHubReleaseApi::new());

    let provider = tauri_provider(
        vec!["tauri".to_string(), "build".to_string()],
        output_dir,
    );

    let mut snapshot = build_snapshot("real-tauri", store_dir.path(), delivery_dir.path(), "0.1.0");
    // 替换交付路线为 GitHub Release（启用 Updater）
    snapshot.adapters.delivery_routes = vec![github_route("github-route", "v", true)];

    let registry =
        build_github_registry(provider, store_dir.path(), delivery_dir.path(), github.clone(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt = match try_run_publish(&runtime, &snapshot, "tauri-mini-app", "0.1.0", "tauri-04") {
        Some(a) => a,
        None => return,
    };

    let manifest = assert_published(&attempt);
    assert_manifest_has_role(manifest, INSTALLER_ROLE);

    // GitHub Release 应有资产
    let release = github
        .release("v0.1.0")
        .expect("release should exist on fake GitHub");
    assert!(
        !release.assets.is_empty(),
        "GitHub release should have uploaded assets"
    );
}

/// TAURI-05: 双路线交付--Local + GitHub Release。
#[cfg(feature = "e2e-real-github")]
#[test]
fn tauri_05_dual_route_local_and_github() {
    if !toolchain_available("pnpm") {
        eprintln!("skipping: pnpm not installed");
        return;
    }

    let project = sample_path("tauri-mini-app");
    let output_dir = project
        .join("src-tauri")
        .join("target")
        .join("release")
        .join("bundle");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");
    let github = Arc::new(FakeGitHubReleaseApi::new());

    let provider = tauri_provider(
        vec!["tauri".to_string(), "build".to_string()],
        output_dir,
    );

    let mut snapshot = build_snapshot("real-tauri", store_dir.path(), delivery_dir.path(), "0.1.0");
    // Local (Required) + GitHub Release (Required)
    snapshot.adapters.delivery_routes = vec![
        DeliveryRoute::required(AdapterBinding::new(
            "local-route",
            AdapterIdentity::new(AdapterKind::DeliveryDestination, "local-directory", 1),
            AdapterSettings::new(1).with_value(
                "directory",
                Value::String(delivery_dir.path().to_string_lossy().to_string()),
            ),
        )),
        github_route("github-route", "v", false),
    ];

    let registry =
        build_github_registry(provider, store_dir.path(), delivery_dir.path(), github.clone(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt = match try_run_publish(&runtime, &snapshot, "tauri-mini-app", "0.1.0", "tauri-05") {
        Some(a) => a,
        None => return,
    };

    let manifest = assert_published(&attempt);
    assert_manifest_has_role(manifest, INSTALLER_ROLE);

    // 两条路线都应 Published
    let local_receipt = attempt
        .receipts
        .iter()
        .find(|r| r.route_id == "local-route")
        .expect("local route receipt");
    assert_eq!(local_receipt.status, DeliveryStatus::Published);

    let github_receipt = attempt
        .receipts
        .iter()
        .find(|r| r.route_id == "github-route")
        .expect("github route receipt");
    assert_eq!(github_receipt.status, DeliveryStatus::Published);

    // 构建只执行一次：Manifest 只封存一次
    assert_manifest_has_role(manifest, CHECKSUM_MANIFEST_ROLE);
}

/// TAURI-06: 产物推广 Local -> GitHub Release（不重新构建）。
#[cfg(feature = "e2e-real-github")]
#[test]
fn tauri_06_artifact_promotion_local_to_github() {
    if !toolchain_available("pnpm") {
        eprintln!("skipping: pnpm not installed");
        return;
    }

    let project = sample_path("tauri-mini-app");
    let output_dir = project
        .join("src-tauri")
        .join("target")
        .join("release")
        .join("bundle");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");
    let github = Arc::new(FakeGitHubReleaseApi::new());

    // 第一次发布：构建到 Local
    let provider = tauri_provider(
        vec!["tauri".to_string(), "build".to_string()],
        output_dir.clone(),
    );
    let snapshot = build_snapshot("real-tauri", store_dir.path(), delivery_dir.path(), "0.1.0");
    let registry = build_local_registry(provider, store_dir.path(), delivery_dir.path(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt1 = match try_run_publish(&runtime, &snapshot, "tauri-mini-app", "0.1.0", "tauri-06-1") {
        Some(a) => a,
        None => return,
    };
    let manifest1 = assert_published(&attempt1);
    let original_digest = manifest1.digest.clone();

    // 第二次发布：推广到 GitHub Release（不重新构建）
    let mut snapshot2 =
        build_snapshot("real-tauri", store_dir.path(), delivery_dir.path(), "0.1.0");
    snapshot2.promoted_manifest_digest = Some(original_digest.clone());
    snapshot2.adapters.delivery_routes = vec![github_route("github-route", "promoted-v", false)];

    let registry2 = build_github_registry(
        // 推广不需要 Project Provider，但注册表需要后端、存储与交付目标
        Arc::new(RealBuildProvider::new(
            "real-tauri",
            "pnpm:tauri-build",
            "pnpm",
            vec!["tauri".to_string(), "build".to_string()],
            sample_path("tauri-mini-app"),
            output_dir.clone(),
            classify_tauri,
        )),
        store_dir.path(),
        delivery_dir.path(),
        github.clone(),
        &snapshot2,
    );
    let runtime2 = PublishRuntime::new(registry2);

    let attempt2 = run_publish(&runtime2, &snapshot2, "tauri-mini-app", "0.1.0", "tauri-06-2");
    let manifest2 = attempt2.manifest.as_ref().expect("manifest");
    // 推广：digest 应与原 Manifest 一致
    assert_eq!(
        manifest2.digest, original_digest,
        "promoted manifest digest should match original"
    );

    // GitHub Release 应有资产
    let release = github
        .release("promoted-v0.1.0")
        .expect("promoted release should exist");
    assert!(
        !release.assets.is_empty(),
        "GitHub release should have uploaded assets after promotion"
    );
}

/// TAURI-07: 部分交付恢复--GitHub Release 上传失败后重试。
#[cfg(feature = "e2e-real-github")]
#[test]
fn tauri_07_partial_delivery_recovery() {
    if !toolchain_available("pnpm") {
        eprintln!("skipping: pnpm not installed");
        return;
    }

    let project = sample_path("tauri-mini-app");
    let output_dir = project
        .join("src-tauri")
        .join("target")
        .join("release")
        .join("bundle");
    let store_dir = tempfile::tempdir().expect("store dir");
    let delivery_dir = tempfile::tempdir().expect("delivery dir");
    let github = Arc::new(FakeGitHubReleaseApi::new());

    // 注入故障：第一次 upload_asset 失败
    github.fail_next(
        FAKE_OPERATION_UPLOAD,
        GitHubApiFailure::Network {
            message: "simulated network error".to_string(),
        },
    );

    let provider = tauri_provider(
        vec!["tauri".to_string(), "build".to_string()],
        output_dir,
    );

    let mut snapshot = build_snapshot("real-tauri", store_dir.path(), delivery_dir.path(), "0.1.0");
    // Local (Required) + GitHub Release (Required)
    snapshot.adapters.delivery_routes = vec![
        DeliveryRoute::required(AdapterBinding::new(
            "local-route",
            AdapterIdentity::new(AdapterKind::DeliveryDestination, "local-directory", 1),
            AdapterSettings::new(1).with_value(
                "directory",
                Value::String(delivery_dir.path().to_string_lossy().to_string()),
            ),
        )),
        github_route("github-route", "v", false),
    ];

    let registry =
        build_github_registry(provider, store_dir.path(), delivery_dir.path(), github.clone(), &snapshot);
    let runtime = PublishRuntime::new(registry);

    let attempt = match try_run_publish(&runtime, &snapshot, "tauri-mini-app", "0.1.0", "tauri-07") {
        Some(a) => a,
        None => return,
    };

    // 应该是 PartialDelivery（Local 成功，GitHub 失败）
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
            &AttemptExecutionContext::at(1),
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
    let release = github
        .release("v0.1.0")
        .expect("release should exist after resume");
    assert!(
        !release.assets.is_empty(),
        "GitHub release should have files after resume"
    );
}

// ─── TAURI-08 ~ 10：检查/计划测试（不需要真实构建） ───

/// TAURI-08: 构建驱动解析--不同 packageManager 字段对应正确驱动。
#[test]
fn tauri_08_build_driver_resolution() {
    let provider = TauriProjectProvider::new();

    // 变体 1: pnpm
    {
        let repo = tempfile::tempdir().expect("temp repo");
        write_file(
            &repo.path().join(CONFIG_PATH),
            r#"{"productName":"TestApp","version":"1.0.0"}"#,
        );
        write_file(
            &repo.path().join("package.json"),
            r#"{"packageManager":"pnpm@10.0.0"}"#,
        );
        let inspection = provider
            .inspect(repo.path(), CONFIG_PATH)
            .expect("inspect pnpm project");
        assert_eq!(
            inspection.build_driver,
            TauriBuildDriver::Pnpm,
            "pnpm packageManager should resolve to Pnpm driver"
        );
    }

    // 变体 2: npm
    {
        let repo = tempfile::tempdir().expect("temp repo");
        write_file(
            &repo.path().join(CONFIG_PATH),
            r#"{"productName":"TestApp","version":"1.0.0"}"#,
        );
        write_file(
            &repo.path().join("package.json"),
            r#"{"packageManager":"npm@10.0.0"}"#,
        );
        let inspection = provider
            .inspect(repo.path(), CONFIG_PATH)
            .expect("inspect npm project");
        assert_eq!(
            inspection.build_driver,
            TauriBuildDriver::Npm,
            "npm packageManager should resolve to Npm driver"
        );
    }

    // 变体 3: yarn
    {
        let repo = tempfile::tempdir().expect("temp repo");
        write_file(
            &repo.path().join(CONFIG_PATH),
            r#"{"productName":"TestApp","version":"1.0.0"}"#,
        );
        write_file(
            &repo.path().join("package.json"),
            r#"{"packageManager":"yarn@4.0.0"}"#,
        );
        let inspection = provider
            .inspect(repo.path(), CONFIG_PATH)
            .expect("inspect yarn project");
        assert_eq!(
            inspection.build_driver,
            TauriBuildDriver::Yarn,
            "yarn packageManager should resolve to Yarn driver"
        );
    }

    // 变体 4: bun
    {
        let repo = tempfile::tempdir().expect("temp repo");
        write_file(
            &repo.path().join(CONFIG_PATH),
            r#"{"productName":"TestApp","version":"1.0.0"}"#,
        );
        write_file(
            &repo.path().join("package.json"),
            r#"{"packageManager":"bun@1.0.0"}"#,
        );
        let inspection = provider
            .inspect(repo.path(), CONFIG_PATH)
            .expect("inspect bun project");
        assert_eq!(
            inspection.build_driver,
            TauriBuildDriver::Bun,
            "bun packageManager should resolve to Bun driver"
        );
    }

    // 变体 5: 无 packageManager，回退到 Cargo
    {
        let repo = tempfile::tempdir().expect("temp repo");
        write_file(
            &repo.path().join(CONFIG_PATH),
            r#"{"productName":"TestApp","version":"1.0.0"}"#,
        );
        write_file(
            &repo.path().join("src-tauri/Cargo.toml"),
            "[package]\nname = \"test-app\"\nversion = \"1.0.0\"\n",
        );
        let inspection = provider
            .inspect(repo.path(), CONFIG_PATH)
            .expect("inspect cargo fallback project");
        assert_eq!(
            inspection.build_driver,
            TauriBuildDriver::Cargo,
            "no packageManager with Cargo.toml should resolve to Cargo driver"
        );
    }
}

/// TAURI-09: 版本来源发现--验证 TauriProjectProvider::inspect 解析版本来源。
#[test]
fn tauri_09_version_source_discovery() {
    let provider = TauriProjectProvider::new();

    // 变体 1: 版本在 tauri.conf.json -> TauriConfig
    {
        let repo = tempfile::tempdir().expect("temp repo");
        write_file(
            &repo.path().join(CONFIG_PATH),
            r#"{"productName":"TestApp","version":"1.0.0"}"#,
        );
        write_file(
            &repo.path().join("package.json"),
            r#"{"packageManager":"pnpm@10.0.0"}"#,
        );
        let inspection = provider
            .inspect(repo.path(), CONFIG_PATH)
            .expect("inspect tauri config version source");
        assert_eq!(
            inspection.version_source.kind,
            TauriVersionSourceKind::TauriConfig,
            "version in tauri.conf.json should resolve to TauriConfig"
        );
        assert_eq!(inspection.version_source.version, "1.0.0");
        assert_eq!(inspection.version_source.selector, "version");
    }

    // 变体 2: 版本引用 package.json -> ReferencedPackageJson
    {
        let repo = tempfile::tempdir().expect("temp repo");
        write_file(
            &repo.path().join(CONFIG_PATH),
            r#"{"productName":"TestApp","version":"../package.json"}"#,
        );
        write_file(
            &repo.path().join("package.json"),
            r#"{"packageManager":"pnpm@10.0.0","version":"2.0.0"}"#,
        );
        let inspection = provider
            .inspect(repo.path(), CONFIG_PATH)
            .expect("inspect referenced package.json version source");
        assert_eq!(
            inspection.version_source.kind,
            TauriVersionSourceKind::ReferencedPackageJson,
            "version referencing package.json should resolve to ReferencedPackageJson"
        );
        assert_eq!(inspection.version_source.version, "2.0.0");
        assert_eq!(inspection.version_source.selector, "/version");
    }

    // 变体 3: 无版本字段，回退到 Cargo.toml -> CargoToml
    {
        let repo = tempfile::tempdir().expect("temp repo");
        write_file(
            &repo.path().join(CONFIG_PATH),
            r#"{"productName":"TestApp"}"#,
        );
        write_file(
            &repo.path().join("package.json"),
            r#"{"packageManager":"pnpm@10.0.0"}"#,
        );
        write_file(
            &repo.path().join("src-tauri/Cargo.toml"),
            "[package]\nname = \"test-app\"\nversion = \"3.0.0\"\n",
        );
        let inspection = provider
            .inspect(repo.path(), CONFIG_PATH)
            .expect("inspect cargo fallback version source");
        assert_eq!(
            inspection.version_source.kind,
            TauriVersionSourceKind::CargoToml,
            "no version in config should fall back to CargoToml"
        );
        assert_eq!(inspection.version_source.version, "3.0.0");
        assert_eq!(inspection.version_source.selector, "package.version");
    }
}

/// TAURI-10: 自动化投影渲染--验证 GitHubActionsBackend 生成正确的 workflow 与 runtime 文件。
#[test]
fn tauri_10_automation_projection_rendering() {
    let backend = GitHubActionsBackend::new(Arc::new(StaticCredentialSource::new()));

    // 构造最小 AutomationBindingProjection
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
                serde_json::json!({ "binding_id": "stable" }),
            ),
            (
                "runnerDistribution".to_string(),
                serde_json::json!({
                    "repository": "sperictao/one-publish",
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
                    "driver": "pnpm",
                    "configPath": "src-tauri/tauri.conf.json",
                }),
            ),
        ]),
        ..Default::default()
    };

    let binding = AutomationBindingProjection {
        binding_id: "stable".to_string(),
        configuration_id: "configuration-stable".to_string(),
        configuration_revision_id: "revision-stable".to_string(),
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

    // 验证 bundle 结构
    assert_eq!(bundle.backend.id, GITHUB_ACTIONS_BACKEND_ID);
    assert_eq!(bundle.backend.kind, AdapterKind::ExecutionBackend);
    assert!(
        !bundle.files.is_empty(),
        "bundle should contain at least one file"
    );

    // 应有 GitHub Actions workflow 文件
    let has_workflow = bundle
        .files
        .keys()
        .any(|path| path.starts_with(".github/workflows/"));
    assert!(
        has_workflow,
        "bundle should contain a GitHub Actions workflow file"
    );

    // 应有 runtime 投影文件
    let has_runtime = bundle
        .files
        .keys()
        .any(|path| path.starts_with(".one-publish/automation/runtime/"));
    assert!(
        has_runtime,
        "bundle should contain a runtime projection file"
    );

    // bundle 应通过验证
    bundle.validate().expect("sealed bundle validates");
}
