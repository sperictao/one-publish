use super::{
    ManagedWorkflowPreview, ManagedWorkflowStatus, TauriBuildDriver, TauriDesktopTarget,
    TauriReleaseConfig, WorkflowConflict, MANAGED_WORKFLOW_PATH,
};
use crate::errors::AppError;
use sha2::{Digest, Sha256};
use std::path::Path;

const CHECKOUT_ACTION: &str = "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2";
const SETUP_NODE_ACTION: &str =
    "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0";
const UPLOAD_ARTIFACT_ACTION: &str =
    "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2";
const DOWNLOAD_ARTIFACT_ACTION: &str =
    "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4.3.0";
const TAURI_ACTION: &str =
    "tauri-apps/tauri-action@1deb371b0cd8bd54025b384f1cd735e725c4060f # v1.0.0";
const SETUP_BUN_ACTION: &str =
    "oven-sh/setup-bun@735343b667d3e6f658f44d0eca948eb6282f2b76 # v2.0.2";
const RUST_TOOLCHAIN_ACTION: &str =
    "dtolnay/rust-toolchain@2c7215f132e9ebf062739d9130488b56d53c060c # master 2026-07-20";

struct MatrixRow {
    name: &'static str,
    runner: &'static str,
    target: &'static str,
    rust_targets: &'static str,
}

fn matrix_row(target: TauriDesktopTarget) -> MatrixRow {
    match target {
        TauriDesktopTarget::WindowsX64 => MatrixRow {
            name: "windows-x64",
            runner: "windows-latest",
            target: "x86_64-pc-windows-msvc",
            rust_targets: "x86_64-pc-windows-msvc",
        },
        TauriDesktopTarget::LinuxX64 => MatrixRow {
            name: "linux-x64",
            runner: "ubuntu-22.04",
            target: "x86_64-unknown-linux-gnu",
            rust_targets: "x86_64-unknown-linux-gnu",
        },
        TauriDesktopTarget::MacosX64 => MatrixRow {
            name: "macos-x64",
            runner: "macos-14",
            target: "x86_64-apple-darwin",
            rust_targets: "x86_64-apple-darwin",
        },
        TauriDesktopTarget::MacosArm64 => MatrixRow {
            name: "macos-arm64",
            runner: "macos-14",
            target: "aarch64-apple-darwin",
            rust_targets: "aarch64-apple-darwin",
        },
        TauriDesktopTarget::MacosUniversal => MatrixRow {
            name: "macos-universal",
            runner: "macos-14",
            target: "universal-apple-darwin",
            rust_targets: "aarch64-apple-darwin,x86_64-apple-darwin",
        },
    }
}

fn app_root(config: &TauriReleaseConfig) -> String {
    let config_path = Path::new(&config.app_config_path);
    let config_dir = config_path.parent().unwrap_or_else(|| Path::new("."));
    let root = if config_dir.file_name().and_then(|name| name.to_str()) == Some("src-tauri") {
        config_dir.parent().unwrap_or_else(|| Path::new("."))
    } else {
        config_dir
    };
    let value = root.to_string_lossy().replace('\\', "/");
    if value.is_empty() {
        ".".to_string()
    } else {
        value
    }
}

fn bundle_path(config: &TauriReleaseConfig) -> String {
    let root = app_root(config);
    let prefix = if root == "." {
        String::new()
    } else {
        format!("{root}/")
    };
    format!("{prefix}src-tauri/target/${{{{ matrix.target }}}}/release/bundle/**")
}

