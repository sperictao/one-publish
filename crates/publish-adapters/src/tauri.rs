use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use publish_domain::{
    is_safe_portable_relative_path, AdapterDescriptor, AdapterKind, AdapterSchema, AdapterSettings,
    Capability, CapabilityRequirement, PlanNodePlatform, PlanNodeTemplate, PlanSideEffect,
    PlanStage, PlanningInputSnapshot, ProjectCandidate, ProjectDetectionEvidence, PublishError,
    PublishingCapability,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{AdapterContract, ProjectProvider};

pub const TAURI_PROVIDER_ID: &str = "tauri";

const CONFIG_FILE_NAMES: &[&str] = &["tauri.conf.json", "tauri.conf.json5", "Tauri.toml"];
const DISCOVERY_SKIP_DIRS: &[&str] = &[".git", "node_modules", "target", "bin", "obj", "dist"];
const CONFIG_PATH_SETTING: &str = "config_path";
const BUILD_DRIVER_SETTING: &str = "build_driver";
/// 远端分片展开的启用构建目标（决议 #85）；缺省即本地宿主单构建。
pub const ENABLED_TARGETS_SETTING: &str = "enabled_targets";
pub const TAURI_INSPECT_ACTION: &str = "inspect_tauri_project";

/// 候选身份的唯一格式定义：由 Provider 与配置绑定共同引用，避免两处拼接漂移。
pub fn candidate_identity(config_path: &str) -> String {
    format!("{TAURI_PROVIDER_ID}:{config_path}")
}

fn inspection_error(code: &str, message: impl Into<String>) -> PublishError {
    PublishError::ProjectInspection {
        code: code.to_string(),
        message: message.into(),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TauriBuildDriver {
    Pnpm,
    Npm,
    Yarn,
    Bun,
    Cargo,
}

impl TauriBuildDriver {
    pub const ALL: [Self; 5] = [Self::Pnpm, Self::Npm, Self::Yarn, Self::Bun, Self::Cargo];

    pub fn name(self) -> &'static str {
        match self {
            Self::Pnpm => "pnpm",
            Self::Npm => "npm",
            Self::Yarn => "yarn",
            Self::Bun => "bun",
            Self::Cargo => "cargo",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|driver| driver.name() == value)
    }

    /// 计划节点使用的不透明可执行标识；由执行后端解析为真实程序。
    pub fn program_id(self) -> String {
        format!("tauri-driver:{}", self.name())
    }

    pub fn build_args(self) -> &'static [&'static str] {
        match self {
            Self::Npm => &["run", "tauri", "--", "build"],
            Self::Pnpm | Self::Yarn | Self::Bun | Self::Cargo => &["tauri", "build"],
        }
    }

    /// 计划与执行共用的完整构建参数；配置入口是驱动命令的一部分而不是调用方拼接约定。
    pub fn build_command_args(self, config_path: &str) -> Vec<String> {
        let mut args = self
            .build_args()
            .iter()
            .map(|arg| (*arg).to_string())
            .collect::<Vec<_>>();
        args.push("--config".to_string());
        args.push(config_path.to_string());
        args
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TauriVersionSourceKind {
    TauriConfig,
    ReferencedPackageJson,
    CargoToml,
}

/// 权威版本来源：按 Tauri 自身解析规则决定应用当前版本的唯一字段或被引用文件。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TauriVersionSource {
    pub kind: TauriVersionSourceKind,
    pub path: String,
    pub selector: String,
    pub version: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VersionMirrorKind {
    JsonPointer,
    TomlKey,
}

/// 版本镜像建议：与权威版本来源当前一致、可被发布接入确认的其他版本字段。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VersionMirror {
    pub path: String,
    pub kind: VersionMirrorKind,
    pub selector: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TauriProjectInspection {
    pub candidate: ProjectCandidate,
    pub config_path: String,
    pub app_root: String,
    pub app_name: String,
    pub build_driver: TauriBuildDriver,
    pub version_source: TauriVersionSource,
    pub updater_enabled: bool,
    pub suggested_version_mirrors: Vec<VersionMirror>,
}

/// 识别并规划完整 Tauri 桌面应用发布的 Project Provider（ADR-0005）。
/// 只负责发现、版本语义与计划；构建执行由执行环境解析计划节点完成。
pub struct TauriProjectProvider {
    descriptor: AdapterDescriptor,
}

impl TauriProjectProvider {
    pub fn new() -> Self {
        let mut descriptor = AdapterDescriptor::new(
            AdapterKind::ProjectProvider,
            TAURI_PROVIDER_ID,
            1,
            AdapterSchema::new(1)
                .with_required_string(CONFIG_PATH_SETTING)
                .with_required_string(BUILD_DRIVER_SETTING),
            PublishingCapability {
                // 构建产物是未验证候选；摘要验证由 Artifact Processor 提供，
                // Provider 不得越权声明已验证能力（ADR-0035、Issue T20）。
                provides: vec![Capability::new(crate::ARTIFACT_CANDIDATE_CAPABILITY, 1)],
                requires: vec![CapabilityRequirement::exact(
                    crate::STRUCTURED_PLAN_EXECUTION_CAPABILITY,
                    1,
                )],
            },
        );
        for driver in TauriBuildDriver::ALL {
            descriptor = descriptor.with_allowed_program(driver.program_id());
        }
        Self { descriptor }
    }

    /// 检查一个候选：解析权威版本来源、版本镜像建议与构建驱动。
    pub fn inspect(
        &self,
        repository_root: &Path,
        config_path: &str,
    ) -> Result<TauriProjectInspection, PublishError> {
        let root = canonical_root(repository_root)?;
        if !is_safe_portable_relative_path(config_path) {
            return Err(inspection_error(
                "tauri_config_path_invalid",
                format!("{config_path} is not a portable repository-relative path"),
            ));
        }
        let absolute_config = root.join(config_path);
        let (configured_version, product_name, updater_enabled) = read_config(&absolute_config)?;
        let version_source =
            resolve_version_source(&root, &absolute_config, configured_version.as_deref())?;
        let app_root = resolve_app_root(&absolute_config).ok_or_else(|| {
            inspection_error(
                "tauri_app_root_missing",
                format!("cannot resolve app root from {config_path}"),
            )
        })?;
        let build_driver = resolve_build_driver(&app_root)?;
        let app_name = product_name
            .filter(|name| !name.trim().is_empty())
            .or_else(|| {
                app_root
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "tauri-app".to_string());

        let suggested_version_mirrors =
            suggested_mirrors(&root, &absolute_config, &app_root, &version_source);
        Ok(TauriProjectInspection {
            candidate: candidate_for_config(&root, config_path)?,
            config_path: config_path.to_string(),
            app_root: relative_path(&root, &app_root)?,
            app_name,
            build_driver,
            version_source,
            updater_enabled,
            suggested_version_mirrors,
        })
    }

    /// 检查 Repository 中的全部候选；发现为空时返回空列表，由调用方决定语义。
    pub fn inspect_repository(
        &self,
        repository_root: &Path,
    ) -> Result<Vec<TauriProjectInspection>, PublishError> {
        self.discovered_config_paths(repository_root)?
            .iter()
            .map(|config_path| self.inspect(repository_root, config_path))
            .collect()
    }

    fn discovered_config_paths(&self, repository_root: &Path) -> Result<Vec<String>, PublishError> {
        let root = canonical_root(repository_root)?;
        let mut config_paths = Vec::new();
        collect_config_paths(&root, &root, &mut config_paths)?;
        config_paths.sort();
        Ok(config_paths)
    }
}

impl Default for TauriProjectProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl AdapterContract for TauriProjectProvider {
    fn descriptor(&self) -> &AdapterDescriptor {
        &self.descriptor
    }

    fn default_settings(&self) -> AdapterSettings {
        AdapterSettings::new(1)
            .with_value(
                CONFIG_PATH_SETTING,
                Value::String("src-tauri/tauri.conf.json".to_string()),
            )
            .with_value(
                BUILD_DRIVER_SETTING,
                Value::String(TauriBuildDriver::Pnpm.name().to_string()),
            )
    }

    fn validate_settings(&self, settings: &AdapterSettings) -> Result<(), PublishError> {
        crate::validate_settings_against_schema(self.descriptor(), settings)?;
        let adapter = self.descriptor.identity().display_name();
        bound_settings(settings, &adapter)?;
        Ok(())
    }

    fn plan_fragment(
        &self,
        _snapshot: &PlanningInputSnapshot,
        settings: &AdapterSettings,
    ) -> Result<Vec<PlanNodeTemplate>, PublishError> {
        let adapter = self.descriptor.identity().display_name();
        let (config_path, build_driver) = bound_settings(settings, &adapter)?;
        let enabled_targets = enabled_build_targets(settings, &adapter)?;

        if enabled_targets.is_empty() {
            // 本地准备路径：节点全部落在宿主平台族（决议 #85）。
            let host = PlanNodePlatform::host();
            return Ok(vec![
                inspect_template("inspect", &config_path, build_driver).with_platform(host),
                build_template("build", &config_path, build_driver, None).with_platform(host),
            ]);
        }

        // 远端分片展开（决议 #85）：按启用平台展开构建节点，亲和由启用
        // 目标输入决定而不是执行宿主——任意 OS 上重放产出同一 plan digest。
        let mut templates = Vec::with_capacity(enabled_targets.len() * 2);
        for target in &enabled_targets {
            let platform = platform_for_build_target(target);
            templates.push(
                inspect_template(format!("inspect-{target}"), &config_path, build_driver)
                    .with_platform(platform),
            );
            templates.push(
                build_template(
                    format!("build-{target}"),
                    &config_path,
                    build_driver,
                    Some(target),
                )
                .with_platform(platform),
            );
        }
        Ok(templates)
    }
}

fn inspect_template(
    local_id: impl Into<String>,
    config_path: &str,
    build_driver: TauriBuildDriver,
) -> PlanNodeTemplate {
    PlanNodeTemplate::adapter_action(
        local_id,
        PlanStage::InspectSource,
        TAURI_INSPECT_ACTION,
        BTreeMap::from([
            (
                CONFIG_PATH_SETTING.to_string(),
                Value::String(config_path.to_string()),
            ),
            (
                BUILD_DRIVER_SETTING.to_string(),
                Value::String(build_driver.name().to_string()),
            ),
        ]),
    )
}

fn build_template(
    local_id: impl Into<String>,
    config_path: &str,
    build_driver: TauriBuildDriver,
    build_target: Option<&str>,
) -> PlanNodeTemplate {
    let mut args = build_driver.build_command_args(config_path);
    if let Some(target) = build_target {
        args.push("--target".to_string());
        args.push(target.to_string());
    }
    PlanNodeTemplate::command(local_id, PlanStage::Build, build_driver.program_id(), args)
        .with_artifact_io(Vec::new(), vec!["provider-output:*".to_string()])
        .with_side_effects(vec![PlanSideEffect::FileSystem])
}

/// 可选的启用构建目标（target triple 数组）；键存在但形状非法必须显式失败。
fn enabled_build_targets(
    settings: &AdapterSettings,
    adapter: &str,
) -> Result<Vec<String>, PublishError> {
    let Some(value) = settings.values.get(ENABLED_TARGETS_SETTING) else {
        return Ok(Vec::new());
    };
    let targets = value
        .as_array()
        .and_then(|values| {
            values
                .iter()
                .map(|value| value.as_str().map(str::to_string))
                .collect::<Option<Vec<_>>>()
        })
        .filter(|targets| !targets.is_empty() && targets.iter().all(|t| !t.trim().is_empty()))
        .ok_or_else(|| PublishError::InvalidAdapterSettings {
            adapter: adapter.to_string(),
            message: format!("{ENABLED_TARGETS_SETTING} must be a non-empty array of target triples"),
        })?;
    Ok(targets)
}

/// build target triple → 平台族亲和；macOS universal 也归 macOS 族。
pub fn platform_for_build_target(target: &str) -> PlanNodePlatform {
    if target.ends_with("apple-darwin") {
        PlanNodePlatform::Macos
    } else if target.contains("windows") {
        PlanNodePlatform::Windows
    } else {
        PlanNodePlatform::Linux
    }
}

impl ProjectProvider for TauriProjectProvider {
    fn discover_candidates(
        &self,
        repository_root: &Path,
    ) -> Result<Vec<ProjectCandidate>, PublishError> {
        let root = canonical_root(repository_root)?;
        self.discovered_config_paths(repository_root)?
            .iter()
            .map(|config_path| candidate_for_config(&root, config_path))
            .collect()
    }
}

/// 解析绑定设置；配置身份与驱动都必须显式存在，不做任何猜测或回退。
fn bound_settings(
    settings: &AdapterSettings,
    adapter: &str,
) -> Result<(String, TauriBuildDriver), PublishError> {
    let config_path = settings.string(CONFIG_PATH_SETTING, adapter)?;
    if !is_safe_portable_relative_path(config_path) {
        return Err(PublishError::InvalidAdapterSettings {
            adapter: adapter.to_string(),
            message: format!("{CONFIG_PATH_SETTING} must be a portable repository-relative path"),
        });
    }
    let raw_driver = settings.string(BUILD_DRIVER_SETTING, adapter)?;
    let build_driver = TauriBuildDriver::parse(raw_driver).ok_or_else(|| {
        PublishError::InvalidAdapterSettings {
            adapter: adapter.to_string(),
            message: format!(
                "{BUILD_DRIVER_SETTING} must be one of pnpm, npm, yarn, bun, cargo; got {raw_driver}"
            ),
        }
    })?;
    Ok((config_path.to_string(), build_driver))
}

fn canonical_root(repository_root: &Path) -> Result<PathBuf, PublishError> {
    repository_root.canonicalize().map_err(|error| {
        inspection_error(
            "tauri_repository_path_invalid",
            format!(
                "failed to resolve repository {}: {error}",
                repository_root.display()
            ),
        )
    })
}

fn candidate_for_config(root: &Path, config_path: &str) -> Result<ProjectCandidate, PublishError> {
    let app_root = resolve_app_root(&root.join(config_path)).ok_or_else(|| {
        inspection_error(
            "tauri_app_root_missing",
            format!("cannot resolve app root from {config_path}"),
        )
    })?;
    Ok(ProjectCandidate {
        identity: candidate_identity(config_path),
        provider_id: TAURI_PROVIDER_ID.to_string(),
        project_root: relative_path(root, &app_root)?,
        evidence: vec![ProjectDetectionEvidence {
            path: config_path.to_string(),
            detail: "Tauri configuration file".to_string(),
        }],
    })
}

fn collect_config_paths(
    root: &Path,
    directory: &Path,
    config_paths: &mut Vec<String>,
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
                collect_config_paths(root, &path, config_paths)?;
            }
        } else if file_type.is_file() && CONFIG_FILE_NAMES.contains(&name) {
            config_paths.push(relative_path(root, &path)?);
        }
    }
    Ok(())
}

fn relative_path(root: &Path, path: &Path) -> Result<String, PublishError> {
    let normalized = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let relative = normalized.strip_prefix(root).map_err(|_| {
        inspection_error(
            "tauri_app_outside_repository",
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

pub fn resolve_app_root(config_path: &Path) -> Option<PathBuf> {
    let config_dir = if config_path.is_dir() {
        config_path.to_path_buf()
    } else {
        config_path.parent()?.to_path_buf()
    };

    if config_dir.file_name().and_then(|name| name.to_str()) == Some("src-tauri") {
        config_dir.parent().map(Path::to_path_buf)
    } else {
        Some(config_dir)
    }
}

fn read_config(config_path: &Path) -> Result<(Option<String>, Option<String>, bool), PublishError> {
    let content = std::fs::read_to_string(config_path).map_err(|error| {
        inspection_error(
            "tauri_config_read_failed",
            format!("failed to read {}: {error}", config_path.display()),
        )
    })?;
    if config_path.file_name().and_then(|name| name.to_str()) == Some("Tauri.toml") {
        let document = content.parse::<toml_edit::DocumentMut>().map_err(|error| {
            inspection_error(
                "tauri_config_parse_failed",
                format!("failed to parse {}: {error}", config_path.display()),
            )
        })?;
        return Ok((
            document
                .get("version")
                .and_then(|item| item.as_str())
                .map(str::to_string),
            document
                .get("productName")
                .and_then(|item| item.as_str())
                .map(str::to_string),
            document
                .get("bundle")
                .and_then(|item| item.get("createUpdaterArtifacts"))
                .and_then(|item| item.as_bool())
                .unwrap_or(false),
        ));
    }

    let config: Value = serde_json::from_str(&content)
        .or_else(|_| json5::from_str(&content))
        .map_err(|error| {
            inspection_error(
                "tauri_config_parse_failed",
                format!("failed to parse {}: {error}", config_path.display()),
            )
        })?;
    Ok((
        config
            .get("version")
            .and_then(Value::as_str)
            .map(str::to_string),
        config
            .get("productName")
            .and_then(Value::as_str)
            .map(str::to_string),
        config
            .pointer("/bundle/createUpdaterArtifacts")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    ))
}

fn read_package_version(path: &Path) -> Result<String, PublishError> {
    let content = std::fs::read_to_string(path).map_err(|error| {
        inspection_error(
            "tauri_version_file_read_failed",
            format!("failed to read version file {}: {error}", path.display()),
        )
    })?;
    let value: Value = serde_json::from_str(&content).map_err(|error| {
        inspection_error(
            "tauri_version_file_parse_failed",
            format!("failed to parse version file {}: {error}", path.display()),
        )
    })?;
    value
        .get("version")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| {
            inspection_error(
                "tauri_version_missing",
                format!("missing version in {}", path.display()),
            )
        })
}

fn read_cargo_version(path: &Path) -> Result<String, PublishError> {
    let content = std::fs::read_to_string(path).map_err(|error| {
        inspection_error(
            "tauri_cargo_toml_read_failed",
            format!("failed to read {}: {error}", path.display()),
        )
    })?;
    let document = content.parse::<toml_edit::DocumentMut>().map_err(|error| {
        inspection_error(
            "tauri_cargo_toml_parse_failed",
            format!("failed to parse {}: {error}", path.display()),
        )
    })?;
    document
        .get("package")
        .and_then(|item| item.get("version"))
        .and_then(|item| item.as_str())
        .map(str::to_string)
        .ok_or_else(|| {
            inspection_error(
                "tauri_version_missing",
                format!("missing package.version in {}", path.display()),
            )
        })
}

/// 稳定 major.minor.patch 是 Tauri Provider 的版本策略，不是发布核心的约束（ADR-0028）。
fn ensure_stable_semver(version: &str, path: &Path) -> Result<String, PublishError> {
    let parsed = semver::Version::parse(version).map_err(|error| {
        inspection_error(
            "tauri_version_invalid",
            format!("invalid version '{version}' in {}: {error}", path.display()),
        )
    })?;
    if !parsed.pre.is_empty() || !parsed.build.is_empty() {
        return Err(inspection_error(
            "tauri_version_not_stable",
            format!("only stable major.minor.patch versions are supported: {version}"),
        ));
    }
    Ok(parsed.to_string())
}

fn resolve_version_source(
    root: &Path,
    config_path: &Path,
    configured_version: Option<&str>,
) -> Result<TauriVersionSource, PublishError> {
    let config_dir = config_path.parent().ok_or_else(|| {
        inspection_error(
            "tauri_app_root_missing",
            "Tauri config has no parent directory",
        )
    })?;

    if let Some(raw) = configured_version
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if semver::Version::parse(raw).is_ok() {
            return Ok(TauriVersionSource {
                kind: TauriVersionSourceKind::TauriConfig,
                path: relative_path(root, config_path)?,
                selector: "version".to_string(),
                version: ensure_stable_semver(raw, config_path)?,
            });
        }

        let referenced = config_dir.join(raw);
        let version = ensure_stable_semver(&read_package_version(&referenced)?, &referenced)?;
        return Ok(TauriVersionSource {
            kind: TauriVersionSourceKind::ReferencedPackageJson,
            path: relative_path(root, &referenced)?,
            selector: "/version".to_string(),
            version,
        });
    }

    let cargo_toml = config_dir.join("Cargo.toml");
    let version = read_cargo_version(&cargo_toml)?;
    Ok(TauriVersionSource {
        kind: TauriVersionSourceKind::CargoToml,
        path: relative_path(root, &cargo_toml)?,
        selector: "package.version".to_string(),
        version: ensure_stable_semver(&version, &cargo_toml)?,
    })
}

fn suggested_mirrors(
    root: &Path,
    config_path: &Path,
    app_root: &Path,
    version_source: &TauriVersionSource,
) -> Vec<VersionMirror> {
    let mut mirrors = Vec::new();
    let mut suggest =
        |path: PathBuf, kind: VersionMirrorKind, selector: &str, version: Option<String>| {
            let Some(version) = version else {
                return;
            };
            let Ok(relative) = relative_path(root, &path) else {
                return;
            };
            if version == version_source.version && relative != version_source.path {
                mirrors.push(VersionMirror {
                    path: relative,
                    kind,
                    selector: selector.to_string(),
                });
            }
        };

    let package_json = app_root.join("package.json");
    if package_json.is_file() {
        suggest(
            package_json.clone(),
            VersionMirrorKind::JsonPointer,
            "/version",
            read_package_version(&package_json).ok(),
        );
    }
    if let Some(cargo_toml) = config_path.parent().map(|parent| parent.join("Cargo.toml")) {
        if cargo_toml.is_file() {
            suggest(
                cargo_toml.clone(),
                VersionMirrorKind::TomlKey,
                "package.version",
                read_cargo_version(&cargo_toml).ok(),
            );
        }
    }
    mirrors
}

fn declared_package_manager(app_root: &Path) -> Result<Option<TauriBuildDriver>, PublishError> {
    let package_json_path = app_root.join("package.json");
    if !package_json_path.is_file() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&package_json_path).map_err(|error| {
        inspection_error(
            "tauri_package_json_read_failed",
            format!("failed to read {}: {error}", package_json_path.display()),
        )
    })?;
    let value: Value = serde_json::from_str(&content).map_err(|error| {
        inspection_error(
            "tauri_package_json_invalid",
            format!("failed to parse {}: {error}", package_json_path.display()),
        )
    })?;
    let Some(raw) = value.get("packageManager").and_then(Value::as_str) else {
        return Ok(None);
    };
    let name = raw.split('@').next().unwrap_or(raw);
    match TauriBuildDriver::parse(name) {
        Some(TauriBuildDriver::Cargo) | None => Err(inspection_error(
            "tauri_package_manager_unsupported",
            format!(
                "unsupported packageManager '{name}' in {}",
                package_json_path.display()
            ),
        )),
        Some(driver) => Ok(Some(driver)),
    }
}

fn lockfile_drivers(app_root: &Path) -> Vec<TauriBuildDriver> {
    [
        ("pnpm-lock.yaml", TauriBuildDriver::Pnpm),
        ("package-lock.json", TauriBuildDriver::Npm),
        ("npm-shrinkwrap.json", TauriBuildDriver::Npm),
        ("yarn.lock", TauriBuildDriver::Yarn),
        ("bun.lock", TauriBuildDriver::Bun),
        ("bun.lockb", TauriBuildDriver::Bun),
    ]
    .into_iter()
    .filter_map(|(name, driver)| app_root.join(name).is_file().then_some(driver))
    .fold(Vec::new(), |mut drivers, driver| {
        if !drivers.contains(&driver) {
            drivers.push(driver);
        }
        drivers
    })
}

/// 构建驱动是唯一确定的调用方式：声明与锁文件冲突时阻断，绝不猜测或回退（领域词汇 Tauri 构建驱动）。
pub fn resolve_build_driver(app_root: &Path) -> Result<TauriBuildDriver, PublishError> {
    let declared = declared_package_manager(app_root)?;
    let lockfiles = lockfile_drivers(app_root);

    if lockfiles.len() > 1 {
        return Err(inspection_error(
            "tauri_build_driver_conflict",
            format!(
                "conflicting Tauri package-manager lockfiles: {}",
                lockfiles
                    .iter()
                    .map(|driver| driver.name())
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        ));
    }

    if let (Some(declared), Some(lockfile)) = (declared, lockfiles.first().copied()) {
        if declared != lockfile {
            return Err(inspection_error(
                "tauri_build_driver_conflict",
                format!(
                    "packageManager '{}' conflicts with '{}' lockfile",
                    declared.name(),
                    lockfile.name()
                ),
            ));
        }
        return Ok(declared);
    }

    if let Some(driver) = declared.or_else(|| lockfiles.first().copied()) {
        return Ok(driver);
    }

    if app_root.join("src-tauri").join("Cargo.toml").is_file()
        || app_root.join("Cargo.toml").is_file()
    {
        return Ok(TauriBuildDriver::Cargo);
    }

    Err(inspection_error(
        "tauri_build_driver_missing",
        format!(
            "cannot determine a Tauri build driver for {}",
            app_root.display()
        ),
    ))
}

// ===== 运行时包装（决议 #80：Provider 下沉，shell 不再定义 Provider）=====

pub const TAURI_RELEASE_GATE_ACTION: &str = "run_release_gate";
pub const RELEASE_GATES_INPUT: &str = "release_gates";

/// 密封进计划输入的 Release Gate 形状；与控制面 ReleaseGate 的序列化兼容，
/// 由 seal/decode 测试锁定。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SealedReleaseGate {
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
}

/// Tauri 配置的运行时包装：发现、检查与计划委托内置 Tauri Provider（合同不变），
/// 并补充 Release Gate 节点；构建按密封计划节点直接经执行端口运行，
/// 不桥接旧的发布规格管道。
pub struct TauriRuntimeProvider {
    provider: TauriProjectProvider,
    default_settings: AdapterSettings,
    repository_root: PathBuf,
    execution: Option<crate::bridge::ProviderExecution>,
}

impl TauriRuntimeProvider {
    pub fn new(
        config_path: String,
        build_driver: String,
        repository_root: PathBuf,
        execution: Option<crate::bridge::ProviderExecution>,
    ) -> Self {
        let default_settings = AdapterSettings::new(1)
            .with_value(CONFIG_PATH_SETTING, Value::String(config_path))
            .with_value(BUILD_DRIVER_SETTING, Value::String(build_driver));
        Self {
            provider: TauriProjectProvider::new(),
            default_settings,
            repository_root,
            execution,
        }
    }

    /// 执行密封的 Tauri 构建节点：程序与参数只能来自计划节点固定的构建驱动，
    /// 配置入口在执行时物化为绝对路径，工作目录为应用根（与驱动命令语义一致）。
    fn run_sealed_build(
        &self,
        node: &publish_domain::PlanNode,
        config_path: &str,
        driver: TauriBuildDriver,
        build_target: Option<&str>,
    ) -> Result<crate::AdapterExecutionOutput, PublishError> {
        let execution = self.execution.as_ref().ok_or_else(|| {
            PublishError::Execution(
                "tauri execution port is unavailable for this runtime".to_string(),
            )
        })?;
        let absolute_config = self.repository_root.join(config_path);
        let app_root = resolve_app_root(&absolute_config).ok_or_else(|| {
            PublishError::Execution(format!(
                "cannot resolve Tauri app root from {config_path} for node {}",
                node.id
            ))
        })?;
        let mut args = driver
            .build_args()
            .iter()
            .map(|arg| (*arg).to_string())
            .collect::<Vec<_>>();
        args.push("--config".to_string());
        args.push(absolute_config.to_string_lossy().to_string());
        if let Some(target) = build_target {
            args.push("--target".to_string());
            args.push(target.to_string());
        }
        // 分片构建（决议 #85）：每个目标物化进输出目录的 per-target 子目录，
        // 同一 job 内多目标互不重复收集；产物结构知识（bundle 布局）属本
        // Provider，端口只负责跑命令。本地无目标路径保持桌面合同不变。
        match build_target {
            None => {
                let outcome = execution
                    .port
                    .execute_build(crate::bridge::SealedBuildCommand {
                        provider_id: TAURI_PROVIDER_ID.to_string(),
                        program: driver.name().to_string(),
                        args,
                        working_directory: app_root,
                        output_directory: execution.output_directory.clone(),
                    })
                    .map_err(|error| PublishError::Execution(error.to_string()))?;
                crate::bridge::finish_provider_execution(execution, outcome, classify_tauri_artifact)
            }
            Some(target) => {
                let staged = execution.output_directory.join(target);
                let outcome = execution
                    .port
                    .execute_build(crate::bridge::SealedBuildCommand {
                        provider_id: TAURI_PROVIDER_ID.to_string(),
                        program: driver.name().to_string(),
                        args,
                        working_directory: app_root.clone(),
                        output_directory: staged.clone(),
                    })
                    .map_err(|error| PublishError::Execution(error.to_string()))?;
                crate::bridge::ensure_provider_outcome(&outcome, &staged)?;
                materialize_target_bundle(&app_root, target, &staged)?;
                execution.source_guard.validate_for_execution()?;
                Ok(crate::AdapterExecutionOutput {
                    artifacts: crate::bridge::collect_artifacts_with(
                        &staged,
                        classify_tauri_artifact,
                    )?,
                    ..crate::AdapterExecutionOutput::default()
                })
            }
        }
    }
}

/// 把驱动的目标 bundle 输出物化进暂存目录：源布局与桌面推导同构
/// （`<app_root>/src-tauri/target/<triple>/release/bundle`）。端口实现
/// 已自行物化（暂存目录非空）时不重复拷贝。
fn materialize_target_bundle(
    app_root: &Path,
    target: &str,
    staged: &Path,
) -> Result<(), PublishError> {
    let already_staged = staged
        .read_dir()
        .map(|mut entries| entries.next().is_some())
        .unwrap_or(false);
    if already_staged {
        return Ok(());
    }
    let bundle_root = app_root
        .join("src-tauri")
        .join("target")
        .join(target)
        .join("release")
        .join("bundle");
    if !bundle_root.is_dir() {
        return Err(PublishError::Execution(format!(
            "sealed build for {target} produced no bundle output at {}",
            bundle_root.display()
        )));
    }
    copy_directory_contents(&bundle_root, staged)
}

fn copy_directory_contents(source: &Path, destination: &Path) -> Result<(), PublishError> {
    std::fs::create_dir_all(destination).map_err(|error| PublishError::Io {
        operation: format!("create staged output {}", destination.display()),
        message: error.to_string(),
    })?;
    for entry in std::fs::read_dir(source).map_err(|error| PublishError::Io {
        operation: format!("read bundle output {}", source.display()),
        message: error.to_string(),
    })? {
        let entry = entry.map_err(|error| PublishError::Io {
            operation: format!("read bundle output {}", source.display()),
            message: error.to_string(),
        })?;
        let from = entry.path();
        let to = destination.join(entry.file_name());
        let file_type = entry.file_type().map_err(|error| PublishError::Io {
            operation: format!("inspect bundle entry {}", from.display()),
            message: error.to_string(),
        })?;
        if file_type.is_symlink() {
            return Err(PublishError::Execution(format!(
                "bundle output cannot contain symbolic links: {}",
                from.display()
            )));
        }
        if file_type.is_dir() {
            copy_directory_contents(&from, &to)?;
        } else {
            std::fs::copy(&from, &to).map_err(|error| PublishError::Io {
                operation: format!("copy bundle artifact {}", from.display()),
                message: error.to_string(),
            })?;
        }
    }
    Ok(())
}

impl AdapterContract for TauriRuntimeProvider {
    fn descriptor(&self) -> &AdapterDescriptor {
        self.provider.descriptor()
    }

    fn default_settings(&self) -> AdapterSettings {
        self.default_settings.clone()
    }

    fn plan_fragment(
        &self,
        snapshot: &PlanningInputSnapshot,
        settings: &AdapterSettings,
    ) -> Result<Vec<PlanNodeTemplate>, PublishError> {
        let mut templates = self.provider.plan_fragment(snapshot, settings)?;
        for (index, gate) in release_gates_from_snapshot(snapshot)?.iter().enumerate() {
            if gate.program.trim().is_empty() {
                return Err(PublishError::InvalidPlan(
                    "release gate program cannot be empty".to_string(),
                ));
            }
            templates.push(
                PlanNodeTemplate::adapter_action(
                    format!("gate-{index}"),
                    PlanStage::PrepareIdentity,
                    TAURI_RELEASE_GATE_ACTION,
                    release_gate_inputs(gate)?,
                )
                // 门禁运行使用者配置的任意程序：副作用必须显式声明（架构 §6）。
                .with_side_effects(vec![PlanSideEffect::FileSystem]),
            );
        }
        Ok(templates)
    }

    fn execute_node(
        &self,
        node: &publish_domain::PlanNode,
        _context: &crate::AdapterExecutionContext<'_>,
    ) -> Result<crate::AdapterExecutionOutput, PublishError> {
        let adapter = self.provider.descriptor().identity().display_name();
        let config_path = node.settings.string(CONFIG_PATH_SETTING, &adapter)?;
        let build_driver = node.settings.string(BUILD_DRIVER_SETTING, &adapter)?;

        match &node.operation {
            publish_domain::PlanOperation::AdapterAction { action, .. }
                if action == TAURI_INSPECT_ACTION =>
            {
                let inspection = self.provider.inspect(&self.repository_root, config_path)?;
                if inspection.build_driver.name() != build_driver {
                    return Err(PublishError::Execution(format!(
                        "tauri build driver drifted from {build_driver} to {}; re-prepare the publish plan",
                        inspection.build_driver.name()
                    )));
                }
                Ok(crate::AdapterExecutionOutput::default())
            }
            publish_domain::PlanOperation::AdapterAction { action, inputs }
                if action == TAURI_RELEASE_GATE_ACTION =>
            {
                run_release_gate(&self.repository_root, node, inputs)
            }
            publish_domain::PlanOperation::RunProgram {
                program,
                args,
                working_directory,
                environment_references,
            } => {
                let driver = TauriBuildDriver::parse(build_driver).ok_or_else(|| {
                    PublishError::Execution(format!("unknown tauri build driver {build_driver}"))
                })?;
                // 工作目录与环境引用由本 Provider 在执行时确定；密封节点携带任何
                // 额外执行输入都视为篡改，而不是被静默丢弃。
                let build_target = sealed_build_target(args, driver, config_path);
                if *program != driver.program_id()
                    || build_target.is_none()
                    || working_directory.is_some()
                    || !environment_references.is_empty()
                {
                    return Err(PublishError::InvalidPlan(format!(
                        "node {} is not the sealed tauri build operation",
                        node.id
                    )));
                }
                self.run_sealed_build(node, config_path, driver, build_target.flatten().as_deref())
            }
            _ => Err(PublishError::Execution(format!(
                "node {} is not a tauri provider operation",
                node.id
            ))),
        }
    }
}

impl ProjectProvider for TauriRuntimeProvider {
    fn discover_candidates(
        &self,
        repository_root: &Path,
    ) -> Result<Vec<ProjectCandidate>, PublishError> {
        self.provider.discover_candidates(repository_root)
    }
}

/// 密封 build 参数的合法形态：驱动基础参数，或基础参数 + `--target <triple>`
///（远端分片展开，决议 #85）。返回 None 表示参数被篡改。
fn sealed_build_target(
    args: &[String],
    driver: TauriBuildDriver,
    config_path: &str,
) -> Option<Option<String>> {
    let base = driver.build_command_args(config_path);
    if args == base.as_slice() {
        return Some(None);
    }
    if args.len() == base.len() + 2
        && args[..base.len()] == base[..]
        && args[base.len()] == "--target"
        && !args[base.len() + 1].trim().is_empty()
    {
        return Some(Some(args[base.len() + 1].clone()));
    }
    None
}

/// 从密封快照读取 Release Gate；缺失键代表没有配置门禁。
fn release_gates_from_snapshot(
    snapshot: &PlanningInputSnapshot,
) -> Result<Vec<SealedReleaseGate>, PublishError> {
    match snapshot.release_input.get(RELEASE_GATES_INPUT) {
        None => Ok(Vec::new()),
        Some(value) => serde_json::from_value(value.clone()).map_err(|error| {
            PublishError::InvalidPlan(format!("sealed release gates cannot be decoded: {error}"))
        }),
    }
}

/// 门禁节点输入直接使用 SealedReleaseGate 的序列化形状；密封与解码共享一个字段来源。
fn release_gate_inputs(gate: &SealedReleaseGate) -> Result<BTreeMap<String, Value>, PublishError> {
    match serde_json::to_value(gate) {
        Ok(Value::Object(fields)) => Ok(fields.into_iter().collect()),
        _ => Err(PublishError::InvalidPlan(
            "release gate cannot be sealed into plan node inputs".to_string(),
        )),
    }
}

/// 在仓库根执行一个结构化门禁命令；任何非零退出都终止后续节点并保留完整输出根因。
fn run_release_gate(
    repository_root: &Path,
    node: &publish_domain::PlanNode,
    inputs: &BTreeMap<String, Value>,
) -> Result<crate::AdapterExecutionOutput, PublishError> {
    let gate: SealedReleaseGate =
        serde_json::from_value(Value::Object(inputs.clone().into_iter().collect())).map_err(
            |error| {
                PublishError::InvalidPlan(format!(
                    "node {} has invalid sealed release gate inputs: {error}",
                    node.id
                ))
            },
        )?;
    if gate.program.trim().is_empty() {
        return Err(PublishError::InvalidPlan(format!(
            "node {} has no sealed release gate program",
            node.id
        )));
    }

    let output = background_command(&gate.program)
        .args(&gate.args)
        .current_dir(repository_root)
        .output()
        .map_err(|error| {
            PublishError::Execution(format!(
                "failed to start release gate '{}': {error}",
                gate.program
            ))
        })?;
    if output.status.success() {
        return Ok(crate::AdapterExecutionOutput::default());
    }
    Err(PublishError::Execution(format!(
        "release gate failed: {} {}\n{}{}",
        gate.program,
        gate.args.join(" "),
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr),
    )))
}

/// 桌面环境下门禁进程不得弹出控制台窗口；与 shell 的进程卫生保持一致。
#[cfg(windows)]
fn background_command(program: &str) -> std::process::Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut command = std::process::Command::new(program);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(not(windows))]
fn background_command(program: &str) -> std::process::Command {
    std::process::Command::new(program)
}

