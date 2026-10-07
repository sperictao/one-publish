use super::{
    Provider, ProviderCapabilities, ProviderCatalogEntry, ProviderManifest,
    ProviderRepositoryDiscovery, ProviderSourceInputKind,
};
#[cfg(test)]
use super::{ProviderProjectFileMatcher, ProviderProjectPathKind, ProviderRepositoryMarker};
use crate::compiler::CompileError;
use crate::parameter::{parse_schema_json, ParameterSchema, RenderError};
use crate::plan::{ExecutionPlan, PlanStep, PLAN_VERSION};
use crate::spec::{PublishSpec, SpecValue, SPEC_VERSION};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub(crate) const GRADLE_PROJECT_FILES: &[&str] = &[
    "build.gradle",
    "build.gradle.kts",
    "settings.gradle",
    "settings.gradle.kts",
    "gradlew",
    "gradlew.bat",
];

pub struct ProviderRegistry {
    providers: Vec<BuiltInProvider>,
}

impl Default for ProviderRegistry {
    fn default() -> Self {
        Self::new()
    }
}

pub fn provider_registry() -> &'static ProviderRegistry {
    static REGISTRY: OnceLock<ProviderRegistry> = OnceLock::new();
    REGISTRY.get_or_init(ProviderRegistry::new)
}

impl ProviderRegistry {
    pub fn new() -> Self {
        Self {
            providers: super::providers::all(),
        }
    }

    pub fn get(&self, id: &str) -> Result<&dyn Provider, CompileError> {
        self.providers
            .iter()
            .find(|provider| provider.manifest().id == id)
            .map(|provider| provider as &dyn Provider)
            .ok_or_else(|| CompileError::UnsupportedProvider(id.to_string()))
    }

    pub fn catalog_entries(&self) -> Vec<ProviderCatalogEntry> {
        self.providers
            .iter()
            .map(|provider| provider.catalog().clone())
            .collect()
    }

    pub fn known_ids(&self) -> Vec<String> {
        self.providers
            .iter()
            .map(|provider| provider.manifest().id.clone())
            .collect()
    }

    pub fn repository_discoveries(&self) -> impl Iterator<Item = &ProviderRepositoryDiscovery> {
        self.providers
            .iter()
            .map(|provider| &provider.repository_discovery)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BuiltInProviderKind {
    Tauri,
    Dotnet,
    Cargo,
    Go,
    JavaGradle,
}

pub(crate) struct BuiltInProvider {
    pub(crate) kind: BuiltInProviderKind,
    pub(crate) manifest: ProviderManifest,
    pub(crate) capabilities: ProviderCapabilities,
    pub(crate) catalog: ProviderCatalogEntry,
    pub(crate) repository_discovery: ProviderRepositoryDiscovery,
    pub(crate) schema_json: &'static str,
    pub(crate) schema_cache: OnceLock<Result<ParameterSchema, RenderError>>,
    pub(crate) compile_step_id: &'static str,
    pub(crate) compile_title: &'static str,
}

impl BuiltInProvider {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        kind: BuiltInProviderKind,
        manifest: ProviderManifest,
        capabilities: ProviderCapabilities,
        catalog: ProviderCatalogEntry,
        repository_discovery: ProviderRepositoryDiscovery,
        schema_json: &'static str,
        compile_step_id: &'static str,
        compile_title: &'static str,
    ) -> Self {
        Self {
            kind,
            manifest,
            capabilities,
            catalog,
            repository_discovery,
            schema_json,
            schema_cache: OnceLock::new(),
            compile_step_id,
            compile_title,
        }
    }
}

impl Provider for BuiltInProvider {
    fn manifest(&self) -> &ProviderManifest {
        &self.manifest
    }

    fn templates(&self) -> Vec<super::ProviderTemplate> {
        match self.kind {
            BuiltInProviderKind::Dotnet => crate::provider::providers::dotnet::dotnet_templates(),
            _ => Vec::new(),
        }
    }

    fn capabilities(&self) -> &ProviderCapabilities {
        &self.capabilities
    }

    fn catalog(&self) -> &ProviderCatalogEntry {
        &self.catalog
    }

    fn repository_discovery(&self) -> &ProviderRepositoryDiscovery {
        &self.repository_discovery
    }

    fn get_schema(&self) -> Result<ParameterSchema, RenderError> {
        self.schema_cache
            .get_or_init(|| parse_schema_json(self.schema_json))
            .clone()
    }

    fn compile(&self, spec: &PublishSpec) -> Result<ExecutionPlan, CompileError> {
        compile_single_step(spec, self.compile_step_id, self.compile_title)
    }

    fn command_prefix(
        &self,
        spec: &PublishSpec,
    ) -> Result<Option<(String, Vec<String>)>, crate::errors::AppError> {
        match self.kind {
            BuiltInProviderKind::Tauri => {
                super::providers::tauri::resolve_build_command(spec).map(Some)
            }
            _ => Ok(None),
        }
    }

