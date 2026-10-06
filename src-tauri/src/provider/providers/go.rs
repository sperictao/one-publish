use crate::provider::registry::{read_parameter_string, BuiltInProvider, BuiltInProviderKind};
use crate::provider::{
    ProviderCapabilities, ProviderCatalogEntry, ProviderDefaultOutput, ProviderManifest,
    ProviderProjectFileMatcher, ProviderProjectPathKind, ProviderRepositoryDiscovery,
    ProviderRepositoryMarker,
};
use crate::spec::PublishSpec;
use std::path::Path;

const GO_OUTPUT_PARAMETER: &str = "output";
const GO_OS_PARAMETER: &str = "target";
const GO_ARCH_PARAMETER: &str = "arch";

impl BuiltInProvider {
    pub(crate) fn go() -> Self {
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
                    appends_project_path: false,
                    output_layout: None,
                    project_profiles: None,
                    framework_tags: Vec::new(),
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
                supports_project_profiles: false,
                templates: Vec::new(),
            },
            ProviderRepositoryDiscovery {
                provider_id: "go".to_string(),
                repository_markers: vec![ProviderRepositoryMarker::FileName("go.mod".to_string())],
                project_file_matchers: vec![ProviderProjectFileMatcher::FileName(
                    "go.mod".to_string(),
                )],
                solution_file_extensions: Vec::new(),
                owns_project_recommendation: false,
},
            include_str!("../schemas/go.json"),
            "go.build",
            "go build",
        )
    }
}

/// 供 `providers::all()` 调用的统一入口。
pub(crate) fn create() -> BuiltInProvider {
    BuiltInProvider::go()
}

/// Go 缺省输出（`-o` 写的是文件路径，不是目录）：
/// `<默认发布目录>/<名称>/<名称>[-<GOOS>][-<GOARCH>][.exe]`；未设置默认发布目录时
/// 写到模块目录的 `dist/`（源输入分类已把 `dist` 视为生成目录）。
pub(crate) fn default_output(
    spec: &PublishSpec,
    module_dir: &Path,
    default_output_dir: &str,
) -> Option<ProviderDefaultOutput> {
    let parameter = |key: &str| {
        read_parameter_string(&spec.parameters, key)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    };
    let goos = parameter(GO_OS_PARAMETER);
    let name = module_binary_name(module_dir)?;
    let mut file_name = [
        Some(name.clone()),
        goos.clone(),
        parameter(GO_ARCH_PARAMETER),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join("-");
    if goos.map_or(cfg!(windows), |os| os.eq_ignore_ascii_case("windows")) {
        file_name.push_str(".exe");
    }
    let directory = if default_output_dir.is_empty() {
        module_dir.join("dist")
    } else {
        Path::new(default_output_dir).join(&name)
    };
    Some(ProviderDefaultOutput {
        parameter: GO_OUTPUT_PARAMETER.to_string(),
        path: directory.join(file_name),
    })
}

/// 与 `go build` 的缺省命名一致：模块路径的最后一个非主版本段
/// （`example.com/app/v2` → `app`）；go.mod 不可读时退回模块目录名。
fn module_binary_name(module_dir: &Path) -> Option<String> {
    let declared = std::fs::read_to_string(module_dir.join("go.mod"))
        .ok()
        .and_then(|go_mod| {
            let module_path = go_mod.lines().find_map(module_directive_path)?;
            let mut segments = module_path.rsplit('/');
            let last = segments.next()?;
            let name = if is_major_version_suffix(last) {
                segments.next().unwrap_or(last)
            } else {
                last
            };
            Some(name.to_string())
        });
    declared
        .or_else(|| {
            module_dir
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
        })
        .filter(|name| !name.is_empty() && name != "." && name != "..")
}

fn module_directive_path(line: &str) -> Option<&str> {
    let rest = line.trim().strip_prefix("module")?;
    if !rest.starts_with(char::is_whitespace) {
        return None;
    }
    let path = rest.split("//").next()?.trim().trim_matches('"');
    (!path.is_empty() && path != "(").then_some(path)
}

/// `vN`（N ≥ 2，无前导零）是模块主版本后缀，不参与可执行文件命名。
fn is_major_version_suffix(segment: &str) -> bool {
    segment.strip_prefix('v').is_some_and(|digits| {
        !digits.is_empty()
            && digits.bytes().all(|byte| byte.is_ascii_digit())
            && !digits.starts_with('0')
            && digits != "1"
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spec::{SpecValue, SPEC_VERSION};
    use std::collections::BTreeMap;
    use std::path::PathBuf;

    fn go_spec(module_dir: &Path, parameters: &[(&str, &str)]) -> PublishSpec {
        PublishSpec {
            version: SPEC_VERSION,
            provider_id: "go".to_string(),
            project_path: module_dir.to_string_lossy().to_string(),
            parameters: parameters
                .iter()
                .map(|(key, value)| (key.to_string(), SpecValue::String(value.to_string())))
                .collect::<BTreeMap<_, _>>(),
        }
    }

    fn output_path(module_dir: &Path, parameters: &[(&str, &str)], default_dir: &str) -> PathBuf {
        let output = default_output(&go_spec(module_dir, parameters), module_dir, default_dir)
            .expect("go derives a default output");
        assert_eq!(output.parameter, "output");
        output.path
    }

    #[test]
    fn default_output_is_a_file_named_after_the_module() {
        let module = tempfile::tempdir().expect("create module");
        std::fs::write(
            module.path().join("go.mod"),
            "// demo\nmodule \"example.com/tools/app/v2\" // comment\n\ngo 1.22\n",
        )
        .expect("write go.mod");
        let host_suffix = if cfg!(windows) { ".exe" } else { "" };

        // 未设置默认发布目录：模块目录的 dist/。
        assert_eq!(
            output_path(module.path(), &[], ""),
            module.path().join("dist").join(format!("app{host_suffix}"))
        );
        // 默认发布目录按项目名分组；目标平台进入文件名，Windows 目标带 .exe。
        assert_eq!(
            output_path(
                module.path(),
                &[("target", "windows"), ("arch", " amd64 ")],
                "/publish"
            ),
            Path::new("/publish")
                .join("app")
                .join("app-windows-amd64.exe")
        );
        assert_eq!(
            output_path(module.path(), &[("target", "linux")], "/publish"),
            Path::new("/publish").join("app").join("app-linux")
        );
        assert_eq!(
            output_path(module.path(), &[("arch", "arm64")], "/publish"),
            Path::new("/publish")
                .join("app")
                .join(format!("app-arm64{host_suffix}"))
        );
    }

    #[test]
    fn module_name_follows_go_build_naming_with_directory_fallback() {
        let module = tempfile::tempdir().expect("create module");
        let module_dir = module.path().join("svc");
        std::fs::create_dir_all(&module_dir).expect("create module dir");

        // go.mod 缺失：退回目录名。
        assert_eq!(module_binary_name(&module_dir).as_deref(), Some("svc"));

        for (module_path, expected) in [
            ("example.com/app", "app"),
            ("example.com/app/v2", "app"),
            ("example.com/app/v1", "v1"),
            ("example.com/app/v02", "v02"),
            ("app", "app"),
            ("v2", "v2"),
        ] {
            std::fs::write(module_dir.join("go.mod"), format!("module {module_path}\n"))
                .expect("write go.mod");
            assert_eq!(
                module_binary_name(&module_dir).as_deref(),
                Some(expected),
                "{module_path}"
            );
        }
    }
}
