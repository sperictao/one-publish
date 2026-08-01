//! 运行时环境与内置 Provider 之间的执行桥（决议 #80：端口上移 + 环境注入）。
//! 环境（桌面 shell、headless runner）通过端口注入"如何运行密封命令"与
//! "执行期源完整性校验"；Provider 本体留在核心侧，shell 不再定义 Provider。

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use publish_domain::{
    AdapterDescriptor, AdapterKind, AdapterSchema, AdapterSettings, ArtifactCandidate, Capability,
    CapabilityRequirement, PlanNode, PlanNodeTemplate, PlanOperation, PlanStage,
    PlanningInputSnapshot, PublishError, PublishingCapability,
};
use serde_json::Value;

use crate::{
    AdapterContract, AdapterExecutionContext, AdapterExecutionOutput, ProjectProvider,
    ARTIFACT_CANDIDATE_CAPABILITY, STRUCTURED_PLAN_EXECUTION_CAPABILITY,
};

pub const SELECTED_PROVIDER_ID: &str = "selected-project-provider";
pub const SELECTED_PROVIDER_PROGRAM: &str = "selected-project-provider:publish";

/// 密封计划节点物化出的结构化构建命令；执行层不得重新推导或替换命令。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SealedBuildCommand {
    pub provider_id: String,
    pub program: String,
    pub args: Vec<String>,
    pub working_directory: PathBuf,
    pub output_directory: PathBuf,
}

/// 环境执行一次密封命令后的最小结果；环境侧更丰富的执行记录（完整日志、
/// 渲染命令行等）由端口实现自行保留，不进入核心契约。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderExecutionOutcome {
    pub success: bool,
    pub cancelled: bool,
    pub error: Option<String>,
    pub output_dir: String,
}

/// Provider 执行端口：桌面注入 Tauri 命令面实现（UI 流式输出与取消），
/// headless 环境注入直接进程执行实现。
pub trait ProviderExecutionPort: Send + Sync {
    /// 执行遗留 Provider 的完整发布规格；`spec_json` 是密封节点携带的规格原文，
    /// 实现方负责解码与校验。
    fn execute_spec(&self, spec_json: &str) -> Result<ProviderExecutionOutcome, PublishError>;

    /// 运行密封计划节点物化出的结构化构建命令。
    fn execute_build(
        &self,
        request: SealedBuildCommand,
    ) -> Result<ProviderExecutionOutcome, PublishError>;
}

/// 执行期源完整性守卫：桌面校验工作区快照未漂移；干净检出环境可为恒真。
pub trait ExecutionSourceGuard: Send + Sync {
    fn validate_for_execution(&self) -> Result<(), PublishError>;
}

/// 一次运行时执行的环境注入集合：端口、Provider 原生输出目录与源守卫。
pub struct ProviderExecution {
    pub port: Arc<dyn ProviderExecutionPort>,
    pub output_directory: PathBuf,
    pub source_guard: Arc<dyn ExecutionSourceGuard>,
}

/// 遗留 Provider 的命令桥：计划与执行共享密封的发布规格这一个事实来源；
/// 构建产物是未验证候选，摘要验证与所有 Provider 一致由修订组合声明的
/// Artifact Processor 提供（ADR-0024）。
pub struct SelectedProjectProvider {
    descriptor: AdapterDescriptor,
    spec_json: String,
    execution: Option<ProviderExecution>,
}

impl SelectedProjectProvider {
    pub fn with_execution(spec_json: String, execution: Option<ProviderExecution>) -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ProjectProvider,
                SELECTED_PROVIDER_ID,
                1,
                AdapterSchema::new(1).with_required_string("spec_json"),
                PublishingCapability {
                    provides: vec![Capability::new(ARTIFACT_CANDIDATE_CAPABILITY, 1)],
                    requires: vec![CapabilityRequirement::exact(
                        STRUCTURED_PLAN_EXECUTION_CAPABILITY,
                        1,
                    )],
                },
            )
            .with_allowed_program(SELECTED_PROVIDER_PROGRAM),
            spec_json,
            execution,
        }
    }
}

impl AdapterContract for SelectedProjectProvider {
    fn descriptor(&self) -> &AdapterDescriptor {
        &self.descriptor
    }

    fn default_settings(&self) -> AdapterSettings {
        AdapterSettings::new(1).with_value("spec_json", Value::String(self.spec_json.clone()))
    }

    fn plan_fragment(
        &self,
        _snapshot: &PlanningInputSnapshot,
        settings: &AdapterSettings,
    ) -> Result<Vec<PlanNodeTemplate>, PublishError> {
        settings.string("spec_json", &self.descriptor.identity().display_name())?;
        Ok(vec![PlanNodeTemplate::command(
            "build",
            PlanStage::Build,
            SELECTED_PROVIDER_PROGRAM,
            Vec::new(),
        )
        .with_artifact_io(Vec::new(), vec!["provider-output:*".to_string()])])
    }

