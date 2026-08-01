use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use publish_domain::{
    AdapterDescriptor, AdapterKind, AdapterSchema, AdapterSettings, AutomationBindingProjection,
    AutomationBundleFile, AutomationProjectionBundle, AutomationTriggerPolicy, Capability,
    PlanNodeTemplate, PlanningInputSnapshot, PublishError, PublishPlan, PublishingCapability,
    ResolvedCredential,
};
use serde_json::Value;

use crate::{
    execute_plan_in_order, AdapterContract, CredentialResolveFailure, CredentialSource,
    ExecutionBackend, PlanNodeExecutor, AUTOMATION_PROJECTION_CAPABILITY,
    STRUCTURED_PLAN_EXECUTION_CAPABILITY,
};

pub const GITHUB_ACTIONS_BACKEND_ID: &str = "github-actions";

const BUNDLE_MANIFEST_PATH: &str = ".one-publish/automation/github-actions.json";
const CHECKOUT_ACTION: &str = "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2";
const UPLOAD_ARTIFACT_ACTION: &str =
    "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2";
const DOWNLOAD_ARTIFACT_ACTION: &str =
    "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4.3.0";

/// 单一 GitHub Actions Backend（决议 #81）：同一 adapter 身份的两个面——
/// 投影面把绑定渲染为薄外壳 workflow（下载钉住的 runner、离线校验摘要、
/// 现场规划并执行安装的投影模板），执行面在 runner 进程内提供拓扑与凭据
/// 解析。Publish Plan 的业务语义始终由共享 Runner 与各 Adapter 解释。
pub struct GitHubActionsBackend {
    descriptor: AdapterDescriptor,
    credential_source: Arc<dyn CredentialSource>,
}

impl GitHubActionsBackend {
    pub fn new(credential_source: Arc<dyn CredentialSource>) -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ExecutionBackend,
                GITHUB_ACTIONS_BACKEND_ID,
                1,
                AdapterSchema::new(1),
                PublishingCapability {
                    provides: vec![
                        Capability::new(AUTOMATION_PROJECTION_CAPABILITY, 1),
                        Capability::new(STRUCTURED_PLAN_EXECUTION_CAPABILITY, 1),
                    ],
                    requires: vec![],
                },
            ),
            credential_source,
        }
    }
}

impl AdapterContract for GitHubActionsBackend {
    fn descriptor(&self) -> &AdapterDescriptor {
        &self.descriptor
    }

    fn default_settings(&self) -> AdapterSettings {
        AdapterSettings::new(1)
    }

    fn plan_fragment(
        &self,
        _snapshot: &PlanningInputSnapshot,
        _settings: &AdapterSettings,
    ) -> Result<Vec<PlanNodeTemplate>, PublishError> {
        Ok(Vec::new())
    }

    fn execute_plan(
        &self,
        plan: &PublishPlan,
        executor: &mut dyn PlanNodeExecutor,
    ) -> Result<(), PublishError> {
        execute_plan_in_order(plan, executor)
    }
}

impl ExecutionBackend for GitHubActionsBackend {
    fn resolve_credential(
        &self,
        reference: &str,
    ) -> Result<ResolvedCredential, CredentialResolveFailure> {
        self.credential_source.resolve(reference)
    }

