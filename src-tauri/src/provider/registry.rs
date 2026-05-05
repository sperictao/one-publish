use super::{
    Provider, ProviderCapabilities, ProviderCatalogEntry, ProviderManifest,
    ProviderProjectFileMatcher, ProviderProjectPathKind, ProviderRepositoryDiscovery,
    ProviderRepositoryMarker,
};
use crate::compiler::CompileError;
use crate::parameter::{parse_schema_json, ParameterSchema, RenderError};
use crate::plan::{ExecutionPlan, PlanStep, PLAN_VERSION};
use crate::spec::{PublishSpec, SpecValue, SPEC_VERSION};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

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
            providers: vec![
                BuiltInProvider::dotnet(),
                BuiltInProvider::cargo(),
                BuiltInProvider::go(),
                BuiltInProvider::java_gradle(),
            ],
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
enum BuiltInProviderKind {
    Dotnet,
    Cargo,
    Go,
    JavaGradle,
}

const DOTNET_PROJECT_EXTENSIONS: &[&str] = &["csproj", "fsproj", "vbproj"];
const DOTNET_SOLUTION_EXTENSION: &str = "sln";
const DOTNET_NESTED_PROJECT_DIRECTORIES: &[&str] = &["src", "UI"];
const GRADLE_PROJECT_FILES: &[&str] = &[
    "build.gradle",
    "build.gradle.kts",
    "settings.gradle",
    "settings.gradle.kts",
    "gradlew",
    "gradlew.bat",
];

struct BuiltInProvider {
    kind: BuiltInProviderKind,
    manifest: ProviderManifest,
    capabilities: ProviderCapabilities,
    catalog: ProviderCatalogEntry,
    repository_discovery: ProviderRepositoryDiscovery,
    schema_json: &'static str,
    schema_cache: OnceLock<Result<ParameterSchema, RenderError>>,
    compile_step_id: &'static str,
    compile_title: &'static str,
}

impl BuiltInProvider {
    fn dotnet() -> Self {
        Self::new(
            BuiltInProviderKind::Dotnet,
            ProviderManifest {
                id: "dotnet".to_string(),
                display_name: "dotnet".to_string(),
                version: "1".to_string(),
            },
            ProviderCapabilities {
                requires_project_binding: true,
                project_path_kind: ProviderProjectPathKind::ProjectFile,
                supports_command_import: true,
            },
            ProviderCatalogEntry {
                id: "dotnet".to_string(),
                display_name: "dotnet".to_string(),
                version: "1".to_string(),
                label: ".NET (dotnet)".to_string(),
                command_example:
                    "dotnet publish MyProject.csproj -c Release -r win-x64 --self-contained"
                        .to_string(),
                environment_label: ".NET".to_string(),
                environment_description: "dotnet SDK".to_string(),
                requires_project_binding: true,
                project_path_kind: ProviderProjectPathKind::ProjectFile,
                supports_command_import: true,
            },
            ProviderRepositoryDiscovery {
                provider_id: "dotnet".to_string(),
                repository_markers: dotnet_repository_markers(),
                project_file_matchers: dotnet_project_file_matchers(),
            },
            include_str!("schemas/dotnet.json"),
            "dotnet.publish",
            "dotnet publish",
        )
    }

    fn cargo() -> Self {
        Self::new(
            BuiltInProviderKind::Cargo,
            ProviderManifest {
                id: "cargo".to_string(),
                display_name: "cargo".to_string(),
                version: "1".to_string(),
            },
            ProviderCapabilities {
                requires_project_binding: false,
                project_path_kind: ProviderProjectPathKind::RepositoryRoot,
                supports_command_import: true,
            },
            ProviderCatalogEntry {
                id: "cargo".to_string(),
                display_name: "cargo".to_string(),
                version: "1".to_string(),
                label: "Rust (cargo)".to_string(),
                command_example: "cargo build --release --target x86_64-unknown-linux-gnu"
                    .to_string(),
                environment_label: "Rust".to_string(),
                environment_description: "cargo".to_string(),
                requires_project_binding: false,
                project_path_kind: ProviderProjectPathKind::RepositoryRoot,
                supports_command_import: true,
            },
            ProviderRepositoryDiscovery {
                provider_id: "cargo".to_string(),
                repository_markers: vec![ProviderRepositoryMarker::FileName(
                    "Cargo.toml".to_string(),
                )],
                project_file_matchers: vec![ProviderProjectFileMatcher::FileName(
                    "Cargo.toml".to_string(),
                )],
            },
            include_str!("schemas/cargo.json"),
            "cargo.build",
            "cargo build",
        )
    }

    fn go() -> Self {
        Self::new(
            BuiltInProviderKind::Go,
            ProviderManifest {
                id: "go".to_string(),
                display_name: "go".to_string(),
                version: "1".to_string(),
            },
            ProviderCapabilities {
                requires_project_binding: false,
                project_path_kind: ProviderProjectPathKind::RepositoryRoot,
                supports_command_import: true,
            },
            ProviderCatalogEntry {
                id: "go".to_string(),
                display_name: "go".to_string(),
                version: "1".to_string(),
                label: "Go".to_string(),
                command_example: "go build -o ./bin/app ./cmd/app".to_string(),
                environment_label: "Go".to_string(),
                environment_description: "go".to_string(),
                requires_project_binding: false,
                project_path_kind: ProviderProjectPathKind::RepositoryRoot,
                supports_command_import: true,
            },
            ProviderRepositoryDiscovery {
                provider_id: "go".to_string(),
                repository_markers: vec![ProviderRepositoryMarker::FileName("go.mod".to_string())],
                project_file_matchers: vec![ProviderProjectFileMatcher::FileName(
                    "go.mod".to_string(),
                )],
            },
            include_str!("schemas/go.json"),
            "go.build",
            "go build",
        )
    }

