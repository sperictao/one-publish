import { useCallback } from "react";

import type { ParameterValue } from "@/types/parameters";
import type { ProviderPublishSpec } from "@/hooks/usePublishExecution";

interface ProjectInfo {
  root_path: string;
  project_file: string;
  publish_profiles: string[];
}

interface PublishConfig {
  configuration: string;
  runtime: string;
  self_contained: boolean;
  output_dir: string;
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
      const parameters: Record<string, unknown> = {};

      if (config.use_profile && config.profile_name) {
        parameters.properties = {
          PublishProfile: config.profile_name,
        };
      } else {
        parameters.configuration = config.configuration;
        if (config.runtime) {
          parameters.runtime = config.runtime;
        }
        if (config.self_contained) {
          parameters.self_contained = true;
        }
        if (config.output_dir) {
          parameters.output = config.output_dir;
        }
      }

      return {
        version: params.specVersion,
        provider_id: "dotnet",
        project_path: params.projectInfo.project_file,
        parameters,
      };
    }

    if (!params.selectedRepo) {
      return null;
    }

    return {
      version: params.specVersion,
      provider_id: params.activeProviderId,
      project_path: params.selectedRepo.path,
      parameters: params.activeProviderParameters,
    };
  }, [params]);

  return { buildPublishSpec };
}
