// Java provider environment detection

use crate::environment::types::*;
use std::process::Command;

/// Minimum required Java version
const MIN_JAVA_VERSION: &str = "11";
const PROVIDER_ID: &str = "java";

/// Check Java installation
pub async fn check_java() -> Result<ProviderStatus, Box<dyn std::error::Error>> {
    let path = super::types::command_path("java");

    match Command::new("java").arg("-version").output() {
        Ok(output) => {
            let version_str = parse_java_version(&output.stderr);

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

/// Detect Java-specific issues
pub fn detect_java_issues(status: &ProviderStatus) -> Vec<EnvironmentIssue> {
    let mut issues = Vec::new();

    if !status.installed {
        issues.push(create_missing_java_issue());
        return issues;
    }

    let Some(version) = status.version.as_deref() else {
        return issues;
    };

    let Ok(current_major) = version.parse::<u32>() else {
        return issues;
    };

    let Ok(min_major) = MIN_JAVA_VERSION.parse::<u32>() else {
        return issues;
    };

    if current_major < min_major {
        issues.push(create_outdated_java_issue(version, MIN_JAVA_VERSION));
    }

    issues
}

/// Parse Java version from command output
/// Output goes to stderr for `java -version`
/// Format: "openjdk version "17.0.2" 2022-01-18" or "java version "1.8.0_345""
fn parse_java_version(output: &[u8]) -> String {
    let output_str = String::from_utf8_lossy(output);
    output_str
        .lines()
        .find_map(|line| {
            if line.contains("version") {
                // Extract version like "17.0.2" or "1.8.0_345"
                let version = line
                    .split('"')
                    .nth(1)
                    .unwrap_or("")
                    .to_string();

                // Convert "1.8.0_345" to "8" for comparison
                if version.starts_with("1.") {
                    Some(
                        version
                            .split('.')
                            .nth(1)
                            .map(|v| v.to_string())
                            .unwrap_or_else(|| version.clone()),
                    )
                } else {
                    // For Java 9+, extract major version
                    Some(
                        version
                            .split('.')
                            .next()
                            .map(|v| v.to_string())
                            .unwrap_or_else(|| version.clone()),
                    )
                }
            } else {
                None
            }
        })
        .unwrap_or_else(|| "unknown".to_string())
}

/// Create issue for missing Java
pub fn create_missing_java_issue() -> EnvironmentIssue {
    EnvironmentIssue::new(
        IssueSeverity::Critical,
        PROVIDER_ID.to_string(),
        IssueType::MissingTool,
        "Java (JDK) not found".to_string(),
    )
    .with_expected_value(format!("{}+", MIN_JAVA_VERSION))
    .with_current_value("not installed".to_string())
    .with_fixes(get_java_install_fixes())
}

/// Create issue for outdated Java
pub fn create_outdated_java_issue(current: &str, recommended: &str) -> EnvironmentIssue {
    EnvironmentIssue::new(
        IssueSeverity::Warning,
        PROVIDER_ID.to_string(),
        IssueType::OutdatedVersion,
        format!("Java version outdated. Current: {}, Recommended: {}+", current, recommended),
    )
    .with_current_value(current.to_string())
    .with_expected_value(format!("{}+", recommended))
    .with_fix(FixAction {
        action_type: FixType::OpenUrl,
        label: "Download JDK".to_string(),
        command: None,
        url: Some("https://adoptium.net/".to_string()),
    })
}

/// Get Java installation fixes for current platform
fn get_java_install_fixes() -> Vec<FixAction> {
    #[cfg(target_os = "macos")]
    {
        vec![
            FixAction {
                action_type: FixType::RunCommand,
                label: "Install via Homebrew".to_string(),
                command: Some("brew install openjdk".to_string()),
                url: None,
            },
            FixAction {
                action_type: FixType::OpenUrl,
                label: "Download JDK for macOS".to_string(),
                command: None,
                url: Some("https://adoptium.net/".to_string()),
            },
        ]
    }

    #[cfg(target_os = "windows")]
    {
        vec![
            FixAction {
                action_type: FixType::RunCommand,
                label: "Install via winget".to_string(),
                command: Some("winget install EclipseAdoptium.Temurin.21.JDK".to_string()),
                url: None,
            },
            FixAction {
                action_type: FixType::OpenUrl,
                label: "Download JDK for Windows".to_string(),
                command: None,
                url: Some("https://adoptium.net/".to_string()),
            },
        ]
    }

    #[cfg(target_os = "linux")]
    {
        vec![
            FixAction {
                action_type: FixType::CopyCommand,
                label: "Copy apt install command".to_string(),
                command: Some("sudo apt install openjdk-17-jdk".to_string()),
                url: None,
            },
            FixAction {
                action_type: FixType::OpenUrl,
                label: "Download JDK for Linux".to_string(),
                command: None,
                url: Some("https://adoptium.net/".to_string()),
            },
        ]
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        vec![FixAction {
            action_type: FixType::OpenUrl,
            label: "Download JDK".to_string(),
            command: None,
            url: Some("https://adoptium.net/".to_string()),
        }]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_java_version() {
        let output = b"openjdk version \"17.0.2\" 2022-01-18\n";
        assert_eq!(parse_java_version(output), "17");

        let output = b"java version \"1.8.0_345\"\n";
        assert_eq!(parse_java_version(output), "8");

        let output = b"openjdk version \"11.0.15\" 2022-04-19\n";
        assert_eq!(parse_java_version(output), "11");
    }

    #[test]
    fn test_create_missing_java_issue() {
        let issue = create_missing_java_issue();
        assert_eq!(issue.severity, IssueSeverity::Critical);
        assert_eq!(issue.provider_id, "java");
        assert_eq!(issue.issue_type, IssueType::MissingTool);
        assert!(!issue.fixes.is_empty());
    }

    #[test]
    fn test_create_outdated_java_issue() {
        let issue = create_outdated_java_issue("8", "11");
        assert_eq!(issue.severity, IssueSeverity::Warning);
        assert_eq!(issue.current_value, Some("8".to_string()));
        assert_eq!(issue.expected_value, Some("11+".to_string()));
    }

    #[test]
    fn test_get_java_install_fixes() {
        let fixes = get_java_install_fixes();
        assert!(!fixes.is_empty());
    }
}
