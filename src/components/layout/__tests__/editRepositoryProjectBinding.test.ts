import { describe, expect, it } from "vitest";

import {
  hasValidProjectFileBinding,
  reconcileProjectBinding,
  repositoryProjectBindingPending,
  repositoryRequiresProjectBinding,
} from "@/components/layout/editRepositoryProjectBinding";
import type { ProjectScanCandidates } from "@/lib/store/types";

function createCandidates(
  projectFiles: string[],
  recommendedProjectFile?: string
): ProjectScanCandidates {
  return {
    rootPath: "/repo",
    solutionFiles: [],
    projectFiles,
    recommendedProjectFile,
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

  it("旧绑定失效且后端推荐唯一候选时自动切换", () => {
    const resolution = reconcileProjectBinding(
      "/old/Legacy.csproj",
      createCandidates(["/repo/src/App.csproj"], "/repo/src/App.csproj")
    );

    expect(resolution.nextProjectFile).toBe("/repo/src/App.csproj");
    expect(resolution.isManualInput).toBe(false);
    expect(resolution.requiresExplicitBinding).toBe(false);
  });

  it("旧绑定失效且没有后端推荐时不自行推断唯一候选", () => {
    const resolution = reconcileProjectBinding(
      "/old/Legacy.csproj",
      createCandidates(["/repo/src/App.csproj"])
    );

    expect(resolution.nextProjectFile).toBe("");
    expect(resolution.isManualInput).toBe(true);
    expect(resolution.requiresExplicitBinding).toBe(false);
  });

  it("旧绑定失效且存在推荐候选时自动切换到推荐项目文件", () => {
    const resolution = reconcileProjectBinding(
      "/old/Legacy.csproj",
      createCandidates(
        ["/repo/src/App/App.csproj", "/repo/tests/App.Tests.csproj"],
        "/repo/src/App/App.csproj"
      )
    );

    expect(resolution.nextProjectFile).toBe("/repo/src/App/App.csproj");
    expect(resolution.isManualInput).toBe(false);
    expect(resolution.requiresExplicitBinding).toBe(true);
  });

  it("旧绑定失效且存在多个候选时清空绑定并要求显式选择", () => {
    const candidates = createCandidates([
      "/repo/src/App.csproj",
      "/repo/tools/Tool.csproj",
    ]);
    const resolution = reconcileProjectBinding(
      "/old/Legacy.csproj",
      candidates
    );

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

  it("路径经 trim 后为空时不阻止保存", () => {
    expect(
      repositoryProjectBindingPending({
        requiresProjectBinding: true,
        path: "   ",
        scanResolvedPath: null,
        isScanning: false,
      })
    ).toBe(false);
  });

  it("不要求项目绑定时直接放行", () => {
    expect(
      repositoryRequiresProjectBinding({
        requiresProjectBinding: false,
        candidates: null,
        projectFile: "",
      })
    ).toBe(false);
  });

  it("候选为空或单候选时不构成绑定要求", () => {
    expect(
      repositoryRequiresProjectBinding({
        requiresProjectBinding: true,
        candidates: null,
        projectFile: "/repo/src/App.csproj",
      })
    ).toBe(false);
    expect(
      repositoryRequiresProjectBinding({
        requiresProjectBinding: true,
        candidates: createCandidates(["/repo/src/App.csproj"]),
        projectFile: "/repo/other/Other.csproj",
      })
    ).toBe(false);
  });

  it("多候选下已绑定有效项目文件时放行", () => {
    const candidates = createCandidates([
      "/repo/src/App.csproj",
      "/repo/tools/Tool.csproj",
    ]);

    expect(
      repositoryRequiresProjectBinding({
        requiresProjectBinding: true,
        candidates,
        projectFile: "/repo/src/App.csproj",
      })
    ).toBe(false);
  });

  it("不要求项目绑定时待保存检查直接放行", () => {
    expect(
      repositoryProjectBindingPending({
        requiresProjectBinding: false,
        path: "/repo",
        scanResolvedPath: null,
        isScanning: true,
      })
    ).toBe(false);
  });

  it("无候选且当前文件为空时回落到手动输入", () => {
    expect(reconcileProjectBinding("", null)).toEqual({
      nextProjectFile: "",
      isManualInput: true,
      requiresExplicitBinding: false,
    });
    expect(
      reconcileProjectBinding("  ", createCandidates(["/repo/src/App.csproj"]))
        .isManualInput
    ).toBe(true);
  });

  it("推荐文件缺失或非候选时不作为绑定结果", () => {
    const resolution = reconcileProjectBinding(
      "/repo/missing/Old.csproj",
      createCandidates(
        ["/repo/src/App.csproj"],
        "/repo/not-listed/Phantom.csproj"
      )
    );

    expect(resolution.nextProjectFile).toBe("");
    expect(resolution.isManualInput).toBe(true);
    expect(resolution.requiresExplicitBinding).toBe(false);
  });

  it("无候选时任何项目文件都不构成有效绑定", () => {
    expect(hasValidProjectFileBinding("/repo/src/App.csproj", null)).toBe(
      false
    );
  });
});
