use serde_json::Value;
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::Path;

pub(crate) const REDACTED_VALUE: &str = "<redacted>";
pub(crate) const LOCAL_PATH_VALUE: &str = "<local-path>";

fn normalize_key(key: &str) -> String {
    key.chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .map(|ch| ch.to_ascii_lowercase())
        .collect()
}

fn is_sensitive_key(key: &str) -> bool {
    let normalized = normalize_key(key);
    [
        "password",
        "passwd",
        "pwd",
        "token",
        "secret",
        "apikey",
        "accesskey",
        "clientsecret",
        "privatekey",
    ]
    .iter()
    .any(|pattern| normalized.contains(pattern))
}

fn is_path_like_key(key: &str) -> bool {
    let normalized = normalize_key(key);
    normalized.contains("path")
        || normalized.ends_with("dir")
        || normalized == "output"
        || normalized == "outputdir"
        || normalized == "targetdir"
        || normalized == "projectfile"
        || normalized == "projectpath"
        || normalized == "snapshotpath"
        || normalized == "filepath"
        || normalized == "docspath"
        || normalized == "templatepath"
}

fn is_freeform_text_key(key: &str) -> bool {
    matches!(
        normalize_key(key).as_str(),
        "commandline"
            | "line"
            | "log"
            | "stdout"
            | "stderr"
            | "error"
            | "message"
            | "description"
            | "detail"
            | "signature"
            | "currentvalue"
            | "expectedvalue"
    )
}

fn trim_token_wrappers(token: &str) -> &str {
    token.trim_matches(|ch| {
        matches!(
            ch,
            '"' | '\'' | '`' | ',' | ';' | '(' | ')' | '[' | ']' | '{' | '}'
        )
    })
}

fn looks_like_windows_drive_path(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
}

fn looks_like_absolute_path(value: &str) -> bool {
    let trimmed = trim_token_wrappers(value);
    !trimmed.is_empty()
        && (Path::new(trimmed).is_absolute()
            || looks_like_windows_drive_path(trimmed)
            || trimmed.starts_with("~/")
            || trimmed.starts_with("$HOME/")
            || trimmed.starts_with("${HOME}/")
            || trimmed.starts_with("\\\\"))
}

fn is_path_switch(token: &str) -> bool {
    matches!(
        trim_token_wrappers(token),
        "-o" | "--output"
            | "--output-dir"
            | "--target-dir"
            | "--project"
            | "--project-file"
            | "--file"
            | "--path"
            | "--snapshot"
            | "--snapshot-path"
    )
}

fn sanitize_assignment_token(token: &str) -> Option<String> {
    let stripped = trim_token_wrappers(token);
    let (left, value) = stripped.split_once('=')?;
    let assignment_key = left.rsplit_once(':').map(|(_, tail)| tail).unwrap_or(left);

    if is_sensitive_key(assignment_key) {
        return Some(format!("{left}={REDACTED_VALUE}"));
    }

    if (is_path_like_key(assignment_key) || is_path_switch(left)) && looks_like_absolute_path(value)
    {
        return Some(format!("{left}={LOCAL_PATH_VALUE}"));
    }

    None
}

fn sanitize_text_token(token: &str, pending_path_value: &mut bool) -> String {
    let stripped = trim_token_wrappers(token);
    if stripped.is_empty() {
        return token.to_string();
    }

    if *pending_path_value {
        *pending_path_value = false;
        if looks_like_absolute_path(stripped) {
            return LOCAL_PATH_VALUE.to_string();
        }
    }

    if is_path_switch(stripped) {
        *pending_path_value = true;
        return token.to_string();
    }

    if let Some(redacted) = sanitize_assignment_token(stripped) {
        return redacted;
    }

    if looks_like_absolute_path(stripped) {
        return LOCAL_PATH_VALUE.to_string();
    }

    token.to_string()
}

pub(crate) fn sanitize_freeform_text(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut token = String::new();
    let mut pending_path_value = false;

    for ch in text.chars() {
        if ch.is_whitespace() {
            if !token.is_empty() {
                output.push_str(&sanitize_text_token(&token, &mut pending_path_value));
                token.clear();
            }
            output.push(ch);
        } else {
            token.push(ch);
        }
    }

    if !token.is_empty() {
        output.push_str(&sanitize_text_token(&token, &mut pending_path_value));
    }

    output
}