/// Tauri bundle 输出按逻辑角色与媒体类型进入 Artifact Manifest：
/// 安装包、Updater 归档与 Updater 签名可被交付路线按角色选择，其余为构建支撑文件。
fn classify_tauri_artifact(relative: &Path) -> (&'static str, &'static str) {
    let name = relative
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if name.ends_with(".sig") {
        return ("updater-signature", "application/octet-stream");
    }
    if name.ends_with(".app.tar.gz") {
        return ("updater-archive", "application/gzip");
    }
    if name.ends_with(".nsis.zip") || name.ends_with(".msi.zip") {
        return ("updater-archive", "application/zip");
    }
    if name.ends_with(".dmg") {
        return ("installer", "application/x-apple-diskimage");
    }
    if name.ends_with(".msi") {
        return ("installer", "application/x-msi");
    }
    if name.ends_with(".exe") {
        return ("installer", "application/vnd.microsoft.portable-executable");
    }
    if name.ends_with(".appimage") {
        return ("installer", "application/vnd.appimage");
    }
    if name.ends_with(".deb") {
        return ("installer", "application/vnd.debian.binary-package");
    }
    if name.ends_with(".rpm") {
        return ("installer", "application/x-rpm");
    }
    ("build-support", "application/octet-stream")
}

#[cfg(test)]
mod plan_fragment_tests {
    use super::*;
    use crate::AdapterContract;

