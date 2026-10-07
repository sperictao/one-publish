import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/en.json";
import zh from "@/i18n/zh.json";

const mocks = vi.hoisted(() => ({
  i18n: { translations: {} as Record<string, unknown> },
  detectRepositoryProvider: vi.fn(),
  scanRepositoryBranches: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/hooks/useI18n", () => ({
  useI18n: () => ({ translations: mocks.i18n.translations }),
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: vi.fn() },
}));

vi.mock("@/lib/store/api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/store/api")>("@/lib/store/api");
  return {
    ...actual,
    detectRepositoryProvider: mocks.detectRepositoryProvider,
    scanRepositoryBranches: mocks.scanRepositoryBranches,
  };
});

import { useRepositoryActions } from "@/features/repository/useRepositoryActions";

// 稳定的入参引用：只让翻译树变化，隔离 translationsRef 的行为。
const params = {
  appT: {},
  providers: [],
  repositories: [],
  selectedRepoId: null,
  addRepository: vi.fn(),
  removeRepository: vi.fn(),
  updateRepository: vi.fn(),
  applySelectedRepositoryProvider: vi.fn(),
};

describe("useRepositoryActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.i18n.translations = zh;
  });

  it("翻译切换不重建 detect / refresh 回调，失败提示使用最新语言", async () => {
    const { result, rerender } = renderHook(() => useRepositoryActions(params));
    const { handleDetectRepoProvider, handleRefreshRepoBranches } =
      result.current;

    mocks.i18n.translations = en;
    rerender();

    // 两者都进入编辑窗口的 useEffect 依赖，引用变化会触发重复自动探测。
    expect(result.current.handleDetectRepoProvider).toBe(
      handleDetectRepoProvider
    );
    expect(result.current.handleRefreshRepoBranches).toBe(
      handleRefreshRepoBranches
    );

    mocks.scanRepositoryBranches.mockRejectedValue({
      kind: "repository",
      message: "git branch timed out after 5s",
      code: "timeout",
    });

    await act(async () => {
      await result.current.handleRefreshRepoBranches("/tmp/demo-repo");
    });

    expect(mocks.toastError).toHaveBeenCalledWith("拉取分支失败", {
      description: "The Git command timed out.",
    });
  });
});
