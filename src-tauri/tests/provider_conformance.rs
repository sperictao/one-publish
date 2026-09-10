//! Provider 能力真实性一致性套件（ADR-0053、ADR-0059）。
//!
//! 声明的能力必须与实际行为一致：目录与能力声明的项目配置语义、命令导入
//! 的 schema 推导映射，以及“通用执行链路零 Provider 身份字面量”的门禁。

use std::path::{Path, PathBuf};

use one_publish_lib::command_parser::CommandParser;
use one_publish_lib::parameter::ParameterType;
use one_publish_lib::provider::registry::provider_registry;

#[test]
fn catalog_and_capabilities_agree_on_project_profiles() {
    for provider in provider_registry().catalog_entries() {
        let capabilities = provider_registry()
            .get(&provider.id)
            .expect("catalog provider resolves")
            .capabilities()
            .clone();
        assert_eq!(
            provider.supports_project_profiles,
            capabilities.project_profiles.is_some(),
            "provider {} 的目录声明与能力声明不一致",
            provider.id
        );
    }
}

#[test]
fn project_profiles_declaration_requires_discovery_matchers() {
    for provider_id in provider_registry().known_ids() {
        let provider = provider_registry().get(&provider_id).expect("provider");
        let capabilities = provider.capabilities();
        let discovery = provider.repository_discovery();
        if capabilities.project_profiles.is_some() {
            assert!(
                !discovery.project_file_matchers.is_empty(),
                "provider {provider_id} 声明了项目配置语义但没有项目文件匹配器"
            );
        }
        if discovery.owns_project_recommendation {
            assert!(
                !discovery.solution_file_extensions.is_empty(),
                "provider {provider_id} 声明了推荐引擎但没有 solution 语义"
            );
        }
    }
}

#[test]
fn output_layout_declaration_targets_a_string_schema_parameter() {
    for provider_id in provider_registry().known_ids() {
        let provider = provider_registry().get(&provider_id).expect("provider");
        let Some(output) = provider.capabilities().output_layout.as_ref() else {
            continue;
        };
        assert!(
            !output.parameter.trim().is_empty(),
            "provider {provider_id} 的输出声明缺少目标参数"
        );
        assert!(
            !output.template.trim().is_empty(),
            "provider {provider_id} 的输出声明缺少布局模板"
        );
        let schema = provider.get_schema().expect("schema");
        let definition = schema.parameters.get(&output.parameter).unwrap_or_else(|| {
            panic!(
                "provider {provider_id} 的输出参数 {} 不存在于 schema",
                output.parameter
            )
        });
        assert!(
            matches!(&definition.param_type, ParameterType::String),
            "provider {provider_id} 的输出参数 {} 必须是 string",
            output.parameter
        );
    }
}

#[test]
fn command_import_covers_every_declared_flag_alias_and_positional() {
    for provider_id in provider_registry().known_ids() {
        let provider = provider_registry().get(&provider_id).expect("provider");
        if !provider.capabilities().supports_command_import {
            continue;
        }
        let schema = provider.get_schema().expect("schema");
        for (key, definition) in &schema.parameters {
            // Renderer 的现有合同把 string + 空 flag + 无 prefix/env 渲染成裸位置参数；
            // Command Import 必须按同一声明恢复该参数，而不是因为 flag 为空就跳过。
            if matches!(&definition.param_type, ParameterType::String)
                && definition.flag.is_empty()
                && definition.prefix.is_none()
                && definition.env.is_none()
            {
                let result =
                    CommandParser::new(provider_id.clone()).parse("prog positional-value", &schema);
                assert!(
                    result.diagnostics.is_empty(),
                    "provider {provider_id} 的 positional 参数 {key} 无法被命令导入识别: {:?}",
                    result.diagnostics
                );
                assert_eq!(
                    result.parameters.get(key.as_str()),
                    Some(&serde_json::json!("positional-value")),
                    "provider {provider_id} 的 positional 参数 {key} 未按 schema 落入结果"
                );
            }

            let mut flags = Vec::new();
            if !definition.flag.is_empty() {
                flags.push(definition.flag.clone());
            }
            for alias in definition.aliases.iter().flatten() {
                flags.push(alias.clone());
            }

            for flag in flags {
                let command = match definition.param_type {
                    // 布尔与字符串 flag 各按其取值形态构造；map 走 prefix 通道。
                    ParameterType::Boolean => format!("prog {flag}"),
                    ParameterType::String | ParameterType::Array => format!("prog {flag} v"),
                    ParameterType::Map => continue,
                };
                let result = CommandParser::new(provider_id.clone()).parse(&command, &schema);
                assert!(
                    !result
                        .diagnostics
                        .iter()
                        .any(|d| d.code == "command_import_unknown_flag"),
                    "provider {provider_id} 的 schema flag {flag}（参数 {key}）无法被命令导入识别: {:?}",
                    result.diagnostics
                );
                assert!(
                    result.parameters.contains_key(key.as_str()),
                    "provider {provider_id} 的 flag {flag} 未落入参数 {key}"
                );
            }
        }
    }
}

