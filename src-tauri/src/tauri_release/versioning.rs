use super::{TauriReleaseConfig, TauriVersionSource, TauriVersionSourceKind, VersionMirrorKind};
use crate::errors::AppError;
use regex::Regex;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub(crate) struct FileMutation {
    pub relative_path: String,
    path: PathBuf,
    original: Option<Vec<u8>>,
    applied: Vec<u8>,
}

fn version_error(message: impl Into<String>, code: impl Into<String>) -> AppError {
    AppError::validation_with_code(message, code)
}

fn read_text(path: &Path) -> Result<String, AppError> {
    std::fs::read_to_string(path).map_err(|error| {
        AppError::repository_with_code(
            format!("failed to read version file {}: {error}", path.display()),
            "tauri_release_version_file_read_failed",
        )
    })
}

fn replace_json_version(content: &str, old: &str, new: &str) -> Result<String, AppError> {
    let expression = Regex::new(&format!(
        r#"(?m)([\"']?version[\"']?\s*:\s*[\"']){}([\"'])"#,
        regex::escape(old)
    ))
    .expect("valid version regex");
    let matches = expression.find_iter(content).count();
    if matches != 1 {
        return Err(version_error(
            format!("expected one JSON version field matching {old}, found {matches}"),
            "tauri_release_version_mismatch",
        ));
    }
    Ok(expression
        .replace(content, format!("${{1}}{new}${{2}}"))
        .into_owned())
}

fn replace_toml_key(
    content: &str,
    section: Option<&str>,
    key: &str,
    old: &str,
    new: &str,
) -> Result<String, AppError> {
    let mut current_section: Option<&str> = None;
    let mut replacements = 0usize;
    let mut lines = Vec::new();
    for line in content.split_inclusive('\n') {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            current_section = trimmed
                .strip_prefix('[')
                .and_then(|value| value.strip_suffix(']'));
        }
        let section_matches = match section {
            Some(value) => Some(value) == current_section,
            None => current_section.is_none(),
        };
        if section_matches {
            let expression = Regex::new(&format!(
                r#"^(\s*{}\s*=\s*[\"']){}([\"'].*)$"#,
                regex::escape(key),
                regex::escape(old)
            ))
            .expect("valid TOML key regex");
            if expression.is_match(line.trim_end_matches('\n')) {
                let newline = if line.ends_with('\n') { "\n" } else { "" };
                let replaced =
                    expression.replace(line.trim_end_matches('\n'), format!("${{1}}{new}${{2}}"));
                lines.push(format!("{replaced}{newline}"));
                replacements += 1;
                continue;
            }
        }
        lines.push(line.to_string());
    }
    if replacements != 1 {
        return Err(version_error(
            format!(
                "expected one TOML {} version matching {old}, found {replacements}",
                section.unwrap_or("root")
            ),
            "tauri_release_version_mismatch",
        ));
    }
    Ok(lines.concat())
}

fn replace_cargo_lock_package(
    content: &str,
    package: &str,
    old: &str,
    new: &str,
) -> Result<String, AppError> {
    let blocks = content.split("[[package]]").collect::<Vec<_>>();
    let mut replacements = 0usize;
    let mut output = String::new();
    output.push_str(blocks[0]);
    for block in blocks.iter().skip(1) {
        output.push_str("[[package]]");
        let name_line = Regex::new(&format!(
            r#"(?m)^name\s*=\s*[\"']{}[\"']\s*$"#,
            regex::escape(package)
        ))
        .expect("valid package regex");
        if name_line.is_match(block) {
            output.push_str(&replace_toml_key(block, None, "version", old, new)?);
            replacements += 1;
        } else {
            output.push_str(block);
        }
    }
    if replacements != 1 {
        return Err(version_error(
            format!("expected one Cargo.lock package '{package}', found {replacements}"),
            "tauri_release_version_mismatch",
        ));
    }
    Ok(output)
}

fn updated_source_content(
    path: &Path,
    source: &TauriVersionSource,
    old: &str,
    new: &str,
) -> Result<String, AppError> {
    let content = read_text(path)?;
    match source.kind {
        TauriVersionSourceKind::TauriConfig => {
            if path.file_name().and_then(|name| name.to_str()) == Some("Tauri.toml") {
                replace_toml_key(&content, None, "version", old, new)
            } else {
                replace_json_version(&content, old, new)
            }
        }
        TauriVersionSourceKind::ReferencedPackageJson => replace_json_version(&content, old, new),
        TauriVersionSourceKind::CargoToml => {
            replace_toml_key(&content, Some("package"), "version", old, new)
        }
    }
}

