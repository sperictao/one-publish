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
});