    fn render_automation_bundle(
        &self,
        bindings: &[AutomationBindingProjection],
    ) -> Result<AutomationProjectionBundle, PublishError> {
        if bindings.is_empty() {
            return Err(PublishError::Execution(
                "GitHub Actions automation projection requires at least one binding".to_string(),
            ));
        }

        let mut files = BTreeMap::new();
        let mut manifest_bindings = BTreeMap::new();
        let mut binding_ids = BTreeSet::new();
        for binding in bindings {
            binding.runtime_revision.validate_for_projection()?;
            if !binding_ids.insert(binding.binding_id.as_str()) {
                return Err(PublishError::Execution(format!(
                    "GitHub Actions automation projection contains duplicate binding identity {}",
                    binding.binding_id
                )));
            }

            let runtime_path = format!(
                ".one-publish/automation/runtime/{}.json",
                binding.binding_id
            );
            let workflow_path = format!(
                ".github/workflows/one-publish-{}-release.yml",
                binding.binding_id
            );
            // runtime 文件即远端 runner 消费的规划输入模板（决议 #87），
            // 内容由控制面构造、runner crate 的 RunnerProjection 定义格式。
            let runner_projection = public_setting(binding, "runnerProjection")?;
            files.insert(
                runtime_path.clone(),
                AutomationBundleFile {
                    content: serde_json::to_string_pretty(runner_projection)
                        .map_err(|error| PublishError::Execution(error.to_string()))?
                        + "\n",
                    binding_id: Some(binding.binding_id.clone()),
                },
            );
            files.insert(
                workflow_path.clone(),
                AutomationBundleFile {
                    content: render_thin_shell_workflow(binding, &runtime_path)?,
                    binding_id: Some(binding.binding_id.clone()),
                },
            );
            manifest_bindings.insert(
                binding.binding_id.clone(),
                serde_json::json!({
                    "configurationId": binding.configuration_id,
                    "configurationRevisionId": binding.configuration_revision_id,
                    "releaseNamespace": binding.release_namespace,
                    "deliveryDestinationNamespaces": binding.delivery_destination_namespaces,
                    "runtimeRevision": binding.runtime_revision.identifier(),
                    "runtime": binding.runtime_revision,
                    "ownedResources": [workflow_path, runtime_path],
                }),
            );
        }

        let manifest = serde_json::json!({
            "backend": GITHUB_ACTIONS_BACKEND_ID,
            "bindings": manifest_bindings,
        });
        let content = serde_json::to_string_pretty(&manifest)
            .map_err(|error| PublishError::Execution(error.to_string()))?
            + "\n";
        files.insert(
            BUNDLE_MANIFEST_PATH.to_string(),
            AutomationBundleFile {
                content,
                binding_id: None,
            },
        );

        AutomationProjectionBundle::seal(self.descriptor.identity(), files)
    }
}

fn public_setting<'a>(
    binding: &'a AutomationBindingProjection,
    key: &str,
) -> Result<&'a Value, PublishError> {
    binding.projection.public_settings.get(key).ok_or_else(|| {
        PublishError::Execution(format!(
            "GitHub Actions binding {} is missing its {key} projection input",
            binding.binding_id
        ))
    })
}

