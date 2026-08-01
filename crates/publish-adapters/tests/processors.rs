use std::collections::BTreeMap;
use std::sync::Arc;

use publish_adapters::{
    AdapterConformanceFixture, AdapterContract, AdapterExecutionContext, AdapterRegistry,
    ArtifactProcessor, ChecksumProcessor, CustomCommandProcessor, CHECKSUM_MANIFEST_ROLE,
    CHECKSUM_PROCESSOR_ID, CUSTOM_COMMAND_PROCESSOR_ID,
};
use publish_domain::{
    sha256_hex, AdapterBinding, AdapterDescriptor, AdapterIdentity, AdapterKind, AdapterSchema,
    AdapterSelection, AdapterSettings, ArtifactCandidate, Capability, CapabilityRequirement,
    DeliveryRoute, PlanNode, PlanNodeTemplate, PlanStage, PlanningInputSnapshot, PublishError,
    PublishingCapability, SourceSnapshot, PLANNING_INPUT_SNAPSHOT_VERSION,
};
use serde_json::{json, Value};

/// 可参数化的违规 processor：用于验证注册 conformance 拒绝不完整的处理合同。
struct ContractProbeProcessor {
    descriptor: AdapterDescriptor,
    stage: PlanStage,
    inputs: Vec<String>,
    outputs: Vec<String>,
}

impl ContractProbeProcessor {
    fn new(stage: PlanStage, inputs: Vec<String>, outputs: Vec<String>) -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ArtifactProcessor,
                "contract-probe",
                1,
                AdapterSchema::new(1),
                PublishingCapability {
                    provides: vec![Capability::new("probe-processed", 1)],
                    requires: vec![CapabilityRequirement::exact("artifact-candidate", 1)],
                },
            ),
            stage,
            inputs,
            outputs,
        }
    }

    fn without_capabilities(mut self) -> Self {
        self.descriptor.capabilities = PublishingCapability {
            provides: vec![],
            requires: vec![],
        };
        self
    }
}

impl AdapterContract for ContractProbeProcessor {
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
            "probe",
            self.stage,
            "probe_artifacts",
            BTreeMap::new(),
        )
        .with_artifact_io(self.inputs.clone(), self.outputs.clone())])
    }
}

impl ArtifactProcessor for ContractProbeProcessor {}

fn register_probe(probe: ContractProbeProcessor) -> Result<(), PublishError> {
    let fixture = AdapterConformanceFixture::new(fixture_snapshot());
    AdapterRegistry::new().register_artifact_processor(Arc::new(probe), &fixture)
}

#[test]
fn processor_conformance_requires_process_stage_and_declared_roles() {
    let conforming = ContractProbeProcessor::new(
        PlanStage::ProcessArtifacts,
        vec!["artifact:*".to_string()],
        vec!["probe-report".to_string()],
    );
    register_probe(conforming).expect("register processor with a complete processing contract");

    let build_stage = ContractProbeProcessor::new(
        PlanStage::Build,
        vec!["artifact:*".to_string()],
        vec!["probe-report".to_string()],
    );
    assert!(matches!(
        register_probe(build_stage),
        Err(PublishError::InvalidAdapter { message, .. })
            if message.contains("process_artifacts stage")
    ));

    let missing_inputs = ContractProbeProcessor::new(
        PlanStage::ProcessArtifacts,
        vec![],
        vec!["probe-report".to_string()],
    );
    assert!(matches!(
        register_probe(missing_inputs),
        Err(PublishError::InvalidAdapter { message, .. })
            if message.contains("declare their artifact role inputs")
    ));

    let wildcard_outputs = ContractProbeProcessor::new(
        PlanStage::ProcessArtifacts,
        vec!["artifact:*".to_string()],
        vec!["derived:*".to_string()],
    );
    assert!(matches!(
        register_probe(wildcard_outputs),
        Err(PublishError::InvalidAdapter { message, .. })
            if message.contains("exact artifact role outputs")
    ));
}