    fn resolve_working_dir(&self, spec: &PublishSpec) -> Option<PathBuf> {
        let path = PathBuf::from(&spec.project_path);
        match self.kind {
            BuiltInProviderKind::Tauri => publish_adapters::tauri::resolve_app_root(&path),
            BuiltInProviderKind::Dotnet => path.parent().map(Path::to_path_buf),
            BuiltInProviderKind::Cargo => resolve_provider_project_dir(path, &["Cargo.toml"]),
            BuiltInProviderKind::Go => resolve_provider_project_dir(path, &["go.mod"]),
            BuiltInProviderKind::JavaGradle => {
                resolve_provider_project_dir(path, GRADLE_PROJECT_FILES)
            }
        }
    }

    fn classify_source_input(&self, relative: &Path) -> ProviderSourceInputKind {
        if is_generated_source_path(self.kind, relative) {
            ProviderSourceInputKind::Generated
        } else if is_declared_non_secret_source_input(self.kind, relative) {
            ProviderSourceInputKind::DeclaredNonSecret
        } else {
            ProviderSourceInputKind::EnvironmentDependent
        }
    }

    fn infer_output_dir(&self, spec: &PublishSpec) -> String {
        match self.kind {
            BuiltInProviderKind::Tauri => super::providers::tauri::infer_bundle_dir(spec),
            BuiltInProviderKind::Dotnet => {
                if let Some(output) = read_parameter_string(&spec.parameters, "output") {
                    return resolve_output_path(output, self.resolve_working_dir(spec));
                }

                // 项目内默认输出 {project_dir}/bin/{configuration}/publish：这是 OnePublish
                // 选定的位置，而非 SDK 默认布局（后者含 TFM/RID 段）；prepare 会把它作为
                // 显式 --output 传入，构建写入位置与产物收集位置因此一致。
                if let Some(parent) = Path::new(&spec.project_path).parent() {
                    let configuration = read_parameter_string(&spec.parameters, "configuration")
                        .unwrap_or_else(|| "Release".to_string());
                    return parent
                        .join("bin")
                        .join(configuration)
                        .join("publish")
                        .to_string_lossy()
                        .to_string();
                }

                String::new()
            }
            BuiltInProviderKind::Cargo => {
                // cargo 产物布局：<target-dir>/[<triple>/]<profile>，target-dir 缺省为项目下的 target。
                let target_dir = read_parameter_string(&spec.parameters, "target_dir")
                    .unwrap_or_else(|| "target".to_string());
                let mut output_dir = PathBuf::from(resolve_output_path(
                    target_dir,
                    self.resolve_working_dir(spec),
                ));
                if let Some(triple) = read_parameter_string(&spec.parameters, "target") {
                    output_dir.push(triple);
                }
                output_dir.push(if read_parameter_bool(&spec.parameters, "release") {
                    "release"
                } else {
                    "debug"
                });
                output_dir.to_string_lossy().to_string()
            }
            BuiltInProviderKind::Go => read_parameter_string(&spec.parameters, "output")
                .map(|output| resolve_output_path(output, self.resolve_working_dir(spec)))
                .unwrap_or_default(),
            BuiltInProviderKind::JavaGradle => self
                .resolve_working_dir(spec)
                .map(|dir| dir.join("build").join("libs").to_string_lossy().to_string())
                .unwrap_or_default(),
        }
    }

    fn configured_output_dir(&self, spec: &PublishSpec) -> Option<String> {
        match self.kind {
            BuiltInProviderKind::Tauri => None,
            BuiltInProviderKind::Dotnet => read_parameter_string(&spec.parameters, "output"),
            BuiltInProviderKind::Cargo => read_parameter_string(&spec.parameters, "target_dir"),
            BuiltInProviderKind::Go => read_parameter_string(&spec.parameters, "output"),
            BuiltInProviderKind::JavaGradle => None,
        }
    }

    fn default_output(
        &self,
        spec: &PublishSpec,
        default_output_dir: &str,
    ) -> Option<super::ProviderDefaultOutput> {
        match self.kind {
            BuiltInProviderKind::Go => super::providers::go::default_output(
                spec,
                &self.resolve_working_dir(spec)?,
                default_output_dir,
            ),
            _ => None,
        }
    }

    fn verify_build_output(&self, output_dir: &Path) -> Result<(), String> {
        match self.kind {
            // cargo 只把最终产物提升到 profile 目录顶层；顶层只剩锁文件、dep-info 时
            // 说明输出目录与实际构建布局不符。
            BuiltInProviderKind::Cargo => require_build_product(
                output_dir,
                is_native_build_product,
                "cargo build produced no executable or library",
            ),
            // 旧 jar 已在构建前清理；build/libs 顶层没有归档说明所选任务不产出 jar。
            BuiltInProviderKind::JavaGradle => require_build_product(
                output_dir,
                is_gradle_archive,
                "gradle build produced no jar, war or ear",
            ),
            _ => Ok(()),
        }
    }

    fn artifact_filter(&self) -> Option<publish_adapters::ArtifactEntryFilter> {
        match self.kind {
            // Go 的缺省输出是单个文件（不经筛选）；显式 `-o <dir>/` 时只交付顶层二进制。
            BuiltInProviderKind::Cargo | BuiltInProviderKind::Go => Some(is_native_build_product),
            BuiltInProviderKind::JavaGradle => Some(is_gradle_archive),
            _ => None,
        }
    }

