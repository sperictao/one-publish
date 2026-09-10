import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TranslationMap } from "@/features/publish/publishTransaction";
import type { EnvironmentCheckSnapshot } from "@/features/environment/environment";
import { createPublishPreflightPipeline } from "@/features/publish/publishPreflight";
import {
  canRequestRuntimeOutputAccess,
  preparePublishRuntime,
  type PreparedPublishRuntime,
  type ProviderPublishSpec,
  type PublishSource,
} from "@/features/publish/publishRuntime";
import type {
  PublishSelectionRef,
  ScopedPublishDraft,
} from "@/generated/tauri-contracts";
import type { ProjectInfo } from "@/lib/store/types";
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
  selectionKey: string;
  defaultOutputDir?: string;
  projectInfo: ProjectInfo | null;
  specVersion: number;
  selectedRepoId: string | null;
  selectedRepo: {
    path: string;
    providerId?: string | null;
    publishConfig: {
      selection?: PublishSelectionRef | null;
      drafts: ScopedPublishDraft[];
      profiles: Array<{ id: string; revisionId?: string | null }>;
    };
  } | null;
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

export function resolveSelectedPublishSource(
  repository: NonNullable<UsePublishValidateParams["selectedRepo"]>,
  activeProviderId: string
): PublishSource {
  const { selection, drafts, profiles } = repository.publishConfig;
  if (!selection) {
    return {
      kind: "empty",
      providerId: activeProviderId,
      projectBinding: null,
    };
  }
  switch (selection.kind) {
    case "revision": {
      const profile = profiles.find(
        (item) => item.id === selection.configurationId
      );
      if (!profile?.revisionId) {
        throw new Error("所选发布配置或修订不存在，请重新选择配置");
      }
      return {
        kind: "revision",
        configurationId: profile.id,
        revisionId: profile.revisionId,
      };
    }
    case "draft": {
      const matches = drafts.filter(
        (draft) =>
          draft.providerId === selection.providerId &&
          (draft.projectBinding ?? null) === selection.projectBinding
      );
      if (matches.length !== 1) {
        throw new Error("所选项目草稿不存在或不唯一，请重新选择配置");
      }
      const draft = matches[0];
      if (
        draft.content.providerId !== draft.providerId ||
        (draft.content.projectBinding ?? null) !==
          (draft.projectBinding ?? null)
      ) {
        throw new Error("草稿内容与所选项目作用域不一致，请重新绑定项目");
      }
      return {
        kind: "draft",
        content: draft.content,
        base_revision: draft.baseRevision,
      };
    }
    case "template":
      return { ...selection, projectBinding: null };
    case "projectProfile":
      return selection;
  }
}

export interface UsePublishValidateResult {
  getPublishStartBlocker: () =>
    | "missing-repository"
    | "missing-project"
    | "runtime-not-ready"
    | "runtime-blocked"
    | null;
  resolvePublishRequest: () => Promise<{
    source: PublishSource;
    recentConfigKey?: string;
    preparedRuntime?: PreparedPublishRuntime;
  } | null>;
  requestRuntimeOutputAccess: (
    prepared: PreparedPublishRuntime,
    isCancelled: () => boolean
  ) => Promise<boolean>;
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
  activeProviderUsesProjectFile: _activeProviderUsesProjectFile,
  activeProviderParameters: _activeProviderParameters,
  selectionKey,
  defaultOutputDir,
  projectInfo,
  specVersion,
  selectedRepoId,
  selectedRepo,
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

  const selectedSource = useMemo(() => {
    if (!selectedRepo) return { source: null, error: null };
    try {
      return {
        source: resolveSelectedPublishSource(selectedRepo, activeProviderId),
        error: null,
      };
    } catch (error) {
      return { source: null, error: extractInvokeErrorMessage(error) };
    }
  }, [selectedRepo, activeProviderId]);
  const currentPublishSource = selectedSource.source;
  const publishPresentationSelectionKey = selectionKey;

  // plan 033 路线 B：无命名配置时经自动草稿配置准备，发布总是需要 Runtime。
  const runtimePreparationKey =
    selectedRepoId && selectedRepoPath && currentPublishSource
      ? JSON.stringify({
          selectedRepoId,
          selectedRepoPath,
          source: currentPublishSource,
          defaultOutputDir: defaultOutputDir ?? "",
        })
      : null;
  const preparedRuntime =
    runtimePreparationKey && preparedRuntimeState?.key === runtimePreparationKey
      ? preparedRuntimeState.value
      : null;
  const runtimePreparationError =
    selectedSource.error ??
    (runtimePreparationKey &&
    runtimePreparationErrorState?.key === runtimePreparationKey
      ? runtimePreparationErrorState.message
      : null);
  const publishPreviewCommand =
    preparedRuntime?.status === "ready"
      ? preparedRuntime.command.display_command
      : "";

  const getPublishStartBlocker = useCallback(() => {
    if (!selectedRepo) {
      return "missing-repository";
    }

    // 发布一律走 PublishRuntime（命名配置或自动草稿），必须等 prepare 完成。
    if (!preparedRuntime) {
      return "runtime-not-ready";
    }
    if (
      preparedRuntime.status === "blocked" &&
      !canRequestRuntimeOutputAccess(preparedRuntime)
    ) {
      return "runtime-blocked";
    }

    return null;
  }, [preparedRuntime, projectInfo, selectedRepo]);

  const resolvePublishRequest = useCallback(async () => {
    if (getPublishStartBlocker()) {
      return null;
    }

    if (!currentPublishSource) {
      return null;
    }

    return {
      source: currentPublishSource,
      recentConfigKey: selectionKey || undefined,
      preparedRuntime: preparedRuntime ?? undefined,
    };
  }, [
    currentPublishSource,
    getPublishStartBlocker,
    preparedRuntime,
    selectionKey,
  ]);

  const publishPresentationScopeKey = useMemo(
    () =>
      JSON.stringify([
        runtimePreparationKey,
        buildPublishPresentationScopeKey({
          selectedRepoId,
          selectedRepoPath,
          activeProviderId,
          selectionKey: publishPresentationSelectionKey,
          projectFile: projectInfo?.project_file ?? null,
          specVersion,
          configurationRevisionId,
        }),
      ]),
    [
      runtimePreparationKey,
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
    const source = currentPublishSource;

    if (!source) {
      return () => {
        disposed = true;
      };
    }

    if (runtimePreparationKey && selectedRepoId && selectedRepoPath) {
      const preparation = preparePublishRuntime({
        repositoryId: selectedRepoId,
        source,
        runInputs: {
          defaultOutputDir: defaultOutputDir ?? "",
          promotedManifestDigest: undefined,
        },
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
    currentPublishSource,
    defaultOutputDir,
    runtimePreparationKey,
    selectedRepoPath,
    selectedRepoId,
  ]);

  const isCurrentPresentationRevision = useCallback((runRevision: number) => {
    return presentationRevisionRef.current === runRevision;
  }, []);

  const { runPublishPreflight, requestRuntimeOutputAccess } = useMemo(
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
    requestRuntimeOutputAccess,
    publishPreviewCommand,
    preparedRuntime,
    runtimePreparationError,
    isResolvingSelectedProjectProfile: false,
    publishPresentationScopeKey,
  };
}