#[test]
fn processor_conformance_requires_input_and_output_capabilities() {
    let silent = ContractProbeProcessor::new(
        PlanStage::ProcessArtifacts,
        vec!["artifact:*".to_string()],
        vec!["probe-report".to_string()],
    )
    .without_capabilities();

    assert!(matches!(
        register_probe(silent),
        Err(PublishError::InvalidAdapter { message, .. })
            if message.contains("input and output publishing capabilities")
    ));
}

#[test]
fn checksum_processor_derives_a_checksum_manifest_from_verified_candidates() {
    let processor = ChecksumProcessor::new();
    let artifacts = vec![
        ArtifactCandidate::new(
            "desktop-installer",
            "app.bin",
            "application/octet-stream",
            "test-os",
            "test-arch",
            b"installer bytes".to_vec(),
        ),
        ArtifactCandidate::new(
            "updater-archive",
            "updates/app.tar.gz",
            "application/gzip",
            "test-os",
            "test-arch",
            b"updater bytes".to_vec(),
        ),
    ];

    let output = processor
        .execute_node(
            &checksum_node(&processor),
            &execution_context(&artifacts, None),
        )
        .expect("derive checksum manifest");

    assert!(output.manifest.is_none());
    assert!(output.receipts.is_empty());
    assert_eq!(output.artifacts.len(), 1);
    let checksum = &output.artifacts[0];
    checksum
        .verify()
        .expect("derived checksum candidate carries its own digest");
    assert_eq!(checksum.role, CHECKSUM_MANIFEST_ROLE);
    assert_eq!(checksum.file_name, "SHA256SUMS");
    let content = String::from_utf8(checksum.bytes.clone()).expect("utf-8 checksum manifest");
    assert_eq!(
        content,
        format!(
            "{}  app.bin\n{}  updates/app.tar.gz\n",
            sha256_hex(b"installer bytes"),
            sha256_hex(b"updater bytes"),
        )
    );
}

#[test]
fn checksum_processor_blocks_tampered_and_empty_candidate_sets() {
    let processor = ChecksumProcessor::new();

    let mut tampered = ArtifactCandidate::new(
        "desktop-installer",
        "app.bin",
        "application/octet-stream",
        "test-os",
        "test-arch",
        b"installer bytes".to_vec(),
    );
    tampered.bytes = b"tampered bytes".to_vec();
    assert!(matches!(
        processor.execute_node(
            &checksum_node(&processor),
            &execution_context(std::slice::from_ref(&tampered), None),
        ),
        Err(PublishError::ArtifactDigestMismatch { .. })
    ));

    assert!(matches!(
        processor.execute_node(&checksum_node(&processor), &execution_context(&[], None)),
        Err(PublishError::Execution(message))
            if message.contains("at least one artifact candidate")
    ));
}

#[test]
fn checksum_processor_registers_through_the_shared_conformance_contract() {
    let fixture = AdapterConformanceFixture::new(fixture_snapshot());
    let mut registry = AdapterRegistry::new();
    registry
        .register_artifact_processor(Arc::new(ChecksumProcessor::new()), &fixture)
        .expect("checksum processor satisfies the processor conformance contract");

    let identity = AdapterIdentity::new(AdapterKind::ArtifactProcessor, CHECKSUM_PROCESSOR_ID, 1);
    let fragment = registry
        .plan_fragment(&identity, &fixture.snapshot, &AdapterSettings::new(1))
        .expect("plan checksum fragment");
    assert_eq!(fragment.len(), 1);
    assert_eq!(fragment[0].stage, PlanStage::ProcessArtifacts);
    assert_eq!(fragment[0].artifact_inputs, vec!["artifact:*"]);
    assert_eq!(
        fragment[0].artifact_outputs,
        vec![CHECKSUM_MANIFEST_ROLE.to_string()]
    );
}

