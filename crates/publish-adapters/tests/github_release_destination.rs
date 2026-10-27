use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;

use publish_adapters::{
    classify_github_failure, AdapterContract, AdapterExecutionContext, AdapterExecutionOutput,
    DeliveryDestination, DeliveryProbe, FakeGitHubReleaseApi, GitHubApiFailure,
    GitHubReleaseDestination, RemoteGitHubAsset, RemoteGitHubRelease, FAKE_OPERATION_CREATE,
    FAKE_OPERATION_UPLOAD,
};
use publish_domain::{
    sha256_hex, AdapterBinding, AdapterIdentity, AdapterKind, AdapterSelection, AdapterSettings,
    ArtifactManifest, ArtifactManifestEntry, CredentialKind, CredentialValue, DeliveryEnvelope,
    DeliveryIdempotencyIdentity, DeliveryReceipt, DeliveryStatus, PlanNode, PlanStage,
    PlanningInputSnapshot, PublishError, PublishFailureCategory, ReleaseIdentity,
    ResolvedCredential, SourceSnapshot, PLANNING_INPUT_SNAPSHOT_VERSION,
};
use serde_json::Value;

const ROUTE_ID: &str = "github-route";
const TOKEN: &str = "gh-token-value";

/// 单测夹具：Fake GitHub API、密封产物文件与解析好的凭据。
struct Fixture {
    api: Arc<FakeGitHubReleaseApi>,
    destination: GitHubReleaseDestination,
    root: tempfile::TempDir,
    credentials: BTreeMap<String, ResolvedCredential>,
}

impl Fixture {
    fn new() -> Self {
        let api = Arc::new(FakeGitHubReleaseApi::new());
        Self {
            destination: GitHubReleaseDestination::new(api.clone()),
            api,
            root: tempfile::tempdir().expect("fixture root"),
            credentials: BTreeMap::from([(
                "github_token".to_string(),
                ResolvedCredential {
                    kind: CredentialKind::Token,
                    value: CredentialValue::new(TOKEN),
                },
            )]),
        }
    }

    /// 物化 destination 的三个路线节点：stage、publish、observe。
    fn nodes(&self, settings: &AdapterSettings) -> Vec<PlanNode> {
        self.nodes_for(&snapshot(), settings)
    }

    /// 同上，但允许自定义 Planning Input Snapshot（版本、签名声明、渠道等）。
    fn nodes_for(
        &self,
        snapshot: &PlanningInputSnapshot,
        settings: &AdapterSettings,
    ) -> Vec<PlanNode> {
        let templates = self
            .destination
            .plan_fragment(snapshot, settings)
            .expect("plan fragment");
        templates
            .into_iter()
            .map(|template| PlanNode {
                id: format!("{ROUTE_ID}.{}", template.local_id),
                stage: template.stage,
                adapter: self.destination.descriptor().identity(),
                binding_id: ROUTE_ID.to_string(),
                settings: settings.clone(),
                operation: template.operation,
                depends_on: Vec::new(),
                artifact_inputs: template.artifact_inputs,
                artifact_outputs: template.artifact_outputs,
                side_effects: template.side_effects,
                cancellable: template.cancellable,
                cleanup_owned_staging: template.cleanup_owned_staging,
                irreversible: template.irreversible,
                platform: template.platform,
            })
            .collect()
    }

    fn execute(
        &self,
        node: &PlanNode,
        manifest: &ArtifactManifest,
        envelopes: &[DeliveryEnvelope],
        receipts: &[DeliveryReceipt],
    ) -> Result<AdapterExecutionOutput, PublishError> {
        let context = AdapterExecutionContext {
            attempt_id: "attempt-github",
            plan_digest: "plan-digest",
            snapshot_digest: manifest.planning_snapshot_digest.as_str(),
            artifacts: &[],
            manifest: Some(manifest),
            envelopes,
            receipts,
            credentials: &self.credentials,
            cancellation: publish_adapters::CancellationSignal::new(),
        };
        self.destination.execute_node(node, &context)
    }

    /// 依次执行 stage 与 publish，返回 (envelope, publish 输出)。
    fn stage_then_publish(
        &self,
        settings: &AdapterSettings,
        manifest: &ArtifactManifest,
    ) -> (
        Vec<DeliveryEnvelope>,
        Result<AdapterExecutionOutput, PublishError>,
    ) {
        let nodes = self.nodes(settings);
        let staged = self
            .execute(&nodes[0], manifest, &[], &[])
            .expect("stage envelope");
        let publish = self.execute(&nodes[1], manifest, &staged.envelopes, &[]);
        (staged.envelopes, publish)
    }
}

fn settings() -> AdapterSettings {
    AdapterSettings::new(1)
        .with_value("repository", Value::String("acme/demo".to_string()))
        .with_value("visibility", Value::String("public".to_string()))
        .with_value("tag_prefix", Value::String("v".to_string()))
        .with_value(
            "allowed_asset_roles",
            Value::Array(vec![
                Value::String("installer".to_string()),
                Value::String("updater-archive".to_string()),
            ]),
        )
        .with_value("updater_enabled", Value::Bool(false))
        .with_value(
            "enabled_platforms",
            Value::Array(vec![Value::String("macos-aarch64".to_string())]),
        )
        .with_value("unsigned_release_override", Value::Bool(false))
}

fn updater_settings() -> AdapterSettings {
    settings().with_value("updater_enabled", Value::Bool(true))
}

fn snapshot() -> PlanningInputSnapshot {
    snapshot_with_release_input(BTreeMap::from([
        ("version".to_string(), Value::String("1.2.3".to_string())),
        (
            "release_notes".to_string(),
            Value::String("## Changes\n- polished delivery".to_string()),
        ),
        (
            "platform_code_signing".to_string(),
            Value::String("signed".to_string()),
        ),
    ]))
}

fn snapshot_with_release_input(release_input: BTreeMap<String, Value>) -> PlanningInputSnapshot {
    PlanningInputSnapshot {
        version: PLANNING_INPUT_SNAPSHOT_VERSION,
        configuration_revision: "configuration-revision-1".to_string(),
        runtime_revision: "runtime-revision-1".to_string(),
        release_input,
        source: SourceSnapshot {
            revision: "0123456789abcdef".to_string(),
            workspace_digest: None,
            dirty: false,
            captured_at: "2026-07-26T10:00:00Z".to_string(),
            reproducible: true,
        },
        external_preconditions: BTreeMap::new(),
        promoted_manifest_digest: None,
        adapters: AdapterSelection {
            project_provider: AdapterBinding::new(
                "project",
                AdapterIdentity::new(AdapterKind::ProjectProvider, "fixture-project", 1),
                AdapterSettings::new(1),
            ),
            artifact_processors: vec![],
            execution_backend: AdapterBinding::new(
                "backend",
                AdapterIdentity::new(AdapterKind::ExecutionBackend, "local-execution", 1),
                AdapterSettings::new(1),
            ),
            artifact_store: AdapterBinding::new(
                "store",
                AdapterIdentity::new(AdapterKind::ArtifactStore, "temporary-artifact-store", 1),
                AdapterSettings::new(1),
            ),
            delivery_routes: vec![],
        },
    }
}

