import { useMemo } from "react";

import { buildDotnetProfileParameters } from "@/lib/dotnetPublishConfig";
import type { PublishConfigStore } from "@/lib/store";
import type { ParameterValue } from "@/types/parameters";

export function useDialogDerivedState(params: {
  activeProviderId: string;
  customConfig: PublishConfigStore;
  activeProviderParameters: Record<string, ParameterValue>;
  projectFile?: string | null;
  selectedRepoPath?: string | null;
}) {
  const commandImportProjectPath = useMemo(() => {
    if (params.projectFile) {
      return params.projectFile;
    }
    return params.selectedRepoPath || "";
  }, [params.projectFile, params.selectedRepoPath]);

  const currentConfigParameters = useMemo(() => {
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
