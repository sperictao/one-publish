import type {
  TranslationMap,
} from "@/features/publish/publishTransaction";
import type { EnvironmentCheckSnapshot } from "@/features/environment/environment";
import type { DotnetPreset } from "@/features/config/dotnetPresets";
import { type ExecutionRecord } from "@/lib/store/types";
import { usePublishLogStream } from "@/features/publish/usePublishLogStream";
import type { PublishConfigStore, ProjectInfo } from "@/lib/store/types";
import type { ParameterValue } from "@/types/parameters";

import { usePublishNotify } from "@/features/publish/usePublishNotify";
import { usePublishValidate } from "@/features/publish/usePublishValidate";
import { usePublishExecute } from "@/features/publish/usePublishExecute";

interface UsePublishRunnerParams {
  appT: TranslationMap;
  publishT: TranslationMap;
  selectedRepoId: string | null;
  selectedRepo: { path: string } | null;
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
  pushRecentConfig: (key: string, repoId?: string | null) => void;
  openEnvironmentDialog: (
    initialCheck?: EnvironmentCheckSnapshot | null,
    providerIds?: string[]
  ) => void;
  setEnvironmentLastCheck: (
    snapshot: EnvironmentCheckSnapshot | null
  ) => void;
  savePublishRecord: (record: ExecutionRecord) => void;
}

export function usePublishRunner({
  appT,
  publishT,
  selectedRepoId,
  selectedRepo,
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
  pushRecentConfig,
  openEnvironmentDialog,
  setEnvironmentLastCheck,
  savePublishRecord,
}: UsePublishRunnerParams) {
  // --- Log stream (shared, called once) ---
  const {
    outputLog,
    getOutputLogSnapshot,
    beginLogCapture,
    hideLogCapture,
    resetLogCapture,
    replaceCapturedOutputLog,
  } = usePublishLogStream();

  // --- Notification layer (now event-driven subscriber) ---
  const notify = usePublishNotify({ appT, publishT, savePublishRecord });

  // --- Validation / preflight layer ---
  const validate = usePublishValidate({
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
    appT,
    outputLog,
    resetLogCapture,
    notifyFeedback: notify.notifyFeedback,
    syncTrayPublishStatus: notify.syncTrayPublishStatus,
    restoreMainWindowIfNeeded: notify.restoreMainWindowIfNeeded,
    openEnvironmentDialog,
    setEnvironmentLastCheck,
  });

  // --- Execution layer ---
  const execute = usePublishExecute({
    appT,
    publishT,
    selectedRepoId,
    pushRecentConfig,
    beginLogCapture,
    hideLogCapture,
    getOutputLogSnapshot,
    replaceCapturedOutputLog,
    validate,
  });

  // --- Public API (unchanged) ---
  return {
    outputLog,
    isResolvingSelectedProjectProfile:
      validate.isResolvingSelectedProjectProfile,
    publishPreviewCommand: validate.publishPreviewCommand,
    runPublishSpec: execute.runPublishSpec,
    startPublish: execute.startPublish,
    cancelPublish: execute.cancelPublish,
  };
}
