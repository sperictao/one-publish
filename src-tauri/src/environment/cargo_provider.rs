// Rust/Cargo provider environment detection

use crate::environment::types::*;
use std::process::Command;

/// Minimum required cargo version
const MIN_CARGO_VERSION: &str = "1.70.0";
const PROVIDER_ID: &str = "cargo";

/// Check Rust/Cargo installation
pub async fn check_cargo() -> Result<ProviderStatus, Box<dyn std::error::Error>> {
    let path = super::types::command_path("cargo");

    match Command::new("cargo").arg("--version").output() {
        Ok(output) => {
            let version_str = super::types::parse_version(&output.stdout, "cargo")
                .unwrap_or_else(|| "unknown".to_string());

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

/// Detect Cargo-specific issues
pub fn detect_cargo_issues(status: &ProviderStatus) -> Vec<EnvironmentIssue> {
    let mut issues = Vec::new();

    if !status.installed {
        issues.push(create_missing_cargo_issue());
        return issues;
    }

    let Some(version) = status.version.as_deref() else {
        return issues;
    };

    // Check version
    if super::types::parse_semver(version).is_some()
        && super::types::compare_versions(version, MIN_CARGO_VERSION) < 0
    {
        issues.push(create_outdated_cargo_issue(version, MIN_CARGO_VERSION));
    }

    issues
}

/// Create issue for missing cargo
fn create_missing_cargo_issue() -> EnvironmentIssue {
    EnvironmentIssue::new(
        IssueSeverity::Critical,
        PROVIDER_ID.to_string(),
        IssueType::MissingTool,
        "Rust toolchain (cargo) not found".to_string(),
    )
    .with_expected_value(format!("{}+", MIN_CARGO_VERSION))
    .with_current_value("not installed".to_string())
    .with_fixes(get_cargo_install_fixes())
}

/// Create issue for outdated cargo
fn create_outdated_cargo_issue(current: &str, recommended: &str) -> EnvironmentIssue {
    EnvironmentIssue::new(
        IssueSeverity::Warning,
        PROVIDER_ID.to_string(),
        IssueType::OutdatedVersion,
        format!(
            "cargo version outdated. Current: {}, Recommended: {}+",
            current, recommended
        ),
    )
    .with_current_value(current.to_string())
    .with_expected_value(format!("{}+", recommended))
    .with_fix(FixAction {
        action_type: FixType::RunCommand,
        label: "Update via rustup".to_string(),
        command: Some("rustup update".to_string()),
        url: None,
    })
}

/// Get cargo installation fixes for current platform
fn get_cargo_install_fixes() -> Vec<FixAction> {
    #[cfg(target_os = "macos")]
    {
        vec![
            FixAction {
                action_type: FixType::RunCommand,
                label: "Install via Homebrew".to_string(),
                command: Some("brew install rust".to_string()),
                url: None,
            },
            FixAction {
                action_type: FixType::CopyCommand,
                label: "Copy rustup install command".to_string(),
                command: Some(
                    "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh".to_string(),
                ),
                url: None,
            },
            FixAction {
                action_type: FixType::OpenUrl,
                label: "Open rustup.rs".to_string(),
                command: None,
                url: Some("https://rustup.rs/".to_string()),
            },
        ]
    }

    #[cfg(target_os = "windows")]
    {
        vec![
            FixAction {
                action_type: FixType::RunCommand,
                label: "Install via winget".to_string(),
                command: Some("winget install Rustlang.Rustup".to_string()),
                url: None,
            },
            FixAction {
                action_type: FixType::OpenUrl,
                label: "Download Installer".to_string(),
                command: None,
                url: Some("https://rustup.rs/".to_string()),
            },
        ]
    }

    #[cfg(target_os = "linux")]
    {
        vec![
            FixAction {
                action_type: FixType::CopyCommand,
                label: "Copy rustup install command".to_string(),
                command: Some(
                    "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh".to_string(),
                ),
                url: None,
            },
            FixAction {
                action_type: FixType::OpenUrl,
                label: "Open rustup.rs".to_string(),
                command: None,
                url: Some("https://rustup.rs/".to_string()),
            },
        ]
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        vec![FixAction {
            action_type: FixType::OpenUrl,
            label: "Open rustup.rs".to_string(),
            command: None,
            url: Some("https://rustup.rs/".to_string()),
        }]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_missing_cargo_issue() {
        let issue = create_missing_cargo_issue();
        assert_eq!(issue.severity, IssueSeverity::Critical);
        assert_eq!(issue.provider_id, "cargo");
        assert_eq!(issue.issue_type, IssueType::MissingTool);
        assert!(!issue.fixes.is_empty());
    }

    #[test]
    fn test_create_outdated_cargo_issue() {
        let issue = create_outdated_cargo_issue("1.68.0", "1.70.0");
        assert_eq!(issue.severity, IssueSeverity::Warning);
        assert_eq!(issue.current_value, Some("1.68.0".to_string()));
        assert_eq!(issue.expected_value, Some("1.70.0+".to_string()));
    }

    #[test]
    fn test_get_cargo_install_fixes() {
        let fixes = get_cargo_install_fixes();
        assert!(!fixes.is_empty());
        // Check that at least one fix is provided
        assert!(fixes
            .iter()
            .any(|f| f.action_type == FixType::RunCommand || f.action_type == FixType::OpenUrl));
    }
}
