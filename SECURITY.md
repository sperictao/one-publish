# Security Policy

## Supported Versions

| Version        | Supported          |
| -------------- | ------------------ |
| latest release | :white_check_mark: |

Only the latest published release receives security fixes. Update through the
in-app updater or the GitHub Releases page.

## Reporting a Vulnerability

Please report suspected vulnerabilities through **GitHub Security Advisories**
(`Security` tab → `Report a vulnerability`) rather than public issues.

Areas of particular sensitivity in this project:

- The updater trust chain (`TAURI_UPDATER_PUBKEY` / signature verification)
- Release signing (`TAURI_SIGNING_PRIVATE_KEY`, Apple/Windows certificate steps)
- Local resource access: repository paths, protected output directories,
  filesystem mounts, and environment scanning
- GitHub tokens and credentials used by automation/publishing destinations

Please include the affected version, platform, and reproduction steps. Do not
include real credentials or private repository contents in reports.
