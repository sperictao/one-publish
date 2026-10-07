// Tauri provider environment detection
//
// A Tauri 2 desktop build spans several toolchains: Node.js and a JS package
// manager for the frontend and the Tauri CLI, cargo for the Rust side, and a
// per-OS system prerequisite. Each piece reuses the shared probe scaffolding;
// the per-tool statuses stay internal and are named after their tool, while
// the reported status and every issue carry the `tauri` provider id because
// both the environment dialog and the publish preflight scope by provider id.

use crate::environment::cargo_provider::{self, CARGO_PROBE};
use crate::environment::probe::{
    check_tool, detect_tool_issues, ToolProbe, VersionParser, VersionSource,
};
use crate::environment::types::*;
use publish_adapters::tauri::TauriBuildDriver;

const PROVIDER_ID: &str = "tauri";

/// Node 18 is end-of-life and the managed GitHub Actions workflow builds with
/// Node 20, so an older local runtime diverges from the remote build.
const MIN_NODE_VERSION: &str = "20.0.0";
/// Presence-only probes: any version satisfies them.
const NO_MIN_VERSION: &str = "0.0.0";

const NODE_DOWNLOAD_URL: &str = "https://nodejs.org/en/download";
const PNPM_INSTALL_URL: &str = "https://pnpm.io/installation";
const TAURI_LINUX_PREREQUISITES_URL: &str = "https://v2.tauri.app/start/prerequisites/#linux";
const TAURI_MACOS_PREREQUISITES_URL: &str = "https://v2.tauri.app/start/prerequisites/#macos";
const WEBVIEW2_DOWNLOAD_URL: &str = "https://developer.microsoft.com/microsoft-edge/webview2/";

const NODE_PROBE: ToolProbe = ToolProbe {
    provider_id: "node",
    command: "node",
    version_args: &["--version"],
    version_source: VersionSource::Stdout,
    min_version: MIN_NODE_VERSION,
};

const WEBKITGTK_PROBES: [ToolProbe; 1] = [ToolProbe {
    provider_id: "pkg-config",
    command: "pkg-config",
    version_args: &["--modversion", "webkit2gtk-4.1"],
    version_source: VersionSource::Stdout,
    min_version: NO_MIN_VERSION,
}];

const XCODE_CLT_PROBES: [ToolProbe; 1] = [ToolProbe {
    provider_id: "xcode-select",
    command: "xcode-select",
    version_args: &["-p"],
    version_source: VersionSource::Stdout,
    min_version: NO_MIN_VERSION,
}];

/// The WebView2 Runtime registers its version (`pv`) under the EdgeUpdate
/// client key, machine-wide (64- or 32-bit registry view) or per user.
macro_rules! webview2_probe {
    ($root:literal) => {
        ToolProbe {
            provider_id: "reg",
            command: "reg",
            version_args: &[
                "query",
                concat!(
                    $root,
                    r"\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
                ),
                "/v",
                "pv",
            ],
            version_source: VersionSource::Stdout,
            min_version: NO_MIN_VERSION,
        }
    };
}

const WEBVIEW2_PROBES: [ToolProbe; 3] = [
    webview2_probe!(r"HKLM\SOFTWARE\WOW6432Node"),
    webview2_probe!(r"HKLM\SOFTWARE"),
    webview2_probe!(r"HKCU\Software"),
];

/// JS package managers in Tauri build-driver order; `cargo tauri` is covered
/// by the cargo check instead.
fn package_manager_probes() -> Vec<ToolProbe> {
    TauriBuildDriver::ALL
        .into_iter()
        .filter(|driver| *driver != TauriBuildDriver::Cargo)
        .map(|driver| ToolProbe {
            provider_id: driver.name(),
            command: driver.name(),
            version_args: &["--version"],
            version_source: VersionSource::Stdout,
            min_version: NO_MIN_VERSION,
        })
        .collect()
}

