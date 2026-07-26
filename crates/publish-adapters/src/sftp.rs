use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::{Arc, Mutex};

use publish_domain::{
    sha256_hex, AdapterDescriptor, AdapterKind, AdapterSchema, AdapterSettings, ArtifactManifest,
    CredentialKind, CredentialValue, DeliveryEnvelope, DeliveryReceipt, DeliveryStatus,
    PlanNodeTemplate, PlanSideEffect, PlanStage, PlanningInputSnapshot, PublishError,
    PublishFailure, PublishFailureCategory, DELIVERY_RECEIPT_VERSION, PUBLISH_FAILURE_VERSION,
};
use serde_json::Value;

use crate::{
    conflict_failure, sealed_inputs, transient_failure, validation_failure, AdapterContract,
    DeliveryDestination,
};

pub const SFTP_DESTINATION_ID: &str = "sftp";

/// 远端交付记录文件：随产物一起交付的路线专属清单，先于所有产物提交。
/// 它让每个远端交付携带自己的 Manifest digest——幂等探测据此区分
/// "同一份发布"与"占用同一路径的另一份内容"（ADR-0051）。
pub const SFTP_DELIVERY_RECORD_NAME: &str = "one-publish-delivery.json";

const STAGE_ACTION: &str = "stage_sftp_delivery";
const PUBLISH_ACTION: &str = "publish_sftp_delivery";
const OBSERVE_ACTION: &str = "observe_sftp_delivery";
const KEY_CREDENTIAL: &str = "ssh_private_key";

/// SFTP 会话的非秘密目标身份：主机、端口与登录用户。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SftpEndpoint {
    pub host: String,
    pub port: u16,
    pub username: String,
}

impl SftpEndpoint {
    /// 非秘密目标标识（不含路径），用于摘要、Receipt 与探测引用。
    pub fn target(&self) -> String {
        format!("sftp://{}@{}:{}", self.username, self.host, self.port)
    }
}

/// SFTP 传输层的结构化失败形状：发布失败分类只消费这里的结构（ADR-0056）。
/// 把传输输出（openssh 客户端 stderr、连接错误）转译成该结构是各端口实现的
/// 本职；转译细节不外泄给 Destination 或 Runner。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SftpTransportFailure {
    /// 连接建立或传输中断：副作用不确定，只有幂等探测确认后才能重试。
    Network { message: String },
    /// 服务器拒绝所提供的身份凭据。
    Authentication { message: String },
    /// 已认证会话缺少目标路径所需的权限。
    PermissionDenied { message: String },
    /// 服务器返回预期之外的协议结果（路径丢失、意外覆盖等）。
    Protocol { message: String },
}

/// SFTP 文件传输的最小端口：exists/read/write/rename/create_directories/remove。
/// 凭据与执行边界一致，由当前 Execution Backend 解析后传入（ADR-0029）；
/// 原子改名、目录创建与覆盖语义是显式端口能力，不是协议分支（ADR-0047）。
pub trait SftpTransport: Send + Sync {
    fn exists(
        &self,
        key: &CredentialValue,
        endpoint: &SftpEndpoint,
        path: &str,
    ) -> Result<bool, SftpTransportFailure>;

    fn read(
        &self,
        key: &CredentialValue,
        endpoint: &SftpEndpoint,
        path: &str,
    ) -> Result<Vec<u8>, SftpTransportFailure>;

    fn write(
        &self,
        key: &CredentialValue,
        endpoint: &SftpEndpoint,
        path: &str,
        bytes: &[u8],
    ) -> Result<(), SftpTransportFailure>;

    /// 原子改名提交。实现不保证目标已存在时失败——openssh 客户端在服务器
    /// 支持 posix-rename 扩展时会覆盖目标；"同路径不同摘要不覆盖"由交付
    /// 流程的 exists + 摘要读回守卫承担，Fake 以更严格的拒绝覆盖语义建模，
    /// 用于捕捉缺失守卫的调用（ADR-0047 显式能力）。
    fn rename(
        &self,
        key: &CredentialValue,
        endpoint: &SftpEndpoint,
        from: &str,
        to: &str,
    ) -> Result<(), SftpTransportFailure>;

    /// 逐级创建目录；已存在的层级不是错误。
    fn create_directories(
        &self,
        key: &CredentialValue,
        endpoint: &SftpEndpoint,
        path: &str,
    ) -> Result<(), SftpTransportFailure>;

    fn remove(
        &self,
        key: &CredentialValue,
        endpoint: &SftpEndpoint,
        path: &str,
    ) -> Result<(), SftpTransportFailure>;
}

/// 把 SFTP 传输失败映射为封闭的发布失败分类（ADR-0056）：只有网络中断具备
/// 自动重试资格且副作用不确定（retry_safe=false，必须先幂等探测）；认证与
/// 权限失败发生在副作用之前（retry_safe=true）但不允许自动重试；协议异常
/// 归入 Unknown 并阻断。SFTP 没有标准的限流信号，retry-after 保持为空。
pub fn classify_sftp_failure(failure: &SftpTransportFailure) -> PublishFailure {
    let (category, native_code, message, retry_safe) = match failure {
        SftpTransportFailure::Network { message } => (
            PublishFailureCategory::Transient,
            "network",
            message.clone(),
            false,
        ),
        SftpTransportFailure::Authentication { message } => (
            PublishFailureCategory::Authentication,
            "authentication",
            message.clone(),
            true,
        ),
        SftpTransportFailure::PermissionDenied { message } => (
            PublishFailureCategory::Authorization,
            "permission_denied",
            message.clone(),
            true,
        ),
        SftpTransportFailure::Protocol { message } => (
            PublishFailureCategory::Unknown,
            "protocol",
            message.clone(),
            false,
        ),
    };
    PublishFailure {
        version: PUBLISH_FAILURE_VERSION,
        category,
        native_code: native_code.to_string(),
        message,
        retry_safe,
        retry_after_seconds: None,
    }
}

fn transport_failure(failure: SftpTransportFailure) -> PublishError {
    PublishError::Classified {
        failure: classify_sftp_failure(&failure),
    }
}

/// port 设置的唯一范围规则：配置校验与执行边界共用，避免两处分叉。
fn valid_port(port: u64, adapter: &str) -> Result<u16, PublishError> {
    if !(1..=65_535).contains(&port) {
        return Err(PublishError::InvalidAdapterSettings {
            adapter: adapter.to_string(),
            message: format!("setting port must be between 1 and 65535, got {port}"),
        });
    }
    Ok(port as u16)
}

