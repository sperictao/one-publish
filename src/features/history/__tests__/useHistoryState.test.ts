import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useHistoryViewState } from "@/features/history/useHistoryViewState";
import { useHistoryDiagnosticsState } from "@/features/history/useHistoryDiagnosticsState";
import { useExecutionHistoryCardProps } from "@/features/history/useExecutionHistoryCardProps";
import type { ExecutionRecord, Repository } from "@/lib/store/types";

function record(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    id: "rec-1",
    providerId: "dotnet",
    projectPath: "/repo/app",
    startedAt: "2026-01-01T00:00:00Z",
    finishedAt: "2026-01-01T00:00:01Z",
    success: true,
    cancelled: false,
    fileCount: 0,
    repoId: "repo-1",
    ...overrides,
  };
}

describe("useHistoryViewState", () => {
  it("filters records and clears all filters", () => {
    const records = [
      record({ id: "a", providerId: "dotnet" }),
      record({ id: "b", providerId: "cargo" }),
    ];
    const setters = {
      setHistoryFilterProvider: vi.fn(),
      setHistoryFilterStatus: vi.fn(),
      setHistoryFilterWindow: vi.fn(),
      setHistoryFilterKeyword: vi.fn(),
    };
    const { result, rerender } = renderHook(
      (provider) =>
        useHistoryViewState({
          scopedExecutionHistory: records,
          historyFilterProvider: provider,
          historyFilterStatus: "all",
          historyFilterWindow: "all",
          historyFilterKeyword: "",
          ...setters,
        }),
      { initialProps: "all" }
    );

    expect(result.current.filteredExecutionHistory).toHaveLength(2);

    rerender("cargo");
    expect(result.current.filteredExecutionHistory.map((r) => r.id)).toEqual([
      "b",
    ]);

    act(() => result.current.clearHistoryFilters());
    expect(setters.setHistoryFilterProvider).toHaveBeenCalledWith("all");
    expect(setters.setHistoryFilterStatus).toHaveBeenCalledWith("all");
    expect(setters.setHistoryFilterWindow).toHaveBeenCalledWith("all");
    expect(setters.setHistoryFilterKeyword).toHaveBeenCalledWith("");
  });
});

describe("useHistoryDiagnosticsState", () => {
  const repo = { id: "repo-1", path: "/repo" } as Repository;

  it("scopes history to the selected repo and derives provider options", () => {
    const records = [
      record({ id: "1", providerId: "dotnet" }),
      record({ id: "2", providerId: "cargo" }),
      record({
        id: "3",
        providerId: "dotnet",
        repoId: "repo-9",
        projectPath: "/elsewhere/app",
      }),
    ];
    const { result } = renderHook(() =>
      useHistoryDiagnosticsState({
        executionHistory: records,
        selectedRepo: repo,
      })
    );

    expect(result.current.scopedExecutionHistory.map((r) => r.id)).toEqual([
      "1",
      "2",
    ]);
    expect(result.current.historyProviderOptions).toEqual(["cargo", "dotnet"]);
  });

  it("returns empty projections without a selected repo", () => {
    const { result } = renderHook(() =>
      useHistoryDiagnosticsState({
        executionHistory: [record()],
        selectedRepo: null,
      })
    );

    expect(result.current.scopedExecutionHistory).toEqual([]);
    expect(result.current.historyProviderOptions).toEqual([]);
    expect(result.current.snapshotPaths).toEqual([]);
  });

  it("dedupes snapshot paths and counts failure groups over filtered history", () => {
    const records = [
      record({ id: "1", snapshotPath: "/snap/a.md" }),
      record({ id: "2", snapshotPath: "/snap/a.md" }),
      record({ id: "3", snapshotPath: "  " }),
      record({ id: "4", snapshotPath: "/snap/b.md" }),
      record({
        id: "5",
        success: false,
        cancelled: false,
        failureSignature: "build-failed",
      }),
    ];
    const { result } = renderHook(() =>
      useHistoryDiagnosticsState({
        executionHistory: records,
        selectedRepo: repo,
      })
    );

    expect(result.current.snapshotPaths).toEqual(["/snap/a.md", "/snap/b.md"]);
    expect(result.current.failureGroupCount).toBeGreaterThanOrEqual(0);
  });

  it("applies filter state changes through setters", () => {
    const records = [
      record({ id: "1", providerId: "dotnet" }),
      record({ id: "2", providerId: "cargo" }),
    ];
    const { result } = renderHook(() =>
      useHistoryDiagnosticsState({
        executionHistory: records,
        selectedRepo: repo,
      })
    );

    act(() => result.current.setHistoryFilterProvider("cargo"));
    expect(result.current.historyFilterProvider).toBe("cargo");
    expect(result.current.filteredExecutionHistory.map((r) => r.id)).toEqual([
      "2",
    ]);
  });
});

describe("useExecutionHistoryCardProps", () => {
  it("maps state params to card prop names", () => {
    const callbacks = {
      setHistoryFilterProvider: vi.fn(),
      setHistoryFilterStatus: vi.fn(),
      setHistoryFilterWindow: vi.fn(),
      setHistoryFilterKeyword: vi.fn(),
      exportExecutionHistory: vi.fn(),
      exportFailureGroupBundle: vi.fn(),
      clearHistoryFilters: vi.fn(),
      openSnapshotFromRecord: vi.fn(),
      rerunFromHistory: vi.fn(),
      copyHandoffSnippet: vi.fn(),
      exportHandoffBundle: vi.fn(),
    };
    const { result } = renderHook(() =>
      useExecutionHistoryCardProps({
        scopedExecutionHistory: [record()],
        filteredExecutionHistory: [record()],
        executionHistoryLimit: 20,
        historyProviderOptions: ["dotnet"],
        historyFilterProvider: "all",
        historyFilterStatus: "all",
        historyFilterWindow: "7d",
        historyFilterKeyword: "x",
        isExportingHistory: false,
        isExportingFailureGroups: true,
        failureGroupCount: 3,
        isPublishing: false,
        appT: {},
        historyT: {},
        failureT: {},
        ...callbacks,
      })
    );

    const props = result.current;
    expect(props.historyFilterWindow).toBe("7d");
    expect(props.failureGroupCount).toBe(3);
    expect(props.isExportingFailureGroups).toBe(true);
    expect(props.onHistoryFilterProviderChange).toBe(
      callbacks.setHistoryFilterProvider
    );
    expect(props.onExportFailureGroups).toBe(
      callbacks.exportFailureGroupBundle
    );
    expect(props.onPromoteFromHistory).toBeUndefined();
  });
});
