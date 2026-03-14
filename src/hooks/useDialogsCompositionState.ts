import { useEnvironmentStatus } from "@/hooks/useEnvironmentStatus";
import { useDialogDerivedState } from "@/hooks/useDialogDerivedState";
import {
  useAppDialogsProps,
  type UseAppDialogsPropsParams,
} from "@/hooks/useAppDialogsProps";
import type { EnvironmentCheckResult } from "@/lib/environment";

type DialogsCompositionParams = Omit<
  UseAppDialogsPropsParams,
  "environmentStatus" | "commandImportProjectPath" | "currentConfigParameters"
> & {
  environmentLastResult: EnvironmentCheckResult | null;
  activeProviderId: string;
  customConfig: {
    configuration: string;
    runtime: string;
    outputDir: string;
    selfContained: boolean;
  };
  activeProviderParameters: Record<string, any>;
  projectFile?: string;
  selectedRepoPath?: string;
};

export function useDialogsCompositionState(params: DialogsCompositionParams) {
  const environmentStatus = useEnvironmentStatus(params.environmentLastResult);

  const { commandImportProjectPath, currentConfigParameters } =
    useDialogDerivedState({
      activeProviderId: params.activeProviderId,
      customConfig: params.customConfig,
      activeProviderParameters: params.activeProviderParameters,
      projectFile: params.projectFile,
      selectedRepoPath: params.selectedRepoPath,
    });

  const appDialogsProps = useAppDialogsProps({
    ...params,
    environmentStatus,
    commandImportProjectPath,
    currentConfigParameters,
  });

  return {
    environmentStatus,
    commandImportProjectPath,
    currentConfigParameters,
    appDialogsProps,
  };
}