#[test]
fn custom_command_processor_plans_declared_structured_commands() {
    let fixture = AdapterConformanceFixture::new(fixture_snapshot());
    let mut registry = AdapterRegistry::new();
    registry
        .register_artifact_processor(
            Arc::new(CustomCommandProcessor::new(["repo-tool:sbom"])),
            &fixture,
        )
        .expect("register custom command processor");
    let identity = AdapterIdentity::new(
        AdapterKind::ArtifactProcessor,
        CUSTOM_COMMAND_PROCESSOR_ID,
        1,
    );

    let settings = custom_command_settings(
        "repo-tool:sbom",
        json!(["--format", "spdx"]),
        json!(["desktop-installer"]),
        json!(["sbom-report"]),
    );
    let fragment = registry
        .plan_fragment(&identity, &fixture.snapshot, &settings)
        .expect("plan structured custom command");
    assert_eq!(fragment.len(), 1);
    let node = &fragment[0];
    assert_eq!(node.stage, PlanStage::ProcessArtifacts);
    assert_eq!(node.artifact_inputs, vec!["desktop-installer"]);
    assert_eq!(node.artifact_outputs, vec!["sbom-report"]);
    assert_eq!(
        node.operation,
        publish_domain::PlanOperation::RunProgram {
            program: "repo-tool:sbom".to_string(),
            args: vec!["--format".to_string(), "spdx".to_string()],
            working_directory: None,
            environment_references: BTreeMap::new(),
        }
    );
}

#[test]
fn custom_command_processor_rejects_undeclared_programs_and_hidden_scripts() {
    let fixture = AdapterConformanceFixture::new(fixture_snapshot());
    let mut registry = AdapterRegistry::new();
    registry
        .register_artifact_processor(
            Arc::new(CustomCommandProcessor::new(["repo-tool:sbom"])),
            &fixture,
        )
        .expect("register custom command processor");
    let identity = AdapterIdentity::new(
        AdapterKind::ArtifactProcessor,
        CUSTOM_COMMAND_PROCESSOR_ID,
        1,
    );

    let undeclared_program = custom_command_settings(
        "repo-tool:hidden",
        json!([]),
        json!(["desktop-installer"]),
        json!(["sbom-report"]),
    );
    assert!(matches!(
        registry.plan_fragment(&identity, &fixture.snapshot, &undeclared_program),
        Err(PublishError::InvalidAdapter { message, .. })
            if message.contains("repo-tool:hidden is not declared")
    ));

    let shell_argument = custom_command_settings(
        "repo-tool:sbom",
        json!(["bash"]),
        json!(["desktop-installer"]),
        json!(["sbom-report"]),
    );
    assert!(matches!(
        registry.plan_fragment(&identity, &fixture.snapshot, &shell_argument),
        Err(PublishError::InvalidPlan(message)) if message.contains("shell interpreter")
    ));

    let undeclared_inputs = custom_command_settings(
        "repo-tool:sbom",
        json!([]),
        json!([]),
        json!(["sbom-report"]),
    );
    assert!(matches!(
        registry.plan_fragment(&identity, &fixture.snapshot, &undeclared_inputs),
        Err(PublishError::InvalidAdapter { message, .. })
            if message.contains("declare their artifact role inputs")
    ));

    let wildcard_outputs = custom_command_settings(
        "repo-tool:sbom",
        json!([]),
        json!(["desktop-installer"]),
        json!(["derived:*"]),
    );
    assert!(matches!(
        registry.plan_fragment(&identity, &fixture.snapshot, &wildcard_outputs),
        Err(PublishError::InvalidAdapter { message, .. })
            if message.contains("exact artifact role outputs")
    ));

    let unstructured_args = AdapterSettings::new(1)
        .with_value("program", Value::String("repo-tool:sbom".to_string()))
        .with_value("args", Value::String("--format spdx".to_string()))
        .with_value("input_roles", json!(["desktop-installer"]))
        .with_value("output_roles", json!(["sbom-report"]));
    assert!(matches!(
        registry.migrate_and_validate_settings(&identity, &unstructured_args),
        Err(PublishError::InvalidAdapterSettings { message, .. })
            if message.contains("args")
    ));
}

