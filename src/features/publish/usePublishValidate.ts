import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useDotnetPublishSelection } from "@/features/config/useDotnetPublishSelection";
import { usePublishSpecBuilder } from "@/features/publish/usePublishSpecBuilder";
import type { TranslationMap } from "@/features/publish/publishTransaction";
import type { EnvironmentCheckSnapshot } from "@/features/environment/environment";
import { createPublishPreflightPipeline } from "@/features/publish/publishPreflight";
import { getRecentConfigKeyFromSelection } from "@/features/config/publishConfigIdentity";
import type { DotnetPreset } from "@/features/config/dotnetPresets";
import {
  prepareDraftPublishRuntime,
  preparePublishRuntime,
  type PreparedPublishRuntime,
  type ProviderPublishSpec,
} from "@/features/publish/publishRuntime";
import type { ProjectInfo, PublishConfigStore } from "@/lib/store/types";
import type { ParameterValue } from "@/types/parameters";
import { extractInvokeErrorMessage } from "@/lib/tauri/invokeErrors";

export function buildPublishPresentationScopeKey(params: {
  selectedRepoId: string | null;
  selectedRepoPath: string | null;
  activeProviderId: string;
  selectionKey: string;
  projectFile: string | null;
  specVersion: number;
  configurationRevisionId?: string | null;
}) {
  return JSON.stringify({
    selectedRepoId: params.selectedRepoId ?? params.selectedRepoPath,
    activeProviderId: params.activeProviderId,
    selectionKey: params.selectionKey,
    projectFile: params.projectFile,
    specVersion: params.specVersion,
    configurationRevisionId: params.configurationRevisionId ?? null,
  });
}

export interface UsePublishValidateParams {
  activeProviderId: string;
  activeProviderUsesProjectFile: boolean;
  activeProviderParameters: Record<string, ParameterValue>;
  selectedPreset: string;
  isCustomMode: boolean;
  customConfig: PublishConfigStore;
  defaultOutputDir?: string;
  projectInfo: ProjectInfo | null;
  presets: DotnetPreset[];
  specVersion: number;
  selectedRepoId: string | null;
  selectedRepo: { path: string } | null;
  configurationId?: string | null;
  configurationRevisionId?: string | null;
  appT: TranslationMap;
  outputLog: string;
  resetLogCapture: () => void;
  notifyFeedback: (
    level: "success" | "warning" | "error",
    title: string,
    description?: string,
    mode?: "toast" | "system"
  ) => Promise<boolean>;
  syncTrayPublishStatus: (
    status: "idle" | "success" | "failure"
  ) => Promise<void>;
  restoreMainWindowIfNeeded: (shouldRestore: boolean) => Promise<void>;
  openEnvironmentDialog: (
    initialCheck?: EnvironmentCheckSnapshot | null,
    providerIds?: string[]
  ) => void;
  setEnvironmentLastCheck: (snapshot: EnvironmentCheckSnapshot | null) => void;
}

export interface UsePublishValidateResult {
  getPublishStartBlocker: () =>
    | "missing-repository"
    | "missing-project"
    | "runtime-not-ready"
    | "runtime-blocked"
    | null;
  resolvePublishRequest: () => Promise<{
    spec: ProviderPublishSpec;
    recentConfigKey?: string;
    preparedRuntime?: PreparedPublishRuntime;
  } | null>;
  runPublishPreflight: (
    spec: ProviderPublishSpec,
    options: {
      runRevision: number;
      feedbackMode: "toast" | "system";
      restoreWindowOnFailure: boolean;
      trayStatusEffect: boolean;
      isCancelled: () => boolean;
    }
  ) => Promise<boolean>;
  publishPreviewCommand: string;
  preparedRuntime: PreparedPublishRuntime | null;
  runtimePreparationError: string | null;
  isResolvingSelectedProjectProfile: boolean;
  publishPresentationScopeKey: string;
}

