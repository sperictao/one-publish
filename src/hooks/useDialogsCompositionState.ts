import { useEnvironmentStatus } from "@/features/environment/useEnvironmentStatus";
import { useDialogDerivedState } from "@/hooks/useDialogDerivedState";
import {
  useAppDialogsProps,
  type UseAppDialogsPropsParams,
} from "@/hooks/useAppDialogsProps";
import {
  getEnvironmentCheckSnapshotResult,
  matchesEnvironmentCheckSnapshot,
  type EnvironmentCheckSnapshot,
} from "@/features/environment/environment";
import type { ConfigParameters, ProviderManifest } from "@/lib/store/types";
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
  /** 当前作用域（草稿/修订）的原始参数；null 表示没有可用的作用域水合。 */
  selectionParameters: Record<string, ParameterValue> | null;
  activeProviderParameters: Record<string, ParameterValue>;
  projectFile?: string;
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
      selectionParameters: params.selectionParameters,
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