/// SFTP Delivery Destination 的显式能力声明（ADR-0047，父规格 T17）：
/// - 目录布局：`{remote_path}/{release version}` 一版一目录；
/// - 临时文件与原子改名：先写 `{name}.{attempt digest}.part`，读回校验摘要后
///   原子改名到最终路径；
/// - 覆盖策略：永不覆盖——最终路径摘要不一致一律 Conflict；
/// - 续传与幂等：交付记录（[`SFTP_DELIVERY_RECORD_NAME`]）先行提交，逐文件
///   reconcile 支持中断续传，幂等探测按记录 digest 判定 Absent/Matching/Conflicting。
pub struct SftpDeliveryDestination {
    descriptor: AdapterDescriptor,
    transport: Arc<dyn SftpTransport>,
}

impl SftpDeliveryDestination {
    pub fn new(transport: Arc<dyn SftpTransport>) -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::DeliveryDestination,
                SFTP_DESTINATION_ID,
                1,
                AdapterSchema::new(1)
                    .with_required_string("host")
                    .with_required_number("port")
                    .with_required_string("username")
                    .with_required_string("remote_path")
                    .with_required_string_list("artifact_roles")
                    .with_credential(
                        KEY_CREDENTIAL,
                        CredentialKind::SshPrivateKey,
                        "authenticate the SFTP session that uploads and verifies release artifacts",
                    ),
                publish_domain::PublishingCapability {
                    provides: vec![],
                    requires: vec![publish_domain::CapabilityRequirement::exact(
                        "stored-artifact",
                        1,
                    )],
                },
            ),
            transport,
        }
    }

    fn endpoint(&self, settings: &AdapterSettings) -> Result<SftpEndpoint, PublishError> {
        let adapter = self.descriptor.identity().display_name();
        let host = settings.string("host", &adapter)?;
        if host.is_empty() {
            return Err(validation_failure(
                "host_missing",
                "the sftp route has no host configured".to_string(),
            ));
        }
        let username = settings.string("username", &adapter)?;
        if username.is_empty() {
            return Err(validation_failure(
                "username_missing",
                "the sftp route has no username configured".to_string(),
            ));
        }
        let port = settings.unsigned_number("port", &adapter)?;
        let port = valid_port(port, &adapter)?;
        Ok(SftpEndpoint {
            host: host.to_string(),
            port,
            username: username.to_string(),
        })
    }
}

/// 远端路径段的安全规则：不能为空、不能是目录游标、不能包含分隔符、
/// 引号或控制字符——一条规则同时约束发布版本与产物文件名。
fn is_safe_path_segment(segment: &str) -> bool {
    !segment.is_empty()
        && segment != "."
        && segment != ".."
        && !segment
            .chars()
            .any(|character| character.is_control() || matches!(character, '/' | '\\' | '"' | '\''))
}

/// 远端根路径规则：非空路径不得包含引号、控制字符或 `..` 游标段。
fn remote_path_violation(path: &str) -> Option<&'static str> {
    if path
        .chars()
        .any(|character| character.is_control() || matches!(character, '"' | '\''))
    {
        return Some("setting remote_path cannot contain quotes or control characters");
    }
    if path.split('/').any(|segment| segment == "..") {
        return Some("setting remote_path cannot contain '..' segments");
    }
    None
}

/// 版本目录与远端根拼成本路线的交付目录；staging 与幂等探测共用一条规则。
fn remote_directory(remote_path: &str, version: &str) -> String {
    format!("{}/{version}", remote_path.trim_end_matches('/'))
}

/// 密封进 stage 节点的单次发布输入：目标版本必填。
fn sealed_release_inputs(
    snapshot: &PlanningInputSnapshot,
) -> Result<BTreeMap<String, Value>, PublishError> {
    let version = snapshot
        .release_input
        .get("version")
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|version| !version.trim().is_empty());
    let Some(version) = version else {
        return Err(PublishError::InvalidPlan(
            "sftp routes require a release version input".to_string(),
        ));
    };
    Ok(BTreeMap::from([(
        "version".to_string(),
        Value::String(version),
    )]))
}

impl AdapterContract for SftpDeliveryDestination {
    fn descriptor(&self) -> &AdapterDescriptor {
        &self.descriptor
    }

    fn default_settings(&self) -> AdapterSettings {
        AdapterSettings::new(1)
            .with_value("host", Value::String(String::new()))
            .with_value("port", Value::from(22u64))
            .with_value("username", Value::String(String::new()))
            .with_value("remote_path", Value::String(String::new()))
            .with_value(
                "artifact_roles",
                Value::Array(vec![Value::String("installer".to_string())]),
            )
    }

    fn validate_settings(&self, settings: &AdapterSettings) -> Result<(), PublishError> {
        crate::validate_settings_against_schema(self.descriptor(), settings)?;
        let adapter = self.descriptor.identity().display_name();
        let invalid = |message: String| PublishError::InvalidAdapterSettings {
            adapter: adapter.clone(),
            message,
        };

        let port = settings.unsigned_number("port", &adapter)?;
        valid_port(port, &adapter)?;

        // 空目标允许保存（新建路线从空白开始）；staging 前才要求完整。
        let host = settings.string("host", &adapter)?;
        if !host.is_empty()
            && !host.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '.' | '-')
            })
        {
            return Err(invalid(format!(
                "setting host may only contain letters, digits, dots, and dashes, got {host}"
            )));
        }
        let username = settings.string("username", &adapter)?;
        if !username.is_empty() && !is_safe_path_segment(username) {
            return Err(invalid(
                "setting username cannot contain separators, quotes, or control characters"
                    .to_string(),
            ));
        }
        let remote_path = settings.string("remote_path", &adapter)?;
        if let Some(violation) = remote_path_violation(remote_path) {
            return Err(invalid(violation.to_string()));
        }
        let roles = settings.string_list("artifact_roles", &adapter)?;
        if roles.is_empty() {
            return Err(invalid(
                "setting artifact_roles cannot be empty".to_string(),
            ));
        }
        if roles.iter().any(|role| role.trim().is_empty()) {
            return Err(invalid(
                "setting artifact_roles cannot contain empty roles".to_string(),
            ));
        }
        Ok(())
    }

    fn summarize_settings(&self, settings: &AdapterSettings) -> Result<String, PublishError> {
        let adapter = self.descriptor.identity().display_name();
        let host = settings.string("host", &adapter)?;
        if host.is_empty() {
            return Ok(self.descriptor.id.clone());
        }
        let username = settings.string("username", &adapter)?;
        let port = settings.unsigned_number("port", &adapter)?;
        let remote_path = settings.string("remote_path", &adapter)?;
        let login = if username.is_empty() {
            String::new()
        } else {
            format!("{username}@")
        };
        Ok(format!("sftp://{login}{host}:{port}{remote_path}"))
    }

    fn plan_fragment(
        &self,
        snapshot: &PlanningInputSnapshot,
        _settings: &AdapterSettings,
    ) -> Result<Vec<PlanNodeTemplate>, PublishError> {
        // 发布版本是单次发布输入，不属于可复用配置；规划时密封进 stage 节点。
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
        node: &publish_domain::PlanNode,
        context: &crate::AdapterExecutionContext<'_>,
    ) -> Result<crate::AdapterExecutionOutput, PublishError> {
        let manifest = context
            .manifest
            .ok_or(PublishError::MissingArtifactManifest)?;
        match crate::action_name(node)? {
            STAGE_ACTION => self.stage(node, manifest),
            PUBLISH_ACTION => self.publish(node, context, manifest),
            OBSERVE_ACTION => self.observe(node, context),
            other => Err(PublishError::Execution(format!(
                "node {} is not an sftp delivery operation: {other}",
                node.id
            ))),
        }
    }
}

