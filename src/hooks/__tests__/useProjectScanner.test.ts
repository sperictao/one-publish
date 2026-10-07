import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/en.json";
import zh from "@/i18n/zh.json";

const mocks = vi.hoisted(() => ({
  i18n: { translations: {} as Record<string, unknown> },
  scanProject: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/hooks/useI18n", () => ({
  useI18n: () => ({ translations: mocks.i18n.translations }),
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: vi.fn() },
}));

vi.mock("@/lib/store/api", () => ({
  scanProject: mocks.scanProject,
  resolveProjectInfo: vi.fn(),
  scanProjectCandidates: vi.fn(),
}));

import { useProjectScanner } from "@/features/repository/useProjectScanner";

const params = { appT: {} };

describe("useProjectScanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.i18n.translations = zh;
  });

  it("未分类的扫描失败按最新语言本地化，翻译切换不重建 scanProject", async () => {
    // normalize_scan_root 的 not_directory 不在 analyzeProjectScanFailure 的分类里。
    mocks.scanProject.mockRejectedValue({
      kind: "repository",
      message: "path is not a directory",
      details: "/repo/README.md",
      code: "not_directory",
    });
    const { result, rerender } = renderHook(() => useProjectScanner(params));
    const scanProject = result.current.scanProject;

    mocks.i18n.translations = en;
    rerender();

    // scanProject 进入 useEffect 依赖，引用变化会触发重复扫描。
    expect(result.current.scanProject).toBe(scanProject);

    await act(async () => {
      await result.current.scanProject("/repo/README.md");
    });

    expect(mocks.toastError).toHaveBeenCalledWith("项目检测失败", {
      description: "The path isn't a directory. | /repo/README.md",
    });
  });
});
