import { useMemo } from "react";

import { buildDotnetProfileParameters } from "@/features/config/dotnetPublishConfig";
import type { ConfigParameters, PublishConfigStore } from "@/lib/store/types";
import type { ParameterValue } from "@/types/parameters";

export function useDialogDerivedState(params: {
  activeProviderId: string;
  activeProviderUsesProjectFile?: boolean;
  customConfig: PublishConfigStore;
  activeProviderParameters: Record<string, ParameterValue>;
  projectFile?: string | null;
  selectedRepoPath?: string | null;
}) {
  const providerUsesProjectFile = params.activeProviderUsesProjectFile ?? false;
  const commandImportProjectPath = useMemo(() => {
    if (providerUsesProjectFile && params.projectFile) {
      return params.projectFile;
    }
    return params.selectedRepoPath || "";
  }, [params.projectFile, params.selectedRepoPath, providerUsesProjectFile]);

  const currentConfigParameters = useMemo<ConfigParameters>(() => {
    if (params.activeProviderId === "dotnet") {
      return buildDotnetProfileParameters(params.customConfig);
    }
    return params.activeProviderParameters;
  }, [params.activeProviderId, params.activeProviderParameters, params.customConfig]);

  return {
    commandImportProjectPath,
    currentConfigParameters,
  };
}
