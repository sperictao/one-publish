import { buildDotnetProfileParameters } from "@/features/config/dotnetPublishConfig";
import type { ProviderPublishSpec } from "@/features/publish/publishRuntime";
import { toSpecParameters, type ParameterValue } from "@/types/parameters";
import type { ProjectInfo } from "@/lib/store/types";

export interface DotnetPublishIntentConfig {
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

export interface ProviderPublishIntent {
  providerId: string;
  providerUsesProjectFile: boolean;
  providerParameters: Record<string, ParameterValue>;
  projectInfo: ProjectInfo | null;
  repository: { path: string } | null;
  specVersion: number;
  dotnetConfig?: DotnetPublishIntentConfig;
}

function resolveProviderProjectPath(intent: ProviderPublishIntent) {
  return intent.providerUsesProjectFile
    ? intent.projectInfo?.project_file
    : intent.repository?.path;
}

function buildDotnetProviderParameters(config: DotnetPublishIntentConfig) {
  return buildDotnetProfileParameters({
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
}

export function buildProviderPublishSpec(
  intent: ProviderPublishIntent
): ProviderPublishSpec | null {
  const projectPath = resolveProviderProjectPath(intent);
  if (!projectPath) {
    return null;
  }

  if (intent.providerId === "dotnet") {
    if (!intent.dotnetConfig) {
      return null;
    }

    return {
      version: intent.specVersion,
      provider_id: "dotnet",
      project_path: projectPath,
      parameters: toSpecParameters(
        buildDotnetProviderParameters(intent.dotnetConfig)
      ),
    };
  }

  return {
    version: intent.specVersion,
    provider_id: intent.providerId,
    project_path: projectPath,
    parameters: toSpecParameters(intent.providerParameters),
  };
}
