use serde_json::Value;
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::Path;

mod recovery_snapshot;
pub(crate) use recovery_snapshot::sanitize_publish_recovery_snapshot;

pub(crate) const REDACTED_VALUE: &str = "<redacted>";
pub(crate) const LOCAL_PATH_VALUE: &str = "<local-path>";

pub(crate) fn normalize_key(key: &str) -> String {
    key.chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .map(|ch| ch.to_ascii_lowercase())
        .collect()
}

pub(crate) fn is_sensitive_key(key: &str) -> bool {
    let normalized = normalize_key(key);
    if normalized.is_empty() {
        return false;
    }
    if [
        "password",
        "passwd",
        "pwd",
        "token",
        "secret",
        "apikey",
        "accesskey",
        "clientsecret",
        "privatekey",
        "signingkey",
        "passphrase",
        "bearer",
    ]
    .iter()
    .any(|pattern| normalized.contains(pattern))
    {
        return true;
    }
    // 后缀泛化：`sshKey`/`deploy_key`/`encryptionKey`/`appKey`/`consumerKey`/
    // `basicAuth`/`proxyAuth`/`sessionCookie` 等复合命名都承载秘密材料，但不含
    // 上面的子串模式。用 ends_with 而非 contains，规避 `keyStore`/`keyAlias`/
    // `keyPair`/`keyPath`/`authorizationUrl`/`oauthMethod`/`cookieName` 等合法
    // 非秘密命名（`key`/`auth`/`cookie`/`authorization` 出现在词首或词中）。
    // `*publicKey`/`*pubkey` 同理按定义非秘密（updater 公钥随发布包分发），
    // 从 `*key` 后缀中豁免。
    normalized.ends_with("auth")
        || normalized.ends_with("cookie")
        || normalized.ends_with("authorization")
        || (normalized.ends_with("key")
            && !normalized.ends_with("publickey")
            && !normalized.ends_with("pubkey"))
}

fn is_path_like_key(key: &str) -> bool {
    let normalized = normalize_key(key);
    normalized.contains("path")
        || normalized.contains("directory")
        || normalized.contains("folder")
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
        || normalized == "publishprofile"
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
            | "warning"
            | "warnings"
            | "message"
            | "description"
            | "detail"
            | "signature"
            | "currentvalue"
            | "expectedvalue"
            | "content"
            | "summary"
            | "body"
            | "title"
            | "details"
            | "reason"
            | "note"
            | "hint"
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
            | "--manifest-path"
            | "--artifacts-path"
            | "--packages"
            | "--project-dir"
            | "--gradle-user-home"
            | "--build-file"
            | "--settings-file"
            | "--init-script"
            | "--include-build"
            | "--config"
            | "--out-dir"
            | "-p"
            | "-g"
            | "-b"
            | "-I"
            | "-C"
            | "-pkgdir"
            | "-modfile"
            | "-overlay"
    )
}

/// 空格分隔秘密旗标：`--password hunter2`、`--token abc`、curl `-u user:pass`。
/// 与路径旗标不同，秘密值没有形态特征——命中旗标后下一个 token 无条件遮蔽。
fn is_secret_switch(token: &str) -> bool {
    matches!(
        trim_token_wrappers(token).to_ascii_lowercase().as_str(),
        "--password"
            | "--passwd"
            | "--pwd"
            | "--token"
            | "--api-key"
            | "--apikey"
            | "--secret"
            | "--client-secret"
            | "--access-key"
            | "--private-key"
            | "--signing-key"
            | "--passphrase"
            | "--credential"
            | "--credentials"
            | "--auth"
            | "--authorization"
            | "--bearer"
            | "--bearer-token"
            | "--session-token"
            | "--session-key"
            | "--encryption-key"
            | "--license-key"
            | "--sas-token"
            | "--connection-string"
            | "-u"
    )
}

/// `Authorization:` 形态的 HTTP 头名——头值（或 scheme 词之后的令牌）是秘密。
fn is_secret_header(token: &str) -> bool {
    let Some(name) = token.strip_suffix(':') else {
        return false;
    };
    let normalized: String = name
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .map(|ch| ch.to_ascii_lowercase())
        .collect();
    matches!(
        normalized.as_str(),
        "authorization"
            | "proxyauthorization"
            | "proxyauthenticate"
            | "wwwauthenticate"
            | "xapikey"
            | "xauthtoken"
            | "xtoken"
            | "xaccesstoken"
            | "cookie"
            | "setcookie"
    )
}

