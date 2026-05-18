use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use super::path_validation::normalize_lexical_path;
use super::{ProtectedDirectoryLocation, PublishOutputAccess, PublishOutputAccessIntent};

pub(super) struct ProtectedRoot {
    pub(super) location: ProtectedDirectoryLocation,
    pub(super) path: PathBuf,
}

#[cfg(target_os = "macos")]
pub(super) fn macos_protected_roots() -> Vec<ProtectedRoot> {
    [
        (ProtectedDirectoryLocation::Desktop, dirs::desktop_dir()),
        (ProtectedDirectoryLocation::Documents, dirs::document_dir()),
        (ProtectedDirectoryLocation::Downloads, dirs::download_dir()),
    ]
    .into_iter()
    .filter_map(|(location, path)| path.map(|path| ProtectedRoot { location, path }))
    .collect()
}

pub(super) fn find_protected_root_for_path<'a>(
    path: &Path,
    roots: &'a [ProtectedRoot],
) -> Option<&'a ProtectedRoot> {
    let normalized_path = normalize_lexical_path(path);

    roots.iter().find(|root| {
        let normalized_root = normalize_lexical_path(&root.path);
        normalized_path.starts_with(&normalized_root)
    })
}

#[cfg(target_os = "macos")]
pub(super) fn evaluate_publish_output_access(
    output_dir: &str,
    access_intent: PublishOutputAccessIntent,
) -> PublishOutputAccess {
    let protected_roots = macos_protected_roots();
    let probe_access =
        |probe_directory: &Path| probe_publish_output_access(probe_directory, access_intent);
    evaluate_publish_output_access_for_roots(
        output_dir,
        access_intent,
        &protected_roots,
        probe_access,
    )
}

#[cfg(not(target_os = "macos"))]
pub(super) fn evaluate_publish_output_access(
    _output_dir: &str,
    _access_intent: PublishOutputAccessIntent,
) -> PublishOutputAccess {
    PublishOutputAccess::not_applicable()
}

pub(super) fn evaluate_publish_output_access_for_roots<F>(
    output_dir: &str,
    access_intent: PublishOutputAccessIntent,
    roots: &[ProtectedRoot],
    probe_write_access: F,
) -> PublishOutputAccess
where
    F: Fn(&Path) -> std::io::Result<()>,
{
    let trimmed = output_dir.trim();
    if trimmed.is_empty() {
        return PublishOutputAccess::not_applicable();
    }

    let normalized_output_dir = normalize_lexical_path(Path::new(trimmed));
    let Some(protected_root) = find_protected_root_for_path(&normalized_output_dir, roots) else {
        return PublishOutputAccess::not_applicable();
    };

    let probe_directory =
        resolve_probe_directory(&normalized_output_dir, &protected_root.path, access_intent);

    match probe_write_access(&probe_directory) {
        Ok(()) => {
            log::info!(
                "publish output access granted: output_dir={} probe_directory={}",
                normalized_output_dir.display(),
                probe_directory.display()
            );
            PublishOutputAccess::granted(
                protected_root.location,
                &protected_root.path,
                &probe_directory,
            )
        }
        Err(error) => {
            log::warn!(
                "publish output access denied: output_dir={} probe_directory={} error={}",
                normalized_output_dir.display(),
                probe_directory.display(),
                error
            );
            PublishOutputAccess::denied(
                protected_root.location,
                &protected_root.path,
                &probe_directory,
                error.to_string(),
            )
        }
    }
}

pub(crate) fn protected_location_for_output_dir(
    output_dir: &str,
) -> Option<ProtectedDirectoryLocation> {
    let trimmed = output_dir.trim();
    if trimmed.is_empty() {
        return None;
    }

    let protected_roots = platform_protected_roots();
    let normalized_output_dir = normalize_lexical_path(Path::new(trimmed));
    find_protected_root_for_path(&normalized_output_dir, &protected_roots).map(|root| root.location)
}

pub(crate) fn is_protected_root_output_dir(output_dir: &str) -> bool {
    let trimmed = output_dir.trim();
    if trimmed.is_empty() {
        return false;
    }

    let protected_roots = platform_protected_roots();
    let normalized_output_dir = normalize_lexical_path(Path::new(trimmed));
    is_protected_root_path(&normalized_output_dir, &protected_roots)
}

pub(super) fn is_protected_root_path(path: &Path, roots: &[ProtectedRoot]) -> bool {
    roots
        .iter()
        .any(|root| normalize_lexical_path(&root.path) == normalize_lexical_path(path))
}

#[cfg(target_os = "macos")]
pub(super) fn platform_protected_roots() -> Vec<ProtectedRoot> {
    macos_protected_roots()
}

#[cfg(not(target_os = "macos"))]
pub(super) fn platform_protected_roots() -> Vec<ProtectedRoot> {
    Vec::new()
}

#[cfg(test)]
pub(super) fn resolve_existing_probe_directory(path: &Path, fallback_root: &Path) -> PathBuf {
    resolve_probe_directory(path, fallback_root, PublishOutputAccessIntent::WriteOutput)
}

pub(super) fn resolve_probe_directory(
    path: &Path,
    fallback_root: &Path,
    access_intent: PublishOutputAccessIntent,
) -> PathBuf {
    let normalized_path = normalize_lexical_path(path);

    if matches!(
        access_intent,
        PublishOutputAccessIntent::CleanExistingOutput
            | PublishOutputAccessIntent::WriteOutputParent
    ) && normalized_path.is_dir()
    {
        return resolve_parent_probe_directory(&normalized_path, fallback_root);
    }

    if normalized_path.is_dir() {
        return normalized_path;
    }

    if normalized_path.is_file() {
        return normalized_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| normalize_lexical_path(fallback_root));
    }

    for ancestor in normalized_path.ancestors() {
        if ancestor.exists() {
            return ancestor.to_path_buf();
        }
    }

    normalize_lexical_path(fallback_root)
}

pub(super) fn resolve_parent_probe_directory(path: &Path, fallback_root: &Path) -> PathBuf {
    let normalized_fallback_root = normalize_lexical_path(fallback_root);
    path.parent()
        .map(normalize_lexical_path)
        .filter(|parent| parent.starts_with(&normalized_fallback_root))
        .unwrap_or(normalized_fallback_root)
}

#[cfg(target_os = "macos")]
pub(super) fn probe_directory_write_access(directory: &Path) -> std::io::Result<()> {
    let probe_file = build_probe_file_path(directory);
    let file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&probe_file)?;
    drop(file);
    let _ = fs::remove_file(&probe_file);
    Ok(())
}

#[cfg(target_os = "macos")]
pub(super) fn probe_directory_cleanup_access(directory: &Path) -> std::io::Result<()> {
    let probe_directory = build_probe_file_path(directory);
    fs::create_dir(&probe_directory)?;
    fs::remove_dir(&probe_directory)?;
    Ok(())
}

#[cfg(target_os = "macos")]
pub(super) fn probe_publish_output_access(
    directory: &Path,
    access_intent: PublishOutputAccessIntent,
) -> std::io::Result<()> {
    match access_intent {
        PublishOutputAccessIntent::WriteOutput | PublishOutputAccessIntent::WriteOutputParent => {
            probe_directory_write_access(directory)
        }
        PublishOutputAccessIntent::CleanExistingOutput => probe_directory_cleanup_access(directory),
    }
}

#[cfg(target_os = "macos")]
pub(super) fn build_probe_file_path(directory: &Path) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    directory.join(format!(
        ".one-publish-access-check-{}-{}",
        std::process::id(),
        timestamp
    ))
}