/// 把产物写进夹具目录并封存为 Artifact Manifest；条目顺序即声明顺序。
fn manifest_with(root: &Path, entries: &[(&str, &str, &str, &str, &[u8])]) -> ArtifactManifest {
    let sealed = entries
        .iter()
        .map(|(role, file_name, platform, architecture, bytes)| {
            let path = root.join(file_name);
            std::fs::write(&path, bytes).expect("write fixture artifact");
            ArtifactManifestEntry {
                role: role.to_string(),
                file_name: file_name.to_string(),
                media_type: "application/octet-stream".to_string(),
                platform: platform.to_string(),
                architecture: architecture.to_string(),
                size: bytes.len() as u64,
                digest: sha256_hex(bytes),
                locator: path.to_string_lossy().to_string(),
                retention: "604800s".to_string(),
                executable: Some(false),
            }
        })
        .collect();
    ArtifactManifest::seal(sha256_hex(b"snapshot"), sealed).expect("seal manifest")
}

fn desktop_manifest(root: &Path) -> ArtifactManifest {
    manifest_with(
        root,
        &[
            ("installer", "Demo.dmg", "macos", "aarch64", b"dmg-bytes"),
            (
                "updater-archive",
                "Demo.app.tar.gz",
                "macos",
                "aarch64",
                b"updater-bytes",
            ),
            (
                "updater-signature",
                "Demo.app.tar.gz.sig",
                "macos",
                "aarch64",
                b"signature-payload",
            ),
            (
                "build-support",
                "build-log.txt",
                "macos",
                "aarch64",
                b"local build residue",
            ),
        ],
    )
}

fn classified_category(error: &PublishError) -> PublishFailureCategory {
    match error {
        PublishError::Classified { failure } => failure.category,
        other => panic!("expected a classified failure, got {other}"),
    }
}

fn marker(manifest: &ArtifactManifest) -> String {
    format!("<!-- one-publish-manifest:{} -->", manifest.digest)
}

fn seeded_release(
    id: u64,
    tag: &str,
    body: String,
    draft: bool,
    assets: Vec<RemoteGitHubAsset>,
) -> RemoteGitHubRelease {
    RemoteGitHubRelease {
        id,
        tag: tag.to_string(),
        url: format!("https://github.com/acme/demo/releases/tag/{tag}"),
        body,
        draft,
        prerelease: false,
        assets,
    }
}

fn probe_identity(manifest_digest: &str) -> DeliveryIdempotencyIdentity {
    DeliveryIdempotencyIdentity {
        attempt_id: "attempt-github".to_string(),
        plan_node_id: format!("{ROUTE_ID}.publish"),
        release_identity: ReleaseIdentity::new(
            "fixture-project",
            SourceSnapshot {
                revision: "0123456789abcdef".to_string(),
                workspace_digest: None,
                dirty: false,
                captured_at: "2026-07-26T10:00:00Z".to_string(),
                reproducible: true,
            },
            "1.2.3",
            "stable",
            None,
        ),
        manifest_digest: manifest_digest.to_string(),
        route_id: ROUTE_ID.to_string(),
    }
}

#[test]
fn plan_fragment_seals_three_route_nodes_with_declared_side_effects() {
    let fixture = Fixture::new();
    let nodes = fixture.nodes(&settings());

    assert_eq!(nodes.len(), 3);
    assert_eq!(nodes[0].stage, PlanStage::StageRoutes);
    assert_eq!(nodes[1].stage, PlanStage::PublishRoutes);
    assert_eq!(nodes[2].stage, PlanStage::ObserveRoutes);
    assert!(nodes[0].side_effects.is_empty());
    assert_eq!(
        nodes[1].side_effects,
        vec![publish_domain::PlanSideEffect::Network]
    );
    assert!(nodes[1].irreversible);
    assert!(!nodes[2].irreversible);
    for node in &nodes {
        assert_eq!(
            node.artifact_inputs,
            vec!["artifact-manifest".to_string()],
            "route nodes consume the sealed manifest"
        );
    }
}

#[test]
fn plan_fragment_requires_a_release_version_input() {
    let fixture = Fixture::new();
    let error = fixture
        .destination
        .plan_fragment(&snapshot_with_release_input(BTreeMap::new()), &settings())
        .expect_err("a release version is a required single-release input");
    assert!(error.to_string().contains("version"));
}

#[test]
fn validate_settings_rejects_private_repositories_with_updater_enabled() {
    let fixture = Fixture::new();
    let private_updater =
        updater_settings().with_value("visibility", Value::String("private".to_string()));
    let error = fixture
        .destination
        .validate_settings(&private_updater)
        .expect_err("private repositories cannot enable the updater (ADR-0018)");
    assert!(error.to_string().to_lowercase().contains("private"));

    let private_plain = settings().with_value("visibility", Value::String("private".to_string()));
    fixture
        .destination
        .validate_settings(&private_plain)
        .expect("plain private releases are supported");
}

#[test]
fn validate_settings_rejects_unknown_visibility() {
    let fixture = Fixture::new();
    let error = fixture
        .destination
        .validate_settings(
            &settings().with_value("visibility", Value::String("internal".to_string())),
        )
        .expect_err("visibility is a closed set");
    assert!(error.to_string().contains("visibility"));
}

#[test]
fn staging_builds_a_route_owned_envelope_from_the_sealed_manifest() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let nodes = fixture.nodes(&settings());

    let output = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect("stage the github release envelope");

    assert_eq!(output.envelopes.len(), 1);
    let envelope = &output.envelopes[0];
    assert_eq!(envelope.route_id, ROUTE_ID);
    assert_eq!(envelope.manifest_digest, manifest.digest);
    assert_eq!(
        envelope.content.get("tag").and_then(Value::as_str),
        Some("v1.2.3")
    );
    let body = envelope
        .content
        .get("body")
        .and_then(Value::as_str)
        .expect("release body");
    assert!(body.contains("## Changes"));
    assert!(body.contains(&marker(&manifest)));

    let assets = envelope
        .content
        .get("assets")
        .and_then(Value::as_array)
        .expect("selected assets");
    let names: Vec<&str> = assets
        .iter()
        .filter_map(|asset| asset.get("name").and_then(Value::as_str))
        .collect();
    // 只有白名单角色成为资产：installer 与 updater-archive；签名辅助文件与
    // 构建残留不出现（ADR-0012）。
    assert_eq!(names, vec!["Demo.dmg", "Demo.app.tar.gz"]);
    let urls: Vec<&str> = assets
        .iter()
        .filter_map(|asset| asset.get("url").and_then(Value::as_str))
        .collect();
    assert_eq!(
        urls,
        vec![
            "https://github.com/acme/demo/releases/download/v1.2.3/Demo.dmg",
            "https://github.com/acme/demo/releases/download/v1.2.3/Demo.app.tar.gz",
        ]
    );
}

