use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::{Arc, Mutex};

use publish_domain::{
    sha256_hex, AdapterDescriptor, AdapterKind, AdapterSchema, AdapterSettings, ArtifactManifest,
    ArtifactManifestEntry, CredentialKind, CredentialValue, DeliveryEnvelope,
    DeliveryIdempotencyIdentity, DeliveryReceipt, DeliveryStatus, PlanNode, PlanNodeTemplate,
    PlanSideEffect, PlanStage, PlanningInputSnapshot, PublishError, PublishFailure,
    PublishFailureCategory, DELIVERY_RECEIPT_VERSION, PUBLISH_FAILURE_VERSION,
};
use serde_json::Value;

use crate::{
    conflict_failure, sealed_inputs, transient_failure, validation_failure, AdapterContract,
    AdapterExecutionContext, AdapterExecutionOutput, DeliveryDestination, DeliveryProbe,
};

pub const GITHUB_RELEASE_DESTINATION_ID: &str = "github-release";

const STAGE_ACTION: &str = "stage_github_release";
const PUBLISH_ACTION: &str = "publish_github_release";
const OBSERVE_ACTION: &str = "observe_github_release";
const TOKEN_CREDENTIAL: &str = "github_token";
const UPDATER_MANIFEST_ASSET: &str = "latest.json";
const INSTALLER_ROLE: &str = "installer";
const UPDATER_ARCHIVE_ROLE: &str = "updater-archive";
const UPDATER_SIGNATURE_ROLE: &str = "updater-signature";
const MARKER_PREFIX: &str = "<!-- one-publish-manifest:";
const MARKER_SUFFIX: &str = " -->";

/// GitHub Release 正文中的产物清单标记：让远端交付携带自己的 Manifest digest，
/// 幂等探测据此区分"同一份发布"与"占用同名标签的另一份内容"（ADR-0051）。
pub fn release_body_marker(manifest_digest: &str) -> String {
    format!("{MARKER_PREFIX}{manifest_digest}{MARKER_SUFFIX}")
}

fn marker_digest(body: &str) -> Option<&str> {
    let start = body.rfind(MARKER_PREFIX)? + MARKER_PREFIX.len();
    let rest = &body[start..];
    let end = rest.find(MARKER_SUFFIX)?;
    Some(rest[..end].trim())
}

/// GitHub Release API 的最小端口：按标签查询、创建 Draft、幂等上传资产和
/// 翻转为 Published。没有删除 Release 或移动标签的方法——已推送的版本标签
/// 不可变（ADR-0009）；`delete_asset` 只用于替换我方 Draft staging 内因中断
/// 上传残损的资产（ADR-0016/0041），公开后的资产没有删除路径。
pub trait GitHubReleaseApi: Send + Sync {
    fn find_release(
        &self,
        token: &CredentialValue,
        repository: &str,
        tag: &str,
    ) -> Result<Option<RemoteGitHubRelease>, GitHubApiFailure>;

    fn create_draft_release(
        &self,
        token: &CredentialValue,
        repository: &str,
        draft: &NewGitHubRelease,
    ) -> Result<RemoteGitHubRelease, GitHubApiFailure>;

    fn upload_asset(
        &self,
        token: &CredentialValue,
        repository: &str,
        release_id: u64,
        name: &str,
        bytes: &[u8],
    ) -> Result<(), GitHubApiFailure>;

    fn delete_asset(
        &self,
        token: &CredentialValue,
        repository: &str,
        asset_id: u64,
    ) -> Result<(), GitHubApiFailure>;

    fn publish_release(
        &self,
        token: &CredentialValue,
        repository: &str,
        release_id: u64,
    ) -> Result<RemoteGitHubRelease, GitHubApiFailure>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewGitHubRelease {
    pub tag: String,
    pub name: String,
    pub body: String,
    pub prerelease: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteGitHubRelease {
    pub id: u64,
    pub tag: String,
    pub url: String,
    pub body: String,
    pub draft: bool,
    pub prerelease: bool,
    pub assets: Vec<RemoteGitHubAsset>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteGitHubAsset {
    pub id: u64,
    pub name: String,
    pub digest: String,
    pub size: u64,
}

/// GitHub API 的结构化失败形状：发布失败分类只消费这里的结构（ADR-0056）。
/// 把传输层输出（HTTP 状态、gh CLI 的文本 stderr）转译成该结构是各 API 端口
/// 实现的本职；转译细节不外泄给 Destination 或 Runner。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitHubApiFailure {
    Network {
        message: String,
    },
    RateLimited {
        retry_after_seconds: u64,
        message: String,
    },
    Http {
        status: u16,
        message: String,
    },
}

pub struct GitHubReleaseDestination {
    descriptor: AdapterDescriptor,
    api: Arc<dyn GitHubReleaseApi>,
}

impl GitHubReleaseDestination {
    pub fn new(api: Arc<dyn GitHubReleaseApi>) -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::DeliveryDestination,
                GITHUB_RELEASE_DESTINATION_ID,
                1,
                AdapterSchema::new(1)
                    .with_required_string("repository")
                    .with_required_string("visibility")
                    .with_required_string("tag_prefix")
                    .with_required_string_list("allowed_asset_roles")
                    .with_required_boolean("updater_enabled")
                    .with_required_string_list("enabled_platforms")
                    .with_required_boolean("unsigned_release_override")
                    .with_credential(
                        "github_token",
                        CredentialKind::Token,
                        "create GitHub Releases, upload allow-listed assets, and observe delivery state",
                    ),
                publish_domain::PublishingCapability {
                    provides: vec![],
                    requires: vec![publish_domain::CapabilityRequirement::exact(
                        "stored-artifact",
                        1,
                    )],
                },
            ),
            api,
        }
    }
}

impl AdapterContract for GitHubReleaseDestination {
    fn descriptor(&self) -> &AdapterDescriptor {
        &self.descriptor
    }

    fn default_settings(&self) -> AdapterSettings {
        AdapterSettings::new(1)
            .with_value("repository", Value::String(String::new()))
            .with_value("visibility", Value::String("public".to_string()))
            .with_value("tag_prefix", Value::String("v".to_string()))
            .with_value(
                "allowed_asset_roles",
                Value::Array(vec![
                    Value::String(INSTALLER_ROLE.to_string()),
                    Value::String(UPDATER_ARCHIVE_ROLE.to_string()),
                ]),
            )
            .with_value("updater_enabled", Value::Bool(false))
            .with_value("enabled_platforms", Value::Array(vec![]))
            .with_value("unsigned_release_override", Value::Bool(false))
    }

