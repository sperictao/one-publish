// Environment detection and probing for OnePublish
// Detects installed tooling and provides guided fixes

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use ts_rs::TS;

/// Severity level of environment issues
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[serde(rename_all = "lowercase")]
#[ts(rename_all = "lowercase")]
pub enum IssueSeverity {
    Critical, // Blocks publishing
    Warning,  // May cause issues
    Info,     // Suggestion
}

/// Type of environment issue
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum IssueType {
    MissingTool,
    OutdatedVersion,
    MissingDependency,
    IncompatibleVersion,
}

/// Type of fix action
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum FixType {
    OpenUrl,
    RunCommand,
    CopyCommand,
    Manual,
}

/// Fix action that user can apply
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct FixAction {
    pub action_type: FixType,
    pub label: String,
    pub command: Option<String>,
    pub url: Option<String>,
}

/// Result of applying a fix
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "result", content = "data")]
pub enum FixResult {
    OpenedUrl(String),
    CommandExecuted {
        stdout: String,
        stderr: String,
        exit_code: i32,
    },
    CopiedToClipboard(String),
    Manual(String),
}

/// Environment issue detected
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
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
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ProviderStatus {
    pub provider_id: String,
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

/// Result of environment check
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
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
            .all(|issue| issue.severity != IssueSeverity::Critical)
            && self.providers.iter().all(|p| p.installed);
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
    output_str.lines().find_map(|line| {
        line.strip_prefix(prefix).and_then(|stripped| {
            let version = stripped.split_whitespace().next().unwrap_or("").to_string();
            (!version.is_empty()).then_some(version)
        })
    })
}

/// Check if a command is available in PATH
pub fn command_exists(command: &str) -> bool {
    let resolved = resolve_command_path(command).unwrap_or_else(|| PathBuf::from(command));
    crate::process_utils::new_std_command(resolved)
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .is_ok()
}

fn executable_name(command: &str) -> String {
    #[cfg(windows)]
    {
        if command.to_ascii_lowercase().ends_with(".exe") {
            command.to_string()
        } else {
            format!("{}.exe", command)
        }
    }

    #[cfg(not(windows))]
    {
        command.to_string()
    }
}

fn has_explicit_path(command: &str) -> bool {
    let path = Path::new(command);
    path.is_absolute() || path.components().count() > 1
}

fn find_command_in_dirs(command: &str, dirs: &[PathBuf]) -> Option<PathBuf> {
    let executable = executable_name(command);
    dirs.iter()
        .map(|dir| dir.join(&executable))
        .find(|path| path.is_file())
}

fn env_search_dirs() -> Vec<PathBuf> {
    std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).collect())
        .unwrap_or_default()
}

fn append_candidate(candidates: &mut Vec<PathBuf>, candidate: Option<PathBuf>) {
    if let Some(candidate) = candidate {
        candidates.push(candidate);
    }
}

fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut deduped = Vec::new();
    for path in paths {
        if !deduped.iter().any(|existing| existing == &path) {
            deduped.push(path);
        }
    }
    deduped
}

fn env_command_candidate(var_name: &str, command: &str) -> Option<PathBuf> {
    let value = std::env::var_os(var_name)?;
    let path = PathBuf::from(value);
    let executable = executable_name(command);
    if path.file_name().and_then(|name| name.to_str()) == Some(executable.as_str()) {
        Some(path)
    } else {
        Some(path.join(executable))
    }
}