#[test]
fn staging_rejects_a_manifest_missing_an_enabled_platform_installer() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let both_platforms = settings().with_value(
        "enabled_platforms",
        Value::Array(vec![
            Value::String("macos-aarch64".to_string()),
            Value::String("windows-x86_64".to_string()),
        ]),
    );
    let nodes = fixture.nodes(&both_platforms);

    let error = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect_err("the enabled platform set must be complete");
    assert_eq!(
        classified_category(&error),
        PublishFailureCategory::Validation
    );
    assert!(error.to_string().contains("windows-x86_64"));
}

#[test]
fn staging_requires_a_non_empty_platform_set_and_at_least_one_asset() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());

    let no_platforms = settings().with_value("enabled_platforms", Value::Array(vec![]));
    let nodes = fixture.nodes(&no_platforms);
    let error = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect_err("an empty enabled platform set cannot deliver");
    assert_eq!(
        classified_category(&error),
        PublishFailureCategory::Validation
    );

    let no_assets = manifest_with(
        fixture.root.path(),
        &[("build-support", "log.txt", "macos", "aarch64", b"log")],
    );
    let nodes = fixture.nodes(&settings());
    let error = fixture
        .execute(&nodes[0], &no_assets, &[], &[])
        .expect_err("a release without allow-listed assets cannot deliver");
    assert_eq!(
        classified_category(&error),
        PublishFailureCategory::Validation
    );
}

#[test]
fn staging_derives_the_updater_manifest_for_updater_enabled_releases() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let nodes = fixture.nodes(&updater_settings());

    let output = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect("stage an updater-enabled envelope");
    let envelope = &output.envelopes[0];
    let updater = envelope
        .content
        .get("updater_manifest")
        .expect("route-owned updater manifest");

    assert_eq!(
        updater.get("version").and_then(Value::as_str),
        Some("1.2.3")
    );
    assert_eq!(
        updater.get("pub_date").and_then(Value::as_str),
        Some("2026-07-26T10:00:00Z")
    );
    let platform = updater
        .pointer("/platforms/darwin-aarch64")
        .expect("updater platform entry");
    assert_eq!(
        platform.get("signature").and_then(Value::as_str),
        Some("signature-payload")
    );
    assert_eq!(
        platform.get("url").and_then(Value::as_str),
        Some("https://github.com/acme/demo/releases/download/v1.2.3/Demo.app.tar.gz")
    );

    // latest.json 成为路线专属资产并带下载 URL 索引。
    let assets = envelope
        .content
        .get("assets")
        .and_then(Value::as_array)
        .expect("selected assets");
    assert!(assets
        .iter()
        .any(|asset| asset.get("name").and_then(Value::as_str) == Some("latest.json")));
}

#[test]
fn staging_requires_complete_updater_packages_and_signatures() {
    let fixture = Fixture::new();
    let missing_signature = manifest_with(
        fixture.root.path(),
        &[
            ("installer", "Demo.dmg", "macos", "aarch64", b"dmg-bytes"),
            (
                "updater-archive",
                "Demo.app.tar.gz",
                "macos",
                "aarch64",
                b"updater-bytes",
            ),
        ],
    );
    let nodes = fixture.nodes(&updater_settings());
    let error = fixture
        .execute(&nodes[0], &missing_signature, &[], &[])
        .expect_err("updater-enabled releases need updater signatures");
    assert_eq!(
        classified_category(&error),
        PublishFailureCategory::Validation
    );
    assert!(error.to_string().contains("Demo.app.tar.gz.sig"));

    let missing_archive = manifest_with(
        fixture.root.path(),
        &[("installer", "Demo.dmg", "macos", "aarch64", b"dmg-bytes")],
    );
    let error = fixture
        .execute(&nodes[0], &missing_archive, &[], &[])
        .expect_err("updater-enabled releases need update packages");
    assert_eq!(
        classified_category(&error),
        PublishFailureCategory::Validation
    );
}

#[test]
fn plain_releases_do_not_require_updater_assets() {
    let fixture = Fixture::new();
    let plain = manifest_with(
        fixture.root.path(),
        &[("installer", "Demo.dmg", "macos", "aarch64", b"dmg-bytes")],
    );
    let nodes = fixture.nodes(&settings());
    let output = fixture
        .execute(&nodes[0], &plain, &[], &[])
        .expect("plain releases are not forced onto the updater");
    assert!(!output.envelopes[0].content.contains_key("updater_manifest"));
}

#[test]
fn staging_blocks_unsigned_artifacts_without_an_explicit_override() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let unsigned = snapshot_with_release_input(BTreeMap::from([
        ("version".to_string(), Value::String("1.2.3".to_string())),
        (
            "platform_code_signing".to_string(),
            Value::String("unsigned".to_string()),
        ),
    ]));

    let stage = &fixture.nodes_for(&unsigned, &settings())[0];
    let error = fixture
        .execute(stage, &manifest, &[], &[])
        .expect_err("unsigned artifacts need an explicit override (ADR-0006)");
    assert_eq!(
        classified_category(&error),
        PublishFailureCategory::Validation
    );

    // 明确授权后未签名发布可以继续（不等于分发就绪的静默降级）。
    let override_settings = settings().with_value("unsigned_release_override", Value::Bool(true));
    let stage = &fixture.nodes_for(&unsigned, &override_settings)[0];
    fixture
        .execute(stage, &manifest, &[], &[])
        .expect("the explicit override authorizes the unsigned release");

    // 未签名授权不豁免 Updater 签名要求。
    let updater_override =
        updater_settings().with_value("unsigned_release_override", Value::Bool(true));
    let missing_signature = manifest_with(
        fixture.root.path(),
        &[
            ("installer", "Demo.dmg", "macos", "aarch64", b"dmg-bytes"),
            (
                "updater-archive",
                "Demo.app.tar.gz",
                "macos",
                "aarch64",
                b"updater-bytes",
            ),
        ],
    );
    let stage = &fixture.nodes_for(&unsigned, &updater_override)[0];
    let error = fixture
        .execute(stage, &missing_signature, &[], &[])
        .expect_err("the unsigned override never waives updater signing");
    assert_eq!(
        classified_category(&error),
        PublishFailureCategory::Validation
    );
}