    fn validate_settings(&self, settings: &AdapterSettings) -> Result<(), PublishError> {
        crate::validate_settings_against_schema(self.descriptor(), settings)?;
        let adapter = self.descriptor.identity().display_name();
        let visibility = settings.string("visibility", &adapter)?;
        if !matches!(visibility, "public" | "private") {
            return Err(PublishError::InvalidAdapterSettings {
                adapter,
                message: format!("visibility must be public or private, got {visibility}"),
            });
        }
        // 私有仓库发布继承仓库权限，但首版没有带认证的 Updater 下载模型（ADR-0018）。
        if visibility == "private" && settings.boolean("updater_enabled", &adapter)? {
            return Err(PublishError::InvalidAdapterSettings {
                adapter,
                message: "the Tauri updater cannot be enabled for private repository releases"
                    .to_string(),
            });
        }
        Ok(())
    }

    fn plan_fragment(
        &self,
        snapshot: &PlanningInputSnapshot,
        _settings: &AdapterSettings,
    ) -> Result<Vec<PlanNodeTemplate>, PublishError> {
        // Release Version、Release Notes 与签名声明是单次发布输入，不属于可复用
        // 配置；它们在规划时密封进 stage 节点（Issue T16 实施边界）。
        let inputs = sealed_release_inputs(snapshot)?;
        Ok(vec![
            PlanNodeTemplate::adapter_action("stage", PlanStage::StageRoutes, STAGE_ACTION, inputs)
                .with_artifact_io(vec!["artifact-manifest".to_string()], vec![]),
            PlanNodeTemplate::adapter_action(
                "publish",
                PlanStage::PublishRoutes,
                PUBLISH_ACTION,
                BTreeMap::new(),
            )
            .with_artifact_io(vec!["artifact-manifest".to_string()], vec![])
            .with_side_effects(vec![PlanSideEffect::Network])
            .irreversible(),
            PlanNodeTemplate::adapter_action(
                "observe",
                PlanStage::ObserveRoutes,
                OBSERVE_ACTION,
                BTreeMap::new(),
            )
            .with_artifact_io(vec!["artifact-manifest".to_string()], vec![]),
        ])
    }

    fn execute_node(
        &self,
        node: &PlanNode,
        context: &AdapterExecutionContext<'_>,
    ) -> Result<AdapterExecutionOutput, PublishError> {
        let manifest = context
            .manifest
            .ok_or(PublishError::MissingArtifactManifest)?;
        match crate::action_name(node)? {
            STAGE_ACTION => self.stage(node, manifest),
            PUBLISH_ACTION => self.publish(node, context, manifest),
            OBSERVE_ACTION => self.observe(node, context, manifest),
            other => Err(PublishError::Execution(format!(
                "node {} is not a github release operation: {other}",
                node.id
            ))),
        }
    }
}

/// 密封进 stage 节点的单次发布输入：目标版本必填，其余带确定性默认值。
fn sealed_release_inputs(
    snapshot: &PlanningInputSnapshot,
) -> Result<BTreeMap<String, Value>, PublishError> {
    let release_string = |key: &str| {
        snapshot
            .release_input
            .get(key)
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    let version = release_string("version").filter(|version| !version.trim().is_empty());
    let Some(version) = version else {
        return Err(PublishError::InvalidPlan(
            "github release routes require a release version input".to_string(),
        ));
    };
    let channel = release_string("channel").unwrap_or_else(|| "stable".to_string());
    Ok(BTreeMap::from([
        ("version".to_string(), Value::String(version)),
        (
            "release_notes".to_string(),
            Value::String(release_string("release_notes").unwrap_or_default()),
        ),
        ("prerelease".to_string(), Value::Bool(channel != "stable")),
        (
            "platform_code_signing".to_string(),
            Value::String(
                release_string("platform_code_signing").unwrap_or_else(|| "unsigned".to_string()),
            ),
        ),
        (
            "pub_date".to_string(),
            Value::String(snapshot.source.captured_at.clone()),
        ),
    ]))
}

fn api_failure(failure: GitHubApiFailure) -> PublishError {
    PublishError::Classified {
        failure: classify_github_failure(&failure),
    }
}

/// 从密封节点输入读取一个字符串；缺失代表计划被篡改而不是可选默认。
fn sealed_string<'a>(
    inputs: &'a BTreeMap<String, Value>,
    node: &PlanNode,
    key: &str,
) -> Result<&'a str, PublishError> {
    inputs.get(key).and_then(Value::as_str).ok_or_else(|| {
        PublishError::InvalidPlan(format!(
            "node {} is missing the sealed release input {key}",
            node.id
        ))
    })
}

/// 启用平台键 `<platform>-<architecture>`（桌面发布矩阵词汇），
/// 例如 macos-aarch64、windows-x86_64、macos-universal。
fn parse_platform_key(key: &str) -> Option<(&str, &str)> {
    let (platform, architecture) = key.split_once('-')?;
    (!platform.is_empty() && !architecture.is_empty()).then_some((platform, architecture))
}

/// Tauri Updater 清单的平台键；macOS 使用 darwin 词汇，universal 服务两种架构。
fn updater_platform_keys(platform: &str, architecture: &str) -> Vec<String> {
    match (platform, architecture) {
        ("macos", "universal") => vec!["darwin-aarch64".to_string(), "darwin-x86_64".to_string()],
        ("macos", architecture) => vec![format!("darwin-{architecture}")],
        (platform, architecture) => vec![format!("{platform}-{architecture}")],
    }
}

fn download_url(repository: &str, tag: &str, asset_name: &str) -> String {
    format!("https://github.com/{repository}/releases/download/{tag}/{asset_name}")
}

/// 资产字节来源：封存 Manifest 的产物，或路线专属 Delivery Envelope 派生内容
///（latest.json）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
enum AssetSource {
    Manifest,
    Envelope,
}

/// 路线专属资产选择的一个条目：名字、内容摘要、大小、下载 URL 与字节来源；
/// staging 写入 Envelope，publish 与 observe 从 Envelope 读回同一形状。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
struct EnvelopeAsset {
    name: String,
    digest: String,
    size: u64,
    url: String,
    source: AssetSource,
}

