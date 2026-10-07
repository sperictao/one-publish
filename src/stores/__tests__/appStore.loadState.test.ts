import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getAppState = vi.hoisted(() => vi.fn());

vi.mock("@/lib/store/api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/store/api")>("@/lib/store/api");
  return { ...actual, getAppState };
});

import { __setTranslationsCacheForTest } from "@/hooks/useI18n";
import zh from "@/i18n/zh.json";
import { useAppStore } from "@/stores/appStore";

// Tauri invoke 以 AppError 对象 reject，而不是 Error 实例。
const repositoryNotFound = {
  kind: "validation",
  message: "repository lookup failed",
  details: "repo-1",
  code: "repository_not_found",
};

describe("appStore.loadState", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    useAppStore.setState({ isLoading: true, error: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __setTranslationsCacheForTest({});
  });

  it("按错误码本地化加载失败，而不是存入 [object Object]", async () => {
    __setTranslationsCacheForTest({ zh });
    getAppState.mockRejectedValue(repositoryNotFound);

    await useAppStore.getState().loadState();

    expect(useAppStore.getState()).toMatchObject({
      isLoading: false,
      error: "未找到仓库 | repo-1",
    });
  });

  it("翻译尚未加载时退回后端 message 与 details", async () => {
    getAppState.mockRejectedValue(repositoryNotFound);

    await useAppStore.getState().loadState();

    expect(useAppStore.getState().error).toBe(
      "repository lookup failed | repo-1"
    );
  });
});