    fn execute_node(
        &self,
        node: &PlanNode,
        _context: &AdapterExecutionContext<'_>,
    ) -> Result<AdapterExecutionOutput, PublishError> {
        match &node.operation {
            PlanOperation::RunProgram {
                program,
                args,
                working_directory,
                environment_references,
            } if program == SELECTED_PROVIDER_PROGRAM
                && args.is_empty()
                && working_directory.is_none()
                && environment_references.is_empty() => {}
            _ => {
                return Err(PublishError::Execution(format!(
                    "node {} is not the sealed selected-provider operation",
                    node.id
                )))
            }
        }

        let planned_spec = node
            .settings
            .string("spec_json", &self.descriptor.identity().display_name())?;
        if planned_spec != self.spec_json {
            return Err(PublishError::InvalidPlan(
                "selected-provider node changed its sealed publish spec".to_string(),
            ));
        }
        let execution = self.execution.as_ref().ok_or_else(|| {
            PublishError::Execution(
                "selected-provider execution port is unavailable for this runtime".to_string(),
            )
        })?;
        let outcome = execution
            .port
            .execute_spec(planned_spec)
            .map_err(|error| PublishError::Execution(error.to_string()))?;
        finish_provider_execution(execution, outcome, classify_generic_artifact)
    }
}

impl ProjectProvider for SelectedProjectProvider {}

/// 校验 Provider 执行结果并从其原生输出目录收集产物；失败保留根因并阻止后续副作用。
pub(crate) fn finish_provider_execution(
    execution: &ProviderExecution,
    outcome: ProviderExecutionOutcome,
    classify: fn(&Path) -> (&'static str, &'static str),
) -> Result<AdapterExecutionOutput, PublishError> {
    ensure_provider_outcome(&outcome, &execution.output_directory)?;
    execution.source_guard.validate_for_execution()?;

    Ok(AdapterExecutionOutput {
        artifacts: collect_artifacts_with(&execution.output_directory, classify)?,
        ..AdapterExecutionOutput::default()
    })
}

/// 执行结果的合同校验：未取消、成功、且产物目录与约定一致。
pub(crate) fn ensure_provider_outcome(
    outcome: &ProviderExecutionOutcome,
    expected_output: &Path,
) -> Result<(), PublishError> {
    if outcome.cancelled {
        return Err(PublishError::Execution(
            outcome
                .error
                .clone()
                .unwrap_or_else(|| "provider execution was cancelled".to_string()),
        ));
    }
    if !outcome.success {
        return Err(PublishError::Execution(
            outcome
                .error
                .clone()
                .unwrap_or_else(|| "provider execution failed".to_string()),
        ));
    }
    if Path::new(&outcome.output_dir) != expected_output {
        return Err(PublishError::Execution(format!(
            "provider returned output directory {}, expected {}",
            outcome.output_dir,
            expected_output.display()
        )));
    }
    Ok(())
}

/// 非 Tauri Provider 的产物暂以统一角色进入清单；逐 Provider 的角色分类属于后续 Ticket。
fn classify_generic_artifact(_relative: &Path) -> (&'static str, &'static str) {
    ("provider-output", "application/octet-stream")
}