/// 交付文件条目的字节来源：封存 Manifest 的产物，或路线专属交付记录。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
enum FileSource {
    Manifest,
    Record,
}

/// 路线专属交付选择的一个条目：远端文件名、内容摘要、大小与字节来源；
/// staging 写入 Envelope，publish 与 observe 从 Envelope 读回同一形状。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
struct EnvelopeFile {
    name: String,
    digest: String,
    size: u64,
    source: FileSource,
}

impl SftpDeliveryDestination {
    /// Staging：从封存 Manifest、密封发布输入和路线设置确定性生成 Delivery
    /// Envelope——远端目录、非秘密目标身份、交付记录与文件选择都只属于本
    /// 路线（ADR-0055）。所有交付前策略验证也发生在这里。
    fn stage(
        &self,
        node: &publish_domain::PlanNode,
        manifest: &ArtifactManifest,
    ) -> Result<crate::AdapterExecutionOutput, PublishError> {
        let adapter = self.descriptor.identity().display_name();
        let inputs = sealed_inputs(node)?;
        let version = inputs
            .get("version")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                PublishError::InvalidPlan(format!(
                    "node {} is missing the sealed release version input",
                    node.id
                ))
            })?;
        if !is_safe_path_segment(version) {
            return Err(validation_failure(
                "release_directory_invalid",
                format!("release version {version:?} cannot form a remote release directory"),
            ));
        }

        let endpoint = self.endpoint(&node.settings)?;
        let remote_path = node.settings.string("remote_path", &adapter)?;
        if remote_path.is_empty() {
            return Err(validation_failure(
                "remote_path_missing",
                "the sftp route has no remote_path configured".to_string(),
            ));
        }
        let directory = remote_directory(remote_path, version);
        let roles: BTreeSet<String> = node
            .settings
            .string_list("artifact_roles", &adapter)?
            .into_iter()
            .collect();

        // 文件只来自封存 Manifest 的所选角色：未声明文件、构建目录残留与
        // 秘密没有进入远端路径（与 Release 附件白名单同源，ADR-0012）。
        // 文件名唯一性由 Manifest 封存时保证，这里不再有同名分支。
        let mut recorded = BTreeMap::new();
        let mut files = Vec::new();
        for entry in &manifest.artifacts {
            if !roles.contains(&entry.role) {
                continue;
            }
            if !is_safe_path_segment(&entry.file_name) {
                return Err(validation_failure(
                    "delivery_file_name_invalid",
                    format!(
                        "artifact {:?} cannot be delivered as a single remote file name",
                        entry.file_name
                    ),
                ));
            }
            if entry.file_name == SFTP_DELIVERY_RECORD_NAME {
                return Err(validation_failure(
                    "delivery_file_name_reserved",
                    format!(
                        "artifact file name {SFTP_DELIVERY_RECORD_NAME} is reserved for the delivery record"
                    ),
                ));
            }
            recorded.insert(entry.file_name.clone(), entry.digest.clone());
            files.push(EnvelopeFile {
                name: entry.file_name.clone(),
                digest: entry.digest.clone(),
                size: entry.size,
                source: FileSource::Manifest,
            });
        }
        if files.is_empty() {
            return Err(validation_failure(
                "delivery_files_empty",
                "no sealed artifact matches the configured artifact roles".to_string(),
            ));
        }

        // 交付记录是 files[0]：它先于所有产物提交，使每个中断状态都能被
        // 幂等探测识别为我方交付（ADR-0051）。
        let record = serde_json::json!({
            "manifest_digest": manifest.digest,
            "files": recorded,
        });
        let record_bytes = serialize_delivery_record(&record)?;
        files.insert(
            0,
            EnvelopeFile {
                name: SFTP_DELIVERY_RECORD_NAME.to_string(),
                digest: sha256_hex(&record_bytes),
                size: record_bytes.len() as u64,
                source: FileSource::Record,
            },
        );

        let mut envelope = DeliveryEnvelope::new(node.binding_id.clone(), manifest.digest.clone());
        envelope.content = BTreeMap::from([
            ("remote_directory".to_string(), Value::String(directory)),
            ("target".to_string(), Value::String(endpoint.target())),
            (
                "files".to_string(),
                serde_json::to_value(&files).map_err(|error| {
                    PublishError::Execution(format!(
                        "cannot serialize the delivery file selection: {error}"
                    ))
                })?,
            ),
            ("delivery_record".to_string(), record),
        ]);
        Ok(crate::AdapterExecutionOutput {
            envelopes: vec![envelope],
            ..crate::AdapterExecutionOutput::default()
        })
    }
}

fn serialize_delivery_record(record: &Value) -> Result<Vec<u8>, PublishError> {
    serde_json::to_vec_pretty(record).map_err(|error| {
        PublishError::Execution(format!("cannot serialize the delivery record: {error}"))
    })
}