fn sanitize_json_value(value: &mut Value, key_hint: Option<&str>) {
    match value {
        Value::String(text) => {
            if let Some(key) = key_hint {
                if is_sensitive_key(key) {
                    *text = REDACTED_VALUE.to_string();
                    return;
                }

                if is_path_like_key(key) && looks_like_absolute_path(text) {
                    *text = LOCAL_PATH_VALUE.to_string();
                    return;
                }

                if is_freeform_text_key(key) {
                    *text = sanitize_freeform_text(text);
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                sanitize_json_value(item, key_hint);
            }
        }
        Value::Object(map) => {
            for (key, item) in map {
                if is_sensitive_key(key) {
                    *item = Value::String(REDACTED_VALUE.to_string());
                    continue;
                }
                sanitize_json_value(item, Some(key));
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) => {}
    }
}

pub(crate) fn sanitize_export_value(value: &mut Value) {
    sanitize_json_value(value, None);
}

pub(crate) fn sanitize_json_map(map: &mut BTreeMap<String, Value>) {
    for (key, value) in map {
        if is_sensitive_key(key) {
            *value = Value::String(REDACTED_VALUE.to_string());
            continue;
        }
        sanitize_json_value(value, Some(key));
    }
}

#[cfg(unix)]
fn set_owner_only_permissions(path: &Path, is_dir: bool) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    let mode = if is_dir { 0o700 } else { 0o600 };
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
}

#[cfg(not(unix))]
fn set_owner_only_permissions(_path: &Path, _is_dir: bool) -> io::Result<()> {
    Ok(())
}

#[cfg(unix)]
fn set_owner_only_file_permissions(file: &File) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    file.set_permissions(fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn set_owner_only_file_permissions(_file: &File) -> io::Result<()> {
    Ok(())
}

pub(crate) fn ensure_private_parent_dir(path: &Path) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
        set_owner_only_permissions(parent, true)?;
    }
    Ok(())
}

#[cfg(unix)]
fn configure_private_file_options(options: &mut OpenOptions) {
    use std::os::unix::fs::OpenOptionsExt;

    options.mode(0o600);
}

#[cfg(not(unix))]
fn configure_private_file_options(_options: &mut OpenOptions) {}

pub(crate) fn open_private_file(path: &Path, create_new: bool, truncate: bool) -> io::Result<File> {
    ensure_private_parent_dir(path)?;

    let mut options = OpenOptions::new();
    options.write(true);
    if create_new {
        options.create_new(true);
    } else {
        options.create(true);
    }
    if truncate {
        options.truncate(true);
    }
    configure_private_file_options(&mut options);

    let file = options.open(path)?;
    set_owner_only_file_permissions(&file)?;
    Ok(file)
}

pub(crate) fn harden_private_path(path: &Path) -> io::Result<()> {
    let metadata = fs::metadata(path)?;
    set_owner_only_permissions(path, metadata.is_dir())
}

pub(crate) fn write_private_text_file(path: &Path, content: &str) -> io::Result<()> {
    let mut file = open_private_file(path, false, true)?;
    file.write_all(content.as_bytes())?;
    file.flush()?;
    file.sync_all()?;
    drop(file);
    harden_private_path(path)
}

#[cfg(test)]
mod tests {
    use super::{sanitize_export_value, sanitize_freeform_text};
    use serde_json::json;

    #[test]
    fn freeform_text_redacts_paths_and_sensitive_assignments() {
        let text =
            r#"$ dotnet publish /Users/demo/App.csproj --output /tmp/out -p:ApiToken=abc123"#;
        let sanitized = sanitize_freeform_text(text);
        assert!(sanitized.contains("<local-path>"));
        assert!(sanitized.contains("-p:ApiToken=<redacted>"));
        assert!(!sanitized.contains("abc123"));
    }

    #[test]
    fn export_payload_redacts_nested_sensitive_values() {
        let mut payload = json!({
            "projectPath": "/Users/demo/project/App.csproj",
            "commandLine": "$ dotnet publish /Users/demo/project/App.csproj -p:Password=hunter2",
            "spec": {
                "project_path": "/Users/demo/project/App.csproj",
                "parameters": {
                    "output": "/tmp/publish",
                    "properties": {
                        "PublishProfile": "FolderProfile",
                        "ClientSecret": "super-secret"
                    }
                }
            }
        });

        sanitize_export_value(&mut payload);

        assert_eq!(payload["projectPath"], "<local-path>");
        assert_eq!(payload["spec"]["project_path"], "<local-path>");
        assert_eq!(payload["spec"]["parameters"]["output"], "<local-path>");
        assert_eq!(
            payload["spec"]["parameters"]["properties"]["ClientSecret"],
            "<redacted>"
        );
        assert!(payload["commandLine"]
            .as_str()
            .expect("command line")
            .contains("<redacted>"));
    }
}
