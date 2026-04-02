import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAppState: vi.fn(),
  updatePublishState: vi.fn(),
  updateUIState: vi.fn(),
}));

vi.mock("@/lib/store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/store")>("@/lib/store");
  return {
    ...actual,
    getAppState: mocks.getAppState,
    updatePublishState: mocks.updatePublishState,
    updateUIState: mocks.updateUIState,
  };
});

import { defaultAppState, type AppState } from "@/lib/store";
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
            ...defaultAppState.customConfig,
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
});
