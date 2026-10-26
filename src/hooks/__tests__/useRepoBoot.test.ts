import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/repository/useRepositoryViewState", () => ({
  useRepositoryViewState: () => ({
    selectedRepo: null,
    branchConnectivityByRepoId: {},
    actualBranchByRepoId: {},
  }),
}));
vi.mock("@/features/repository/useRepositoryActions", () => ({
  useRepositoryActions: () => ({
    handleAddRepo: vi.fn(),
    isAddingRepo: false,
    handleRemoveRepo: vi.fn(),
    handleOpenRepoDirectory: vi.fn(),
    handleEditRepo: vi.fn(),
    handleDetectRepoProvider: vi.fn(),
    handleScanProjectCandidates: vi.fn(),
    handleRefreshRepoBranches: vi.fn(),
  }),
}));
vi.mock("@/features/repository/useProjectShellState", () => ({
  useProjectShellState: () => ({
    projectInfo: null,
    isProjectInfoRefreshing: false,
    scanProject: vi.fn(),
  }),
}));
vi.mock("@/hooks/useProjectPublishProfileOrder", () => ({
  useProjectPublishProfileOrder: () => ({
    orderedProjectPublishProfiles: [],
    reorderProjectPublishProfiles: vi.fn(),
  }),
}));

import { useRepoBoot } from "@/hooks/useRepoBoot";

function params(overrides: Record<string, unknown> = {}) {
  return {
    repositories: [],
    selectedRepoId: null,
    addRepository: vi.fn(),
    removeRepository: vi.fn(),
    updateRepository: vi.fn(),
    reorderRepositories: vi.fn(),
    selectRepository: vi.fn(),
    appT: {},
    providerRuntimeProviders: [],
    isStateLoading: false,
    activeProviderUsesProjectFile: false,
    applySelectedRepositoryProvider: vi.fn(),
    ...overrides,
  } as Parameters<typeof useRepoBoot>[0];
}

describe("useRepoBoot", () => {
  it("tracks history exports most-recent-first and dedupes", () => {
    const { result } = renderHook(() => useRepoBoot(params()));

    act(() => result.current.trackHistoryExport("/out/a.csv"));
    act(() => result.current.trackHistoryExport("/out/b.csv"));
    act(() => result.current.trackHistoryExport("/out/a.csv"));

    expect(result.current.recentHistoryExports).toEqual([
      "/out/a.csv",
      "/out/b.csv",
    ]);
  });

  it("caps the tracked history exports at 20", () => {
    const { result } = renderHook(() => useRepoBoot(params()));

    act(() => {
      for (let i = 0; i < 25; i += 1) {
        result.current.trackHistoryExport(`/out/${i}.csv`);
      }
    });

    expect(result.current.recentHistoryExports).toHaveLength(20);
    expect(result.current.recentHistoryExports[0]).toBe("/out/24.csv");
    expect(result.current.recentHistoryExports[19]).toBe("/out/5.csv");
  });

  it("exposes environment last check state", () => {
    const { result } = renderHook(() => useRepoBoot(params()));
    const snapshot = {
      providerIds: ["dotnet"],
      result: {
        is_ready: true,
        providers: [],
        issues: [],
        checked_at: "2026-01-01T00:00:00Z",
      },
    };

    act(() => result.current.setEnvironmentLastCheck(snapshot));

    expect(result.current.environmentLastCheck).toEqual(snapshot);
  });
});
