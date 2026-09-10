import {
  extractDotnetPublishParametersFromProjectProfile,
  normalizeProjectProfileParameters,
  parseProjectPublishProfileXml,
  type ParsedProjectPublishProfile,
} from "@/lib/projectPublishProfileXml";
import { readProjectPublishProfile } from "@/lib/store/api";
import type { ProjectInfo } from "@/lib/store/types";
import type { ParameterValue } from "@/types/parameters";

export type DotnetProjectInfo = Pick<
  ProjectInfo,
  "root_path" | "project_file"
> & {
  target_frameworks?: string[];
};

export interface ResolvedDotnetProjectProfile {
  profileName: string;
  filePath: string;
  parsedProfile: ParsedProjectPublishProfile;
  parameters: Record<string, ParameterValue>;
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
  const rawParameters = extractDotnetPublishParametersFromProjectProfile(
    parsedProfile
  ) as Record<string, ParameterValue>;
  const parameters = normalizeProjectProfileParameters({
    parameters: rawParameters,
    defaultOutputDir,
    projectFile: projectInfo.project_file,
    projectRoot: projectInfo.root_path,
  });

  return {
    profileName: profileFile.profileName,
    filePath: profileFile.filePath,
    parsedProfile,
    parameters,
  };
}
