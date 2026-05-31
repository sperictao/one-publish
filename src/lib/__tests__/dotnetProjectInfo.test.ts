import { describe, expect, it } from "vitest";

import {
  isSupportedDotnetProjectFile,
  resolvePreferredDotnetProjectInfo,
} from "@/lib/dotnetProjectInfo";
import type { ProjectInfo } from "@/lib/store/types";

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
  it("只把真正的项目文件视为可直接解析的目标", () => {
    expect(isSupportedDotnetProjectFile("/repo/App.csproj")).toBe(true);
    expect(isSupportedDotnetProjectFile("/repo/App.fsproj")).toBe(true);
    expect(isSupportedDotnetProjectFile("/repo/App.sln")).toBe(false);
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