pub(crate) fn collect_artifacts_with(
    root: &Path,
    classify: fn(&Path) -> (&'static str, &'static str),
) -> Result<Vec<ArtifactCandidate>, PublishError> {
    let metadata = fs::symlink_metadata(root).map_err(|error| PublishError::Io {
        operation: format!("inspect provider output {}", root.display()),
        message: error.to_string(),
    })?;
    if metadata.file_type().is_symlink() {
        return Err(PublishError::Execution(format!(
            "provider output cannot be a symbolic link: {}",
            root.display()
        )));
    }
    let (artifact_root, mut files) = if metadata.is_file() {
        let parent = root.parent().ok_or_else(|| {
            PublishError::Execution(format!(
                "provider output file has no parent directory: {}",
                root.display()
            ))
        })?;
        (parent.to_path_buf(), vec![root.to_path_buf()])
    } else if metadata.is_dir() {
        let mut pending = vec![root.to_path_buf()];
        let mut files = Vec::new();
        while let Some(directory) = pending.pop() {
            let entries = fs::read_dir(&directory).map_err(|error| PublishError::Io {
                operation: format!("read provider output directory {}", directory.display()),
                message: error.to_string(),
            })?;
            for entry in entries {
                let entry = entry.map_err(|error| PublishError::Io {
                    operation: format!("read provider output entry in {}", directory.display()),
                    message: error.to_string(),
                })?;
                let file_type = entry.file_type().map_err(|error| PublishError::Io {
                    operation: format!("inspect provider output {}", entry.path().display()),
                    message: error.to_string(),
                })?;
                if file_type.is_symlink() {
                    return Err(PublishError::Execution(format!(
                        "provider output cannot contain symbolic links: {}",
                        entry.path().display()
                    )));
                }
                if file_type.is_dir() {
                    pending.push(entry.path());
                } else if file_type.is_file() {
                    files.push(entry.path());
                }
            }
        }
        (root.to_path_buf(), files)
    } else {
        return Err(PublishError::Execution(format!(
            "provider output is not a file or directory: {}",
            root.display()
        )));
    };
    files.sort();
    if files.is_empty() {
        return Err(PublishError::Execution(
            "provider execution produced no artifacts".to_string(),
        ));
    }

    files
        .into_iter()
        .map(|path| {
            let relative = path.strip_prefix(&artifact_root).map_err(|_| {
                PublishError::Execution(format!(
                    "provider output escaped its root: {}",
                    path.display()
                ))
            })?;
            let bytes = fs::read(&path).map_err(|error| PublishError::Io {
                operation: format!("read provider artifact {}", path.display()),
                message: error.to_string(),
            })?;
            let (role, media_type) = classify(relative);
            Ok(ArtifactCandidate::new(
                role,
                relative.to_string_lossy().replace('\\', "/"),
                media_type,
                std::env::consts::OS,
                std::env::consts::ARCH,
                bytes,
            ))
        })
        .collect()
}

// ===== Headless 直执行（决议 #80：headless 环境的默认执行实现）=====

/// 干净检出环境的源守卫：CI checkout 由触发 ref 固定且 prepare 已强制干净
/// 工作区，执行期无需再比对桌面式工作区快照。
pub struct CleanCheckoutGuard;

impl ExecutionSourceGuard for CleanCheckoutGuard {
    fn validate_for_execution(&self) -> Result<(), PublishError> {
        Ok(())
    }
}

/// Headless 直执行端口（决议 #80）：以子进程直接运行密封构建命令，仅此
/// 而已——产物如何出现在输出目录是 Provider 的知识，由 Provider 执行侧
/// 物化（桌面经命令面、headless 由 Provider 从其构建输出结构收集）。
/// 遗留 Provider 的完整发布规格桥没有 headless 语义，显式不支持。
pub struct DirectProviderExecutionPort;

impl ProviderExecutionPort for DirectProviderExecutionPort {
    fn execute_spec(&self, _spec_json: &str) -> Result<ProviderExecutionOutcome, PublishError> {
        Err(PublishError::Execution(
            "legacy provider spec execution is not available in headless runners".to_string(),
        ))
    }

    fn execute_build(
        &self,
        request: SealedBuildCommand,
    ) -> Result<ProviderExecutionOutcome, PublishError> {
        let status = std::process::Command::new(&request.program)
            .args(&request.args)
            .current_dir(&request.working_directory)
            .status()
            .map_err(|error| {
                PublishError::Execution(format!(
                    "failed to run sealed build {}: {error}",
                    request.program
                ))
            })?;
        Ok(ProviderExecutionOutcome {
            success: status.success(),
            cancelled: false,
            error: (!status.success()).then(|| format!("sealed build exited with {status}")),
            output_dir: request.output_directory.to_string_lossy().to_string(),
        })
    }
}

#[cfg(test)]
mod direct_execution_tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn direct_execution_runs_the_sealed_command_and_reports_the_outcome() {
        let temp = tempfile::tempdir().expect("temp workspace");
        let output = temp.path().join("provider-output");

        let outcome = DirectProviderExecutionPort
            .execute_build(SealedBuildCommand {
                provider_id: "fixture-provider".to_string(),
                program: "true".to_string(),
                args: Vec::new(),
                working_directory: temp.path().to_path_buf(),
                output_directory: output.clone(),
            })
            .expect("run the sealed build directly");
        assert!(outcome.success);
        assert_eq!(outcome.output_dir, output.to_string_lossy());

        let failed = DirectProviderExecutionPort
            .execute_build(SealedBuildCommand {
                provider_id: "fixture-provider".to_string(),
                program: "false".to_string(),
                args: Vec::new(),
                working_directory: temp.path().to_path_buf(),
                output_directory: output,
            })
            .expect("a failing build is a reported outcome, not a port error");
        assert!(!failed.success);
        assert!(failed.error.is_some());

        DirectProviderExecutionPort
            .execute_spec("{}")
            .expect_err("the legacy spec bridge has no headless semantics");
    }
}