impl SftpDeliveryDestination {
    /// Publish：交付记录先行，然后逐条目 reconcile——最终路径已有一致内容
    /// 直接复用，不一致明确冲突且不覆盖；缺失内容先写临时远端名称、读回
    /// 校验摘要，再以原子改名提交（ADR-0047/0051）。
    fn publish(
        &self,
        node: &publish_domain::PlanNode,
        context: &crate::AdapterExecutionContext<'_>,
        manifest: &ArtifactManifest,
    ) -> Result<crate::AdapterExecutionOutput, PublishError> {
        let envelope = route_envelope(node, context)?;
        let key = resolved_key(context.credentials, &node.binding_id)?;
        let endpoint = self.endpoint(&node.settings)?;
        let directory = envelope_string(envelope, "remote_directory")?;
        let files = envelope_files(envelope)?;
        let reference = external_reference(&endpoint.target(), directory);

        self.transport
            .create_directories(key, &endpoint, directory)
            .map_err(transport_failure)?;
        for file in &files {
            let final_path = format!("{directory}/{}", file.name);
            if self
                .transport
                .exists(key, &endpoint, &final_path)
                .map_err(transport_failure)?
            {
                // 摘要一致的既有内容按幂等身份复用；不一致代表另一份交付
                // 占用了这个路径——不覆盖、不删除（ADR-0051）。
                let remote = self
                    .transport
                    .read(key, &endpoint, &final_path)
                    .map_err(transport_failure)?;
                if sha256_hex(&remote) == file.digest {
                    continue;
                }
                return Err(conflict_failure(
                    "remote_file_digest_conflict",
                    format!(
                        "remote file {} at {reference} carries different content; refusing to overwrite another delivery",
                        file.name
                    ),
                ));
            }

            let temp_path = temp_path(&final_path, context.attempt_id);
            // 同一尝试残留的部分写入只能是中断上传的残损字节；替换它是
            // 幂等续传，不是覆盖另一份发布。
            if self
                .transport
                .exists(key, &endpoint, &temp_path)
                .map_err(transport_failure)?
            {
                self.transport
                    .remove(key, &endpoint, &temp_path)
                    .map_err(transport_failure)?;
            }
            let bytes = file_bytes(file, envelope, manifest)?;
            self.transport
                .write(key, &endpoint, &temp_path, &bytes)
                .map_err(transport_failure)?;
            let uploaded = self
                .transport
                .read(key, &endpoint, &temp_path)
                .map_err(transport_failure)?;
            if sha256_hex(&uploaded) != file.digest {
                self.transport
                    .remove(key, &endpoint, &temp_path)
                    .map_err(transport_failure)?;
                return Err(transient_failure(
                    "uploaded_bytes_corrupted",
                    format!(
                        "remote bytes for {} did not match the sealed digest after upload",
                        file.name
                    ),
                ));
            }
            self.transport
                .rename(key, &endpoint, &temp_path, &final_path)
                .map_err(transport_failure)?;
        }

        let receipt_id = sha256_hex(
            format!(
                "{}:{}:{}:{}",
                context.attempt_id, node.id, node.binding_id, manifest.digest
            )
            .as_bytes(),
        );
        Ok(crate::AdapterExecutionOutput {
            receipts: vec![DeliveryReceipt {
                version: DELIVERY_RECEIPT_VERSION,
                receipt_id,
                revision: 1,
                route_id: node.binding_id.clone(),
                manifest_digest: manifest.digest.clone(),
                status: DeliveryStatus::Submitted,
                external_reference: reference,
            }],
            ..crate::AdapterExecutionOutput::default()
        })
    }

    /// Observe：重新读取远端状态并映射到通用交付生命周期；交付记录读回
    /// 摘要一致且所有文件在最终路径可见时，才追加 Published Receipt 修订
    /// （ADR-0039）。
    fn observe(
        &self,
        node: &publish_domain::PlanNode,
        context: &crate::AdapterExecutionContext<'_>,
    ) -> Result<crate::AdapterExecutionOutput, PublishError> {
        let envelope = route_envelope(node, context)?;
        let key = resolved_key(context.credentials, &node.binding_id)?;
        let endpoint = self.endpoint(&node.settings)?;
        let directory = envelope_string(envelope, "remote_directory")?;
        let files = envelope_files(envelope)?;
        let reference = external_reference(&endpoint.target(), directory);
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

        for file in &files {
            let final_path = format!("{directory}/{}", file.name);
            match file.source {
                // 交付记录读回并校验摘要：它是远端交付的身份声明。
                FileSource::Record => {
                    if !self
                        .transport
                        .exists(key, &endpoint, &final_path)
                        .map_err(transport_failure)?
                    {
                        return Err(transient_failure(
                            "delivery_not_observable",
                            format!("the delivery record at {reference} is not observable yet"),
                        ));
                    }
                    let remote = self
                        .transport
                        .read(key, &endpoint, &final_path)
                        .map_err(transport_failure)?;
                    if sha256_hex(&remote) != file.digest {
                        return Err(conflict_failure(
                            "delivery_record_conflict",
                            format!(
                                "the delivery record at {reference} was not written by this delivery"
                            ),
                        ));
                    }
                }
                FileSource::Manifest => {
                    // 产物摘要在提交时经读回验证并记入交付记录；观察按记录
                    // 摘要 + 存在性确认远端状态，避免整集二次下载。
                    if !self
                        .transport
                        .exists(key, &endpoint, &final_path)
                        .map_err(transport_failure)?
                    {
                        return Err(transient_failure(
                            "delivery_incomplete",
                            format!(
                                "remote file {} at {reference} is not observable yet",
                                file.name
                            ),
                        ));
                    }
                }
            }
        }

        Ok(crate::AdapterExecutionOutput {
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
            ..crate::AdapterExecutionOutput::default()
        })
    }
}

/// 临时远端名称：由最终路径与尝试身份决定，同一尝试可以确定地找回并
/// 清理自己的部分写入。
fn temp_path(final_path: &str, attempt_id: &str) -> String {
    format!(
        "{final_path}.{}.part",
        &sha256_hex(attempt_id.as_bytes())[..16]
    )
}

/// 非秘密远端引用：目标身份加交付目录。
fn external_reference(target: &str, directory: &str) -> String {
    if directory.starts_with('/') {
        format!("{target}{directory}")
    } else {
        format!("{target}/{directory}")
    }
}

fn route_envelope<'a>(
    node: &publish_domain::PlanNode,
    context: &'a crate::AdapterExecutionContext<'_>,
) -> Result<&'a DeliveryEnvelope, PublishError> {
    context
        .envelopes
        .iter()
        .find(|envelope| envelope.route_id == node.binding_id)
        .ok_or_else(|| {
            PublishError::Execution(format!(
                "route {} has no staged sftp delivery envelope",
                node.binding_id
            ))
        })
}

/// 当前 Execution Backend 解析好的 SSH 私钥；执行与幂等探测共用同一凭据边界。
fn resolved_key<'a>(
    credentials: &'a BTreeMap<String, publish_domain::ResolvedCredential>,
    route_id: &str,
) -> Result<&'a CredentialValue, PublishError> {
    credentials
        .get(KEY_CREDENTIAL)
        .map(|credential| &credential.value)
        .ok_or_else(|| {
            PublishError::Execution(format!(
                "route {route_id} has no resolved {KEY_CREDENTIAL} credential"
            ))
        })
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

