import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getAppState: vi.fn(),
  getExecutionHistory: vi.fn(),
  addExecutionRecord: vi.fn(),
  setExecutionRecordSnapshot: vi.fn(),
}));
const getAppState = apiMocks.getAppState;

vi.mock("@/lib/store/api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/store/api")>("@/lib/store/api");
  return { ...actual, ...apiMocks };
});

import { __setTranslationsCacheForTest } from "@/hooks/useI18n";
import zh from "@/i18n/zh.json";
import { useAppStore } from "@/stores/appStore";
import type { ExecutionRecord } from "@/lib/store/types";

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

  it("迁移 __legacy__ 收藏到选中仓库并把名称收藏改写为 ID 后持久化", async () => {
    useAppStore.setState({
      isLoading: true,
      error: null,
      favoriteConfigKeysByRepo: { __legacy__: ["userprofile:Release"] },
    });
    localStorage.removeItem("one-publish:favoriteConfigs");
    getAppState.mockResolvedValue({
      repositories: [
        {
          id: "repo-1",
          publishConfig: {
            profiles: [{ id: "profile-9", name: "Release" }],
          },
        },
      ],
      selectedRepoId: "repo-1",
      executionHistory: [],
      recentRepoIds: ["repo-1"],
      recentConfigKeysByRepo: {},
      theme: "dark",
    });

    await useAppStore.getState().loadState();

    // 两段迁移依次发生：__legacy__ 落位 repo-1，随后 userprofile:<名>
    // 经后端迁移后的 name→ID 表改写为 userprofile:<ID> 并回写存储。
    expect(useAppStore.getState().favoriteConfigKeysByRepo).toEqual({
      "repo-1": ["userprofile:profile-9"],
    });
    expect(localStorage.getItem("one-publish:favoriteConfigs")).toBe(
      JSON.stringify({ "repo-1": ["userprofile:profile-9"] })
    );
  });

  it("applies the loaded app state and clears isLoading", async () => {
    getAppState.mockResolvedValue({
      repositories: [],
      selectedRepoId: "repo-1",
      executionHistory: [],
      recentRepoIds: ["repo-1"],
      recentConfigKeysByRepo: {},
      theme: "dark",
    });

    await useAppStore.getState().loadState();

    expect(useAppStore.getState()).toMatchObject({
      isLoading: false,
      error: null,
      selectedRepoId: "repo-1",
      theme: "dark",
    });
  });
});

function record(id: string): ExecutionRecord {
  return {
    id,
    providerId: "dotnet",
    projectPath: "/repo/app",
    startedAt: "2026-01-01T00:00:00Z",
    finishedAt: "2026-01-01T00:00:01Z",
    success: true,
    cancelled: false,
    fileCount: 0,
  };
}

describe("appStore execution history", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads history into state", async () => {
    const history = [record("a"), record("b")];
    apiMocks.getExecutionHistory.mockResolvedValue(history);

    await useAppStore.getState().loadExecutionHistory();

    expect(useAppStore.getState().executionHistory).toEqual(history);
  });

  it("swallows history load failures", async () => {
    apiMocks.getExecutionHistory.mockRejectedValue(new Error("io"));
    useAppStore.setState({ executionHistory: [record("keep")] });

    await useAppStore.getState().loadExecutionHistory();

    expect(useAppStore.getState().executionHistory).toEqual([record("keep")]);
  });

  it("saves a publish record and stores the returned history", async () => {
    const updated = [record("new")];
    apiMocks.addExecutionRecord.mockResolvedValue(updated);

    await useAppStore.getState().savePublishRecord(record("new"));

    expect(apiMocks.addExecutionRecord).toHaveBeenCalledWith(record("new"));
    expect(useAppStore.getState().executionHistory).toEqual(updated);
  });

  it("swallows save failures", async () => {
    apiMocks.addExecutionRecord.mockRejectedValue(new Error("io"));
    useAppStore.setState({ executionHistory: [record("keep")] });

    await useAppStore.getState().savePublishRecord(record("new"));

    expect(useAppStore.getState().executionHistory).toEqual([record("keep")]);
  });

  it("sets the snapshot path and stores the returned history", async () => {
    const updated = [record("a")];
    apiMocks.setExecutionRecordSnapshot.mockResolvedValue(updated);

    await useAppStore.getState().setExecutionSnapshotPath("a", "/snap/a.md");

    expect(apiMocks.setExecutionRecordSnapshot).toHaveBeenCalledWith(
      "a",
      "/snap/a.md"
    );
    expect(useAppStore.getState().executionHistory).toEqual(updated);
  });

  it("swallows snapshot-path update failures", async () => {
    apiMocks.setExecutionRecordSnapshot.mockRejectedValue(new Error("io"));
    useAppStore.setState({ executionHistory: [record("keep")] });

    await useAppStore.getState().setExecutionSnapshotPath("a", "/snap/a.md");

    expect(useAppStore.getState().executionHistory).toEqual([record("keep")]);
  });

  it("restores authoritative state and returns it", async () => {
    const authoritative = {
      repositories: [],
      executionHistory: [],
      recentRepoIds: ["repo-7"],
    };
    getAppState.mockResolvedValue(authoritative);

    const returned = await useAppStore.getState()._restoreAuthoritativeState();

    expect(returned).toEqual(authoritative);
    expect(useAppStore.getState().recentRepoIds).toEqual(["repo-7"]);
    expect(useAppStore.getState().error).toBeNull();
  });
});
