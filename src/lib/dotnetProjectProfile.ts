import {
  createDotnetPublishConfigFromParameters,
  normalizeDotnetProjectBoundParameters,
} from "@/lib/dotnetPublishConfig";
import {
  extractDotnetPublishParametersFromProjectProfile,
  parseProjectPublishProfileXml,
  type ParsedProjectPublishProfile,
} from "@/lib/projectPublishProfileXml";
import { readProjectPublishProfile, type PublishConfigStore } from "@/lib/store";
import type { DotnetProjectInfo } from "@/types/project";
import type { ParameterValue } from "@/types/parameters";

export interface ResolvedDotnetProjectProfile {
  profileName: string;
  filePath: string;
  parsedProfile: ParsedProjectPublishProfile;
  parameters: Record<string, ParameterValue>;
  editableConfig: PublishConfigStore;
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
  const normalizedParameters = normalizeDotnetProjectBoundParameters({
    parameters: rawParameters,
    defaultOutputDir,
    projectFile: projectInfo.project_file,
    projectRoot: projectInfo.root_path,
  });

  return {
    profileName: profileFile.profileName,
    filePath: profileFile.filePath,
    parsedProfile,
    parameters: normalizedParameters,
    editableConfig: createDotnetPublishConfigFromParameters(normalizedParameters),
  };
}