/// `Authorization: Bearer <token>` 的 scheme 词——放行以保留可读性，只遮蔽其后的令牌。
fn is_auth_scheme_word(token: &str) -> bool {
    matches!(
        token.to_ascii_lowercase().as_str(),
        "bearer" | "basic" | "digest" | "token" | "negotiate" | "oauth" | "mutual" | "hoba"
    )
}

fn sanitize_secret_assignment_token(token: &str) -> Option<String> {
    let stripped = trim_token_wrappers(token);
    let (left, _) = stripped.split_once('=')?;
    let assignment_key = left.rsplit_once(':').map(|(_, tail)| tail).unwrap_or(left);

    if is_sensitive_key(assignment_key) {
        return Some(format!("{left}={REDACTED_VALUE}"));
    }

    None
}

pub(crate) fn sanitize_assignment_token(token: &str) -> Option<String> {
    if let Some(redacted) = sanitize_secret_assignment_token(token) {
        return Some(redacted);
    }

    let stripped = trim_token_wrappers(token);
    let (left, value) = stripped.split_once('=')?;
    let assignment_key = left.rsplit_once(':').map(|(_, tail)| tail).unwrap_or(left);

    if (is_path_like_key(assignment_key) || is_path_switch(left)) && looks_like_absolute_path(value)
    {
        return Some(format!("{left}={LOCAL_PATH_VALUE}"));
    }

    None
}

/// pending_secret：0=无；1=下一个 token 是秘密值；2=下一个 token 可能是
/// auth-scheme 词（放行后转为 1），否则直接是秘密值。
#[derive(Default)]
struct FreeformMaskState {
    pending_path_value: bool,
    pending_secret: u8,
}

fn consume_secret_token(stripped: &str, original: &str, pending_secret: &mut u8) -> String {
    let allow_scheme = *pending_secret == 2;
    *pending_secret = 0;
    if allow_scheme && is_auth_scheme_word(stripped) {
        *pending_secret = 1;
        return original.to_string();
    }
    REDACTED_VALUE.to_string()
}