#[test]
fn updater_manifest_serves_universal_macos_builds_under_both_darwin_keys() {
    let fixture = Fixture::new();
    let manifest = manifest_with(
        fixture.root.path(),
        &[
            (
                "installer",
                "Demo.dmg",
                "macos",
                "universal",
                b"universal-dmg",
            ),
            (
                "updater-archive",
                "Demo.app.tar.gz",
                "macos",
                "universal",
                b"universal-updater",
            ),
            (
                "updater-signature",
                "Demo.app.tar.gz.sig",
                "macos",
                "universal",
                b"universal-signature",
            ),
        ],
    );
    let universal = updater_settings().with_value(
        "enabled_platforms",
        Value::Array(vec![Value::String("macos-universal".to_string())]),
    );
    let nodes = fixture.nodes(&universal);

    let output = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect("stage a universal updater envelope");
    let updater = output.envelopes[0]
        .content
        .get("updater_manifest")
        .expect("updater manifest");
    for key in ["darwin-aarch64", "darwin-x86_64"] {
        let entry = updater
            .pointer(&format!("/platforms/{key}"))
            .unwrap_or_else(|| panic!("universal build must serve {key}"));
        assert_eq!(
            entry.get("signature").and_then(Value::as_str),
            Some("universal-signature")
        );
    }
}

#[test]
fn private_repositories_deliver_plain_releases_end_to_end() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let private = settings().with_value("visibility", Value::String("private".to_string()));
    let nodes = fixture.nodes(&private);

    let staged = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect("stage a private plain release");
    let published = fixture
        .execute(&nodes[1], &manifest, &staged.envelopes, &[])
        .expect("publish the private release");
    let observed = fixture
        .execute(&nodes[2], &manifest, &staged.envelopes, &published.receipts)
        .expect("observe the private release");
    assert_eq!(observed.receipts[0].status, DeliveryStatus::Published);
}

#[test]
fn non_stable_channels_mark_the_release_as_prerelease() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let nightly = snapshot_with_release_input(BTreeMap::from([
        ("version".to_string(), Value::String("1.2.3".to_string())),
        ("channel".to_string(), Value::String("nightly".to_string())),
        (
            "platform_code_signing".to_string(),
            Value::String("signed".to_string()),
        ),
    ]));
    let nodes = fixture.nodes_for(&nightly, &settings());

    let staged = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect("stage a nightly release");
    assert_eq!(
        staged.envelopes[0].content.get("prerelease"),
        Some(&Value::Bool(true))
    );
    fixture
        .execute(&nodes[1], &manifest, &staged.envelopes, &[])
        .expect("publish the nightly release");
    assert!(
        fixture
            .api
            .release("v1.2.3")
            .expect("remote release")
            .prerelease
    );
}

#[test]
fn publishing_creates_a_draft_uploads_allowed_assets_and_flips_to_published() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let (_envelopes, publish) = fixture.stage_then_publish(&updater_settings(), &manifest);

    let output = publish.expect("publish the github release");
    assert_eq!(output.receipts.len(), 1);
    let receipt = &output.receipts[0];
    assert_eq!(receipt.status, DeliveryStatus::Submitted);
    assert_eq!(receipt.revision, 1);
    assert_eq!(receipt.route_id, ROUTE_ID);
    assert_eq!(receipt.manifest_digest, manifest.digest);
    assert_eq!(
        receipt.external_reference,
        "https://github.com/acme/demo/releases/tag/v1.2.3"
    );

    let release = fixture.api.release("v1.2.3").expect("remote release");
    assert!(!release.draft, "the draft flips to published");
    assert!(release.body.contains(&marker(&manifest)));
    let mut names: Vec<&str> = release
        .assets
        .iter()
        .map(|asset| asset.name.as_str())
        .collect();
    names.sort_unstable();
    assert_eq!(names, vec!["Demo.app.tar.gz", "Demo.dmg", "latest.json"]);

    // 上传的字节与封存 Manifest 一致：清单未声明的文件与构建残留不在资产中。
    let dmg = release
        .assets
        .iter()
        .find(|asset| asset.name == "Demo.dmg")
        .expect("installer asset");
    assert_eq!(dmg.digest, sha256_hex(b"dmg-bytes"));
}

#[test]
fn publishing_keeps_secrets_out_of_envelopes_events_and_receipts() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let (envelopes, publish) = fixture.stage_then_publish(&settings(), &manifest);
    let output = publish.expect("publish the github release");

    let serialized = serde_json::to_string(&(envelopes, output.receipts)).expect("serialize");
    assert!(
        !serialized.contains(TOKEN),
        "the resolved token never enters serialized delivery evidence"
    );
    assert!(fixture
        .api
        .observed_tokens()
        .iter()
        .all(|token| token == TOKEN));
}

#[test]
fn publishing_resumes_an_interrupted_draft_without_duplicating_assets() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    fixture.api.seed_release(seeded_release(
        7,
        "v1.2.3",
        format!("notes\n\n{}", marker(&manifest)),
        true,
        vec![RemoteGitHubAsset {
            id: 71,
            name: "Demo.dmg".to_string(),
            digest: sha256_hex(b"dmg-bytes"),
            size: b"dmg-bytes".len() as u64,
        }],
    ));

    let (_envelopes, publish) = fixture.stage_then_publish(&settings(), &manifest);
    let output = publish.expect("resume the interrupted draft");
    assert_eq!(output.receipts[0].status, DeliveryStatus::Submitted);
    assert_eq!(fixture.api.calls(FAKE_OPERATION_CREATE), 0);
    // 已存在且摘要一致的资产被跳过，只补齐缺失资产。
    assert_eq!(fixture.api.calls(FAKE_OPERATION_UPLOAD), 1);
    let release = fixture.api.release("v1.2.3").expect("remote release");
    assert!(!release.draft);
}

#[test]
fn publishing_reuses_a_matching_published_release_without_side_effects() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    fixture.api.seed_release(seeded_release(
        7,
        "v1.2.3",
        format!("notes\n\n{}", marker(&manifest)),
        false,
        vec![
            RemoteGitHubAsset {
                id: 72,
                name: "Demo.dmg".to_string(),
                digest: sha256_hex(b"dmg-bytes"),
                size: b"dmg-bytes".len() as u64,
            },
            RemoteGitHubAsset {
                id: 73,
                name: "Demo.app.tar.gz".to_string(),
                digest: sha256_hex(b"updater-bytes"),
                size: b"updater-bytes".len() as u64,
            },
        ],
    ));

    let (_envelopes, publish) = fixture.stage_then_publish(&settings(), &manifest);
    let output = publish.expect("reuse the matching published release");
    assert_eq!(output.receipts[0].status, DeliveryStatus::Submitted);
    assert_eq!(fixture.api.calls(FAKE_OPERATION_CREATE), 0);
    assert_eq!(fixture.api.calls(FAKE_OPERATION_UPLOAD), 0);
}