    fn clears_stale_artifacts(&self) -> bool {
        // build/libs 跨构建保留旧版本 jar（app-1.0.jar 与 app-1.1.jar 并存）；
        // 删除后 Gradle 视输出缺失而重新生成，不会误删本次产物。
        matches!(self.kind, BuiltInProviderKind::JavaGradle)
    }

    fn resolve_runtime_program(
        &self,
        program: &str,
        working_dir: Option<&PathBuf>,
    ) -> Result<String, crate::errors::AppError> {
        match self.kind {
            BuiltInProviderKind::JavaGradle => resolve_gradle_program(program, working_dir),
            _ => Ok(program.to_string()),
        }
    }
}

fn is_generated_source_path(kind: BuiltInProviderKind, relative: &Path) -> bool {
    let components = source_components(relative);
    let Some(first) = components.first().map(String::as_str) else {
        return false;
    };
    if first == ".git" || first.ends_with(".one-publish-deliveries") {
        return true;
    }
    match kind {
        BuiltInProviderKind::Dotnet => matches!(first, "bin" | "obj"),
        BuiltInProviderKind::Cargo => first == "target",
        BuiltInProviderKind::Go => first == "dist",
        BuiltInProviderKind::JavaGradle => matches!(first, ".gradle" | "build" | "out"),
        BuiltInProviderKind::Tauri => {
            matches!(
                first,
                "node_modules" | "target" | "dist" | "build" | ".next" | ".svelte-kit"
            ) || components
                .get(1)
                .is_some_and(|second| first == "src-tauri" && second == "target")
        }
    }
}

fn is_declared_non_secret_source_input(kind: BuiltInProviderKind, relative: &Path) -> bool {
    let components = source_components(relative);
    let file_name = relative
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let extension = relative
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match kind {
        BuiltInProviderKind::Dotnet => {
            matches!(
                extension.as_str(),
                "cs" | "fs"
                    | "vb"
                    | "csproj"
                    | "fsproj"
                    | "vbproj"
                    | "sln"
                    | "slnx"
                    | "props"
                    | "targets"
                    | "resx"
                    | "razor"
                    | "cshtml"
                    | "xaml"
                    | "axaml"
            ) || matches!(
                file_name.as_str(),
                "global.json" | "directory.packages.props" | "packages.lock.json"
            ) || starts_with_source_directory(&components, &["wwwroot"])
                || starts_with_source_directory(&components, &["resources"])
        }
        BuiltInProviderKind::Cargo => {
            extension == "rs"
                || matches!(
                    file_name.as_str(),
                    "cargo.toml" | "cargo.lock" | "rust-toolchain" | "rust-toolchain.toml"
                )
                || starts_with_source_directory(&components, &["assets"])
                || starts_with_source_directory(&components, &["resources"])
        }
        BuiltInProviderKind::Go => {
            extension == "go"
                || matches!(
                    file_name.as_str(),
                    "go.mod" | "go.sum" | "go.work" | "go.work.sum"
                )
                || ["assets", "embed", "static", "templates"]
                    .iter()
                    .any(|directory| starts_with_source_directory(&components, &[*directory]))
        }
        BuiltInProviderKind::JavaGradle => {
            matches!(extension.as_str(), "java" | "kt" | "kts" | "gradle")
                || matches!(
                    file_name.as_str(),
                    "settings.gradle"
                        | "settings.gradle.kts"
                        | "gradlew"
                        | "gradlew.bat"
                        | "gradle-wrapper.jar"
                        | "gradle-wrapper.properties"
                )
                || starts_with_source_directory(&components, &["src", "main", "resources"])
                || starts_with_source_directory(&components, &["src", "test", "resources"])
        }
        BuiltInProviderKind::Tauri => {
            matches!(
                file_name.as_str(),
                "package.json"
                    | "pnpm-lock.yaml"
                    | "package-lock.json"
                    | "npm-shrinkwrap.json"
                    | "yarn.lock"
                    | "bun.lock"
                    | "bun.lockb"
                    | "cargo.toml"
                    | "cargo.lock"
                    | "rust-toolchain"
                    | "rust-toolchain.toml"
                    | "tauri.conf.json"
                    | "tauri.conf.json5"
            ) || ["src", "public", "static"]
                .iter()
                .any(|directory| starts_with_source_directory(&components, &[*directory]))
                || starts_with_source_directory(&components, &["src-tauri", "src"])
                || starts_with_source_directory(&components, &["src-tauri", "icons"])
        }
    }
}

fn source_components(relative: &Path) -> Vec<String> {
    relative
        .components()
        .filter_map(|component| match component {
            std::path::Component::Normal(value) => {
                Some(value.to_string_lossy().to_ascii_lowercase())
            }
            _ => None,
        })
        .collect()
}

fn starts_with_source_directory(components: &[String], prefix: &[&str]) -> bool {
    components
        .iter()
        .map(String::as_str)
        .zip(prefix.iter().copied())
        .all(|(component, expected)| component == expected)
        && components.len() > prefix.len()
}

fn compile_single_step(
    spec: &PublishSpec,
    step_id: &str,
    title: &str,
) -> Result<ExecutionPlan, CompileError> {
    if spec.version != SPEC_VERSION {
        return Err(CompileError::UnsupportedSpecVersion(spec.version));
    }

    let mut payload = BTreeMap::<String, serde_json::Value>::new();
    payload.insert(
        "project_path".to_string(),
        serde_json::Value::String(spec.project_path.clone()),
    );
    payload.insert(
        "parameters".to_string(),
        spec_value_to_json(SpecValue::Map(spec.parameters.clone())),
    );

    let step = PlanStep {
        id: step_id.to_string(),
        title: title.to_string(),
        kind: "process".to_string(),
        payload,
    };

    Ok(ExecutionPlan {
        version: PLAN_VERSION,
        spec: spec.clone(),
        steps: vec![step],
    })
}

fn spec_value_to_json(v: SpecValue) -> serde_json::Value {
    match v {
        SpecValue::Null => serde_json::Value::Null,
        SpecValue::Bool(b) => serde_json::Value::Bool(b),
        SpecValue::Number(n) => serde_json::Number::from_f64(n)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        SpecValue::String(s) => serde_json::Value::String(s),
        SpecValue::List(xs) => {
            serde_json::Value::Array(xs.into_iter().map(spec_value_to_json).collect())
        }
        SpecValue::Map(m) => {
            let obj = m
                .into_iter()
                .map(|(k, v)| (k, spec_value_to_json(v)))
                .collect::<serde_json::Map<String, serde_json::Value>>();
            serde_json::Value::Object(obj)
        }
    }
}

fn resolve_provider_project_dir(path: PathBuf, known_files: &[&str]) -> Option<PathBuf> {
    let looks_like_project_file = path
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| {
            known_files
                .iter()
                .any(|file| name.eq_ignore_ascii_case(file))
        })
        .unwrap_or(false)
        || (!path.is_dir() && path.extension().is_some());

