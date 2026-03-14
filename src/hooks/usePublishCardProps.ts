import { useMemo } from "react";

import type { DotnetPublishCardProps } from "@/components/publish/DotnetPublishCard";
import type { GenericProviderPublishCardProps } from "@/components/publish/GenericProviderPublishCard";
import type { ParameterSchema, ParameterValue } from "@/types/parameters";
import type { EnvironmentCheckResult } from "@/lib/environment";

interface TranslationMap {
  [key: string]: string | undefined;
}

interface DotnetPresetOption {
  id: string;
  name: string;
  description: string;
}

interface DotnetCustomConfig {
  configuration: string;
  runtime: string;
  outputDir: string;
  selfContained: boolean;
}

interface UseDotnetPublishCardPropsParams {
  configT: TranslationMap;
  appT: TranslationMap;
  publishT: TranslationMap;
  isCustomMode: boolean;
  selectedPreset: string;
  presets: DotnetPresetOption[];
  getPresetText: (
    id: string,
    name: string,
    description: string
  ) => Omit<DotnetPresetOption, "id">;
  projectPublishProfiles: string[];
  customConfig: DotnetCustomConfig;
  dotnetPublishPreviewCommand: string;
  isPublishing: boolean;
  isCancellingPublish: boolean;
  disabled: boolean;
  setCommandImportOpen: (open: boolean) => void;
  setIsCustomMode: (checked: boolean) => void;
  handleSelectPresetValueChange: (value: string) => void;
  handleCustomConfigUpdate: (patch: Partial<DotnetCustomConfig>) => void;
  executePublish: () => void;
  cancelPublish: () => void;
}

interface UseGenericProviderPublishCardPropsParams {
  activeProviderLabel: string;
  activeProviderSchema: ParameterSchema | null;
  activeProviderParameters: Record<string, ParameterValue>;
  appT: TranslationMap;
  configT: TranslationMap;
  isPublishing: boolean;
  isCancellingPublish: boolean;
  setCommandImportOpen: (open: boolean) => void;
  handleProviderParametersChange: (next: Record<string, ParameterValue>) => void;
  openEnvironmentDialog: (
    initialResult?: EnvironmentCheckResult | null,
    providerIds?: string[]
  ) => void;
  activeProviderId: string;
  executePublish: () => void;
  cancelPublish: () => void;
}

export function useDotnetPublishCardProps(
  params: UseDotnetPublishCardPropsParams
): DotnetPublishCardProps {
  return useMemo(
    () => ({
      configT: params.configT,
      appT: params.appT,
      publishT: params.publishT,
      isCustomMode: params.isCustomMode,
      selectedPreset: params.selectedPreset,
      releasePresets: params.presets
        .filter((preset) => preset.id.startsWith("release"))
        .map((preset) => ({
          ...preset,
          ...params.getPresetText(preset.id, preset.name, preset.description),
        })),
      debugPresets: params.presets
        .filter((preset) => preset.id.startsWith("debug"))
        .map((preset) => ({
          ...preset,
          ...params.getPresetText(preset.id, preset.name, preset.description),
        })),
      projectPublishProfiles: params.projectPublishProfiles,
      customConfig: params.customConfig,
      dotnetPublishPreviewCommand: params.dotnetPublishPreviewCommand,
      isPublishing: params.isPublishing,
      isCancellingPublish: params.isCancellingPublish,
      disabled: params.disabled,
      onOpenCommandImport: () => params.setCommandImportOpen(true),
      onCustomModeChange: params.setIsCustomMode,
      onPresetChange: params.handleSelectPresetValueChange,
      onCustomConfigUpdate: params.handleCustomConfigUpdate,
      onExecutePublish: params.executePublish,
      onCancelPublish: params.cancelPublish,
    }),
    [params]
  );
}

export function useGenericProviderPublishCardProps(
  params: UseGenericProviderPublishCardPropsParams
): GenericProviderPublishCardProps {
  return useMemo(
    () => ({
      activeProviderLabel: params.activeProviderLabel,
      activeProviderSchema: params.activeProviderSchema,
      activeProviderParameters: params.activeProviderParameters,
      appT: params.appT,
      configT: params.configT,
      isPublishing: params.isPublishing,
      isCancellingPublish: params.isCancellingPublish,
      onOpenCommandImport: () => params.setCommandImportOpen(true),
      onProviderParametersChange: params.handleProviderParametersChange,
      onOpenEnvironmentCheck: () =>
        params.openEnvironmentDialog(null, [params.activeProviderId]),
      onExecutePublish: params.executePublish,
      onCancelPublish: params.cancelPublish,
    }),
    [params]
  );
}