#[test]
fn publishing_blocks_on_conflicting_remote_content_and_keeps_the_tag() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let foreign_body = "a different release without our manifest".to_string();
    fixture.api.seed_release(seeded_release(
        9,
        "v1.2.3",
        foreign_body.clone(),
        false,
        vec![],
    ));

    let (_envelopes, publish) = fixture.stage_then_publish(&settings(), &manifest);
    let error = publish.expect_err("conflicting remote content must block the route");
    assert_eq!(
        classified_category(&error),
        PublishFailureCategory::Conflict
    );

    // 已推送的版本标签不可变：冲突时远端 Release 保持原样（ADR-0009）。
    let release = fixture.api.release("v1.2.3").expect("remote release");
    assert_eq!(release.body, foreign_body);
    assert!(release.assets.is_empty());
}

#[test]
fn publishing_blocks_on_a_foreign_draft_without_our_manifest_marker() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    fixture.api.seed_release(seeded_release(
        3,
        "v1.2.3",
        "someone else's staging draft".to_string(),
        true,
        vec![],
    ));
    let (_envelopes, publish) = fixture.stage_then_publish(&settings(), &manifest);
    let error = publish.expect_err("a foreign draft is not our staging area");
    assert_eq!(
        classified_category(&error),
        PublishFailureCategory::Conflict
    );
}

#[test]
fn publishing_replaces_corrupted_assets_in_our_own_draft() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    // marker 已确认这是我方同一 Manifest 的 staging；同名但摘要不符的资产
    // 是中断上传的残损字节，替换属于幂等续传（ADR-0016/0041）。
    fixture.api.seed_release(seeded_release(
        4,
        "v1.2.3",
        format!("notes\n\n{}", marker(&manifest)),
        true,
        vec![RemoteGitHubAsset {
            id: 74,
            name: "Demo.dmg".to_string(),
            digest: sha256_hex(b"interrupted partial bytes"),
            size: 16,
        }],
    ));
    let (_envelopes, publish) = fixture.stage_then_publish(&settings(), &manifest);
    let output = publish.expect("replace the corrupted staging asset and finish delivery");
    assert_eq!(output.receipts[0].status, DeliveryStatus::Submitted);
    assert_eq!(
        fixture
            .api
            .calls(publish_adapters::FAKE_OPERATION_DELETE_ASSET),
        1
    );

    let release = fixture.api.release("v1.2.3").expect("remote release");
    assert!(!release.draft);
    let dmg = release
        .assets
        .iter()
        .find(|asset| asset.name == "Demo.dmg")
        .expect("replaced installer asset");
    assert_eq!(dmg.digest, sha256_hex(b"dmg-bytes"));
}

#[test]
fn api_failures_map_to_the_closed_failure_classification() {
    let rate_limited = classify_github_failure(&GitHubApiFailure::RateLimited {
        retry_after_seconds: 42,
        message: "secondary rate limit".to_string(),
    });
    assert_eq!(rate_limited.category, PublishFailureCategory::RateLimited);
    assert_eq!(rate_limited.retry_after_seconds, Some(42));

    let server = classify_github_failure(&GitHubApiFailure::Http {
        status: 502,
        message: "bad gateway".to_string(),
    });
    assert_eq!(server.category, PublishFailureCategory::Transient);

    let network = classify_github_failure(&GitHubApiFailure::Network {
        message: "connection reset".to_string(),
    });
    assert_eq!(network.category, PublishFailureCategory::Transient);
    assert!(!network.retry_safe, "network side effects are uncertain");

    let unauthenticated = classify_github_failure(&GitHubApiFailure::Http {
        status: 401,
        message: "bad credentials".to_string(),
    });
    assert_eq!(
        unauthenticated.category,
        PublishFailureCategory::Authentication
    );

    let forbidden = classify_github_failure(&GitHubApiFailure::Http {
        status: 403,
        message: "resource not accessible".to_string(),
    });
    assert_eq!(forbidden.category, PublishFailureCategory::Authorization);
}

#[test]
fn rate_limited_uploads_surface_a_classified_retryable_failure() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    fixture.api.fail_next(
        FAKE_OPERATION_UPLOAD,
        GitHubApiFailure::RateLimited {
            retry_after_seconds: 30,
            message: "secondary rate limit".to_string(),
        },
    );

    let (_envelopes, publish) = fixture.stage_then_publish(&settings(), &manifest);
    let error = publish.expect_err("the injected rate limit surfaces");
    match &error {
        PublishError::Classified { failure } => {
            assert_eq!(failure.category, PublishFailureCategory::RateLimited);
            assert_eq!(failure.retry_after_seconds, Some(30));
        }
        other => panic!("expected a classified rate limit, got {other}"),
    }
}

#[test]
fn observation_confirms_published_state_with_a_second_receipt_revision() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let nodes = fixture.nodes(&settings());
    let staged = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect("stage");
    let published = fixture
        .execute(&nodes[1], &manifest, &staged.envelopes, &[])
        .expect("publish");

    let observed = fixture
        .execute(&nodes[2], &manifest, &staged.envelopes, &published.receipts)
        .expect("observe the remote release");
    assert_eq!(observed.receipts.len(), 1);
    let receipt = &observed.receipts[0];
    assert_eq!(receipt.status, DeliveryStatus::Published);
    assert_eq!(receipt.revision, 2);
    assert_eq!(receipt.receipt_id, published.receipts[0].receipt_id);
    assert_eq!(
        receipt.external_reference,
        published.receipts[0].external_reference
    );
}

#[test]
fn observation_fails_while_the_remote_release_is_still_a_draft() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let nodes = fixture.nodes(&settings());
    let staged = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect("stage");
    let published = fixture
        .execute(&nodes[1], &manifest, &staged.envelopes, &[])
        .expect("publish");

    // 远端退回 draft（例如翻转丢失）：观察不到 Published 就不能满足 Required Route。
    let mut regressed = fixture.api.release("v1.2.3").expect("remote release");
    regressed.draft = true;
    fixture.api.seed_release(regressed);

    let error = fixture
        .execute(&nodes[2], &manifest, &staged.envelopes, &published.receipts)
        .expect_err("only a remotely observed Published state satisfies the route");
    assert_eq!(
        classified_category(&error),
        PublishFailureCategory::Transient
    );
}

