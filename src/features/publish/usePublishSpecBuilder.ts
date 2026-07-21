import { useCallback } from "react";

import {
  buildProviderPublishSpec,
  type DotnetPublishIntentConfig,
} from "@/features/config/providerPublishAdapter";
import type { ParameterValue } from "@/types/parameters";
import type { ProviderPublishSpec } from "@/features/publish/publishRuntime";
import type { ProjectInfo } from "@/lib/store/types";

export function usePublishSpecBuilder(params: {
  activeProviderId: string;
  activeProviderUsesProjectFile: boolean;
  activeProviderParameters: Record<string, ParameterValue>;
  projectInfo: ProjectInfo | null;
  selectedRepo: { path: string } | null;
  specVersion: number;
  getCurrentConfig: () => DotnetPublishIntentConfig;
}) {
  const {
    activeProviderId,
    activeProviderUsesProjectFile,
    activeProviderParameters,
    projectInfo,
    selectedRepo,
    specVersion,
    getCurrentConfig,
  } = params;
  const buildPublishSpec = useCallback((): ProviderPublishSpec | null => {
    return buildProviderPublishSpec({
      providerId: activeProviderId,
      providerUsesProjectFile: activeProviderUsesProjectFile,
      providerParameters: activeProviderParameters,
      projectInfo,
      repository: selectedRepo,
      specVersion,
      dotnetConfig:
        activeProviderId === "dotnet" ? getCurrentConfig() : undefined,
    });
  }, [
    activeProviderId,
    activeProviderParameters,
    activeProviderUsesProjectFile,
    getCurrentConfig,
    projectInfo,
    selectedRepo,
    specVersion,
  ]);

  return { buildPublishSpec };
}
