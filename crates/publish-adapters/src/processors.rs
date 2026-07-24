use std::collections::BTreeMap;

use publish_domain::{
    AdapterDescriptor, AdapterKind, AdapterSchema, AdapterSettings, ArtifactCandidate, Capability,
    CapabilityRequirement, PlanNode, PlanNodeTemplate, PlanSideEffect, PlanStage,
    PlanningInputSnapshot, PublishError, PublishingCapability,
};
use serde_json::{json, Value};

use crate::{
    require_action, AdapterContract, AdapterExecutionContext, AdapterExecutionOutput,
    ArtifactProcessor, ARTIFACT_CANDIDATE_CAPABILITY, ARTIFACT_VERIFIED_CAPABILITY,
    STRUCTURED_PLAN_EXECUTION_CAPABILITY,
};

pub const CHECKSUM_PROCESSOR_ID: &str = "checksum";
pub const CHECKSUM_MANIFEST_ROLE: &str = "checksum-manifest";
const CHECKSUM_ACTION: &str = "checksum_artifacts";
const CHECKSUM_FILE_NAME: &str = "SHA256SUMS";

/// 内置校验和处理器：验证全部产物候选的内容摘要，并派生一份 `SHA256SUMS`
/// 清单产物；它只消费和派生产物，不封存 Manifest，也不接触任何交付目标（ADR-0035）。
pub struct ChecksumProcessor {
    descriptor: AdapterDescriptor,
}

impl ChecksumProcessor {
    pub fn new() -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ArtifactProcessor,
                CHECKSUM_PROCESSOR_ID,
                1,
                AdapterSchema::new(1),
                PublishingCapability {
                    provides: vec![Capability::new(ARTIFACT_VERIFIED_CAPABILITY, 1)],
                    requires: vec![CapabilityRequirement::exact(
                        ARTIFACT_CANDIDATE_CAPABILITY,
                        1,
                    )],
                },
            ),
        }
    }
}

impl Default for ChecksumProcessor {
    fn default() -> Self {
        Self::new()
    }
}

impl AdapterContract for ChecksumProcessor {
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
        Ok(vec![PlanNodeTemplate::adapter_action(
            "checksum",
            PlanStage::ProcessArtifacts,
            CHECKSUM_ACTION,
            BTreeMap::new(),
        )
        .with_artifact_io(
            vec!["artifact:*".to_string()],
            vec![CHECKSUM_MANIFEST_ROLE.to_string()],
        )])
    }

    fn execute_node(
        &self,
        node: &PlanNode,
        context: &AdapterExecutionContext<'_>,
    ) -> Result<AdapterExecutionOutput, PublishError> {
        require_action(node, CHECKSUM_ACTION)?;
        if context.artifacts.is_empty() {
            return Err(PublishError::Execution(
                "checksum processing requires at least one artifact candidate".to_string(),
            ));
        }

        let mut lines = String::new();
        for artifact in context.artifacts {
            artifact.verify()?;
            lines.push_str(&artifact.digest);
            lines.push_str("  ");
            lines.push_str(&artifact.file_name);
            lines.push('\n');
        }

        Ok(AdapterExecutionOutput {
            artifacts: vec![ArtifactCandidate::new(
                CHECKSUM_MANIFEST_ROLE,
                CHECKSUM_FILE_NAME,
                "text/plain",
                "any",
                "any",
                lines.into_bytes(),
            )],
            ..AdapterExecutionOutput::default()
        })
    }
}

impl ArtifactProcessor for ChecksumProcessor {}

pub const CUSTOM_COMMAND_PROCESSOR_ID: &str = "custom-command";
pub const CUSTOM_COMMAND_GATE_CAPABILITY: &str = "custom-command-gate";
const PROGRAM_SETTING: &str = "program";
const ARGS_SETTING: &str = "args";
const INPUT_ROLES_SETTING: &str = "input_roles";
const OUTPUT_ROLES_SETTING: &str = "output_roles";

/// 受控 Custom Command Processor（ADR-0049）：项目特有门禁只接受结构化程序、
/// 参数和声明的输入输出角色；程序是注册时声明、由执行后端解析的不透明标识，
/// 任意 shell 与未声明输出都无法进入计划。
pub struct CustomCommandProcessor {
    descriptor: AdapterDescriptor,
}

impl CustomCommandProcessor {
    pub fn new<I, P>(allowed_programs: I) -> Self
    where
        I: IntoIterator<Item = P>,
        P: Into<String>,
    {
        let mut descriptor = AdapterDescriptor::new(
            AdapterKind::ArtifactProcessor,
            CUSTOM_COMMAND_PROCESSOR_ID,
            1,
            AdapterSchema::new(1)
                .with_required_string(PROGRAM_SETTING)
                .with_required_string_list(ARGS_SETTING)
                .with_required_string_list(INPUT_ROLES_SETTING)
                .with_required_string_list(OUTPUT_ROLES_SETTING),
            PublishingCapability {
                provides: vec![Capability::new(CUSTOM_COMMAND_GATE_CAPABILITY, 1)],
                requires: vec![CapabilityRequirement::exact(
                    STRUCTURED_PLAN_EXECUTION_CAPABILITY,
                    1,
                )],
            },
        );
        for program in allowed_programs {
            descriptor = descriptor.with_allowed_program(program);
        }
        Self { descriptor }
    }
}

impl AdapterContract for CustomCommandProcessor {
    fn descriptor(&self) -> &AdapterDescriptor {
        &self.descriptor
    }

    fn default_settings(&self) -> AdapterSettings {
        let program = self
            .descriptor
            .allowed_programs
            .iter()
            .next()
            .cloned()
            .unwrap_or_default();
        AdapterSettings::new(1)
            .with_value(PROGRAM_SETTING, Value::String(program))
            .with_value(ARGS_SETTING, json!([]))
            .with_value(INPUT_ROLES_SETTING, json!(["artifact:*"]))
            .with_value(OUTPUT_ROLES_SETTING, json!([]))
    }

    fn plan_fragment(
        &self,
        _snapshot: &PlanningInputSnapshot,
        settings: &AdapterSettings,
    ) -> Result<Vec<PlanNodeTemplate>, PublishError> {
        let adapter = self.descriptor.identity().display_name();
        let program = settings.string(PROGRAM_SETTING, &adapter)?.to_string();
        let args = settings.string_list(ARGS_SETTING, &adapter)?;
        let input_roles = settings.string_list(INPUT_ROLES_SETTING, &adapter)?;
        let output_roles = settings.string_list(OUTPUT_ROLES_SETTING, &adapter)?;

        Ok(vec![PlanNodeTemplate::command(
            "run",
            PlanStage::ProcessArtifacts,
            program,
            args,
        )
        .with_artifact_io(input_roles, output_roles)
        .with_side_effects(vec![PlanSideEffect::FileSystem])])
    }
}

impl ArtifactProcessor for CustomCommandProcessor {}
