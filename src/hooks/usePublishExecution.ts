import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

import { getCancelPublishFeedback } from "@/hooks/useCancelPublishFeedback";
import { getPublishFailureFeedback } from "@/hooks/usePublishFailureFeedback";
import type { TranslationMap } from "@/hooks/usePublishExecutionTypes";
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
import { usePublishLogStream } from "@/hooks/usePublishLogStream";
import { usePublishSpecBuilder } from "@/hooks/usePublishSpecBuilder";

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
  const { outputLog, setOutputLog } = usePublishLogStream();
  const [releaseChecklistOpen, setReleaseChecklistOpen] = useState(false);
  const [artifactActionState, setArtifactActionState] =
    useState<ArtifactActionState>({
      packageResult: null,
      signResult: null,
    });

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

        const feedback = getPublishFailureFeedback(
          failureReason,
          appT,
          rawErrorMessage
        );
        toast.error(feedback.title, {
          description: feedback.description,
        });

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
      const feedback = getCancelPublishFeedback(
        appT,
        errorCode,
        extractInvokeErrorMessage(err)
      );
      toast.error(feedback.title, {
        description: feedback.description,
      });
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