fn fallback_command_candidates(command: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    #[cfg(unix)]
    {
        match command {
            "dotnet" => {
                append_candidate(
                    &mut candidates,
                    env_command_candidate("DOTNET_ROOT", command),
                );
                candidates.push(PathBuf::from("/opt/homebrew/bin/dotnet"));
                candidates.push(PathBuf::from("/usr/local/bin/dotnet"));
                candidates.push(PathBuf::from("/usr/local/share/dotnet/dotnet"));
                candidates.push(PathBuf::from("/usr/share/dotnet/dotnet"));
            }
            "cargo" => {
                append_candidate(
                    &mut candidates,
                    env_command_candidate("CARGO_HOME", command),
                );
                if let Some(home_dir) = dirs::home_dir() {
                    candidates.push(home_dir.join(".cargo").join("bin").join("cargo"));
                }
                candidates.push(PathBuf::from("/opt/homebrew/bin/cargo"));
                candidates.push(PathBuf::from("/usr/local/bin/cargo"));
            }
            "go" => {
                append_candidate(&mut candidates, env_command_candidate("GOROOT", command));
                candidates.push(PathBuf::from("/usr/local/go/bin/go"));
                candidates.push(PathBuf::from("/opt/homebrew/bin/go"));
                candidates.push(PathBuf::from("/usr/local/bin/go"));
            }
            "java" => {
                append_candidate(&mut candidates, env_command_candidate("JAVA_HOME", command));
                candidates.push(PathBuf::from("/usr/bin/java"));
                candidates.push(PathBuf::from("/opt/homebrew/bin/java"));
                candidates.push(PathBuf::from("/usr/local/bin/java"));
            }
            "brew" => {
                candidates.push(PathBuf::from("/opt/homebrew/bin/brew"));
                candidates.push(PathBuf::from("/usr/local/bin/brew"));
            }
            "rustup" => {
                append_candidate(
                    &mut candidates,
                    env_command_candidate("CARGO_HOME", command),
                );
                if let Some(home_dir) = dirs::home_dir() {
                    candidates.push(home_dir.join(".cargo").join("bin").join("rustup"));
                }
                candidates.push(PathBuf::from("/opt/homebrew/bin/rustup"));
                candidates.push(PathBuf::from("/usr/local/bin/rustup"));
            }
            _ => {}
        }
    }

    #[cfg(windows)]
    {
        match command {
            "dotnet" => {
                append_candidate(
                    &mut candidates,
                    env_command_candidate("DOTNET_ROOT", command),
                );
                append_candidate(
                    &mut candidates,
                    env_command_candidate("DOTNET_ROOT(x86)", command),
                );
                candidates.push(PathBuf::from(r"C:\Program Files\dotnet\dotnet.exe"));
                candidates.push(PathBuf::from(r"C:\Program Files (x86)\dotnet\dotnet.exe"));
            }
            "cargo" | "rustup" => {
                append_candidate(
                    &mut candidates,
                    env_command_candidate("CARGO_HOME", command),
                );
                if let Some(home_dir) = dirs::home_dir() {
                    candidates.push(
                        home_dir
                            .join(".cargo")
                            .join("bin")
                            .join(executable_name(command)),
                    );
                }
            }
            "go" => {
                append_candidate(&mut candidates, env_command_candidate("GOROOT", command));
                candidates.push(PathBuf::from(r"C:\Program Files\Go\bin\go.exe"));
            }
            "java" => {
                append_candidate(&mut candidates, env_command_candidate("JAVA_HOME", command));
            }
            "winget" => {
                candidates.push(PathBuf::from(
                    r"C:\Users\Default\AppData\Local\Microsoft\WindowsApps\winget.exe",
                ));
            }
            _ => {}
        }
    }

    candidates
}

#[cfg(unix)]
fn resolve_command_via_login_shell(command: &str) -> Option<(PathBuf, String)> {
    if !command
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.')
    {
        return None;
    }

    let shells = [
        std::env::var_os("SHELL").map(PathBuf::from),
        Some(PathBuf::from("/bin/zsh")),
        Some(PathBuf::from("/bin/bash")),
        Some(PathBuf::from("/bin/sh")),
    ];

    for shell in shells.into_iter().flatten() {
        if !shell.is_file() {
            continue;
        }

        let shell_display = shell.to_string_lossy().to_string();

        let Ok(output) = crate::process_utils::new_std_command(&shell)
            .arg("-lc")
            .arg(format!("command -v {}", command))
            .output()
        else {
            continue;
        };

        if !output.status.success() {
            continue;
        }

        let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
        let resolved = stdout
            .lines()
            .next()
            .map(str::trim)
            .filter(|value| !value.is_empty())?;
        let resolved_path = PathBuf::from(resolved);
        if resolved_path.is_file() {
            return Some((resolved_path, shell_display));
        }
    }

    None
}

#[cfg(windows)]
fn resolve_command_via_shell(command: &str) -> Option<PathBuf> {
    let output = crate::process_utils::new_std_command("where")
        .arg(command)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .find(|path| path.is_file())
}

