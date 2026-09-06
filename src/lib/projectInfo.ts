import type { ProjectInfo } from "@/lib/store/types";

export async function resolvePreferredProjectInfo(params: {
  repoPath: string;
  projectFile?: string | null;
  resolveProjectInfo: (projectFile: string) => Promise<ProjectInfo | null>;
  scanProject: (repoPath: string) => Promise<ProjectInfo | null>;
}): Promise<ProjectInfo | null> {
  const projectFile = params.projectFile?.trim();
  // 旧仓库可能保存解决方案路径；解决方案不是可执行的项目绑定。
  if (projectFile && !/\.slnx?$/i.test(projectFile)) {
    return await params.resolveProjectInfo(projectFile);
  }
  return await params.scanProject(params.repoPath.trim());
}
