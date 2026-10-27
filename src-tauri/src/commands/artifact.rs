use crate::artifact::{PackageFormat, PackageResult, SignMethod, SignResult};
use std::path::Path;

/// Package an output directory into a single artifact file.
#[tauri::command]
pub async fn package_artifact(
    input_dir: String,
    output_path: String,
    format: Option<PackageFormat>,
    include_root_dir: Option<bool>,
) -> Result<PackageResult, crate::errors::AppError> {
    let _timer =
        crate::commands::middleware::CommandTimer::new("commands::artifact::package_artifact");
    let format = format.unwrap_or(PackageFormat::Zip);
    let include_root_dir = include_root_dir.unwrap_or(true);
    crate::artifact::package_directory(
        Path::new(&input_dir),
        Path::new(&output_path),
        format,
        include_root_dir,
    )
    .await
    .map_err(|e| {
        crate::errors::AppError::artifact_with_code("package failed", "artifact_package_failed")
            .with_details(e.to_string())
    })
}

/// Sign an artifact file using a supported signing method.
#[tauri::command]
pub async fn sign_artifact(
    artifact_path: String,
    method: SignMethod,
    output_path: Option<String>,
    key_id: Option<String>,
) -> Result<SignResult, crate::errors::AppError> {
    let _timer =
        crate::commands::middleware::CommandTimer::new("commands::artifact::sign_artifact");
    crate::artifact::sign_artifact(
        Path::new(&artifact_path),
        method,
        output_path.as_deref().map(Path::new),
        key_id.as_deref(),
    )
    .await
    .map_err(|e| {
        crate::errors::AppError::artifact_with_code("sign failed", "artifact_sign_failed")
            .with_details(e.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn package_artifact_defaults_format_and_root_dir() {
        let dir = tempfile::tempdir().expect("tempdir");
        let input = dir.path().join("bundle");
        std::fs::create_dir_all(&input).expect("create input");
        std::fs::write(input.join("a.txt"), "hi").expect("write");

        let output = dir.path().join("out").join("bundle.zip");
        // None/None 走默认值：Zip + include_root_dir
        let result = package_artifact(
            input.to_string_lossy().to_string(),
            output.to_string_lossy().to_string(),
            None,
            None,
        )
        .await
        .expect("package");

        assert_eq!(result.format, PackageFormat::Zip);
        assert_eq!(result.file_count, 1);
        let mut archive =
            zip::ZipArchive::new(std::fs::File::open(&output).expect("open")).expect("zip");
        assert!(archive.by_name("bundle/a.txt").is_ok());
    }

    #[tokio::test]
    async fn package_artifact_maps_failures_to_artifact_error_code() {
        let dir = tempfile::tempdir().expect("tempdir");
        let error = package_artifact(
            dir.path().join("ghost").to_string_lossy().to_string(),
            dir.path().join("out.zip").to_string_lossy().to_string(),
            None,
            None,
        )
        .await
        .expect_err("missing input must fail");

        assert_eq!(error.code.as_deref(), Some("artifact_package_failed"));
    }

    #[tokio::test]
    async fn sign_artifact_maps_validation_failures_to_artifact_error_code() {
        let dir = tempfile::tempdir().expect("tempdir");
        let error = sign_artifact(
            dir.path().join("ghost.zip").to_string_lossy().to_string(),
            SignMethod::GpgDetached,
            None,
            None,
        )
        .await
        .expect_err("missing artifact must fail");

        assert_eq!(error.code.as_deref(), Some("artifact_sign_failed"));
    }
}
