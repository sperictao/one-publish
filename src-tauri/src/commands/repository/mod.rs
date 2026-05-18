mod connector;
mod resolver;
mod scanner;

pub use connector::*;
pub use resolver::*;
pub use scanner::*;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use ts_rs::TS;

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct ProjectInfo {
    pub root_path: String,
    pub project_file: String,
    pub publish_profiles: Vec<String>,
    pub target_frameworks: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ProjectPublishProfileFile {
    pub profile_name: String,
    pub file_path: String,
    pub content: String,
}

pub(crate) fn repository_error(
    message: impl Into<String>,
    code: impl Into<String>,
) -> crate::errors::AppError {
    crate::errors::AppError::repository_with_code(message, code)
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct RepositoryBranchScanResult {
    pub branches: Vec<crate::store::Branch>,
    pub current_branch: String,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct RepositoryBranchConnectivityResult {
    pub can_connect: bool,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ProjectScanCandidates {
    pub root_path: String,
    pub solution_files: Vec<String>,
    pub project_files: Vec<String>,
    pub recommended_project_file: Option<String>,
}

#[tauri::command]
pub async fn scan_project(
    start_path: Option<String>,
) -> Result<ProjectInfo, crate::errors::AppError> {
    let _timer =
        crate::commands::middleware::CommandTimer::new("commands::repository::mod::scan_project");
    let candidates = scan_project_candidates(start_path).await?;

    match candidates.project_files.as_slice() {
        [] if candidates.solution_files.is_empty() => Err(repository_error(
            "cannot find project root (.sln or project file)",
            "project_root_not_found",
        )),
        [] => Err(repository_error(
            "cannot find project file (.csproj/.fsproj/.vbproj)",
            "project_file_not_found",
        )),
        [only_project] => resolve_project_info(only_project.clone()).await,
        _ => Err(repository_error(
            "multiple project files found; bind an explicit project file first",
            "multiple_project_files_found",
        )),
    }
}

#[tauri::command]
pub async fn read_project_publish_profile(
    project_file: String,
    profile_name: String,
) -> Result<ProjectPublishProfileFile, crate::errors::AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new(
        "commands::repository::mod::read_project_publish_profile",
    );
    let project_file_path = PathBuf::from(project_file);
    if !project_file_path.is_file() {
        return Err(repository_error(
            format!(
                "project file does not exist: {}",
                project_file_path.to_string_lossy()
            ),
            "project_file_not_found",
        ));
    }

    let profile_path = resolve_publish_profile_path(&project_file_path, &profile_name)?;
    let content = std::fs::read_to_string(&profile_path).map_err(|error| {
        repository_error(
            format!(
                "failed to read publish profile {}: {}",
                profile_path.to_string_lossy(),
                error
            ),
            classify_repository_path_error(error.kind()),
        )
    })?;

    Ok(ProjectPublishProfileFile {
        profile_name: profile_name.trim().to_string(),
        file_path: profile_path.to_string_lossy().to_string(),
        content,
    })
}

#[cfg(test)]
mod tests {
    use super::extract_target_frameworks_from_project_xml;
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn extracts_single_target_framework() {
        let frameworks = extract_target_frameworks_from_project_xml(
            r#"
            <Project>
              <PropertyGroup>
                <TargetFramework>net8.0</TargetFramework>
              </PropertyGroup>
            </Project>
            "#,
        );
        assert_eq!(frameworks, vec!["net8.0"]);
    }

    #[test]
    fn extracts_multiple_target_frameworks() {
        let frameworks = extract_target_frameworks_from_project_xml(
            r#"
            <Project>
              <PropertyGroup>
                <TargetFrameworks>net8.0; net9.0 ;net10.0</TargetFrameworks>
              </PropertyGroup>
            </Project>
            "#,
        );
        assert_eq!(frameworks, vec!["net8.0", "net9.0", "net10.0"]);
    }

    #[test]
    fn returns_empty_target_frameworks_when_missing() {
        let frameworks = extract_target_frameworks_from_project_xml(
            r#"
            <Project>
              <PropertyGroup>
                <Nullable>enable</Nullable>
              </PropertyGroup>
            </Project>
            "#,
        );
        assert!(frameworks.is_empty());
    }

    #[test]
    fn scan_project_candidates_finds_single_project_without_solution() {
        let temp_dir = TempDir::new().expect("temp dir");
        let project_file = temp_dir.path().join("src").join("App.csproj");
        fs::create_dir_all(project_file.parent().expect("project dir")).expect("create dir");
        fs::write(&project_file, "<Project />").expect("write project");
        let candidates = project_scan_candidates_from_root(temp_dir.path());
        assert_eq!(
            candidates.project_files,
            vec![project_file.to_string_lossy().to_string()]
        );
        assert_eq!(
            candidates.recommended_project_file.as_deref(),
            Some(project_file.to_string_lossy().as_ref())
        );
        assert!(candidates.solution_files.is_empty());
    }

    #[tokio::test]
    async fn scan_project_reports_multiple_candidates_when_more_than_one_project_exists() {
        let temp_dir = TempDir::new().expect("temp dir");
        let project_a = temp_dir.path().join("AppA.csproj");
        let project_b = temp_dir.path().join("AppB.csproj");
        fs::write(&project_a, "<Project />").expect("write project a");
        fs::write(&project_b, "<Project />").expect("write project b");
        let err = scan_project(Some(temp_dir.path().to_string_lossy().to_string()))
            .await
            .expect_err("multiple project files should fail");
        assert_eq!(err.code.as_deref(), Some("multiple_project_files_found"));
    }

    #[tokio::test]
    async fn resolve_project_info_uses_solution_root_when_available() {
        let temp_dir = TempDir::new().expect("temp dir");
        let solution = temp_dir.path().join("App.sln");
        let project_dir = temp_dir.path().join("src").join("App");
        let project_file = project_dir.join("App.csproj");
        let profiles_dir = project_dir.join("Properties").join("PublishProfiles");
        fs::create_dir_all(&profiles_dir).expect("create profiles dir");
        fs::write(&solution, "").expect("write solution");
        fs::write(
            &project_file,
            "<Project><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>",
        ).expect("write project");
        fs::write(profiles_dir.join("FolderProfile.pubxml"), "<Project />").expect("write profile");
        let info = resolve_project_info(project_file.to_string_lossy().to_string())
            .await
            .expect("resolve project info");
        assert_eq!(info.root_path, temp_dir.path().to_string_lossy());
        assert_eq!(info.project_file, project_file.to_string_lossy());
        assert_eq!(info.publish_profiles, vec!["FolderProfile".to_string()]);
        assert_eq!(info.target_frameworks, vec!["net8.0".to_string()]);
    }

    #[test]
    fn detect_provider_from_path_recognizes_gradle_repository() {
        let temp_dir = TempDir::new().expect("temp dir");
        fs::write(temp_dir.path().join("build.gradle.kts"), "plugins {}")
            .expect("write gradle build file");
        assert_eq!(
            detect_provider_from_path(temp_dir.path()),
            Some("java".to_string())
        );
    }

    #[test]
    fn detect_provider_from_path_rejects_maven_only_repository() {
        let temp_dir = TempDir::new().expect("temp dir");
        fs::write(temp_dir.path().join("pom.xml"), "<project />").expect("write pom");
        assert_eq!(detect_provider_from_path(temp_dir.path()), None);
    }

    #[test]
    fn detect_provider_from_path_uses_dotnet_discovery_metadata() {
        let temp_dir = TempDir::new().expect("temp dir");
        let project_dir = temp_dir.path().join("src").join("App");
        fs::create_dir_all(&project_dir).expect("create project dir");
        fs::write(project_dir.join("App.fsproj"), "<Project />").expect("write fsproj");
        assert_eq!(
            detect_provider_from_path(temp_dir.path()),
            Some("dotnet".to_string())
        );
    }

    #[tokio::test]
    async fn detect_repository_provider_returns_unsupported_for_maven_only_repository() {
        let temp_dir = TempDir::new().expect("temp dir");
        fs::write(temp_dir.path().join("pom.xml"), "<project />").expect("write pom");
        let error = detect_repository_provider(temp_dir.path().to_string_lossy().to_string())
            .await
            .expect_err("maven-only repository should be unsupported");
        assert_eq!(error.code.as_deref(), Some("unsupported_provider"));
    }

    #[tokio::test]
    async fn scan_project_files_for_java_returns_gradle_markers_only() {
        let temp_dir = TempDir::new().expect("temp dir");
        let gradle_file = temp_dir.path().join("build.gradle");
        let settings_file = temp_dir.path().join("settings.gradle.kts");
        let wrapper_file = temp_dir.path().join("gradlew");
        let pom_file = temp_dir.path().join("pom.xml");
        fs::write(&gradle_file, "plugins {}").expect("write gradle file");
        fs::write(&settings_file, "rootProject.name = \"demo\"").expect("write settings file");
        fs::write(&wrapper_file, "#!/bin/sh").expect("write wrapper file");
        fs::write(&pom_file, "<project />").expect("write pom file");
        let files = scan_project_files(temp_dir.path().to_string_lossy().to_string())
            .await
            .expect("scan project files");
        assert!(files.contains(&gradle_file.to_string_lossy().to_string()));
        assert!(files.contains(&settings_file.to_string_lossy().to_string()));
        assert!(files.contains(&wrapper_file.to_string_lossy().to_string()));
        assert!(!files.contains(&pom_file.to_string_lossy().to_string()));
    }

    #[tokio::test]
    async fn scan_project_files_for_dotnet_uses_discovery_metadata() {
        let temp_dir = TempDir::new().expect("temp dir");
        let project_dir = temp_dir.path().join("src").join("App");
        let project_file = project_dir.join("App.fsproj");
        fs::create_dir_all(&project_dir).expect("create project dir");
        fs::write(&project_file, "<Project />").expect("write fsproj");
        let files = scan_project_files(temp_dir.path().to_string_lossy().to_string())
            .await
            .expect("scan project files");
        assert_eq!(files, vec![project_file.to_string_lossy().to_string()]);
    }
}