/// Envelope 中的交付选择：staging 写入的同一 `EnvelopeFile` 形状原样读回。
fn envelope_files(envelope: &DeliveryEnvelope) -> Result<Vec<EnvelopeFile>, PublishError> {
    let files = envelope.content.get("files").ok_or_else(|| {
        PublishError::Execution(format!(
            "the staged envelope for route {} has no delivery file selection",
            envelope.route_id
        ))
    })?;
    serde_json::from_value(files.clone()).map_err(|error| {
        PublishError::Execution(format!(
            "the staged envelope for route {} has an invalid delivery file selection: {error}",
            envelope.route_id
        ))
    })
}

/// 解析一个条目的实际字节：Manifest 条目从 Artifact Store 定位符读取并验证
/// 摘要，交付记录从路线封装重新序列化并比对 staging 时的摘要。
fn file_bytes(
    file: &EnvelopeFile,
    envelope: &DeliveryEnvelope,
    manifest: &ArtifactManifest,
) -> Result<Vec<u8>, PublishError> {
    let bytes = match file.source {
        FileSource::Manifest => {
            let entry = manifest
                .artifacts
                .iter()
                .find(|entry| entry.file_name == file.name && entry.digest == file.digest)
                .ok_or_else(|| {
                    PublishError::Execution(format!(
                        "staged file {} is not declared by the sealed manifest",
                        file.name
                    ))
                })?;
            let bytes = std::fs::read(&entry.locator).map_err(|error| PublishError::Io {
                operation: format!("read sealed artifact {}", entry.locator),
                message: error.to_string(),
            })?;
            bytes
        }
        FileSource::Record => serialize_delivery_record(
            envelope.content.get("delivery_record").ok_or_else(|| {
                PublishError::Execution(format!(
                    "staged file {} has no envelope content to upload",
                    file.name
                ))
            })?,
        )?,
    };
    let digest = sha256_hex(&bytes);
    if digest != file.digest {
        return Err(PublishError::ArtifactDigestMismatch {
            artifact: file.name.clone(),
            expected: file.digest.clone(),
            actual: digest,
        });
    }
    Ok(bytes)
}

impl DeliveryDestination for SftpDeliveryDestination {
    /// 自动重试前按交付幂等身份探测远端（ADR-0051）：没有交付记录或我方
    /// 未完成的交付允许重新执行，记录与全部文件都一致时复用既有交付，
    /// 其余一律冲突。
    fn probe_delivery(
        &self,
        settings: &AdapterSettings,
        identity: &publish_domain::DeliveryIdempotencyIdentity,
        credentials: &BTreeMap<String, publish_domain::ResolvedCredential>,
    ) -> Result<crate::DeliveryProbe, PublishError> {
        let adapter = self.descriptor.identity().display_name();
        let endpoint = self.endpoint(settings)?;
        let remote_path = settings.string("remote_path", &adapter)?;
        if remote_path.is_empty() {
            return Err(validation_failure(
                "remote_path_missing",
                "the sftp route has no remote_path configured".to_string(),
            ));
        }
        let key = resolved_key(credentials, &identity.route_id)?;
        let directory = remote_directory(remote_path, &identity.release_identity.version);
        let reference = external_reference(&endpoint.target(), &directory);
        let record_path = format!("{directory}/{SFTP_DELIVERY_RECORD_NAME}");

        if !self
            .transport
            .exists(key, &endpoint, &record_path)
            .map_err(transport_failure)?
        {
            return Ok(crate::DeliveryProbe::Absent);
        }
        let bytes = self
            .transport
            .read(key, &endpoint, &record_path)
            .map_err(transport_failure)?;
        let conflicting = || crate::DeliveryProbe::Conflicting {
            external_reference: reference.clone(),
        };
        let Ok(record) = serde_json::from_slice::<Value>(&bytes) else {
            return Ok(conflicting());
        };
        if record.get("manifest_digest").and_then(Value::as_str)
            != Some(identity.manifest_digest.as_str())
        {
            return Ok(conflicting());
        }
        let Some(recorded_files) = record.get("files").and_then(Value::as_object) else {
            return Ok(conflicting());
        };
        for name in recorded_files.keys() {
            // 记录中的摘要在提交时已经读回验证过；探测按记录 + 存在性判定，
            // 不再整集二次下载（publish 路径保留完整摘要守卫）。
            if !self
                .transport
                .exists(key, &endpoint, &format!("{directory}/{name}"))
                .map_err(transport_failure)?
            {
                // 我方交付记录在场但内容未齐：这是中断的交付，重新执行安全。
                return Ok(crate::DeliveryProbe::Absent);
            }
        }
        Ok(crate::DeliveryProbe::Matching {
            external_reference: reference,
        })
    }
}

/// 一次 Fake 传输操作的注入失败键：与端口方法一一对应。
pub const FAKE_SFTP_OPERATION_EXISTS: &str = "exists";
pub const FAKE_SFTP_OPERATION_READ: &str = "read";
pub const FAKE_SFTP_OPERATION_WRITE: &str = "write";
pub const FAKE_SFTP_OPERATION_RENAME: &str = "rename";
pub const FAKE_SFTP_OPERATION_MKDIR: &str = "create_directories";
pub const FAKE_SFTP_OPERATION_REMOVE: &str = "remove";

#[derive(Default)]
struct FakeSftpState {
    files: BTreeMap<String, Vec<u8>>,
    directories: BTreeSet<String>,
    failures: BTreeMap<String, VecDeque<SftpTransportFailure>>,
    partial_writes: VecDeque<usize>,
    corrupt_writes: VecDeque<()>,
    calls: BTreeMap<String, usize>,
    written_paths: Vec<String>,
    observed_keys: Vec<String>,
    denied_prefixes: Vec<String>,
    authorized: Option<(String, String)>,
}

/// 内存中的隔离 SFTP 测试服务器：以真实语义建模目录层级、严格改名与权限，
/// 支持按操作注入失败与半途中断的部分写入；自动测试不得触碰真实 SFTP
/// 服务器（父规格约束），断线恢复、冲突与权限矩阵都在这里覆盖。
#[derive(Default)]
pub struct FakeSftpServer {
    state: Mutex<FakeSftpState>,
}

impl FakeSftpServer {
    pub fn new() -> Self {
        Self::default()
    }

    /// 只接受这组身份凭据；未设置时接受任意非空私钥。
    pub fn require_credentials(&self, username: &str, key: &str) {
        self.lock().authorized = Some((username.to_string(), key.to_string()));
    }

