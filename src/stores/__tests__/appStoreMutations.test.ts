import { describe, expect, it } from "vitest";

import {
  applyPreferenceStateMutation,
  applyPublishStateMutation,
  applyUiStateMutation,
  mergeRecentPublishState,
  resolveScopedMutationRepoId,
} from "@/stores/appStoreMutations";
import {
  defaultAppState,
  defaultPublishConfigStore,
  defaultRepoPublishConfig,
  type AppState,
  type Repository,
} from "@/lib/store/types";

function createRepository(id: string): Repository {
  return {
    id,
    name: id,
    path: `/repo/${id}`,
    projectFile: null,
    currentBranch: "main",
    branches: [],
    isMain: true,
    providerId: "dotnet",
    publishConfig: {
      ...defaultRepoPublishConfig,
      customConfig: { ...defaultPublishConfigStore },
    },
  };
}

function createState(): AppState {
  return {
    ...defaultAppState,
    repositories: [createRepository("repo-1"), createRepository("repo-2")],
    selectedRepoId: "repo-1",
  };
}

describe("appStoreMutations", () => {
  it("applies UI state mutations without leaking unrelated state", () => {
    const state = createState();

    const next = applyUiStateMutation(state, {
      middlePanelWidth: 340,
      clearSelectedRepoId: true,
    });

    expect(next.middlePanelWidth).toBe(340);
    expect(next.selectedRepoId).toBeNull();
    expect(next.repositories).toBe(state.repositories);
  });

  it("normalizes preference mutation values at the store boundary", () => {
    const next = applyPreferenceStateMutation(createState(), {
      language: "en",
      environmentProviderIds: ["dotnet", "dotnet", " cargo ", ""],
    });

    expect(next.language).toBe("en");
    expect(next.environmentProviderIds).toEqual(["cargo", "dotnet"]);
  });

  it("patches publish state only for the target repository", () => {
    const state = createState();
    const customConfig = {
      ...defaultPublishConfigStore,
      configuration: "Debug",
    };

    const next = applyPublishStateMutation(state, "repo-2", {
      selectedPreset: "profile-FolderProfile",
      isCustomMode: true,
      customConfig,
    });

    expect(next.repositories[0]?.publishConfig).toBe(
      state.repositories[0]?.publishConfig
    );
    expect(next.repositories[1]?.publishConfig).toMatchObject({
      selectedPreset: "profile-FolderProfile",
      isCustomMode: true,
      customConfig,
    });
  });

  it("merges recent publish state through one contract", () => {
    const next = mergeRecentPublishState(createState(), {
      recentRepoIds: ["repo-2"],
      recentConfigKeysByRepo: {
        "repo-2": ["userprofile:alpha"],
      },
    });

    expect(next.recentRepoIds).toEqual(["repo-2"]);
    expect(next.recentConfigKeysByRepo).toEqual({
      "repo-2": ["userprofile:alpha"],
    });
  });

  it("resolves explicit mutation repo id before selected repo id", () => {
    expect(resolveScopedMutationRepoId("repo-1", "repo-2")).toBe("repo-2");
    expect(resolveScopedMutationRepoId("repo-1", null)).toBe("repo-1");
    expect(resolveScopedMutationRepoId(null, undefined)).toBeNull();
  });
});
