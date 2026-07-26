// .NET provider environment detection

use crate::environment::probe::{check_tool, detect_tool_issues, ToolProbe, VersionSource};
use crate::environment::types::*;
/// Minimum required .NET SDK version
const MIN_DOTNET_VERSION: &str = "6.0.0";
const PROVIDER_ID: &str = "dotnet";

const DOTNET_PROBE: ToolProbe = ToolProbe {
    provider_id: PROVIDER_ID,
    command: "dotnet",
    version_arg: "--version",
    version_source: VersionSource::Stdout,
    min_version: MIN_DOTNET_VERSION,
};

/// Parse dotnet `--version` stdout into a version string.
///
/// Returns `Some("unknown")` rather than `None` when the prefix doesn't
/// match, preserving the prior fallback that reported `installed: true`
/// with `version: "unknown"` on a successful-but-unparseable run. The
/// empty prefix matches any first whitespace-delimited token, matching
/// the prior `parse_version(&output.stdout, "")` call.
fn parse_dotnet_version(output: &[u8]) -> Option<String> {
    Some(parse_version(output, "").unwrap_or_else(|| "unknown".to_string()))
}

/// Check .NET SDK installation
pub async fn check_dotnet() -> ProviderStatus {
    check_tool(&DOTNET_PROBE, parse_dotnet_version).await
}

/// Detect .NET-specific issues
pub fn detect_dotnet_issues(status: &ProviderStatus) -> Vec<EnvironmentIssue> {
    detect_tool_issues(
        &DOTNET_PROBE,
        status,
        create_missing_dotnet_issue,
        create_outdated_dotnet_issue,
    )
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
        format!(
            ".NET SDK version outdated. Current: {}, Recommended: {}+",
            current, recommended
        ),
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
                action_type: FixType::OpenUrl,
                label: "Open Microsoft instructions".to_string(),
                command: None,
                url: Some(
                    "https://learn.microsoft.com/en-us/dotnet/core/install/linux".to_string(),
                ),
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
