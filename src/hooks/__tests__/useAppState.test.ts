import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAppState: vi.fn(),
  updatePublishState: vi.fn(),
  updateUIState: vi.fn(),
  updatePreferences: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
  },
}));

vi.mock("@/lib/store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/store")>("@/lib/store");
  return {
    ...actual,
    getAppState: mocks.getAppState,
    updatePublishState: mocks.updatePublishState,
    updateUIState: mocks.updateUIState,
    updatePreferences: mocks.updatePreferences,
  };
});

import {
  defaultAppState,
  defaultPublishConfigStore,
  type AppState,
} from "@/lib/store";
import { useAppState } from "@/hooks/useAppState";

function createAppState(): AppState {
  return {
    ...defaultAppState,
    repositories: [
      {
        id: "repo-1",
        name: "one-publish",
        path: "/repo",
        currentBranch: "main",
        branches: [],
        isMain: true,
        providerId: "dotnet",
        publishConfig: {
          selectedPreset: "release-fd",
          isCustomMode: true,
          customConfig: {
            ...defaultPublishConfigStore,
            configuration: "Debug",
          },
          profiles: [],
        },
      },
    ],
    selectedRepoId: "repo-1",
  };
}

async function waitForAppStateLoad() {
  await act(async () => {
    await Promise.resolve();
    await mocks.getAppState.mock.results[0]?.value;
  });
}

describe("useAppState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.getAppState.mockResolvedValue(createAppState());
    mocks.updatePublishState.mockResolvedValue(undefined);
    mocks.updateUIState.mockResolvedValue(undefined);
    mocks.updatePreferences.mockResolvedValue(createAppState());
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("会合并同一仓库连续的发布配置 patch", async () => {
    const { result } = renderHook(() => useAppState());

    await waitForAppStateLoad();
    expect(result.current.isLoading).toBe(false);

    await act(async () => {
      result.current.setSelectedPreset("profile-FolderProfile");
      result.current.setIsCustomMode(false);
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(mocks.updatePublishState).toHaveBeenCalledWith({
      repoId: "repo-1",
      selectedPreset: "profile-FolderProfile",
      isCustomMode: false,
    });
    expect(mocks.updatePublishState).toHaveBeenCalledTimes(1);
  });

  it("清空选中仓库时会显式发送 clearSelectedRepoId", async () => {
    const { result } = renderHook(() => useAppState());

    await waitForAppStateLoad();
    expect(result.current.isLoading).toBe(false);

    await act(async () => {
      result.current.selectRepository(null);
      vi.advanceTimersByTime(500);
    });

    expect(result.current.selectedRepoId).toBeNull();
    expect(mocks.updateUIState).toHaveBeenCalledWith({
      selectedRepoId: null,
      clearSelectedRepoId: true,
    });
  });

  it("发布配置持久化失败时会回滚并提示", async () => {
    const initialState = createAppState();
    const authoritativeState = createAppState();
    authoritativeState.repositories[0].publishConfig.selectedPreset = "release-fd";
    authoritativeState.repositories[0].publishConfig.isCustomMode = true;
    mocks.getAppState
      .mockResolvedValueOnce(initialState)
      .mockResolvedValueOnce(authoritativeState);
    mocks.updatePublishState.mockRejectedValueOnce(new Error("publish failed"));

    const { result } = renderHook(() => useAppState());

    await waitForAppStateLoad();

    await act(async () => {
      result.current.setSelectedPreset("profile-FolderProfile");
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(result.current.selectedPreset).toBe("release-fd");
    expect(mocks.toastError).toHaveBeenCalledWith("保存发布配置失败", {
      description: "publish failed",
    });
  });

  it("界面状态持久化失败时会回滚并提示", async () => {
    const initialState = createAppState();
    const authoritativeState = createAppState();
    authoritativeState.selectedRepoId = "repo-1";
    mocks.getAppState
      .mockResolvedValueOnce(initialState)
      .mockResolvedValueOnce(authoritativeState);
    mocks.updateUIState.mockRejectedValueOnce(new Error("ui failed"));

    const { result } = renderHook(() => useAppState());

    await waitForAppStateLoad();

    await act(async () => {
      result.current.selectRepository(null);
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(result.current.selectedRepoId).toBe("repo-1");
    expect(mocks.toastError).toHaveBeenCalledWith("保存界面状态失败", {
      description: "ui failed",
    });
  });

  it("偏好设置持久化失败时会回滚并提示", async () => {
    const initialState = createAppState();
    const authoritativeState = createAppState();
    authoritativeState.theme = "auto";
    mocks.getAppState
      .mockResolvedValueOnce(initialState)
      .mockResolvedValueOnce(authoritativeState);
    mocks.updatePreferences.mockRejectedValueOnce(new Error("preferences failed"));

    const { result } = renderHook(() => useAppState());

    await waitForAppStateLoad();

    await act(async () => {
      result.current.setTheme("dark");
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(result.current.theme).toBe("auto");
    expect(mocks.toastError).toHaveBeenCalledWith("保存偏好设置失败", {
      description: "preferences failed",
    });
  });
});