    if looks_like_project_file {
        path.parent().map(Path::to_path_buf)
    } else {
        Some(path)
    }
}

fn resolve_output_path(path: String, base_dir: Option<PathBuf>) -> String {
    if path.is_empty() {
        return path;
    }

    let candidate = PathBuf::from(&path);
    if candidate.is_absolute() {
        return candidate.to_string_lossy().to_string();
    }

    base_dir
        .map(|dir| dir.join(candidate).to_string_lossy().to_string())
        .unwrap_or(path)
}

pub(crate) fn read_parameter_string(
    parameters: &BTreeMap<String, SpecValue>,
    key: &str,
) -> Option<String> {
    match parameters.get(key) {
        Some(SpecValue::String(value)) if !value.is_empty() => Some(value.clone()),
        Some(SpecValue::Number(value)) => Some(value.to_string()),
        _ => None,
    }
}

fn read_parameter_bool(parameters: &BTreeMap<String, SpecValue>, key: &str) -> bool {
    matches!(parameters.get(key), Some(SpecValue::Bool(true)))
}

fn resolve_gradle_program(
    program: &str,
    working_dir: Option<&PathBuf>,
) -> Result<String, crate::errors::AppError> {
    if program != "./gradlew" && program != "gradlew" {
        return Ok(program.to_string());
    }

    let Some(dir) = working_dir else {
        return Err(crate::errors::AppError::publish_with_code(
            "java provider requires a project directory",
            "java_project_dir_required",
        ));
    };

    #[cfg(target_os = "windows")]
    let wrapper_name = "gradlew.bat";
    #[cfg(not(target_os = "windows"))]
    let wrapper_name = "gradlew";

    let wrapper_path = dir.join(wrapper_name);
    if wrapper_path.is_file() {
        return Ok(wrapper_path.to_string_lossy().to_string());
    }

    if crate::environment::command_exists("gradle") {
        return Ok("gradle".to_string());
    }

    Err(crate::errors::AppError::publish_with_code(
        format!(
            "gradle wrapper not found at {} and `gradle` is not available in PATH",
            wrapper_path.to_string_lossy()
        ),
        "java_gradle_not_found",
    ))
}

/// 构建进程成功退出后，输出目录顶层至少要有一个被产物规则接受的条目。
fn require_build_product(
    output_dir: &Path,
    accept: publish_adapters::ArtifactEntryFilter,
    failure: &str,
) -> Result<(), String> {
    let has_build_product = std::fs::read_dir(output_dir)
        .is_ok_and(|entries| entries.flatten().any(|entry| accept(&entry)));
    if has_build_product {
        Ok(())
    } else {
        Err(format!("{failure} in {}", output_dir.display()))
    }
}

/// 输出目录顶层的非隐藏普通文件；子目录一律不是产物（筛选拒绝即不再递归）。
fn top_level_file(entry: &std::fs::DirEntry) -> Option<std::fs::Metadata> {
    if entry.file_name().to_string_lossy().starts_with('.') {
        return None;
    }
    entry.metadata().ok().filter(std::fs::Metadata::is_file)
}

