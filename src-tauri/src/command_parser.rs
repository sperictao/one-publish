use crate::parameter::{ParameterSchema, ParameterType};
use crate::spec::SpecValue;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

/// 无法归属到 schema 的 token/flag 诊断（code + message）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct CommandImportDiagnostic {
    pub code: String,
    pub message: String,
}

/// 命令导入结果：schema 解析出的草稿参数 + 诊断。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct CommandImportResult {
    pub provider_id: String,
    /// schema 解析出的完整参数（键为 schema 参数键，值保真）。
    pub parameters: BTreeMap<String, serde_json::Value>,
    /// 无法归属到 schema 的 token/flag 诊断（code + message）。
    pub diagnostics: Vec<CommandImportDiagnostic>,
}

/// Command parser for extracting parameters from CLI commands
pub struct CommandParser {
    pub provider_id: String,
}

impl CommandParser {
    pub fn new(provider_id: String) -> Self {
        Self { provider_id }
    }

    /// Parse a command string into draft parameters and diagnostics.
    pub fn parse(&self, command: &str, schema: &ParameterSchema) -> CommandImportResult {
        let tokens = tokenize(command);
        let (parameters, diagnostics) = self.parse_tokens(&tokens, schema);

        CommandImportResult {
            provider_id: self.provider_id.clone(),
            parameters,
            diagnostics,
        }
    }

    /// Parse tokens into parameters based on provider type
    fn parse_tokens(
        &self,
        tokens: &[String],
        schema: &ParameterSchema,
    ) -> (
        BTreeMap<String, serde_json::Value>,
        Vec<CommandImportDiagnostic>,
    ) {
        let mut parameters = BTreeMap::<String, SpecValue>::new();
        let mut diagnostics = Vec::new();
        let mut i = 0;
        let mut seen_flag = false;

        // Renderer 已将 `flag="" + no prefix/env` 的 string 参数定义为裸 positional。
        // Command Import 使用同一 schema 语义：当前合同仅允许唯一一个 positional string，
        // 并把首个 flag 之前最后一个裸 token 视为该参数；更早的 token 保留为程序名/子命令。
        let positional_param = positional_string_parameter(schema);
        let positional_token_index = positional_param.as_ref().and_then(|_| {
            let first_flag = tokens
                .iter()
                .position(|token| token.starts_with('-'))
                .unwrap_or(tokens.len());
            (first_flag >= 2).then_some(first_flag - 1)
        });

        while i < tokens.len() {
            let token = &tokens[i];

            if let Some((param_key, map_key, map_value)) = parse_prefixed_map_token(token, schema) {
                insert_map_entry(&mut parameters, param_key, map_key, map_value);
                i += 1;
                continue;
            }

            if let Some((param_key, value)) = parse_prefixed_string_token(token, schema) {
                parameters.insert(param_key, SpecValue::String(value));
                i += 1;
                continue;
            }

            if !token.starts_with('-') {
                if positional_token_index == Some(i) {
                    if let Some(param_key) = positional_param.as_ref() {
                        parameters.insert(param_key.clone(), SpecValue::String(token.clone()));
                        i += 1;
                        continue;
                    }
                }

                // 首个 flag 之前除声明 positional 外的裸 token 是程序名/子命令；
                // 其后出现且未被 flag 消费的裸 token 无法归属到 schema 参数。
                if seen_flag {
                    diagnostics.push(CommandImportDiagnostic {
                        code: "command_import_unparsed_token".to_string(),
                        message: format!("unrecognized token: {token}"),
                    });
                }
                i += 1;
                continue;
            }

            seen_flag = true;
            let (flag_name, value) = if token.contains('=') {
                // Flag=value format
                let parts: Vec<&str> = token.splitn(2, '=').collect();
                (parts[0].to_string(), Some(parts[1].to_string()))
            } else if i + 1 < tokens.len() && !tokens[i + 1].starts_with('-') {
                // Flag value format (next token is value)
                (token.clone(), Some(tokens[i + 1].clone()))
            } else {
                // Boolean flag format
                (token.clone(), None)
            };
            let consumed_value = value.is_some() && !token.contains('=');

            let mut applied = false;
            let mut value_unattachable = false;
            if let Some(param_key) = Self::map_flag_to_param(&flag_name, schema) {
                if let Some(def) = schema.parameters.get(&param_key) {
                    match (&def.param_type, value.clone()) {
                        (ParameterType::Boolean, None) => {
                            parameters.insert(param_key, SpecValue::Bool(true));
                            applied = true;
                        }
                        (ParameterType::Boolean, Some(v)) => {
                            if v.eq_ignore_ascii_case("true") {
                                parameters.insert(param_key, SpecValue::Bool(true));
                                applied = true;
                            } else if v.eq_ignore_ascii_case("false") {
                                parameters.insert(param_key, SpecValue::Bool(false));
                                applied = true;
                            } else {
                                value_unattachable = true;
                            }
                        }
                        (ParameterType::String, Some(v)) => {
                            parameters.insert(param_key, SpecValue::String(v));
                            applied = true;
                        }
                        (ParameterType::String, None) => {
                            parameters.insert(param_key, SpecValue::String(String::new()));
                            applied = true;
                        }
                        (ParameterType::Array, Some(v)) => {
                            // Parse comma-separated values
                            let values: Vec<SpecValue> = v
                                .split(',')
                                .map(|item| SpecValue::String(item.trim().to_string()))
                                .collect();
                            parameters.insert(param_key, SpecValue::List(values));
                            applied = true;
                        }
                        (ParameterType::Map, Some(v)) => {
                            if let Some((entry_key, entry_value)) = parse_map_assignment(&v) {
                                insert_map_entry(
                                    &mut parameters,
                                    param_key,
                                    entry_key,
                                    entry_value,
                                );
                                applied = true;
                            } else {
                                value_unattachable = true;
                            }
                        }
                        _ => {
                            value_unattachable = true;
                        }
                    }
                }
            }

            if !applied {
                let message = match &value {
                    Some(v) => format!("unrecognized flag: {flag_name} (value: {v})"),
                    None => format!("unrecognized flag: {flag_name}"),
                };
                diagnostics.push(CommandImportDiagnostic {
                    code: if value_unattachable {
                        "command_import_unparsed_token".to_string()
                    } else {
                        "command_import_unknown_flag".to_string()
                    },
                    message,
                });
            }

            // Skip value token if we consumed it
            if consumed_value {
                i += 2;
            } else {
                i += 1;
            }
        }

        let parameters = parameters
            .into_iter()
            .map(|(key, value)| {
                (
                    key,
                    serde_json::to_value(&value).expect("SpecValue is JSON-serializable"),
                )
            })
            .collect();

        (parameters, diagnostics)
    }

