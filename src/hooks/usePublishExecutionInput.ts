import { useMemo } from "react";

import type { PublishConfigStore } from "@/lib/store";
import type { ParameterValue } from "@/types/parameters";
interface ProjectInfo {
  root_path: string;
  project_file: string;
  publish_profiles: string[];
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

export interface PublishExecutionInput {
  selectedRepoId: string | null;
  selectedRepo: { path: string } | null;
  activeProviderId: string;
  activeProviderParameters: Record<string, ParameterValue>;
  selectedPreset: string;
  isCustomMode: boolean;
  customConfig: PublishConfigStore;
  defaultOutputDir?: string;
  projectInfo: ProjectInfo | null;
  presets: DotnetPreset[];
  specVersion: number;
}

export function usePublishExecutionInput(
  params: PublishExecutionInput
): PublishExecutionInput {
  return useMemo(
    () => ({
      selectedRepoId: params.selectedRepoId,
      selectedRepo: params.selectedRepo,
      activeProviderId: params.activeProviderId,
      activeProviderParameters: params.activeProviderParameters,
      selectedPreset: params.selectedPreset,
      isCustomMode: params.isCustomMode,
      customConfig: params.customConfig,
      defaultOutputDir: params.defaultOutputDir,
      projectInfo: params.projectInfo,
      presets: params.presets,
      specVersion: params.specVersion,
    }),
    [params]
  );
}
