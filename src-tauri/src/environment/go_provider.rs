// Go provider environment detection

use crate::environment::types::*;
use std::process::Command;

/// Minimum required Go version
const MIN_GO_VERSION: &str = "1.20";
const PROVIDER_ID: &str = "go";

/// Check Go installation
pub async fn check_go() -> Result<ProviderStatus, Box<dyn std::error::Error>> {
    let path = super::types::command_path("go");

    match Command::new("go").arg("version").output() {
        Ok(output) => {
            let version_str = parse_go_version(&output.stdout);

            let status = ProviderStatus {
                provider_id: PROVIDER_ID.to_string(),
                installed: true,
                version: Some(version_str),
                path,
            };

            Ok(status)
        }
        Err(_) => Ok(ProviderStatus {
            provider_id: PROVIDER_ID.to_string(),
            installed: false,
            version: None,
            path,
        }),
    }
}

/// Detect Go-specific issues
pub fn detect_go_issues(status: &ProviderStatus) -> Vec<EnvironmentIssue> {
    let mut issues = Vec::new();

    if !status.installed {
        issues.push(create_missing_go_issue());
        return issues;
    }

    let Some(version) = status.version.as_deref() else {
        return issues;
    };

    if super::types::parse_semver(version).is_some()
        && super::types::compare_versions(version, MIN_GO_VERSION) < 0
    {
        issues.push(create_outdated_go_issue(version, MIN_GO_VERSION));
    }

    issues
}

/// Parse Go version from command output
/// Output format: "go version go1.21.0 darwin/arm64"
fn parse_go_version(output: &[u8]) -> String {
    let output_str = String::from_utf8_lossy(output);
    output_str
        .lines()
        .find_map(|line| {
            if line.contains("go version") {
                // Extract version like "go1.21.0" from "go version go1.21.0 darwin/arm64"
                line.split_whitespace()
                    .find(|part| {
                        part.starts_with("go1")
                            || part.starts_with("go2")
                            || part.starts_with("go3")
                    })
                    .map(|s| s.trim_start_matches("go").to_string())
            } else {
                None
            }
        })
        .unwrap_or_else(|| "unknown".to_string())
}

/// Create issue for missing Go
pub fn create_missing_go_issue() -> EnvironmentIssue {
    EnvironmentIssue::new(
        IssueSeverity::Critical,
        PROVIDER_ID.to_string(),
        IssueType::MissingTool,
        "Go toolchain not found".to_string(),
    )
    .with_expected_value(format!("{}+", MIN_GO_VERSION))
    .with_current_value("not installed".to_string())
    .with_fixes(get_go_install_fixes())
}

/// Create issue for outdated Go
pub fn create_outdated_go_issue(current: &str, recommended: &str) -> EnvironmentIssue {
    EnvironmentIssue::new(
        IssueSeverity::Warning,
        PROVIDER_ID.to_string(),
        IssueType::OutdatedVersion,
        format!(
            "Go version outdated. Current: {}, Recommended: {}+",
            current, recommended
        ),
    )
    .with_current_value(current.to_string())
    .with_expected_value(format!("{}+", recommended))
    .with_fix(FixAction {
        action_type: FixType::OpenUrl,
        label: "Download Go".to_string(),
        command: None,
        url: Some("https://go.dev/dl/".to_string()),
    })
}

/// Get Go installation fixes for current platform
fn get_go_install_fixes() -> Vec<FixAction> {
    #[cfg(target_os = "macos")]
    {
        vec![
            FixAction {
                action_type: FixType::RunCommand,
                label: "Install via Homebrew".to_string(),
                command: Some("brew install go".to_string()),
                url: None,
            },
            FixAction {
                action_type: FixType::OpenUrl,
                label: "Download Go for macOS".to_string(),
                command: None,
                url: Some("https://go.dev/dl/".to_string()),
            },
        ]
    }

    #[cfg(target_os = "windows")]
    {
        vec![
            FixAction {
                action_type: FixType::RunCommand,
                label: "Install via winget".to_string(),
                command: Some("winget install GoLang.Go".to_string()),
                url: None,
            },
            FixAction {
                action_type: FixType::OpenUrl,
                label: "Download Go for Windows".to_string(),
                command: None,
                url: Some("https://go.dev/dl/".to_string()),
            },
        ]
    }

    #[cfg(target_os = "linux")]
    {
        vec![
            FixAction {
                action_type: FixType::CopyCommand,
                label: "Copy snap install command".to_string(),
                command: Some("snap install go --classic".to_string()),
                url: None,
            },
            FixAction {
                action_type: FixType::OpenUrl,
                label: "Download Go for Linux".to_string(),
                command: None,
                url: Some("https://go.dev/dl/".to_string()),
            },
        ]
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        vec![FixAction {
            action_type: FixType::OpenUrl,
            label: "Download Go".to_string(),
            command: None,
            url: Some("https://go.dev/dl/".to_string()),
        }]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_go_version() {
        let output = b"go version go1.21.0 darwin/arm64\n";
        assert_eq!(parse_go_version(output), "1.21.0");

        let output = b"go version go1.20.5 linux/amd64\n";
        assert_eq!(parse_go_version(output), "1.20.5");
    }

    #[test]
    fn test_create_missing_go_issue() {
        let issue = create_missing_go_issue();
        assert_eq!(issue.severity, IssueSeverity::Critical);
        assert_eq!(issue.provider_id, "go");
        assert_eq!(issue.issue_type, IssueType::MissingTool);
        assert!(!issue.fixes.is_empty());
    }

    #[test]
    fn test_create_outdated_go_issue() {
        let issue = create_outdated_go_issue("1.19.5", "1.20");
        assert_eq!(issue.severity, IssueSeverity::Warning);
        assert_eq!(issue.current_value, Some("1.19.5".to_string()));
        assert_eq!(issue.expected_value, Some("1.20+".to_string()));
    }

    #[test]
    fn test_get_go_install_fixes() {
        let fixes = get_go_install_fixes();
        assert!(!fixes.is_empty());
    }
}
