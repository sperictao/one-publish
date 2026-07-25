use crate::spec::{PublishSpec, SpecValue};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use ts_rs::TS;

pub const CONFIG_VERSION: u32 = 2;

/// Configuration profile for saving build settings
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(rename = "ConfigExportProfile")]
pub struct ConfigProfile {
    pub name: String,
    pub provider_id: String,
    #[serde(default = "default_contract_version")]
    pub contract_version: u32,
    #[serde(default = "default_provider_version")]
    pub provider_version: String,
    #[serde(default = "default_settings_version")]
    pub settings_version: u32,
    pub parameters: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    pub profile_group: Option<String>,
    pub created_at: DateTime<Utc>,
    pub is_system_default: bool,
}

impl Default for ConfigProfile {
    fn default() -> Self {
        Self {
            name: "Default".to_string(),
            provider_id: "dotnet".to_string(),
            contract_version: default_contract_version(),
            provider_version: default_provider_version(),
            settings_version: default_settings_version(),
            parameters: BTreeMap::new(),
            profile_group: None,
            created_at: Utc::now(),
            is_system_default: false,
        }
    }
}

fn default_contract_version() -> u32 {
    crate::store::PUBLISH_CONFIGURATION_CONTRACT_VERSION
}

fn default_provider_version() -> String {
    "1".to_string()
}

fn default_settings_version() -> u32 {
    crate::store::CURRENT_SETTINGS_VERSION
}

/// Exported configuration format
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
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

fn remove_sensitive_fields(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            map.retain(|key, _| !crate::security::is_sensitive_key(key));
            for item in map.values_mut() {
                remove_sensitive_fields(item);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                remove_sensitive_fields(item);
            }
        }
        serde_json::Value::Null
        | serde_json::Value::Bool(_)
        | serde_json::Value::Number(_)
        | serde_json::Value::String(_) => {}
    }
}

fn sanitize_backup_parameters(parameters: &mut BTreeMap<String, serde_json::Value>) {
    parameters.retain(|key, _| !crate::security::is_sensitive_key(key));
    for value in parameters.values_mut() {
        remove_sensitive_fields(value);
    }
    crate::security::sanitize_json_map(parameters);
}

fn contains_sensitive_field(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Object(map) => map.iter().any(|(key, item)| {
            crate::security::is_sensitive_key(key) || contains_sensitive_field(item)
        }),
        serde_json::Value::Array(items) => items.iter().any(contains_sensitive_field),
        serde_json::Value::Null
        | serde_json::Value::Bool(_)
        | serde_json::Value::Number(_)
        | serde_json::Value::String(_) => false,
    }
}

fn profile_contains_sensitive_field(profile: &ConfigProfile) -> bool {
    profile.parameters.iter().any(|(key, value)| {
        crate::security::is_sensitive_key(key) || contains_sensitive_field(value)
    })
}

