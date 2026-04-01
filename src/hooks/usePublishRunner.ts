import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

import type { TranslationMap } from "@/hooks/usePublishRunnerTypes";
import {
  createEnvironmentCheckSnapshot,
  runEnvironmentCheck,
  type EnvironmentCheckSnapshot,
} from "@/lib/environment";
import type { ExecutionRecord } from "@/lib/store";
import { useDotnetPublishSelection } from "@/hooks/useDotnetPublishSelection";
import { usePublishLogStream } from "@/hooks/usePublishLogStream";
import { usePublishSpecBuilder } from "@/hooks/usePublishSpecBuilder";
import { usePublishUiState } from "@/hooks/usePublishUiState";
import { createPublishExecutionRecord } from "@/lib/publishExecutionRecord";
import type { PublishConfigStore } from "@/lib/store";
import type { ProjectInfo } from "@/types/project";
import type { ParameterValue } from "@/types/parameters";

const loadInvokeErrors = () => import("@/lib/tauri/invokeErrors");
const loadPublishFailureFeedback = () =>
  import("@/hooks/usePublishFailureFeedback");
const loadCancelPublishFeedback = () =>
  import("@/hooks/useCancelPublishFeedback");

export interface PublishResult {
  provider_id: string;
  success: boolean;
  cancelled: boolean;
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

interface DotnetPreset {
  id: string;
  name: string;
  description: string;
  config: {
    configuration: string;
    runtime: string;
    self_contained: boolean;
  };
}

interface UsePublishRunnerParams {
  appT: TranslationMap;
  publishT: TranslationMap;
  selectedRepoId: string | null;
  selectedRepo: { path: string } | null;
  activeProviderId: string;
  activeProviderParameters: Record<string, ParameterValue>;
  selectedPreset: string;
  isCustomMode: boolean;
  activeProfileName: string | null;
  customConfig: PublishConfigStore;
  defaultOutputDir?: string;
  projectInfo: ProjectInfo | null;
  presets: DotnetPreset[];
  specVersion: number;
  pushRecentConfig: (key: string, repoId?: string | null) => void;
  openEnvironmentDialog: (
    initialCheck?: EnvironmentCheckSnapshot | null,
    providerIds?: string[]
  ) => void;
  setEnvironmentLastCheck: (snapshot: EnvironmentCheckSnapshot | null) => void;
  savePublishRecord: (record: ExecutionRecord) => void;
}

export function usePublishRunner({
  appT,
  publishT,
  selectedRepoId,
  selectedRepo,
  activeProviderId,
  activeProviderParameters,
  selectedPreset,
  isCustomMode,
  activeProfileName,
  customConfig,
  defaultOutputDir,
  projectInfo,
  presets,
  specVersion,
  pushRecentConfig,
  openEnvironmentDialog,
  setEnvironmentLastCheck,
  savePublishRecord,
}: UsePublishRunnerParams) {
  const {
    isPublishing,
    setIsPublishing,
    isCancellingPublish,
    setIsCancellingPublish,
    publishResult,
    setPublishResult,
    lastPublishSpec,
    setLastPublishSpec,
    currentPublishRecordId,
    setCurrentPublishRecordId,
    releaseChecklistOpen,
    setReleaseChecklistOpen,
    artifactActionState,
    setArtifactActionState,
  } = usePublishUiState();
  const { outputLog, setOutputLog, getOutputLogSnapshot } = usePublishLogStream();

  const {
    getCurrentConfig,
    dotnetPublishPreviewCommand,
    recentConfigKeyForCurrentSelection,
    resolvedProjectProfile,
    resolveSelectedProjectProfile,
  } = useDotnetPublishSelection({
    activeProviderId,
    selectedPreset,
    isCustomMode,
    activeProfileName,
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

  const waitForOutputLogSnapshot = useCallback(async (): Promise<string> => {
    await new Promise<void>((resolve) => {
      if (typeof window === "undefined" || typeof window.setTimeout !== "function") {
        resolve();
        return;
      }

      window.setTimeout(resolve, 0);
    });

    return getOutputLogSnapshot();
  }, [getOutputLogSnapshot]);

  const runPublishSpec = useCallback(
    async (spec: ProviderPublishSpec, recentConfigKey?: string | null) => {
      try {
        const env = await runEnvironmentCheck([spec.provider_id]);
        const environmentCheck = createEnvironmentCheckSnapshot(env, [
          spec.provider_id,
        ]);
        setEnvironmentLastCheck(environmentCheck);

        const critical = env.issues.find((item) => item.severity === "critical");
        if (critical) {
          toast.error(appT.environmentBlocked || "环境未就绪，已阻止发布", {
            description: critical.description,
          });
          openEnvironmentDialog(environmentCheck, [spec.provider_id]);
          return;
        }

        const warning = env.issues.find((item) => item.severity === "warning");
        if (warning) {
          toast.warning(appT.environmentWarning || "环境存在警告", {
            description: warning.description,
          });
        }
      } catch (err) {
        const { extractInvokeErrorMessage } = await loadInvokeErrors();
        toast.error(appT.environmentCheckFailed || "环境检查失败", {
          description: extractInvokeErrorMessage(err),
        });
      }

      setLastPublishSpec(spec);
      setCurrentPublishRecordId(null);
      setIsPublishing(true);
      setPublishResult(null);
      setOutputLog("");
      setReleaseChecklistOpen(false);
      setArtifactActionState({ packageResult: null, signResult: null });

      const executionStartedAt = new Date().toISOString();

      try {
        if (recentConfigKey) {
          pushRecentConfig(recentConfigKey);
        }

        const result = await invoke<PublishResult>("execute_provider_publish", {
          spec,
        });
        const outputLogSnapshot = await waitForOutputLogSnapshot();

        setPublishResult(result);

        if (result.success) {
          toast.success(publishT.success || "发布成功!", {
            description: result.output_dir
              ? (publishT.output || "输出目录: {{dir}}").replace(
                  "{{dir}}",
                  result.output_dir
                )
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

        const record = createPublishExecutionRecord({
          spec,
          repoId: selectedRepoId,
          startedAt: executionStartedAt,
          finishedAt: new Date().toISOString(),
          result,
          outputLog: outputLogSnapshot,
        });
        setCurrentPublishRecordId(record.id);
        savePublishRecord(record);
      } catch (err) {
        const [
          { analyzePublishExecutionFailure, extractInvokeErrorMessage },
          { getPublishFailureFeedback },
        ] = await Promise.all([
          loadInvokeErrors(),
          loadPublishFailureFeedback(),
        ]);
        const rawErrorMessage = extractInvokeErrorMessage(err);
        const failureReason = analyzePublishExecutionFailure(err);

        const failedResult: PublishResult = {
          provider_id: spec.provider_id,
          success: false,
          cancelled: false,
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

        const record = createPublishExecutionRecord({
          spec,
          repoId: selectedRepoId,
          startedAt: executionStartedAt,
          finishedAt: new Date().toISOString(),
          result: failedResult,
          outputLog: await waitForOutputLogSnapshot(),
        });
        setCurrentPublishRecordId(record.id);
        savePublishRecord(record);
      } finally {
        setIsPublishing(false);
        setIsCancellingPublish(false);
      }
    },
    [
      appT,
      openEnvironmentDialog,
      publishT,
      pushRecentConfig,
      savePublishRecord,
      selectedRepoId,
      setEnvironmentLastCheck,
      waitForOutputLogSnapshot,
    ]
  );

  const startPublish = useCallback(async () => {
    if (!selectedRepo) {
      toast.error(appT.selectRepositoryFirst || "请先选择仓库");
      return;
    }

    if (activeProviderId === "dotnet" && !projectInfo) {
      toast.error(appT.selectDotnetProjectFirst || "请先选择 .NET 项目");
      return;
    }

    if (
      activeProviderId === "dotnet" &&
      projectInfo &&
      !isCustomMode &&
      selectedPreset.startsWith("profile-")
    ) {
      const projectProfile =
        resolvedProjectProfile ?? (await resolveSelectedProjectProfile());

      if (projectProfile) {
        await runPublishSpec(
          {
            version: specVersion,
            provider_id: "dotnet",
            project_path: projectInfo.project_file,
            parameters: projectProfile.parameters,
          },
          recentConfigKeyForCurrentSelection
        );
        return;
      }
    }

    const spec = buildPublishSpec();
    if (!spec) {
      return;
    }

    await runPublishSpec(spec, recentConfigKeyForCurrentSelection);
  }, [
    activeProviderId,
    appT,
    buildPublishSpec,
    isCustomMode,
    projectInfo,
    recentConfigKeyForCurrentSelection,
    resolveSelectedProjectProfile,
    resolvedProjectProfile,
    runPublishSpec,
    selectedRepo,
    selectedPreset,
    specVersion,
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
      const [
        { extractInvokeErrorCode, extractInvokeErrorMessage },
        { getCancelPublishFeedback },
      ] = await Promise.all([
        loadInvokeErrors(),
        loadCancelPublishFeedback(),
      ]);
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
    lastPublishSpec,
    currentPublishRecordId,
    outputLog,
    releaseChecklistOpen,
    setReleaseChecklistOpen,
    artifactActionState,
    setArtifactActionState,
    dotnetPublishPreviewCommand,
    runPublishSpec,
    startPublish,
    cancelPublish,
  };
}
