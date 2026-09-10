//! 旧 .NET 富表单语义的迁移专用移植（统一发布输入方案 §4.2）。
//!
//! 这里的两个转换与被删除的前端 `dotnetPublishConfig.ts` 逐一对应：
//! `parameters_from_rich_form` ≙ `buildDotnetProfileParameters`，
//! `rich_form_from_parameters` ≙ `createDotnetPublishConfigFromParameters`。
//! 仅服务 v3→v4 编辑状态迁移与过渡投影（§4.3：PublishConfigStore 最多保留
//! 在旧数据解码内部）；它们是有损富表单语义，不得用于新数据路径。

use serde_json::Value;

use super::types::PublishConfigStore;

fn properties_value(properties: &std::collections::BTreeMap<String, String>) -> Value {
    serde_json::to_value(properties).unwrap_or(Value::Null)
}

/// 旧前端 `DOTNET_UNSUPPORTED_PUBLISH_PROPERTY_KEYS`：pubxml 属性黑名单。
const UNSUPPORTED_PUBLISH_PROPERTY_KEYS: &[&str] = &[
    "Configuration",
    "Define",
    "ExcludeApp_Data",
    "LastUsedBuildConfiguration",
    "LastUsedPlatform",
    "LaunchSiteAfterPublish",
    "Platform",
    "ProjectGuid",
    "PublishProvider",
    "PublishUrl",
    "RuntimeIdentifier",
    "RuntimeIdentifiers",
    "SiteUrlToLaunchAfterPublish",
    "TargetFramework",
    "TargetFrameworks",
    "WebPublishMethod",
    "_TargetId",
];

fn normalize_property_map(value: &Value) -> Vec<(String, String)> {
    let Some(object) = value.as_object() else {
        return Vec::new();
    };
    object
        .iter()
        .filter_map(|(key, item)| {
            let normalized = match item {
                Value::String(text) => text.clone(),
                Value::Number(number) => number.to_string(),
                Value::Bool(flag) => flag.to_string(),
                _ => return None,
            };
            let key = key.trim().to_string();
            if key.is_empty() {
                None
            } else {
                Some((key, normalized))
            }
        })
        .collect()
}

fn sanitize_properties(entries: Vec<(String, String)>) -> Vec<(String, String)> {
    entries
        .into_iter()
        .filter(|(key, _)| {
            !UNSUPPORTED_PUBLISH_PROPERTY_KEYS
                .iter()
                .any(|blocked| blocked.eq_ignore_ascii_case(key))
        })
        .collect()
}

fn property_object(entries: Vec<(String, String)>) -> Value {
    let mut object = serde_json::Map::new();
    for (key, value) in entries {
        object.insert(key, Value::String(value));
    }
    Value::Object(object)
}

/// 旧 `buildDotnetProfileParameters`：富表单 → 参数（有损：false/空值被省略）。
pub(crate) fn parameters_from_rich_form(config: &PublishConfigStore) -> Value {
    let mut parameters = serde_json::Map::new();
    let use_profile = config.use_profile;
    if !(use_profile && config.configuration.trim() == "Release") {
        let configuration = if config.configuration.trim().is_empty() {
            "Release"
        } else {
            config.configuration.trim()
        };
        parameters.insert(
            "configuration".to_string(),
            Value::String(configuration.to_string()),
        );
    }
    if !config.runtime.trim().is_empty() {
        parameters.insert(
            "runtime".to_string(),
            Value::String(config.runtime.trim().to_string()),
        );
    }
    if !config.framework.trim().is_empty() {
        parameters.insert(
            "framework".to_string(),
            Value::String(config.framework.trim().to_string()),
        );
    }
    if config.self_contained {
        parameters.insert("self_contained".to_string(), Value::Bool(true));
    }
    if !config.output_dir.trim().is_empty() {
        parameters.insert(
            "output".to_string(),
            Value::String(config.output_dir.trim().to_string()),
        );
    }
    if config.no_build {
        parameters.insert("no_build".to_string(), Value::Bool(true));
    }
    if config.no_restore {
        parameters.insert("no_restore".to_string(), Value::Bool(true));
    }
    if !config.verbosity.trim().is_empty() {
        parameters.insert(
            "verbosity".to_string(),
            Value::String(config.verbosity.trim().to_string()),
        );
    }
    if config.no_logo {
        parameters.insert("no_logo".to_string(), Value::Bool(true));
    }
    if config.delete_existing_files {
        parameters.insert("delete_existing_files".to_string(), Value::Bool(true));
    }

    let mut properties = sanitize_properties(normalize_property_map(&properties_value(
        &config.properties,
    )));
    if use_profile && !config.profile_name.trim().is_empty() {
        properties.push((
            "PublishProfile".to_string(),
            config.profile_name.trim().to_string(),
        ));
    }
    if !properties.is_empty() {
        parameters.insert("properties".to_string(), property_object(properties));
    }

    Value::Object(parameters)
}

