use crate::spec::{PublishSpec, SpecValue};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;

const CONFIG_VERSION: u32 = 1;

/// Configuration profile for saving build settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigProfile {
    pub name: String,
    pub provider_id: String,
    pub parameters: BTreeMap<String, serde_json::Value>,
    pub created_at: DateTime<Utc>,
    pub is_system_default: bool,
}

impl Default for ConfigProfile {
    fn default() -> Self {
        Self {
            name: "Default".to_string(),
            provider_id: "dotnet".to_string(),
            parameters: BTreeMap::new(),
            created_at: Utc::now(),
            is_system_default: false,
        }
    }
}

/// Exported configuration format
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigExport {
    pub version: u32,
    pub exported_at: DateTime<Utc>,
    pub profiles: Vec<ConfigProfile>,
}

#[derive(Debug, thiserror::Error)]
pub enum ImportError {
    #[error("unsupported version: {0}")]
    UnsupportedVersion(u32),

    #[error("invalid format: {0}")]
    InvalidFormat(String),

    #[error("provider not found: {0}")]
    ProviderNotFound(String),

    #[error("validation failed: {0}")]
    ValidationFailed(String),
}

/// Remove machine-specific paths from PublishSpec for export
pub fn sanitize_for_export(spec: &PublishSpec) -> PublishSpec {
    let mut sanitized = spec.clone();
    sanitized.project_path = String::new();

    // Sanitize output if absolute
    if let Some(SpecValue::String(output_dir)) = sanitized.parameters.get_mut("output") {
        if PathBuf::from(&**output_dir).is_absolute() {
            *output_dir = "<local-path>".to_string();
        }
    }

    // Sanitize target_dir if absolute (cargo)
    if let Some(SpecValue::String(target_dir)) = sanitized.parameters.get_mut("target_dir") {
        if PathBuf::from(&**target_dir).is_absolute() {
            *target_dir = "<local-path>".to_string();
        }
    }

    sanitized
}

/// Validate imported configuration
pub fn validate_import(config: &ConfigExport) -> Result<(), ImportError> {
    if config.version > CONFIG_VERSION {
        return Err(ImportError::UnsupportedVersion(config.version));
    }

    let registry = crate::provider::registry::ProviderRegistry::new();

    for profile in &config.profiles {
        // Check if provider exists
        let provider = registry
            .get(&profile.provider_id)
            .map_err(|_| ImportError::ProviderNotFound(profile.provider_id.clone()))?;

        // Validate parameters against schema
        let schema = provider
            .get_schema()
            .map_err(|e| ImportError::ValidationFailed(format!("failed to load schema: {}", e)))?;

        for (key, value) in &profile.parameters {
            // Warn about unknown parameters but don't fail
            if !schema.parameters.contains_key(key) {
                // Log warning: unknown parameter {key}
                continue;
            }

            // Validate value type against schema
            if let Some(param_def) = schema.parameters.get(key) {
                validate_parameter_type(key, value, &param_def.param_type)?;
            }
        }
    }

    Ok(())
}

/// Validate parameter type matches schema definition
fn validate_parameter_type(
    key: &str,
    value: &serde_json::Value,
    expected_type: &crate::parameter::ParameterType,
) -> Result<(), ImportError> {
    match expected_type {
        crate::parameter::ParameterType::Boolean => {
            if !value.is_boolean() {
                return Err(ImportError::ValidationFailed(format!(
                    "parameter '{}' should be boolean, got {}",
                    key, value
                )));
            }
        }
        crate::parameter::ParameterType::String => {
            if !value.is_string() {
                return Err(ImportError::ValidationFailed(format!(
                    "parameter '{}' should be string, got {}",
                    key, value
                )));
            }
        }
        crate::parameter::ParameterType::Array => {
            if !value.is_array() {
                return Err(ImportError::ValidationFailed(format!(
                    "parameter '{}' should be array, got {}",
                    key, value
                )));
            }
        }
        crate::parameter::ParameterType::Map => {
            if !value.is_object() {
                return Err(ImportError::ValidationFailed(format!(
                    "parameter '{}' should be object, got {}",
                    key, value
                )));
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spec::{SpecValue, SPEC_VERSION};

    #[test]
    fn sanitize_removes_project_path() {
        let spec = PublishSpec {
            version: SPEC_VERSION,
            provider_id: "dotnet".to_string(),
            project_path: "/Users/test/project.csproj".to_string(),
            parameters: BTreeMap::new(),
        };

        let sanitized = sanitize_for_export(&spec);
        assert_eq!(sanitized.project_path, "");
    }

    #[test]
    fn sanitize_removes_absolute_output() {
        let mut parameters = BTreeMap::new();
        parameters.insert(
            "output".to_string(),
            SpecValue::String("/Users/test/publish".to_string()),
        );

        let spec = PublishSpec {
            version: SPEC_VERSION,
            provider_id: "dotnet".to_string(),
            project_path: String::new(),
            parameters,
        };

        let sanitized = sanitize_for_export(&spec);
        assert_eq!(
            sanitized.parameters.get("output"),
            Some(&SpecValue::String("<local-path>".to_string()))
        );
    }

    #[test]
    fn sanitize_preserves_relative_output() {
        let mut parameters = BTreeMap::new();
        parameters.insert(
            "output".to_string(),
            SpecValue::String("./publish".to_string()),
        );

        let spec = PublishSpec {
            version: SPEC_VERSION,
            provider_id: "dotnet".to_string(),
            project_path: String::new(),
            parameters,
        };

        let sanitized = sanitize_for_export(&spec);
        assert_eq!(
            sanitized.parameters.get("output"),
            Some(&SpecValue::String("./publish".to_string()))
        );
    }

    #[test]
    fn validate_accepts_valid_config() {
        let profile = ConfigProfile {
            name: "Test Profile".to_string(),
            provider_id: "dotnet".to_string(),
            parameters: {
                let mut map = BTreeMap::new();
                map.insert(
                    "configuration".to_string(),
                    serde_json::Value::String("Release".to_string()),
                );
                map
            },
            created_at: Utc::now(),
            is_system_default: false,
        };

        let config = ConfigExport {
            version: CONFIG_VERSION,
            exported_at: Utc::now(),
            profiles: vec![profile],
        };

        assert!(validate_import(&config).is_ok());
    }

    #[test]
    fn validate_rejects_unsupported_version() {
        let config = ConfigExport {
            version: 999,
            exported_at: Utc::now(),
            profiles: vec![],
        };

        assert!(validate_import(&config).is_err());
    }

    #[test]
    fn validate_rejects_invalid_provider() {
        let profile = ConfigProfile {
            name: "Test".to_string(),
            provider_id: "invalid_provider".to_string(),
            parameters: BTreeMap::new(),
            created_at: Utc::now(),
            is_system_default: false,
        };

        let config = ConfigExport {
            version: CONFIG_VERSION,
            exported_at: Utc::now(),
            profiles: vec![profile],
        };

        assert!(validate_import(&config).is_err());
    }

    #[test]
    fn validate_rejects_invalid_parameter_type() {
        let profile = ConfigProfile {
            name: "Test".to_string(),
            provider_id: "dotnet".to_string(),
            parameters: {
                let mut map = BTreeMap::new();
                map.insert(
                    "configuration".to_string(),
                    serde_json::Value::Bool(false), // Should be string
                );
                map
            },
            created_at: Utc::now(),
            is_system_default: false,
        };

        let config = ConfigExport {
            version: CONFIG_VERSION,
            exported_at: Utc::now(),
            profiles: vec![profile],
        };

        assert!(validate_import(&config).is_err());
    }
}
