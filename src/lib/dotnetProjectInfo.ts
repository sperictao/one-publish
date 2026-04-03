import type { ProjectInfo } from "@/types/project";

export function isSupportedDotnetProjectFile(
  path: string | null | undefined
): path is string {
  const trimmed = path?.trim();
  if (!trimmed) {
    return false;
  }

  const fileName = trimmed.split(/[\\/]/).pop() || "";
  const extension = fileName.split(".").pop()?.toLowerCase() || "";
  return extension.endsWith("proj");
}

export async function resolvePreferredDotnetProjectInfo(params: {
  repoPath: string;
  projectFile?: string | null;
  resolveProjectInfo: (projectFile: string) => Promise<ProjectInfo | null>;
  scanProject: (repoPath: string) => Promise<ProjectInfo | null>;
}): Promise<ProjectInfo | null> {
  const repoPath = params.repoPath.trim();
  const projectFile = isSupportedDotnetProjectFile(params.projectFile)
    ? params.projectFile.trim()
    : null;

  if (projectFile) {
    const resolved = await params.resolveProjectInfo(projectFile);
    if (resolved) {
      return resolved;
    }
  }

  return await params.scanProject(repoPath);
}