/// 薄外壳分片 workflow（决议 #85/#81）：每个平台族一个 build job + 一个
/// 汇聚 job。每个 job 下载控制面钉住的 runner 资产并离线校验 sha256，
/// 现场规划后只执行分配给本段亲和的节点子集，段结束上传事件段 artifact
///（决议 #88 的传输层）。业务语义全部在安装的投影模板与共享 Runner 内。
fn render_thin_shell_workflow(
    binding: &AutomationBindingProjection,
    runtime_path: &str,
) -> Result<String, PublishError> {
    // 触发形态（决议 #89）：tag 推送从触发 ref 取版本；手动 dispatch 以
    // inputs 携带桌面预生成的 attempt id 与显式版本（run-name 回显 attempt
    // id，触发输入经 env 进入脚本避免内插）。两条路径共用同一套
    // "触发→补全→规划"机制，仅触发描述符来源不同。
    let (on_block, run_name_block, trigger_env, trigger_descriptor, attempt_expression) =
        match &binding.trigger_policy {
            AutomationTriggerPolicy::TagPush { tag_prefix } => (
                format!(
                    "  push:\n    tags:\n      - '{tag_prefix}[0-9]*.[0-9]*.[0-9]*'\n"
                ),
                String::new(),
                String::new(),
                "tag:${GITHUB_REF_NAME}",
                "gh-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}",
            ),
            AutomationTriggerPolicy::Manual => (
                concat!(
                    "  workflow_dispatch:\n",
                    "    inputs:\n",
                    "      attempt-id:\n",
                    "        required: true\n",
                    "        type: string\n",
                    "      version:\n",
                    "        required: true\n",
                    "        type: string\n",
                )
                .to_string(),
                format!(
                    "run-name: one-publish {} ${{{{ inputs.attempt-id }}}}\n",
                    binding.binding_id
                ),
                concat!(
                    "          ONE_PUBLISH_ATTEMPT_ID: ${{ inputs.attempt-id }}\n",
                    "          ONE_PUBLISH_VERSION: ${{ inputs.version }}\n",
                )
                .to_string(),
                "version:${ONE_PUBLISH_VERSION}",
                "${ONE_PUBLISH_ATTEMPT_ID}",
            ),
        };
    let distribution = public_setting(binding, "runnerDistribution")?;
    let distribution_field = |key: &str| {
        distribution
            .get(key)
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                PublishError::Execution(format!(
                    "GitHub Actions binding {} is missing the runner distribution {key}",
                    binding.binding_id
                ))
            })
    };
    let repository = distribution_field("repository")?;
    let release_tag = distribution_field("releaseTag")?;
    let runtime = binding.runtime_revision.exact()?;
    let shard_platforms = public_setting(binding, "shardPlatforms")?
        .as_array()
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .filter(|platforms| {
            !platforms.is_empty()
                && platforms
                    .iter()
                    .all(|platform| matches!(platform.as_str(), "linux" | "macos" | "windows"))
        })
        .ok_or_else(|| {
            PublishError::Execution(format!(
                "GitHub Actions binding {} declares no valid shard platforms",
                binding.binding_id
            ))
        })?;

    let mut secret_env = trigger_env;
    for secret_name in binding.projection.secret_references.values() {
        secret_env.push_str(&format!(
            "          {secret_name}: ${{{{ secrets.{secret_name} }}}}\n"
        ));
    }
    let env_block = if secret_env.is_empty() {
        String::new()
    } else {
        format!("        env:\n{secret_env}")
    };

    let install_step = |platform: &str| -> Result<String, PublishError> {
        let (_, triple, _) = shard_runner(platform);
        let digest = runtime.runner.binary_digests.get(triple).ok_or_else(|| {
            PublishError::Execution(format!(
                "runner distribution digest for {triple} is not pinned"
            ))
        })?;
        let asset = format!("one-publish-runner-{triple}.tar.gz");
        let url =
            format!("https://github.com/{repository}/releases/download/{release_tag}/{asset}");
        Ok(format!(
            r#"      - name: Install the pinned One Publish runner
        shell: bash
        run: |
          set -euo pipefail
          curl -fL --retry 3 -o "{asset}" "{url}"
          echo "{digest}  {asset}" | sha256sum -c -
          tar -xzf "{asset}"
"#
        ))
    };
    let shard_step = |affinity: &str, binary: &str| {
        format!(
            r#"      - name: Execute the {affinity} shard
        shell: bash
{env_block}        run: |
          set -euo pipefail
          ./{binary} verify "{runtime_path}"
          ./{binary} prepare-from-projection "{runtime_path}" . "{trigger_descriptor}" > prepared-attempt.json
          ./{binary} execute prepared-attempt.json "{attempt_expression}" {affinity} > "one-publish-events-{affinity}.json"
      - name: Upload the {affinity} prepared attempt
        if: always()
        uses: {UPLOAD_ARTIFACT_ACTION}
        with:
          name: one-publish-prepared-${{{{ github.run_id }}}}-${{{{ github.run_attempt }}}}-{affinity}
          path: prepared-attempt.json
          if-no-files-found: ignore
      - name: Upload the {affinity} event segment
        if: always()
        uses: {UPLOAD_ARTIFACT_ACTION}
        with:
          name: one-publish-events-${{{{ github.run_id }}}}-${{{{ github.run_attempt }}}}-{affinity}
          path: one-publish-events-{affinity}.json
          if-no-files-found: ignore
"#
        )
    };

    let mut jobs = String::new();
    for platform in &shard_platforms {
        let (runs_on, _, binary) = shard_runner(platform);
        jobs.push_str(&format!(
            r#"  build-{platform}:
    runs-on: {runs_on}
    steps:
      - name: Checkout the triggering tag
        uses: {CHECKOUT_ACTION}
{install}{shard}"#,
            install = install_step(platform)?,
            shard = shard_step(platform, binary),
        ));
    }
    let needs = shard_platforms
        .iter()
        .map(|platform| format!("build-{platform}"))
        .collect::<Vec<_>>()
        .join(", ");
    jobs.push_str(&format!(
        r#"  aggregate:
    needs: [{needs}]
    runs-on: ubuntu-latest
    steps:
      - name: Checkout the triggering tag
        uses: {CHECKOUT_ACTION}
{install}      - name: Download build shard segments
        uses: {DOWNLOAD_ARTIFACT_ACTION}
        with:
          pattern: one-publish-events-${{{{ github.run_id }}}}-${{{{ github.run_attempt }}}}-*
          path: .one-publish-work/segments
{shard}"#,
        install = install_step("linux")?,
        shard = shard_step("any", "one-publish-runner"),
    ));

    Ok(format!(
        r#"# Generated by One Publish. Do not edit: this workflow is the thin shell of
# automation binding {binding_id}; it is reconciled from the desktop app.
name: one-publish {binding_id}
{run_name_block}on:
{on_block}permissions:
  contents: write
jobs:
{jobs}"#,
        binding_id = binding.binding_id,
    ))
}

