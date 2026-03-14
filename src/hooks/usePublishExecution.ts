import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";

import {
  runEnvironmentCheck,
  type EnvironmentCheckResult,
} from "@/lib/environment";
import {
  analyzePublishExecutionFailure,
  extractInvokeErrorCode,
  extractInvokeErrorMessage,
} from "@/lib/tauri/invokeErrors";
import type { ExecutionRecord } from "@/lib/store";
import type { ArtifactActionState } from "@/components/publish/ArtifactActions";
import { useDotnetPublishSelection } from "@/hooks/useDotnetPublishSelection";
import type { PublishExecutionInput } from "@/hooks/usePublishExecutionInput";
import { usePublishSpecBuilder } from "@/hooks/usePublishSpecBuilder";

interface TranslationMap {
  [key: string]: string | undefined;
}

export interface PublishResult {
  provider_id: string;
  success: boolean;
  cancelled: boolean;
  output: string;
  error: string | null;
  output_dir: string;
  file_count: number;
}

export interface ProviderPublishSpec {
  version: number;
  provider_id: string;
  project_path: string;
  parameters: Record<string, unknown>;
}

interface PublishLogChunkEvent {
  sessionId: string;
  line: string;
}

export interface PublishExecutionCallSurface {
  pushRecentConfig: (key: string, repoId?: string | null) => void;
  openEnvironmentDialog: (
    initialResult?: EnvironmentCheckResult | null,
    providerIds?: string[]
  ) => void;
  setEnvironmentLastResult: (result: EnvironmentCheckResult | null) => void;
  buildExecutionRecord: (params: {
    spec: ProviderPublishSpec;
    repoId: string | null;
    startedAt: string;
    finishedAt: string;
    result: PublishResult;
    output: string;
  }) => ExecutionRecord;
  persistExecutionRecord: (record: ExecutionRecord) => void;
}

interface UsePublishExecutionParams {
  appT: TranslationMap;
  publishT: TranslationMap;
  input: PublishExecutionInput;
  callSurface: PublishExecutionCallSurface;
}

