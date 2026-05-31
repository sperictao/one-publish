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
