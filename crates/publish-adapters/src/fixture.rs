use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use publish_domain::{
    is_safe_portable_relative_path, AdapterDescriptor, AdapterKind, AdapterSchema, AdapterSettings,
    ArtifactCandidate, Capability, CapabilityRequirement, PlanNodeTemplate, PlanOperation,
    PlanSideEffect, PlanStage, PlanningInputSnapshot, ProjectCandidate, ProjectDetectionEvidence,
    PublishError, PublishingCapability,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    sealed_inputs, AdapterContract, AdapterExecutionContext, AdapterExecutionOutput,
    ProjectProvider, ARTIFACT_CANDIDATE_CAPABILITY, STRUCTURED_PLAN_EXECUTION_CAPABILITY,
};

pub const FIXTURE_PROVIDER_ID: &str = "fixture-app";
pub const FIXTURE_MANIFEST_FILE_NAME: &str = "fixture-app.json";
pub const FIXTURE_INSPECT_ACTION: &str = "inspect_fixture_app";
pub const FIXTURE_BUNDLE_ROLE: &str = "fixture-bundle";
pub const FIXTURE_BUILD_PROGRAM: &str = "fixture-driver:build";

const MANIFEST_PATH_SETTING: &str = "manifest_path";
const LEGACY_MANIFEST_SETTING: &str = "manifest";
const DISCOVERY_SKIP_DIRS: &[&str] = &[".git", "node_modules", "target", "bin", "obj", "dist"];

/// 候选身份的唯一格式定义：由 Provider 与配置绑定共同引用，避免两处拼接漂移。
pub fn fixture_candidate_identity(manifest_path: &str) -> String {
    format!("{FIXTURE_PROVIDER_ID}:{manifest_path}")
}

fn inspection_error(code: &str, message: impl Into<String>) -> PublishError {
    PublishError::ProjectInspection {
        code: code.to_string(),
        message: message.into(),
    }
}

/// 清单里的项目声明；也是构建节点产出的确定性 bundle 内容。
/// 字段缺失交给语义校验统一拒绝，解析错误只对应非法 JSON。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct FixtureManifest {
    #[serde(default)]
    name: String,
    #[serde(default)]
    version: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FixtureAppInspection {
    pub candidate: ProjectCandidate,
    pub manifest_path: String,
    pub app_name: String,
    pub version: String,
}

/// 仅用于 conformance 与集成测试的第二 Project Provider（Issue T18）：
/// 以 `fixture-app.json` 清单模拟未来 Electron、Wails 等桌面 Provider 的
/// 发现、版本语义、构建计划与 Artifact Role 形状。它不构成生产级框架支持，
/// 也不进入生产 Adapter Catalog；发布核心与各 Delivery Destination 对它一无所知。
pub struct FixtureAppProvider {
    descriptor: AdapterDescriptor,
    repository_root: PathBuf,
}

impl FixtureAppProvider {
    /// 执行节点拿不到仓库根参数，因此像组装根构造执行 Provider 那样把
    /// 仓库上下文注入注册实例；发现服务仍以参数接收任意仓库根。
    /// 同一实例同时用于发现与执行时，两个根必须指向同一仓库。
    pub fn new(repository_root: impl Into<PathBuf>) -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ProjectProvider,
                FIXTURE_PROVIDER_ID,
                1,
                AdapterSchema::new(2).with_required_string(MANIFEST_PATH_SETTING),
                PublishingCapability {
                    provides: vec![Capability::new(ARTIFACT_CANDIDATE_CAPABILITY, 1)],
                    requires: vec![CapabilityRequirement::exact(
                        STRUCTURED_PLAN_EXECUTION_CAPABILITY,
                        1,
                    )],
                },
            )
            .with_allowed_program(FIXTURE_BUILD_PROGRAM),
            repository_root: repository_root.into(),
        }
    }

    /// 检查一个候选：解析清单里的应用名与版本。允许预发布 semver 是本
    /// Provider 的版本策略，不是发布核心的约束（ADR-0028）。
    pub fn inspect(&self, manifest_path: &str) -> Result<FixtureAppInspection, PublishError> {
        let root = canonical_root(&self.repository_root)?;
        if !is_safe_portable_relative_path(manifest_path) {
            return Err(inspection_error(
                "fixture_app_manifest_path_invalid",
                format!("{manifest_path} is not a portable repository-relative path"),
            ));
        }
        let manifest = read_manifest(&root.join(manifest_path))?;
        Ok(FixtureAppInspection {
            candidate: candidate_for_manifest(&root, manifest_path)?,
            manifest_path: manifest_path.to_string(),
            app_name: manifest.name,
            version: manifest.version,
        })
    }
}

