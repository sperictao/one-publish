import type {
  TranslationMap,
} from "@/hooks/usePublishRunnerTypes";
import type { EnvironmentCheckSnapshot } from "@/lib/environment";
import { type ExecutionRecord } from "@/lib/store";
import { usePublishLogStream } from "@/hooks/usePublishLogStream";
import type { PublishConfigStore } from "@/lib/store";
import type { ProjectInfo } from "@/types/project";
import type { ParameterValue } from "@/types/parameters";

import { usePublishNotify } from "@/hooks/usePublishNotify";
import { usePublishValidate } from "@/hooks/usePublishValidate";
import { usePublishExecute } from "@/hooks/usePublishExecute";

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
    activeProfileName,
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
    selectedRepo,
    activeProviderId,
    activeProviderUsesProjectFile,
    selectedPreset,
    isCustomMode,
    projectInfo,
    specVersion,
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
