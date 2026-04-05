import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRepositoryBranchConnectivity: vi.fn(),
}));

vi.mock("@/lib/store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/store")>("@/lib/store");
  return {
    ...actual,
    checkRepositoryBranchConnectivity: mocks.checkRepositoryBranchConnectivity,
  };
});

import { useRepositoryViewState } from "@/hooks/useRepositoryViewState";
import { defaultPublishConfigStore, type Repository } from "@/lib/store";

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

describe("useRepositoryViewState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRepositoryBranchConnectivity.mockResolvedValue({
      canConnect: true,
    });
  });

  it("仅在仓库路径或分支变化时重跑连通性检查", async () => {
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
      expect(mocks.checkRepositoryBranchConnectivity).toHaveBeenCalledTimes(1);
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

    rerender({
      repositories: [
        {
          ...repository,
          currentBranch: "develop",
        },
      ],
      selectedRepoId: repository.id,
    });

    await waitFor(() => {
      expect(mocks.checkRepositoryBranchConnectivity).toHaveBeenCalledTimes(2);
    });
  });

  it("新增仓库时只检查新增项，不重查已缓存仓库", async () => {
    const repoA = createRepositoryWithId("repo-a");
    const repoB = createRepositoryWithId("repo-b");
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
