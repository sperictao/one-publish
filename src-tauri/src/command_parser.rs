use crate::spec::{PublishSpec, SPEC_VERSION, SpecValue};
use crate::parameter::ParameterSchema;
use std::collections::BTreeMap;

#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("unknown command: {0}")]
    UnknownCommand(String),

    #[error("invalid flag: {0}")]
    InvalidFlag(String),

    #[error("missing value for flag: {0}")]
    MissingValue(String),

    #[error("provider not found: {0}")]
    ProviderNotFound(String),
}

/// Command parser for extracting parameters from CLI commands
pub struct CommandParser {
    pub provider_id: String,
}

impl CommandParser {
    pub fn new(provider_id: String) -> Self {
        Self { provider_id }
    }

    /// Parse a command string and generate a PublishSpec
    pub fn parse_command(
        &self,
        command: &str,
        project_path: String,
        schema: &ParameterSchema,
    ) -> Result<PublishSpec, ParseError> {
        let tokens = tokenize(command);
        let parameters = self.parse_tokens(&tokens, schema)?;

        Ok(PublishSpec {
            version: SPEC_VERSION,
            provider_id: self.provider_id.clone(),
            project_path,
            parameters,
        })
    }

    /// Parse tokens into parameters based on provider type
    fn parse_tokens(
        &self,
        tokens: &[String],
        schema: &ParameterSchema,
    ) -> Result<BTreeMap<String, SpecValue>, ParseError> {
        let mut parameters = BTreeMap::new();
        let mut i = 0;

        while i < tokens.len() {
            let token = &tokens[i];

            // Skip command name
            if i == 0 && !token.starts_with('-') {
                i += 1;
                continue;
            }

            // Parse flags
            if token.starts_with('-') {
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

                // Map flag to parameter key
                if let Some(param_key) = self.map_flag_to_param(&flag_name) {
                    // Find parameter definition
                    if let Some(def) = schema.parameters.get(&param_key) {
                        let spec_value = match (&def.param_type, value.clone()) {
                            (crate::parameter::ParameterType::Boolean, None) => {
                                SpecValue::Bool(true)
                            }
                            (crate::parameter::ParameterType::String, Some(v)) => {
                                SpecValue::String(v)
                            }
                            (crate::parameter::ParameterType::String, None) => {
                                SpecValue::String(String::new())
                            }
                            (crate::parameter::ParameterType::Array, Some(v)) => {
                                // Parse comma-separated values
                                let values: Vec<SpecValue> = v
                                    .split(',')
                                    .map(|s| SpecValue::String(s.trim().to_string()))
                                    .collect();
                                SpecValue::List(values)
                            }
                            _ => {
                                // Default to string
                                value.clone().map(|v| SpecValue::String(v))
                                    .unwrap_or(SpecValue::Null)
                            }
                        };
                        parameters.insert(param_key, spec_value);
                    }
                }

                // Skip value token if we consumed it
                if value.is_some() && !token.contains('=') {
                    i += 2;
                } else {
                    i += 1;
                }
            } else {
                i += 1;
            }
        }

        Ok(parameters)
    }

    /// Map CLI flag to schema parameter key based on provider
    fn map_flag_to_param(&self, flag: &str) -> Option<String> {
        match self.provider_id.as_str() {
            "dotnet" => map_dotnet_flag(flag),
            "cargo" => map_cargo_flag(flag),
            "go" => map_go_flag(flag),
            "java" => map_java_flag(flag),
            _ => None,
        }
    }
}

