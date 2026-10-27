import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRepositoryBranchConnectivity: vi.fn(),
  scanRepositoryBranches: vi.fn(),
}));

vi.mock("@/lib/store/api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/store/api")>("@/lib/store/api");
  return {
    ...actual,
    checkRepositoryBranchConnectivity: mocks.checkRepositoryBranchConnectivity,
    scanRepositoryBranches: mocks.scanRepositoryBranches,
  };
});

import { useRepositoryViewState } from "@/features/repository/useRepositoryViewState";
import type { Repository } from "@/lib/store/types";

function createRepository(): Repository {
  return {
    id: "repo-1",
    name: "one-publish",
    path: "/repo",
    currentBranch: "main",
    branches: [],
    isMain: true,
    providerId: "dotnet",
    publishConfig: {
      selection: {
        kind: "draft" as const,
        providerId: "dotnet",
        projectBinding: null,
      },
      profiles: [],
      bindings: [],
      appliedBundles: [],
      drafts: [],
    },
  };
}

function createRepositoryWithId(
  id: string,
  overrides?: Partial<Repository>
): Repository {
  return {
    ...createRepository(),
    id,
    name: `repo-${id}`,
    path: `/repo/${id}`,
    ...overrides,
  };
}

function mockActualBranch(branchByPath: Record<string, string>): void {
  mocks.scanRepositoryBranches.mockImplementation(async (path: string) => ({
    branches: [],
    current_branch: branchByPath[path] ?? "main",
  }));
}