impl GitHubReleaseDestination {
    /// Staging：从封存 Manifest、密封发布输入和路线设置确定性生成 Delivery
    /// Envelope——目标标签、Release 正文、资产选择、下载 URL 索引和 Updater
    /// 清单都只属于本路线（ADR-0055）。所有交付前策略验证也发生在这里。
    fn stage(
        &self,
        node: &PlanNode,
        manifest: &ArtifactManifest,
    ) -> Result<AdapterExecutionOutput, PublishError> {
        let adapter = self.descriptor.identity().display_name();
        let inputs = sealed_inputs(node)?;
        let version = sealed_string(inputs, node, "version")?;
        let notes = sealed_string(inputs, node, "release_notes")?;
        let pub_date = sealed_string(inputs, node, "pub_date")?;
        let signing = sealed_string(inputs, node, "platform_code_signing")?;
        let prerelease = inputs
            .get("prerelease")
            .and_then(Value::as_bool)
            .unwrap_or(false);

        let repository = node.settings.string("repository", &adapter)?;
        if repository.trim().is_empty() {
            return Err(validation_failure(
                "repository_missing",
                "the github release route has no repository configured".to_string(),
            ));
        }
        let tag = release_tag(&node.settings, &adapter, version)?;
        let allowed_roles: BTreeSet<String> = node
            .settings
            .string_list("allowed_asset_roles", &adapter)?
            .into_iter()
            .collect();
        let updater_enabled = node.settings.boolean("updater_enabled", &adapter)?;
        let unsigned_override = node
            .settings
            .boolean("unsigned_release_override", &adapter)?;

        let platforms = enabled_platforms(node, &adapter)?;
        require_complete_platform_matrix(&platforms, manifest)?;
        if signing != "signed" && !unsigned_override {
            return Err(validation_failure(
                "unsigned_release_not_authorized",
                "the artifact set is not platform code signed and this repository has no unsigned release override".to_string(),
            ));
        }

        // 资产只来自封存 Manifest 的白名单角色：未声明文件、构建目录残留与
        // 秘密没有进入路径（ADR-0012）。
        let mut assets = Vec::new();
        for entry in &manifest.artifacts {
            if allowed_roles.contains(&entry.role) {
                assets.push(EnvelopeAsset {
                    name: entry.file_name.clone(),
                    digest: entry.digest.clone(),
                    size: entry.size,
                    url: download_url(repository, &tag, &entry.file_name),
                    source: AssetSource::Manifest,
                });
            }
        }
        if assets.is_empty() {
            return Err(validation_failure(
                "release_assets_empty",
                "no sealed artifact matches the allowed release asset roles".to_string(),
            ));
        }

        let mut content = BTreeMap::from([
            (
                "repository".to_string(),
                Value::String(repository.to_string()),
            ),
            ("tag".to_string(), Value::String(tag.clone())),
            ("release_name".to_string(), Value::String(tag.clone())),
            (
                "body".to_string(),
                Value::String(format!(
                    "{notes}\n\n{}",
                    release_body_marker(&manifest.digest)
                )),
            ),
            ("prerelease".to_string(), Value::Bool(prerelease)),
        ]);
        if updater_enabled {
            let updater_manifest = derive_updater_manifest(
                manifest, &platforms, version, notes, pub_date, repository, &tag,
            )?;
            let bytes = serialize_updater_manifest(&updater_manifest)?;
            assets.push(EnvelopeAsset {
                name: UPDATER_MANIFEST_ASSET.to_string(),
                digest: sha256_hex(&bytes),
                size: bytes.len() as u64,
                url: download_url(repository, &tag, UPDATER_MANIFEST_ASSET),
                source: AssetSource::Envelope,
            });
            content.insert("updater_manifest".to_string(), updater_manifest);
        }

        let mut names = BTreeSet::new();
        for asset in &assets {
            if !names.insert(asset.name.as_str()) {
                return Err(validation_failure(
                    "release_asset_name_conflict",
                    format!("multiple release assets share the file name {}", asset.name),
                ));
            }
        }
        content.insert(
            "assets".to_string(),
            serde_json::to_value(&assets).map_err(|error| {
                PublishError::Execution(format!("cannot serialize the asset selection: {error}"))
            })?,
        );

        let mut envelope = DeliveryEnvelope::new(node.binding_id.clone(), manifest.digest.clone());
        envelope.content = content;
        Ok(AdapterExecutionOutput {
            envelopes: vec![envelope],
            ..AdapterExecutionOutput::default()
        })
    }

    /// Publish：按幂等身份处置远端状态——不存在则创建 Draft，我方 Draft 续传缺失
    /// 资产，摘要一致的 Published 直接复用，其余一律 Conflict 阻断；完成后翻转为
    /// Published 并交出 Submitted Receipt，远端确认交给 observe 节点（ADR-0016/0039）。
    fn publish(
        &self,
        node: &PlanNode,
        context: &AdapterExecutionContext<'_>,
        manifest: &ArtifactManifest,
    ) -> Result<AdapterExecutionOutput, PublishError> {
        let envelope = route_envelope(node, context)?;
        let token = route_token(node, context)?;
        let repository = envelope_string(envelope, "repository")?;
        let tag = envelope_string(envelope, "tag")?;
        let assets = envelope_assets(envelope)?;

        let remote = self
            .api
            .find_release(token, repository, tag)
            .map_err(api_failure)?;
        let release = match remote {
            None => {
                let draft = NewGitHubRelease {
                    tag: tag.to_string(),
                    name: envelope_string(envelope, "release_name")?.to_string(),
                    body: envelope_string(envelope, "body")?.to_string(),
                    prerelease: envelope
                        .content
                        .get("prerelease")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                };
                self.api
                    .create_draft_release(token, repository, &draft)
                    .map_err(api_failure)?
            }
            Some(release) => {
                require_our_release(&release, manifest, tag)?;
                release
            }
        };

        if release.draft {
            for asset in &assets {
                let existing = release
                    .assets
                    .iter()
                    .find(|remote| remote.name == asset.name);
                if existing.is_some_and(|remote| remote.digest == asset.digest) {
                    continue;
                }
                if let Some(remote) = existing {
                    // marker 已确认这个 Draft staging 属于同一封存 Manifest，同名但
                    // 摘要不符的资产只能是中断上传残损的字节；替换它是幂等续传，
                    // 不是覆盖另一份发布（ADR-0016/0041）。
                    self.api
                        .delete_asset(token, repository, remote.id)
                        .map_err(api_failure)?;
                }
                let bytes = asset_bytes(asset, envelope, manifest)?;
                self.api
                    .upload_asset(token, repository, release.id, &asset.name, &bytes)
                    .map_err(api_failure)?;
            }
            self.api
                .publish_release(token, repository, release.id)
                .map_err(api_failure)?;
        } else {
            require_matching_assets(&release, &assets)?;
        }

        let receipt_id = sha256_hex(
            format!(
                "{}:{}:{}:{}",
                context.attempt_id, node.id, node.binding_id, manifest.digest
            )
            .as_bytes(),
        );
        Ok(AdapterExecutionOutput {
            receipts: vec![DeliveryReceipt {
                version: DELIVERY_RECEIPT_VERSION,
                receipt_id,
                revision: 1,
                route_id: node.binding_id.clone(),
                manifest_digest: manifest.digest.clone(),
                status: DeliveryStatus::Submitted,
                external_reference: release.url,
            }],
            ..AdapterExecutionOutput::default()
        })
    }

