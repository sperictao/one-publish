import { useCallback } from "react";
import { toast } from "sonner";

import type { TranslationMap } from "@/hooks/usePublishExecutionTypes";
import type { EnvironmentCheckResult } from "@/lib/environment";
import type { ExecutionRecord } from "@/lib/store";
import { useDotnetPublishSelection } from "@/hooks/useDotnetPublishSelection";
import type { PublishExecutionInput } from "@/hooks/usePublishExecutionInput";
import { usePublishLogStream } from "@/hooks/usePublishLogStream";
import { usePublishSpecBuilder } from "@/hooks/usePublishSpecBuilder";
import { usePublishUiState } from "@/hooks/usePublishUiState";

const loadPublishExecutionRuntime = () =>
  import("@/hooks/usePublishExecution.runtime");

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
  const {
    isPublishing,
    setIsPublishing,
    isCancellingPublish,
    setIsCancellingPublish,
    publishResult,
    setPublishResult,
    lastExecutedSpec,
    setLastExecutedSpec,
    currentExecutionRecordId,
    setCurrentExecutionRecordId,
    releaseChecklistOpen,
    setReleaseChecklistOpen,
    artifactActionState,
    setArtifactActionState,
  } = usePublishUiState();
  const { outputLog, setOutputLog } = usePublishLogStream();

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
      const { runPublishWithSpecRuntime } = await loadPublishExecutionRuntime();
      await runPublishWithSpecRuntime({
        appT,
        publishT,
        spec,
        recentConfigKey,
        selectedRepoId,
        callSurface,
        setLastExecutedSpec,
        setCurrentExecutionRecordId,
        setIsPublishing,
        setPublishResult,
        setOutputLog,
        setReleaseChecklistOpen,
        setArtifactActionState,
        setIsCancellingPublish,
      });
    },
    [
      appT,
      callSurface,
      publishT,
      selectedRepoId,
      setArtifactActionState,
      setCurrentExecutionRecordId,
      setIsCancellingPublish,
      setIsPublishing,
      setLastExecutedSpec,
      setOutputLog,
      setPublishResult,
      setReleaseChecklistOpen,
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

    const { cancelPublishRuntime } = await loadPublishExecutionRuntime();
    await cancelPublishRuntime({
      appT,
      setIsCancellingPublish,
    });
  }, [appT, isCancellingPublish, isPublishing, setIsCancellingPublish]);

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