#[test]
fn probing_reports_absent_matching_and_conflicting_remote_state() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let identity = probe_identity(&manifest.digest);

    // 远端没有此标签：重新执行是安全的。
    assert_eq!(
        fixture
            .destination
            .probe_delivery(&settings(), &identity, &fixture.credentials)
            .expect("probe an absent release"),
        DeliveryProbe::Absent
    );

    // 我方未完成的 draft：可以安全续传。
    fixture.api.seed_release(seeded_release(
        5,
        "v1.2.3",
        format!("notes\n\n{}", marker(&manifest)),
        true,
        vec![],
    ));
    assert_eq!(
        fixture
            .destination
            .probe_delivery(&settings(), &identity, &fixture.credentials)
            .expect("probe our own draft"),
        DeliveryProbe::Absent
    );

    // 摘要一致的 published Release：复用既有交付。
    let mut matching = fixture.api.release("v1.2.3").expect("remote release");
    matching.draft = false;
    fixture.api.seed_release(matching);
    assert_eq!(
        fixture
            .destination
            .probe_delivery(&settings(), &identity, &fixture.credentials)
            .expect("probe the matching release"),
        DeliveryProbe::Matching {
            external_reference: "https://github.com/acme/demo/releases/tag/v1.2.3".to_string(),
        }
    );

    // 摘要不一致的同名交付：继续执行会覆盖另一份发布产物。
    let conflicting_identity = probe_identity(&sha256_hex(b"a different manifest"));
    assert_eq!(
        fixture
            .destination
            .probe_delivery(&settings(), &conflicting_identity, &fixture.credentials)
            .expect("probe the conflicting release"),
        DeliveryProbe::Conflicting {
            external_reference: "https://github.com/acme/demo/releases/tag/v1.2.3".to_string(),
        }
    );
}

#[test]
fn probe_failures_surface_as_classified_errors() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    fixture.api.fail_next(
        publish_adapters::FAKE_OPERATION_FIND,
        GitHubApiFailure::Network {
            message: "connection reset".to_string(),
        },
    );
    let error = fixture
        .destination
        .probe_delivery(
            &settings(),
            &probe_identity(&manifest.digest),
            &fixture.credentials,
        )
        .expect_err("probe failures must not silently allow a retry");
    assert_eq!(
        classified_category(&error),
        PublishFailureCategory::Transient
    );
}

fn classified_code(error: &PublishError) -> &str {
    match error {
        PublishError::Classified { failure } => failure.native_code.as_str(),
        other => panic!("expected a classified failure, got {other}"),
    }
}

#[test]
fn observe_requires_a_submitted_delivery_receipt() {
    // observe 只消费既有 publish receipt；缺失时是执行错误而非远端探测。
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let nodes = fixture.nodes(&settings());
    let staged = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect("stage the release envelope");

    let error = fixture
        .execute(&nodes[2], &manifest, &staged.envelopes, &[])
        .expect_err("observe without a publish receipt must fail");
    assert!(matches!(error, PublishError::Execution(_)));
}

#[test]
fn observe_reports_release_not_observable_until_the_tag_exists() {
    // receipt 已提交但远端尚无该 tag（job 未上传/尚未拉到）：瞬时态可重试。
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let nodes = fixture.nodes(&settings());
    let staged = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect("stage");
    let submitted = DeliveryReceipt {
        version: 1,
        receipt_id: "receipt-submitted".to_string(),
        revision: 1,
        route_id: ROUTE_ID.to_string(),
        manifest_digest: manifest.digest.clone(),
        status: DeliveryStatus::Submitted,
        external_reference: String::new(),
    };

    let error = fixture
        .execute(&nodes[2], &manifest, &staged.envelopes, &[submitted])
        .expect_err("a release that does not exist yet is not observable");
    assert_eq!(
        classified_category(&error),
        PublishFailureCategory::Transient
    );
    assert_eq!(classified_code(&error), "release_not_observable");
}

#[test]
fn observe_waits_out_a_draft_release_as_transient() {
    // 我方 release 仍是 draft：瞬时态，不视为交付完成也不判冲突。
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let nodes = fixture.nodes(&settings());
    let staged = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect("stage");
    let published = fixture
        .execute(&nodes[1], &manifest, &staged.envelopes, &[])
        .expect("publish");

    let mut draft = fixture.api.release("v1.2.3").expect("published release");
    draft.draft = true;
    fixture.api.seed_release(draft);

    let error = fixture
        .execute(&nodes[2], &manifest, &staged.envelopes, &published.receipts)
        .expect_err("a draft release is still transient");
    assert_eq!(
        classified_category(&error),
        PublishFailureCategory::Transient
    );
    assert_eq!(classified_code(&error), "release_still_draft");
}

#[test]
fn observe_refuses_releases_not_delivered_from_this_manifest() {
    // 同名 tag 但 body 无我方 manifest 标记：冲突而非覆盖（tag 不可变）。
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let nodes = fixture.nodes(&settings());
    let staged = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect("stage");
    let published = fixture
        .execute(&nodes[1], &manifest, &staged.envelopes, &[])
        .expect("publish");

    let mut foreign = fixture.api.release("v1.2.3").expect("published release");
    foreign.body = "hand-written release notes".to_string();
    fixture.api.seed_release(foreign);

    let error = fixture
        .execute(&nodes[2], &manifest, &staged.envelopes, &published.receipts)
        .expect_err("an unmanaged release must not be observed as ours");
    assert_eq!(
        classified_category(&error),
        PublishFailureCategory::Conflict
    );
    assert_eq!(classified_code(&error), "release_not_managed");
}

#[test]
fn observe_detects_manifest_digest_conflicts_on_the_tag() {
    // 同名 tag 携带另一 manifest 摘要：产物集不同的冲突交付。
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let nodes = fixture.nodes(&settings());
    let staged = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect("stage");
    let published = fixture
        .execute(&nodes[1], &manifest, &staged.envelopes, &[])
        .expect("publish");

    let mut conflicting = fixture.api.release("v1.2.3").expect("published release");
    conflicting.body = format!(
        "notes\n\n<!-- one-publish-manifest:{} -->",
        sha256_hex(b"another artifact set")
    );
    fixture.api.seed_release(conflicting);

    let error = fixture
        .execute(&nodes[2], &manifest, &staged.envelopes, &published.receipts)
        .expect_err("a different manifest digest is a conflict");
    assert_eq!(
        classified_category(&error),
        PublishFailureCategory::Conflict
    );
    assert_eq!(classified_code(&error), "release_manifest_conflict");
}

#[test]
fn observe_rejects_releases_missing_expected_assets() {
    // 远端 release 缺资产/摘要漂移：冲突态——交付完整性不成立。
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let nodes = fixture.nodes(&settings());
    let staged = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect("stage");
    let published = fixture
        .execute(&nodes[1], &manifest, &staged.envelopes, &[])
        .expect("publish");

    let mut degraded = fixture.api.release("v1.2.3").expect("published release");
    degraded.assets.pop();
    fixture.api.seed_release(degraded);

    let error = fixture
        .execute(&nodes[2], &manifest, &staged.envelopes, &published.receipts)
        .expect_err("a release missing assets fails observation");
    assert_eq!(
        classified_category(&error),
        PublishFailureCategory::Conflict
    );
    assert_eq!(classified_code(&error), "release_asset_missing");
}

