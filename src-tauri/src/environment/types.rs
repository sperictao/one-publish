// Environment detection and probing for OnePublish
// Detects installed tooling and provides guided fixes

use serde::{Deserialize, Serialize};
use std::process::Command as StdCommand;

/// Severity level of environment issues
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum IssueSeverity {
    Critical, // Blocks publishing
    Warning,  // May cause issues
    Info,     // Suggestion
}

/// Type of environment issue
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum IssueType {
    MissingTool,
    OutdatedVersion,
    MissingDependency,
    IncompatibleVersion,
}

/// Type of fix action
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum FixType {
    OpenUrl,
    RunCommand,
    CopyCommand,
    Manual,
}

/// Fix action that user can apply
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixAction {
    pub action_type: FixType,
    pub label: String,
    pub command: Option<String>,
    pub url: Option<String>,
}

/// Result of applying a fix
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "result", content = "data")]
pub enum FixResult {
    OpenedUrl(String),
    CommandExecuted { stdout: String, stderr: String, exit_code: i32 },
    CopiedToClipboard(String),
    Manual(String),
}

/// Environment issue detected
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvironmentIssue {
    pub severity: IssueSeverity,
    pub provider_id: String,
    pub issue_type: IssueType,
    pub description: String,
    pub current_value: Option<String>,
    pub expected_value: Option<String>,
    pub fixes: Vec<FixAction>,
}

impl EnvironmentIssue {
    /// Create a new environment issue
    pub fn new(
        severity: IssueSeverity,
        provider_id: String,
        issue_type: IssueType,
        description: String,
    ) -> Self {
        Self {
            severity,
            provider_id,
            issue_type,
            description,
            current_value: None,
            expected_value: None,
            fixes: Vec::new(),
        }
    }

    /// Add current value
    pub fn with_current_value(mut self, value: String) -> Self {
        self.current_value = Some(value);
        self
    }

    /// Add expected value
    pub fn with_expected_value(mut self, value: String) -> Self {
        self.expected_value = Some(value);
        self
    }

    /// Add a fix action
    pub fn with_fix(mut self, fix: FixAction) -> Self {
        self.fixes.push(fix);
        self
    }

    /// Add multiple fix actions
    pub fn with_fixes(mut self, fixes: Vec<FixAction>) -> Self {
        self.fixes.extend(fixes);
        self
    }
}

/// Status of a provider in the environment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderStatus {
    pub provider_id: String,
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

/// Result of environment check
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvironmentCheckResult {
    pub is_ready: bool,
    pub providers: Vec<ProviderStatus>,
    pub issues: Vec<EnvironmentIssue>,
    pub checked_at: String,
}

impl EnvironmentCheckResult {
    /// Create a new environment check result
    pub fn new() -> Self {
        Self {
            is_ready: true,
            providers: Vec::new(),
            issues: Vec::new(),
            checked_at: chrono::Utc::now().to_rfc3339(),
        }
    }

    /// Add provider status
    pub fn with_provider(mut self, status: ProviderStatus) -> Self {
        let is_installed = status.installed;
        self.providers.push(status);
        if !is_installed {
            self.is_ready = false;
        }
        self
    }

    /// Add issue
    pub fn with_issue(mut self, issue: EnvironmentIssue) -> Self {
        if issue.severity == IssueSeverity::Critical {
            self.is_ready = false;
        }
        self.issues.push(issue);
        self
    }

    /// Check if environment is ready
    pub fn check_ready(&mut self) {
        self.is_ready = self
            .issues
            .iter()
            .all(|issue| issue.severity != IssueSeverity::Critical);
    }
}

impl Default for EnvironmentCheckResult {
    fn default() -> Self {
        Self::new()
    }
}

/// Parse version string from command output
pub fn parse_version(output: &[u8], prefix: &str) -> Option<String> {
    let output_str = String::from_utf8_lossy(output);
    output_str
        .lines()
        .find_map(|line| {
            if line.starts_with(prefix) {
                Some(
                    line.strip_prefix(prefix)
                        .unwrap()
                        .trim()
                        .split_whitespace()
                        .next()
                        .unwrap_or("")
                        .to_string(),
                )
            } else {
                None
            }
        })
        .filter(|s| !s.is_empty())
}

/// Check if a command is available in PATH
pub fn command_exists(command: &str) -> bool {
    StdCommand::new(command)
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .is_ok()
}