pub fn build_config_export(
    config: &crate::store::RepoPublishConfig,
    exported_at: DateTime<Utc>,
) -> Result<ConfigExport, ImportError> {
    let profiles = config
        .active_profiles()
        .into_iter()
        .map(|profile| {
            let revision = profile.current_revision().ok_or_else(|| {
                ImportError::InvalidFormat(format!(
                    "profile '{}' is missing current revision",
                    profile.name
                ))
            })?;
            let parameters = revision.parameters.as_object().ok_or_else(|| {
                ImportError::InvalidFormat(format!(
                    "profile '{}' parameters must be an object",
                    profile.name
                ))
            })?;
            let mut parameters = parameters
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect::<BTreeMap<_, _>>();
            sanitize_backup_parameters(&mut parameters);
            let created_at = DateTime::parse_from_rfc3339(&profile.created_at)
                .map_err(|error| {
                    ImportError::InvalidFormat(format!(
                        "profile '{}' has invalid created_at: {error}",
                        profile.name
                    ))
                })?
                .with_timezone(&Utc);

            Ok(ConfigProfile {
                name: profile.name.clone(),
                provider_id: revision.provider_id.clone(),
                contract_version: revision.contract_version,
                provider_version: revision.provider_version.clone(),
                settings_version: revision.settings_version,
                parameters,
                profile_group: profile.profile_group.clone(),
                created_at,
                is_system_default: profile.is_system_default,
            })
        })
        .collect::<Result<Vec<_>, ImportError>>()?;

    Ok(ConfigExport {
        version: CONFIG_VERSION,
        exported_at,
        profiles,
    })
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
        if profile_contains_sensitive_field(profile) {
            return Err(ImportError::ValidationFailed(format!(
                "profile '{}' contains credential fields",
                profile.name
            )));
        }

        // Check if provider exists
        let Ok(provider) = registry.get(&profile.provider_id) else {
            continue;
        };

        let current_provider_version = &provider.manifest().version;
        if profile.contract_version != crate::store::PUBLISH_CONFIGURATION_CONTRACT_VERSION
            || &profile.provider_version != current_provider_version
            || profile.settings_version != crate::store::CURRENT_SETTINGS_VERSION
        {
            continue;
        }

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
    use crate::store::{AutomationBinding, AutomationTriggerPolicy, RepoPublishConfig};
    use chrono::TimeZone;

    #[test]
    fn backup_projects_only_current_content_and_omits_identity_selection_bindings_and_secrets() {
        let mut repo_config = RepoPublishConfig::default();
        let created = repo_config
            .create_profile(
                "Release".to_string(),
                "dotnet".to_string(),
                serde_json::json!({
                    "configuration": "Release",
                    "apiToken": "old-secret"
                }),
                Some("Production".to_string()),
                "2026-07-21T10:00:00Z".to_string(),
            )
            .expect("create profile")
            .clone();
        repo_config
            .select_profile(&created.id)
            .expect("select profile");
        repo_config
            .update_profile(
                &created.id,
                "Release".to_string(),
                "dotnet".to_string(),
                serde_json::json!({
                    "configuration": "Debug",
                    "nested": {
                        "privateKey": "new-secret",
                        "keep": "value"
                    }
                }),
                Some("Production".to_string()),
                "2026-07-21T11:00:00Z".to_string(),
            )
            .expect("update profile");
        repo_config.bindings.push(AutomationBinding {
            id: "binding-1".to_string(),
            configuration_id: created.id,
            configuration_revision_id: created.current_revision_id,
            execution_backend_id: "fake-automation".to_string(),
            trigger_policy: AutomationTriggerPolicy::TagPush {
                tag_prefix: "v".to_string(),
            },
            backend_projection: serde_json::Value::Null,
            runtime_revision: "plan-v1.adapter-v1.fake-automation@1".to_string(),
            external_identity: "one-publish/automation/binding-1.json".to_string(),
            created_at: "2026-07-21T10:00:00Z".to_string(),
            updated_at: "2026-07-21T10:00:00Z".to_string(),
        });

        let backup = build_config_export(
            &repo_config,
            chrono::Utc.with_ymd_and_hms(2026, 7, 21, 12, 0, 0).unwrap(),
        )
        .expect("build backup");
        let json = serde_json::to_string(&backup).expect("serialize backup");

        assert_eq!(backup.profiles.len(), 1);
        assert_eq!(
            backup.profiles[0].parameters.get("configuration"),
            Some(&serde_json::Value::String("Debug".to_string()))
        );
        assert_eq!(
            backup.profiles[0]
                .parameters
                .get("nested")
                .and_then(|value| value.get("keep")),
            Some(&serde_json::Value::String("value".to_string()))
        );
        for forbidden in [
            "old-secret",
            "new-secret",
            "<redacted>",
            "apiToken",
            "privateKey",
            "configuration_id",
            "configurationId",
            "revision_id",
            "revisionId",
            "selectedPreset",
            "binding-1",
            "external_identity",
        ] {
            assert!(
                !json.contains(forbidden),
                "backup leaked {forbidden}: {json}"
            );
        }
    }

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
            profile_group: None,
            created_at: Utc::now(),
            is_system_default: false,
            ..ConfigProfile::default()
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
    fn validate_preserves_unknown_provider_for_blocked_import() {
        let profile = ConfigProfile {
            name: "Test".to_string(),
            provider_id: "invalid_provider".to_string(),
            parameters: BTreeMap::new(),
            profile_group: None,
            created_at: Utc::now(),
            is_system_default: false,
            ..ConfigProfile::default()
        };

        let config = ConfigExport {
            version: CONFIG_VERSION,
            exported_at: Utc::now(),
            profiles: vec![profile],
        };

        assert!(validate_import(&config).is_ok());
    }

    #[test]
    fn validate_rejects_nested_credential_fields_on_import() {
        let profile = ConfigProfile {
            name: "Test".to_string(),
            provider_id: "dotnet".to_string(),
            parameters: BTreeMap::from([(
                "nested".to_string(),
                serde_json::json!({ "apiToken": "must-not-enter-storage" }),
            )]),
            profile_group: None,
            created_at: Utc::now(),
            is_system_default: false,
            ..ConfigProfile::default()
        };
        let config = ConfigExport {
            version: CONFIG_VERSION,
            exported_at: Utc::now(),
            profiles: vec![profile],
        };

        let error = validate_import(&config).expect_err("credential import must fail");
        assert!(error.to_string().contains("credential fields"));
    }

    #[test]
    fn validate_preserves_incompatible_provider_revision_without_current_schema_validation() {
        let profile = ConfigProfile {
            name: "Future dotnet".to_string(),
            provider_id: "dotnet".to_string(),
            provider_version: "999".to_string(),
            parameters: BTreeMap::from([(
                "configuration".to_string(),
                serde_json::Value::Bool(false),
            )]),
            profile_group: None,
            created_at: Utc::now(),
            is_system_default: false,
            ..ConfigProfile::default()
        };
        let config = ConfigExport {
            version: CONFIG_VERSION,
            exported_at: Utc::now(),
            profiles: vec![profile],
        };

        assert!(validate_import(&config).is_ok());
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
            profile_group: None,
            created_at: Utc::now(),
            is_system_default: false,
            ..ConfigProfile::default()
        };

        let config = ConfigExport {
            version: CONFIG_VERSION,
            exported_at: Utc::now(),
            profiles: vec![profile],
        };

        assert!(validate_import(&config).is_err());
    }
}