#[test]
fn default_settings_declare_the_route_contract_shape() {
    let fixture = Fixture::new();
    let settings = fixture.destination.default_settings();
    assert_eq!(
        settings.values.get("repository"),
        Some(&Value::String(String::new()))
    );
    assert_eq!(
        settings.values.get("tag_prefix"),
        Some(&Value::String("v".to_string()))
    );
    assert_eq!(
        settings.values.get("updater_enabled"),
        Some(&Value::Bool(false))
    );
}

#[test]
fn execution_requires_the_sealed_manifest_and_known_actions() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let nodes = fixture.nodes(&settings());

    let context = AdapterExecutionContext {
        attempt_id: "attempt-github",
        plan_digest: "plan-digest",
        snapshot_digest: "snapshot-digest",
        artifacts: &[],
        manifest: None,
        envelopes: &[],
        receipts: &[],
        credentials: &fixture.credentials,
        cancellation: publish_adapters::CancellationSignal::new(),
    };
    let error = fixture
        .destination
        .execute_node(&nodes[0], &context)
        .expect_err("execution requires the sealed manifest");
    assert!(matches!(error, PublishError::MissingArtifactManifest));

    let mut foreign = nodes[0].clone();
    foreign.operation = publish_domain::PlanOperation::AdapterAction {
        action: "not-a-github-action".to_string(),
        inputs: BTreeMap::new(),
    };
    let error = fixture
        .execute(&foreign, &manifest, &[], &[])
        .expect_err("foreign actions cannot execute on the github destination");
    assert!(error
        .to_string()
        .contains("is not a github release operation"));
}

#[test]
fn staging_requires_the_sealed_release_inputs() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let mut node = fixture.nodes(&settings()).remove(0);
    if let publish_domain::PlanOperation::AdapterAction { inputs, .. } = &mut node.operation {
        inputs.remove("version");
    }

    let error = fixture
        .execute(&node, &manifest, &[], &[])
        .expect_err("stage nodes need the sealed release version");
    assert!(matches!(error, PublishError::InvalidPlan(_)));
    assert!(error.to_string().contains("sealed release input"));
}

#[test]
fn staging_rejects_routes_without_a_repository() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let settings = settings().with_value("repository", Value::String("  ".to_string()));
    let nodes = fixture.nodes(&settings);

    let error = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect_err("staging requires a repository");
    assert_eq!(classified_code(&error), "repository_missing");
}

#[test]
fn staging_rejects_manifests_with_no_matching_release_assets() {
    let fixture = Fixture::new();
    // 平台矩阵要求的 installer 不在允许资产角色内 → 资产选择为空。
    let settings = settings().with_value(
        "allowed_asset_roles",
        Value::Array(vec![Value::String("updater-archive".to_string())]),
    );
    let nodes = fixture.nodes(&settings);
    let support_only = manifest_with(
        fixture.root.path(),
        &[("installer", "Demo.dmg", "macos", "aarch64", b"dmg-bytes")],
    );

    let error = fixture
        .execute(&nodes[0], &support_only, &[], &[])
        .expect_err("a manifest without release assets cannot stage");
    assert_eq!(classified_code(&error), "release_assets_empty");
}

#[test]
fn updater_releases_require_a_well_formed_platform_matrix() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());

    let empty = updater_settings().with_value("enabled_platforms", Value::Array(vec![]));
    let nodes = fixture.nodes(&empty);
    let error = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect_err("updater releases need a non-empty platform set");
    assert_eq!(classified_code(&error), "enabled_platforms_empty");

    let malformed = updater_settings().with_value(
        "enabled_platforms",
        Value::Array(vec![Value::String("macos".to_string())]),
    );
    let nodes = fixture.nodes(&malformed);
    let error = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect_err("platform keys must be <platform>-<architecture>");
    assert_eq!(classified_code(&error), "enabled_platform_invalid");
}

#[test]
fn updater_signatures_must_be_utf8_text() {
    let fixture = Fixture::new();
    let nodes = fixture.nodes(&updater_settings());
    let invalid_signature = manifest_with(
        fixture.root.path(),
        &[
            ("installer", "Demo.dmg", "macos", "aarch64", b"dmg-bytes"),
            (
                "updater-archive",
                "Demo.app.tar.gz",
                "macos",
                "aarch64",
                b"updater-bytes",
            ),
            (
                "updater-signature",
                "Demo.app.tar.gz.sig",
                "macos",
                "aarch64",
                &[0xff, 0xfe, 0x00],
            ),
        ],
    );

    let error = fixture
        .execute(&nodes[0], &invalid_signature, &[], &[])
        .expect_err("binary signatures cannot enter latest.json");
    assert_eq!(classified_code(&error), "updater_signature_invalid");
}

#[test]
fn publishing_requires_a_staged_envelope_and_a_resolved_token() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let nodes = fixture.nodes(&settings());

    let error = fixture
        .execute(&nodes[1], &manifest, &[], &[])
        .expect_err("publishing requires the staged envelope");
    assert!(error
        .to_string()
        .contains("has no staged github release envelope"));

    let mut unauthenticated = Fixture::new();
    unauthenticated.credentials.clear();
    let manifest = desktop_manifest(unauthenticated.root.path());
    let staged = unauthenticated
        .execute(&nodes[0], &manifest, &[], &[])
        .expect("stage envelope");
    let error = unauthenticated
        .execute(&nodes[1], &manifest, &staged.envelopes, &[])
        .expect_err("publishing requires a resolved github token");
    assert!(error.to_string().contains("github_token"));
}

#[test]
fn staged_envelope_payloads_must_be_well_formed() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let nodes = fixture.nodes(&settings());
    let staged = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect("stage envelope");

    let mut missing_repository = staged.envelopes[0].clone();
    missing_repository.content.remove("repository");
    let error = fixture
        .execute(&nodes[1], &manifest, &[missing_repository], &[])
        .expect_err("envelopes missing the repository cannot publish");
    assert!(error.to_string().contains("missing repository"));

    let mut missing_assets = staged.envelopes[0].clone();
    missing_assets.content.remove("assets");
    let error = fixture
        .execute(&nodes[1], &manifest, &[missing_assets], &[])
        .expect_err("envelopes missing the asset selection cannot publish");
    assert!(error.to_string().contains("has no asset selection"));
}

