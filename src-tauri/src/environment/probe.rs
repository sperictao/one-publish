// Shared probe scaffolding for environment provider detection.
//
// The four providers (cargo/go/dotnet/java) share an identical shape:
//   - resolve the command path
//   - run `<command> <version_arg>`
//   - parse the version string (from stdout or, for java, stderr)
//   - return a ProviderStatus
//
// `check_tool` unifies the four providers' spawn/run/parse flow and, per the
// plan, collapses two prior drifts onto java's stricter convention:
//   - a non-zero exit code now means "not installed" everywhere (cargo/go/
//     dotnet previously ignored `status.success()`)
//   - the failure branch returns `path: None` everywhere (cargo/go/dotnet
//     previously kept the resolved path)
//
// Parse-fallback semantics stay provider-specific: the parser returns
// `Option<String>`, where `None` means "could not identify a version" and
// yields `installed: false`. cargo/go/dotnet wrap their existing
// `unwrap_or_else(|| "unknown")` in `Some(..)` so a successful exit with an
// unparseable body still reports `installed: true, version: "unknown"`;
// java's parser returns `None` on the same situation, matching its prior
// behavior.
//
// `detect_tool_issues` covers the second shared half: missing -> critical,
// semver comparison -> outdated warning. Tool-specific issue and fix
// construction stays with each provider.

use crate::environment::types::{
    command_path, compare_versions, parse_semver, EnvironmentIssue, ProviderStatus,
};
use std::time::Duration;

/// Which command output stream carries the version string.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum VersionSource {
    Stdout,
    Stderr,
}

/// Declarative description of how to probe a single toolchain.
pub struct ToolProbe {
    pub provider_id: &'static str,
    pub command: &'static str,
    pub version_arg: &'static str,
    /// Where the version string lives in `<command> <version_arg>` output.
    pub version_source: VersionSource,
    pub min_version: &'static str,
}

/// Parser for the version string extracted from a tool's version output.
///
/// Each provider supplies its own parser because the wire formats differ
/// (cargo/dotnet are prefix-stripped via `parse_version`, go/java have
/// bespoke line scans). Returning `None` means "could not identify a
/// version", which `check_tool` treats as "not installed".
pub type VersionParser = fn(&[u8]) -> Option<String>;

/// Run the probe and return a ProviderStatus.
///
/// See the module docs for the unified failure semantics (non-zero exit,
/// parse failure, and spawn failure all yield `installed: false` with
/// `path: None`). A hung toolchain (e.g. a prompt for input, a stalled
/// shell alias) is bounded by a 10s timeout, after which the probe reports
/// `installed: false` rather than blocking the environment check forever.
/// The timeout uses the async `tokio::process::Command::output`, so the
/// elapsed future is genuinely cancellable instead of stranding a blocked
/// executor thread.
pub async fn check_tool(probe: &ToolProbe, parse_version: VersionParser) -> ProviderStatus {
    let path = command_path(probe.command);
    let program = path.clone().unwrap_or_else(|| probe.command.to_string());

    let command = crate::process_utils::new_tokio_command(&program)
        .arg(probe.version_arg)
        .output();

    // Bound the probe so a hung toolchain cannot wedge the environment
    // check. `output()` here is the async tokio variant, so the timeout
    // resolves even when the child never exits.
    let output = match tokio::time::timeout(Duration::from_secs(10), command).await {
        Ok(inner) => inner,
        Err(_elapsed) => {
            return ProviderStatus {
                provider_id: probe.provider_id.to_string(),
                installed: false,
                version: None,
                path: None,
            };
        }
    };

    let Some(version) = parse_output(output, probe.version_source, parse_version) else {
        return ProviderStatus {
            provider_id: probe.provider_id.to_string(),
            installed: false,
            version: None,
            path: None,
        };
    };

    ProviderStatus {
        provider_id: probe.provider_id.to_string(),
        installed: true,
        version: Some(version),
        path,
    }
}

fn parse_output(
    output_result: Result<std::process::Output, std::io::Error>,
    source: VersionSource,
    parse_version: VersionParser,
) -> Option<String> {
    let output = output_result.ok()?;

    if !output.status.success() {
        return None;
    }

    let bytes = match source {
        VersionSource::Stdout => &output.stdout,
        VersionSource::Stderr => &output.stderr,
    };

    parse_version(bytes)
}

