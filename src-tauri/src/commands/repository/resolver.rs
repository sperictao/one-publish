use std::path::PathBuf;

use super::*;

#[tauri::command]
pub async fn scan_project_candidates(
    start_path: Option<String>,
) -> Result<ProjectScanCandidates, crate::errors::AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new(
        "commands::repository::resolver::scan_project_candidates",
    );
    let search_path = match start_path {
        Some(path) => PathBuf::from(path),
        None => std::env::current_dir().map_err(|error| {
            repository_error(
                format!("failed to resolve current directory: {}", error),
                "current_dir_failed",
            )
        })?,
    };
    scan_project_candidates_from_path(&search_path)
}

#[tauri::command]
pub async fn resolve_project_info(
    project_file: String,
) -> Result<ProjectInfo, crate::errors::AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new(
        "commands::repository::resolver::resolve_project_info",
    );
    let project_file_path = PathBuf::from(&project_file);
    if !project_file_path.is_file() || !is_dotnet_project_file(&project_file_path) {
        return Err(repository_error(
            format!(
                "project file does not exist: {}",
                project_file_path.display()
            ),
            "project_file_not_found",
        ));
    }

    let publish_profiles = scan_publish_profiles(&project_file_path);
    let target_frameworks = read_target_frameworks(&project_file_path)?;
    let root_path = resolve_project_root_for_file(&project_file_path);

    Ok(ProjectInfo {
        root_path: root_path.to_string_lossy().to_string(),
        project_file: project_file_path.to_string_lossy().to_string(),
        publish_profiles,
        target_frameworks,
    })
}
