use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use tokio::process::Command;
use tokio::time::{timeout, Duration};
use ts_rs::TS;
use walkdir::WalkDir;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

type Result<T> = std::result::Result<T, ArtifactError>;

#[derive(Debug, thiserror::Error)]
pub enum ArtifactError {
    #[error("{0}")]
    Validation(String),
    #[error("{context}: {source}")]
    Io {
        context: String,
        #[source]
        source: std::io::Error,
    },
    #[error("{context}: {source}")]
    WalkDir {
        context: String,
        #[source]
        source: walkdir::Error,
    },
    #[error("{context}: {source}")]
    Zip {
        context: String,
        #[source]
        source: zip::result::ZipError,
    },
    #[error("{context}: {source}")]
    Join {
        context: String,
        #[source]
        source: tokio::task::JoinError,
    },
    #[error("{context}: {source}")]
    Path {
        context: String,
        #[source]
        source: std::path::StripPrefixError,
    },
    #[error("signing command timed out")]
    SignTimeout,
}

fn validation_error(message: impl Into<String>) -> ArtifactError {
    ArtifactError::Validation(message.into())
}

fn io_error(context: impl Into<String>, source: std::io::Error) -> ArtifactError {
    ArtifactError::Io {
        context: context.into(),
        source,
    }
}

fn walkdir_error(context: impl Into<String>, source: walkdir::Error) -> ArtifactError {
    ArtifactError::WalkDir {
        context: context.into(),
        source,
    }
}

fn zip_error(context: impl Into<String>, source: zip::result::ZipError) -> ArtifactError {
    ArtifactError::Zip {
        context: context.into(),
        source,
    }
}

fn join_error(context: impl Into<String>, source: tokio::task::JoinError) -> ArtifactError {
    ArtifactError::Join {
        context: context.into(),
        source,
    }
}