fn render_matrix(config: &TauriReleaseConfig) -> String {
    let root = app_root(config);
    let config_path = if root == "." {
        config.app_config_path.clone()
    } else {
        Path::new(&config.app_config_path)
            .strip_prefix(&root)
            .unwrap_or_else(|_| Path::new(&config.app_config_path))
            .to_string_lossy()
            .replace('\\', "/")
    };
    let updater_args = config
        .updater
        .enabled
        .then_some(" --config .one-publish-tauri-config.json")
        .unwrap_or("");
    config
        .enabled_targets
        .iter()
        .map(|target| {
            let row = matrix_row(*target);
            let args = format!(
                "--target {} --config {}{}",
                row.target,
                shell_single_quote(&config_path),
                updater_args
            );
            format!(
                "          - name: {}\n            runner: {}\n            target: {}\n            rust_targets: {}\n            args: {}",
                row.name,
                row.runner,
                row.target,
                row.rust_targets,
                yaml_single_quote(&args)
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn render_dependency_steps(driver: TauriBuildDriver) -> String {
    match driver {
        TauriBuildDriver::Pnpm => format!(
            "      - name: Setup Node\n        uses: {SETUP_NODE_ACTION}\n        with:\n          node-version: '20'\n      - name: Enable pnpm\n        run: corepack enable pnpm\n      - name: Install dependencies\n        run: pnpm install --frozen-lockfile\n"
        ),
        TauriBuildDriver::Npm => format!(
            "      - name: Setup Node\n        uses: {SETUP_NODE_ACTION}\n        with:\n          node-version: '20'\n      - name: Install dependencies\n        run: npm ci\n"
        ),
        TauriBuildDriver::Yarn => format!(
            "      - name: Setup Node\n        uses: {SETUP_NODE_ACTION}\n        with:\n          node-version: '20'\n      - name: Enable Yarn\n        run: corepack enable yarn\n      - name: Install dependencies\n        run: yarn install --immutable\n"
        ),
        TauriBuildDriver::Bun => format!(
            "      - name: Setup Bun\n        uses: {SETUP_BUN_ACTION}\n      - name: Install dependencies\n        run: bun install --frozen-lockfile\n"
        ),
        TauriBuildDriver::Cargo => String::new(),
    }
}

fn render_secret_environment(config: &TauriReleaseConfig) -> String {
    let mut environment = config.actions_secret_environment.clone();
    if let Some(secret) = config
        .updater
        .enabled
        .then_some(config.updater.private_key_secret_name.as_ref())
        .flatten()
    {
        environment
            .entry("TAURI_SIGNING_PRIVATE_KEY".to_string())
            .or_insert_with(|| secret.clone());
    }
    if environment.is_empty() {
        return String::new();
    }
    let mappings = environment
        .iter()
        .map(|(environment, secret)| {
            format!("          {environment}: ${{{{ secrets.{secret} }}}}")
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!("        env:\n{mappings}\n")
}

fn render_updater_config_step(config: &TauriReleaseConfig) -> String {
    if !config.updater.enabled {
        return String::new();
    }
    let overlay = serde_json::json!({
        "bundle": { "createUpdaterArtifacts": true },
        "plugins": {
            "updater": {
                "endpoints": [config.updater.endpoint.as_deref().expect("validated endpoint")],
                "pubkey": config.updater.public_key.as_deref().expect("validated public key"),
            }
        }
    });
    let overlay = serde_json::to_string(&overlay).expect("serialize updater overlay");
    format!(
        "      - name: Configure Tauri Updater build\n        shell: bash\n        run: |\n          cat > {}/.one-publish-tauri-config.json <<'ONE_PUBLISH_CONFIG'\n          {}\n          ONE_PUBLISH_CONFIG\n",
        shell_single_quote(&app_root(config)),
        overlay,
    )
}

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn yaml_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn render_asset_patterns(config: &TauriReleaseConfig) -> String {
    let mut patterns = config.release_asset_patterns.clone();
    if config.updater.enabled {
        for required in ["*.sig", "*.tar.gz", "*.zip"] {
            if !patterns.iter().any(|pattern| pattern == required) {
                patterns.push(required.to_string());
            }
        }
    }
    patterns
        .iter()
        .map(|pattern| shell_single_quote(pattern))
        .collect::<Vec<_>>()
        .join(" ")
}

fn render_updater_assembly(config: &TauriReleaseConfig) -> String {
    if !config.updater.enabled {
        return String::new();
    }
    let targets = config
        .enabled_targets
        .iter()
        .map(|target| matrix_row(*target).name)
        .collect::<Vec<_>>();
    let targets = serde_json::to_string(&targets).expect("serialize target names");
    let script = r#"      - name: Assemble and validate updater manifest
        env:
          TAG_PREFIX: __TAG_PREFIX__
        shell: bash
        run: |
          set -euo pipefail
          node <<'NODE'
          const fs = require('fs');
          const path = require('path');
          const targets = __TARGETS__;
          const platformKeys = {
            'windows-x64': ['windows-x86_64'],
            'linux-x64': ['linux-x86_64'],
            'macos-x64': ['darwin-x86_64'],
            'macos-arm64': ['darwin-aarch64'],
            'macos-universal': ['darwin-x86_64', 'darwin-aarch64'],
          };
          const files = fs.readdirSync('release-assets');
          const platforms = {};
          for (const target of targets) {
            const signatures = files
              .filter((file) => file.startsWith(`${target}-`) && file.endsWith('.sig'))
              .sort((left, right) => {
                const rank = (file) => file.endsWith('.tar.gz.sig') || file.endsWith('.zip.sig') ? 0 : 1;
                return rank(left) - rank(right) || left.localeCompare(right);
              });
            if (signatures.length === 0) {
              throw new Error(`Updater is enabled but ${target} produced no signature.`);
            }
            const signatureFile = signatures[0];
            const assetFile = signatureFile.slice(0, -4);
            if (!files.includes(assetFile)) {
              throw new Error(`Updater signature ${signatureFile} has no matching asset ${assetFile}.`);
            }
            const signature = fs.readFileSync(path.join('release-assets', signatureFile), 'utf8').trim();
            const url = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/releases/download/${process.env.GITHUB_REF_NAME}/${encodeURIComponent(assetFile)}`;
            for (const key of platformKeys[target]) {
              platforms[key] = { signature, url };
            }
          }
          const tagPrefix = process.env.TAG_PREFIX || '';
          if (!process.env.GITHUB_REF_NAME.startsWith(tagPrefix)) {
            throw new Error('Release tag does not match the configured prefix.');
          }
          const manifest = {
            version: process.env.GITHUB_REF_NAME.slice(tagPrefix.length),
            notes: fs.readFileSync(`release-notes/${process.env.GITHUB_REF_NAME}.md`, 'utf8'),
            pub_date: new Date().toISOString(),
            platforms,
          };
          fs.writeFileSync('release-assets/latest.json', `${JSON.stringify(manifest, null, 2)}\n`);
          NODE
"#;
    script
        .replace("__TARGETS__", &targets)
        .replace("__TAG_PREFIX__", &shell_single_quote(&config.tag_prefix))
}

pub fn render(config: &TauriReleaseConfig) -> String {
    let project_path = app_root(config);
    let updater_assembly = render_updater_assembly(config);
    let unsigned_warning = if config.allow_unsigned_release {
        "      - name: Record unsigned release authorization\n        run: echo 'WARNING: repository configuration explicitly allows missing platform code signing.'\n"
    } else {
        ""
    };

    format!(
        "# Generated by One Publish. Manual edits will block releases.\n# managed-workflow-version: {}\nname: One Publish Tauri Release\n\non:\n  push:\n    tags:\n      - '{}[0-9]*.[0-9]*.[0-9]*'\n\npermissions:\n  contents: read\n\njobs:\n  validate:\n    name: Validate stable SemVer tag\n    runs-on: ubuntu-22.04\n    steps:\n      - name: Reject non-stable tags\n        shell: bash\n        run: |\n          if [[ ! \"$GITHUB_REF_NAME\" =~ ^{}[0-9]+\\.[0-9]+\\.[0-9]+$ ]]; then\n            echo \"Tag $GITHUB_REF_NAME is not a stable SemVer tag.\"\n            exit 1\n          fi\n\n  build:\n    name: Build ${{{{ matrix.name }}}}\n    needs: validate\n    strategy:\n      fail-fast: false\n      matrix:\n        include:\n{}\n    runs-on: ${{{{ matrix.runner }}}}\n    steps:\n      - name: Checkout\n        uses: {}\n      - name: Install Rust toolchain\n        uses: {}\n        with:\n          toolchain: stable\n          targets: ${{{{ matrix.rust_targets }}}}\n      - name: Install Linux system dependencies\n        if: runner.os == 'Linux'\n        run: sudo apt-get update && sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf\n{}{}      - name: Build Tauri bundles\n        uses: {}\n{}        with:\n          projectPath: {}\n          args: ${{{{ matrix.args }}}}\n      - name: Upload build artifacts\n        uses: {}\n        with:\n          name: tauri-${{{{ matrix.name }}}}\n          path: {}\n          if-no-files-found: error\n\n  release:\n    name: Assemble published release\n    needs: build\n    runs-on: ubuntu-22.04\n    permissions:\n      contents: write\n    steps:\n      - name: Checkout release commit\n        uses: {}\n      - name: Download build artifacts\n        uses: {}\n        with:\n          path: artifacts\n      - name: Apply release asset allowlist\n        shell: bash\n        run: |\n          set -euo pipefail\n          mkdir -p release-assets\n          patterns=({})\n          while IFS= read -r -d '' file; do\n            base=\"$(basename \"$file\")\"\n            relative=\"${{{{file#artifacts/}}}}\"\n            artifact_name=\"${{{{relative%%/*}}}}\"\n            target_name=\"${{{{artifact_name#tauri-}}}}\"\n            for pattern in \"${{{{patterns[@]}}}}\"; do\n              if [[ \"$base\" == $pattern ]]; then\n                destination=\"release-assets/${{{{target_name}}}}-${{{{base}}}}\"\n                if [ -e \"$destination\" ]; then\n                  echo \"Duplicate release asset destination: $destination\"\n                  exit 1\n                fi\n                cp \"$file\" \"$destination\"\n                break\n              fi\n            done\n          done < <(find artifacts -type f -print0)\n          if [ -z \"$(find release-assets -type f -print -quit)\" ]; then\n            echo 'No files matched the configured release asset allowlist.'\n            exit 1\n          fi\n{}{}      - name: Publish staged GitHub Release\n        env:\n          GH_TOKEN: ${{{{ github.token }}}}\n        shell: bash\n        run: |\n          set -euo pipefail\n          if ! gh release view \"${{{{ github.ref_name }}}}\" >/dev/null 2>&1; then\n            gh release create \"${{{{ github.ref_name }}}}\" --draft --verify-tag --title \"${{{{ github.ref_name }}}}\" --notes-file \"release-notes/${{{{ github.ref_name }}}}.md\"\n          fi\n          if [[ \"$(gh release view \"${{{{ github.ref_name }}}}\" --json isDraft --jq .isDraft)\" != \"true\" ]]; then\n            echo \"Release ${{{{ github.ref_name }}}} is already published and cannot be replaced.\"\n            exit 1\n          fi\n          gh release edit \"${{{{ github.ref_name }}}}\" --title \"${{{{ github.ref_name }}}}\" --notes-file \"release-notes/${{{{ github.ref_name }}}}.md\"\n          gh release upload \"${{{{ github.ref_name }}}}\" release-assets/* --clobber\n          gh release edit \"${{{{ github.ref_name }}}}\" --draft=false\n",
        config.managed_workflow_version,
        config.tag_prefix,
        regex::escape(&config.tag_prefix),
        render_matrix(config),
        CHECKOUT_ACTION,
        RUST_TOOLCHAIN_ACTION,
        render_dependency_steps(config.build_driver),
        render_updater_config_step(config),
        TAURI_ACTION,
        render_secret_environment(config),
        yaml_single_quote(&project_path),
        UPLOAD_ARTIFACT_ACTION,
        yaml_single_quote(&bundle_path(config)),
        CHECKOUT_ACTION,
        DOWNLOAD_ARTIFACT_ACTION,
        render_asset_patterns(config),
        updater_assembly,
        unsigned_warning,
    )
}

fn workflow_conflicts(repository_root: &Path) -> Result<Vec<WorkflowConflict>, AppError> {
    let workflow_dir = repository_root.join(".github/workflows");
    if !workflow_dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut conflicts = Vec::new();
    for entry in std::fs::read_dir(&workflow_dir).map_err(|error| {
        AppError::repository_with_code(
            format!("failed to read {}: {error}", workflow_dir.display()),
            "tauri_workflow_scan_failed",
        )
    })? {
        let path = entry
            .map_err(|error| {
                AppError::repository_with_code(
                    format!("failed to read workflow entry: {error}"),
                    "tauri_workflow_scan_failed",
                )
            })?
            .path();
        let relative = path
            .strip_prefix(repository_root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        if relative == MANAGED_WORKFLOW_PATH
            || !matches!(
                path.extension().and_then(|ext| ext.to_str()),
                Some("yml" | "yaml")
            )
        {
            continue;
        }
        let content = std::fs::read_to_string(&path).map_err(|error| {
            AppError::repository_with_code(
                format!("failed to read workflow {}: {error}", path.display()),
                "tauri_workflow_read_failed",
            )
        })?;
        let handles_tags = content.contains("tags:") || content.contains("github.ref_name");
        let creates_release = content.contains("gh release create")
            || content.contains("softprops/action-gh-release")
            || (content.contains("tauri-apps/tauri-action")
                && (content.contains("tagName:") || content.contains("releaseName:")));
        if handles_tags && creates_release {
            conflicts.push(WorkflowConflict {
                path: relative,
                reason: "responds to tags and creates or updates a GitHub Release".to_string(),
            });
        }
    }
    conflicts.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(conflicts)
}

fn full_replacement_diff(current: Option<&str>, expected: &str) -> String {
    let mut diff = String::from("--- current\n+++ managed\n");
    if let Some(current) = current {
        for line in current.lines() {
            diff.push('-');
            diff.push_str(line);
            diff.push('\n');
        }
    }
    for line in expected.lines() {
        diff.push('+');
        diff.push_str(line);
        diff.push('\n');
    }
    diff
}

pub fn preview(
    repository_root: &Path,
    config: &TauriReleaseConfig,
) -> Result<ManagedWorkflowPreview, AppError> {
    let expected_content = render(config);
    let workflow_path = repository_root.join(MANAGED_WORKFLOW_PATH);
    let current_content = match std::fs::read_to_string(&workflow_path) {
        Ok(content) => Some(content),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            return Err(AppError::repository_with_code(
                format!(
                    "failed to read managed workflow {}: {error}",
                    workflow_path.display()
                ),
                "tauri_workflow_read_failed",
            ));
        }
    };
    let status = match current_content.as_deref() {
        None => ManagedWorkflowStatus::Missing,
        Some(current) if current == expected_content => ManagedWorkflowStatus::Current,
        Some(_) => ManagedWorkflowStatus::Drifted,
    };
    let diff = if status == ManagedWorkflowStatus::Current {
        String::new()
    } else {
        full_replacement_diff(current_content.as_deref(), &expected_content)
    };

    let conflicts = workflow_conflicts(repository_root)?;
    let mut identity = Sha256::new();
    identity.update(expected_content.as_bytes());
    identity.update(current_content.as_deref().unwrap_or("").as_bytes());
    for conflict in &conflicts {
        identity.update(conflict.path.as_bytes());
        let conflict_path = repository_root.join(&conflict.path);
        let content = std::fs::read(&conflict_path).map_err(|error| {
            AppError::repository_with_code(
                format!(
                    "failed to hash conflicting workflow {}: {error}",
                    conflict_path.display()
                ),
                "tauri_workflow_read_failed",
            )
        })?;
        identity.update(content);
    }

    Ok(ManagedWorkflowPreview {
        preview_id: hex::encode(identity.finalize()),
        path: MANAGED_WORKFLOW_PATH.to_string(),
        status,
        expected_content,
        current_content,
        diff,
        conflicts,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> TauriReleaseConfig {
        TauriReleaseConfig {
            app_name: "Demo".to_string(),
            enabled_targets: vec![
                TauriDesktopTarget::WindowsX64,
                TauriDesktopTarget::MacosArm64,
            ],
            allow_unsigned_release: true,
            ..TauriReleaseConfig::default()
        }
    }

    #[test]
    fn rendered_workflow_pins_actions_and_uses_single_release_job() {
        let mut config = test_config();
        config
            .enabled_targets
            .push(TauriDesktopTarget::MacosUniversal);
        let workflow = render(&config);

        for line in workflow
            .lines()
            .filter(|line| line.trim_start().starts_with("uses:"))
        {
            let reference = line.split('@').nth(1).expect("action sha");
            let sha = reference.split_whitespace().next().expect("sha");
            assert_eq!(sha.len(), 40, "action is not pinned: {line}");
            assert!(sha.chars().all(|character| character.is_ascii_hexdigit()));
        }
        assert_eq!(workflow.matches("gh release create").count(), 1);
        assert_eq!(workflow.matches("gh release upload").count(), 1);
        assert!(workflow.contains("--clobber"));
        assert!(workflow.contains("--draft --verify-tag"));
        assert!(workflow.contains("--draft=false"));
        assert!(workflow.contains(RUST_TOOLCHAIN_ACTION));
        assert!(workflow.contains("targets: ${{ matrix.rust_targets }}"));
        assert!(workflow.contains("aarch64-apple-darwin,x86_64-apple-darwin"));
        let build_section = workflow.split("  release:").next().expect("build section");
        assert!(!build_section.contains("tagName:"));
        assert!(!build_section.contains("releaseName:"));
        assert!(workflow.contains("'v[0-9]*.[0-9]*.[0-9]*'"));
        assert!(workflow.contains("[0-9]+\\.[0-9]+\\.[0-9]+$"));
        assert!(workflow.contains("needs: validate"));
    }

    #[test]
    fn updater_workflow_injects_build_overlay_and_assembles_latest_json() {
        let mut config = test_config();
        config.updater.enabled = true;
        config.updater.endpoint =
            Some("https://github.com/acme/demo/releases/latest/download/latest.json".to_string());
        config.updater.public_key = Some("PUBLIC_KEY".to_string());
        config.updater.private_key_secret_name = Some("TAURI_PRIVATE_KEY".to_string());

        let workflow = render(&config);

        assert!(workflow.contains("createUpdaterArtifacts"));
        assert!(workflow.contains("--config .one-publish-tauri-config.json"));
        assert!(workflow.contains("TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_PRIVATE_KEY }}"));
        assert!(workflow.contains("release-assets/latest.json"));
        assert!(workflow.contains("*.sig"));
    }

    #[test]
    fn preview_detects_drift_and_conflicting_legacy_release_workflow() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let workflow_dir = temp_dir.path().join(".github/workflows");
        std::fs::create_dir_all(&workflow_dir).expect("create workflows");
        std::fs::write(
            workflow_dir.join("one-publish-tauri-release.yml"),
            "name: manually changed\n",
        )
        .expect("write managed workflow");
        std::fs::write(
            workflow_dir.join("legacy.yml"),
            "on:\n  push:\n    tags: ['v*']\nsteps:\n  - run: gh release create\n",
        )
        .expect("write legacy workflow");

        let preview = preview(temp_dir.path(), &test_config()).expect("preview");

        assert_eq!(preview.status, ManagedWorkflowStatus::Drifted);
        assert_eq!(preview.conflicts.len(), 1);
        assert_eq!(preview.conflicts[0].path, ".github/workflows/legacy.yml");
        assert!(preview.diff.contains("-name: manually changed"));
    }
}
