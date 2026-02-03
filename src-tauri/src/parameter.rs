use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParameterSchema {
    pub parameters: BTreeMap<String, ParameterDefinition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParameterDefinition {
    #[serde(rename = "type")]
    pub param_type: ParameterType,
    pub flag: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub multiple: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prefix: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ParameterType {
    Boolean,
    String,
    Array,
    Map,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderedCommand {
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

pub struct ParameterRenderer {
    schema: ParameterSchema,
}

impl ParameterRenderer {
    pub fn new(schema: ParameterSchema) -> Self {
        Self { schema }
    }

    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        let schema: ParameterSchema = serde_json::from_str(json)?;
        Ok(Self::new(schema))
    }

    pub fn render(&self, params: &BTreeMap<String, crate::spec::SpecValue>) -> Result<RenderedCommand, RenderError> {
        let mut args = Vec::new();
        let env = Vec::new();

        for (key, value) in params {
            let def = self.schema.parameters.get(key)
                .ok_or_else(|| RenderError::UnknownParameter(key.clone()))?;

            match def.param_type {
                ParameterType::Boolean => self.render_boolean(def, key, value, &mut args)?,
                ParameterType::String => self.render_string(def, key, value, &mut args)?,
                ParameterType::Array => self.render_array(def, key, value, &mut args)?,
                ParameterType::Map => self.render_map(def, key, value, &mut args)?,
            }
        }

        Ok(RenderedCommand { args, env })
    }

    fn render_boolean(&self, def: &ParameterDefinition, _key: &str, value: &crate::spec::SpecValue, args: &mut Vec<String>) -> Result<(), RenderError> {
        match value {
            crate::spec::SpecValue::Bool(true) => {
                args.push(def.flag.clone());
            }
            crate::spec::SpecValue::Bool(false) => {
                // Omit flag when false
            }
            crate::spec::SpecValue::Null => {
                // Omit when null
            }
            _ => {
                return Err(RenderError::InvalidType {
                    parameter: _key.to_string(),
                    expected: "boolean".to_string(),
                });
            }
        }
        Ok(())
    }

    fn render_string(&self, def: &ParameterDefinition, key: &str, value: &crate::spec::SpecValue, args: &mut Vec<String>) -> Result<(), RenderError> {
        match value {
            crate::spec::SpecValue::String(s) => {
                args.push(def.flag.clone());
                args.push(s.clone());
            }
            crate::spec::SpecValue::Number(n) => {
                args.push(def.flag.clone());
                args.push(n.to_string());
            }
            crate::spec::SpecValue::Null => {
                // Omit when null
            }
            _ => {
                return Err(RenderError::InvalidType {
                    parameter: key.to_string(),
                    expected: "string or number".to_string(),
                });
            }
        }
        Ok(())
    }

    fn render_array(&self, def: &ParameterDefinition, key: &str, value: &crate::spec::SpecValue, args: &mut Vec<String>) -> Result<(), RenderError> {
        match value {
            crate::spec::SpecValue::List(items) => {
                for item in items {
                    match item {
                        crate::spec::SpecValue::String(s) => {
                            args.push(def.flag.clone());
                            args.push(s.clone());
                        }
                        crate::spec::SpecValue::Number(n) => {
                            args.push(def.flag.clone());
                            args.push(n.to_string());
                        }
                        _ => {
                            return Err(RenderError::InvalidArrayTypeItem {
                                parameter: key.to_string(),
                                item: format!("{:?}", item),
                            });
                        }
                    }
                }
            }
            crate::spec::SpecValue::Null => {
                // Omit when null
            }
            _ => {
                return Err(RenderError::InvalidType {
                    parameter: key.to_string(),
                    expected: "array".to_string(),
                });
            }
        }
        Ok(())
    }

    fn render_map(&self, def: &ParameterDefinition, key: &str, value: &crate::spec::SpecValue, args: &mut Vec<String>) -> Result<(), RenderError> {
        let prefix = def.prefix.as_ref()
            .ok_or_else(|| RenderError::MissingPrefix(key.to_string()))?;

        match value {
            crate::spec::SpecValue::Map(map) => {
                for (k, v) in map {
                    match v {
                        crate::spec::SpecValue::String(s) => {
                            args.push(format!("{}{}={}", prefix, k, s));
                        }
                        crate::spec::SpecValue::Number(n) => {
                            args.push(format!("{}{}={}", prefix, k, n));
                        }
                        crate::spec::SpecValue::Bool(b) => {
                            args.push(format!("{}{}={}", prefix, k, b));
                        }
                        _ => {
                            return Err(RenderError::InvalidMapValue {
                                parameter: key.to_string(),
                                key: k.clone(),
                                value: format!("{:?}", v),
                            });
                        }
                    }
                }
            }
            crate::spec::SpecValue::Null => {
                // Omit when null
            }
            _ => {
                return Err(RenderError::InvalidType {
                    parameter: key.to_string(),
                    expected: "map".to_string(),
                });
            }
        }
        Ok(())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum RenderError {
    #[error("unknown parameter: {0}")]
    UnknownParameter(String),

    #[error("invalid type for parameter '{parameter}': expected '{expected}'")]
    InvalidType { parameter: String, expected: String },

    #[error("invalid array item for parameter '{parameter}': {item}")]
    InvalidArrayTypeItem { parameter: String, item: String },

    #[error("missing prefix for map parameter '{0}'")]
    MissingPrefix(String),

    #[error("invalid map value for '{parameter}' key '{key}': {value}")]
    InvalidMapValue { parameter: String, key: String, value: String },
}

pub fn load_schema_from_file(path: &Path) -> Result<ParameterSchema, RenderError> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| RenderError::UnknownParameter(format!("failed to read schema file: {}", e)))?;
    let schema: ParameterSchema = serde_json::from_str(&content)
        .map_err(|e| RenderError::UnknownParameter(format!("failed to parse schema JSON: {}", e)))?;
    Ok(schema)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spec::SpecValue;

    fn create_test_schema() -> ParameterSchema {
        let mut parameters = BTreeMap::new();

        parameters.insert("release".to_string(), ParameterDefinition {
            param_type: ParameterType::Boolean,
            flag: "--release".to_string(),
            multiple: None,
            prefix: None,
            description: Some("Build in release mode".to_string()),
        });

        parameters.insert("target".to_string(), ParameterDefinition {
            param_type: ParameterType::String,
            flag: "--target".to_string(),
            multiple: None,
            prefix: None,
            description: Some("Target triple".to_string()),
        });

        parameters.insert("features".to_string(), ParameterDefinition {
            param_type: ParameterType::Array,
            flag: "--features".to_string(),
            multiple: None,
            prefix: None,
            description: Some("List of features".to_string()),
        });

        parameters.insert("defines".to_string(), ParameterDefinition {
            param_type: ParameterType::Map,
            flag: "".to_string(),
            multiple: None,
            prefix: Some("--define=".to_string()),
            description: Some("Preprocessor defines".to_string()),
        });

        ParameterSchema { parameters }
    }

    #[test]
    fn schema_creates_from_json() {
        let json = r#"{
            "parameters": {
                "release": {
                    "type": "boolean",
                    "flag": "--release",
                    "description": "Build in release mode"
                }
            }
        }"#;

        let result = ParameterRenderer::from_json(json);
        assert!(result.is_ok());
    }

    #[test]
    fn boolean_flag_rendered_when_true() {
        let schema = create_test_schema();
        let renderer = ParameterRenderer::new(schema);

        let mut params = BTreeMap::new();
        params.insert("release".to_string(), SpecValue::Bool(true));

        let result = renderer.render(&params).expect("render");
        assert_eq!(result.args, vec!["--release"]);
    }

    #[test]
    fn boolean_flag_omitted_when_false() {
        let schema = create_test_schema();
        let renderer = ParameterRenderer::new(schema);

        let mut params = BTreeMap::new();
        params.insert("release".to_string(), SpecValue::Bool(false));

        let result = renderer.render(&params).expect("render");
        assert!(result.args.is_empty());
    }

    #[test]
    fn string_value_rendered() {
        let schema = create_test_schema();
        let renderer = ParameterRenderer::new(schema);

        let mut params = BTreeMap::new();
        params.insert("target".to_string(), SpecValue::String("x86_64-apple-darwin".to_string()));

        let result = renderer.render(&params).expect("render");
        assert_eq!(result.args, vec!["--target", "x86_64-apple-darwin"]);
    }

    #[test]
    fn array_rendered_as_multiple_flags() {
        let schema = create_test_schema();
        let renderer = ParameterRenderer::new(schema);

        let mut params = BTreeMap::new();
        params.insert("features".to_string(), SpecValue::List(vec![
            SpecValue::String("feature1".to_string()),
            SpecValue::String("feature2".to_string()),
        ]));

        let result = renderer.render(&params).expect("render");
        assert_eq!(result.args, vec![
            "--features", "feature1",
            "--features", "feature2"
        ]);
    }

    #[test]
    fn map_rendered_with_prefix() {
        let schema = create_test_schema();
        let renderer = ParameterRenderer::new(schema);

        let mut inner = BTreeMap::new();
        inner.insert("DEBUG".to_string(), SpecValue::Bool(true));
        inner.insert("VERSION".to_string(), SpecValue::String("1.0".to_string()));

        let mut params = BTreeMap::new();
        params.insert("defines".to_string(), SpecValue::Map(inner));

        let result = renderer.render(&params).expect("render");
        assert!(result.args.contains(&"--define=DEBUG=true".to_string()));
        assert!(result.args.contains(&"--define=VERSION=1.0".to_string()));
    }

    #[test]
    fn unknown_parameter_returns_error() {
        let schema = create_test_schema();
        let renderer = ParameterRenderer::new(schema);

        let mut params = BTreeMap::new();
        params.insert("unknown".to_string(), SpecValue::Bool(true));

        let result = renderer.render(&params);
        assert!(result.is_err());
        match result {
            Err(RenderError::UnknownParameter(s)) => assert_eq!(s, "unknown"),
            _ => panic!("expected UnknownParameter error"),
        }
    }

    #[test]
    fn invalid_type_returns_error() {
        let schema = create_test_schema();
        let renderer = ParameterRenderer::new(schema);

        let mut params = BTreeMap::new();
        params.insert("release".to_string(), SpecValue::String("not a bool".to_string()));

        let result = renderer.render(&params);
        assert!(result.is_err());
    }

    #[test]
    fn combined_parameters_render_correctly() {
        let schema = create_test_schema();
        let renderer = ParameterRenderer::new(schema);

        let mut inner = BTreeMap::new();
        inner.insert("FOO".to_string(), SpecValue::String("bar".to_string()));

        let mut params = BTreeMap::new();
        params.insert("release".to_string(), SpecValue::Bool(true));
        params.insert("target".to_string(), SpecValue::String("x86_64".to_string()));
        params.insert("defines".to_string(), SpecValue::Map(inner));

        let result = renderer.render(&params).expect("render");
        assert!(result.args.contains(&"--release".to_string()));
        assert!(result.args.contains(&"--target".to_string()));
        assert!(result.args.contains(&"x86_64".to_string()));
        assert!(result.args.contains(&"--define=FOO=bar".to_string()));
    }
}