    /// Observe：重新读取远端状态并映射到通用交付生命周期；只有远端观察到
    /// Published 且内容一致才追加 Published Receipt 修订（ADR-0039）。
    fn observe(
        &self,
        node: &PlanNode,
        context: &AdapterExecutionContext<'_>,
        manifest: &ArtifactManifest,
    ) -> Result<AdapterExecutionOutput, PublishError> {
        let envelope = route_envelope(node, context)?;
        let token = route_token(node, context)?;
        let repository = envelope_string(envelope, "repository")?;
        let tag = envelope_string(envelope, "tag")?;
        let previous = context
            .receipts
            .iter()
            .rev()
            .find(|receipt| receipt.route_id == node.binding_id)
            .ok_or_else(|| {
                PublishError::Execution(format!(
                    "route {} has no submitted delivery receipt to observe",
                    node.binding_id
                ))
            })?;

        let release = self
            .api
            .find_release(token, repository, tag)
            .map_err(api_failure)?
            .ok_or_else(|| {
                transient_failure(
                    "release_not_observable",
                    format!("release {tag} is not observable on {repository} yet"),
                )
            })?;
        require_our_release(&release, manifest, tag)?;
        if release.draft {
            return Err(transient_failure(
                "release_still_draft",
                format!("release {tag} on {repository} is still a draft"),
            ));
        }
        require_matching_assets(&release, &envelope_assets(envelope)?)?;

        Ok(AdapterExecutionOutput {
            receipts: vec![DeliveryReceipt {
                version: DELIVERY_RECEIPT_VERSION,
                receipt_id: previous.receipt_id.clone(),
                revision: previous.revision.checked_add(1).ok_or_else(|| {
                    PublishError::Execution(format!(
                        "delivery receipt {} exhausted its revision range",
                        previous.receipt_id
                    ))
                })?,
                route_id: previous.route_id.clone(),
                manifest_digest: previous.manifest_digest.clone(),
                status: DeliveryStatus::Published,
                external_reference: previous.external_reference.clone(),
            }],
            ..AdapterExecutionOutput::default()
        })
    }
}

fn enabled_platforms(
    node: &PlanNode,
    adapter: &str,
) -> Result<Vec<(String, String)>, PublishError> {
    let keys = node.settings.string_list("enabled_platforms", adapter)?;
    if keys.is_empty() {
        return Err(validation_failure(
            "enabled_platforms_empty",
            "the enabled platform set for github releases cannot be empty".to_string(),
        ));
    }
    keys.iter()
        .map(|key| {
            parse_platform_key(key)
                .map(|(platform, architecture)| (platform.to_string(), architecture.to_string()))
                .ok_or_else(|| {
                    validation_failure(
                        "enabled_platform_invalid",
                        format!("enabled platform {key} is not a <platform>-<architecture> key"),
                    )
                })
        })
        .collect()
}

/// 启用平台集合是每次发布都必须完整成功的子集：任何启用平台缺少安装包都阻断。
fn require_complete_platform_matrix(
    platforms: &[(String, String)],
    manifest: &ArtifactManifest,
) -> Result<(), PublishError> {
    for (platform, architecture) in platforms {
        let covered = manifest.artifacts.iter().any(|entry| {
            entry.role == INSTALLER_ROLE
                && entry.platform == *platform
                && entry.architecture == *architecture
        });
        if !covered {
            return Err(validation_failure(
                "enabled_platform_missing",
                format!(
                    "the sealed manifest has no installer for enabled platform {platform}-{architecture}"
                ),
            ));
        }
    }
    Ok(())
}

/// Updater-enabled 发布必须为每个启用平台提供完整更新包与 Updater 签名；
/// 签名内容进入路线专属 latest.json，签名文件本身不因此成为 Release 附件。
fn derive_updater_manifest(
    manifest: &ArtifactManifest,
    platforms: &[(String, String)],
    version: &str,
    notes: &str,
    pub_date: &str,
    repository: &str,
    tag: &str,
) -> Result<Value, PublishError> {
    let mut platform_entries = serde_json::Map::new();
    for (platform, architecture) in platforms {
        let archive = manifest
            .artifacts
            .iter()
            .find(|entry| {
                entry.role == UPDATER_ARCHIVE_ROLE
                    && entry.platform == *platform
                    && entry.architecture == *architecture
            })
            .ok_or_else(|| {
                validation_failure(
                    "updater_archive_missing",
                    format!(
                        "the updater-enabled release has no update package for {platform}-{architecture}"
                    ),
                )
            })?;
        let signature_name = format!("{}.sig", archive.file_name);
        let signature = manifest
            .artifacts
            .iter()
            .find(|entry| entry.role == UPDATER_SIGNATURE_ROLE && entry.file_name == signature_name)
            .ok_or_else(|| {
                validation_failure(
                    "updater_signature_missing",
                    format!(
                        "the updater package {} has no signature {signature_name}",
                        archive.file_name
                    ),
                )
            })?;
        let signature_bytes = read_verified_artifact(signature)?;
        let signature_text = String::from_utf8(signature_bytes).map_err(|_| {
            validation_failure(
                "updater_signature_invalid",
                format!("updater signature {signature_name} is not valid UTF-8"),
            )
        })?;
        let entry = serde_json::json!({
            "signature": signature_text,
            "url": download_url(repository, tag, &archive.file_name),
        });
        for key in updater_platform_keys(platform, architecture) {
            platform_entries.insert(key, entry.clone());
        }
    }
    Ok(serde_json::json!({
        "version": version,
        "notes": notes,
        "pub_date": pub_date,
        "platforms": Value::Object(platform_entries),
    }))
}

fn serialize_updater_manifest(manifest: &Value) -> Result<Vec<u8>, PublishError> {
    serde_json::to_vec_pretty(manifest).map_err(|error| {
        PublishError::Execution(format!("cannot serialize the updater manifest: {error}"))
    })
}

