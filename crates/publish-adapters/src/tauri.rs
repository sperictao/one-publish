use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use publish_domain::{
    is_safe_portable_relative_path, AdapterDescriptor, AdapterKind, AdapterSchema, AdapterSettings,
    Capability, CapabilityRequirement, PlanNodeTemplate, PlanSideEffect, PlanStage,
    PlanningInputSnapshot, ProjectCandidate, ProjectDetectionEvidence, PublishError,
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
                provides: vec![Capability::new(crate::ARTIFACT_VERIFIED_CAPABILITY, 1)],
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

        Ok(vec![
            PlanNodeTemplate::adapter_action(
                "inspect",
                PlanStage::InspectSource,
                TAURI_INSPECT_ACTION,
                BTreeMap::from([
                    (
                        CONFIG_PATH_SETTING.to_string(),
                        Value::String(config_path.clone()),
                    ),
                    (
                        BUILD_DRIVER_SETTING.to_string(),
                        Value::String(build_driver.name().to_string()),
                    ),
                ]),
            ),
            PlanNodeTemplate::command(
                "build",
                PlanStage::Build,
                build_driver.program_id(),
                build_driver.build_command_args(&config_path),
            )
            .with_artifact_io(Vec::new(), vec!["provider-output:*".to_string()])
            .with_side_effects(vec![PlanSideEffect::FileSystem]),
        ])
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