#[test]
fn custom_command_processor_rejects_shell_program_allowlists() {
    let fixture = AdapterConformanceFixture::new(fixture_snapshot());
    let mut registry = AdapterRegistry::new();

    assert!(matches!(
        registry.register_artifact_processor(
            Arc::new(CustomCommandProcessor::new(["sh"])),
            &fixture,
        ),
        Err(PublishError::InvalidAdapter { message, .. })
            if message.contains("opaque executable ids")
    ));
}

fn custom_command_settings(
    program: &str,
    args: Value,
    input_roles: Value,
    output_roles: Value,
) -> AdapterSettings {
    AdapterSettings::new(1)
        .with_value("program", Value::String(program.to_string()))
        .with_value("args", args)
        .with_value("input_roles", input_roles)
        .with_value("output_roles", output_roles)
}

fn checksum_node(processor: &ChecksumProcessor) -> PlanNode {
    let template = processor
        .plan_fragment(&fixture_snapshot(), &processor.default_settings())
        .expect("checksum plan fragment")
        .remove(0);
    PlanNode {
        id: format!("processor.{}", template.local_id),
        stage: template.stage,
        adapter: processor.descriptor().identity(),
        binding_id: "processor".to_string(),
        settings: processor.default_settings(),
        operation: template.operation,
        depends_on: vec![],
        artifact_inputs: template.artifact_inputs,
        artifact_outputs: template.artifact_outputs,
        side_effects: template.side_effects,
        cancellable: template.cancellable,
        cleanup_owned_staging: template.cleanup_owned_staging,
        irreversible: template.irreversible,
        platform: template.platform,
    }
}

static EMPTY_CREDENTIALS: BTreeMap<String, publish_domain::ResolvedCredential> = BTreeMap::new();

fn execution_context<'a>(
    artifacts: &'a [ArtifactCandidate],
    manifest: Option<&'a publish_domain::ArtifactManifest>,
) -> AdapterExecutionContext<'a> {
    AdapterExecutionContext {
        attempt_id: "attempt-processors",
        plan_digest: "plan-digest",
        snapshot_digest: "snapshot-digest",
        artifacts,
        manifest,
        envelopes: &[],
        receipts: &[],
        credentials: &EMPTY_CREDENTIALS,
    }
}

fn fixture_snapshot() -> PlanningInputSnapshot {
    let empty = AdapterSettings::new(1);
    PlanningInputSnapshot {
        version: PLANNING_INPUT_SNAPSHOT_VERSION,
        configuration_revision: "config-revision-1".to_string(),
        runtime_revision: "runner-1".to_string(),
        release_input: BTreeMap::new(),
        source: SourceSnapshot {
            revision: "0123456789abcdef".to_string(),
            workspace_digest: None,
            dirty: false,
            captured_at: "2026-07-21T10:00:00Z".to_string(),
            reproducible: true,
        },
        external_preconditions: BTreeMap::new(),
        promoted_manifest_digest: None,
        adapters: AdapterSelection {
            project_provider: AdapterBinding::new(
                "project",
                AdapterIdentity::new(AdapterKind::ProjectProvider, "fixture-project", 1),
                empty.clone(),
            ),
            artifact_processors: vec![],
            execution_backend: AdapterBinding::new(
                "backend",
                AdapterIdentity::new(AdapterKind::ExecutionBackend, "fixture-backend", 1),
                empty.clone(),
            ),
            artifact_store: AdapterBinding::new(
                "store",
                AdapterIdentity::new(AdapterKind::ArtifactStore, "fixture-store", 1),
                empty.clone(),
            ),
            delivery_routes: vec![DeliveryRoute::required(AdapterBinding::new(
                "destination",
                AdapterIdentity::new(AdapterKind::DeliveryDestination, "fixture-destination", 1),
                empty,
            ))],
        },
    }
}