fn updated_mirror_content(
    path: &Path,
    kind: VersionMirrorKind,
    selector: &str,
    old: &str,
    new: &str,
) -> Result<String, AppError> {
    let content = read_text(path)?;
    match kind {
        VersionMirrorKind::JsonPointer if selector == "/version" => {
            replace_json_version(&content, old, new)
        }
        VersionMirrorKind::TomlKey if selector == "package.version" => {
            replace_toml_key(&content, Some("package"), "version", old, new)
        }
        VersionMirrorKind::CargoLockPackage => {
            replace_cargo_lock_package(&content, selector, old, new)
        }
        _ => Err(version_error(
            format!("unsupported version mirror selector: {selector}"),
            "tauri_release_version_mirror_unsupported",
        )),
    }
}

pub(crate) fn validate_current_versions(
    repository_root: &Path,
    config: &TauriReleaseConfig,
    source: &TauriVersionSource,
    current: &str,
) -> Result<(), AppError> {
    let source_path = repository_root.join(&source.path);
    updated_source_content(&source_path, source, current, current)?;
    for mirror in &config.version_mirrors {
        if mirror.path == source.path {
            continue;
        }
        let path = repository_root.join(&mirror.path);
        updated_mirror_content(
            &path,
            mirror.kind.clone(),
            &mirror.selector,
            current,
            current,
        )?;
    }
    Ok(())
}

pub(crate) fn apply(
    repository_root: &Path,
    config: &TauriReleaseConfig,
    source: &TauriVersionSource,
    old: &str,
    new: &str,
    tag: &str,
    release_notes: &str,
) -> Result<Vec<FileMutation>, AppError> {
    let mut updates = BTreeMap::<String, Vec<u8>>::new();
    let source_path = repository_root.join(&source.path);
    updates.insert(
        source.path.clone(),
        updated_source_content(&source_path, source, old, new)?.into_bytes(),
    );
    for mirror in &config.version_mirrors {
        if updates.contains_key(&mirror.path) {
            continue;
        }
        let path = repository_root.join(&mirror.path);
        updates.insert(
            mirror.path.clone(),
            updated_mirror_content(&path, mirror.kind.clone(), &mirror.selector, old, new)?
                .into_bytes(),
        );
    }
    let notes_path = format!("release-notes/{tag}.md");
    updates.insert(notes_path, release_notes.as_bytes().to_vec());

    let mut mutations = Vec::new();
    for (relative_path, applied) in updates {
        let path = repository_root.join(&relative_path);
        let original = match std::fs::read(&path) {
            Ok(content) => Some(content),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => {
                if let Err(restore_error) = restore_unchanged(&mutations) {
                    log::error!(
                        "failed to restore partial Tauri release changes after read error: {restore_error}"
                    );
                }
                return Err(AppError::repository_with_code(
                    format!(
                        "failed to read {} before release update: {error}",
                        path.display()
                    ),
                    "tauri_release_version_read_failed",
                ));
            }
        };
        if let Some(parent) = path.parent() {
            if let Err(error) = std::fs::create_dir_all(parent) {
                if let Err(restore_error) = restore_unchanged(&mutations) {
                    log::error!(
                        "failed to restore partial Tauri release changes after directory creation error: {restore_error}"
                    );
                }
                return Err(AppError::repository_with_code(
                    format!("failed to create {}: {error}", parent.display()),
                    "tauri_release_version_write_failed",
                ));
            }
        }
        if let Err(error) = std::fs::write(&path, &applied) {
            if let Err(restore_error) = restore_unchanged(&mutations) {
                log::error!(
                    "failed to restore partial Tauri release changes after write error: {restore_error}"
                );
            }
            return Err(AppError::repository_with_code(
                format!("failed to write {}: {error}", path.display()),
                "tauri_release_version_write_failed",
            ));
        }
        mutations.push(FileMutation {
            relative_path,
            path,
            original,
            applied,
        });
    }
    Ok(mutations)
}

