import { describe, expect, it } from "vitest";

import {
  hasValidProjectFileBinding,
  reconcileProjectBinding,
  repositoryProjectBindingPending,
  repositoryRequiresProjectBinding,
} from "@/components/layout/editRepositoryProjectBinding";
import type { ProjectScanCandidates } from "@/lib/store/types";

function createCandidates(projectFiles: string[]): ProjectScanCandidates {
  return {
    rootPath: "/repo",
    solutionFiles: [],
    projectFiles,
    recommendedProjectFile:
      projectFiles.length === 1 ? projectFiles[0] : undefined,
  };
}

describe("editRepositoryProjectBinding", () => {
  it("保留仍然有效的已绑定项目文件", () => {
    const resolution = reconcileProjectBinding(
      "/repo/src/App.csproj",
      createCandidates(["/repo/src/App.csproj", "/repo/tools/Tool.csproj"])
    );

    expect(resolution.nextProjectFile).toBe("/repo/src/App.csproj");
    expect(resolution.isManualInput).toBe(false);
    expect(resolution.requiresExplicitBinding).toBe(true);
  });

  it("旧绑定失效且只剩唯一候选时自动切换", () => {
    const resolution = reconcileProjectBinding(
      "/old/Legacy.csproj",
      createCandidates(["/repo/src/App.csproj"])
    );

    expect(resolution.nextProjectFile).toBe("/repo/src/App.csproj");
    expect(resolution.isManualInput).toBe(false);
    expect(resolution.requiresExplicitBinding).toBe(false);
  });

  it("旧绑定失效且存在多个候选时清空绑定并要求显式选择", () => {
    const candidates = createCandidates([
      "/repo/src/App.csproj",
      "/repo/tools/Tool.csproj",
    ]);
    const resolution = reconcileProjectBinding("/old/Legacy.csproj", candidates);

    expect(resolution.nextProjectFile).toBe("");
    expect(resolution.isManualInput).toBe(false);
    expect(resolution.requiresExplicitBinding).toBe(true);
    expect(
      repositoryRequiresProjectBinding({
        requiresProjectBinding: true,
        candidates,
        projectFile: resolution.nextProjectFile,
      })
    ).toBe(true);
  });

  it("多候选下手动输入任意非候选路径仍视为未绑定", () => {
    const candidates = createCandidates([
      "/repo/src/App.csproj",
      "/repo/tools/Tool.csproj",
    ]);

    expect(
      hasValidProjectFileBinding("/repo/manual/Other.csproj", candidates)
    ).toBe(false);
    expect(
      repositoryRequiresProjectBinding({
        requiresProjectBinding: true,
        candidates,
        projectFile: "/repo/manual/Other.csproj",
      })
    ).toBe(true);
  });

  it("当前路径尚未完成扫描时会阻止保存", () => {
    expect(
      repositoryProjectBindingPending({
        requiresProjectBinding: true,
        path: "/repo",
        scanResolvedPath: null,
        isScanning: true,
      })
    ).toBe(true);
    expect(
      repositoryProjectBindingPending({
        requiresProjectBinding: true,
        path: "/repo",
        scanResolvedPath: "/other",
        isScanning: false,
      })
    ).toBe(true);
    expect(
      repositoryProjectBindingPending({
        requiresProjectBinding: true,
        path: "/repo",
        scanResolvedPath: "/repo",
        isScanning: false,
      })
    ).toBe(false);
  });
});
