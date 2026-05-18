import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useDotnetPublishSelection } from "@/hooks/useDotnetPublishSelection";
import { usePublishSpecBuilder } from "@/hooks/usePublishSpecBuilder";
import type { TranslationMap } from "@/hooks/usePublishRunnerTypes";
import type { EnvironmentCheckSnapshot } from "@/lib/environment";
import { renderPublishCommand } from "@/lib/renderPublishCommand";
import { createPublishPreflightPipeline } from "@/lib/publishPreflight";
import type { DotnetPreset } from "@/lib/dotnetPresets";
import type { ProviderPublishSpec } from "@/lib/publishRuntime";
import type { PublishConfigStore } from "@/lib/store";
import type { ProjectInfo } from "@/types/project";
import type { ParameterValue } from "@/types/parameters";
import type { PublishResult, SpecValue } from "@/generated/tauri-contracts";

export function buildPublishPresentationScopeKey(params: {
  selectedRepoId: string | null;
  selectedRepoPath: string | null;
  activeProviderId: string;
  selectionKey: string;
  projectFile: string | null;
  specVersion: number;
}) {
  return JSON.stringify({
    selectedRepoId: params.selectedRepoId ?? params.selectedRepoPath,
    activeProviderId: params.activeProviderId,
    selectionKey: params.selectionKey,
    projectFile: params.projectFile,
    specVersion: params.specVersion,
  });
}

export interface UsePublishValidateParams {
  activeProviderId: string;
  activeProviderUsesProjectFile: boolean;
  activeProviderParameters: Record<string, ParameterValue>;
  selectedPreset: string;
  isCustomMode: boolean;
  activeProfileName: string | null;
  customConfig: PublishConfigStore;
  defaultOutputDir?: string;
  projectInfo: ProjectInfo | null;
  presets: DotnetPreset[];
  specVersion: number;
  selectedRepoId: string | null;
  selectedRepo: { path: string } | null;
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
  setEnvironmentLastCheck: (
    snapshot: EnvironmentCheckSnapshot | null
  ) => void;
}

export interface UsePublishValidateResult {
  getPublishStartBlocker: () =>
    | "missing-repository"
    | "missing-project"
    | null;
  resolvePublishRequest: () => Promise<{
    spec: ProviderPublishSpec;
    recentConfigKey?: string;
  } | null>;
  runPublishPreflight: (
    spec: ProviderPublishSpec,
    options: {
      runRevision: number;
      feedbackMode: "toast" | "system";
      restoreWindowOnFailure: boolean;
      trayStatusEffect: boolean;
    }
  ) => Promise<boolean>;
  executePublishWithProtectedAccessRecovery: (
    spec: ProviderPublishSpec
  ) => Promise<PublishResult>;
  publishPreviewCommand: string;
  isResolvingSelectedProjectProfile: boolean;
  publishPresentationScopeKey: string;
}

