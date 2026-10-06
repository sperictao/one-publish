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
    process_tree, AdapterContract, AdapterExecutionContext, AdapterExecutionOutput,
    CancellationSignal, ProjectProvider, ARTIFACT_CANDIDATE_CAPABILITY,
    STRUCTURED_PLAN_EXECUTION_CAPABILITY,
};

pub const SELECTED_PROVIDER_ID: &str = "selected-project-provider";
pub const SELECTED_PROVIDER_PROGRAM: &str = "selected-project-provider:publish";

/// 执行快照的文件名前缀；快照由桌面端写入私有存储区，从不属于 Provider 产物。
pub const EXECUTION_SNAPSHOT_FILE_PREFIX: &str = "execution-snapshot-";

/// OnePublish 自身写出的文件：执行快照（v1.0.3 及之前写进了 Provider 输出目录）
/// 与 `.one-publish*` 探针/标记文件。产物收集据此兜底排除，工具文件不得进入清单。
pub fn is_one_publish_owned_file(name: &str) -> bool {
    if name.starts_with(".one-publish") {
        return true;
    }
    let name = name.to_ascii_lowercase();
    name.starts_with(EXECUTION_SNAPSHOT_FILE_PREFIX)
        && [".md", ".markdown", ".json"]
            .iter()
            .any(|extension| name.ends_with(extension))
}

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

/// Provider 执行端口：桌面注入 Tauri 命令面实现（UI 流式输出），headless
/// 环境注入直接进程执行实现。两者都必须在 `cancellation` 被请求时终止构建
/// 进程树，并以 `cancelled` 结果返回（ADR-0041）。
pub trait ProviderExecutionPort: Send + Sync {
    /// 执行遗留 Provider 的完整发布规格；`spec_json` 是密封节点携带的规格原文，
    /// 实现方负责解码与校验。
    fn execute_spec(
        &self,
        spec_json: &str,
        cancellation: &CancellationSignal,
    ) -> Result<ProviderExecutionOutcome, PublishError>;

    /// 运行密封计划节点物化出的结构化构建命令。
    fn execute_build(
        &self,
        request: SealedBuildCommand,
        cancellation: &CancellationSignal,
    ) -> Result<ProviderExecutionOutcome, PublishError>;
}

/// 执行期源完整性守卫：桌面校验工作区快照未漂移；干净检出环境可为恒真。
pub trait ExecutionSourceGuard: Send + Sync {
    fn validate_for_execution(&self) -> Result<(), PublishError>;
}

/// 产物筛选：判定输出目录遍历中的条目是否属于交付产物，被拒绝的目录不再递归。
/// 规则是 Provider 知识，由环境随原生输出目录一并注入，核心不解释其含义。
pub type ArtifactEntryFilter = fn(&fs::DirEntry) -> bool;

/// 一次运行时执行的环境注入集合：端口、Provider 原生输出目录及其产物筛选与源守卫。
pub struct ProviderExecution {
    pub port: Arc<dyn ProviderExecutionPort>,
    pub output_directory: PathBuf,
    /// `None` 表示整个输出目录都是产物。
    pub artifact_filter: Option<ArtifactEntryFilter>,
    /// 原生输出目录跨构建累积旧产物（例如 Gradle 的 `build/libs` 保留旧版本 jar）：
    /// 构建前移除顶层被 `artifact_filter` 接受的文件，交付只含本次构建的产物。
    /// 未声明筛选时不生效。
    pub clear_stale_artifacts: bool,
    pub source_guard: Arc<dyn ExecutionSourceGuard>,
}

impl ProviderExecution {
    /// 构建前清理旧产物；只移除顶层普通文件，从不删除目录。
    pub(crate) fn clear_stale_artifacts(&self) -> Result<(), PublishError> {
        if !self.clear_stale_artifacts {
            return Ok(());
        }
        let Some(accept) = self.artifact_filter else {
            return Ok(());
        };
        let entries = match fs::read_dir(&self.output_directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => {
                return Err(PublishError::Io {
                    operation: format!(
                        "read provider output directory {}",
                        self.output_directory.display()
                    ),
                    message: error.to_string(),
                })
            }
        };
        for entry in entries {
            let entry = entry.map_err(|error| PublishError::Io {
                operation: format!(
                    "read provider output entry in {}",
                    self.output_directory.display()
                ),
                message: error.to_string(),
            })?;
            if !accept(&entry) || !entry.file_type().is_ok_and(|file_type| file_type.is_file()) {
                continue;
            }
            fs::remove_file(entry.path()).map_err(|error| PublishError::Io {
                operation: format!("remove stale provider artifact {}", entry.path().display()),
                message: error.to_string(),
            })?;
        }
        Ok(())
    }
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
        context: &AdapterExecutionContext<'_>,
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
        execution.clear_stale_artifacts()?;
        let outcome = execution
            .port
            .execute_spec(planned_spec, &context.cancellation)
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
        artifacts: collect_artifacts_with(
            &execution.output_directory,
            execution.artifact_filter,
            classify,
        )?,
        ..AdapterExecutionOutput::default()
    })
}