    /// 从 schema 推导 CLI flag → 参数键的映射：schema 是命令导入的唯一事实源，
    /// 主 flag 与声明别名同样可识别。
    fn map_flag_to_param(flag: &str, schema: &ParameterSchema) -> Option<String> {
        schema
            .parameters
            .iter()
            .find(|(_, def)| {
                def.flag == flag
                    || def
                        .aliases
                        .as_ref()
                        .is_some_and(|aliases| aliases.iter().any(|alias| alias == flag))
            })
            .map(|(key, _)| key.clone())
    }
}

/// 当前 schema 的裸 positional 合同：string + 空 flag + 无 prefix/env。
/// 多个 positional 缺少稳定顺序声明，因此拒绝猜测；若未来需要多个位置参数，
/// 应先扩展 schema 的显式位置合同，而不是依赖 BTreeMap 键顺序。
fn positional_string_parameter(schema: &ParameterSchema) -> Option<String> {
    let mut candidates = schema.parameters.iter().filter(|(_, def)| {
        matches!(def.param_type, ParameterType::String)
            && def.flag.is_empty()
            && def.prefix.is_none()
            && def.env.is_none()
    });
    let (key, _) = candidates.next()?;
    if candidates.next().is_some() {
        return None;
    }
    Some(key.clone())
}

fn parse_prefixed_map_token(
    token: &str,
    schema: &ParameterSchema,
) -> Option<(String, String, String)> {
    for (param_key, def) in &schema.parameters {
        if !matches!(def.param_type, ParameterType::Map) {
            continue;
        }

        let Some(prefix) = &def.prefix else {
            continue;
        };

        if !token.starts_with(prefix) || token.len() <= prefix.len() {
            continue;
        }

        let assignment = &token[prefix.len()..];
        if let Some((entry_key, entry_value)) = parse_map_assignment(assignment) {
            return Some((param_key.clone(), entry_key, entry_value));
        }
    }

    None
}

