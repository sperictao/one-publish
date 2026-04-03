import { describe, expect, it } from "vitest";

import {
  isProjectInfoInRepoScope,
  resolvePreferredDotnetProjectInfo,
} from "@/lib/dotnetProjectInfo";
import type { ProjectInfo } from "@/types/project";

function createProjectInfo(overrides?: Partial<ProjectInfo>): ProjectInfo {
  return {
    root_path: "/repo",
    project_file: "/repo/src/App/App.csproj",
    publish_profiles: ["FolderProfile"],
    target_frameworks: ["net8.0"],
    ...overrides,
  };
}

describe("dotnetProjectInfo", () => {
  it("仓库绑定的是解决方案文件时，接受扫描出的真实项目文件", () => {
    expect(
      isProjectInfoInRepoScope({
        selectedRepoPath: "/repo",
        selectedRepoProjectFile: "/repo/App.sln",
        projectInfo: createProjectInfo(),
      })
    ).toBe(true);
  });

  it("仓库明确绑定项目文件时，仍要求结果与绑定文件一致", () => {
    expect(
      isProjectInfoInRepoScope({
        selectedRepoPath: "/repo",
        selectedRepoProjectFile: "/repo/src/Other/Other.csproj",
        projectInfo: createProjectInfo(),
      })
    ).toBe(false);
  });

  it("优先解析受支持的项目文件，其他情况回退扫描仓库", async () => {
    const projectInfo = createProjectInfo();
    const resolveProjectInfo = async () => projectInfo;
    const scanProject = async () => null;

    await expect(
      resolvePreferredDotnetProjectInfo({
        repoPath: "/repo",
        projectFile: "/repo/src/App/App.csproj",
        resolveProjectInfo,
        scanProject,
      })
    ).resolves.toEqual(projectInfo);

    await expect(
      resolvePreferredDotnetProjectInfo({
        repoPath: "/repo",
        projectFile: "/repo/App.sln",
        resolveProjectInfo: async () => null,
        scanProject: async () => projectInfo,
      })
    ).resolves.toEqual(projectInfo);
  });
});