fn route_envelope<'a>(
    node: &PlanNode,
    context: &'a AdapterExecutionContext<'_>,
) -> Result<&'a DeliveryEnvelope, PublishError> {
    context
        .envelopes
        .iter()
        .find(|envelope| envelope.route_id == node.binding_id)
        .ok_or_else(|| {
            PublishError::Execution(format!(
                "route {} has no staged github release envelope",
                node.binding_id
            ))
        })
}

fn route_token<'a>(
    node: &PlanNode,
    context: &'a AdapterExecutionContext<'_>,
) -> Result<&'a CredentialValue, PublishError> {
    resolved_token(context.credentials, &node.binding_id)
}

/// 当前 Execution Backend 解析好的 GitHub token；执行与幂等探测共用同一凭据边界。
fn resolved_token<'a>(
    credentials: &'a BTreeMap<String, publish_domain::ResolvedCredential>,
    route_id: &str,
) -> Result<&'a CredentialValue, PublishError> {
    credentials
        .get(TOKEN_CREDENTIAL)
        .map(|credential| &credential.value)
        .ok_or_else(|| {
            PublishError::Execution(format!(
                "route {route_id} has no resolved {TOKEN_CREDENTIAL} credential"
            ))
        })
}

/// 版本标签由路线的标签前缀与单次发布版本拼成；staging 与幂等探测共用一条规则。
fn release_tag(
    settings: &AdapterSettings,
    adapter: &str,
    version: &str,
) -> Result<String, PublishError> {
    Ok(format!(
        "{}{version}",
        settings.string("tag_prefix", adapter)?
    ))
}

fn envelope_string<'a>(envelope: &'a DeliveryEnvelope, key: &str) -> Result<&'a str, PublishError> {
    envelope
        .content
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| {
            PublishError::Execution(format!(
                "the staged envelope for route {} is missing {key}",
                envelope.route_id
            ))
        })
}

/// Envelope 中的资产选择：staging 写入的同一 `EnvelopeAsset` 形状原样读回。
fn envelope_assets(envelope: &DeliveryEnvelope) -> Result<Vec<EnvelopeAsset>, PublishError> {
    let assets = envelope.content.get("assets").ok_or_else(|| {
        PublishError::Execution(format!(
            "the staged envelope for route {} has no asset selection",
            envelope.route_id
        ))
    })?;
    serde_json::from_value(assets.clone()).map_err(|error| {
        PublishError::Execution(format!(
            "the staged envelope for route {} has an invalid asset selection: {error}",
            envelope.route_id
        ))
    })
}

/// 解析一个资产的实际字节：Manifest 资产从 Artifact Store 定位符读取并验证摘要，
/// Envelope 派生资产（latest.json）从路线封装重新序列化并比对 staging 时的摘要。
fn asset_bytes(
    asset: &EnvelopeAsset,
    envelope: &DeliveryEnvelope,
    manifest: &ArtifactManifest,
) -> Result<Vec<u8>, PublishError> {
    let bytes = match asset.source {
        AssetSource::Manifest => {
            let entry = manifest
                .artifacts
                .iter()
                .find(|entry| entry.file_name == asset.name && entry.digest == asset.digest)
                .ok_or_else(|| {
                    PublishError::Execution(format!(
                        "staged asset {} is not declared by the sealed manifest",
                        asset.name
                    ))
                })?;
            read_verified_artifact(entry)?
        }
        AssetSource::Envelope => serialize_updater_manifest(
            envelope.content.get("updater_manifest").ok_or_else(|| {
                PublishError::Execution(format!(
                    "staged asset {} has no envelope content to upload",
                    asset.name
                ))
            })?,
        )?,
    };
    let digest = sha256_hex(&bytes);
    if digest != asset.digest {
        return Err(PublishError::ArtifactDigestMismatch {
            artifact: asset.name.clone(),
            expected: asset.digest.clone(),
            actual: digest,
        });
    }
    Ok(bytes)
}

fn read_verified_artifact(entry: &ArtifactManifestEntry) -> Result<Vec<u8>, PublishError> {
    let bytes = std::fs::read(&entry.locator).map_err(|error| PublishError::Io {
        operation: format!("read sealed artifact {}", entry.locator),
        message: error.to_string(),
    })?;
    let digest = sha256_hex(&bytes);
    if digest != entry.digest {
        return Err(PublishError::ArtifactDigestMismatch {
            artifact: entry.locator.clone(),
            expected: entry.digest.clone(),
            actual: digest,
        });
    }
    Ok(bytes)
}

/// 同名标签下的远端 Release 必须携带我们的 Manifest 标记：缺失或不一致都代表
/// 另一份发布内容占用了这个标签——不覆盖、不删除、不移动（ADR-0009）。
fn require_our_release(
    release: &RemoteGitHubRelease,
    manifest: &ArtifactManifest,
    tag: &str,
) -> Result<(), PublishError> {
    match marker_digest(&release.body) {
        Some(digest) if digest == manifest.digest => Ok(()),
        Some(digest) => Err(conflict_failure(
            "release_manifest_conflict",
            format!(
                "release {tag} at {} carries manifest {digest}, expected {}; pushed release tags are immutable",
                release.url, manifest.digest
            ),
        )),
        None => Err(conflict_failure(
            "release_not_managed",
            format!(
                "release {tag} at {} was not delivered from this artifact set; refusing to touch it",
                release.url
            ),
        )),
    }
}

/// 远端资产必须与路线的资产选择完全一致：名字集合与内容摘要都不能偏离。
fn require_matching_assets(
    release: &RemoteGitHubRelease,
    expected: &[EnvelopeAsset],
) -> Result<(), PublishError> {
    for asset in expected {
        let remote = release
            .assets
            .iter()
            .find(|remote| remote.name == asset.name)
            .ok_or_else(|| {
                conflict_failure(
                    "release_asset_missing",
                    format!(
                        "published release {} is missing asset {}",
                        release.tag, asset.name
                    ),
                )
            })?;
        if remote.digest != asset.digest {
            return Err(conflict_failure(
                "release_asset_digest_conflict",
                format!(
                    "published asset {} has digest {}, expected {}",
                    asset.name, remote.digest, asset.digest
                ),
            ));
        }
    }
    Ok(())
}