export function usePublishValidate({
  activeProviderId,
  activeProviderUsesProjectFile,
  activeProviderParameters,
  selectedPreset,
  isCustomMode,
  activeProfileName,
  customConfig,
  defaultOutputDir,
  projectInfo,
  presets,
  specVersion,
  selectedRepoId,
  selectedRepo,
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
  const [publishPreviewCommand, setPublishPreviewCommand] = useState("");

  const {
    getCurrentConfig,
    recentConfigKeyForCurrentSelection,
    resolvedProjectProfile,
    resolveSelectedProjectProfile,
    isResolvingSelectedProjectProfile,
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
    activeProviderUsesProjectFile,
    activeProviderParameters,
    projectInfo,
    selectedRepo,
    specVersion,
    getCurrentConfig,
  });

  const publishPresentationSelectionKey = useMemo(() => {
    if (activeProviderId !== "dotnet") {
      return `provider:${activeProviderId}`;
    }

    if (recentConfigKeyForCurrentSelection) {
      return recentConfigKeyForCurrentSelection;
    }

    if (isCustomMode) {
      return activeProfileName
        ? `userprofile:${activeProfileName}`
        : "custom";
    }

    return `preset:${selectedPreset}`;
  }, [
    activeProfileName,
    activeProviderId,
    isCustomMode,
    recentConfigKeyForCurrentSelection,
    selectedPreset,
  ]);

  const buildCurrentPublishSpec = useCallback((): ProviderPublishSpec | null => {
    if (!selectedRepo) {
      return null;
    }

    if (activeProviderUsesProjectFile && !projectInfo) {
      return null;
    }

    if (activeProviderId === "dotnet") {
      const resolvedProjectInfo = projectInfo;
      if (!resolvedProjectInfo) {
        return null;
      }
      if (!isCustomMode && selectedPreset.startsWith("profile-")) {
        if (resolvedProjectProfile) {
          return {
            version: specVersion,
            provider_id: "dotnet",
            project_path: resolvedProjectInfo.project_file,
            parameters: resolvedProjectProfile.parameters,
          };
        }
      }
    }

    return buildPublishSpec();
  }, [
    activeProviderId,
    activeProviderUsesProjectFile,
    buildPublishSpec,
    isCustomMode,
    projectInfo,
    resolvedProjectProfile,
    selectedPreset,
    selectedRepo,
    specVersion,
  ]);

  const getPublishStartBlocker = useCallback(() => {
    if (!selectedRepo) {
      return "missing-repository";
    }

    if (activeProviderUsesProjectFile && !projectInfo) {
      return "missing-project";
    }

    return null;
  }, [activeProviderUsesProjectFile, projectInfo, selectedRepo]);

  const resolvePublishRequest = useCallback(async () => {
    if (getPublishStartBlocker()) {
      return null;
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
        return {
          spec: {
            version: specVersion,
            provider_id: "dotnet",
            project_path: projectInfo.project_file,
            parameters: projectProfile.parameters as Record<string, SpecValue>,
          },
          recentConfigKey: recentConfigKeyForCurrentSelection ?? undefined,
        };
      }
    }

    const spec = buildPublishSpec();
    if (!spec) {
      return null;
    }

    return {
      spec,
      recentConfigKey: recentConfigKeyForCurrentSelection ?? undefined,
    };
  }, [
    activeProviderId,
    buildPublishSpec,
    getPublishStartBlocker,
    isCustomMode,
    projectInfo,
    recentConfigKeyForCurrentSelection,
    resolveSelectedProjectProfile,
    resolvedProjectProfile,
    selectedPreset,
    specVersion,
  ]);

  const publishPresentationScopeKey = useMemo(
    () =>
      buildPublishPresentationScopeKey({
        selectedRepoId,
        selectedRepoPath: selectedRepo?.path ?? null,
        activeProviderId,
        selectionKey: publishPresentationSelectionKey,
        projectFile: projectInfo?.project_file ?? null,
        specVersion,
      }),
    [
      activeProviderId,
      projectInfo?.project_file,
      publishPresentationSelectionKey,
      selectedRepo?.path,
      selectedRepoId,
      specVersion,
    ]
  );

  useEffect(() => {
    let disposed = false;
    const spec = buildCurrentPublishSpec();

    if (!spec) {
      setPublishPreviewCommand("");
      return () => {
        disposed = true;
      };
    }

    void renderPublishCommand(spec)
      .then((command) => {
        if (!disposed) {
          setPublishPreviewCommand(command.display_command);
        }
      })
      .catch(() => {
        if (!disposed) {
          setPublishPreviewCommand("");
        }
      });

    return () => {
      disposed = true;
    };
  }, [buildCurrentPublishSpec]);

  const isCurrentPresentationRevision = useCallback(
    (runRevision: number) => {
      return presentationRevisionRef.current === runRevision;
    },
    []
  );

  const { runPublishPreflight, executePublishWithProtectedAccessRecovery } =
    useMemo(
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
    executePublishWithProtectedAccessRecovery,
    publishPreviewCommand,
    isResolvingSelectedProjectProfile,
    publishPresentationScopeKey,
  };
}