fn sanitize_text_token(token: &str, state: &mut FreeformMaskState) -> String {
    let stripped = trim_token_wrappers(token);
    if stripped.is_empty() {
        return token.to_string();
    }

    if state.pending_secret != 0 {
        return consume_secret_token(stripped, token, &mut state.pending_secret);
    }

    if state.pending_path_value {
        state.pending_path_value = false;
        if looks_like_absolute_path(stripped) {
            return LOCAL_PATH_VALUE.to_string();
        }
    }

    if is_path_switch(stripped) {
        state.pending_path_value = true;
        return token.to_string();
    }

    if is_secret_header(stripped) {
        state.pending_secret = 2;
        return token.to_string();
    }

    if is_secret_switch(stripped) {
        state.pending_secret = 1;
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
    let mut state = FreeformMaskState::default();

    for ch in text.chars() {
        if ch.is_whitespace() {
            if !token.is_empty() {
                output.push_str(&sanitize_text_token(&token, &mut state));
                token.clear();
            }
            output.push(ch);
        } else {
            token.push(ch);
        }
    }

    if !token.is_empty() {
        output.push_str(&sanitize_text_token(&token, &mut state));
    }

    output
}

/// 持久化路径专用：只遮蔽密钥类赋值（`-p:ApiToken=x`、`token=x`），
/// 不做任何路径替换（历史记录重跑依赖路径原值）。
pub(crate) fn sanitize_secrets_in_text(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut token = String::new();
    let mut pending_secret = 0u8;

    for ch in text.chars() {
        if ch.is_whitespace() {
            if !token.is_empty() {
                output.push_str(&sanitize_secret_text_token(&token, &mut pending_secret));
                token.clear();
            }
            output.push(ch);
        } else {
            token.push(ch);
        }
    }

    if !token.is_empty() {
        output.push_str(&sanitize_secret_text_token(&token, &mut pending_secret));
    }

    output
}

/// 持久化变体的 token 处理：只遮蔽秘密（赋值形 + 空格旗标 + HTTP 头形），
/// 不做路径替换——历史记录重跑依赖路径原值。
fn sanitize_secret_text_token(token: &str, pending_secret: &mut u8) -> String {
    let stripped = trim_token_wrappers(token);

    if *pending_secret != 0 {
        return consume_secret_token(stripped, token, pending_secret);
    }
    if is_secret_header(stripped) {
        *pending_secret = 2;
        return token.to_string();
    }
    if is_secret_switch(stripped) {
        *pending_secret = 1;
        return token.to_string();
    }
    sanitize_secret_assignment_token(stripped).unwrap_or_else(|| token.to_string())
}

fn sanitize_json_value(value: &mut Value, key_hint: Option<&str>, mask_paths: bool) {
    match value {
        Value::String(text) => {
            if let Some(key) = key_hint {
                if is_sensitive_key(key) {
                    *text = REDACTED_VALUE.to_string();
                    return;
                }

                if mask_paths && is_path_like_key(key) && looks_like_absolute_path(text) {
                    *text = LOCAL_PATH_VALUE.to_string();
                    return;
                }

                if is_freeform_text_key(key) {
                    *text = if mask_paths {
                        sanitize_freeform_text(text)
                    } else {
                        sanitize_secrets_in_text(text)
                    };
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                sanitize_json_value(item, key_hint, mask_paths);
            }
        }
        Value::Object(map) => {
            for (key, item) in map {
                if is_sensitive_key(key) {
                    *item = Value::String(REDACTED_VALUE.to_string());
                    continue;
                }
                sanitize_json_value(item, Some(key), mask_paths);
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) => {}
    }
}

pub(crate) fn sanitize_export_value(value: &mut Value) {
    sanitize_json_value(value, None, true);
}

fn sanitize_json_map_with(map: &mut BTreeMap<String, Value>, mask_paths: bool) {
    for (key, value) in map {
        if is_sensitive_key(key) {
            *value = Value::String(REDACTED_VALUE.to_string());
            continue;
        }
        sanitize_json_value(value, Some(key), mask_paths);
    }
}

pub(crate) fn sanitize_json_map(map: &mut BTreeMap<String, Value>) {
    sanitize_json_map_with(map, true);
}

/// 本地证据持久化（journal）专用：密钥照遮、路径原样保留——续跑/同步回读的
/// 错误诊断依赖真实路径。路径遮蔽只发生在导出边界 `sanitize_export_value`，
/// 与执行历史存储的口径一致（参见 `sanitize_secrets_in_text`）。
pub(crate) fn sanitize_evidence_json_map(map: &mut BTreeMap<String, Value>) {
    sanitize_json_map_with(map, false);
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

pub(crate) fn write_private_binary_file(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = open_private_file(path, false, true)?;
    file.write_all(bytes)?;
    file.flush()?;
    file.sync_all()?;
    drop(file);
    harden_private_path(path)
}

/// 仓库/项目元数据文件的上限：`.sln`、`packed-refs` 等在巨型仓库可达数 MB，
/// 32MB 保留充足余量同时阻断病态 GB 级文件的整体载入。
pub(crate) const MAX_REPO_FILE_BYTES: u64 = 32 * 1024 * 1024;

/// 有界文本读取：文件对话框/仓库/`.git` 路径指向的文件可能异常巨大，
/// 无界 `read_to_string` 会把整个文件载入内存直到 OOM。`take` 至多读取
/// `max_bytes + 1` 字节（竞态安全：文件在读取期间增长也不越过上限），
/// 超限返回 InvalidData；大小检查先于 UTF-8 解码，超限文件报大小而非编码。
pub(crate) fn read_text_file_bounded(path: &Path, max_bytes: u64) -> io::Result<String> {
    use std::io::Read;
    let file = File::open(path)?;
    let mut limited = file.take(max_bytes.saturating_add(1));
    let mut bytes = Vec::new();
    limited.read_to_end(&mut bytes)?;
    if bytes.len() as u64 > max_bytes {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("file exceeds the {max_bytes} byte limit"),
        ));
    }
    String::from_utf8(bytes).map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

#[cfg(test)]
mod tests {
    use super::{
        is_path_like_key, is_sensitive_key, read_text_file_bounded, sanitize_evidence_json_map,
        sanitize_export_value, sanitize_freeform_text, sanitize_secrets_in_text,
    };
    use serde_json::json;
    use std::collections::BTreeMap;

    #[test]
    fn bounded_read_returns_small_files_verbatim() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("small.txt");
        std::fs::write(&path, "hello bounded read").expect("write");
        assert_eq!(
            read_text_file_bounded(&path, 1024).expect("read"),
            "hello bounded read"
        );
    }

    #[test]
    fn bounded_read_accepts_file_at_exact_limit() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("exact.txt");
        std::fs::write(&path, "x".repeat(64)).expect("write");
        assert_eq!(read_text_file_bounded(&path, 64).expect("read").len(), 64);
    }

    #[test]
    fn bounded_read_rejects_oversized_file_with_invalid_data() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("big.txt");
        std::fs::write(&path, "x".repeat(128)).expect("write");
        let error = read_text_file_bounded(&path, 64).expect_err("must reject");
        assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
    }

    #[test]
    fn bounded_read_rejects_invalid_utf8() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("binary.bin");
        std::fs::write(&path, [0xff, 0xfe, 0xfd]).expect("write");
        let error = read_text_file_bounded(&path, 1024).expect_err("must reject");
        assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
    }

    #[test]
    fn sensitive_key_matches_secret_value_names_across_casing() {
        for key in [
            "password",
            "apiToken",
            "client_secret",
            "privateKey",
            "signingKey",
            "signing_key",
            "sshPassphrase",
            "KEY_PASSPHRASE",
            // 复合后缀：枚举子串模式覆盖不到的密钥材料命名。
            "sshKey",
            "deploy_key",
            "encryptionKey",
            "license_key",
            "appKey",
            "consumerKey",
            "masterKey",
            "pgp_key",
            "basicAuth",
            "proxy_auth",
            "sessionCookie",
            "auth_cookie",
            "bearer",
            "Authorization",
        ] {
            assert!(is_sensitive_key(key), "{key} should be sensitive");
        }
        for key in [
            "output",
            "projectFile",
            "credentialId",
            "authorizationUrl",
            "keyStore",
            "keyAlias",
            "keyPair",
            "keyPath",
            "oauthMethod",
            "cookieName",
            // 公钥材料按定义非秘密（随发布包分发），不进 mask/block 链。
            "publicKey",
            "ssh_public_key",
            "pubkey",
            "updaterPubKey",
        ] {
            assert!(!is_sensitive_key(key), "{key} should stay readable");
        }
    }

    #[test]
    fn path_like_key_covers_directory_and_folder_suffixes() {
        for key in [
            "projectPath",
            "outputDir",
            "resolvedOutputDirectory",
            "delivery_directory",
            "workingDirectory",
            "packageFolders",
            "workFolder",
        ] {
            assert!(is_path_like_key(key), "{key} should be path-like");
        }
        for key in ["retryCount", "verbosity", "configuration"] {
            assert!(!is_path_like_key(key), "{key} should stay readable");
        }
    }

    #[test]
    fn freeform_text_masks_provider_cli_path_flags() {
        // 各 provider CLI 的路径旗标（值形态过 looks_like_absolute_path 双门）
        let text = concat!(
            "cargo build --manifest-path /Users/demo/app/Cargo.toml ",
            "&& dotnet build --artifacts-path /tmp/artifacts ",
            "&& gradle build -p /Users/demo/gradle-app ",
            "&& go build -pkgdir /tmp/gopkg",
        );
        let sanitized = sanitize_freeform_text(text);
        for original in [
            "/Users/demo/app/Cargo.toml",
            "/tmp/artifacts",
            "/Users/demo/gradle-app",
            "/tmp/gopkg",
        ] {
            assert!(!sanitized.contains(original), "{original} leaked");
        }
        assert_eq!(sanitize_freeform_text(&sanitized), sanitized);
    }

    #[test]
    fn freeform_text_masks_space_separated_secret_flags() {
        let text = "curl --token hunter2 --password p@ss -u user:pass https://api.example.com";
        let sanitized = sanitize_freeform_text(text);
        assert!(!sanitized.contains("hunter2"));
        assert!(!sanitized.contains("p@ss"));
        assert!(!sanitized.contains("user:pass"));
        assert!(sanitized.contains("https://api.example.com"));
        assert_eq!(sanitize_freeform_text(&sanitized), sanitized);
    }

    #[test]
    fn freeform_text_masks_authorization_header_values() {
        let text = "header Authorization: Bearer abc123.def X-Api-Key: k3y Cookie: sid=xyz";
        let sanitized = sanitize_freeform_text(text);
        assert!(sanitized.contains("Authorization: Bearer <redacted>"));
        assert!(sanitized.contains("X-Api-Key: <redacted>"));
        assert!(sanitized.contains("Cookie: <redacted>"));
        assert!(!sanitized.contains("abc123.def"));
        assert!(!sanitized.contains("k3y"));
        assert!(!sanitized.contains("sid=xyz"));
    }

    #[test]
    fn secrets_in_text_masks_space_form_but_preserves_paths() {
        // 持久化变体：秘密遮蔽与 freeform 一致，但路径必须原样保留
        let text = "tool --api-key hunter2 --output /tmp/out -p:Password=p@ss";
        let sanitized = sanitize_secrets_in_text(text);
        assert!(sanitized.contains("--api-key <redacted>"));
        assert!(sanitized.contains("-p:Password=<redacted>"));
        assert!(!sanitized.contains("hunter2"));
        assert!(!sanitized.contains("p@ss"));
        assert!(sanitized.contains("/tmp/out"));
        assert!(sanitized.contains("--output"));
    }

    #[test]
    fn freeform_text_masks_publish_profile_assignment_path() {
        // -p:PublishProfile= 赋值形的项目配置路径
        let text = "dotnet publish -p:PublishProfile=/Users/demo/FolderProfile.pubxml";
        let sanitized = sanitize_freeform_text(text);
        assert!(!sanitized.contains("/Users/demo/FolderProfile.pubxml"));
    }

    #[test]
    fn secrets_in_text_redacts_assignments_but_preserves_paths() {
        let text = "$ dotnet publish -p:ApiToken=abc123 --output /tmp/out";
        let sanitized = sanitize_secrets_in_text(text);
        assert!(sanitized.contains("-p:ApiToken=<redacted>"));
        assert!(!sanitized.contains("abc123"));
        assert!(sanitized.contains("--output"));
        assert!(sanitized.contains("/tmp/out"));
        assert!(!sanitized.contains("<local-path>"));
        assert_eq!(sanitize_secrets_in_text(&sanitized), sanitized);
    }

    #[test]
    fn secrets_in_text_redacts_plain_assignment_and_keeps_path_assignments() {
        let text = "dotnet publish --output=/tmp/out token=hunter2";
        let sanitized = sanitize_secrets_in_text(text);
        assert!(sanitized.contains("token=<redacted>"));
        assert!(!sanitized.contains("hunter2"));
        assert!(sanitized.contains("--output=/tmp/out"));
    }

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
            "error": "I/O operation inspect provider output /Users/demo/project/bin/Release/publish failed",
            "warnings": ["output written to /Users/demo/project/bin/Release/publish"],
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
        // 本地界面保留真实路径，导出时错误与警告中的本机路径必须遮蔽。
        assert_eq!(
            payload["error"],
            "I/O operation inspect provider output <local-path> failed"
        );
        assert_eq!(payload["warnings"][0], "output written to <local-path>");
    }

    #[test]
    fn evidence_map_keeps_paths_and_redacts_secrets() {
        // journal 持久化口径：路径原值保留（续跑/同步回读要靠它定位现场），
        // 密钥类键与自由文本中的 key=value 密钥赋值仍遮蔽。
        let mut payload = BTreeMap::from([
            (
                "error".to_string(),
                json!("publish /Users/demo/App.csproj failed -p:ApiToken=hunter2"),
            ),
            ("outputDir".to_string(), json!("/Users/demo/bin/publish")),
            ("apiToken".to_string(), json!("very-secret")),
            (
                "nested".to_string(),
                json!({ "clientSecret": "s3cr3t", "log": "wrote /Users/demo/out" }),
            ),
        ]);

        sanitize_evidence_json_map(&mut payload);

        assert_eq!(payload["apiToken"], "<redacted>");
        assert_eq!(payload["nested"]["clientSecret"], "<redacted>");
        assert_eq!(payload["outputDir"], "/Users/demo/bin/publish");
        let error = payload["error"].as_str().expect("error text");
        assert!(error.contains("/Users/demo/App.csproj"), "{error}");
        assert!(error.contains("-p:ApiToken=<redacted>"), "{error}");
        assert!(!error.contains("hunter2"), "{error}");
        assert!(!error.contains("<local-path>"), "{error}");
        assert_eq!(payload["nested"]["log"], "wrote /Users/demo/out");
    }
}