/// Tokenize command string into words (handling quotes)
fn tokenize(command: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut chars = command.chars().peekable();

    while let Some(c) = chars.next() {
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

/// Map dotnet CLI flags to parameter keys
fn map_dotnet_flag(flag: &str) -> Option<String> {
    match flag {
        "-c" | "--configuration" => Some("configuration".to_string()),
        "-r" | "--runtime" => Some("runtime".to_string()),
        "-f" | "--framework" => Some("framework".to_string()),
        "-o" | "--output" => Some("output".to_string()),
        "--self-contained" => Some("self_contained".to_string()),
        "--no-build" => Some("no_build".to_string()),
        "--no-restore" => Some("no_restore".to_string()),
        "--verbosity" => Some("verbosity".to_string()),
        "--no-logo" => Some("no_logo".to_string()),
        "-d" | "--define" => Some("define".to_string()),
        _ => None,
    }
}

/// Map cargo CLI flags to parameter keys
fn map_cargo_flag(flag: &str) -> Option<String> {
    match flag {
        "--release" => Some("release".to_string()),
        "--target" => Some("target".to_string()),
        "--features" => Some("features".to_string()),
        "--all-features" => Some("all_features".to_string()),
        "--no-default-features" => Some("no_default_features".to_string()),
        "--target-dir" => Some("target_dir".to_string()),
        "--message-format" => Some("message_format".to_string()),
        "--verbose" => Some("verbose".to_string()),
        "-v" => Some("verbose".to_string()),
        "--quiet" => Some("quiet".to_string()),
        _ => None,
    }
}

/// Map go CLI flags to parameter keys
fn map_go_flag(flag: &str) -> Option<String> {
    match flag {
        "-o" => Some("output".to_string()),
        "-tags" => Some("tags".to_string()),
        "-race" => Some("race".to_string()),
        "-v" => Some("v".to_string()),
        "-work" => Some("work".to_string()),
        "-trimpath" => Some("trimpath".to_string()),
        _ => None,
    }
}

/// Map gradle/Java CLI flags to parameter keys
fn map_java_flag(flag: &str) -> Option<String> {
    match flag {
        "-D" => Some("properties".to_string()),
        "--offline" => Some("offline".to_string()),
        "--quiet" => Some("quiet".to_string()),
        "--info" => Some("info".to_string()),
        "--debug" => Some("debug".to_string()),
        "--stacktrace" => Some("stacktrace".to_string()),
        "--rerun-tasks" => Some("rerun_tasks".to_string()),
        "--exclude-task" => Some("exclude_task".to_string()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenize_simple_command() {
        let command = "dotnet publish -c Release -r win-x64";
        let tokens = tokenize(command);
        assert_eq!(tokens, vec![
            "dotnet".to_string(),
            "publish".to_string(),
            "-c".to_string(),
            "Release".to_string(),
            "-r".to_string(),
            "win-x64".to_string(),
        ]);
    }

    #[test]
    fn tokenize_command_with_quotes() {
        let command = "cargo build --features \"feature1,feature2\"";
        let tokens = tokenize(command);
        assert_eq!(tokens, vec![
            "cargo".to_string(),
            "build".to_string(),
            "--features".to_string(),
            "feature1,feature2".to_string(),
        ]);
    }

    #[test]
    fn tokenize_flag_with_equals() {
        let command = "./gradlew build -Dversion=1.2.3";
        let tokens = tokenize(command);
        assert_eq!(tokens, vec![
            "./gradlew".to_string(),
            "build".to_string(),
            "-Dversion=1.2.3".to_string(),
        ]);
    }

    #[test]
    fn map_dotnet_configuration_flag() {
        assert_eq!(map_dotnet_flag("-c"), Some("configuration".to_string()));
        assert_eq!(map_dotnet_flag("--configuration"), Some("configuration".to_string()));
    }

    #[test]
    fn map_cargo_release_flag() {
        assert_eq!(map_cargo_flag("--release"), Some("release".to_string()));
    }

    #[test]
    fn map_go_output_flag() {
        assert_eq!(map_go_flag("-o"), Some("output".to_string()));
    }

    #[test]
    fn parse_dotnet_command() {
        let parser = CommandParser::new("dotnet".to_string());
        let command = "dotnet publish -c Release -r win-x64 --self-contained";
        let schema = ParameterSchema {
            parameters: BTreeMap::new(),
        };
        let result = parser.parse_command(command, "test.csproj".to_string(), &schema);

        assert!(result.is_ok());
        let spec = result.unwrap();
        assert_eq!(spec.provider_id, "dotnet");
        assert_eq!(spec.project_path, "test.csproj");
    }

    #[test]
    fn parse_cargo_command() {
        let parser = CommandParser::new("cargo".to_string());
        let command = "cargo build --release --target x86_64-apple-darwin";
        let schema = ParameterSchema {
            parameters: BTreeMap::new(),
        };
        let result = parser.parse_command(command, "Cargo.toml".to_string(), &schema);

        assert!(result.is_ok());
        let spec = result.unwrap();
        assert_eq!(spec.provider_id, "cargo");
        assert_eq!(spec.project_path, "Cargo.toml");
    }
}
