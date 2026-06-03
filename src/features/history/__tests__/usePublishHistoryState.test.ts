import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getExecutionHistory: vi.fn(),
}));

vi.mock("@/lib/store/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/store/api")>(
    "@/lib/store/api"
  );
  return {
    ...actual,
    getExecutionHistory: mocks.getExecutionHistory,
  };
});

import { usePublishHistoryState } from "@/features/history/usePublishHistoryState";
import {
  defaultAppState,
  type ExecutionRecord,
} from "@/lib/store/types";
import { useAppStore } from "@/stores/appStore";

function createRecord(): ExecutionRecord {
  return {
    id: "history-1",
    repoId: "repo-1",
    providerId: "dotnet",
    projectPath: "/repo/App.csproj",
    startedAt: "2026-04-02T10:00:00.000Z",
    finishedAt: "2026-04-02T10:00:03.000Z",
    success: true,
    cancelled: false,
    outputDir: "/repo/out",
    error: null,
    commandLine: "$ dotnet publish /repo/App.csproj",
    snapshotPath: null,
    failureSignature: null,
    outputExcerpt: null,
    spec: null,
    fileCount: 2,
  };
}

describe("usePublishHistoryState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      ...defaultAppState,
      isLoading: true,
      error: null,
      executionHistory: [],
    });
  });

  it("loads persisted execution history after app state boot completes", async () => {
    const record = createRecord();
    mocks.getExecutionHistory.mockResolvedValue([record]);

    const { result, rerender } = renderHook(
      ({ isStateLoading }) =>
        usePublishHistoryState({
          executionHistoryLimit: 20,
          isStateLoading,
        }),
      { initialProps: { isStateLoading: true } }
    );

    expect(mocks.getExecutionHistory).not.toHaveBeenCalled();
    expect(result.current.executionHistory).toEqual([]);

    rerender({ isStateLoading: false });

    await waitFor(() => {
      expect(result.current.executionHistory).toEqual([record]);
    });
    expect(mocks.getExecutionHistory).toHaveBeenCalledTimes(1);
  });
});
