import { useCallback } from "react";

import { buildDotnetProfileParameters } from "@/lib/dotnetPublishConfig";
import { toSpecParameters, type ParameterValue } from "@/types/parameters";
import type { ProviderPublishSpec } from "@/lib/publishRuntime";
import type { ProjectInfo } from "@/types/project";

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
  define: string[];
  use_profile: boolean;
  profile_name: string;
}

export function usePublishSpecBuilder(params: {
  activeProviderId: string;
  activeProviderUsesProjectFile: boolean;
  activeProviderParameters: Record<string, ParameterValue>;
  projectInfo: ProjectInfo | null;
  selectedRepo: { path: string } | null;
  specVersion: number;
  getCurrentConfig: () => PublishConfig;
}) {
  const buildPublishSpec = useCallback((): ProviderPublishSpec | null => {
    const resolvedProjectPath = params.activeProviderUsesProjectFile
      ? params.projectInfo?.project_file
      : params.selectedRepo?.path;
    if (!resolvedProjectPath) {
      return null;
    }

    if (params.activeProviderId === "dotnet") {
      const config = params.getCurrentConfig();
      const parameters = buildDotnetProfileParameters({
        configuration: config.configuration,
        runtime: config.runtime,
        framework: config.framework,
        selfContained: config.self_contained,
        outputDir: config.output_dir,
        noBuild: config.no_build,
        noRestore: config.no_restore,
        verbosity: config.verbosity,
        noLogo: config.no_logo,
        deleteExistingFiles: config.delete_existing_files,
        properties: config.properties,
        define: config.define,
        useProfile: config.use_profile,
        profileName: config.profile_name,
      });

      return {
        version: params.specVersion,
        provider_id: "dotnet",
        project_path: resolvedProjectPath,
        parameters: toSpecParameters(parameters),
      };
    }

    return {
      version: params.specVersion,
      provider_id: params.activeProviderId,
      project_path: resolvedProjectPath,
      parameters: toSpecParameters(params.activeProviderParameters),
    };
  }, [params]);

  return { buildPublishSpec };
}