    fn settings(enabled_targets: Option<Value>) -> AdapterSettings {
        let mut settings = AdapterSettings::new(1)
            .with_value(
                CONFIG_PATH_SETTING,
                Value::String("src-tauri/tauri.conf.json".to_string()),
            )
            .with_value(BUILD_DRIVER_SETTING, Value::String("pnpm".to_string()));
        if let Some(targets) = enabled_targets {
            settings = settings.with_value(ENABLED_TARGETS_SETTING, targets);
        }
        settings
    }

    fn snapshot() -> PlanningInputSnapshot {
        PlanningInputSnapshot {
            version: publish_domain::PLANNING_INPUT_SNAPSHOT_VERSION,
            configuration_revision: "configuration-revision-1".to_string(),
            runtime_revision: "runtime".to_string(),
            release_input: BTreeMap::new(),
            source: publish_domain::SourceSnapshot {
                revision: "0123456789abcdef".to_string(),
                workspace_digest: None,
                dirty: false,
                captured_at: "2026-07-26T10:00:00Z".to_string(),
                reproducible: true,
            },
            external_preconditions: BTreeMap::new(),
            promoted_manifest_digest: None,
            adapters: publish_domain::AdapterSelection {
                project_provider: publish_domain::AdapterBinding::new(
                    "project",
                    publish_domain::AdapterIdentity::new(
                        AdapterKind::ProjectProvider,
                        TAURI_PROVIDER_ID,
                        1,
                    ),
                    AdapterSettings::new(1),
                ),
                artifact_processors: Vec::new(),
                execution_backend: publish_domain::AdapterBinding::new(
                    "backend",
                    publish_domain::AdapterIdentity::new(
                        AdapterKind::ExecutionBackend,
                        "local-execution",
                        1,
                    ),
                    AdapterSettings::new(1),
                ),
                artifact_store: publish_domain::AdapterBinding::new(
                    "store",
                    publish_domain::AdapterIdentity::new(
                        AdapterKind::ArtifactStore,
                        "temporary-artifact-store",
                        1,
                    ),
                    AdapterSettings::new(1),
                ),
                delivery_routes: Vec::new(),
            },
        }
    }