/// Per-OS system prerequisite of a Tauri 2 desktop build.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PlatformPrerequisite {
    /// Linux: WebKitGTK 4.1 development files, located through pkg-config.
    WebKitGtk,
    /// macOS: Xcode Command Line Tools (compiler, linker and SDK).
    XcodeCommandLineTools,
    /// Windows: Microsoft Edge WebView2 Runtime.
    WebView2,
}

impl PlatformPrerequisite {
    fn host() -> Option<Self> {
        if cfg!(target_os = "linux") {
            Some(Self::WebKitGtk)
        } else if cfg!(target_os = "macos") {
            Some(Self::XcodeCommandLineTools)
        } else if cfg!(target_os = "windows") {
            Some(Self::WebView2)
        } else {
            None
        }
    }

    /// Any one installed probe satisfies the prerequisite.
    fn probes(self) -> &'static [ToolProbe] {
        match self {
            Self::WebKitGtk => &WEBKITGTK_PROBES,
            Self::XcodeCommandLineTools => &XCODE_CLT_PROBES,
            Self::WebView2 => &WEBVIEW2_PROBES,
        }
    }

    fn parser(self) -> VersionParser {
        match self {
            Self::WebView2 => parse_webview2_version,
            Self::WebKitGtk | Self::XcodeCommandLineTools => parse_first_line,
        }
    }

    fn missing_issue(self) -> EnvironmentIssue {
        let (severity, description, fixes) = match self {
            Self::WebKitGtk => (
                IssueSeverity::Critical,
                "WebKitGTK 4.1 development files not found (pkg-config webkit2gtk-4.1)",
                vec![
                    copy_command(
                        "Copy apt install command",
                        "sudo apt install pkg-config libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev",
                    ),
                    open_url("Open Tauri Linux prerequisites", TAURI_LINUX_PREREQUISITES_URL),
                ],
            ),
            Self::XcodeCommandLineTools => (
                IssueSeverity::Critical,
                "Xcode Command Line Tools not found",
                vec![
                    copy_command("Copy install command", "xcode-select --install"),
                    open_url("Open Tauri macOS prerequisites", TAURI_MACOS_PREREQUISITES_URL),
                ],
            ),
            // A runtime dependency (preinstalled on Windows 11) that the build
            // does not link against, so it warns instead of blocking.
            Self::WebView2 => (
                IssueSeverity::Warning,
                "Microsoft Edge WebView2 Runtime not found",
                vec![
                    run_command(
                        "Install via winget",
                        "winget install Microsoft.EdgeWebView2Runtime",
                    ),
                    open_url("Download WebView2 Runtime", WEBVIEW2_DOWNLOAD_URL),
                ],
            ),
        };
        EnvironmentIssue::new(
            severity,
            PROVIDER_ID.to_string(),
            IssueType::MissingDependency,
            description.to_string(),
        )
        .with_current_value("not installed".to_string())
        .with_fixes(fixes)
    }
}