fn parse_prefixed_string_token(token: &str, schema: &ParameterSchema) -> Option<(String, String)> {
    for (param_key, def) in &schema.parameters {
        if !matches!(def.param_type, ParameterType::String) {
            continue;
        }

        if !def.flag.is_empty() {
            continue;
        }

        let Some(prefix) = &def.prefix else {
            continue;
        };

        if !token.starts_with(prefix) || token.len() <= prefix.len() {
            continue;
        }

        return Some((param_key.clone(), token[prefix.len()..].to_string()));
    }

    None
}

fn parse_map_assignment(raw: &str) -> Option<(String, String)> {
    let (key, value) = raw.split_once('=')?;
    if key.is_empty() {
        return None;
    }

    Some((key.to_string(), value.to_string()))
}

fn insert_map_entry(
    parameters: &mut BTreeMap<String, SpecValue>,
    param_key: String,
    entry_key: String,
    entry_value: String,
) {
    if let Some(SpecValue::Map(existing)) = parameters.get_mut(&param_key) {
        existing.insert(entry_key, SpecValue::String(entry_value));
        return;
    }

    let mut map = BTreeMap::new();
    map.insert(entry_key, SpecValue::String(entry_value));
    parameters.insert(param_key, SpecValue::Map(map));
}

/// Tokenize command string into words (handling quotes)
fn tokenize(command: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let chars = command.chars().peekable();

    for c in chars {
        match c {
            '"' => {
                in_quotes = !in_quotes;
            }
            ' ' | '\t' if !in_quotes => {
                if !current.is_empty() {
                    tokens.push(current.clone());
                    current.clear();
                }
            }
            _ => {
                current.push(c);
            }
        }
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    tokens
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parameter::{ParameterDefinition, ParameterType};

    #[test]
    fn tokenize_simple_command() {
        let command = "dotnet publish -c Release -r win-x64";
        let tokens = tokenize(command);
        assert_eq!(
            tokens,
            vec![
                "dotnet".to_string(),
                "publish".to_string(),
                "-c".to_string(),
                "Release".to_string(),
                "-r".to_string(),
                "win-x64".to_string(),
            ]
        );
    }

    #[test]
    fn tokenize_command_with_quotes() {
        let command = "cargo build --features \"feature1,feature2\"";
        let tokens = tokenize(command);
        assert_eq!(
            tokens,
            vec![
                "cargo".to_string(),
                "build".to_string(),
                "--features".to_string(),
                "feature1,feature2".to_string(),
            ]
        );
    }

    #[test]
    fn tokenize_flag_with_equals() {
        let command = "./gradlew build -Dversion=1.2.3";
        let tokens = tokenize(command);
        assert_eq!(
            tokens,
            vec![
                "./gradlew".to_string(),
                "build".to_string(),
                "-Dversion=1.2.3".to_string(),
            ]
        );
    }

    #[test]
    fn schema_alias_flag_maps_to_parameter() {
        let mut parameters = BTreeMap::new();
        parameters.insert(
            "configuration".to_string(),
            ParameterDefinition {
                param_type: ParameterType::String,
                flag: "--configuration".to_string(),
                aliases: Some(vec!["-c".to_string()]),
                default: None,
                multiple: None,
                prefix: None,
                description: None,
                env: None,
            },
        );
        let schema = ParameterSchema { parameters };

        assert_eq!(
            CommandParser::map_flag_to_param("-c", &schema),
            Some("configuration".to_string())
        );
        assert_eq!(
            CommandParser::map_flag_to_param("--configuration", &schema),
            Some("configuration".to_string())
        );
        assert_eq!(CommandParser::map_flag_to_param("--other", &schema), None);
    }

    #[test]
    fn parse_dotnet_command() {
        let parser = CommandParser::new("dotnet".to_string());
        let command = "dotnet publish -c Release -r win-x64 --self-contained";
        let schema = dotnet_schema();
        let result = parser.parse(command, &schema);

        assert_eq!(result.provider_id, "dotnet");
        assert!(result.diagnostics.is_empty());
        assert_eq!(
            result.parameters.get("configuration"),
            Some(&serde_json::json!("Release"))
        );
        assert_eq!(
            result.parameters.get("runtime"),
            Some(&serde_json::json!("win-x64"))
        );
        assert_eq!(
            result.parameters.get("self_contained"),
            Some(&serde_json::json!(true))
        );
    }

    #[test]
    fn parse_cargo_command() {
        let parser = CommandParser::new("cargo".to_string());
        let command = "cargo build --release --target x86_64-apple-darwin";
        let schema = cargo_schema();
        let result = parser.parse(command, &schema);

        assert_eq!(result.provider_id, "cargo");
        assert!(result.diagnostics.is_empty());
        assert_eq!(
            result.parameters.get("release"),
            Some(&serde_json::json!(true))
        );
        assert_eq!(
            result.parameters.get("target"),
            Some(&serde_json::json!("x86_64-apple-darwin"))
        );
    }

    #[test]
    fn parse_java_command_maps_positional_task_and_prefixed_properties() {
        let parser = CommandParser::new("java".to_string());
        let command = "./gradlew build -Dversion=1.2.3 -Dprofile=prod --offline";
        let schema = java_schema();
        let result = parser.parse(command, &schema);

        assert!(result.diagnostics.is_empty());
        assert_eq!(result.parameters.get("task"), Some(&serde_json::json!("build")));
        assert_eq!(
            result.parameters.get("properties"),
            Some(&serde_json::json!({
                "version": "1.2.3",
                "profile": "prod",
            }))
        );
        assert_eq!(
            result.parameters.get("offline"),
            Some(&serde_json::json!(true))
        );
    }

    #[test]
    fn parse_java_positional_task_without_flags() {
        let parser = CommandParser::new("java".to_string());
        let result = parser.parse("./gradlew test", &java_schema());

        assert!(result.diagnostics.is_empty());
        assert_eq!(result.parameters.get("task"), Some(&serde_json::json!("test")));
    }

    #[test]
    fn parse_go_command_maps_env_prefix_tokens() {
        let parser = CommandParser::new("go".to_string());
        let command = "GOOS=linux GOARCH=amd64 go build -o ./dist/app";
        let schema = go_schema();
        let result = parser.parse(command, &schema);

        assert!(result.diagnostics.is_empty());
        assert_eq!(
            result.parameters.get("target"),
            Some(&serde_json::json!("linux"))
        );
        assert_eq!(
            result.parameters.get("arch"),
            Some(&serde_json::json!("amd64"))
        );
        assert_eq!(
            result.parameters.get("output"),
            Some(&serde_json::json!("./dist/app"))
        );
    }

    #[test]
    fn parse_dotnet_publish_full_command_has_no_diagnostics() {
        let parser = CommandParser::new("dotnet".to_string());
        let command = "dotnet publish -c Debug -o /tmp/out -p:Version=1.2.3";
        let schema = dotnet_schema();
        let result = parser.parse(command, &schema);

        assert!(result.diagnostics.is_empty());
        assert_eq!(
            result.parameters.get("configuration"),
            Some(&serde_json::json!("Debug"))
        );
        assert_eq!(
            result.parameters.get("output"),
            Some(&serde_json::json!("/tmp/out"))
        );
        assert_eq!(
            result.parameters.get("properties"),
            Some(&serde_json::json!({ "Version": "1.2.3" }))
        );
    }

    #[test]
    fn parse_unknown_flag_reports_diagnostic() {
        let parser = CommandParser::new("dotnet".to_string());
        let command = "dotnet publish --not-a-flag x -c Debug";
        let schema = dotnet_schema();
        let result = parser.parse(command, &schema);

        assert_eq!(
            result.parameters.get("configuration"),
            Some(&serde_json::json!("Debug"))
        );
        assert_eq!(result.diagnostics.len(), 1);
        let diagnostic = &result.diagnostics[0];
        assert_eq!(diagnostic.code, "command_import_unknown_flag");
        assert!(diagnostic.message.contains("--not-a-flag"));
    }

    #[test]
    fn parse_boolean_flag_sets_true() {
        let parser = CommandParser::new("dotnet".to_string());
        let command = "dotnet publish -c Debug --no-build";
        let schema = dotnet_schema();
        let result = parser.parse(command, &schema);

        assert!(result.diagnostics.is_empty());
        assert_eq!(
            result.parameters.get("no_build"),
            Some(&serde_json::json!(true))
        );
    }

    #[test]
    fn parse_boolean_flag_preserves_explicit_values() {
        let parser = CommandParser::new("dotnet".to_string());
        let schema = dotnet_schema();

        for (command, expected) in [
            ("dotnet publish --self-contained=false", false),
            ("dotnet publish --self-contained false", false),
            ("dotnet publish --self-contained=true", true),
            ("dotnet publish --self-contained TRUE", true),
        ] {
            let result = parser.parse(command, &schema);
            assert!(result.diagnostics.is_empty(), "{command}: {:?}", result.diagnostics);
            assert_eq!(
                result.parameters.get("self_contained"),
                Some(&serde_json::json!(expected)),
                "{command}"
            );
        }
    }

    #[test]
    fn parse_boolean_flag_rejects_non_boolean_value() {
        let parser = CommandParser::new("dotnet".to_string());
        let schema = dotnet_schema();
        let result = parser.parse("dotnet publish --self-contained=maybe", &schema);

        assert!(!result.parameters.contains_key("self_contained"));
        assert_eq!(result.diagnostics.len(), 1);
        assert_eq!(result.diagnostics[0].code, "command_import_unparsed_token");
        assert!(result.diagnostics[0].message.contains("maybe"));
    }

    #[test]
    fn parse_unattachable_tokens_report_diagnostics() {
        let parser = CommandParser::new("dotnet".to_string());
        let command = "dotnet publish -c Debug stray-value";
        let schema = dotnet_schema();
        let result = parser.parse(command, &schema);

        assert_eq!(
            result.parameters.get("configuration"),
            Some(&serde_json::json!("Debug"))
        );
        assert_eq!(result.diagnostics.len(), 1);
        assert_eq!(result.diagnostics[0].code, "command_import_unparsed_token");
        assert!(result.diagnostics[0].message.contains("stray-value"));
    }

    fn dotnet_schema() -> ParameterSchema {
        let mut parameters = BTreeMap::new();
        parameters.insert(
            "configuration".to_string(),
            parameter(ParameterType::String, "-c", None),
        );
        parameters.insert(
            "runtime".to_string(),
            parameter(ParameterType::String, "-r", None),
        );
        parameters.insert(
            "output".to_string(),
            parameter(ParameterType::String, "-o", None),
        );
        parameters.insert(
            "self_contained".to_string(),
            parameter(ParameterType::Boolean, "--self-contained", None),
        );
        parameters.insert(
            "no_build".to_string(),
            parameter(ParameterType::Boolean, "--no-build", None),
        );
        parameters.insert(
            "properties".to_string(),
            parameter(ParameterType::Map, "-p", Some("-p:")),
        );

        ParameterSchema { parameters }
    }

    fn cargo_schema() -> ParameterSchema {
        let mut parameters = BTreeMap::new();
        parameters.insert(
            "release".to_string(),
            parameter(ParameterType::Boolean, "--release", None),
        );
        parameters.insert(
            "target".to_string(),
            parameter(ParameterType::String, "--target", None),
        );

        ParameterSchema { parameters }
    }

    fn java_schema() -> ParameterSchema {
        let mut parameters = BTreeMap::new();
        parameters.insert(
            "task".to_string(),
            parameter(ParameterType::String, "", None),
        );
        parameters.insert(
            "properties".to_string(),
            parameter(ParameterType::Map, "", Some("-D")),
        );
        parameters.insert(
            "offline".to_string(),
            parameter(ParameterType::Boolean, "--offline", None),
        );

        ParameterSchema { parameters }
    }

    fn go_schema() -> ParameterSchema {
        let mut parameters = BTreeMap::new();
        parameters.insert(
            "output".to_string(),
            parameter(ParameterType::String, "-o", None),
        );
        parameters.insert(
            "target".to_string(),
            parameter(ParameterType::String, "", Some("GOOS=")),
        );
        parameters.insert(
            "arch".to_string(),
            parameter(ParameterType::String, "", Some("GOARCH=")),
        );

        ParameterSchema { parameters }
    }

    fn parameter(
        param_type: ParameterType,
        flag: &str,
        prefix: Option<&str>,
    ) -> ParameterDefinition {
        ParameterDefinition {
            param_type,
            flag: flag.to_string(),
            aliases: None,
            default: None,
            multiple: None,
            prefix: prefix.map(ToString::to_string),
            description: None,
            env: None,
        }
    }
}