    /// 拒绝向该前缀写入（write/rename/mkdir/remove），模拟只读目录。
    pub fn deny_writes_under(&self, prefix: &str) {
        self.lock().denied_prefixes.push(normalize(prefix));
    }

    /// 注入下一次指定操作的失败；同一操作可以排队多次失败。
    pub fn fail_next(&self, operation: &str, failure: SftpTransportFailure) {
        self.lock()
            .failures
            .entry(operation.to_string())
            .or_default()
            .push_back(failure);
    }

    /// 让下一次 write 只落盘前 `bytes` 个字节后断线：远端留下部分写入的
    /// 临时文件，模拟传输中断。
    pub fn fail_next_write_after(&self, bytes: usize) {
        self.lock().partial_writes.push_back(bytes);
    }

    /// 让下一次 write 静默落盘损坏的字节：模拟无连接错误的传输损坏。
    pub fn corrupt_next_write(&self) {
        self.lock().corrupt_writes.push_back(());
    }

    /// 预置一个远端文件（自动补齐父目录），用于复用、冲突与续传场景。
    pub fn seed_file(&self, path: &str, bytes: &[u8]) {
        let path = normalize(path);
        let mut state = self.lock();
        add_parent_directories(&mut state.directories, &path);
        state.files.insert(path, bytes.to_vec());
    }

    pub fn file(&self, path: &str) -> Option<Vec<u8>> {
        self.lock().files.get(&normalize(path)).cloned()
    }

    /// 全部远端文件路径，按字典序。
    pub fn paths(&self) -> Vec<String> {
        self.lock().files.keys().cloned().collect()
    }

    pub fn calls(&self, operation: &str) -> usize {
        self.lock().calls.get(operation).copied().unwrap_or(0)
    }

    pub fn total_calls(&self) -> usize {
        self.lock().calls.values().sum()
    }

    /// 全部写入操作的目标路径，按调用顺序；用于断言上传只指向临时名称。
    pub fn written_paths(&self) -> Vec<String> {
        self.lock().written_paths.clone()
    }