/// 行为扩展钉子（schema 推导导入的直接结果）：手写映射时代不认识的
/// schema flag（如 go 的 -ldflags、cargo 的 --target-dir/-v）现在可以
/// 正确导入。若未来有意收回该行为，必须先改这里。
#[test]
fn command_import_recovers_flags_outside_legacy_hand_maps() {
    let provider = provider_registry().get("go").expect("go provider");
    let schema = provider.get_schema().expect("go schema");
    let result =
        CommandParser::new("go".to_string()).parse("go build -ldflags=-s", &schema);
    assert!(result.diagnostics.is_empty(), "{:?}", result.diagnostics);
    assert_eq!(
        result.parameters.get("ldflags"),
        Some(&serde_json::json!("-s"))
    );

    let provider = provider_registry().get("cargo").expect("cargo provider");
    let schema = provider.get_schema().expect("cargo schema");
    let result = CommandParser::new("cargo".to_string())
        .parse("cargo build -v --target-dir ./target", &schema);
    assert!(result.diagnostics.is_empty(), "{:?}", result.diagnostics);
    assert_eq!(result.parameters.get("verbose"), Some(&serde_json::json!(true)));
    assert_eq!(
        result.parameters.get("target_dir"),
        Some(&serde_json::json!("./target"))
    );

    let provider = provider_registry().get("dotnet").expect("dotnet provider");
    let schema = provider.get_schema().expect("dotnet schema");
    let result =
        CommandParser::new("dotnet".to_string()).parse("dotnet publish -nologo", &schema);
    assert!(result.diagnostics.is_empty(), "{:?}", result.diagnostics);
    assert_eq!(result.parameters.get("no_logo"), Some(&serde_json::json!(true)));
}

/// 回归钉子（ADR-0059 项目配置宿主语义）：解决方案文件（.sln）不承载
/// 项目发布配置。声明数据必须支撑该推导：sln 在 solution 扩展名声明中，
/// 项目配置目录宿主判定据此排除 solution（行为级测试见
/// commands/repository/project.rs）。
#[test]
fn solution_files_are_not_project_profile_hosts() {
    let dotnet = provider_registry().get("dotnet").expect("dotnet provider");
    let discovery = dotnet.repository_discovery();
    assert!(dotnet.capabilities().project_profiles.is_some());

    let sln_hit_as_solution = discovery
        .solution_file_extensions
        .iter()
        .any(|extension| Path::new("/repo/App.sln").extension().is_some_and(|ext| ext.eq_ignore_ascii_case(extension.as_str())));
    assert!(sln_hit_as_solution, "sln 必须被声明为 solution 扩展名");
}

/// 通用执行链路的身份字面量门禁：剥离 `#[cfg(test)]` 模块与整文件测试
/// 模块后，`"dotnet"` 只允许出现在 Provider 知识的自有模块、探测数据表
/// 与 legacy 迁移中（ADR-0059）。
#[test]
fn no_provider_identity_literals_outside_declared_homes() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let src_dir = manifest_dir.join("src");
    let allowed_files = [
        "provider/providers/dotnet.rs",
        "environment/dotnet_provider.rs",
        // 以下为 ADR-0059 认可的声明式数据表 / 策略分发 / 引擎内部实现：
        "environment/mod.rs",
        "environment/types.rs",
        "store/migration.rs",
        "store/legacy_dotnet.rs",
        "commands/repository/project.rs",
    ];

    let mut offenders = Vec::new();
    collect_rs_files(&src_dir, &mut |path| {
        let relative = path
            .strip_prefix(&src_dir)
            .expect("file under src")
            .to_string_lossy()
            .replace('\\', "/");
        if allowed_files.contains(&relative.as_str()) || relative.ends_with("tests.rs") {
            return;
        }
        let Ok(content) = std::fs::read_to_string(path) else {
            return;
        };
        if has_outside_test_module_literal(&content) {
            offenders.push(relative);
        }
    });

    assert!(
        offenders.is_empty(),
        "以下文件的测试代码之外出现 \"dotnet\" 身份字面量，请改为能力声明: {offenders:?}"
    );
}

fn has_outside_test_module_literal(content: &str) -> bool {
    let mut depth = 0usize;
    let mut test_block_depth: Option<usize> = None;
    for line in content.lines() {
        let opens = line.matches('{').count();
        let closes = line.matches('}').count();

        match test_block_depth {
            None => {
                if line.trim_start().starts_with("#[cfg(test)]") {
                    test_block_depth = Some(depth);
                    continue;
                }
                if line.contains("\"dotnet\"") {
                    return true;
                }
                depth = depth + opens - closes.min(depth + opens);
            }
            Some(start) => {
                depth = depth + opens - closes.min(depth + opens);
                if depth <= start {
                    test_block_depth = None;
                }
            }
        }
    }
    false
}

fn collect_rs_files(dir: &Path, visitor: &mut impl FnMut(&Path)) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_rs_files(&path, visitor);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            visitor(&path);
        }
    }
}
