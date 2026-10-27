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
            repository_error("failed to resolve current directory", "current_dir_failed")
                .with_details(error.to_string())
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
        return Err(
            repository_error("project file does not exist", "project_file_not_found")
                .with_details(project_file),
        );
    }

    let registry = crate::provider::registry::provider_registry();
    let Some(discovery) = registry.repository_discoveries().find(|discovery| {
        discovery
            .project_file_matchers
            .iter()
            .any(|matcher| super::matches_project_file(&project_file_path, matcher))
    }) else {
        return Err(
            repository_error("unsupported project file", "project_file_not_found")
                .with_details(project_file),
        );
    };
    let Ok(provider) = registry.get(&discovery.provider_id) else {
        return Err(
            repository_error("unsupported project file", "project_file_not_found")
                .with_details(project_file),
        );
    };
    let capabilities = provider.capabilities();
    // 解决方案文件不是项目配置宿主：按无项目语义的普通文件处理。
    let is_solution_file = discovery.solution_file_extensions.iter().any(|extension| {
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
    let root_path =
        resolve_project_root_for_file(&project_file_path, &discovery.solution_file_extensions);

    Ok(ProjectInfo {
        root_path: root_path.to_string_lossy().to_string(),
        project_file: project_file_path.to_string_lossy().to_string(),
        publish_profiles,
        target_frameworks,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn resolve_project_info_rejects_missing_and_unsupported_files() {
        let temp = TempDir::new().expect("temp dir");

        let missing = temp.path().join("missing.csproj");
        let err = resolve_project_info(missing.to_string_lossy().to_string())
            .await
            .expect_err("missing file");
        assert_eq!(err.code.as_deref(), Some("project_file_not_found"));
        assert!(err
            .details
            .as_deref()
            .is_some_and(|details| details.contains("missing.csproj")));

        let unsupported = temp.path().join("notes.txt");
        std::fs::write(&unsupported, "hello").expect("write file");
        let err = resolve_project_info(unsupported.to_string_lossy().to_string())
            .await
            .expect_err("unsupported file");
        assert_eq!(err.code.as_deref(), Some("project_file_not_found"));
    }

    #[tokio::test]
    async fn resolve_project_info_treats_solution_files_as_plain_files() {
        let temp = TempDir::new().expect("temp dir");
        let nested = temp.path().join("src").join("App");
        std::fs::create_dir_all(&nested).expect("create nested");
        let solution = nested.join("App.sln");
        std::fs::write(&solution, "").expect("write solution");

        let info = resolve_project_info(solution.to_string_lossy().to_string())
            .await
            .expect("solution resolves to plain-file info");
        // 解决方案文件无项目语义：root 退到父目录，无 profile/框架。
        assert_eq!(info.root_path, nested.to_string_lossy());
        assert!(info.publish_profiles.is_empty());
        assert!(info.target_frameworks.is_empty());
    }

    #[tokio::test]
    async fn resolve_project_info_lifts_tauri_config_root_out_of_src_tauri() {
        let temp = TempDir::new().expect("temp dir");
        let app_dir = temp.path().join("src-tauri");
        std::fs::create_dir_all(&app_dir).expect("create src-tauri");
        let config = app_dir.join("tauri.conf.json");
        std::fs::write(&config, "{}").expect("write config");

        let info = resolve_project_info(config.to_string_lossy().to_string())
            .await
            .expect("tauri config resolves");
        // 配置文件宿主在 src-tauri/ 内时，root 上抬到仓库根。
        assert_eq!(info.root_path, temp.path().to_string_lossy());
        assert!(info.publish_profiles.is_empty());
        assert!(info.target_frameworks.is_empty());
    }

    #[tokio::test]
    async fn scan_project_candidates_delegates_to_explicit_start_path() {
        let temp = TempDir::new().expect("temp dir");
        std::fs::write(temp.path().join("App.csproj"), "<Project />").expect("write");

        let candidates =
            scan_project_candidates(Some(temp.path().to_string_lossy().to_string()), None)
                .await
                .expect("scan");
        assert_eq!(candidates.project_files.len(), 1);
        assert!(candidates.project_files[0].ends_with("App.csproj"));
    }
}