impl DeliveryDestination for GitHubReleaseDestination {
    /// 自动重试前按交付幂等身份探测远端（ADR-0051）：标签缺失或我方未完成的
    /// Draft 允许重新执行，摘要一致的 Published 复用既有交付，其余一律冲突。
    fn probe_delivery(
        &self,
        settings: &AdapterSettings,
        identity: &DeliveryIdempotencyIdentity,
        credentials: &BTreeMap<String, publish_domain::ResolvedCredential>,
    ) -> Result<DeliveryProbe, PublishError> {
        let adapter = self.descriptor.identity().display_name();
        let repository = settings.string("repository", &adapter)?;
        let tag = release_tag(settings, &adapter, &identity.release_identity.version)?;
        let token = resolved_token(credentials, &identity.route_id)?;
        let release = self
            .api
            .find_release(token, repository, &tag)
            .map_err(api_failure)?;
        let Some(release) = release else {
            return Ok(DeliveryProbe::Absent);
        };
        let matches = marker_digest(&release.body) == Some(identity.manifest_digest.as_str());
        Ok(match (release.draft, matches) {
            (true, true) => DeliveryProbe::Absent,
            (false, true) => DeliveryProbe::Matching {
                external_reference: release.url,
            },
            (_, false) => DeliveryProbe::Conflicting {
                external_reference: release.url,
            },
        })
    }
}

/// 一次 Fake API 操作的注入失败键：与端口方法一一对应。
pub const FAKE_OPERATION_FIND: &str = "find_release";
pub const FAKE_OPERATION_CREATE: &str = "create_draft_release";
pub const FAKE_OPERATION_UPLOAD: &str = "upload_asset";
pub const FAKE_OPERATION_DELETE_ASSET: &str = "delete_asset";
pub const FAKE_OPERATION_PUBLISH: &str = "publish_release";

#[derive(Default)]
struct FakeGitHubState {
    releases: BTreeMap<String, RemoteGitHubRelease>,
    next_id: u64,
    failures: BTreeMap<String, VecDeque<GitHubApiFailure>>,
    calls: BTreeMap<String, usize>,
    tokens: Vec<String>,
}

/// 内存 Fake GitHub API：以真实语义建模创建、上传、发布与查询，支持按操作
/// 注入失败（覆盖限流、网络与 HTTP 错误），供矩阵测试与后端合同测试复用。
#[derive(Default)]
pub struct FakeGitHubReleaseApi {
    state: Mutex<FakeGitHubState>,
}

impl FakeGitHubReleaseApi {
    pub fn new() -> Self {
        Self::default()
    }

    /// 注入下一次指定操作的失败；同一操作可以排队多次失败。
    pub fn fail_next(&self, operation: &str, failure: GitHubApiFailure) {
        self.lock()
            .failures
            .entry(operation.to_string())
            .or_default()
            .push_back(failure);
    }

    /// 预置一个远端 Release（draft 或 published），用于幂等与冲突场景。
    pub fn seed_release(&self, release: RemoteGitHubRelease) {
        let mut state = self.lock();
        let highest_seeded_id = release
            .assets
            .iter()
            .map(|asset| asset.id)
            .chain([release.id])
            .max()
            .unwrap_or(0);
        state.next_id = state.next_id.max(highest_seeded_id);
        state.releases.insert(release.tag.clone(), release);
    }

    pub fn release(&self, tag: &str) -> Option<RemoteGitHubRelease> {
        self.lock().releases.get(tag).cloned()
    }

    pub fn calls(&self, operation: &str) -> usize {
        self.lock().calls.get(operation).copied().unwrap_or(0)
    }

    /// Fake 观察到的全部 token 值；用于断言凭据只在执行边界出现。
    pub fn observed_tokens(&self) -> Vec<String> {
        self.lock().tokens.clone()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, FakeGitHubState> {
        self.state.lock().expect("fake GitHub API state")
    }

    fn enter(
        &self,
        operation: &str,
        token: &CredentialValue,
    ) -> Result<std::sync::MutexGuard<'_, FakeGitHubState>, GitHubApiFailure> {
        let mut state = self.lock();
        *state.calls.entry(operation.to_string()).or_insert(0) += 1;
        state.tokens.push(token.expose().to_string());
        if token.expose().trim().is_empty() {
            return Err(GitHubApiFailure::Http {
                status: 401,
                message: "missing GitHub token".to_string(),
            });
        }
        if let Some(failure) = state
            .failures
            .get_mut(operation)
            .and_then(VecDeque::pop_front)
        {
            return Err(failure);
        }
        Ok(state)
    }
}

impl GitHubReleaseApi for FakeGitHubReleaseApi {
    fn find_release(
        &self,
        token: &CredentialValue,
        _repository: &str,
        tag: &str,
    ) -> Result<Option<RemoteGitHubRelease>, GitHubApiFailure> {
        let state = self.enter(FAKE_OPERATION_FIND, token)?;
        Ok(state.releases.get(tag).cloned())
    }

    fn create_draft_release(
        &self,
        token: &CredentialValue,
        repository: &str,
        draft: &NewGitHubRelease,
    ) -> Result<RemoteGitHubRelease, GitHubApiFailure> {
        let mut state = self.enter(FAKE_OPERATION_CREATE, token)?;
        if state.releases.contains_key(&draft.tag) {
            return Err(GitHubApiFailure::Http {
                status: 422,
                message: format!("release for tag {} already exists", draft.tag),
            });
        }
        state.next_id += 1;
        let release = RemoteGitHubRelease {
            id: state.next_id,
            tag: draft.tag.clone(),
            url: format!("https://github.com/{repository}/releases/tag/{}", draft.tag),
            body: draft.body.clone(),
            draft: true,
            prerelease: draft.prerelease,
            assets: Vec::new(),
        };
        state.releases.insert(draft.tag.clone(), release.clone());
        Ok(release)
    }

    fn upload_asset(
        &self,
        token: &CredentialValue,
        _repository: &str,
        release_id: u64,
        name: &str,
        bytes: &[u8],
    ) -> Result<(), GitHubApiFailure> {
        let mut state = self.enter(FAKE_OPERATION_UPLOAD, token)?;
        state.next_id += 1;
        let asset_id = state.next_id;
        let release = state
            .releases
            .values_mut()
            .find(|release| release.id == release_id)
            .ok_or_else(|| GitHubApiFailure::Http {
                status: 404,
                message: format!("release {release_id} does not exist"),
            })?;
        if release.assets.iter().any(|asset| asset.name == name) {
            return Err(GitHubApiFailure::Http {
                status: 422,
                message: format!("asset {name} already exists on release {release_id}"),
            });
        }
        release.assets.push(RemoteGitHubAsset {
            id: asset_id,
            name: name.to_string(),
            digest: publish_domain::sha256_hex(bytes),
            size: bytes.len() as u64,
        });
        Ok(())
    }