    /// Fake 观察到的全部私钥值；用于断言凭据只在执行边界出现。
    pub fn observed_keys(&self) -> Vec<String> {
        self.lock().observed_keys.clone()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, FakeSftpState> {
        self.state.lock().expect("fake sftp server state")
    }

    fn enter(
        &self,
        operation: &str,
        endpoint: &SftpEndpoint,
        key: &CredentialValue,
    ) -> Result<std::sync::MutexGuard<'_, FakeSftpState>, SftpTransportFailure> {
        let mut state = self.lock();
        *state.calls.entry(operation.to_string()).or_insert(0) += 1;
        state.observed_keys.push(key.expose().to_string());
        let accepted = match &state.authorized {
            Some((username, secret)) => endpoint.username == *username && key.expose() == secret,
            None => !key.expose().trim().is_empty(),
        };
        if !accepted {
            return Err(SftpTransportFailure::Authentication {
                message: format!("server rejected the credentials for {}", endpoint.username),
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

fn normalize(path: &str) -> String {
    path.split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("/")
}

fn parent(path: &str) -> Option<String> {
    path.rsplit_once('/').map(|(parent, _)| parent.to_string())
}

fn add_parent_directories(directories: &mut BTreeSet<String>, path: &str) {
    let mut current = parent(path);
    while let Some(directory) = current {
        current = parent(&directory);
        directories.insert(directory);
    }
}

impl FakeSftpState {
    fn denied(&self, path: &str) -> bool {
        self.denied_prefixes
            .iter()
            .any(|prefix| path == prefix || path.starts_with(&format!("{prefix}/")))
    }

    fn require_writable(&self, path: &str) -> Result<(), SftpTransportFailure> {
        if self.denied(path) {
            return Err(SftpTransportFailure::PermissionDenied {
                message: format!("permission denied for {path}"),
            });
        }
        Ok(())
    }
}

impl SftpTransport for FakeSftpServer {
    fn exists(
        &self,
        key: &CredentialValue,
        endpoint: &SftpEndpoint,
        path: &str,
    ) -> Result<bool, SftpTransportFailure> {
        let state = self.enter(FAKE_SFTP_OPERATION_EXISTS, endpoint, key)?;
        let path = normalize(path);
        Ok(state.files.contains_key(&path) || state.directories.contains(&path))
    }

    fn read(
        &self,
        key: &CredentialValue,
        endpoint: &SftpEndpoint,
        path: &str,
    ) -> Result<Vec<u8>, SftpTransportFailure> {
        let state = self.enter(FAKE_SFTP_OPERATION_READ, endpoint, key)?;
        state
            .files
            .get(&normalize(path))
            .cloned()
            .ok_or_else(|| SftpTransportFailure::Protocol {
                message: format!("no such file: {path}"),
            })
    }

    fn write(
        &self,
        key: &CredentialValue,
        endpoint: &SftpEndpoint,
        path: &str,
        bytes: &[u8],
    ) -> Result<(), SftpTransportFailure> {
        let mut state = self.enter(FAKE_SFTP_OPERATION_WRITE, endpoint, key)?;
        let path = normalize(path);
        state.written_paths.push(path.clone());
        state.require_writable(&path)?;
        if parent(&path).is_some_and(|directory| !state.directories.contains(&directory)) {
            return Err(SftpTransportFailure::Protocol {
                message: format!("no such directory for {path}"),
            });
        }
        if let Some(written) = state.partial_writes.pop_front() {
            let written = written.min(bytes.len());
            state.files.insert(path.clone(), bytes[..written].to_vec());
            return Err(SftpTransportFailure::Network {
                message: format!("connection lost while uploading {path}"),
            });
        }
        if state.corrupt_writes.pop_front().is_some() {
            let mut corrupted = bytes.to_vec();
            match corrupted.first_mut() {
                Some(first) => *first = first.wrapping_add(1),
                None => corrupted.push(0xFF),
            }
            state.files.insert(path, corrupted);
            return Ok(());
        }
        state.files.insert(path, bytes.to_vec());
        Ok(())
    }

    fn rename(
        &self,
        key: &CredentialValue,
        endpoint: &SftpEndpoint,
        from: &str,
        to: &str,
    ) -> Result<(), SftpTransportFailure> {
        let mut state = self.enter(FAKE_SFTP_OPERATION_RENAME, endpoint, key)?;
        let (from, to) = (normalize(from), normalize(to));
        state.require_writable(&to)?;
        if state.files.contains_key(&to) {
            return Err(SftpTransportFailure::Protocol {
                message: format!("rename target already exists: {to}"),
            });
        }
        let bytes = state
            .files
            .remove(&from)
            .ok_or_else(|| SftpTransportFailure::Protocol {
                message: format!("no such file: {from}"),
            })?;
        state.files.insert(to, bytes);
        Ok(())
    }

    fn create_directories(
        &self,
        key: &CredentialValue,
        endpoint: &SftpEndpoint,
        path: &str,
    ) -> Result<(), SftpTransportFailure> {
        let mut state = self.enter(FAKE_SFTP_OPERATION_MKDIR, endpoint, key)?;
        let path = normalize(path);
        state.require_writable(&path)?;
        add_parent_directories(&mut state.directories, &path);
        state.directories.insert(path);
        Ok(())
    }

    fn remove(
        &self,
        key: &CredentialValue,
        endpoint: &SftpEndpoint,
        path: &str,
    ) -> Result<(), SftpTransportFailure> {
        let mut state = self.enter(FAKE_SFTP_OPERATION_REMOVE, endpoint, key)?;
        let path = normalize(path);
        state.require_writable(&path)?;
        state
            .files
            .remove(&path)
            .ok_or_else(|| SftpTransportFailure::Protocol {
                message: format!("no such file: {path}"),
            })?;
        Ok(())
    }
}

const SFTP_PROGRAM: &str = "sftp";
const CONNECT_TIMEOUT_SECONDS: u32 = 30;

/// 通过 OpenSSH `sftp` 批处理访问真实服务器的生产端口：本机与远端执行后端
/// 共用同一 Destination 语义，只有传输不同。私钥经安全临时文件（0600）传给
/// 客户端，不进入参数、日志或任何序列化面（ADR-0029）；批处理命令经 stdin
/// 传入，每次操作一次连接。
///
/// 覆盖语义说明：openssh 客户端的 `rename` 在服务器支持 posix-rename 扩展时
/// 会覆盖既有目标。Destination 在改名前用 exists + 摘要读回守卫最终路径，
/// 因此"同路径不同摘要不覆盖"由本 crate 的交付流程保证，而不是依赖服务器
/// 的改名语义（ADR-0047 显式能力）。
pub struct OpenSshSftpTransport;

impl OpenSshSftpTransport {
    pub fn new() -> Self {
        Self
    }

    fn run(
        &self,
        key: &CredentialValue,
        endpoint: &SftpEndpoint,
        batch: &str,
    ) -> Result<SftpCliOutcome, SftpTransportFailure> {
        use std::io::Write;
        use std::process::Stdio;

        let key_file = materialize_key(key)?;
        let mut command = std::process::Command::new(SFTP_PROGRAM);
        command
            .arg("-q")
            .arg("-oBatchMode=yes")
            .arg("-oIdentitiesOnly=yes")
            .arg("-oPreferredAuthentications=publickey")
            .arg("-oStrictHostKeyChecking=accept-new")
            .arg(format!("-oConnectTimeout={CONNECT_TIMEOUT_SECONDS}"))
            .arg("-i")
            .arg(key_file.path())
            .arg("-P")
            .arg(endpoint.port.to_string())
            .arg("-b")
            .arg("-")
            .arg(format!("{}@{}", endpoint.username, endpoint.host))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = command
            .spawn()
            .map_err(|error| SftpTransportFailure::Network {
                message: format!("failed to start {SFTP_PROGRAM}: {error}"),
            })?;
        if let Some(mut pipe) = child.stdin.take() {
            pipe.write_all(batch.as_bytes())
                .map_err(|error| SftpTransportFailure::Network {
                    message: format!("failed to stream the batch to {SFTP_PROGRAM}: {error}"),
                })?;
        }
        let output = child
            .wait_with_output()
            .map_err(|error| SftpTransportFailure::Network {
                message: format!("failed to run {SFTP_PROGRAM}: {error}"),
            })?;
        Ok(SftpCliOutcome {
            success: output.status.success(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        })
    }

    fn expect_success(
        &self,
        key: &CredentialValue,
        endpoint: &SftpEndpoint,
        batch: &str,
    ) -> Result<(), SftpTransportFailure> {
        let outcome = self.run(key, endpoint, batch)?;
        if outcome.success {
            return Ok(());
        }
        Err(parse_sftp_cli_failure(&outcome.stderr))
    }
}

impl Default for OpenSshSftpTransport {
    fn default() -> Self {
        Self::new()
    }
}

struct SftpCliOutcome {
    success: bool,
    stderr: String,
}

/// 把解析后的私钥写入 0600 的安全临时文件；OpenSSH 要求密钥以换行结尾。
/// 文件随句柄 Drop 删除，密钥值不进入命令行参数。本地文件系统失败不是
/// 网络问题：归入 Protocol（Unknown 阻断），自动重试无从修复本机磁盘。
fn materialize_key(key: &CredentialValue) -> Result<tempfile::NamedTempFile, SftpTransportFailure> {
    use std::io::Write;

    let mut file =
        tempfile::NamedTempFile::new().map_err(|error| SftpTransportFailure::Protocol {
            message: format!("cannot create a private key file for {SFTP_PROGRAM}: {error}"),
        })?;
    let mut material = key.expose().to_string();
    if !material.ends_with('\n') {
        material.push('\n');
    }
    file.write_all(material.as_bytes())
        .and_then(|_| file.flush())
        .map_err(|error| SftpTransportFailure::Protocol {
            message: format!("cannot prepare the private key for {SFTP_PROGRAM}: {error}"),
        })?;
    Ok(file)
}

/// 批处理命令中的路径引用；引号与控制字符已在设置与路径段校验中排除。
fn quoted(path: &str) -> String {
    format!("\"{path}\"")
}

/// 判定 stderr 是否描述"远端路径不存在"；exists 用它区分缺失与真正失败。
fn is_remote_missing(stderr: &str) -> bool {
    let lower = stderr.to_lowercase();
    lower.contains("not found") || lower.contains("no such file or directory")
}

/// 把 openssh sftp 客户端的失败输出映射为结构化传输失败。客户端只提供文本
/// stderr，这里的模式识别是该传输边界内的一次性转译；转译结果之外的任何
/// 环节（Destination 分类、Runner 重试）都只消费结构化形状（ADR-0056 的
/// 边界在 SftpTransportFailure，不在 stderr）。认证失败也会尾随
/// "Connection closed"，因此认证模式先于网络模式判定。
pub fn parse_sftp_cli_failure(stderr: &str) -> SftpTransportFailure {
    let message = stderr.trim().to_string();
    let lower = message.to_lowercase();
    // OpenSSH 的认证拒绝带认证方法列表后缀："Permission denied (publickey,...)"。
    if lower.contains("permission denied (")
        || lower.contains("authentication failed")
        || lower.contains("no supported authentication")
        || lower.contains("host key verification failed")
        || lower.contains("host identification has changed")
    {
        return SftpTransportFailure::Authentication { message };
    }
    if lower.contains("permission denied") {
        return SftpTransportFailure::PermissionDenied { message };
    }
    if [
        "connection refused",
        "connection timed out",
        "connection reset",
        "connection closed",
        "could not resolve hostname",
        "network is unreachable",
        "broken pipe",
        "timed out",
    ]
    .iter()
    .any(|pattern| lower.contains(pattern))
    {
        return SftpTransportFailure::Network { message };
    }
    SftpTransportFailure::Protocol { message }
}

impl SftpTransport for OpenSshSftpTransport {
    fn exists(
        &self,
        key: &CredentialValue,
        endpoint: &SftpEndpoint,
        path: &str,
    ) -> Result<bool, SftpTransportFailure> {
        let outcome = self.run(key, endpoint, &format!("ls -l {}\n", quoted(path)))?;
        if outcome.success {
            return Ok(true);
        }
        if is_remote_missing(&outcome.stderr) {
            return Ok(false);
        }
        Err(parse_sftp_cli_failure(&outcome.stderr))
    }

    fn read(
        &self,
        key: &CredentialValue,
        endpoint: &SftpEndpoint,
        path: &str,
    ) -> Result<Vec<u8>, SftpTransportFailure> {
        let local =
            tempfile::NamedTempFile::new().map_err(|error| SftpTransportFailure::Protocol {
                message: format!("cannot create a download file for {SFTP_PROGRAM}: {error}"),
            })?;
        let local_path = local.path().to_string_lossy().to_string();
        self.expect_success(
            key,
            endpoint,
            &format!("get {} {}\n", quoted(path), quoted(&local_path)),
        )?;
        std::fs::read(local.path()).map_err(|error| SftpTransportFailure::Protocol {
            message: format!("cannot read the downloaded copy of {path}: {error}"),
        })
    }

    fn write(
        &self,
        key: &CredentialValue,
        endpoint: &SftpEndpoint,
        path: &str,
        bytes: &[u8],
    ) -> Result<(), SftpTransportFailure> {
        use std::io::Write;

        let mut local =
            tempfile::NamedTempFile::new().map_err(|error| SftpTransportFailure::Protocol {
                message: format!("cannot create an upload file for {SFTP_PROGRAM}: {error}"),
            })?;
        local
            .write_all(bytes)
            .and_then(|_| local.flush())
            .map_err(|error| SftpTransportFailure::Protocol {
                message: format!("cannot prepare the upload for {path}: {error}"),
            })?;
        let local_path = local.path().to_string_lossy().to_string();
        self.expect_success(
            key,
            endpoint,
            &format!("put {} {}\n", quoted(&local_path), quoted(path)),
        )
    }

    fn rename(
        &self,
        key: &CredentialValue,
        endpoint: &SftpEndpoint,
        from: &str,
        to: &str,
    ) -> Result<(), SftpTransportFailure> {
        self.expect_success(
            key,
            endpoint,
            &format!("rename {} {}\n", quoted(from), quoted(to)),
        )
    }

    fn create_directories(
        &self,
        key: &CredentialValue,
        endpoint: &SftpEndpoint,
        path: &str,
    ) -> Result<(), SftpTransportFailure> {
        // 逐级 `-mkdir` 忽略"已存在"失败，最后用 ls 验证目录可见；真正的
        // 失败原因（权限等）保留在 stderr 里参与分类。
        let mut batch = String::new();
        let mut prefix = String::new();
        for segment in path.split('/').filter(|segment| !segment.is_empty()) {
            if prefix.is_empty() && path.starts_with('/') {
                prefix = format!("/{segment}");
            } else if prefix.is_empty() {
                prefix = segment.to_string();
            } else {
                prefix = format!("{prefix}/{segment}");
            }
            batch.push_str(&format!("-mkdir {}\n", quoted(&prefix)));
        }
        batch.push_str(&format!("ls -l {}\n", quoted(path)));
        self.expect_success(key, endpoint, &batch)
    }

    fn remove(
        &self,
        key: &CredentialValue,
        endpoint: &SftpEndpoint,
        path: &str,
    ) -> Result<(), SftpTransportFailure> {
        self.expect_success(key, endpoint, &format!("rm {}\n", quoted(path)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 断言样本取自 openssh 客户端对本机 sftp-server 的真实输出。
    #[test]
    fn maps_openssh_client_failures_onto_structured_transport_failures() {
        assert!(matches!(
            parse_sftp_cli_failure(
                "ssh: connect to host 127.0.0.1 port 1: Connection refused\nConnection closed"
            ),
            SftpTransportFailure::Network { .. }
        ));
        // 认证拒绝尾随 Connection closed，但认证模式优先。
        assert!(matches!(
            parse_sftp_cli_failure(
                "deploy@files.example.com: Permission denied (publickey,password).\nConnection closed"
            ),
            SftpTransportFailure::Authentication { .. }
        ));
        assert!(matches!(
            parse_sftp_cli_failure("Host key verification failed.\nConnection closed"),
            SftpTransportFailure::Authentication { .. }
        ));
        assert!(matches!(
            parse_sftp_cli_failure("dest open \"/srv/releases/x.part\": Permission denied"),
            SftpTransportFailure::PermissionDenied { .. }
        ));
        assert!(matches!(
            parse_sftp_cli_failure("remote mkdir \"/srv/releases\": Failure"),
            SftpTransportFailure::Protocol { .. }
        ));
        assert!(matches!(
            parse_sftp_cli_failure("File \"/srv/releases/x\" not found."),
            SftpTransportFailure::Protocol { .. }
        ));
    }

    #[test]
    fn recognizes_missing_remote_paths_from_client_output() {
        assert!(is_remote_missing(
            "Can't ls: \"/srv/releases/1.2.3\" not found"
        ));
        assert!(is_remote_missing(
            "remote delete /srv/x: No such file or directory"
        ));
        assert!(!is_remote_missing(
            "dest open \"/srv/x\": Permission denied"
        ));
    }

    #[test]
    fn private_keys_materialize_with_a_trailing_newline() {
        let key = CredentialValue::new(
            "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----",
        );
        let file = materialize_key(&key).expect("materialize the key");
        let written = std::fs::read_to_string(file.path()).expect("read the key file");
        assert!(written.ends_with("-----END OPENSSH PRIVATE KEY-----\n"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(file.path())
                .expect("key file metadata")
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600, "the key file must be private");
        }
    }
}
