import { useEnvironmentStatus } from "@/hooks/useEnvironmentStatus";
import { useDialogDerivedState } from "@/hooks/useDialogDerivedState";
import {
  useAppDialogsProps,
  type UseAppDialogsPropsParams,
} from "@/hooks/useAppDialogsProps";
import {
  getEnvironmentCheckSnapshotResult,
  matchesEnvironmentCheckSnapshot,
  type EnvironmentCheckSnapshot,
} from "@/lib/environment";
import type {
  ConfigParameters,
  ProviderManifest,
  PublishConfigStore,
} from "@/lib/store";
import type { ParameterSchema } from "@/types/parameters";
import type { ParameterValue } from "@/types/parameters";

export type DialogsCompositionParams = Omit<
  UseAppDialogsPropsParams,
  | "environmentStatus"
  | "environmentSettingsInitialCheck"
  | "currentProviderEnvironmentResult"
  | "commandImportProjectPath"
  | "currentConfigParameters"
> & {
  environmentLastCheck: EnvironmentCheckSnapshot | null;
  activeProviderId: string;
  activeProviderUsesProjectFile: boolean;
  activeProvider: ProviderManifest | null;
  availableProviders: ProviderManifest[];
  customConfig: PublishConfigStore;
  activeProviderParameters: Record<string, ParameterValue>;
  dotnetSchema?: ParameterSchema;
  projectFile?: string;
  projectFrameworkOptions: string[];
  selectedRepoPath?: string;
};

export function useDialogsCompositionState(params: DialogsCompositionParams) {
  const environmentStatus = useEnvironmentStatus(
    params.environmentLastCheck,
    params.activeProviderId
  );
  const environmentSettingsInitialCheck = matchesEnvironmentCheckSnapshot(
    params.environmentLastCheck,
    params.environmentProviderIds
  )
    ? params.environmentLastCheck
    : null;
  const currentProviderEnvironmentResult = getEnvironmentCheckSnapshotResult(
    params.environmentLastCheck,
    [params.activeProviderId]
  );

  const { commandImportProjectPath, currentConfigParameters } =
    useDialogDerivedState({
      activeProviderId: params.activeProviderId,
      activeProviderUsesProjectFile: params.activeProviderUsesProjectFile,
      customConfig: params.customConfig,
      activeProviderParameters: params.activeProviderParameters,
      projectFile: params.projectFile,
      selectedRepoPath: params.selectedRepoPath,
    });

  const appDialogsProps = useAppDialogsProps({
    ...params,
    environmentStatus,
    environmentSettingsInitialCheck,
    currentProviderEnvironmentResult,
    activeProvider: params.activeProvider,
    availableProviders: params.availableProviders,
    commandImportProjectPath,
    currentConfigParameters,
  });

  return {
    environmentStatus,
    commandImportProjectPath,
    currentConfigParameters: currentConfigParameters as ConfigParameters,
    appDialogsProps,
  };
}