impl AdapterContract for FixtureAppProvider {
    fn descriptor(&self) -> &AdapterDescriptor {
        &self.descriptor
    }

    fn default_settings(&self) -> AdapterSettings {
        AdapterSettings::new(2).with_value(
            MANIFEST_PATH_SETTING,
            Value::String(FIXTURE_MANIFEST_FILE_NAME.to_string()),
        )
    }

    /// v1 把清单路径记在 `manifest` 字段；显式逐级迁移到 v2 的
    /// `manifest_path`，其余版本一律拒绝（ADR-0031）。
    fn migrate_settings(
        &self,
        settings: &AdapterSettings,
    ) -> Result<AdapterSettings, PublishError> {
        match settings.schema_version {
            1 => {
                let mut migrated = AdapterSettings::new(2);
                if let Some(manifest) = settings.values.get(LEGACY_MANIFEST_SETTING) {
                    migrated = migrated.with_value(MANIFEST_PATH_SETTING, manifest.clone());
                }
                Ok(migrated)
            }
            2 => Ok(settings.clone()),
            actual => Err(PublishError::UnsupportedSchemaVersion {
                adapter: self.descriptor.identity().display_name(),
                actual,
                current: 2,
            }),
        }
    }

    fn validate_settings(&self, settings: &AdapterSettings) -> Result<(), PublishError> {
        crate::validate_settings_against_schema(self.descriptor(), settings)?;
        bound_manifest_path(settings, &self.descriptor.identity().display_name())?;
        Ok(())
    }

    fn plan_fragment(
        &self,
        _snapshot: &PlanningInputSnapshot,
        settings: &AdapterSettings,
    ) -> Result<Vec<PlanNodeTemplate>, PublishError> {
        let adapter = self.descriptor.identity().display_name();
        let manifest_path = bound_manifest_path(settings, &adapter)?;

        Ok(vec![
            PlanNodeTemplate::adapter_action(
                "inspect",
                PlanStage::InspectSource,
                FIXTURE_INSPECT_ACTION,
                BTreeMap::from([(
                    MANIFEST_PATH_SETTING.to_string(),
                    Value::String(manifest_path.clone()),
                )]),
            ),
            PlanNodeTemplate::command(
                "build",
                PlanStage::Build,
                FIXTURE_BUILD_PROGRAM,
                vec!["--manifest".to_string(), manifest_path],
            )
            .with_artifact_io(Vec::new(), vec![FIXTURE_BUNDLE_ROLE.to_string()])
            .with_side_effects(vec![PlanSideEffect::FileSystem]),
        ])
    }

    fn execute_node(
        &self,
        node: &publish_domain::PlanNode,
        _context: &AdapterExecutionContext<'_>,
    ) -> Result<AdapterExecutionOutput, PublishError> {
        match &node.operation {
            PlanOperation::AdapterAction { action, .. } if action == FIXTURE_INSPECT_ACTION => {
                let manifest_path = sealed_inputs(node)?
                    .get(MANIFEST_PATH_SETTING)
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        PublishError::Execution(format!(
                            "node {} does not seal the fixture manifest path",
                            node.id
                        ))
                    })?;
                self.inspect(manifest_path)?;
                Ok(AdapterExecutionOutput::default())
            }
            PlanOperation::RunProgram { program, .. } if program == FIXTURE_BUILD_PROGRAM => {
                let adapter = self.descriptor.identity().display_name();
                let manifest_path = bound_manifest_path(&node.settings, &adapter)?;
                let inspection = self.inspect(&manifest_path)?;
                Ok(AdapterExecutionOutput {
                    artifacts: vec![bundle_artifact(&inspection)?],
                    ..AdapterExecutionOutput::default()
                })
            }
            _ => Err(PublishError::Execution(format!(
                "node {} is not a fixture provider operation",
                node.id
            ))),
        }
    }
}

impl ProjectProvider for FixtureAppProvider {
    fn discover_candidates(
        &self,
        repository_root: &Path,
    ) -> Result<Vec<ProjectCandidate>, PublishError> {
        let root = canonical_root(repository_root)?;
        let mut manifest_paths = Vec::new();
        collect_manifest_paths(&root, &root, &mut manifest_paths)?;
        manifest_paths.sort();
        manifest_paths
            .iter()
            .map(|manifest_path| candidate_for_manifest(&root, manifest_path))
            .collect()
    }
}

/// 解析绑定设置；清单路径必须显式存在且可移植，不做任何猜测或回退。
fn bound_manifest_path(settings: &AdapterSettings, adapter: &str) -> Result<String, PublishError> {
    let manifest_path = settings.string(MANIFEST_PATH_SETTING, adapter)?;
    if !is_safe_portable_relative_path(manifest_path) {
        return Err(PublishError::InvalidAdapterSettings {
            adapter: adapter.to_string(),
            message: format!("{MANIFEST_PATH_SETTING} must be a portable repository-relative path"),
        });
    }
    Ok(manifest_path.to_string())
}