describe("useRepositoryViewState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRepositoryBranchConnectivity.mockResolvedValue({
      canConnect: true,
    });
    mockActualBranch({});
  });

  it("扫描出的实际分支会暴露给消费者并用于连通性检查", async () => {
    const repository = createRepository();
    mockActualBranch({ [repository.path]: "feature/login" });

    const { result } = renderHook(() =>
      useRepositoryViewState({
        repositories: [repository],
        selectedRepoId: repository.id,
      })
    );

    await waitFor(() => {
      expect(result.current.actualBranchByRepoId[repository.id]).toBe(
        "feature/login"
      );
    });

    await waitFor(() => {
      expect(mocks.checkRepositoryBranchConnectivity).toHaveBeenCalledWith(
        repository.path,
        "feature/login"
      );
    });
  });

  it("仓库集合不变时不因外部 rerender 重复扫描实际分支", async () => {
    const repository = createRepository();
    const { rerender } = renderHook(
      ({ repositories, selectedRepoId }) =>
        useRepositoryViewState({
          repositories,
          selectedRepoId,
        }),
      {
        initialProps: {
          repositories: [repository],
          selectedRepoId: repository.id,
        },
      }
    );

    await waitFor(() => {
      expect(mocks.scanRepositoryBranches).toHaveBeenCalledTimes(1);
    });

    rerender({
      repositories: [
        {
          ...repository,
          publishConfig: {
            ...repository.publishConfig,
          },
        },
      ],
      selectedRepoId: repository.id,
    });

    await waitFor(() => {
      expect(mocks.checkRepositoryBranchConnectivity).toHaveBeenCalledTimes(1);
    });
    expect(mocks.scanRepositoryBranches).toHaveBeenCalledTimes(1);
  });

  it("新增仓库时只检查新增项，不重查已缓存仓库", async () => {
    const repoA = createRepositoryWithId("repo-a");
    const repoB = createRepositoryWithId("repo-b");
    mockActualBranch({
      [repoA.path]: repoA.currentBranch,
      [repoB.path]: repoB.currentBranch,
    });

    const { rerender } = renderHook(
      ({ repositories, selectedRepoId }) =>
        useRepositoryViewState({
          repositories,
          selectedRepoId,
        }),
      {
        initialProps: {
          repositories: [repoA],
          selectedRepoId: repoA.id,
        },
      }
    );

    await waitFor(() => {
      expect(mocks.checkRepositoryBranchConnectivity).toHaveBeenCalledTimes(1);
    });

    rerender({
      repositories: [repoA, repoB],
      selectedRepoId: repoA.id,
    });

    await waitFor(() => {
      expect(mocks.checkRepositoryBranchConnectivity).toHaveBeenCalledTimes(2);
    });

    expect(mocks.checkRepositoryBranchConnectivity).toHaveBeenNthCalledWith(
      1,
      repoA.path,
      repoA.currentBranch
    );
    expect(mocks.checkRepositoryBranchConnectivity).toHaveBeenNthCalledWith(
      2,
      repoB.path,
      repoB.currentBranch
    );
  });

  it("selectedRepoId 找不到仓库时 selectedRepo 为 null", async () => {
    const repository = createRepository();
    const { result } = renderHook(() =>
      useRepositoryViewState({
        repositories: [repository],
        selectedRepoId: "missing",
      })
    );

    await waitFor(() => {
      expect(mocks.scanRepositoryBranches).toHaveBeenCalled();
    });
    expect(result.current.selectedRepo).toBeNull();
  });

  it("分支扫描失败的仓库回落到存量 currentBranch 做连通性检查", async () => {
    const repository = createRepository();
    mocks.scanRepositoryBranches.mockRejectedValue(new Error("not a repo"));

    const { result } = renderHook(() =>
      useRepositoryViewState({
        repositories: [repository],
        selectedRepoId: repository.id,
      })
    );

    await waitFor(() => {
      expect(result.current.actualBranchByRepoId[repository.id]).toBe("");
    });

    await waitFor(() => {
      expect(mocks.checkRepositoryBranchConnectivity).toHaveBeenCalledWith(
        repository.path,
        repository.currentBranch
      );
    });
  });

  it("卸载前晚到的扫描结果不会写入状态", async () => {
    const repository = createRepository();
    let resolveScan!: (value: {
      branches: string[];
      current_branch: string;
    }) => void;
    mocks.scanRepositoryBranches.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveScan = resolve;
        })
    );

    const { result, unmount } = renderHook(() =>
      useRepositoryViewState({
        repositories: [repository],
        selectedRepoId: repository.id,
      })
    );

    unmount();
    resolveScan({ branches: [], current_branch: "late-branch" });
    await Promise.resolve();

    expect(result.current.actualBranchByRepoId[repository.id]).toBeUndefined();
  });

  it("窗口聚焦在节流窗口内不重扫，过期后重扫", async () => {
    const repository = createRepository();
    const nowSpy = vi.spyOn(Date, "now");
    const t0 = 1_000_000;
    nowSpy.mockReturnValue(t0);

    renderHook(() =>
      useRepositoryViewState({
        repositories: [repository],
        selectedRepoId: repository.id,
      })
    );

    await waitFor(() => {
      expect(mocks.scanRepositoryBranches).toHaveBeenCalledTimes(1);
    });

    nowSpy.mockReturnValue(t0 + 1_000);
    window.dispatchEvent(new Event("focus"));
    expect(mocks.scanRepositoryBranches).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(t0 + 10_000);
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => {
      expect(mocks.scanRepositoryBranches).toHaveBeenCalledTimes(2);
    });

    nowSpy.mockRestore();
  });

  it("清理后晚到的连通性结果不会写入状态", async () => {
    const repository = createRepository();
    let resolveCheck!: (value: { canConnect: boolean }) => void;
    mocks.checkRepositoryBranchConnectivity.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCheck = resolve;
        })
    );

    const { result, unmount } = renderHook(() =>
      useRepositoryViewState({
        repositories: [repository],
        selectedRepoId: repository.id,
      })
    );

    await waitFor(() => {
      expect(mocks.checkRepositoryBranchConnectivity).toHaveBeenCalled();
    });

    unmount();
    resolveCheck({ canConnect: true });
    await Promise.resolve();

    expect(
      result.current.branchConnectivityByRepoId[repository.id]
    ).toBeUndefined();
  });

  it("连通性检查失败的仓库记录为不可达", async () => {
    const repository = createRepository();
    mocks.checkRepositoryBranchConnectivity.mockRejectedValue(
      new Error("network down")
    );

    const { result } = renderHook(() =>
      useRepositoryViewState({
        repositories: [repository],
        selectedRepoId: repository.id,
      })
    );

    await waitFor(() => {
      expect(result.current.branchConnectivityByRepoId[repository.id]).toBe(
        false
      );
    });
  });

  it("扫描失败且存量分支为空的仓库以 undefined 分支做连通性检查", async () => {
    const repository = createRepositoryWithId("repo-empty", {
      currentBranch: "",
    });
    mocks.scanRepositoryBranches.mockRejectedValue(new Error("not a repo"));

    renderHook(() =>
      useRepositoryViewState({
        repositories: [repository],
        selectedRepoId: repository.id,
      })
    );

    await waitFor(() => {
      expect(mocks.checkRepositoryBranchConnectivity).toHaveBeenCalledWith(
        repository.path,
        undefined
      );
    });
  });

  it("仓库集合缩小时丢弃已不在检查目标内的连通性缓存", async () => {
    const repoA = createRepositoryWithId("repo-a");
    const repoB = createRepositoryWithId("repo-b");
    const repoC = createRepositoryWithId("repo-c");
    mockActualBranch({
      [repoA.path]: repoA.currentBranch,
      [repoB.path]: repoB.currentBranch,
      [repoC.path]: repoC.currentBranch,
    });

    const { result, rerender } = renderHook(
      ({ repositories }) =>
        useRepositoryViewState({ repositories, selectedRepoId: null }),
      { initialProps: { repositories: [repoA, repoB] } }
    );

    await waitFor(() => {
      expect(mocks.checkRepositoryBranchConnectivity).toHaveBeenCalledTimes(2);
    });

    rerender({ repositories: [repoB, repoC] });

    await waitFor(() => {
      expect(mocks.checkRepositoryBranchConnectivity).toHaveBeenCalledTimes(3);
    });
    expect(mocks.checkRepositoryBranchConnectivity).toHaveBeenNthCalledWith(
      3,
      repoC.path,
      repoC.currentBranch
    );
    await waitFor(() => {
      expect(result.current.branchConnectivityByRepoId).toEqual({
        [repoB.id]: true,
        [repoC.id]: true,
      });
    });
  });

  it("替换仓库集合时清空上一轮的连通性缓存", async () => {
    const repoA = createRepositoryWithId("repo-a");
    const repoB = createRepositoryWithId("repo-b");
    mockActualBranch({
      [repoA.path]: repoA.currentBranch,
      [repoB.path]: repoB.currentBranch,
    });

    const { result, rerender } = renderHook(
      ({ repositories }) =>
        useRepositoryViewState({ repositories, selectedRepoId: null }),
      { initialProps: { repositories: [repoA] } }
    );

    await waitFor(() => {
      expect(result.current.branchConnectivityByRepoId[repoA.id]).toBe(true);
    });

    rerender({ repositories: [repoB] });

    await waitFor(() => {
      expect(result.current.branchConnectivityByRepoId[repoB.id]).toBe(true);
    });
    expect(result.current.branchConnectivityByRepoId[repoA.id]).toBeUndefined();
  });
});
