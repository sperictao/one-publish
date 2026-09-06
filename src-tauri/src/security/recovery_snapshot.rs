use super::{is_sensitive_key, REDACTED_VALUE};
use serde_json::Value;

/// Keeps executable paths intact while removing secret values from recovery data.
/// Credential references are exempt only at their contract-defined locations.
pub(crate) fn sanitize_publish_recovery_snapshot(snapshot: &mut Value) -> bool {
    let tauri = snapshot.pointer("/content/providerId").and_then(Value::as_str) == Some("tauri");
    let mut incomplete = snapshot.get("redacted").and_then(Value::as_bool) == Some(true);
    incomplete |= sanitize_value(snapshot, &mut Vec::new(), tauri);
    if incomplete {
        if let Some(object) = snapshot.as_object_mut() {
            object.insert("redacted".to_string(), Value::Bool(true));
        }
    }
    incomplete
}

fn contains_redaction(value: &Value) -> bool {
    match value {
        Value::String(text) => text.contains(REDACTED_VALUE),
        Value::Array(items) => items.iter().any(contains_redaction),
        Value::Object(object) => object.values().any(contains_redaction),
        _ => false,
    }
}

fn is_reference_location(path: &[String], value: &Value, tauri: bool) -> bool {
    let path = path.iter().map(String::as_str).collect::<Vec<_>>();
    let credential_binding = matches!(
        path.as_slice(),
        ["content", "composition", "executionBackend" | "artifactStore", "credentials"]
            | ["content", "composition", "artifactProcessors", "[]", "credentials"]
            | ["content", "composition", "deliveryRoutes", "[]", "destination", "credentials"]
    );
    if credential_binding {
        return value
            .as_object()
            .is_some_and(|map| map.values().all(Value::is_string));
    }
    if !tauri {
        return false;
    }
    let release_path = match path.as_slice() {
        ["content", "parameters", "releaseSettings", rest @ ..]
        | ["executedParameters", "releaseSettings", rest @ ..] => rest,
        _ => return false,
    };
    let valid_name = |value: &Value| {
        value
            .as_str()
            .is_some_and(crate::tauri_release::validate_secret_name)
    };
    match release_path {
        ["updater", "privateKeySecretName"] => value.is_null() || valid_name(value),
        ["requiredActionsSecretNames"] => value
            .as_array()
            .is_some_and(|names| names.iter().all(valid_name)),
        ["actionsSecretEnvironment"] => value.as_object().is_some_and(|names| {
            names.iter().all(|(environment, reference)| {
                crate::tauri_release::validate_secret_name(environment) && valid_name(reference)
            })
        }),
        _ => false,
    }
}

fn sanitize_value(value: &mut Value, path: &mut Vec<String>, tauri: bool) -> bool {
    if is_reference_location(path, value, tauri) {
        return contains_redaction(value);
    }
    if path.last().is_some_and(|key| is_sensitive_key(key)) {
        *value = Value::String(REDACTED_VALUE.to_string());
        return true;
    }
    match value {
        Value::Object(object) => {
            let mut incomplete = false;
            for (key, item) in object {
                path.push(key.clone());
                incomplete |= sanitize_value(item, path, tauri);
                path.pop();
            }
            incomplete
        }
        Value::Array(items) => {
            path.push("[]".to_string());
            let mut incomplete = false;
            for item in items {
                incomplete |= sanitize_value(item, path, tauri);
            }
            path.pop();
            incomplete
        }
        _ => contains_redaction(value),
    }
}

#[cfg(test)]
mod tests {
    use super::sanitize_publish_recovery_snapshot;
    use serde_json::json;