    fn delete_asset(
        &self,
        token: &CredentialValue,
        _repository: &str,
        asset_id: u64,
    ) -> Result<(), GitHubApiFailure> {
        let mut state = self.enter(FAKE_OPERATION_DELETE_ASSET, token)?;
        let release = state
            .releases
            .values_mut()
            .find(|release| release.assets.iter().any(|asset| asset.id == asset_id))
            .ok_or_else(|| GitHubApiFailure::Http {
                status: 404,
                message: format!("asset {asset_id} does not exist"),
            })?;
        release.assets.retain(|asset| asset.id != asset_id);
        Ok(())
    }

    fn publish_release(
        &self,
        token: &CredentialValue,
        _repository: &str,
        release_id: u64,
    ) -> Result<RemoteGitHubRelease, GitHubApiFailure> {
        let mut state = self.enter(FAKE_OPERATION_PUBLISH, token)?;
        let release = state
            .releases
            .values_mut()
            .find(|release| release.id == release_id)
            .ok_or_else(|| GitHubApiFailure::Http {
                status: 404,
                message: format!("release {release_id} does not exist"),
            })?;
        release.draft = false;
        Ok(release.clone())
    }
}

/// 把 GitHub API 失败映射为封闭的发布失败分类（ADR-0056）：只有网络中断、
/// 服务端错误与限流有自动重试资格；网络失败的副作用不确定（retry_safe=false）。
pub fn classify_github_failure(failure: &GitHubApiFailure) -> PublishFailure {
    let (category, native_code, message, retry_safe, retry_after_seconds) = match failure {
        GitHubApiFailure::Network { message } => (
            PublishFailureCategory::Transient,
            "network".to_string(),
            message.clone(),
            false,
            None,
        ),
        GitHubApiFailure::RateLimited {
            retry_after_seconds,
            message,
        } => (
            PublishFailureCategory::RateLimited,
            "rate_limited".to_string(),
            message.clone(),
            true,
            Some(*retry_after_seconds),
        ),
        GitHubApiFailure::Http { status, message } => {
            let category = match status {
                401 => PublishFailureCategory::Authentication,
                403 => PublishFailureCategory::Authorization,
                409 => PublishFailureCategory::Conflict,
                400 | 404 | 422 => PublishFailureCategory::Validation,
                500..=599 => PublishFailureCategory::Transient,
                _ => PublishFailureCategory::Unknown,
            };
            (
                category,
                format!("http_{status}"),
                message.clone(),
                *status >= 500,
                None,
            )
        }
    };
    PublishFailure {
        version: PUBLISH_FAILURE_VERSION,
        category,
        native_code,
        message,
        retry_safe,
        retry_after_seconds,
    }
}

/// GitHub 的 gh CLI 不透出限流响应的 Retry-After 头，识别到限流时使用这个
/// 保守等待秒数。
const DEFAULT_RATE_LIMIT_RETRY_SECONDS: u64 = 60;
const GH_PROGRAM: &str = "gh";

/// 通过 `gh` CLI 访问真实 GitHub Release API 的生产端口：本机与 GitHub Actions
/// 后端共用同一 Destination 语义，只有传输不同。凭据以 GH_TOKEN 传入子进程
/// 环境，不进入参数或任何序列化面（ADR-0029）。
pub struct GhCliGitHubReleaseApi;

impl GhCliGitHubReleaseApi {
    pub fn new() -> Self {
        Self
    }

    fn run(
        &self,
        token: &CredentialValue,
        args: &[&str],
        stdin: Option<&[u8]>,
    ) -> Result<String, GitHubApiFailure> {
        use std::io::Write;
        use std::process::Stdio;

        let mut command = std::process::Command::new(GH_PROGRAM);
        command
            .args(args)
            .env("GH_TOKEN", token.expose())
            .stdin(if stdin.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = command.spawn().map_err(|error| GitHubApiFailure::Network {
            message: format!("failed to start {GH_PROGRAM}: {error}"),
        })?;
        if let (Some(bytes), Some(mut pipe)) = (stdin, child.stdin.take()) {
            pipe.write_all(bytes)
                .map_err(|error| GitHubApiFailure::Network {
                    message: format!("failed to stream the asset to {GH_PROGRAM}: {error}"),
                })?;
        }
        let output = child
            .wait_with_output()
            .map_err(|error| GitHubApiFailure::Network {
                message: format!("failed to run {GH_PROGRAM}: {error}"),
            })?;
        if output.status.success() {
            return Ok(String::from_utf8_lossy(&output.stdout).to_string());
        }
        Err(parse_gh_cli_failure(&String::from_utf8_lossy(
            &output.stderr,
        )))
    }
}

impl Default for GhCliGitHubReleaseApi {
    fn default() -> Self {
        Self::new()
    }
}

impl GitHubReleaseApi for GhCliGitHubReleaseApi {
    fn find_release(
        &self,
        token: &CredentialValue,
        repository: &str,
        tag: &str,
    ) -> Result<Option<RemoteGitHubRelease>, GitHubApiFailure> {
        // 已推送标签的 Release 用按标签端点精确查询，不受列表分页影响——
        // Matching/Conflicting 判定不能因仓库 Release 数量漏判。Draft 没有
        // 标签 ref（404），回退到最近列表找我方 staging（ADR-0016 的失败
        // 重跑复用同一 Draft）。
        match self.run(
            token,
            &["api", &format!("repos/{repository}/releases/tags/{tag}")],
            None,
        ) {
            Ok(json) => {
                parse_release(&serde_json::from_str(&json).map_err(invalid_gh_json)?).map(Some)
            }
            Err(GitHubApiFailure::Http { status: 404, .. }) => {
                let json = self.run(
                    token,
                    &["api", &format!("repos/{repository}/releases?per_page=100")],
                    None,
                )?;
                parse_release_list(&json, tag)
            }
            Err(failure) => Err(failure),
        }
    }

    fn create_draft_release(
        &self,
        token: &CredentialValue,
        repository: &str,
        draft: &NewGitHubRelease,
    ) -> Result<RemoteGitHubRelease, GitHubApiFailure> {
        let json = self.run(
            token,
            &[
                "api",
                "--method",
                "POST",
                &format!("repos/{repository}/releases"),
                "-f",
                &format!("tag_name={}", draft.tag),
                "-f",
                &format!("name={}", draft.name),
                "-f",
                &format!("body={}", draft.body),
                "-F",
                "draft=true",
                "-F",
                &format!("prerelease={}", draft.prerelease),
            ],
            None,
        )?;
        parse_release(&serde_json::from_str(&json).map_err(invalid_gh_json)?)
    }