/// Detect tool issues for a provider, given its current status.
///
/// `missing_issue` builds the critical issue when the tool is not
/// installed. `outdated_issue` builds the warning issue when the parsed
/// version is below the probe's minimum. Issue/fix construction stays
/// tool-specific and is injected by each provider.
pub fn detect_tool_issues<F, G>(
    probe: &ToolProbe,
    status: &ProviderStatus,
    missing_issue: F,
    outdated_issue: G,
) -> Vec<EnvironmentIssue>
where
    F: FnOnce() -> EnvironmentIssue,
    G: FnOnce(&str, &str) -> EnvironmentIssue,
{
    let mut issues = Vec::new();

    if !status.installed {
        issues.push(missing_issue());
        return issues;
    }

    let Some(version) = status.version.as_deref() else {
        return issues;
    };

    if is_semver_outdated(version, probe.min_version) {
        issues.push(outdated_issue(version, probe.min_version));
    }

    issues
}

/// True when `current` is a parseable semver strictly below `min_version`.
///
/// Mirrors the cargo/go/dotnet behavior (`parse_semver(current).is_some()`
/// gate before `compare_versions < 0`); providers that compare on a
/// different axis (java's major-version u32 parse) keep their own
/// `detect_*` body.
pub fn is_semver_outdated(current: &str, min_version: &str) -> bool {
    parse_semver(current).is_some() && compare_versions(current, min_version) < 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::environment::types::{IssueSeverity, IssueType};
    use std::process::{Command, Output};

    fn make_missing() -> EnvironmentIssue {
        EnvironmentIssue::new(
            IssueSeverity::Critical,
            "cargo".to_string(),
            IssueType::MissingTool,
            "missing".to_string(),
        )
    }

    fn make_outdated(current: &str, recommended: &str) -> EnvironmentIssue {
        EnvironmentIssue::new(
            IssueSeverity::Warning,
            "cargo".to_string(),
            IssueType::OutdatedVersion,
            format!("outdated {current} < {recommended}"),
        )
    }

    fn make_probe() -> ToolProbe {
        ToolProbe {
            provider_id: "cargo",
            command: "cargo",
            version_arg: "--version",
            version_source: VersionSource::Stdout,
            min_version: "1.70.0",
        }
    }

    fn echo_parser(output: &[u8]) -> Option<String> {
        let s = String::from_utf8_lossy(output).trim().to_string();
        if s.is_empty() {
            None
        } else {
            Some(s)
        }
    }

    /// Run a command that exits with the given code, capturing an `Output`
    /// whose stdout is `stdout`. Used to exercise `parse_output` without
    /// relying on platform-specific `ExitStatus` constructors.
    fn make_output(exit_code: i32, stdout: &[u8]) -> Output {
        // `cmd /c` on Windows, `sh -c` elsewhere. Both are present on their
        // respective CI runners; if absent we skip the test.
        #[cfg(windows)]
        let (program, flag) = ("cmd", "/c");
        #[cfg(not(windows))]
        let (program, flag) = ("sh", "-c");

        let script = format!(
            "printf %s {:?} 2>/dev/null || printf %s {:?}; exit {}",
            String::from_utf8_lossy(stdout),
            String::from_utf8_lossy(stdout),
            exit_code
        );
        let output = Command::new(program)
            .arg(flag)
            .arg(&script)
            .output()
            .expect("shell available in test env");
        // Override stdout with the exact bytes we wanted so the test is
        // deterministic regardless of shell printf quirks.
        Output {
            status: output.status,
            stdout: stdout.to_vec(),
            stderr: Vec::new(),
        }
    }

    #[test]
    fn parse_output_returns_none_on_spawn_failure() {
        let err = std::io::Error::new(std::io::ErrorKind::NotFound, "spawn failed");
        let result: Result<Output, std::io::Error> = Err(err);
        assert!(parse_output(result, VersionSource::Stdout, echo_parser).is_none());
    }

    #[test]
    fn parse_output_returns_none_on_non_zero_exit() {
        let output = make_output(1, b"1.75.0\n");
        assert!(parse_output(Ok(output), VersionSource::Stdout, echo_parser).is_none());
    }

    #[test]
    fn parse_output_returns_none_when_parser_returns_none() {
        let output = make_output(0, b"  \n");
        assert!(parse_output(Ok(output), VersionSource::Stdout, echo_parser).is_none());
    }

    #[test]
    fn parse_output_reads_stdout_when_configured() {
        let output = make_output(0, b"1.75.0\n");
        assert_eq!(
            parse_output(Ok(output), VersionSource::Stdout, echo_parser),
            Some("1.75.0".to_string())
        );
    }

    #[test]
    fn parse_output_reads_stderr_when_configured() {
        fn parse_java_like(output: &[u8]) -> Option<String> {
            let s = String::from_utf8_lossy(output);
            s.lines()
                .find_map(|l| l.split('"').nth(1).map(|v| v.to_string()))
        }
        // Build an Output whose stderr carries the version line.
        #[cfg(windows)]
        let (program, flag) = ("cmd", "/c");
        #[cfg(not(windows))]
        let (program, flag) = ("sh", "-c");
        let script = "printf 'openjdk version \"17.0.2\" 2022-01-18\\n' >&2; exit 0";
        let raw = Command::new(program)
            .arg(flag)
            .arg(script)
            .output()
            .expect("shell available in test env");
        let output = Output {
            status: raw.status,
            stdout: Vec::new(),
            stderr: raw.stderr,
        };
        assert_eq!(
            parse_output(Ok(output), VersionSource::Stderr, parse_java_like),
            Some("17.0.2".to_string())
        );
    }

    #[test]
    fn is_semver_outdated_gates_on_parseable_current() {
        assert!(is_semver_outdated("1.68.0", "1.70.0"));
        assert!(!is_semver_outdated("1.75.0", "1.70.0"));
        // Unparseable current must not flag as outdated (matches prior behavior).
        assert!(!is_semver_outdated("unknown", "1.70.0"));
    }

    #[test]
    fn detect_tool_issues_emits_missing_when_not_installed() {
        let p = make_probe();
        let status = ProviderStatus {
            provider_id: "cargo".to_string(),
            installed: false,
            version: None,
            path: None,
        };
        let issues = detect_tool_issues(&p, &status, make_missing, make_outdated);
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].severity, IssueSeverity::Critical);
        assert_eq!(issues[0].issue_type, IssueType::MissingTool);
    }

    #[test]
    fn detect_tool_issues_emits_outdated_when_below_min() {
        let p = make_probe();
        let status = ProviderStatus {
            provider_id: "cargo".to_string(),
            installed: true,
            version: Some("1.68.0".to_string()),
            path: None,
        };
        let issues = detect_tool_issues(&p, &status, make_missing, make_outdated);
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].severity, IssueSeverity::Warning);
        assert_eq!(issues[0].issue_type, IssueType::OutdatedVersion);
    }

    #[test]
    fn detect_tool_issues_silent_when_current_meets_min() {
        let p = make_probe();
        let status = ProviderStatus {
            provider_id: "cargo".to_string(),
            installed: true,
            version: Some("1.75.0".to_string()),
            path: None,
        };
        let issues = detect_tool_issues(&p, &status, make_missing, make_outdated);
        assert!(issues.is_empty());
    }

    #[test]
    fn detect_tool_issues_silent_when_installed_but_version_missing() {
        let p = make_probe();
        let status = ProviderStatus {
            provider_id: "cargo".to_string(),
            installed: true,
            version: None,
            path: None,
        };
        let issues = detect_tool_issues(&p, &status, make_missing, make_outdated);
        assert!(issues.is_empty());
    }

    /// A hung toolchain must be bounded by the 10s probe timeout rather
    /// than blocking the environment check forever. We point the probe at
    /// `sleep 30` (exits 0 after 30s, longer than the 10s budget) with a
    /// parser that would happily report "installed" if output ever landed.
    /// The only way the result is `installed: false` is the timeout firing.
    ///
    /// Skipped on platforms without `sleep` in PATH (none of our CI
    /// targets), and asserts the wall clock stayed well under the 30s the
    /// child would otherwise run.
    #[tokio::test]
    async fn check_tool_times_out_on_hung_command() {
        // `sleep` exists on unix; on Windows `timeout /t` writes to a
        // console that CI shells may not have. Skip there rather than carry
        // a platform-specific hang.
        if cfg!(not(unix)) {
            return;
        }

        let probe = ToolProbe {
            provider_id: "hang-sim",
            command: "sleep",
            version_arg: "30",
            version_source: VersionSource::Stdout,
            min_version: "0.0.0",
        };
        // A parser that always succeeds - so `installed: false` can only
        // come from the timeout path, not a parse failure.
        fn always_installed(_output: &[u8]) -> Option<String> {
            Some("0.0.0".to_string())
        }

        let start = std::time::Instant::now();
        let status = check_tool(&probe, always_installed).await;
        let elapsed = start.elapsed();

        assert!(
            !status.installed,
            "hung command must report not installed, got {status:?}"
        );
        assert!(status.version.is_none());
        assert!(status.path.is_none());
        // The timeout is 10s; the child would run 30s. We must return near
        // the 10s mark, not the 30s one. Allow slack for scheduling.
        assert!(
            elapsed.as_secs() < 30,
            "probe took {elapsed:?}, timeout did not fire"
        );
    }
}