    fn java_gradle() -> Self {
        Self::new(
            BuiltInProviderKind::JavaGradle,
            ProviderManifest {
                id: "java".to_string(),
                display_name: "java".to_string(),
                version: "1".to_string(),
            },
            ProviderCapabilities {
                requires_project_binding: false,
                project_path_kind: ProviderProjectPathKind::RepositoryRoot,
                supports_command_import: true,
            },
            ProviderCatalogEntry {
                id: "java".to_string(),
                display_name: "java".to_string(),
                version: "1".to_string(),
                label: "Java (Gradle)".to_string(),
                command_example: "./gradlew build --info".to_string(),
                environment_label: "Java (Gradle)".to_string(),
                environment_description: "gradle / java runtime".to_string(),
                requires_project_binding: false,
                project_path_kind: ProviderProjectPathKind::RepositoryRoot,
                supports_command_import: true,
            },
            ProviderRepositoryDiscovery {
                provider_id: "java".to_string(),
                repository_markers: gradle_project_file_matchers()
                    .into_iter()
                    .map(|matcher| match matcher {
                        ProviderProjectFileMatcher::FileName(name) => {
                            ProviderRepositoryMarker::FileName(name)
                        }
                        ProviderProjectFileMatcher::Extension(extension) => {
                            ProviderRepositoryMarker::Extension(extension)
                        }
                    })
                    .collect(),
                project_file_matchers: gradle_project_file_matchers(),
            },
            include_str!("schemas/java.json"),
            "gradle.build",
            "./gradlew build",
        )
    }

    fn new(
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

    fn resolve_working_dir(&self, spec: &PublishSpec) -> Option<PathBuf> {
        let path = PathBuf::from(&spec.project_path);
        match self.kind {
            BuiltInProviderKind::Dotnet => path.parent().map(Path::to_path_buf),
            BuiltInProviderKind::Cargo => resolve_provider_project_dir(path, &["Cargo.toml"]),
            BuiltInProviderKind::Go => resolve_provider_project_dir(path, &["go.mod"]),
            BuiltInProviderKind::JavaGradle => {
                resolve_provider_project_dir(path, GRADLE_PROJECT_FILES)
            }
        }
    }

    fn infer_output_dir(&self, spec: &PublishSpec) -> String {
        match self.kind {
            BuiltInProviderKind::Dotnet => {
                if let Some(output) = read_parameter_string(&spec.parameters, "output") {
                    return resolve_output_path(output, self.resolve_working_dir(spec));
                }

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
                if let Some(target_dir) = read_parameter_string(&spec.parameters, "target_dir") {
                    return resolve_output_path(target_dir, self.resolve_working_dir(spec));
                }

                if let Some(project_dir) = self.resolve_working_dir(spec) {
                    let profile = if read_parameter_bool(&spec.parameters, "release") {
                        "release"
                    } else {
                        "debug"
                    };
                    return project_dir
                        .join("target")
                        .join(profile)
                        .to_string_lossy()
                        .to_string();
                }

                String::new()
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
            BuiltInProviderKind::Dotnet => read_parameter_string(&spec.parameters, "output"),
            BuiltInProviderKind::Cargo => read_parameter_string(&spec.parameters, "target_dir"),
            BuiltInProviderKind::Go => read_parameter_string(&spec.parameters, "output"),
            BuiltInProviderKind::JavaGradle => None,
        }
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

fn gradle_project_file_matchers() -> Vec<ProviderProjectFileMatcher> {
    GRADLE_PROJECT_FILES
        .iter()
        .map(|name| ProviderProjectFileMatcher::FileName((*name).to_string()))
        .collect()
}

fn dotnet_project_file_matchers() -> Vec<ProviderProjectFileMatcher> {
    DOTNET_PROJECT_EXTENSIONS
        .iter()
        .copied()
        .chain(std::iter::once(DOTNET_SOLUTION_EXTENSION))
        .map(|extension| ProviderProjectFileMatcher::Extension(extension.to_string()))
        .collect()
}

fn dotnet_repository_markers() -> Vec<ProviderRepositoryMarker> {
    let mut markers = vec![ProviderRepositoryMarker::Extension(
        DOTNET_SOLUTION_EXTENSION.to_string(),
    )];

    for extension in DOTNET_PROJECT_EXTENSIONS {
        markers.push(ProviderRepositoryMarker::Extension(
            (*extension).to_string(),
        ));
        for directory in DOTNET_NESTED_PROJECT_DIRECTORIES {
            markers.push(ProviderRepositoryMarker::NestedExtension {
                directory: (*directory).to_string(),
                extension: (*extension).to_string(),
            });
        }
    }

    markers
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

fn read_parameter_string(parameters: &BTreeMap<String, SpecValue>, key: &str) -> Option<String> {
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