fn parse_boolean_string(value: &str) -> Option<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "true" | "1" | "yes" => Some(true),
        "false" | "0" | "no" => Some(false),
        _ => None,
    }
}

/// 旧 `createDotnetPublishConfigFromParameters`：参数 → 富表单视图
/// （`inferProfileSelection` 分支仅用于档案加载，迁移不需要）。
pub(crate) fn rich_form_from_parameters(parameters: &Value) -> PublishConfigStore {
    let mut config = PublishConfigStore::default();
    let Some(object) = parameters.as_object() else {
        return config;
    };

    if let Some(Value::String(configuration)) = object.get("configuration") {
        if !configuration.trim().is_empty() {
            config.configuration = configuration.clone();
        }
    }
    if let Some(Value::String(runtime)) = object.get("runtime") {
        config.runtime = runtime.clone();
    }
    if let Some(Value::String(framework)) = object.get("framework") {
        config.framework = framework.clone();
    }
    config.self_contained = object.get("self_contained") == Some(&Value::Bool(true));
    if let Some(Value::String(output)) = object.get("output") {
        config.output_dir = output.clone();
    }
    config.no_build = object.get("no_build") == Some(&Value::Bool(true));
    config.no_restore = object.get("no_restore") == Some(&Value::Bool(true));
    if let Some(Value::String(verbosity)) = object.get("verbosity") {
        config.verbosity = verbosity.clone();
    }
    config.no_logo = object.get("no_logo") == Some(&Value::Bool(true));

    let mut properties = normalize_property_map(object.get("properties").unwrap_or(&Value::Null));
    // 一等 delete_existing_files 优先于属性映射里的 DeleteExistingFiles。
    config.delete_existing_files = match object.get("delete_existing_files") {
        Some(Value::Bool(flag)) => *flag,
        _ => {
            let extracted = properties
                .iter()
                .position(|(key, _)| key == "DeleteExistingFiles" || key == "deleteExistingFiles")
                .and_then(|position| {
                    let (_, value) = properties.remove(position);
                    parse_boolean_string(&value)
                });
            extracted.unwrap_or(false)
        }
    };
    config.properties = sanitize_properties(properties).into_iter().collect();

    config
}