    fn upload_asset(
        &self,
        token: &CredentialValue,
        repository: &str,
        release_id: u64,
        name: &str,
        bytes: &[u8],
    ) -> Result<(), GitHubApiFailure> {
        self.run(
            token,
            &[
                "api",
                "--method",
                "POST",
                &format!(
                    "https://uploads.github.com/repos/{repository}/releases/{release_id}/assets?name={name}"
                ),
                "-H",
                "Content-Type: application/octet-stream",
                "--input",
                "-",
            ],
            Some(bytes),
        )?;
        Ok(())
    }

    fn delete_asset(
        &self,
        token: &CredentialValue,
        repository: &str,
        asset_id: u64,
    ) -> Result<(), GitHubApiFailure> {
        self.run(
            token,
            &[
                "api",
                "--method",
                "DELETE",
                &format!("repos/{repository}/releases/assets/{asset_id}"),
            ],
            None,
        )?;
        Ok(())
    }

    fn publish_release(
        &self,
        token: &CredentialValue,
        repository: &str,
        release_id: u64,
    ) -> Result<RemoteGitHubRelease, GitHubApiFailure> {
        let json = self.run(
            token,
            &[
                "api",
                "--method",
                "PATCH",
                &format!("repos/{repository}/releases/{release_id}"),
                "-F",
                "draft=false",
            ],
            None,
        )?;
        parse_release(&serde_json::from_str(&json).map_err(invalid_gh_json)?)
    }
}

fn invalid_gh_json(error: serde_json::Error) -> GitHubApiFailure {
    GitHubApiFailure::Network {
        message: format!("gh returned an unreadable GitHub API response: {error}"),
    }
}

/// 从 gh 的 REST 列表响应中挑出目标标签的 Release（含 Draft）。
pub fn parse_release_list(
    json: &str,
    tag: &str,
) -> Result<Option<RemoteGitHubRelease>, GitHubApiFailure> {
    let releases: Vec<Value> = serde_json::from_str(json).map_err(invalid_gh_json)?;
    releases
        .iter()
        .find(|release| release.get("tag_name").and_then(Value::as_str) == Some(tag))
        .map(parse_release)
        .transpose()
}

fn parse_release(release: &Value) -> Result<RemoteGitHubRelease, GitHubApiFailure> {
    let field = |name: &str| {
        release
            .get(name)
            .cloned()
            .ok_or_else(|| GitHubApiFailure::Network {
                message: format!("GitHub API release response is missing {name}"),
            })
    };
    let assets = release
        .get("assets")
        .and_then(Value::as_array)
        .map(|assets| {
            assets
                .iter()
                .map(|asset| RemoteGitHubAsset {
                    id: asset.get("id").and_then(Value::as_u64).unwrap_or(0),
                    name: asset
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    digest: asset
                        .get("digest")
                        .and_then(Value::as_str)
                        .and_then(|digest| digest.strip_prefix("sha256:"))
                        .unwrap_or_default()
                        .to_string(),
                    size: asset.get("size").and_then(Value::as_u64).unwrap_or(0),
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(RemoteGitHubRelease {
        id: field("id")?
            .as_u64()
            .ok_or_else(|| GitHubApiFailure::Network {
                message: "GitHub API release response has a non-numeric id".to_string(),
            })?,
        tag: field("tag_name")?.as_str().unwrap_or_default().to_string(),
        url: field("html_url")?.as_str().unwrap_or_default().to_string(),
        body: release
            .get("body")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        draft: field("draft")?.as_bool().unwrap_or(false),
        prerelease: release
            .get("prerelease")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        assets,
    })
}

/// 把 gh CLI 的失败输出映射为结构化 API 失败。gh 只提供文本 stderr，这里的
/// `(HTTP NNN)` 状态提取与限流提示识别是该传输边界内的一次性转译；转译结果
/// 之外的任何环节（Destination 分类、Runner 重试）都只消费结构化形状，不再
/// 接触错误字符串（ADR-0056 的边界在 GitHubApiFailure，不在 stderr）。
pub fn parse_gh_cli_failure(stderr: &str) -> GitHubApiFailure {
    let message = stderr.trim().to_string();
    if message.to_lowercase().contains("rate limit") {
        return GitHubApiFailure::RateLimited {
            retry_after_seconds: DEFAULT_RATE_LIMIT_RETRY_SECONDS,
            message,
        };
    }
    if let Some(status) = message.rfind("(HTTP ").and_then(|start| {
        let rest = &message[start + "(HTTP ".len()..];
        let end = rest.find(')')?;
        rest[..end].parse::<u16>().ok()
    }) {
        return GitHubApiFailure::Http { status, message };
    }
    GitHubApiFailure::Network { message }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_gh_release_lists_including_drafts_and_asset_digests() {
        let json = r#"[
            {"id": 11, "tag_name": "v0.9.0", "html_url": "https://github.com/acme/demo/releases/tag/v0.9.0",
             "body": "old", "draft": false, "prerelease": false, "assets": []},
            {"id": 12, "tag_name": "v1.0.0", "html_url": "https://github.com/acme/demo/releases/tag/v1.0.0",
             "body": null, "draft": true, "prerelease": true,
             "assets": [{"id": 77, "name": "app.dmg", "digest": "sha256:abc123", "size": 9}]}
        ]"#;
        let release = parse_release_list(json, "v1.0.0")
            .expect("parse the release list")
            .expect("find the draft release");
        assert_eq!(release.id, 12);
        assert!(release.draft);
        assert!(release.prerelease);
        assert_eq!(release.body, "");
        assert_eq!(release.assets[0].digest, "abc123");
        assert!(parse_release_list(json, "v9.9.9")
            .expect("parse the release list")
            .is_none());
    }

    #[test]
    fn maps_gh_cli_failures_onto_structured_api_failures() {
        assert_eq!(
            parse_gh_cli_failure("gh: Not Found (HTTP 404)"),
            GitHubApiFailure::Http {
                status: 404,
                message: "gh: Not Found (HTTP 404)".to_string(),
            }
        );
        assert!(matches!(
            parse_gh_cli_failure("gh: API rate limit exceeded for installation (HTTP 403)"),
            GitHubApiFailure::RateLimited { .. }
        ));
        assert!(matches!(
            parse_gh_cli_failure("dial tcp: connection refused"),
            GitHubApiFailure::Network { .. }
        ));
    }
}