    #[test]
    fn recovery_redacts_nested_parameters_and_adapter_settings_but_preserves_paths() {
        let mut snapshot = json!({
            "content": {
                "providerId": "dotnet",
                "parameters": { "output": "/tmp/out", "properties": { "Password": "secret-a" } },
                "composition": {
                    "executionBackend": { "settings": { "apiToken": "secret-b" } },
                    "artifactStore": { "settings": { "nested": [{ "Password": "secret-c" }] } },
                    "artifactProcessors": [{ "settings": { "apiKey": "secret-d" } }],
                    "deliveryRoutes": [{ "destination": { "settings": { "token": "secret-e" } } }]
                }
            },
            "executedParameters": { "properties": { "apiToken": "secret-f" }, "output": "/tmp/out" },
            "resolvedOutputDirectory": "/tmp/out"
        });
        assert!(sanitize_publish_recovery_snapshot(&mut snapshot));
        assert_eq!(snapshot["redacted"], true);
        assert_eq!(snapshot["content"]["parameters"]["properties"]["Password"], "<redacted>");
        assert_eq!(snapshot["executedParameters"]["properties"]["apiToken"], "<redacted>");
        assert!(!snapshot.to_string().contains("secret-"));
        assert_eq!(snapshot["content"]["parameters"]["output"], "/tmp/out");
        assert_eq!(snapshot["executedParameters"]["output"], "/tmp/out");
        assert_eq!(snapshot["resolvedOutputDirectory"], "/tmp/out");
        let first = snapshot.clone();
        assert!(sanitize_publish_recovery_snapshot(&mut snapshot));
        assert_eq!(snapshot, first);
    }

    #[test]
    fn recovery_preserves_only_contract_defined_credential_references() {
        let binding = json!({
            "settings": { "path": "/tmp/artifacts" },
            "credentials": { "apiToken": "keychain://publishing", "password": "vault:release" }
        });
        let mut snapshot = json!({
            "content": {
                "providerId": "tauri",
                "parameters": { "releaseSettings": {
                    "updater": { "privateKeySecretName": "TAURI_SIGNING_PRIVATE_KEY" },
                    "requiredActionsSecretNames": ["APPLE_CERTIFICATE"],
                    "actionsSecretEnvironment": { "SIGNING_PASSWORD": "APPLE_PASSWORD" }
                } },
                "composition": {
                    "executionBackend": binding,
                    "artifactStore": binding,
                    "artifactProcessors": [binding],
                    "deliveryRoutes": [{ "destination": binding }]
                }
            },
            "executedParameters": { "output": "/tmp/out" }
        });
        let original = snapshot.clone();
        assert!(!sanitize_publish_recovery_snapshot(&mut snapshot));
        assert_eq!(snapshot, original);

        snapshot["content"]["parameters"]["properties"] = json!({
            "secretName": "looks-like-reference-but-is-secret",
            "credentials": { "token": "nested-secret" },
            "releaseSettings": { "updater": { "privateKeySecretName": "NOT_A_REFERENCE_HERE" } }
        });
        snapshot["content"]["parameters"]["releaseSettings"]["updater"]["privateKeySecretName"] =
            json!("ghp_actualSecretValue");
        assert!(sanitize_publish_recovery_snapshot(&mut snapshot));
        let serialized = snapshot.to_string();
        for secret in ["looks-like-reference-but-is-secret", "nested-secret", "NOT_A_REFERENCE_HERE", "ghp_actualSecretValue"] {
            assert!(!serialized.contains(secret));
        }
    }

    #[test]
    fn recovery_rejects_existing_redaction_markers_including_reference_values() {
        for mut snapshot in [
            json!({ "redacted": true }),
            json!({ "content": { "parameters": { "value": "<redacted>" } } }),
            json!({ "content": { "composition": { "executionBackend": { "credentials": { "token": "<redacted>" } } } } }),
        ] {
            assert!(sanitize_publish_recovery_snapshot(&mut snapshot));
            assert_eq!(snapshot["redacted"], true);
            let first = snapshot.clone();
            assert!(sanitize_publish_recovery_snapshot(&mut snapshot));
            assert_eq!(snapshot, first);
        }
    }
}