/// 分片族 → (matrix runner、runner 资产 target triple、二进制名)。
fn shard_runner(platform: &str) -> (&'static str, &'static str, &'static str) {
    match platform {
        "macos" => ("macos-latest", "aarch64-apple-darwin", "one-publish-runner"),
        "windows" => (
            "windows-latest",
            "x86_64-pc-windows-msvc",
            "one-publish-runner.exe",
        ),
        _ => (
            "ubuntu-latest",
            "x86_64-unknown-linux-gnu",
            "one-publish-runner",
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use publish_domain::{
        AdapterIdentity, AutomationProjection, AutomationRuntimeRevision,
        PinnedAutomationRuntimeRevision, RuntimeAdapterRevision, RuntimeComponentRevision,
    };

    fn runtime_revision() -> AutomationRuntimeRevision {
        AutomationRuntimeRevision::seal(
            RuntimeComponentRevision::new("0.1.0", publish_domain::sha256_hex(b"runner"))
                .with_binary_digests(BTreeMap::from([
                    ("x86_64-unknown-linux-gnu".to_string(), "a".repeat(64)),
                    ("aarch64-apple-darwin".to_string(), "b".repeat(64)),
                    ("x86_64-pc-windows-msvc".to_string(), "c".repeat(64)),
                ])),
            RuntimeComponentRevision::new("1", publish_domain::sha256_hex(b"plan")),
            vec![RuntimeAdapterRevision::new(
                AdapterIdentity::new(AdapterKind::ExecutionBackend, GITHUB_ACTIONS_BACKEND_ID, 1),
                publish_domain::sha256_hex(b"adapters"),
            )],
        )
        .expect("seal fixture runtime revision")
    }

    fn binding(id: &str, prefix: &str, revision: &str) -> AutomationBindingProjection {
        AutomationBindingProjection {
            binding_id: id.to_string(),
            configuration_id: format!("configuration-{id}"),
            configuration_revision_id: revision.to_string(),
            trigger_policy: AutomationTriggerPolicy::TagPush {
                tag_prefix: prefix.to_string(),
            },
            release_namespace: format!("tag:{prefix}*"),
            delivery_destination_namespaces: vec!["github-release:repository".to_string()],
            runtime_revision: runtime_revision().into(),
            projection: AutomationProjection {
                public_settings: BTreeMap::from([
                    (
                        "runnerProjection".to_string(),
                        serde_json::json!({ "binding_id": id }),
                    ),
                    (
                        "runnerDistribution".to_string(),
                        serde_json::json!({
                            "repository": "sperictao/one-publish",
                            "releaseTag": "runner-v0.1.0",
                        }),
                    ),
                    (
                        "shardPlatforms".to_string(),
                        serde_json::json!(["linux", "macos", "windows"]),
                    ),
                ]),
                protected_variables: BTreeMap::new(),
                secret_references: BTreeMap::from([(
                    "ci github-token".to_string(),
                    "ONE_PUBLISH_CI_GITHUB_TOKEN".to_string(),
                )]),
            },
        }
    }

    #[test]
    fn thin_shell_bundle_pins_the_runner_and_projects_binding_owned_files() {
        let backend = GitHubActionsBackend::new(Arc::new(crate::StaticCredentialSource::new()));
        let bundle = backend
            .render_automation_bundle(&[
                binding("stable", "v", "revision-stable"),
                binding("nightly", "nightly-", "revision-nightly"),
            ])
            .expect("render thin-shell bundle");
        bundle.validate().expect("sealed bundle validates");

        let workflow = bundle
            .files
            .get(".github/workflows/one-publish-stable-release.yml")
            .expect("binding-owned workflow");
        assert_eq!(workflow.binding_id.as_deref(), Some("stable"));
        assert!(workflow.content.contains("'v[0-9]*.[0-9]*.[0-9]*'"));
        // 分片拓扑（决议 #85）：每个平台族一个 build job + 汇聚 job。
        for (job, triple, digest) in [
            ("build-linux:", "x86_64-unknown-linux-gnu", "a"),
            ("build-macos:", "aarch64-apple-darwin", "b"),
            ("build-windows:", "x86_64-pc-windows-msvc", "c"),
        ] {
            assert!(workflow.content.contains(job), "missing job {job}");
            assert!(workflow.content.contains(&format!(
                "https://github.com/sperictao/one-publish/releases/download/runner-v0.1.0/one-publish-runner-{triple}.tar.gz"
            )));
            assert!(workflow
                .content
                .contains(&format!("{}  one-publish-runner-{triple}", digest.repeat(64))));
        }
        assert!(workflow
            .content
            .contains("needs: [build-linux, build-macos, build-windows]"));
        assert!(workflow.content.contains("execute prepared-attempt.json \"gh-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}\" windows"));
        assert!(workflow.content.contains("execute prepared-attempt.json \"gh-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}\" any"));
        assert!(workflow
            .content
            .contains("one-publish-events-${{ github.run_id }}-${{ github.run_attempt }}-macos"));
        assert!(workflow
            .content
            .contains("one-publish-prepared-${{ github.run_id }}-${{ github.run_attempt }}-any"));
        assert!(workflow.content.contains("Download build shard segments"));
        assert!(workflow.content.contains("./one-publish-runner.exe verify"));
        assert!(workflow.content.contains("sha256sum -c -"));
        assert!(workflow.content.contains(
            "ONE_PUBLISH_CI_GITHUB_TOKEN: ${{ secrets.ONE_PUBLISH_CI_GITHUB_TOKEN }}"
        ));
        assert!(workflow
            .content
            .contains("verify \".one-publish/automation/runtime/stable.json\""));
        assert!(workflow.content.contains(
            "prepare-from-projection \".one-publish/automation/runtime/stable.json\" . \"tag:${GITHUB_REF_NAME}\""
        ));
        for line in workflow
            .content
            .lines()
            .filter(|line| line.trim_start().starts_with("uses:"))
        {
            let sha = line
                .split('@')
                .nth(1)
                .expect("action reference")
                .split_whitespace()
                .next()
                .expect("action sha");
            assert_eq!(sha.len(), 40, "action is not pinned: {line}");
            assert!(sha.chars().all(|character| character.is_ascii_hexdigit()));
        }

        let runtime = bundle
            .files
            .get(".one-publish/automation/runtime/stable.json")
            .expect("runtime projection template file");
        assert_eq!(runtime.binding_id.as_deref(), Some("stable"));
        let template: Value =
            serde_json::from_str(&runtime.content).expect("runtime file is the template verbatim");
        assert_eq!(template, serde_json::json!({ "binding_id": "stable" }));

        let manifest = bundle
            .files
            .get(BUNDLE_MANIFEST_PATH)
            .expect("bundle ownership manifest");
        assert_eq!(manifest.binding_id, None);
        assert!(manifest.content.contains("revision-stable"));
        assert!(manifest
            .content
            .contains(".github/workflows/one-publish-nightly-release.yml"));
        assert!(manifest.content.contains("\"runner\""));
    }

    #[test]
    fn thin_shell_rendering_rejects_incomplete_or_unpinned_bindings() {
        let backend = GitHubActionsBackend::new(Arc::new(crate::StaticCredentialSource::new()));

        // 决议 #89：Manual 绑定渲染 workflow_dispatch 外壳，触发输入经 env
        // 进入脚本，attempt id 由桌面预生成并经 run-name 回显。
        let mut manual = binding("stable", "v", "revision-stable");
        manual.trigger_policy = AutomationTriggerPolicy::Manual;
        let bundle = backend
            .render_automation_bundle(&[manual])
            .expect("render the manual dispatch shell");
        let workflow = bundle
            .files
            .get(".github/workflows/one-publish-stable-release.yml")
            .expect("manual binding workflow");
        assert!(workflow.content.contains("workflow_dispatch:"));
        assert!(workflow.content.contains("attempt-id:"));
        assert!(workflow
            .content
            .contains("run-name: one-publish stable ${{ inputs.attempt-id }}"));
        assert!(workflow
            .content
            .contains("ONE_PUBLISH_VERSION: ${{ inputs.version }}"));
        assert!(workflow
            .content
            .contains("\"version:${ONE_PUBLISH_VERSION}\""));
        assert!(workflow
            .content
            .contains("execute prepared-attempt.json \"${ONE_PUBLISH_ATTEMPT_ID}\""));
        assert!(!workflow.content.contains("push:"));

        let mut missing_template = binding("stable", "v", "revision-stable");
        missing_template
            .projection
            .public_settings
            .remove("runnerProjection");
        let error = backend
            .render_automation_bundle(&[missing_template])
            .expect_err("the runner projection template is required");
        assert!(error.to_string().contains("runnerProjection"));

        let mut missing_distribution = binding("stable", "v", "revision-stable");
        missing_distribution
            .projection
            .public_settings
            .remove("runnerDistribution");
        let error = backend
            .render_automation_bundle(&[missing_distribution])
            .expect_err("the runner distribution source is required");
        assert!(error.to_string().contains("runnerDistribution"));

        let mut missing_shards = binding("stable", "v", "revision-stable");
        missing_shards
            .projection
            .public_settings
            .insert("shardPlatforms".to_string(), serde_json::json!([]));
        let error = backend
            .render_automation_bundle(&[missing_shards])
            .expect_err("empty shard platforms cannot render a matrix");
        assert!(error.to_string().contains("shard platforms"));

        let mut unpinned = binding("stable", "v", "revision-stable");
        let runtime = match &unpinned.runtime_revision {
            PinnedAutomationRuntimeRevision::Exact(runtime) => runtime.clone(),
            PinnedAutomationRuntimeRevision::Legacy(_) => unreachable!(),
        };
        unpinned.runtime_revision = runtime
            .without_binary_digests()
            .expect("reseal without binary digests")
            .into();
        let error = backend
            .render_automation_bundle(&[unpinned])
            .expect_err("unpinned runner digests must not render");
        assert!(error.to_string().contains("binary digests"));

        let error = backend
            .render_automation_bundle(&[
                binding("duplicate", "v", "revision-one"),
                binding("duplicate", "nightly-", "revision-two"),
            ])
            .expect_err("duplicate binding identity must be rejected");
        assert!(error.to_string().contains("duplicate binding identity"));
    }
}
