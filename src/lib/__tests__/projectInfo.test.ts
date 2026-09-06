import { describe, expect, it, vi } from "vitest";

import { resolvePreferredProjectInfo } from "@/lib/projectInfo";
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

describe("projectInfo", () => {
  it.each(["tauri.conf.json", "tauri.conf.json5", "Tauri.toml"])(
    "保留显式绑定的 Tauri 入口 %s，不扫描其他应用",
    async (fileName) => {
      const projectFile = `/repo/apps/second/src-tauri/${fileName}`;
      const info = createProjectInfo({ project_file: projectFile });
      const resolveProjectInfo = vi.fn().mockResolvedValue(info);
      const scanProject = vi.fn().mockResolvedValue(null);
      await expect(
        resolvePreferredProjectInfo({
          repoPath: "/repo",
          projectFile,
          resolveProjectInfo,
          scanProject,
        })
      ).resolves.toEqual(info);
      expect(resolveProjectInfo).toHaveBeenCalledWith(projectFile);
      expect(scanProject).not.toHaveBeenCalled();
    }
  );

  it("显式绑定失效时不得扫描并替换成其他项目", async () => {
    const scanProject = vi.fn().mockResolvedValue(createProjectInfo());
    await expect(
      resolvePreferredProjectInfo({
        repoPath: "/repo",
        projectFile: "/repo/deleted/App.csproj",
        resolveProjectInfo: async () => null,
        scanProject,
      })
    ).resolves.toBeNull();
    expect(scanProject).not.toHaveBeenCalled();
  });
  it("优先解析受支持的项目文件，其他情况回退扫描仓库", async () => {
    const projectInfo = createProjectInfo();
    const resolveProjectInfo = async () => projectInfo;
    const scanProject = async () => null;

    await expect(
      resolvePreferredProjectInfo({
        repoPath: "/repo",
        projectFile: "/repo/src/App/App.csproj",
        resolveProjectInfo,
        scanProject,
      })
    ).resolves.toEqual(projectInfo);

    await expect(
      resolvePreferredProjectInfo({
        repoPath: "/repo",
        projectFile: "/repo/App.sln",
        resolveProjectInfo: async () => null,
        scanProject: async () => projectInfo,
      })
    ).resolves.toEqual(projectInfo);
  });
});
