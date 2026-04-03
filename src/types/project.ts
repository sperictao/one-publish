export type {
  ProjectInfo,
  ProjectPublishProfileFile,
  ProjectScanCandidates,
} from "@/lib/store";

import type { ProjectInfo } from "@/lib/store";

export type DotnetProjectInfo = Pick<ProjectInfo, "root_path" | "project_file"> & {
  target_frameworks?: string[];
};
