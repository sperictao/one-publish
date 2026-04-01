import { useEnvironmentStatus } from "@/hooks/useEnvironmentStatus";
import { useDialogDerivedState } from "@/hooks/useDialogDerivedState";
import {
  useAppDialogsProps,
  type UseAppDialogsPropsParams,
} from "@/hooks/useAppDialogsProps";
import type { EnvironmentCheckResult } from "@/lib/environment";
import type { PublishConfigStore } from "@/lib/store";
import type { ParameterSchema } from "@/types/parameters";

export type DialogsCompositionParams = Omit<
  UseAppDialogsPropsParams,
  "environmentStatus" | "commandImportProjectPath" | "currentConfigParameters"
> & {
  environmentLastResult: EnvironmentCheckResult | null;
  activeProviderId: string;
  customConfig: PublishConfigStore;
  activeProviderParameters: Record<string, any>;
  dotnetSchema?: ParameterSchema;
  projectFile?: string;
  projectFrameworkOptions: string[];
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