pub(crate) fn restore_unchanged(mutations: &[FileMutation]) -> Result<(), AppError> {
    for mutation in mutations.iter().rev() {
        let current = match std::fs::read(&mutation.path) {
            Ok(content) => Some(content),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => {
                return Err(AppError::repository_with_code(
                    format!(
                        "failed to inspect {} before release rollback: {error}",
                        mutation.path.display()
                    ),
                    "tauri_release_restore_failed",
                ));
            }
        };
        if current.as_deref() != Some(mutation.applied.as_slice()) {
            continue;
        }
        match &mutation.original {
            Some(original) => std::fs::write(&mutation.path, original),
            None => std::fs::remove_file(&mutation.path),
        }
        .map_err(|error| {
            AppError::repository_with_code(
                format!("failed to restore {}: {error}", mutation.path.display()),
                "tauri_release_restore_failed",
            )
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn applies_authoritative_version_mirrors_and_release_notes_as_one_change_set() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let tauri_dir = temp_dir.path().join("src-tauri");
        std::fs::create_dir_all(&tauri_dir).expect("create tauri dir");
        std::fs::write(
            tauri_dir.join("tauri.conf.json"),
            "{\n  \"productName\": \"Demo\",\n  \"version\": \"1.2.3\"\n}\n",
        )
        .expect("write config");
        std::fs::write(
            temp_dir.path().join("package.json"),
            "{\n  \"name\": \"demo\",\n  \"version\": \"1.2.3\"\n}\n",
        )
        .expect("write package json");
        let source = TauriVersionSource {
            kind: TauriVersionSourceKind::TauriConfig,
            path: "src-tauri/tauri.conf.json".to_string(),
            selector: "version".to_string(),
            version: "1.2.3".to_string(),
        };
        let config = TauriReleaseConfig {
            version_mirrors: vec![super::super::VersionMirror {
                path: "package.json".to_string(),
                kind: VersionMirrorKind::JsonPointer,
                selector: "/version".to_string(),
            }],
            allow_unsigned_release: true,
            ..TauriReleaseConfig::default()
        };

        let mutations = apply(
            temp_dir.path(),
            &config,
            &source,
            "1.2.3",
            "1.3.0",
            "v1.3.0",
            "- Added release flow\n",
        )
        .expect("apply");

        assert_eq!(mutations.len(), 3);
        assert!(read_text(&tauri_dir.join("tauri.conf.json"))
            .expect("read config")
            .contains("\"version\": \"1.3.0\""));
        assert!(read_text(&temp_dir.path().join("package.json"))
            .expect("read package")
            .contains("\"version\": \"1.3.0\""));
        assert!(temp_dir.path().join("release-notes/v1.3.0.md").is_file());

        restore_unchanged(&mutations).expect("restore");
        assert!(!temp_dir.path().join("release-notes/v1.3.0.md").exists());
        assert!(read_text(&tauri_dir.join("tauri.conf.json"))
            .expect("read restored config")
            .contains("\"version\": \"1.2.3\""));
    }

    #[test]
    fn preflight_validation_rejects_drifted_version_mirror() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let tauri_dir = temp_dir.path().join("src-tauri");
        std::fs::create_dir_all(&tauri_dir).expect("create tauri dir");
        std::fs::write(tauri_dir.join("tauri.conf.json"), r#"{"version":"1.2.3"}"#)
            .expect("write config");
        std::fs::write(
            temp_dir.path().join("package.json"),
            r#"{"version":"1.2.2"}"#,
        )
        .expect("write mirror");
        let source = TauriVersionSource {
            kind: TauriVersionSourceKind::TauriConfig,
            path: "src-tauri/tauri.conf.json".to_string(),
            selector: "version".to_string(),
            version: "1.2.3".to_string(),
        };
        let config = TauriReleaseConfig {
            version_mirrors: vec![super::super::VersionMirror {
                path: "package.json".to_string(),
                kind: VersionMirrorKind::JsonPointer,
                selector: "/version".to_string(),
            }],
            allow_unsigned_release: true,
            ..TauriReleaseConfig::default()
        };

        let error = validate_current_versions(temp_dir.path(), &config, &source, "1.2.3")
            .expect_err("drifted mirror");

        assert_eq!(
            error.code.as_deref(),
            Some("tauri_release_version_mismatch")
        );
    }
}