fn canonical_root(repository_root: &Path) -> Result<PathBuf, PublishError> {
    repository_root.canonicalize().map_err(|error| {
        inspection_error(
            "fixture_app_repository_path_invalid",
            format!(
                "failed to resolve repository {}: {error}",
                repository_root.display()
            ),
        )
    })
}

fn candidate_for_manifest(
    root: &Path,
    manifest_path: &str,
) -> Result<ProjectCandidate, PublishError> {
    let project_root = root
        .join(manifest_path)
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| {
            inspection_error(
                "fixture_app_root_missing",
                format!("cannot resolve project root from {manifest_path}"),
            )
        })?;
    Ok(ProjectCandidate {
        identity: fixture_candidate_identity(manifest_path),
        provider_id: FIXTURE_PROVIDER_ID.to_string(),
        project_root: relative_path(root, &project_root)?,
        evidence: vec![ProjectDetectionEvidence {
            path: manifest_path.to_string(),
            detail: "Fixture app manifest".to_string(),
        }],
    })
}

fn collect_manifest_paths(
    root: &Path,
    directory: &Path,
    manifest_paths: &mut Vec<String>,
) -> Result<(), PublishError> {
    let entries = std::fs::read_dir(directory).map_err(|error| PublishError::Io {
        operation: format!("scan directory {}", directory.display()),
        message: error.to_string(),
    })?;
    for entry in entries {
        let entry = entry.map_err(|error| PublishError::Io {
            operation: format!("scan directory {}", directory.display()),
            message: error.to_string(),
        })?;
        let path = entry.path();
        let file_type = entry.file_type().map_err(|error| PublishError::Io {
            operation: format!("inspect {}", path.display()),
            message: error.to_string(),
        })?;
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if file_type.is_dir() {
            if !DISCOVERY_SKIP_DIRS.contains(&name) {
                collect_manifest_paths(root, &path, manifest_paths)?;
            }
        } else if file_type.is_file() && name == FIXTURE_MANIFEST_FILE_NAME {
            manifest_paths.push(relative_path(root, &path)?);
        }
    }
    Ok(())
}

fn relative_path(root: &Path, path: &Path) -> Result<String, PublishError> {
    let normalized = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let relative = normalized.strip_prefix(root).map_err(|_| {
        inspection_error(
            "fixture_app_outside_repository",
            format!(
                "{} is outside repository {}",
                path.display(),
                root.display()
            ),
        )
    })?;
    if relative.as_os_str().is_empty() {
        return Ok(".".to_string());
    }
    Ok(relative.to_string_lossy().replace('\\', "/"))
}

fn read_manifest(path: &Path) -> Result<FixtureManifest, PublishError> {
    let content = std::fs::read_to_string(path).map_err(|error| {
        inspection_error(
            "fixture_app_manifest_read_failed",
            format!("failed to read {}: {error}", path.display()),
        )
    })?;
    let manifest: FixtureManifest = serde_json::from_str(&content).map_err(|error| {
        inspection_error(
            "fixture_app_manifest_parse_failed",
            format!("failed to parse {}: {error}", path.display()),
        )
    })?;
    if !is_portable_app_name(&manifest.name) {
        return Err(inspection_error(
            "fixture_app_name_invalid",
            format!(
                "fixture app names must use portable file-name characters: {}",
                manifest.name
            ),
        ));
    }
    if semver::Version::parse(&manifest.version).is_err() {
        return Err(inspection_error(
            "fixture_app_version_invalid",
            format!(
                "fixture app versions must be semantic versions: {}",
                manifest.version
            ),
        ));
    }
    Ok(manifest)
}

/// 应用名进入产物文件名，因此限制为可移植文件名字符集。
fn is_portable_app_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

/// 构建节点的确定性产物：内容只由清单声明决定，重复构建得到相同字节。
fn bundle_artifact(inspection: &FixtureAppInspection) -> Result<ArtifactCandidate, PublishError> {
    let manifest = FixtureManifest {
        name: inspection.app_name.clone(),
        version: inspection.version.clone(),
    };
    let bytes = serde_json::to_vec(&manifest).map_err(|error| {
        PublishError::Execution(format!("cannot serialize fixture bundle: {error}"))
    })?;
    Ok(ArtifactCandidate::new(
        FIXTURE_BUNDLE_ROLE,
        format!("{}_{}.fixture-bundle.json", manifest.name, manifest.version),
        "application/json",
        "any",
        "any",
        bytes,
    ))
}