/// First non-empty output line: `node` prints `v20.11.0`, package managers a
/// bare version, pkg-config the module version, xcode-select the developer dir.
fn parse_first_line(output: &[u8]) -> Option<String> {
    String::from_utf8_lossy(output)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

/// `reg query ... /v pv` prints `pv    REG_SZ    <version>`; an empty or
/// `0.0.0.0` value marks a broken or removed runtime.
fn parse_webview2_version(output: &[u8]) -> Option<String> {
    String::from_utf8_lossy(output)
        .lines()
        .find_map(|line| line.split_once("REG_SZ"))
        .map(|(_, version)| version.trim().to_string())
        .filter(|version| !version.is_empty() && version != "0.0.0.0")
}

/// Probe seam: the host runs the real commands, tests stub their outcomes.
trait ToolProber {
    async fn probe(&self, probe: &ToolProbe, parse_version: VersionParser) -> ProviderStatus;
}

struct HostProber;

impl ToolProber for HostProber {
    async fn probe(&self, probe: &ToolProbe, parse_version: VersionParser) -> ProviderStatus {
        check_tool(probe, parse_version).await
    }
}

/// Host facts the Tauri status and issues are derived from.
struct TauriToolchain {
    node: ProviderStatus,
    /// First available package manager.
    package_manager: Option<ProviderStatus>,
    cargo: ProviderStatus,
    missing_prerequisite: Option<PlatformPrerequisite>,
}

async fn first_installed(
    prober: &impl ToolProber,
    probes: &[ToolProbe],
    parse_version: VersionParser,
) -> Option<ProviderStatus> {
    for probe in probes {
        let status = prober.probe(probe, parse_version).await;
        if status.installed {
            return Some(status);
        }
    }
    None
}

async fn probe_toolchain(
    prober: &impl ToolProber,
    platform: Option<PlatformPrerequisite>,
) -> TauriToolchain {
    let node = prober.probe(&NODE_PROBE, parse_first_line).await;
    let package_manager =
        first_installed(prober, &package_manager_probes(), parse_first_line).await;
    let cargo = prober
        .probe(&CARGO_PROBE, cargo_provider::parse_cargo_version)
        .await;
    let missing_prerequisite = match platform {
        Some(prerequisite)
            if first_installed(prober, prerequisite.probes(), prerequisite.parser())
                .await
                .is_none() =>
        {
            Some(prerequisite)
        }
        _ => None,
    };
    TauriToolchain {
        node,
        package_manager,
        cargo,
        missing_prerequisite,
    }
}

fn detect_tauri_issues(toolchain: &TauriToolchain) -> Vec<EnvironmentIssue> {
    let mut issues = detect_tool_issues(
        &NODE_PROBE,
        &toolchain.node,
        create_missing_node_issue,
        create_outdated_node_issue,
    );
    // npm ships with Node.js, so a missing Node already explains a missing
    // package manager.
    if toolchain.node.installed && toolchain.package_manager.is_none() {
        issues.push(create_missing_package_manager_issue());
    }
    issues.extend(
        cargo_provider::detect_cargo_issues(&toolchain.cargo)
            .into_iter()
            .map(|issue| EnvironmentIssue {
                provider_id: PROVIDER_ID.to_string(),
                ..issue
            }),
    );
    if let Some(prerequisite) = toolchain.missing_prerequisite {
        issues.push(prerequisite.missing_issue());
    }
    issues
}

/// One `tauri` status: installed while nothing blocks a build, with the
/// detected toolchain as its version (e.g. `node v20.11.0, pnpm 9.1.0, cargo 1.80.0`).
fn tauri_status(toolchain: &TauriToolchain, issues: &[EnvironmentIssue]) -> ProviderStatus {
    let detected = [
        Some(&toolchain.node),
        toolchain.package_manager.as_ref(),
        Some(&toolchain.cargo),
    ]
    .into_iter()
    .flatten()
    .filter(|status| status.installed)
    .map(|status| {
        format!(
            "{} {}",
            status.provider_id,
            status.version.as_deref().unwrap_or("unknown")
        )
    })
    .collect::<Vec<_>>();

    ProviderStatus {
        provider_id: PROVIDER_ID.to_string(),
        installed: issues
            .iter()
            .all(|issue| issue.severity != IssueSeverity::Critical),
        version: (!detected.is_empty()).then(|| detected.join(", ")),
        path: None,
    }
}

async fn check_tauri_with(
    prober: &impl ToolProber,
    platform: Option<PlatformPrerequisite>,
) -> (ProviderStatus, Vec<EnvironmentIssue>) {
    let toolchain = probe_toolchain(prober, platform).await;
    let issues = detect_tauri_issues(&toolchain);
    (tauri_status(&toolchain, &issues), issues)
}

/// Check the Tauri 2 desktop toolchain of this host.
pub async fn check_tauri() -> (ProviderStatus, Vec<EnvironmentIssue>) {
    check_tauri_with(&HostProber, PlatformPrerequisite::host()).await
}

fn create_missing_node_issue() -> EnvironmentIssue {
    EnvironmentIssue::new(
        IssueSeverity::Critical,
        PROVIDER_ID.to_string(),
        IssueType::MissingTool,
        "Node.js not found".to_string(),
    )
    .with_expected_value(format!("{}+", MIN_NODE_VERSION))
    .with_current_value("not installed".to_string())
    .with_fixes(node_install_fixes())
}

fn create_outdated_node_issue(current: &str, recommended: &str) -> EnvironmentIssue {
    EnvironmentIssue::new(
        IssueSeverity::Warning,
        PROVIDER_ID.to_string(),
        IssueType::OutdatedVersion,
        format!(
            "Node.js version outdated. Current: {}, Recommended: {}+",
            current, recommended
        ),
    )
    .with_current_value(current.to_string())
    .with_expected_value(format!("{}+", recommended))
    .with_fix(open_url("Download Node.js", NODE_DOWNLOAD_URL))
}

fn create_missing_package_manager_issue() -> EnvironmentIssue {
    let expected = package_manager_probes()
        .iter()
        .map(|probe| probe.command)
        .collect::<Vec<_>>()
        .join(" / ");
    EnvironmentIssue::new(
        IssueSeverity::Critical,
        PROVIDER_ID.to_string(),
        IssueType::MissingTool,
        "No JavaScript package manager found".to_string(),
    )
    .with_expected_value(expected)
    .with_current_value("not installed".to_string())
    .with_fixes(package_manager_install_fixes())
}

fn node_install_fixes() -> Vec<FixAction> {
    let mut fixes = Vec::new();
    if cfg!(target_os = "macos") {
        fixes.push(run_command("Install via Homebrew", "brew install node"));
    }
    if cfg!(target_os = "windows") {
        fixes.push(run_command(
            "Install via winget",
            "winget install OpenJS.NodeJS.LTS",
        ));
    }
    fixes.push(open_url("Download Node.js", NODE_DOWNLOAD_URL));
    fixes
}

fn package_manager_install_fixes() -> Vec<FixAction> {
    let mut fixes = Vec::new();
    if cfg!(target_os = "macos") {
        fixes.push(run_command(
            "Install pnpm via Homebrew",
            "brew install pnpm",
        ));
    }
    if cfg!(target_os = "windows") {
        fixes.push(run_command(
            "Install pnpm via winget",
            "winget install pnpm.pnpm",
        ));
    }
    if cfg!(target_os = "linux") {
        fixes.push(copy_command(
            "Copy pnpm install command",
            "curl -fsSL https://get.pnpm.io/install.sh | sh -",
        ));
    }
    fixes.push(open_url("Open pnpm installation", PNPM_INSTALL_URL));
    fixes
}

fn run_command(label: &str, command: &str) -> FixAction {
    FixAction {
        action_type: FixType::RunCommand,
        label: label.to_string(),
        command: Some(command.to_string()),
        url: None,
    }
}

fn copy_command(label: &str, command: &str) -> FixAction {
    FixAction {
        action_type: FixType::CopyCommand,
        label: label.to_string(),
        command: Some(command.to_string()),
        url: None,
    }
}

fn open_url(label: &str, url: &str) -> FixAction {
    FixAction {
        action_type: FixType::OpenUrl,
        label: label.to_string(),
        command: None,
        url: Some(url.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// Stubbed probe: maps a command to the stdout it would print. Unknown
    /// commands are not installed; known ones go through the real parser so
    /// an unparseable output reads as not installed, as in `check_tool`.
    struct StubProber(HashMap<&'static str, &'static str>);

    impl StubProber {
        fn new(outputs: &[(&'static str, &'static str)]) -> Self {
            Self(outputs.iter().copied().collect())
        }
    }

    impl ToolProber for StubProber {
        async fn probe(&self, probe: &ToolProbe, parse_version: VersionParser) -> ProviderStatus {
            let version = self
                .0
                .get(probe.command)
                .and_then(|stdout| parse_version(stdout.as_bytes()));
            ProviderStatus {
                provider_id: probe.provider_id.to_string(),
                installed: version.is_some(),
                version,
                path: None,
            }
        }
    }

    const NODE: (&str, &str) = ("node", "v20.11.0\n");
    const PNPM: (&str, &str) = ("pnpm", "9.1.0\n");
    const CARGO: (&str, &str) = ("cargo", "cargo 1.80.0 (376290515 2024-07-16)\n");
    const XCODE: (&str, &str) = ("xcode-select", "/Library/Developer/CommandLineTools\n");

    async fn check(
        outputs: &[(&'static str, &'static str)],
        platform: Option<PlatformPrerequisite>,
    ) -> (ProviderStatus, Vec<EnvironmentIssue>) {
        check_tauri_with(&StubProber::new(outputs), platform).await
    }

    #[tokio::test]
    async fn ready_toolchain_reports_no_issues_and_summarizes_versions() {
        let (status, issues) = check(
            &[NODE, PNPM, CARGO, XCODE],
            Some(PlatformPrerequisite::XcodeCommandLineTools),
        )
        .await;

        assert!(issues.is_empty(), "unexpected issues: {issues:?}");
        assert_eq!(status.provider_id, "tauri");
        assert!(status.installed);
        assert_eq!(
            status.version.as_deref(),
            Some("node v20.11.0, pnpm 9.1.0, cargo 1.80.0")
        );
    }

    #[tokio::test]
    async fn missing_node_is_critical_and_covers_the_package_manager() {
        let (status, issues) = check(&[CARGO], None).await;

        assert_eq!(issues.len(), 1, "issues: {issues:?}");
        let issue = &issues[0];
        assert_eq!(issue.severity, IssueSeverity::Critical);
        assert_eq!(issue.issue_type, IssueType::MissingTool);
        assert_eq!(issue.provider_id, "tauri");
        assert_eq!(issue.description, "Node.js not found");
        assert_eq!(issue.expected_value.as_deref(), Some("20.0.0+"));
        assert!(!issue.fixes.is_empty());
        assert!(!status.installed);
        assert_eq!(status.version.as_deref(), Some("cargo 1.80.0"));
    }

    #[tokio::test]
    async fn outdated_node_warns_without_blocking() {
        let (status, issues) = check(&[("node", "v18.19.0\n"), PNPM, CARGO], None).await;

        assert_eq!(issues.len(), 1, "issues: {issues:?}");
        assert_eq!(issues[0].severity, IssueSeverity::Warning);
        assert_eq!(issues[0].issue_type, IssueType::OutdatedVersion);
        assert_eq!(issues[0].current_value.as_deref(), Some("v18.19.0"));
        assert_eq!(issues[0].expected_value.as_deref(), Some("20.0.0+"));
        assert!(status.installed);
    }

    #[tokio::test]
    async fn package_manager_falls_back_in_build_driver_order() {
        let (status, issues) = check(
            &[NODE, ("npm", "10.2.4\n"), ("yarn", "1.22.19\n"), CARGO],
            None,
        )
        .await;

        assert!(issues.is_empty(), "unexpected issues: {issues:?}");
        assert_eq!(
            status.version.as_deref(),
            Some("node v20.11.0, npm 10.2.4, cargo 1.80.0")
        );
    }

    #[tokio::test]
    async fn missing_package_manager_is_critical_when_node_is_present() {
        let (status, issues) = check(&[NODE, CARGO], None).await;

        assert_eq!(issues.len(), 1, "issues: {issues:?}");
        assert_eq!(issues[0].severity, IssueSeverity::Critical);
        assert_eq!(issues[0].issue_type, IssueType::MissingTool);
        assert_eq!(issues[0].description, "No JavaScript package manager found");
        assert_eq!(
            issues[0].expected_value.as_deref(),
            Some("pnpm / npm / yarn / bun")
        );
        assert!(!status.installed);
    }

    #[tokio::test]
    async fn missing_cargo_reuses_the_cargo_issue_under_the_tauri_scope() {
        let (status, issues) = check(&[NODE, PNPM], None).await;

        assert_eq!(issues.len(), 1, "issues: {issues:?}");
        assert_eq!(issues[0].severity, IssueSeverity::Critical);
        assert_eq!(issues[0].provider_id, "tauri");
        assert_eq!(issues[0].description, "Rust toolchain (cargo) not found");
        assert!(!status.installed);
    }

    #[tokio::test]
    async fn outdated_cargo_reuses_the_cargo_warning() {
        let (_, issues) = check(
            &[NODE, PNPM, ("cargo", "cargo 1.68.0 (x 2023-01-01)\n")],
            None,
        )
        .await;

        assert_eq!(issues.len(), 1, "issues: {issues:?}");
        assert_eq!(issues[0].severity, IssueSeverity::Warning);
        assert_eq!(issues[0].issue_type, IssueType::OutdatedVersion);
        assert_eq!(issues[0].provider_id, "tauri");
    }

    #[tokio::test]
    async fn missing_platform_prerequisites_report_their_own_issue() {
        let cases = [
            (
                PlatformPrerequisite::WebKitGtk,
                IssueSeverity::Critical,
                "WebKitGTK",
            ),
            (
                PlatformPrerequisite::XcodeCommandLineTools,
                IssueSeverity::Critical,
                "Xcode Command Line Tools",
            ),
            (
                PlatformPrerequisite::WebView2,
                IssueSeverity::Warning,
                "WebView2",
            ),
        ];
        for (prerequisite, severity, needle) in cases {
            let (status, issues) = check(&[NODE, PNPM, CARGO], Some(prerequisite)).await;

            assert_eq!(issues.len(), 1, "{prerequisite:?}: {issues:?}");
            let issue = &issues[0];
            assert_eq!(issue.severity, severity, "{prerequisite:?}");
            assert_eq!(issue.issue_type, IssueType::MissingDependency);
            assert_eq!(issue.provider_id, "tauri");
            assert!(issue.description.contains(needle), "{}", issue.description);
            assert!(!issue.fixes.is_empty());
            assert_eq!(status.installed, severity != IssueSeverity::Critical);
        }
    }

    #[tokio::test]
    async fn installed_platform_prerequisites_are_silent() {
        let cases = [
            (PlatformPrerequisite::WebKitGtk, ("pkg-config", "2.44.2\n")),
            (PlatformPrerequisite::XcodeCommandLineTools, XCODE),
            (
                PlatformPrerequisite::WebView2,
                (
                    "reg",
                    "\r\nHKEY_CURRENT_USER\\Software\\...\r\n    pv    REG_SZ    129.0.2792.65\r\n",
                ),
            ),
        ];
        for (prerequisite, output) in cases {
            let (status, issues) = check(&[NODE, PNPM, CARGO, output], Some(prerequisite)).await;

            assert!(issues.is_empty(), "{prerequisite:?}: {issues:?}");
            assert!(status.installed);
        }
    }

    #[test]
    fn webview2_version_rejects_empty_and_placeholder_values() {
        assert_eq!(
            parse_webview2_version(b"    pv    REG_SZ    129.0.2792.65\r\n"),
            Some("129.0.2792.65".to_string())
        );
        assert_eq!(
            parse_webview2_version(b"    pv    REG_SZ    0.0.0.0\r\n"),
            None
        );
        assert_eq!(parse_webview2_version(b"    pv    REG_SZ    \r\n"), None);
        assert_eq!(parse_webview2_version(b"ERROR: not found\r\n"), None);
    }
}