/// §4.2 未保存修改迁移：比较"修订参数按旧规则投影的富表单"与持久化
/// customConfig，把实际变化的字段叠加到修订参数上；属性 map 按 key 应用差异。
/// 没有变化时返回 None（保留修订选择）。
pub(crate) fn draft_parameters_with_unsaved_changes(
    revision_parameters: &Value,
    edited: &PublishConfigStore,
) -> Option<Value> {
    let projected = rich_form_from_parameters(revision_parameters);
    let mut parameters = revision_parameters.as_object()?.clone();
    let mut changed = false;

    fn set_string(
        parameters: &mut serde_json::Map<String, Value>,
        changed: &mut bool,
        key: &str,
        projected_value: &str,
        edited_value: &str,
    ) {
        if projected_value != edited_value {
            *changed = true;
            if edited_value.trim().is_empty() {
                parameters.remove(key);
            } else {
                parameters.insert(
                    key.to_string(),
                    Value::String(edited_value.trim().to_string()),
                );
            }
        }
    }
    fn set_bool(
        parameters: &mut serde_json::Map<String, Value>,
        changed: &mut bool,
        key: &str,
        projected_value: bool,
        edited_value: bool,
    ) {
        if projected_value != edited_value {
            *changed = true;
            parameters.insert(key.to_string(), Value::Bool(edited_value));
        }
    }

    set_string(
        &mut parameters,
        &mut changed,
        "configuration",
        &projected.configuration,
        &edited.configuration,
    );
    set_string(
        &mut parameters,
        &mut changed,
        "runtime",
        &projected.runtime,
        &edited.runtime,
    );
    set_string(
        &mut parameters,
        &mut changed,
        "framework",
        &projected.framework,
        &edited.framework,
    );
    set_bool(
        &mut parameters,
        &mut changed,
        "self_contained",
        projected.self_contained,
        edited.self_contained,
    );
    set_string(
        &mut parameters,
        &mut changed,
        "output",
        &projected.output_dir,
        &edited.output_dir,
    );
    set_bool(
        &mut parameters,
        &mut changed,
        "no_build",
        projected.no_build,
        edited.no_build,
    );
    set_bool(
        &mut parameters,
        &mut changed,
        "no_restore",
        projected.no_restore,
        edited.no_restore,
    );
    set_string(
        &mut parameters,
        &mut changed,
        "verbosity",
        &projected.verbosity,
        &edited.verbosity,
    );
    set_bool(
        &mut parameters,
        &mut changed,
        "no_logo",
        projected.no_logo,
        edited.no_logo,
    );
    set_bool(
        &mut parameters,
        &mut changed,
        "delete_existing_files",
        projected.delete_existing_files,
        edited.delete_existing_files,
    );

    // 属性 map 按 key 应用差异。
    let projected_properties = sanitize_properties(normalize_property_map(&properties_value(
        &projected.properties,
    )));
    let edited_properties = sanitize_properties(normalize_property_map(&properties_value(
        &edited.properties,
    )));
    for (key, value) in &edited_properties {
        if projected_properties
            .iter()
            .any(|(projected_key, projected_value)| {
                projected_key == key && projected_value == value
            })
        {
            continue;
        }
        changed = true;
        parameters
            .entry("properties".to_string())
            .or_insert_with(|| Value::Object(serde_json::Map::new()))
            .as_object_mut()
            .expect("properties is an object")
            .insert(key.clone(), Value::String(value.clone()));
    }
    for (key, _) in &projected_properties {
        if !edited_properties
            .iter()
            .any(|(edited_key, _)| edited_key == key)
        {
            changed = true;
            if let Some(properties) = parameters
                .get_mut("properties")
                .and_then(Value::as_object_mut)
            {
                properties.remove(key);
            }
        }
    }
    // PublishProfile 选择：useProfile + profileName 即属性键。
    if edited.use_profile != projected.use_profile
        || edited.profile_name.trim() != projected.profile_name.trim()
    {
        changed = true;
        if edited.use_profile && !edited.profile_name.trim().is_empty() {
            parameters
                .entry("properties".to_string())
                .or_insert_with(|| Value::Object(serde_json::Map::new()))
                .as_object_mut()
                .expect("properties is an object")
                .insert(
                    "PublishProfile".to_string(),
                    Value::String(edited.profile_name.trim().to_string()),
                );
        }
    }

    changed.then_some(Value::Object(parameters))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parameters_from_rich_form_matches_the_deleted_frontend_semantics() {
        let config = PublishConfigStore {
            configuration: "Release".to_string(),
            runtime: "linux-x64".to_string(),
            framework: "net8.0".to_string(),
            self_contained: true,
            output_dir: "./publish".to_string(),
            no_build: true,
            no_restore: true,
            verbosity: "diagnostic".to_string(),
            no_logo: true,
            delete_existing_files: true,
            properties: [("Version".to_string(), "1.2.3".to_string())]
                .into_iter()
                .collect(),
            use_profile: false,
            profile_name: String::new(),
        };

        assert_eq!(
            parameters_from_rich_form(&config),
            json!({
                "configuration": "Release",
                "runtime": "linux-x64",
                "framework": "net8.0",
                "self_contained": true,
                "output": "./publish",
                "no_build": true,
                "no_restore": true,
                "verbosity": "diagnostic",
                "no_logo": true,
                "delete_existing_files": true,
                "properties": { "Version": "1.2.3" },
            })
        );
    }

    #[test]
    fn rich_form_from_parameters_extracts_delete_existing_files_and_blacklist() {
        let config = rich_form_from_parameters(&json!({
            "configuration": "Debug",
            "self_contained": false,
            "properties": {
                "Version": "2.0.0",
                "PublishTrimmed": false,
                "DeleteExistingFiles": "true",
                "TargetFramework": "net8.0",
            },
        }));

        assert_eq!(config.configuration, "Debug");
        assert!(!config.self_contained);
        assert!(config.delete_existing_files);
        assert_eq!(
            config.properties.get("PublishTrimmed").map(String::as_str),
            Some("false")
        );
        assert!(!config.properties.contains_key("TargetFramework"));
        assert!(!config.properties.contains_key("DeleteExistingFiles"));
    }

    #[test]
    fn unsaved_change_detection_overlays_only_changed_fields() {
        let revision_parameters = json!({ "configuration": "Release", "runtime": "osx-x64" });

        // 无变化：返回 None。
        let untouched = rich_form_from_parameters(&revision_parameters);
        assert_eq!(
            draft_parameters_with_unsaved_changes(&revision_parameters, &untouched),
            None
        );

        // 仅 verbosity 变化：叠加该字段，其余保留修订参数。
        let edited = PublishConfigStore {
            verbosity: "minimal".to_string(),
            ..rich_form_from_parameters(&revision_parameters)
        };
        assert_eq!(
            draft_parameters_with_unsaved_changes(&revision_parameters, &edited),
            Some(json!({
                "configuration": "Release",
                "runtime": "osx-x64",
                "verbosity": "minimal",
            }))
        );

        // 属性按 key 应用差异。
        let property_edit = PublishConfigStore {
            properties: [("Version".to_string(), "9.9.9".to_string())]
                .into_iter()
                .collect(),
            ..rich_form_from_parameters(&revision_parameters)
        };
        assert_eq!(
            draft_parameters_with_unsaved_changes(&revision_parameters, &property_edit),
            Some(json!({
                "configuration": "Release",
                "runtime": "osx-x64",
                "properties": { "Version": "9.9.9" },
            }))
        );
    }
}