export function usePublishValidate({
  activeProviderId,
  activeProviderUsesProjectFile,
  activeProviderParameters,
  selectedPreset,
  isCustomMode,
  customConfig,
  defaultOutputDir,
  projectInfo,
  presets,
  specVersion,
  selectedRepoId,
  selectedRepo,
  configurationId,
  configurationRevisionId,
  appT,
  outputLog: _outputLog,
  resetLogCapture,
  notifyFeedback,
  syncTrayPublishStatus,
  restoreMainWindowIfNeeded,
  openEnvironmentDialog,
  setEnvironmentLastCheck,
}: UsePublishValidateParams): UsePublishValidateResult {
  const presentationRevisionRef = useRef(0);
  const [preparedRuntimeState, setPreparedRuntimeState] = useState<{
    key: string;
    value: PreparedPublishRuntime;
  } | null>(null);
  const [runtimePreparationErrorState, setRuntimePreparationErrorState] =
    useState<{ key: string; message: string } | null>(null);
  const selectedRepoPath = selectedRepo?.path ?? null;

  const {
    getCurrentConfig,
    selectionIdentity,
    recentConfigKeyForCurrentSelection,
    isResolvingSelectedProjectProfile,
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
    activeProviderUsesProjectFile,
    activeProviderParameters,
    projectInfo,
    selectedRepo,
    specVersion,
    getCurrentConfig,
  });

  const publishPresentationSelectionKey = useMemo(() => {
    const recentConfigKey = getRecentConfigKeyFromSelection(selectionIdentity);
    if (recentConfigKey) {
      return recentConfigKey;
    }

    if (selectionIdentity.kind === "provider") {
      return `provider:${selectionIdentity.providerId}`;
    }

    return "custom";
  }, [selectionIdentity]);

  const buildCurrentPublishSpec =
    useCallback((): ProviderPublishSpec | null => {
      if (!selectedRepo) {
        return null;
      }

      if (activeProviderUsesProjectFile && !projectInfo) {
        return null;
      }

      return buildPublishSpec();
    }, [
      activeProviderUsesProjectFile,
      buildPublishSpec,
      projectInfo,
      selectedRepo,
    ]);

  const currentPublishSpec = useMemo(
    () => buildCurrentPublishSpec(),
    [buildCurrentPublishSpec]
  );
  // plan 033 路线 B：无命名配置时经自动草稿配置准备，发布总是需要 Runtime。
  const runtimePreparationKey =
    selectedRepoId && selectedRepoPath && currentPublishSpec
      ? JSON.stringify({
          selectedRepoId,
          selectedRepoPath,
          configurationId: configurationId ?? null,
          configurationRevisionId: configurationRevisionId ?? null,
          spec: currentPublishSpec,
        })
      : null;
  const preparedRuntime =
    runtimePreparationKey && preparedRuntimeState?.key === runtimePreparationKey
      ? preparedRuntimeState.value
      : null;
  const runtimePreparationError =
    runtimePreparationKey &&
    runtimePreparationErrorState?.key === runtimePreparationKey
      ? runtimePreparationErrorState.message
      : null;
  const publishPreviewCommand = preparedRuntime?.command.display_command ?? "";

  const getPublishStartBlocker = useCallback(() => {
    if (!selectedRepo) {
      return "missing-repository";
    }

    if (activeProviderUsesProjectFile && !projectInfo) {
      return "missing-project";
    }

    // 发布一律走 PublishRuntime（命名配置或自动草稿），必须等 prepare 完成。
    if (!preparedRuntime) {
      return "runtime-not-ready";
    }
    if (preparedRuntime.blockedReason) {
      return "runtime-blocked";
    }

    return null;
  }, [
    activeProviderUsesProjectFile,
    preparedRuntime,
    projectInfo,
    selectedRepo,
  ]);

  const resolvePublishRequest = useCallback(async () => {
    if (getPublishStartBlocker()) {
      return null;
    }

    const spec = buildPublishSpec();
    if (!spec) {
      return null;
    }

    return {
      spec,
      recentConfigKey: recentConfigKeyForCurrentSelection ?? undefined,
      preparedRuntime: preparedRuntime ?? undefined,
    };
  }, [
    buildPublishSpec,
    getPublishStartBlocker,
    preparedRuntime,
    recentConfigKeyForCurrentSelection,
  ]);

  const publishPresentationScopeKey = useMemo(
    () =>
      buildPublishPresentationScopeKey({
        selectedRepoId,
        selectedRepoPath,
        activeProviderId,
        selectionKey: publishPresentationSelectionKey,
        projectFile: projectInfo?.project_file ?? null,
        specVersion,
        configurationRevisionId,
      }),
    [
      activeProviderId,
      configurationRevisionId,
      projectInfo?.project_file,
      publishPresentationSelectionKey,
      selectedRepoPath,
      selectedRepoId,
      specVersion,
    ]
  );

  useEffect(() => {
    let disposed = false;
    const spec = currentPublishSpec;

    if (!spec) {
      return () => {
        disposed = true;
      };
    }

    if (runtimePreparationKey && selectedRepoId && selectedRepoPath) {
      const preparation =
        configurationId && configurationRevisionId
          ? preparePublishRuntime({
              repositoryId: selectedRepoId,
              repositoryPath: selectedRepoPath,
              configurationId,
              configurationRevisionId,
              spec,
            })
          : prepareDraftPublishRuntime({
              repositoryId: selectedRepoId,
              repositoryPath: selectedRepoPath,
              providerId: activeProviderId,
              // 草稿修订参数与本次 spec 同源构造，保证参数匹配不阻断。
              parameters: spec.parameters,
              spec,
            });
      void preparation
        .then((prepared) => {
          if (!disposed) {
            setPreparedRuntimeState({
              key: runtimePreparationKey,
              value: prepared,
            });
            setRuntimePreparationErrorState(null);
          }
        })
        .catch((error) => {
          if (!disposed) {
            setPreparedRuntimeState(null);
            setRuntimePreparationErrorState({
              key: runtimePreparationKey,
              message: extractInvokeErrorMessage(error),
            });
          }
        });
    }

    return () => {
      disposed = true;
    };
  }, [
    activeProviderId,
    configurationId,
    configurationRevisionId,
    currentPublishSpec,
    runtimePreparationKey,
    selectedRepoPath,
    selectedRepoId,
  ]);

  const isCurrentPresentationRevision = useCallback((runRevision: number) => {
    return presentationRevisionRef.current === runRevision;
  }, []);

  const { runPublishPreflight } = useMemo(
    () =>
      createPublishPreflightPipeline({
        appT,
        notifyFeedback,
        syncTrayPublishStatus,
        restoreMainWindowIfNeeded,
        resetLogCapture,
        isCurrentPresentationRevision,
        openEnvironmentDialog,
        setEnvironmentLastCheck,
      }),
    [
      appT,
      notifyFeedback,
      syncTrayPublishStatus,
      restoreMainWindowIfNeeded,
      resetLogCapture,
      isCurrentPresentationRevision,
      openEnvironmentDialog,
      setEnvironmentLastCheck,
    ]
  );

  return {
    getPublishStartBlocker,
    resolvePublishRequest,
    runPublishPreflight,
    publishPreviewCommand,
    preparedRuntime,
    runtimePreparationError,
    isResolvingSelectedProjectProfile,
    publishPresentationScopeKey,
  };
}
