import { useCallback } from "react";

import { buildDotnetProfileParameters } from "@/lib/dotnetPublishConfig";
import { toSpecParameters, type ParameterValue } from "@/types/parameters";
import type { ProviderPublishSpec } from "@/hooks/usePublishRunner";
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
  properties: Record<string, string>;
  define: string[];
  use_profile: boolean;
  profile_name: string;
}

export function usePublishSpecBuilder(params: {
  activeProviderId: string;
  activeProviderParameters: Record<string, ParameterValue>;
  projectInfo: ProjectInfo | null;
  selectedRepo: { path: string } | null;
  specVersion: number;
  getCurrentConfig: () => PublishConfig;
}) {
  const buildPublishSpec = useCallback((): ProviderPublishSpec | null => {
    if (params.activeProviderId === "dotnet") {
      if (!params.projectInfo) {
        return null;
      }

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
        properties: config.properties,
        define: config.define,
        useProfile: config.use_profile,
        profileName: config.profile_name,
      });

      return {
        version: params.specVersion,
        provider_id: "dotnet",
        project_path: params.projectInfo.project_file,
        parameters: toSpecParameters(parameters),
      };
    }

    if (!params.selectedRepo) {
      return null;
    }

    return {
      version: params.specVersion,
      provider_id: params.activeProviderId,
      project_path: params.selectedRepo.path,
      parameters: toSpecParameters(params.activeProviderParameters),
    };
  }, [params]);

  return { buildPublishSpec };
}
