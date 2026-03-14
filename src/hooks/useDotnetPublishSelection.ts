import { useCallback, useMemo } from "react";

import type { PublishConfigStore } from "@/lib/store";

interface ProjectInfo {
  root_path: string;
  project_file: string;
  publish_profiles: string[];
}

interface DotnetPreset {
  id: string;
  name: string;
  description: string;
  config: {
    configuration: string;
    runtime: string;
    self_contained: boolean;
  };
}

interface PublishConfig {
  configuration: string;
  runtime: string;
  self_contained: boolean;
  output_dir: string;
  use_profile: boolean;
  profile_name: string;
}

const storeConfigToPublishConfig = (
  config: PublishConfigStore
): PublishConfig => ({
  configuration: config.configuration,
  runtime: config.runtime,
  self_contained: config.selfContained,
  output_dir: config.outputDir,
  use_profile: config.useProfile,
  profile_name: config.profileName,
});

export function useDotnetPublishSelection(params: {
  activeProviderId: string;
  selectedPreset: string;
  isCustomMode: boolean;
  customConfig: PublishConfigStore;
  defaultOutputDir?: string;
  projectInfo: ProjectInfo | null;
  presets: DotnetPreset[];
}) {
  const getCurrentConfig = useCallback((): PublishConfig => {
    if (params.isCustomMode) {
      const config = storeConfigToPublishConfig(params.customConfig);
      if (!config.output_dir && params.defaultOutputDir) {
        return { ...config, output_dir: params.defaultOutputDir };
      }
      return config;
    }

    if (params.selectedPreset.startsWith("profile-")) {
      const profileName = params.selectedPreset.slice("profile-".length).trim();
      if (profileName) {
        return {
          configuration: "Release",
          runtime: "",
          self_contained: false,
          output_dir: "",
          use_profile: true,
          profile_name: profileName,
        };
      }
    }

    const preset = params.presets.find((item) => item.id === params.selectedPreset);
    if (!preset) {
      const config = storeConfigToPublishConfig(params.customConfig);
      return {
        ...config,
        output_dir: config.output_dir || params.defaultOutputDir || "",
      };
    }

    const outputDir = params.defaultOutputDir
      ? params.defaultOutputDir
      : params.projectInfo
        ? `${params.projectInfo.root_path}/publish/${params.selectedPreset}`
        : "";

    return {
      ...preset.config,
      output_dir: outputDir,
      use_profile: false,
      profile_name: "",
    };
  }, [params]);

  const dotnetPublishPreviewCommand = useMemo(() => {
    if (!params.projectInfo || params.activeProviderId !== "dotnet") {
      return "";
    }

    const config = getCurrentConfig();
    const baseCommand = `dotnet publish "${params.projectInfo.project_file}"`;

    if (config.use_profile && config.profile_name) {
      return `${baseCommand} -p:PublishProfile="${config.profile_name}"`;
    }

    return [
      baseCommand,
      `-c ${config.configuration}`,
      config.runtime ? `--runtime ${config.runtime}` : null,
      config.self_contained ? "--self-contained" : null,
      config.output_dir ? `-o "${config.output_dir}"` : null,
    ]
      .filter((part): part is string => Boolean(part))
      .join(" ");
  }, [params.activeProviderId, getCurrentConfig, params.projectInfo]);

  const recentConfigKeyForCurrentSelection = useMemo(() => {
    if (params.activeProviderId !== "dotnet") {
      return null;
    }

    if (params.isCustomMode) {
      return null;
    }

    if (params.selectedPreset.startsWith("profile-")) {
      return `pubxml:${params.selectedPreset.slice("profile-".length)}`;
    }

    return `preset:${params.selectedPreset}`;
  }, [params.activeProviderId, params.isCustomMode, params.selectedPreset]);

  return {
    getCurrentConfig,
    dotnetPublishPreviewCommand,
    recentConfigKeyForCurrentSelection,
  };
}