/// Get the path of a command
pub fn command_path(command: &str) -> Option<String> {
    #[cfg(unix)]
    {
        use std::env;
        env::var("PATH").ok().and_then(|paths| {
            env::split_paths(&paths).find_map(|dir| {
                let full_path = dir.join(command);
                if full_path.is_file() {
                    full_path.to_str().map(|s| s.to_string())
                } else {
                    None
                }
            })
        })
    }

    #[cfg(windows)]
    {
        use std::env;
        env::var("PATH").ok().and_then(|paths| {
            env::split_paths(&paths).find_map(|dir| {
                let full_path = dir.join(format!("{}.exe", command));
                if full_path.is_file() {
                    full_path.to_str().map(|s| s.to_string())
                } else {
                    None
                }
            })
        })
    }
}

/// Parse semantic version string
pub fn parse_semver(version: &str) -> Option<(u32, u32, u32)> {
    let clean_version = version
        .split_whitespace()
        .next()
        .unwrap_or(version)
        .trim_start_matches('v')
        .trim();

    let parts: Vec<&str> = clean_version.split('.').collect();
    if parts.len() >= 2 {
        let major = parts[0].parse::<u32>().ok()?;
        let minor = parts[1].parse::<u32>().ok()?;
        let patch = if parts.len() >= 3 {
            parts[2].parse::<u32>().ok()?
        } else {
            0
        };
        Some((major, minor, patch))
    } else {
        None
    }
}

/// Compare two semantic versions
/// Returns: -1 if v1 < v2, 0 if equal, 1 if v1 > v2
pub fn compare_versions(v1: &str, v2: &str) -> i32 {
    use std::cmp::Ordering;

    let parsed_v1 = parse_semver(v1);
    let parsed_v2 = parse_semver(v2);

    match (parsed_v1, parsed_v2) {
        (Some((m1, n1, p1)), Some((m2, n2, p2))) => {
            if m1 != m2 {
                match m1.cmp(&m2) {
                    Ordering::Less => -1,
                    Ordering::Equal => 0,
                    Ordering::Greater => 1,
                }
            } else if n1 != n2 {
                match n1.cmp(&n2) {
                    Ordering::Less => -1,
                    Ordering::Equal => 0,
                    Ordering::Greater => 1,
                }
            } else {
                match p1.cmp(&p2) {
                    Ordering::Less => -1,
                    Ordering::Equal => 0,
                    Ordering::Greater => 1,
                }
            }
        }
        (Some(_), None) => 1, // v1 is valid, v2 is invalid
        (None, Some(_)) => -1, // v1 is invalid, v2 is valid
        (None, None) => 0,     // both invalid
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_version() {
        let output = b"cargo 1.75.0 (187b4c3df 2023-12-22)\n";
        assert_eq!(parse_version(output, "cargo"), Some("1.75.0".to_string()));

        let output = b"dotnet 8.0.101\n";
        assert_eq!(parse_version(output, "dotnet"), Some("8.0.101".to_string()));
    }

    #[test]
    fn test_parse_semver() {
        assert_eq!(parse_semver("1.75.0"), Some((1, 75, 0)));
        assert_eq!(parse_semver("v1.75.0"), Some((1, 75, 0)));
        assert_eq!(parse_semver("1.75"), Some((1, 75, 0)));
        assert_eq!(parse_semver("invalid"), None);
    }

    #[test]
    fn test_compare_versions() {
        assert_eq!(compare_versions("1.75.0", "1.75.1"), -1);
        assert_eq!(compare_versions("1.75.0", "1.75.0"), 0);
        assert_eq!(compare_versions("1.76.0", "1.75.0"), 1);
        assert_eq!(compare_versions("1.75.0", "1.74.99"), 1);
    }

    #[test]
    fn test_environment_issue_builder() {
        let issue = EnvironmentIssue::new(
            IssueSeverity::Critical,
            "rust".to_string(),
            IssueType::MissingTool,
            "Cargo not found".to_string(),
        )
        .with_current_value("none".to_string())
        .with_expected_value("1.75.0+".to_string())
        .with_fix(FixAction {
            action_type: FixType::OpenUrl,
            label: "Open Download Page".to_string(),
            command: None,
            url: Some("https://rustup.rs/".to_string()),
        });

        assert_eq!(issue.severity, IssueSeverity::Critical);
        assert_eq!(issue.provider_id, "rust");
        assert_eq!(issue.fixes.len(), 1);
    }

    #[test]
    fn test_environment_check_result() {
        let mut result = EnvironmentCheckResult::new();

        assert!(result.is_ready);

        result = result.with_issue(EnvironmentIssue::new(
            IssueSeverity::Critical,
            "rust".to_string(),
            IssueType::MissingTool,
            "Cargo not found".to_string(),
        ));

        assert!(!result.is_ready);
    }
}
