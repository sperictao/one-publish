import { useCallback, useEffect, useMemo, useState } from "react";

import {
  buildDotnetProfileParameters,
  buildDotnetPublishCommand,
} from "@/lib/dotnetPublishConfig";
import { getPathBasename, joinPath } from "@/lib/paths";
import {
  resolveDotnetProjectProfile,
  type ResolvedDotnetProjectProfile,
} from "@/lib/dotnetProjectProfile";
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
  framework: string;
  self_contained: boolean;
  output_dir: string;
  no_build: boolean;
  no_restore: boolean;
  verbosity: string;
  no_logo: boolean;
  properties: Record<string, string>;
  define: string[];
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
  properties: { ...config.properties },
  define: [...config.define],
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
  activeProfileName: string | null;
  customConfig: PublishConfigStore;
  defaultOutputDir?: string;
  projectInfo: ProjectInfo | null;
  presets: DotnetPreset[];
}) {
  const [resolvedProjectProfile, setResolvedProjectProfile] =
    useState<ResolvedDotnetProjectProfile | null>(null);

  const buildDefaultScopedOutputDir = useCallback(
    (configuration?: string) => {
      if (!params.defaultOutputDir) {
        return "";
      }

      const resolvedConfiguration = configuration?.trim() || "Release";
      const projectName = params.projectInfo?.project_file
        ? stripFileExtension(getPathBasename(params.projectInfo.project_file))
        : params.projectInfo?.root_path
          ? getPathBasename(params.projectInfo.root_path)
          : "";

      return projectName
        ? joinPath(params.defaultOutputDir, projectName, resolvedConfiguration)
        : joinPath(params.defaultOutputDir, resolvedConfiguration);
    },
    [params.defaultOutputDir, params.projectInfo]
  );

  const selectedProjectProfileName = useMemo(() => {
    if (
      params.activeProviderId !== "dotnet" ||
      params.isCustomMode ||
      !params.selectedPreset.startsWith("profile-")
    ) {
      return null;
    }

    const profileName = params.selectedPreset.slice("profile-".length).trim();
    return profileName || null;
  }, [
    params.activeProviderId,
    params.isCustomMode,
    params.selectedPreset,
  ]);

  const resolveSelectedProjectProfile = useCallback(async () => {
    if (!params.projectInfo || !selectedProjectProfileName) {
      return null;
    }

    return resolveDotnetProjectProfile({
      projectInfo: params.projectInfo,
      profileName: selectedProjectProfileName,
      defaultOutputDir: params.defaultOutputDir,
    });
  }, [
    params.defaultOutputDir,
    params.projectInfo,
    selectedProjectProfileName,
  ]);

  useEffect(() => {
    let disposed = false;

    if (!selectedProjectProfileName) {
      setResolvedProjectProfile(null);
      return () => {
        disposed = true;
      };
    }

    void resolveSelectedProjectProfile()
      .then((profile) => {
        if (!disposed) {
          setResolvedProjectProfile(profile);
        }
      })
      .catch(() => {
        if (!disposed) {
          setResolvedProjectProfile(null);
        }
      });

    return () => {
      disposed = true;
    };
  }, [resolveSelectedProjectProfile, selectedProjectProfileName]);

  const getCurrentConfig = useCallback((): PublishConfig => {
    if (params.isCustomMode) {
      const config = storeConfigToPublishConfig(params.customConfig);
      if (!config.output_dir && params.defaultOutputDir) {
        return {
          ...config,
          output_dir: buildDefaultScopedOutputDir(config.configuration),
        };
      }
      return config;
    }

    if (params.selectedPreset.startsWith("profile-")) {
      const profileName = params.selectedPreset.slice("profile-".length).trim();
      if (profileName) {
        return {
          configuration: "Release",
          runtime: "",
          framework: "",
          self_contained: false,
          output_dir: buildDefaultScopedOutputDir("Release"),
          no_build: false,
          no_restore: false,
          verbosity: "",
          no_logo: false,
          properties: {},
          define: [],
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
        output_dir:
          config.output_dir || buildDefaultScopedOutputDir(config.configuration),
      };
    }

    const outputDir = params.defaultOutputDir
      ? buildDefaultScopedOutputDir(preset.config.configuration)
      : params.projectInfo
        ? joinPath(params.projectInfo.root_path, "publish", params.selectedPreset)
        : "";

    return {
      ...preset.config,
      framework: "",
      output_dir: outputDir,
      no_build: false,
      no_restore: false,
      verbosity: "",
      no_logo: false,
      properties: {},
      define: [],
      use_profile: false,
      profile_name: "",
    };
  }, [buildDefaultScopedOutputDir, params]);

  const fallbackDotnetPublishPreviewCommand = useMemo(() => {
    if (!params.projectInfo || params.activeProviderId !== "dotnet") {
      return "";
    }

    const config = getCurrentConfig();
    const parameterRecord = buildDotnetProfileParameters({
      configuration: config.configuration,
      runtime: config.runtime,
      framework: config.framework,
      selfContained: config.self_contained,
      outputDir: config.output_dir,
      noBuild: config.no_build,
      noRestore: config.no_restore,
      verbosity: config.verbosity,
      noLogo: config.no_logo,
      properties: config.properties,
      define: config.define,
      useProfile: config.use_profile,
      profileName: config.profile_name,
    });

    return buildDotnetPublishCommand(
      params.projectInfo.project_file,
      parameterRecord
    );
  }, [params.activeProviderId, getCurrentConfig, params.projectInfo]);

  const dotnetPublishPreviewCommand = useMemo(() => {
    if (!params.projectInfo || params.activeProviderId !== "dotnet") {
      return "";
    }

    if (resolvedProjectProfile) {
      return buildDotnetPublishCommand(
        params.projectInfo.project_file,
        resolvedProjectProfile.parameters
      );
    }

    return fallbackDotnetPublishPreviewCommand;
  }, [
    fallbackDotnetPublishPreviewCommand,
    params.activeProviderId,
    params.projectInfo,
    resolvedProjectProfile,
  ]);

  const recentConfigKeyForCurrentSelection = useMemo(() => {
    if (params.activeProviderId !== "dotnet") {
      return null;
    }

    if (params.isCustomMode) {
      return params.activeProfileName
        ? `userprofile:${params.activeProfileName}`
        : null;
    }

    if (params.selectedPreset.startsWith("profile-")) {
      return `pubxml:${params.selectedPreset.slice("profile-".length)}`;
    }

    return `preset:${params.selectedPreset}`;
  }, [
    params.activeProfileName,
    params.activeProviderId,
    params.isCustomMode,
    params.selectedPreset,
  ]);

  return {
    getCurrentConfig,
    dotnetPublishPreviewCommand,
    recentConfigKeyForCurrentSelection,
    resolvedProjectProfile,
    resolveSelectedProjectProfile,
  };
}