/// 执行结果的合同校验：未取消、成功、且产物目录与约定一致。取消以
/// `Cancelled` 报告，运行核心据此把节点记为取消而不是失败。
pub(crate) fn ensure_provider_outcome(
    outcome: &ProviderExecutionOutcome,
    expected_output: &Path,
) -> Result<(), PublishError> {
    if outcome.cancelled {
        return Err(PublishError::Cancelled(
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
    filter: Option<ArtifactEntryFilter>,
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
                if filter.is_some_and(|accept| !accept(&entry)) {
                    continue;
                }
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
                } else if file_type.is_file()
                    && !entry
                        .file_name()
                        .to_str()
                        .is_some_and(is_one_publish_owned_file)
                {
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
            let metadata = fs::metadata(&path).map_err(|error| PublishError::Io {
                operation: format!("inspect provider artifact {}", path.display()),
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
            )
            .with_executable(is_executable(&metadata)))
        })
        .collect()
}

/// Unix 上任一执行位即视为可执行；其他平台没有执行位语义。
#[cfg(unix)]
fn is_executable(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn is_executable(_metadata: &fs::Metadata) -> bool {
    false
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
    fn execute_spec(
        &self,
        _spec_json: &str,
        _cancellation: &CancellationSignal,
    ) -> Result<ProviderExecutionOutcome, PublishError> {
        Err(PublishError::Execution(
            "legacy provider spec execution is not available in headless runners".to_string(),
        ))
    }

    fn execute_build(
        &self,
        request: SealedBuildCommand,
        cancellation: &CancellationSignal,
    ) -> Result<ProviderExecutionOutcome, PublishError> {
        let run_error = |error: std::io::Error| {
            PublishError::Execution(format!(
                "failed to run sealed build {}: {error}",
                request.program
            ))
        };
        let mut command = std::process::Command::new(&request.program);
        command
            .args(&request.args)
            .current_dir(&request.working_directory)
            // 构建位于独立进程组，不得读取终端。
            .stdin(std::process::Stdio::null());
        process_tree::isolate(&mut command);
        let mut child = command.spawn().map_err(run_error)?;
        let (status, cancelled) =
            process_tree::wait_or_cancel(&mut child, cancellation).map_err(run_error)?;
        let success = status.success() && !cancelled;
        Ok(ProviderExecutionOutcome {
            success,
            cancelled,
            error: if cancelled {
                Some("sealed build was cancelled".to_string())
            } else {
                (!success).then(|| format!("sealed build exited with {status}"))
            },
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
            .execute_build(
                SealedBuildCommand {
                    provider_id: "fixture-provider".to_string(),
                    program: "true".to_string(),
                    args: Vec::new(),
                    working_directory: temp.path().to_path_buf(),
                    output_directory: output.clone(),
                },
                &CancellationSignal::new(),
            )
            .expect("run the sealed build directly");
        assert!(outcome.success);
        assert_eq!(outcome.output_dir, output.to_string_lossy());

        let failed = DirectProviderExecutionPort
            .execute_build(
                SealedBuildCommand {
                    provider_id: "fixture-provider".to_string(),
                    program: "false".to_string(),
                    args: Vec::new(),
                    working_directory: temp.path().to_path_buf(),
                    output_directory: output,
                },
                &CancellationSignal::new(),
            )
            .expect("a failing build is a reported outcome, not a port error");
        assert!(!failed.success);
        assert!(failed.error.is_some());

        DirectProviderExecutionPort
            .execute_spec("{}", &CancellationSignal::new())
            .expect_err("the legacy spec bridge has no headless semantics");
    }
}

#[cfg(test)]
mod artifact_collection_tests {
    use super::*;

    #[test]
    fn collection_skips_one_publish_owned_files() {
        let temp = tempfile::tempdir().expect("temp output");
        let output = temp.path();
        fs::create_dir_all(output.join("nested")).expect("create nested output");
        fs::write(output.join("app.jar"), b"application").expect("write artifact");
        fs::write(output.join("nested").join("execution-notes.md"), b"notes")
            .expect("write provider markdown");
        // v1.0.3 遗留在 Provider 输出目录中的执行快照与工具探针。
        fs::write(
            output.join("execution-snapshot-2026-07-17T10-01-02.345Z.md"),
            b"# Execution Snapshot",
        )
        .expect("write legacy snapshot");
        fs::write(
            output.join("nested").join("execution-snapshot-legacy.json"),
            b"{}",
        )
        .expect("write nested legacy snapshot");
        fs::write(output.join(".one-publish-access-check-1-2"), b"").expect("write probe");

        let artifacts = collect_artifacts_with(output, None, classify_generic_artifact)
            .expect("collect provider output");
        let paths: Vec<&str> = artifacts
            .iter()
            .map(|artifact| artifact.file_name.as_str())
            .collect();
        assert_eq!(paths, vec!["app.jar", "nested/execution-notes.md"]);
    }

    #[test]
    fn output_with_only_one_publish_files_has_no_artifacts() {
        let temp = tempfile::tempdir().expect("temp output");
        fs::write(
            temp.path().join("execution-snapshot-2026-07-17.md"),
            b"# Execution Snapshot",
        )
        .expect("write legacy snapshot");

        let error = collect_artifacts_with(temp.path(), None, classify_generic_artifact)
            .expect_err("tool-owned files alone are not provider artifacts");
        assert!(error.to_string().contains("produced no artifacts"));
    }

    fn reject_cache_and_logs(entry: &fs::DirEntry) -> bool {
        entry.file_name() != "cache" && entry.file_name() != "build.log"
    }

    fn collected_names(root: &Path, filter: Option<ArtifactEntryFilter>) -> Vec<String> {
        collect_artifacts_with(root, filter, classify_generic_artifact)
            .expect("collect provider output")
            .into_iter()
            .map(|artifact| artifact.file_name)
            .collect()
    }

    #[test]
    fn artifact_filter_skips_rejected_entries_without_descending() {
        let temp = tempfile::tempdir().expect("temp output");
        let root = temp.path();
        fs::create_dir_all(root.join("cache")).expect("create rejected directory");
        fs::create_dir_all(root.join("nested")).expect("create accepted directory");
        fs::write(root.join("app.bin"), b"app").expect("write accepted file");
        fs::write(root.join("build.log"), b"log").expect("write rejected file");
        // 筛选本会接受该文件；它缺席说明被拒绝的目录没有被遍历。
        fs::write(root.join("cache").join("inner.bin"), b"cached").expect("write cached file");
        fs::write(root.join("nested").join("meta.json"), b"{}").expect("write nested file");

        assert_eq!(
            collected_names(root, Some(reject_cache_and_logs)),
            vec!["app.bin", "nested/meta.json"]
        );
        assert_eq!(
            collected_names(root, None),
            vec![
                "app.bin",
                "build.log",
                "cache/inner.bin",
                "nested/meta.json"
            ]
        );
    }

    fn accept_jars(entry: &fs::DirEntry) -> bool {
        entry.file_name().to_string_lossy().ends_with(".jar")
    }

    fn stale_cleanup_execution(output: &Path, clear: bool) -> ProviderExecution {
        ProviderExecution {
            port: Arc::new(DirectProviderExecutionPort),
            output_directory: output.to_path_buf(),
            artifact_filter: Some(accept_jars),
            clear_stale_artifacts: clear,
            source_guard: Arc::new(CleanCheckoutGuard),
        }
    }

    #[test]
    fn stale_artifact_cleanup_removes_only_accepted_top_level_files() {
        let temp = tempfile::tempdir().expect("temp output");
        let root = temp.path();
        fs::create_dir_all(root.join("nested.jar")).expect("create accepted-looking directory");
        fs::write(root.join("app-1.0.jar"), b"stale").expect("write stale jar");
        fs::write(root.join("notes.txt"), b"notes").expect("write unrelated file");
        fs::write(root.join("nested.jar").join("inner.jar"), b"inner").expect("write nested jar");

        stale_cleanup_execution(root, false)
            .clear_stale_artifacts()
            .expect("cleanup not declared");
        assert!(root.join("app-1.0.jar").exists());

        stale_cleanup_execution(root, true)
            .clear_stale_artifacts()
            .expect("clear stale artifacts");
        assert!(!root.join("app-1.0.jar").exists());
        assert!(root.join("notes.txt").exists());
        // 目录即使被筛选接受也不删除，也不递归。
        assert!(root.join("nested.jar").join("inner.jar").exists());

        stale_cleanup_execution(&root.join("missing"), true)
            .clear_stale_artifacts()
            .expect("a missing output directory has nothing stale");
    }
}