/// Resolve a command path for packaged GUI processes that may not inherit shell PATH.
pub fn resolve_command_path(command: &str) -> Option<PathBuf> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return None;
    }

    if has_explicit_path(trimmed) {
        let explicit = PathBuf::from(trimmed);
        if explicit.is_file() {
            return Some(explicit);
        }
        log::warn!(
            "command resolution failed: command={} explicit_path={} exists=false",
            trimmed,
            explicit.to_string_lossy()
        );
        return None;
    }

    let env_dirs = env_search_dirs();
    if let Some(path) = find_command_in_dirs(trimmed, &env_dirs) {
        return Some(path);
    }

    let fallback_candidates = dedupe_paths(fallback_command_candidates(trimmed));
    for candidate in &fallback_candidates {
        if candidate.is_file() {
            log::info!(
                "command resolution fallback hit: command={} source=fallback candidate={}",
                trimmed,
                candidate.to_string_lossy()
            );
            return Some(candidate.to_path_buf());
        }
    }

    #[cfg(unix)]
    {
        if let Some((resolved_path, shell_display)) = resolve_command_via_login_shell(trimmed) {
            log::info!(
                "command resolution fallback hit: command={} source=login_shell shell={} path={}",
                trimmed,
                shell_display,
                resolved_path.to_string_lossy()
            );
            return Some(resolved_path);
        }
    }

    #[cfg(windows)]
    {
        if let Some(resolved_path) = resolve_command_via_shell(trimmed) {
            log::info!(
                "command resolution fallback hit: command={} source=where path={}",
                trimmed,
                resolved_path.to_string_lossy()
            );
            return Some(resolved_path);
        }
    }

    let fallback_list = fallback_candidates
        .iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join(", ");
    let path_env = std::env::var("PATH").unwrap_or_default();
    let dotnet_root = std::env::var("DOTNET_ROOT").ok();
    let dotnet_root_x86 = std::env::var("DOTNET_ROOT(x86)").ok();
    let cargo_home = std::env::var("CARGO_HOME").ok();
    let go_root = std::env::var("GOROOT").ok();
    let java_home = std::env::var("JAVA_HOME").ok();

    log::warn!(
        "command resolution failed: command={} path_env={} dotnet_root={:?} dotnet_root_x86={:?} cargo_home={:?} go_root={:?} java_home={:?} fallback_candidates=[{}]",
        trimmed,
        path_env,
        dotnet_root,
        dotnet_root_x86,
        cargo_home,
        go_root,
        java_home,
        fallback_list
    );

    None
}

/// Get the path of a command
pub fn command_path(command: &str) -> Option<String> {
    resolve_command_path(command).and_then(|path| path.to_str().map(|s| s.to_string()))
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
        (Some(_), None) => 1,  // v1 is valid, v2 is invalid
        (None, Some(_)) => -1, // v1 is invalid, v2 is valid
        (None, None) => 0,     // both invalid
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

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

    #[test]
    fn test_check_ready_considers_provider_installation() {
        let mut result = EnvironmentCheckResult::new();

        result = result.with_provider(ProviderStatus {
            provider_id: "dotnet".to_string(),
            installed: false,
            version: None,
            path: None,
        });

        result.check_ready();
        assert!(!result.is_ready);
    }

    #[test]
    fn test_find_command_in_dirs_uses_matching_executable_name() {
        let temp_dir = TempDir::new().expect("temp dir");
        let executable = temp_dir.path().join(executable_name("dotnet"));
        std::fs::write(&executable, b"").expect("write executable");

        let resolved =
            find_command_in_dirs("dotnet", &[temp_dir.path().to_path_buf()]).expect("resolve");

        assert_eq!(resolved, executable);
    }

    #[test]
    fn test_resolve_command_path_accepts_explicit_existing_path() {
        let temp_dir = TempDir::new().expect("temp dir");
        let executable = temp_dir.path().join(executable_name("tool"));
        std::fs::write(&executable, b"").expect("write executable");

        let resolved = resolve_command_path(executable.to_string_lossy().as_ref())
            .expect("resolve explicit path");

        assert_eq!(resolved, executable);
    }
}
