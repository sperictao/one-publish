// .NET provider environment detection

use crate::environment::types::*;
use std::process::Command;

/// Minimum required .NET SDK version
const MIN_DOTNET_VERSION: &str = "6.0.0";
const PROVIDER_ID: &str = "dotnet";

/// Check .NET SDK installation
pub async fn check_dotnet() -> Result<ProviderStatus, Box<dyn std::error::Error>> {
    let path = super::types::command_path("dotnet");

    match Command::new("dotnet").arg("--version").output() {
        Ok(output) => {
            let version_str = super::types::parse_version(&output.stdout, "")
                .unwrap_or_else(|| "unknown".to_string());

            let status = ProviderStatus {
                provider_id: PROVIDER_ID.to_string(),
                installed: true,
                version: Some(version_str),
                path,
            };

            Ok(status)
        }
        Err(_) => {
            Ok(ProviderStatus {
                provider_id: PROVIDER_ID.to_string(),
                installed: false,
                version: None,
                path,
            })
        }
    }
}

/// Create issue for missing .NET SDK
pub fn create_missing_dotnet_issue() -> EnvironmentIssue {
    EnvironmentIssue::new(
        IssueSeverity::Critical,
        PROVIDER_ID.to_string(),
        IssueType::MissingTool,
        ".NET SDK (dotnet) not found".to_string(),
    )
    .with_expected_value(format!("{}+", MIN_DOTNET_VERSION))
    .with_current_value("not installed".to_string())
    .with_fixes(get_dotnet_install_fixes())
}

/// Create issue for outdated .NET SDK
pub fn create_outdated_dotnet_issue(current: &str, recommended: &str) -> EnvironmentIssue {
    EnvironmentIssue::new(
        IssueSeverity::Warning,
        PROVIDER_ID.to_string(),
        IssueType::OutdatedVersion,
        format!(".NET SDK version outdated. Current: {}, Recommended: {}+", current, recommended),
    )
    .with_current_value(current.to_string())
    .with_expected_value(format!("{}+", recommended))
    .with_fix(FixAction {
        action_type: FixType::OpenUrl,
        label: "Download .NET SDK".to_string(),
        command: None,
        url: Some("https://dotnet.microsoft.com/download".to_string()),
    })
}

/// Get .NET SDK installation fixes for current platform
fn get_dotnet_install_fixes() -> Vec<FixAction> {
    #[cfg(target_os = "macos")]
    {
        vec![
            FixAction {
                action_type: FixType::RunCommand,
                label: "Install via Homebrew".to_string(),
                command: Some("brew install dotnet".to_string()),
                url: None,
            },
            FixAction {
                action_type: FixType::OpenUrl,
                label: "Download .NET for macOS".to_string(),
                command: None,
                url: Some("https://dotnet.microsoft.com/download/dotnet/8.0".to_string()),
            },
        ]
    }

    #[cfg(target_os = "windows")]
    {
        vec![
            FixAction {
                action_type: FixType::RunCommand,
                label: "Install via winget".to_string(),
                command: Some("winget install Microsoft.DotNet.SDK.8".to_string()),
                url: None,
            },
            FixAction {
                action_type: FixType::OpenUrl,
                label: "Download .NET for Windows".to_string(),
                command: None,
                url: Some("https://dotnet.microsoft.com/download/dotnet/8.0".to_string()),
            },
        ]
    }

    #[cfg(target_os = "linux")]
    {
        vec![
            FixAction {
                action_type: FixType::RunCommand,
                label: "Open Microsoft instructions".to_string(),
                command: None,
                url: Some("https://learn.microsoft.com/en-us/dotnet/core/install/linux".to_string()),
            },
            FixAction {
                action_type: FixType::OpenUrl,
                label: "Download .NET for Linux".to_string(),
                command: None,
                url: Some("https://dotnet.microsoft.com/download/dotnet/8.0".to_string()),
            },
        ]
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        vec![FixAction {
            action_type: FixType::OpenUrl,
            label: "Download .NET SDK".to_string(),
            command: None,
            url: Some("https://dotnet.microsoft.com/download".to_string()),
        }]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_missing_dotnet_issue() {
        let issue = create_missing_dotnet_issue();
        assert_eq!(issue.severity, IssueSeverity::Critical);
        assert_eq!(issue.provider_id, "dotnet");
        assert_eq!(issue.issue_type, IssueType::MissingTool);
        assert!(!issue.fixes.is_empty());
    }

    #[test]
    fn test_create_outdated_dotnet_issue() {
        let issue = create_outdated_dotnet_issue("5.0.401", "6.0.0");
        assert_eq!(issue.severity, IssueSeverity::Warning);
        assert_eq!(issue.current_value, Some("5.0.401".to_string()));
        assert_eq!(issue.expected_value, Some("6.0.0+".to_string()));
    }

    #[test]
    fn test_get_dotnet_install_fixes() {
        let fixes = get_dotnet_install_fixes();
        assert!(!fixes.is_empty());
    }
}
