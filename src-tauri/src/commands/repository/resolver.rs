use std::path::PathBuf;

use super::*;

#[tauri::command]
pub async fn scan_project_candidates(
    start_path: Option<String>,
    provider_id: Option<String>,
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
    scan_provider_project_candidates_from_path(&search_path, provider_id.as_deref())
}

#[tauri::command]
pub async fn resolve_project_info(
    project_file: String,
) -> Result<ProjectInfo, crate::errors::AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new(
        "commands::repository::resolver::resolve_project_info",
    );
    let project_file_path = PathBuf::from(&project_file);
    if !project_file_path.is_file() {
        return Err(repository_error(
            format!(
                "project file does not exist: {}",
                project_file_path.display()
            ),
            "project_file_not_found",
        ));
    }

    let registry = crate::provider::registry::provider_registry();
    let Some(discovery) = registry
        .repository_discoveries()
        .find(|discovery| {
            discovery
                .project_file_matchers
                .iter()
                .any(|matcher| super::matches_project_file(&project_file_path, matcher))
        })
    else {
        return Err(repository_error(
            format!("unsupported project file: {}", project_file_path.display()),
            "project_file_not_found",
        ));
    };
    let Ok(provider) = registry.get(&discovery.provider_id) else {
        return Err(repository_error(
            format!("unsupported project file: {}", project_file_path.display()),
            "project_file_not_found",
        ));
    };
    let capabilities = provider.capabilities();
    // 解决方案文件不是项目配置宿主：按无项目语义的普通文件处理。
    let is_solution_file = discovery
        .solution_file_extensions
        .iter()
        .any(|extension| {
            project_file_path
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case(extension))
        });
    if (capabilities.project_profiles.is_none() && capabilities.framework_tags.is_empty())
        || is_solution_file
    {
        let root = project_file_path
            .parent()
            .and_then(|parent| {
                (parent.file_name().and_then(|name| name.to_str()) == Some("src-tauri"))
                    .then(|| parent.parent())
                    .flatten()
            })
            .unwrap_or_else(|| project_file_path.parent().unwrap_or(&project_file_path));
        return Ok(ProjectInfo {
            root_path: root.to_string_lossy().to_string(),
            project_file: project_file_path.to_string_lossy().to_string(),
            publish_profiles: Vec::new(),
            target_frameworks: Vec::new(),
        });
    }

    let publish_profiles = scan_publish_profiles(&project_file_path);
    let target_frameworks = if capabilities.framework_tags.is_empty() {
        Vec::new()
    } else {
        read_target_frameworks(&project_file_path, &capabilities.framework_tags)?
    };
    let root_path = resolve_project_root_for_file(
        &project_file_path,
        &discovery.solution_file_extensions,
    );

    Ok(ProjectInfo {
        root_path: root_path.to_string_lossy().to_string(),
        project_file: project_file_path.to_string_lossy().to_string(),
        publish_profiles,
        target_frameworks,
    })
}
