export interface ProjectInfo {
  root_path: string;
  project_file: string;
  publish_profiles: string[];
  target_frameworks: string[];
}

export interface ProjectScanCandidates {
  rootPath: string;
  solutionFiles: string[];
  projectFiles: string[];
  recommendedProjectFile?: string | null;
}

export type DotnetProjectInfo = Pick<ProjectInfo, "root_path" | "project_file"> & {
  target_frameworks?: string[];
};