    #[test]
    fn local_plans_keep_a_single_host_build_node() {
        let provider = TauriProjectProvider::new();
        let templates = provider
            .plan_fragment(&snapshot(), &settings(None))
            .expect("plan the local fragment");
        assert_eq!(
            templates
                .iter()
                .map(|template| template.local_id.as_str())
                .collect::<Vec<_>>(),
            vec!["inspect", "build"]
        );
        assert!(templates
            .iter()
            .all(|template| template.platform == PlanNodePlatform::host()));
    }

    #[test]
    fn enabled_targets_expand_per_platform_build_nodes_deterministically() {
        let provider = TauriProjectProvider::new();
        let targets = serde_json::json!([
            "x86_64-unknown-linux-gnu",
            "universal-apple-darwin",
            "x86_64-pc-windows-msvc",
        ]);
        let templates = provider
            .plan_fragment(&snapshot(), &settings(Some(targets)))
            .expect("expand the sharded fragment");

        assert_eq!(templates.len(), 6);
        let build = |target: &str| {
            templates
                .iter()
                .find(|template| template.local_id == format!("build-{target}"))
                .unwrap_or_else(|| panic!("missing build node for {target}"))
        };
        assert_eq!(
            build("x86_64-unknown-linux-gnu").platform,
            PlanNodePlatform::Linux
        );
        assert_eq!(
            build("universal-apple-darwin").platform,
            PlanNodePlatform::Macos
        );
        assert_eq!(
            build("x86_64-pc-windows-msvc").platform,
            PlanNodePlatform::Windows
        );
        let publish_domain::PlanOperation::RunProgram { args, .. } =
            &build("universal-apple-darwin").operation
        else {
            panic!("build node must be a structured command");
        };
        assert_eq!(
            args[args.len() - 2..],
            ["--target".to_string(), "universal-apple-darwin".to_string()]
        );
        // 展开由输入决定，与执行宿主无关：重放产出完全相同的模板序列。
        let replayed = provider
            .plan_fragment(
                &snapshot(),
                &settings(Some(serde_json::json!([
                    "x86_64-unknown-linux-gnu",
                    "universal-apple-darwin",
                    "x86_64-pc-windows-msvc",
                ]))),
            )
            .expect("replay the sharded fragment");
        assert_eq!(templates, replayed);
    }