#[test]
fn synchronized_envelopes_are_validated_against_the_sealed_manifest() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let nodes = fixture.nodes(&settings());
    let staged = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect("stage envelope");

    // 缺少 manifest 的校验上下文 fail-closed。
    let credentials = fixture.credentials.clone();
    let context = AdapterExecutionContext {
        attempt_id: "attempt-github",
        plan_digest: "plan-digest",
        snapshot_digest: "snapshot",
        artifacts: &[],
        manifest: None,
        envelopes: &[],
        receipts: &[],
        credentials: &credentials,
        cancellation: publish_adapters::CancellationSignal::new(),
    };
    assert!(matches!(
        fixture
            .destination
            .validate_staged_envelope(&nodes[0], &context, &staged.envelopes[0])
            .expect_err("envelopes cannot be validated without the sealed manifest"),
        PublishError::MissingArtifactManifest
    ));

    // 与重放的 stage 输出一致的 envelope 通过校验。
    let context = AdapterExecutionContext {
        manifest: Some(&manifest),
        ..context
    };
    fixture
        .destination
        .validate_staged_envelope(&nodes[0], &context, &staged.envelopes[0])
        .expect("the staged envelope validates against its settings");

    // 篡改的 envelope 必须显式拒绝，不得容忍漂移。
    let mut tampered = staged.envelopes[0].clone();
    tampered
        .content
        .insert("tag".to_string(), Value::String("v9.9.9".to_string()));
    let error = fixture
        .destination
        .validate_staged_envelope(&nodes[0], &context, &tampered)
        .expect_err("drifted envelopes must be rejected");
    assert!(error.to_string().contains("does not match"));
}

#[test]
fn empty_tokens_fail_as_unauthorized_before_any_api_call() {
    let api = Arc::new(FakeGitHubReleaseApi::new());
    let fixture = Fixture {
        api: api.clone(),
        destination: GitHubReleaseDestination::new(api),
        root: tempfile::tempdir().expect("fixture root"),
        credentials: BTreeMap::from([(
            "github_token".to_string(),
            ResolvedCredential {
                kind: CredentialKind::Token,
                value: CredentialValue::new("   "),
            },
        )]),
    };
    let manifest = desktop_manifest(fixture.root.path());
    let nodes = fixture.nodes(&settings());
    let staged = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect("stage envelope");

    let error = fixture
        .execute(&nodes[1], &manifest, &staged.envelopes, &[])
        .expect_err("blank tokens cannot authenticate");
    assert!(matches!(
        classified_category(&error),
        PublishFailureCategory::Authentication
    ));
}

#[test]
fn the_fake_api_rejects_duplicate_tags_and_blank_tokens() {
    use publish_adapters::{GitHubReleaseApi, NewGitHubRelease};

    let api = FakeGitHubReleaseApi::new();
    let token = CredentialValue::new(TOKEN);
    let draft = NewGitHubRelease {
        tag: "v1.2.3".to_string(),
        name: "Demo 1.2.3".to_string(),
        body: "notes".to_string(),
        prerelease: false,
    };

    let created = api
        .create_draft_release(&token, "acme/demo", &draft)
        .expect("first draft");
    assert!(created.draft);

    assert!(matches!(
        api.create_draft_release(&token, "acme/demo", &draft),
        Err(GitHubApiFailure::Http { status: 422, .. })
    ));

    assert!(matches!(
        api.create_draft_release(
            &CredentialValue::new("   "),
            "acme/demo",
            &NewGitHubRelease {
                tag: "v9.9.9".to_string(),
                name: "x".to_string(),
                body: String::new(),
                prerelease: false,
            }
        ),
        Err(GitHubApiFailure::Http { status: 401, .. })
    ));
}

#[test]
fn publishing_rejects_assets_missing_from_the_sealed_manifest() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let nodes = fixture.nodes(&settings());
    let staged = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect("stage envelope");

    // 篡改资产选择：Manifest 来源但未被封存清单声明。
    let mut tampered = staged.envelopes[0].clone();
    let assets = tampered
        .content
        .get_mut("assets")
        .and_then(Value::as_array_mut)
        .expect("staged asset selection");
    assets.clear();
    assets.push(serde_json::json!({
        "name": "ghost.dmg",
        "digest": "0".repeat(64),
        "size": 1,
        "url": "https://example.com/ghost.dmg",
        "source": "manifest",
    }));

    let error = fixture
        .execute(&nodes[1], &manifest, &[tampered], &[])
        .expect_err("assets outside the sealed manifest cannot publish");
    assert!(error
        .to_string()
        .contains("not declared by the sealed manifest"));
}

#[test]
fn publishing_rejects_envelope_assets_without_envelope_content() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let nodes = fixture.nodes(&updater_settings());
    let staged = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect("stage updater envelope");

    // Envelope 派生资产（latest.json）依赖 updater_manifest 内容键。
    let mut tampered = staged.envelopes[0].clone();
    tampered.content.remove("updater_manifest");

    let error = fixture
        .execute(&nodes[1], &manifest, &[tampered], &[])
        .expect_err("envelope-sourced assets need the envelope content");
    assert!(error.to_string().contains("has no envelope content"));
}

#[test]
fn publishing_revalidates_sealed_artifact_bytes_before_upload() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let nodes = fixture.nodes(&settings());
    let staged = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect("stage envelope");

    // 封存后改动产物文件 → 上传前的摘要重验拒绝。
    let artifact = manifest
        .artifacts
        .iter()
        .find(|entry| entry.file_name.ends_with(".dmg"))
        .expect("installer entry");
    std::fs::write(&artifact.locator, b"tampered-bytes").expect("corrupt sealed artifact");

    let error = fixture
        .execute(&nodes[1], &manifest, &staged.envelopes, &[])
        .expect_err("tampered sealed artifacts must not upload");
    assert!(matches!(error, PublishError::ArtifactDigestMismatch { .. }));
}

#[test]
fn publishing_requires_a_well_formed_asset_selection() {
    let fixture = Fixture::new();
    let manifest = desktop_manifest(fixture.root.path());
    let nodes = fixture.nodes(&settings());
    let staged = fixture
        .execute(&nodes[0], &manifest, &[], &[])
        .expect("stage envelope");

    // 缺 assets 键。
    let mut missing = staged.envelopes[0].clone();
    missing.content.remove("assets");
    let error = fixture
        .execute(&nodes[1], &manifest, &[missing], &[])
        .expect_err("envelopes without an asset selection cannot publish");
    assert!(error.to_string().contains("no asset selection"));

    // 畸形的 assets 值。
    let mut malformed = staged.envelopes[0].clone();
    malformed.content.insert(
        "assets".to_string(),
        Value::String("not-an-array".to_string()),
    );
    let error = fixture
        .execute(&nodes[1], &manifest, &[malformed], &[])
        .expect_err("malformed asset selections cannot publish");
    assert!(error.to_string().contains("invalid asset selection"));
}
