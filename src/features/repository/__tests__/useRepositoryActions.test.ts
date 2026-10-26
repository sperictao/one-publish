import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const runtimeMocks = vi.hoisted(() => ({
  handleAddRepoRuntime: vi.fn(),
  handleRemoveRepoRuntime: vi.fn(),
  handleOpenRepoDirectoryRuntime: vi.fn(),
  handleEditRepoRuntime: vi.fn(),
  handleDetectRepoProviderRuntime: vi.fn(),
  handleScanProjectCandidatesRuntime: vi.fn(),
  handleRefreshRepoBranchesRuntime: vi.fn(),
}));

vi.mock(
  "@/features/repository/useRepositoryActions.runtime",
  () => runtimeMocks
);

vi.mock("@/hooks/useI18n", () => ({
  useI18n: () => ({ translations: {}, t: (k: string) => k }),
}));

import { useRepositoryActions } from "@/features/repository/useRepositoryActions";
import type { Repository } from "@/lib/store/types";

function repo(id: string): Repository {
  return { id, path: `/repos/${id}` } as Repository;
}

function params(overrides: Record<string, unknown> = {}) {
  return {
    appT: {},
    providers: [],
    repositories: [repo("a")],
    selectedRepoId: "a",
    addRepository: vi.fn(),
    removeRepository: vi.fn(),
    updateRepository: vi.fn(),
    applySelectedRepositoryProvider: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleAddRepo", () => {
  it("runs the runtime flow and toggles isAddingRepo", async () => {
    runtimeMocks.handleAddRepoRuntime.mockResolvedValue({
      status: "added",
      repoId: "a",
    });
    const p = params();
    const { result } = renderHook(() => useRepositoryActions(p));

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.handleAddRepo();
    });

    expect(outcome).toEqual({ status: "added", repoId: "a" });
    expect(runtimeMocks.handleAddRepoRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ appT: p.appT, providers: p.providers })
    );
    expect(result.current.isAddingRepo).toBe(false);
  });

  it("rejects concurrent add attempts while a flow is in-flight", async () => {
    let resolveRuntime: (v: unknown) => void = () => {};
    runtimeMocks.handleAddRepoRuntime.mockImplementation(
      () => new Promise((resolve) => (resolveRuntime = resolve))
    );
    const { result } = renderHook(() => useRepositoryActions(params()));

    let firstPromise!: Promise<unknown>;
    act(() => {
      firstPromise = result.current.handleAddRepo();
    });
    expect(result.current.isAddingRepo).toBe(true);

    const second = await result.current.handleAddRepo();
    expect(second).toEqual({ status: "cancelled" });

    // The deferred runtime call eventually runs exactly once.
    await vi.waitFor(() =>
      expect(runtimeMocks.handleAddRepoRuntime).toHaveBeenCalledTimes(1)
    );

    await act(async () => {
      resolveRuntime({ status: "added" });
      await firstPromise;
    });
    expect(result.current.isAddingRepo).toBe(false);
  });

  it("resets isAddingRepo when the runtime flow throws", async () => {
    runtimeMocks.handleAddRepoRuntime.mockRejectedValue(new Error("io"));
    const { result } = renderHook(() => useRepositoryActions(params()));

    await expect(
      act(async () => {
        await result.current.handleAddRepo();
      })
    ).rejects.toThrow("io");
    expect(result.current.isAddingRepo).toBe(false);
  });
});

describe("delegated handlers", () => {
  it("forwards remove/open/edit/detect/scan/refresh to the runtime", async () => {
    const p = params();
    const { result } = renderHook(() => useRepositoryActions(p));
    const target = repo("a");

    await result.current.handleRemoveRepo(target);
    expect(runtimeMocks.handleRemoveRepoRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ repo: target })
    );

    await result.current.handleOpenRepoDirectory(target);
    expect(runtimeMocks.handleOpenRepoDirectoryRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ repo: target })
    );

    await result.current.handleEditRepo(target);
    expect(runtimeMocks.handleEditRepoRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: target,
        selectedRepoId: "a",
      })
    );

    await result.current.handleDetectRepoProvider("/repo", {
      silentSuccess: true,
    });
    expect(runtimeMocks.handleDetectRepoProviderRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/repo",
        options: { silentSuccess: true },
      })
    );

    await result.current.handleScanProjectCandidates("/repo", "dotnet");
    expect(
      runtimeMocks.handleScanProjectCandidatesRuntime
    ).toHaveBeenCalledWith("/repo", "dotnet");

    await result.current.handleRefreshRepoBranches("/repo", {
      silentSuccess: true,
    });
    expect(runtimeMocks.handleRefreshRepoBranchesRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/repo",
        options: { silentSuccess: true },
      })
    );
  });
});