export function usePublishExecution({
  appT,
  publishT,
  input,
  callSurface,
}: UsePublishExecutionParams) {
  const {
    selectedRepoId,
    selectedRepo,
    activeProviderId,
    activeProviderParameters,
    selectedPreset,
    isCustomMode,
    customConfig,
    defaultOutputDir,
    projectInfo,
    presets,
    specVersion,
  } = input;
  const [isPublishing, setIsPublishing] = useState(false);
  const [isCancellingPublish, setIsCancellingPublish] = useState(false);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);
  const [lastExecutedSpec, setLastExecutedSpec] =
    useState<ProviderPublishSpec | null>(null);
  const [currentExecutionRecordId, setCurrentExecutionRecordId] =
    useState<string | null>(null);
  const [outputLog, setOutputLog] = useState("");
  const [releaseChecklistOpen, setReleaseChecklistOpen] = useState(false);
  const [artifactActionState, setArtifactActionState] =
    useState<ArtifactActionState>({
      packageResult: null,
      signResult: null,
    });

  useEffect(() => {
    if (!(window as any).__TAURI__) {
      return;
    }

    let unlisten: (() => void) | null = null;

    listen<PublishLogChunkEvent>("provider-publish-log", (event) => {
      const line = event.payload?.line?.trimEnd();
      if (!line) return;

      setOutputLog((prev) => (prev ? `${prev}\n${line}` : line));
    })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch((err) => {
        console.error("监听发布日志失败:", err);
      });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  const {
    getCurrentConfig,
    dotnetPublishPreviewCommand,
    recentConfigKeyForCurrentSelection,
  } = useDotnetPublishSelection({
    activeProviderId,
    selectedPreset,
    isCustomMode,
    customConfig,
    defaultOutputDir,
    projectInfo,
    presets,
  });

  const { buildPublishSpec } = usePublishSpecBuilder({
    activeProviderId,
    activeProviderParameters,
    projectInfo,
    selectedRepo,
    specVersion,
    getCurrentConfig,
  });

  const runPublishWithSpec = useCallback(
    async (spec: ProviderPublishSpec, recentConfigKey?: string | null) => {
      try {
        const env = await runEnvironmentCheck([spec.provider_id]);
        callSurface.setEnvironmentLastResult(env);

        const critical = env.issues.find((item) => item.severity === "critical");
        if (critical) {
          toast.error(appT.environmentBlocked || "环境未就绪，已阻止发布", {
            description: critical.description,
          });
          callSurface.openEnvironmentDialog(env, [spec.provider_id]);
          return;
        }

        const warning = env.issues.find((item) => item.severity === "warning");
        if (warning) {
          toast.warning(appT.environmentWarning || "环境存在警告", {
            description: warning.description,
          });
        }
      } catch (err) {
        toast.error(appT.environmentCheckFailed || "环境检查失败", {
          description: extractInvokeErrorMessage(err),
        });
      }

      setLastExecutedSpec(spec);
      setCurrentExecutionRecordId(null);
      setIsPublishing(true);
      setPublishResult(null);
      setOutputLog("");
      setReleaseChecklistOpen(false);
      setArtifactActionState({ packageResult: null, signResult: null });

      const executionStartedAt = new Date().toISOString();

      try {
        if (recentConfigKey) {
          callSurface.pushRecentConfig(recentConfigKey);
        }

        const result = await invoke<PublishResult>("execute_provider_publish", {
          spec,
        });

        setPublishResult(result);
        setOutputLog(result.output);

        if (result.success) {
          toast.success(publishT.success || "发布成功!", {
            description: result.output_dir
              ? `${publishT.output || "输出目录"}: ${result.output_dir}`
              : appT.commandExecuted || "命令执行成功",
          });
        } else if (result.cancelled) {
          toast.warning(appT.publishCancelled || "发布已取消", {
            description: result.error || appT.userCancelledTask || "用户取消了执行任务",
          });
        } else {
          toast.error(publishT.failed || "发布失败", {
            description: result.error || appT.unknownError || "未知错误",
          });
        }

        const record = callSurface.buildExecutionRecord({
          spec,
          repoId: selectedRepoId,
          startedAt: executionStartedAt,
          finishedAt: new Date().toISOString(),
          result,
          output: result.output,
        });
        setCurrentExecutionRecordId(record.id);
        callSurface.persistExecutionRecord(record);
      } catch (err) {
        const rawErrorMessage = extractInvokeErrorMessage(err);
        const failureReason = analyzePublishExecutionFailure(err);

        const failedResult: PublishResult = {
          provider_id: spec.provider_id,
          success: false,
          cancelled: false,
          output: "",
          error: rawErrorMessage,
          output_dir: "",
          file_count: 0,
        };
        setPublishResult(failedResult);

        if (failureReason === "already_running") {
          toast.error(appT.publishAlreadyRunning || "已有发布任务正在执行", {
            description:
              appT.publishAlreadyRunningDesc ||
              "请等待当前任务结束，或先取消后再重试。",
          });
        } else if (failureReason === "project_path_not_found") {
          toast.error(appT.publishProjectPathNotFound || "项目路径不存在", {
            description:
              appT.publishProjectPathNotFoundDesc ||
              "请确认 Project Root / Project File 路径正确后重试。",
          });
        } else if (failureReason === "unsupported_provider") {
          toast.error(appT.publishProviderUnsupported || "不支持的 Provider", {
            description:
              appT.publishProviderUnsupportedDesc ||
              "请确认 Provider 配置有效，或在编辑弹窗重新选择 Provider。",
          });
        } else if (failureReason === "render_error") {
          toast.error(appT.publishRenderFailed || "参数渲染失败", {
            description:
              appT.publishRenderFailedDesc ||
              "请检查当前参数配置是否符合 Provider 要求。",
          });
        } else if (failureReason === "tool_missing") {
          toast.error(appT.publishToolMissing || "缺少构建命令", {
            description:
              appT.publishToolMissingDesc ||
              "请安装对应构建工具，并确保命令已加入 PATH。",
          });
        } else if (failureReason === "permission_denied") {
          toast.error(appT.publishPermissionDenied || "缺少执行权限", {
            description:
              appT.publishPermissionDeniedDesc ||
              "请检查项目目录与构建命令的执行权限后重试。",
          });
        } else if (failureReason === "plan_invalid") {
          toast.error(appT.publishPlanInvalid || "发布计划无效", {
            description:
              appT.publishPlanInvalidDesc ||
              "当前发布命令计划不可执行，请检查 Provider 与参数。",
          });
        } else if (failureReason === "java_gradle_missing") {
          toast.error(appT.publishGradleMissing || "未检测到 Gradle", {
            description:
              appT.publishGradleMissingDesc ||
              "请确保项目下存在 gradlew，或在环境中安装 gradle。",
          });
        } else if (failureReason === "process_failed") {
          toast.error(appT.publishProcessFailed || "发布进程执行失败", {
            description:
              appT.publishProcessFailedDesc ||
              "发布进程启动或等待失败，请稍后重试。",
          });
        } else {
          toast.error(appT.publishExecutionError || "发布执行错误", {
            description: rawErrorMessage,
          });
        }

        const record = callSurface.buildExecutionRecord({
          spec,
          repoId: selectedRepoId,
          startedAt: executionStartedAt,
          finishedAt: new Date().toISOString(),
          result: failedResult,
          output: "",
        });
        setCurrentExecutionRecordId(record.id);
        callSurface.persistExecutionRecord(record);
      } finally {
        setIsPublishing(false);
        setIsCancellingPublish(false);
      }
    },
    [
      appT,
      callSurface,
      publishT,
      selectedRepoId,
    ]
  );

  const executePublish = useCallback(async () => {
    if (!selectedRepo) {
      toast.error(appT.selectRepositoryFirst || "请先选择仓库");
      return;
    }

    if (activeProviderId === "dotnet" && !projectInfo) {
      toast.error(appT.selectDotnetProjectFirst || "请先选择 .NET 项目");
      return;
    }

    const spec = buildPublishSpec();
    if (!spec) {
      return;
    }

    await runPublishWithSpec(spec, recentConfigKeyForCurrentSelection);
  }, [
    activeProviderId,
    appT,
    buildPublishSpec,
    projectInfo,
    recentConfigKeyForCurrentSelection,
    runPublishWithSpec,
    selectedRepo,
  ]);

  const cancelPublish = useCallback(async () => {
    if (!isPublishing || isCancellingPublish) {
      return;
    }

    setIsCancellingPublish(true);
    try {
      const cancelled = await invoke<boolean>("cancel_provider_publish");
      if (cancelled) {
        toast.message(appT.cancellingPublish || "正在取消发布...");
      } else {
        toast.message(appT.noRunningPublishTask || "当前没有运行中的发布任务");
      }
    } catch (err) {
      const errorCode = extractInvokeErrorCode(err);
      if (errorCode === "publish_cancel_failed") {
        toast.error(appT.cancelPublishFailed || "取消发布失败", {
          description:
            appT.cancelPublishFailedDesc ||
            "取消信号发送失败，请检查进程状态后重试。",
        });
      } else {
        toast.error(appT.cancelPublishFailed || "取消发布失败", {
          description: extractInvokeErrorMessage(err),
        });
      }
    } finally {
      setIsCancellingPublish(false);
    }
  }, [appT, isCancellingPublish, isPublishing]);

  return {
    isPublishing,
    isCancellingPublish,
    publishResult,
    lastExecutedSpec,
    currentExecutionRecordId,
    outputLog,
    releaseChecklistOpen,
    setReleaseChecklistOpen,
    artifactActionState,
    setArtifactActionState,
    setCurrentExecutionRecordId,
    dotnetPublishPreviewCommand,
    runPublishWithSpec,
    executePublish,
    cancelPublish,
  };
}
