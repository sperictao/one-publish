import { createDotnetPublishConfigFromParameters } from "@/lib/dotnetPublishConfig";
import { getPathBasename, joinPath } from "@/lib/paths";
import {
  extractDotnetPublishParametersFromProjectProfile,
  parseProjectPublishProfileXml,
  type ParsedProjectPublishProfile,
} from "@/lib/projectPublishProfileXml";
import { readProjectPublishProfile, type PublishConfigStore } from "@/lib/store";
import type { ParameterValue } from "@/types/parameters";

export interface DotnetProjectInfo {
  root_path: string;
  project_file: string;
}

export interface ResolvedDotnetProjectProfile {
  profileName: string;
  filePath: string;
  parsedProfile: ParsedProjectPublishProfile;
  parameters: Record<string, ParameterValue>;
  editableConfig: PublishConfigStore;
}

function stripFileExtension(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

function buildDefaultScopedOutputDir(params: {
  defaultOutputDir?: string;
  projectInfo: DotnetProjectInfo;
  configuration?: string;
}): string {
  const { defaultOutputDir, projectInfo, configuration } = params;
  if (!defaultOutputDir) {
    return "";
  }

  const projectName = projectInfo.project_file
    ? stripFileExtension(getPathBasename(projectInfo.project_file))
    : getPathBasename(projectInfo.root_path);
  const resolvedConfiguration = configuration?.trim() || "Release";

  return projectName
    ? joinPath(defaultOutputDir, projectName, resolvedConfiguration)
    : joinPath(defaultOutputDir, resolvedConfiguration);
}

function normalizeDotnetProjectProfileParameters(params: {
  projectInfo: DotnetProjectInfo;
  rawParameters: Record<string, ParameterValue>;
  defaultOutputDir?: string;
}): Record<string, ParameterValue> {
  const { projectInfo, rawParameters, defaultOutputDir } = params;
  const parameters: Record<string, ParameterValue> = {
    ...rawParameters,
  };

  if (typeof parameters.output !== "string" && defaultOutputDir) {
    const configuration =
      typeof parameters.configuration === "string" &&
      parameters.configuration.trim().length > 0
        ? parameters.configuration
        : "Release";

    parameters.output = buildDefaultScopedOutputDir({
      defaultOutputDir,
      projectInfo,
      configuration,
    });
  }

  return parameters;
}

export async function resolveDotnetProjectProfile(params: {
  projectInfo: DotnetProjectInfo;
  profileName: string;
  defaultOutputDir?: string;
}): Promise<ResolvedDotnetProjectProfile> {
  const { projectInfo, profileName, defaultOutputDir } = params;
  const profileFile = await readProjectPublishProfile(
    projectInfo.project_file,
    profileName
  );
  const parsedProfile = parseProjectPublishProfileXml(profileFile.content);
  const rawParameters =
    extractDotnetPublishParametersFromProjectProfile(parsedProfile) as Record<
      string,
      ParameterValue
    >;
  const normalizedParameters = normalizeDotnetProjectProfileParameters({
    projectInfo,
    rawParameters,
    defaultOutputDir,
  });

  return {
    profileName: profileFile.profileName,
    filePath: profileFile.filePath,
    parsedProfile,
    parameters: normalizedParameters,
    editableConfig: createDotnetPublishConfigFromParameters(normalizedParameters),
  };
}
