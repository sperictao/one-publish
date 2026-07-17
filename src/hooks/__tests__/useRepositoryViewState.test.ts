import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRepositoryBranchConnectivity: vi.fn(),
  scanRepositoryBranches: vi.fn(),
}));

vi.mock("@/lib/store/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/store/api")>("@/lib/store/api");
  return {
    ...actual,
    checkRepositoryBranchConnectivity: mocks.checkRepositoryBranchConnectivity,
    scanRepositoryBranches: mocks.scanRepositoryBranches,
  };
});

import { useRepositoryViewState } from "@/features/repository/useRepositoryViewState";
import { defaultPublishConfigStore, type Repository } from "@/lib/store/types";

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
      selectedPreset: "release-fd",
      isCustomMode: true,
      customConfig: {
        ...defaultPublishConfigStore,
        configuration: "Release",
      },
      profiles: [],
    },
  };
}

function createRepositoryWithId(id: string, overrides?: Partial<Repository>): Repository {
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
            selectedPreset: "release-win-x64",
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
});