    #[test]
    fn malformed_enabled_targets_fail_loudly() {
        let provider = TauriProjectProvider::new();
        for malformed in [
            serde_json::json!([]),
            serde_json::json!(["  "]),
            serde_json::json!("x86_64-unknown-linux-gnu"),
            serde_json::json!([1, 2]),
        ] {
            let error = provider
                .plan_fragment(&snapshot(), &settings(Some(malformed.clone())))
                .expect_err("malformed enabled targets must be rejected");
            assert!(
                error.to_string().contains(ENABLED_TARGETS_SETTING),
                "unexpected error for {malformed}: {error}"
            );
        }
    }

    #[test]
    fn sealed_build_args_accept_only_the_optional_target_suffix() {
        let driver = TauriBuildDriver::Pnpm;
        let base = driver.build_command_args("src-tauri/tauri.conf.json");
        assert_eq!(
            sealed_build_target(&base, driver, "src-tauri/tauri.conf.json"),
            Some(None)
        );
        let mut with_target = base.clone();
        with_target.push("--target".to_string());
        with_target.push("aarch64-apple-darwin".to_string());
        assert_eq!(
            sealed_build_target(&with_target, driver, "src-tauri/tauri.conf.json"),
            Some(Some("aarch64-apple-darwin".to_string()))
        );
        let mut tampered = base.clone();
        tampered.push("--dangerous".to_string());
        assert_eq!(
            sealed_build_target(&tampered, driver, "src-tauri/tauri.conf.json"),
            None
        );
    }
}