fn lowercase_extension(entry: &std::fs::DirEntry) -> String {
    entry
        .path()
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

/// 原生工具链（cargo、go）的最终产物：可执行文件与库。构建校验与交付筛选共用此规则，
/// 锁文件、dep-info（`.d`）以及 `deps/`、`build/`、`incremental/` 等子目录都不是产物。
fn is_native_build_product(entry: &std::fs::DirEntry) -> bool {
    let Some(metadata) = top_level_file(entry) else {
        return false;
    };
    matches!(
        lowercase_extension(entry).as_str(),
        "exe" | "wasm" | "dll" | "so" | "dylib" | "rlib" | "a" | "lib"
    ) || is_executable_file(&metadata)
}

/// Gradle `build/libs` 顶层的归档产物；`tmp/` 等子目录与隐藏文件不是产物。
fn is_gradle_archive(entry: &std::fs::DirEntry) -> bool {
    top_level_file(entry).is_some()
        && matches!(lowercase_extension(entry).as_str(), "jar" | "war" | "ear")
}

#[cfg(unix)]
fn is_executable_file(metadata: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn is_executable_file(_metadata: &std::fs::Metadata) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_resolves_dotnet_provider() {
        let registry = ProviderRegistry::new();
        let provider = registry.get("dotnet").expect("provider");
        assert_eq!(provider.manifest().id, "dotnet");
        assert_eq!(
            provider.catalog().project_path_kind,
            ProviderProjectPathKind::ProjectFile
        );
    }

    // ── 行为基线（统一发布输入方案 Phase 1）──────────────────────────────
    // 固定各 Provider 的默认输出目录派生规则：统一 prepare 之后，这些规则
    // 集中到后端，模板、普通配置与直接 pubxml 发布共用同一实现。

    fn output_dir_spec(project_path: &Path, parameters: &[(&str, SpecValue)]) -> PublishSpec {
        PublishSpec {
            version: SPEC_VERSION,
            provider_id: String::new(),
            project_path: project_path.to_string_lossy().to_string(),
            parameters: parameters
                .iter()
                .map(|(key, value)| (key.to_string(), value.clone()))
                .collect(),
        }
    }

    #[test]
    fn dotnet_infers_the_default_publish_output_directory() {
        let repository = tempfile::tempdir().expect("create repository");
        let project_path = repository.path().join("App.csproj");
        std::fs::write(&project_path, "<Project />").expect("write project file");
        let registry = ProviderRegistry::new();
        let provider = registry.get("dotnet").expect("provider");

        // 无 output 参数：{project_dir}/bin/{configuration}/publish，缺省 Release；
        // prepare 把该路径作为显式 --output 下发（见 publish_runtime::build_resolved_spec）。
        let spec = output_dir_spec(
            &project_path,
            &[("configuration", SpecValue::String("Debug".to_string()))],
        );
        assert_eq!(
            provider.infer_output_dir(&spec),
            repository.path().join("bin/Debug/publish").to_string_lossy()
        );
        let default_spec = output_dir_spec(&project_path, &[]);
        assert_eq!(
            provider.infer_output_dir(&default_spec),
            repository
                .path()
                .join("bin/Release/publish")
                .to_string_lossy()
        );

        // 显式 output 覆盖推断，且属于已配置输出目录。
        let explicit = output_dir_spec(
            &project_path,
            &[(
                "output",
                SpecValue::String("/tmp/one-publish-out".to_string()),
            )],
        );
        assert_eq!(
            provider.infer_output_dir(&explicit),
            "/tmp/one-publish-out"
        );
        assert_eq!(
            provider.configured_output_dir(&explicit),
            Some("/tmp/one-publish-out".to_string())
        );
        assert_eq!(provider.configured_output_dir(&default_spec), None);
    }

    #[test]
    fn cargo_infers_the_target_profile_directory() {
        let repository = tempfile::tempdir().expect("create repository");
        std::fs::write(repository.path().join("Cargo.toml"), "[package]").expect("write manifest");
        let registry = ProviderRegistry::new();
        let provider = registry.get("cargo").expect("provider");

        let debug_spec = output_dir_spec(repository.path(), &[]);
        assert_eq!(
            provider.infer_output_dir(&debug_spec),
            repository.path().join("target/debug").to_string_lossy()
        );
        let release_spec = output_dir_spec(
            repository.path(),
            &[("release", SpecValue::Bool(true))],
        );
        assert_eq!(
            provider.infer_output_dir(&release_spec),
            repository.path().join("target/release").to_string_lossy()
        );
        assert_eq!(provider.configured_output_dir(&debug_spec), None);
    }

    #[test]
    fn cargo_places_cross_target_output_under_the_triple() {
        let repository = tempfile::tempdir().expect("create repository");
        std::fs::write(repository.path().join("Cargo.toml"), "[package]").expect("write manifest");
        let registry = ProviderRegistry::new();
        let provider = registry.get("cargo").expect("provider");
        let target = (
            "target",
            SpecValue::String("x86_64-unknown-linux-gnu".to_string()),
        );

        let release_spec = output_dir_spec(
            repository.path(),
            &[("release", SpecValue::Bool(true)), target.clone()],
        );
        assert_eq!(
            provider.infer_output_dir(&release_spec),
            repository
                .path()
                .join("target")
                .join("x86_64-unknown-linux-gnu")
                .join("release")
                .to_string_lossy()
        );
        let debug_spec = output_dir_spec(repository.path(), &[target]);
        assert_eq!(
            provider.infer_output_dir(&debug_spec),
            repository
                .path()
                .join("target")
                .join("x86_64-unknown-linux-gnu")
                .join("debug")
                .to_string_lossy()
        );
        assert_eq!(provider.configured_output_dir(&release_spec), None);
    }

    #[test]
    fn cargo_appends_the_profile_to_an_explicit_target_dir() {
        let repository = tempfile::tempdir().expect("create repository");
        std::fs::write(repository.path().join("Cargo.toml"), "[package]").expect("write manifest");
        let registry = ProviderRegistry::new();
        let provider = registry.get("cargo").expect("provider");

        // 相对 target_dir 以项目目录为基准，与 cargo 的 --target-dir 解析一致。
        let relative = output_dir_spec(
            repository.path(),
            &[
                ("release", SpecValue::Bool(true)),
                ("target_dir", SpecValue::String("build-out".to_string())),
            ],
        );
        assert_eq!(
            provider.infer_output_dir(&relative),
            repository
                .path()
                .join("build-out")
                .join("release")
                .to_string_lossy()
        );

        // 显式 target_dir 是已配置输出根目录，profile 子目录仍需派生。
        let absolute_root = repository.path().join("shared-target");
        let absolute_root_text = absolute_root.to_string_lossy().to_string();
        let absolute = output_dir_spec(
            repository.path(),
            &[("target_dir", SpecValue::String(absolute_root_text.clone()))],
        );
        assert_eq!(
            provider.infer_output_dir(&absolute),
            absolute_root.join("debug").to_string_lossy()
        );
        assert_eq!(
            provider.configured_output_dir(&absolute),
            Some(absolute_root_text)
        );
    }

    #[test]
    fn cargo_combines_target_dir_triple_and_profile() {
        let repository = tempfile::tempdir().expect("create repository");
        std::fs::write(repository.path().join("Cargo.toml"), "[package]").expect("write manifest");
        let registry = ProviderRegistry::new();
        let provider = registry.get("cargo").expect("provider");

        let spec = output_dir_spec(
            repository.path(),
            &[
                ("release", SpecValue::Bool(true)),
                (
                    "target",
                    SpecValue::String("aarch64-apple-darwin".to_string()),
                ),
                ("target_dir", SpecValue::String("build-out".to_string())),
            ],
        );
        assert_eq!(
            provider.infer_output_dir(&spec),
            repository
                .path()
                .join("build-out")
                .join("aarch64-apple-darwin")
                .join("release")
                .to_string_lossy()
        );
    }

    #[test]
    fn cargo_build_output_requires_an_uplifted_product() {
        let registry = ProviderRegistry::new();
        let provider = registry.get("cargo").expect("provider");
        let profile_dir = tempfile::tempdir().expect("create profile dir");
        let profile = profile_dir.path();

        // 复现输出目录派生错误时的形态：顶层只有锁文件、dep-info 与旧快照，
        // 依赖产物位于子目录，都不是可交付产物。
        for name in [".cargo-lock", "demo.d", "execution-snapshot-2026-10-06.md"] {
            std::fs::write(profile.join(name), "").expect("write non-product file");
        }
        std::fs::create_dir_all(profile.join("deps")).expect("create deps dir");
        std::fs::write(profile.join("deps").join("libdep-0123.rlib"), "")
            .expect("write dependency rlib");
        assert!(provider.verify_build_output(profile).is_err());
        assert!(provider
            .verify_build_output(&profile.join("missing"))
            .is_err());

        std::fs::write(profile.join("libdemo.rlib"), "").expect("write library");
        assert_eq!(provider.verify_build_output(profile), Ok(()));
    }

    #[cfg(unix)]
    #[test]
    fn cargo_build_output_accepts_an_extensionless_executable() {
        use std::os::unix::fs::PermissionsExt;

        let registry = ProviderRegistry::new();
        let provider = registry.get("cargo").expect("provider");
        let profile_dir = tempfile::tempdir().expect("create profile dir");
        let binary = profile_dir.path().join("demo");
        std::fs::write(&binary, "").expect("write binary");
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o644))
            .expect("clear executable bit");
        assert!(provider.verify_build_output(profile_dir.path()).is_err());

        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755))
            .expect("set executable bit");
        assert_eq!(provider.verify_build_output(profile_dir.path()), Ok(()));
    }

    #[test]
    fn providers_declare_build_verification_filtering_and_stale_cleanup() {
        let registry = ProviderRegistry::new();
        let missing = Path::new("/nonexistent/one-publish-output");
        // (id, 校验构建输出, 声明筛选, 构建前清理旧产物)
        for (id, verifies, filters, clears) in [
            ("cargo", true, true, false),
            ("java", true, true, true),
            ("go", false, true, false),
            ("dotnet", false, false, false),
            ("tauri", false, false, false),
        ] {
            let provider = registry.get(id).expect("provider");
            assert_eq!(
                provider.verify_build_output(missing).is_err(),
                verifies,
                "{id}"
            );
            assert_eq!(provider.artifact_filter().is_some(), filters, "{id}");
            assert_eq!(provider.clears_stale_artifacts(), clears, "{id}");
        }
    }

    fn accepted_names(provider: &dyn Provider, directory: &Path) -> Vec<String> {
        let accept = provider
            .artifact_filter()
            .expect("provider declares a filter");
        let mut accepted = std::fs::read_dir(directory)
            .expect("read output dir")
            .flatten()
            .filter(accept)
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect::<Vec<_>>();
        accepted.sort();
        accepted
    }

    #[test]
    fn gradle_artifact_filter_keeps_only_top_level_archives() {
        let registry = ProviderRegistry::new();
        let provider = registry.get("java").expect("provider");
        let libs_dir = tempfile::tempdir().expect("create build/libs");
        let libs = libs_dir.path();

        for name in [".app.jar.lock", "README.txt", "app.pom", "app.module"] {
            std::fs::write(libs.join(name), "").expect("write non-archive file");
        }
        // 子目录里的 jar 不会被遍历（筛选拒绝目录）。
        std::fs::create_dir_all(libs.join("tmp")).expect("create subdirectory");
        std::fs::write(libs.join("tmp").join("nested.jar"), "").expect("write nested jar");
        for name in ["app-1.1-plain.jar", "app-1.1.JAR", "app.ear", "app.war"] {
            std::fs::write(libs.join(name), "").expect("write archive");
        }

        assert_eq!(
            accepted_names(provider, libs),
            ["app-1.1-plain.jar", "app-1.1.JAR", "app.ear", "app.war"]
        );
    }

    #[test]
    fn gradle_build_output_requires_a_top_level_archive() {
        let registry = ProviderRegistry::new();
        let provider = registry.get("java").expect("provider");
        let libs_dir = tempfile::tempdir().expect("create build/libs");
        let libs = libs_dir.path();

        std::fs::create_dir_all(libs.join("tmp")).expect("create subdirectory");
        std::fs::write(libs.join("tmp").join("nested.jar"), "").expect("write nested jar");
        let error = provider
            .verify_build_output(libs)
            .expect_err("no top-level archive");
        assert!(error.contains("gradle build produced no jar"), "{error}");

        std::fs::write(libs.join("app.jar"), "").expect("write jar");
        assert_eq!(provider.verify_build_output(libs), Ok(()));
    }

    #[cfg(unix)]
    #[test]
    fn go_artifact_filter_keeps_only_top_level_binaries_of_a_directory_output() {
        use std::os::unix::fs::PermissionsExt;

        let registry = ProviderRegistry::new();
        let provider = registry.get("go").expect("provider");
        let output_dir = tempfile::tempdir().expect("create -o directory");
        let output = output_dir.path();

        std::fs::write(output.join("notes.txt"), "").expect("write unrelated file");
        std::fs::create_dir_all(output.join("cache")).expect("create subdirectory");
        std::fs::write(output.join("cache").join("tool.exe"), "").expect("write nested binary");
        std::fs::write(output.join("app.exe"), "").expect("write windows binary");
        let unix_binary = output.join("app");
        std::fs::write(&unix_binary, "").expect("write unix binary");
        std::fs::set_permissions(&unix_binary, std::fs::Permissions::from_mode(0o755))
            .expect("mark binary executable");

        assert_eq!(accepted_names(provider, output), ["app", "app.exe"]);
    }

    #[test]
    fn cargo_artifact_filter_keeps_only_uplifted_products() {
        let registry = ProviderRegistry::new();
        let provider = registry.get("cargo").expect("provider");
        let profile_dir = tempfile::tempdir().expect("create profile dir");
        let profile = profile_dir.path();

        // cargo 1.97 profile 目录中的非产物：锁文件、dep-info 与各类中间目录。
        for name in [
            ".cargo-lock",
            ".cargo-build-lock",
            ".cargo-artifact-lock",
            "demo.d",
            "libdemo.d",
        ] {
            std::fs::write(profile.join(name), "").expect("write non-product file");
        }
        for name in [".fingerprint", "build", "deps", "examples", "incremental"] {
            std::fs::create_dir_all(profile.join(name)).expect("create cargo subdirectory");
        }
        let products = [
            "demo.dll",
            "demo.exe",
            "demo.lib",
            "demo.wasm",
            "libdemo.a",
            "libdemo.dylib",
            "libdemo.rlib",
            "libdemo.so",
        ];
        for name in products {
            std::fs::write(profile.join(name), "").expect("write build product");
        }

        assert_eq!(accepted_names(provider, profile), products);
    }

    #[test]
    fn go_derives_a_default_output_file_instead_of_inferring_one() {
        let repository = tempfile::tempdir().expect("create repository");
        std::fs::write(repository.path().join("go.mod"), "module demo").expect("write go.mod");
        let registry = ProviderRegistry::new();
        let provider = registry.get("go").expect("provider");

        // 推断只认显式输出；缺省输出在 prepare 时派生并写入 `-o`。
        let implicit = output_dir_spec(repository.path(), &[]);
        assert_eq!(provider.infer_output_dir(&implicit), "");
        let derived = provider
            .default_output(&implicit, "")
            .expect("go derives a default output");
        assert_eq!(derived.parameter, "output");
        assert!(derived.path.starts_with(repository.path().join("dist")));
        // 项目路径指向 go.mod 时以其所在目录为模块目录。
        let module_file = output_dir_spec(&repository.path().join("go.mod"), &[]);
        assert_eq!(provider.default_output(&module_file, ""), Some(derived));
        // 声明模板的 Provider 不走自行派生。
        assert!(registry
            .get("dotnet")
            .expect("provider")
            .default_output(&implicit, "/default-out")
            .is_none());

        let explicit = output_dir_spec(
            repository.path(),
            &[(
                "output",
                SpecValue::String("/tmp/go-out".to_string()),
            )],
        );
        assert_eq!(provider.infer_output_dir(&explicit), "/tmp/go-out");
        assert_eq!(
            provider.configured_output_dir(&explicit),
            Some("/tmp/go-out".to_string())
        );
    }

    #[test]
    fn java_infers_the_gradle_libs_directory() {
        let repository = tempfile::tempdir().expect("create repository");
        std::fs::write(repository.path().join("build.gradle"), "// gradle").expect("write build");
        let registry = ProviderRegistry::new();
        let provider = registry.get("java").expect("provider");

        let spec = output_dir_spec(repository.path(), &[]);
        assert_eq!(
            provider.infer_output_dir(&spec),
            repository.path().join("build/libs").to_string_lossy()
        );
        assert_eq!(provider.configured_output_dir(&spec), None);
    }

    #[test]
    fn registry_resolves_cargo_provider() {
        let registry = ProviderRegistry::new();
        let provider = registry.get("cargo").expect("provider");
        assert_eq!(provider.manifest().id, "cargo");
        assert_eq!(
            provider.catalog().project_path_kind,
            ProviderProjectPathKind::RepositoryRoot
        );
    }

    #[test]
    fn registry_resolves_tauri_provider() {
        let registry = ProviderRegistry::new();
        let provider = registry.get("tauri").expect("provider");
        assert_eq!(provider.manifest().id, "tauri");
        assert_eq!(provider.catalog().label, "Tauri 2 (desktop)");
        assert_eq!(
            provider.catalog().project_path_kind,
            ProviderProjectPathKind::ProjectFile
        );
    }

    #[test]
    fn registry_resolves_go_provider() {
        let registry = ProviderRegistry::new();
        let provider = registry.get("go").expect("provider");
        assert_eq!(provider.manifest().id, "go");
    }

    #[test]
    fn registry_resolves_java_provider() {
        let registry = ProviderRegistry::new();
        let provider = registry.get("java").expect("provider");
        assert_eq!(provider.manifest().id, "java");
        assert_eq!(provider.catalog().label, "Java (Gradle)");
    }

    #[test]
    fn registry_unknown_provider_is_error() {
        let registry = ProviderRegistry::new();
        let err = match registry.get("nope") {
            Ok(_) => panic!("expected error"),
            Err(err) => err,
        };

        match err {
            CompileError::UnsupportedProvider(id) => assert_eq!(id, "nope"),
            other => panic!("unexpected error: {other:?}"),
        }
    }

    #[test]
    fn catalog_entries_cover_all_known_provider_ids() {
        let registry = ProviderRegistry::new();
        let catalog_ids = registry
            .catalog_entries()
            .into_iter()
            .map(|entry| entry.id)
            .collect::<Vec<_>>();

        assert_eq!(catalog_ids, registry.known_ids());
    }

    #[test]
    fn repository_discoveries_cover_all_known_provider_ids() {
        let registry = ProviderRegistry::new();
        let discovery_ids = registry
            .repository_discoveries()
            .map(|entry| entry.provider_id.clone())
            .collect::<Vec<_>>();

        assert_eq!(discovery_ids, registry.known_ids());
    }

    #[test]
    fn dotnet_repository_discovery_covers_project_extensions() {
        let registry = ProviderRegistry::new();
        let dotnet = registry
            .repository_discoveries()
            .find(|entry| entry.provider_id == "dotnet")
            .expect("dotnet discovery");

        assert!(dotnet
            .repository_markers
            .contains(&ProviderRepositoryMarker::Extension("fsproj".to_string())));
        assert!(dotnet
            .repository_markers
            .contains(&ProviderRepositoryMarker::NestedExtension {
                directory: "src".to_string(),
                extension: "vbproj".to_string(),
            }));
        assert!(dotnet
            .project_file_matchers
            .contains(&ProviderProjectFileMatcher::Extension("fsproj".to_string())));
    }

    #[test]
    fn java_repository_discovery_is_gradle_only() {
        let registry = ProviderRegistry::new();
        let java = registry
            .repository_discoveries()
            .find(|entry| entry.provider_id == "java")
            .expect("java discovery");

        assert!(java
            .project_file_matchers
            .contains(&ProviderProjectFileMatcher::FileName(
                "build.gradle".to_string()
            )));
        assert!(!java
            .project_file_matchers
            .contains(&ProviderProjectFileMatcher::FileName("pom.xml".to_string())));
    }

    #[test]
    fn embedded_schema_is_cached() {
        let registry = ProviderRegistry::new();
        let provider = registry.get("dotnet").expect("provider");
        let first = provider.get_schema().expect("schema");
        let second = provider.get_schema().expect("schema");
        assert_eq!(first.parameters.len(), second.parameters.len());
    }
}
