import { useMemo } from "react";

import type { PublishConfigStore } from "@/lib/store";
import type { ParameterValue } from "@/types/parameters";

function toDotnetProfileParameters(
  config: Pick<
    PublishConfigStore,
    "configuration" | "runtime" | "outputDir" | "selfContained"
  >
) {
  return {
    configuration: config.configuration,
    runtime: config.runtime,
    output: config.outputDir,
    self_contained: config.selfContained,
  };
}

export function useDialogDerivedState(params: {
  activeProviderId: string;
  customConfig: Pick<
    PublishConfigStore,
    "configuration" | "runtime" | "outputDir" | "selfContained"
  >;
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
      return toDotnetProfileParameters(params.customConfig);
    }
    return params.activeProviderParameters;
  }, [params.activeProviderId, params.activeProviderParameters, params.customConfig]);

  return {
    commandImportProjectPath,
    currentConfigParameters,
  };
}