fn path_error(context: impl Into<String>, source: std::path::StripPrefixError) -> ArtifactError {
    ArtifactError::Path {
        context: context.into(),
        source,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum PackageFormat {
    Zip,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct PackageResult {
    pub artifact_path: String,
    pub format: PackageFormat,
    pub file_count: usize,
    #[ts(type = "number")]
    pub bytes: u64,
    pub sha256: String,
}

pub async fn package_directory(
    input_dir: &Path,
    output_path: &Path,
    format: PackageFormat,
    include_root_dir: bool,
) -> Result<PackageResult> {
    match format {
        PackageFormat::Zip => package_zip(input_dir, output_path, include_root_dir).await,
    }
}

async fn package_zip(
    input_dir: &Path,
    output_path: &Path,
    include_root_dir: bool,
) -> Result<PackageResult> {
    let input_dir = input_dir.to_path_buf();
    let output_path = output_path.to_path_buf();

    tokio::task::spawn_blocking(move || {
        package_zip_sync(&input_dir, &output_path, include_root_dir)
    })
    .await
    .map_err(|source| join_error("failed to join packaging task", source))?
}

fn package_zip_sync(
    input_dir: &Path,
    output_path: &Path,
    include_root_dir: bool,
) -> Result<PackageResult> {
    if !input_dir.exists() {
        return Err(validation_error(format!(
            "input directory does not exist: {}",
            input_dir.display()
        )));
    }
    if !input_dir.is_dir() {
        return Err(validation_error(format!(
            "input path is not a directory: {}",
            input_dir.display()
        )));
    }

    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|source| {
            io_error(
                format!("failed to create output directory: {}", parent.display()),
                source,
            )
        })?;
    }

    let root_name = input_dir
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("artifact")
        .to_string();

    let output_file = File::create(output_path).map_err(|source| {
        io_error(
            format!("failed to create output file: {}", output_path.display()),
            source,
        )
    })?;

    let mut zip = ZipWriter::new(output_file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    let mut file_count = 0usize;

    for entry in WalkDir::new(input_dir).follow_links(false) {
        let entry = entry.map_err(|source| {
            walkdir_error(
                format!("failed to read entry under {}", input_dir.display()),
                source,
            )
        })?;
        if !entry.file_type().is_file() {
            continue;
        }

        let rel = entry
            .path()
            .strip_prefix(input_dir)
            .map_err(|source| path_error("failed to compute relative path", source))?;
        if rel.as_os_str().is_empty() {
            continue;
        }

        let name_path = if include_root_dir {
            PathBuf::from(&root_name).join(rel)
        } else {
            rel.to_path_buf()
        };

        let name = normalize_zip_path(&name_path);

        zip.start_file(name, options)
            .map_err(|source| zip_error("failed to add file to zip", source))?;

        let mut src = File::open(entry.path()).map_err(|source| {
            io_error(format!("failed to open {}", entry.path().display()), source)
        })?;
        std::io::copy(&mut src, &mut zip).map_err(|source| {
            io_error(
                format!("failed to write {}", entry.path().display()),
                source,
            )
        })?;

        file_count += 1;
    }

    zip.finish()
        .map_err(|source| zip_error("failed to finalize zip", source))?;

    let bytes = fs::metadata(output_path)
        .map_err(|source| io_error(format!("failed to stat {}", output_path.display()), source))?
        .len();

    let sha256 = compute_sha256_hex(output_path)?;

    Ok(PackageResult {
        artifact_path: output_path.to_string_lossy().to_string(),
        format: PackageFormat::Zip,
        file_count,
        bytes,
        sha256,
    })
}

fn normalize_zip_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn compute_sha256_hex(path: &Path) -> Result<String> {
    let mut file = File::open(path)
        .map_err(|source| io_error(format!("failed to open {}", path.display()), source))?;

    let mut hasher = Sha256::new();
    let mut buf = [0u8; 8192];

    loop {
        let n = file
            .read(&mut buf)
            .map_err(|source| io_error("failed to read file", source))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }

    Ok(hex::encode(hasher.finalize()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum SignMethod {
    GpgDetached,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct SignResult {
    pub signature_path: String,
    pub method: SignMethod,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub success: bool,
}

pub async fn sign_artifact(
    artifact_path: &Path,
    method: SignMethod,
    output_path: Option<&Path>,
    key_id: Option<&str>,
) -> Result<SignResult> {
    match method {
        SignMethod::GpgDetached => sign_gpg_detached(artifact_path, output_path, key_id).await,
    }
}

async fn sign_gpg_detached(
    artifact_path: &Path,
    output_path: Option<&Path>,
    key_id: Option<&str>,
) -> Result<SignResult> {
    if !artifact_path.exists() {
        return Err(validation_error(format!(
            "artifact does not exist: {}",
            artifact_path.display()
        )));
    }
    if !artifact_path.is_file() {
        return Err(validation_error(format!(
            "artifact path is not a file: {}",
            artifact_path.display()
        )));
    }

    let signature_path = output_path
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(format!("{}.asc", artifact_path.to_string_lossy())));

    if let Some(parent) = signature_path.parent() {
        fs::create_dir_all(parent).map_err(|source| {
            io_error(
                format!(
                    "failed to create signature output directory: {}",
                    parent.display()
                ),
                source,
            )
        })?;
    }

    let mut args: Vec<String> = vec![
        "--batch".to_string(),
        "--yes".to_string(),
        "--detach-sign".to_string(),
        "--armor".to_string(),
    ];

    if let Some(key) = key_id {
        if !key.trim().is_empty() {
            args.push("--local-user".to_string());
            args.push(key.to_string());
        }
    }

    args.push("--output".to_string());
    args.push(signature_path.to_string_lossy().to_string());
    args.push(artifact_path.to_string_lossy().to_string());

    let output = timeout(
        Duration::from_secs(10 * 60),
        Command::new("gpg").args(&args).output(),
    )
    .await
    .map_err(|_| ArtifactError::SignTimeout)?
    .map_err(|source| io_error("failed to run gpg", source))?;

    let exit_code = output.status.code().unwrap_or(-1);
    let success = exit_code == 0;

    Ok(SignResult {
        signature_path: signature_path.to_string_lossy().to_string(),
        method: SignMethod::GpgDetached,
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code,
        success,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn packages_zip_and_reports_metadata() {
        let dir = tempdir().expect("tempdir");
        let input = dir.path().join("input");
        fs::create_dir_all(input.join("sub")).expect("create dir");
        fs::write(input.join("a.txt"), "hello").expect("write a");
        fs::write(input.join("sub").join("b.txt"), "world").expect("write b");

        let output = dir.path().join("out.zip");

        let rt = tokio::runtime::Runtime::new().expect("runtime");
        let result = rt
            .block_on(package_directory(
                &input,
                &output,
                PackageFormat::Zip,
                false,
            ))
            .expect("package");

        assert_eq!(result.format, PackageFormat::Zip);
        assert_eq!(result.file_count, 2);
        assert_eq!(result.bytes, fs::metadata(&output).unwrap().len());
        assert_eq!(result.sha256.len(), 64);

        let f = File::open(&output).expect("open zip");
        let mut archive = zip::ZipArchive::new(f).expect("zip archive");

        let mut names: Vec<String> = Vec::new();
        for i in 0..archive.len() {
            let file = archive.by_index(i).expect("zip file");
            names.push(file.name().to_string());
        }
        names.sort();

        assert!(names.contains(&"a.txt".to_string()));
        assert!(names.contains(&"sub/b.txt".to_string()));

        let mut a = archive.by_name("a.txt").expect("a.txt");
        let mut buf = String::new();
        a.read_to_string(&mut buf).expect("read");
        assert_eq!(buf, "hello");
    }
}
