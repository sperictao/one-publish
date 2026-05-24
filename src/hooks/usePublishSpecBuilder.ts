import { useCallback } from "react";

import {
  buildProviderPublishSpec,
  type DotnetPublishIntentConfig,
} from "@/lib/providerPublishAdapter";
import type { ParameterValue } from "@/types/parameters";
import type { ProviderPublishSpec } from "@/lib/publishRuntime";
import type { ProjectInfo } from "@/types/project";

export function usePublishSpecBuilder(params: {
  activeProviderId: string;
  activeProviderUsesProjectFile: boolean;
  activeProviderParameters: Record<string, ParameterValue>;
  projectInfo: ProjectInfo | null;
  selectedRepo: { path: string } | null;
  specVersion: number;
  getCurrentConfig: () => DotnetPublishIntentConfig;
}) {
  const buildPublishSpec = useCallback((): ProviderPublishSpec | null => {
    return buildProviderPublishSpec({
      providerId: params.activeProviderId,
      providerUsesProjectFile: params.activeProviderUsesProjectFile,
      providerParameters: params.activeProviderParameters,
      projectInfo: params.projectInfo,
      repository: params.selectedRepo,
      specVersion: params.specVersion,
      dotnetConfig:
        params.activeProviderId === "dotnet"
          ? params.getCurrentConfig()
          : undefined,
    });
  }, [params]);

  return { buildPublishSpec };
}