#[cfg(test)]
mod shard_materialization_tests {
    use super::*;

    #[test]
    fn target_bundles_materialize_once_into_the_staged_directory() {
        let temp = tempfile::tempdir().expect("temp workspace");
        let app_root = temp.path().join("app");
        let bundle = app_root
            .join("src-tauri/target/aarch64-apple-darwin/release/bundle/dmg");
        std::fs::create_dir_all(&bundle).expect("create bundle dir");
        std::fs::write(bundle.join("app.dmg"), b"installer bytes").expect("write artifact");
        let staged = temp.path().join("staged/aarch64-apple-darwin");

        materialize_target_bundle(&app_root, "aarch64-apple-darwin", &staged)
            .expect("materialize the target bundle");
        assert_eq!(
            std::fs::read(staged.join("dmg/app.dmg")).expect("staged artifact"),
            b"installer bytes"
        );

        // 暂存已非空（端口自行物化或重放）时不重复拷贝。
        std::fs::write(bundle.join("late.dmg"), b"late").expect("write late artifact");
        materialize_target_bundle(&app_root, "aarch64-apple-darwin", &staged)
            .expect("an already staged directory is left as-is");
        assert!(!staged.join("dmg/late.dmg").exists());

        let error = materialize_target_bundle(&app_root, "x86_64-unknown-linux-gnu", &staged.join("missing"))
            .expect_err("a missing bundle root must fail loudly");
        assert!(error.to_string().contains("no bundle output"));
    }
}
