import { useCallback, useMemo } from "react";

import { getPathBasename, joinPath } from "@/lib/paths";
import {
  getProjectProfileNameFromSelection,
  getRecentConfigKeyFromSelection,
  resolvePublishSelectionIdentity,
} from "@/features/config/publishConfigIdentity";
import type { DotnetPreset } from "@/features/config/dotnetPresets";
import type { PublishConfigStore, ProjectInfo } from "@/lib/store/types";

interface PublishConfig {
  configuration: string;
  runtime: string;
  framework: string;
  self_contained: boolean;
  output_dir: string;
  no_build: boolean;
  no_restore: boolean;
  verbosity: string;
  no_logo: boolean;
  delete_existing_files: boolean;
  properties: Record<string, string>;
  use_profile: boolean;
  profile_name: string;
}

const storeConfigToPublishConfig = (
  config: PublishConfigStore
): PublishConfig => ({
  configuration: config.configuration,
  runtime: config.runtime,
  framework: config.framework,
  self_contained: config.selfContained,
  output_dir: config.outputDir,
  no_build: config.noBuild,
  no_restore: config.noRestore,
  verbosity: config.verbosity,
  no_logo: config.noLogo,
  delete_existing_files: config.deleteExistingFiles,
  properties: { ...config.properties },
  use_profile: config.useProfile,
  profile_name: config.profileName,
});

function stripFileExtension(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

export function useDotnetPublishSelection(params: {
  activeProviderId: string;
  selectedPreset: string;
  isCustomMode: boolean;
  customConfig: PublishConfigStore;
  defaultOutputDir?: string;
  projectInfo: ProjectInfo | null;
  presets: DotnetPreset[];
}) {
  const {
    activeProviderId,
    selectedPreset,
    isCustomMode,
    customConfig,
    defaultOutputDir,
    projectInfo,
    presets,
  } = params;
  const buildDefaultScopedOutputDir = useCallback(
    (configuration?: string) => {
      if (!defaultOutputDir) {
        return "";
      }

      const resolvedConfiguration = configuration?.trim() || "Release";
      const projectName = projectInfo?.project_file
        ? stripFileExtension(getPathBasename(projectInfo.project_file))
        : projectInfo?.root_path
          ? getPathBasename(projectInfo.root_path)
          : "";

      return projectName
        ? joinPath(defaultOutputDir, projectName, resolvedConfiguration)
        : joinPath(defaultOutputDir, resolvedConfiguration);
    },
    [defaultOutputDir, projectInfo]
  );

  const selectionIdentity = useMemo(
    () =>
      resolvePublishSelectionIdentity({
        activeProviderId,
        isCustomMode,
        selectedPreset,
      }),
    [activeProviderId, isCustomMode, selectedPreset]
  );
  const selectedProjectProfileName =
    getProjectProfileNameFromSelection(selectionIdentity);

  const getCurrentConfig = useCallback((): PublishConfig => {
    if (isCustomMode) {
      const config = storeConfigToPublishConfig(customConfig);
      if (!config.output_dir && defaultOutputDir) {
        return {
          ...config,
          output_dir: buildDefaultScopedOutputDir(config.configuration),
        };
      }
      return config;
    }

    if (selectedProjectProfileName) {
      return {
        configuration: "Release",
        runtime: "",
        framework: "",
        self_contained: false,
        output_dir: "",
        no_build: false,
        no_restore: false,
        verbosity: "",
        no_logo: false,
        delete_existing_files: false,
        properties: {},
        use_profile: true,
        profile_name: selectedProjectProfileName,
      };
    }

    const preset = presets.find((item) => item.id === selectedPreset);
    if (!preset) {
      const config = storeConfigToPublishConfig(customConfig);
      return {
        ...config,
        output_dir:
          config.output_dir ||
          buildDefaultScopedOutputDir(config.configuration),
      };
    }

    const outputDir = defaultOutputDir
      ? buildDefaultScopedOutputDir(preset.config.configuration)
      : projectInfo
        ? joinPath(projectInfo.root_path, "publish", selectedPreset)
        : "";

    return {
      ...preset.config,
      framework: "",
      output_dir: outputDir,
      no_build: false,
      no_restore: false,
      verbosity: "",
      no_logo: false,
      delete_existing_files: false,
      properties: {},
      use_profile: false,
      profile_name: "",
    };
  }, [
    buildDefaultScopedOutputDir,
    customConfig,
    defaultOutputDir,
    isCustomMode,
    presets,
    projectInfo,
    selectedPreset,
    selectedProjectProfileName,
  ]);

  const recentConfigKeyForCurrentSelection = useMemo(() => {
    return getRecentConfigKeyFromSelection(selectionIdentity);
  }, [selectionIdentity]);

  return {
    getCurrentConfig,
    selectionIdentity,
    recentConfigKeyForCurrentSelection,
    isResolvingSelectedProjectProfile: false,
  };
}
