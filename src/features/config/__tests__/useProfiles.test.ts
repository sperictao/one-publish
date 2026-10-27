import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listState: {} as Record<string, unknown>,
  crud: {} as Record<string, unknown>,
  quickCreate: {} as Record<string, unknown>,
  quickCreateArgs: {} as Record<string, unknown>,
  orderingArgs: {} as Record<string, unknown>,
  selection: {} as Record<string, unknown>,
  deleteProfileById: vi.fn(),
}));

vi.mock("@/hooks/useProfileListState", () => ({
  useProfileListState: (args: Record<string, unknown>) => {
    mocks.listState.onRepositoryScopeChange = args.onRepositoryScopeChange;
    return {
      profiles: mocks.listState.profiles ?? [],
      profilesRevision: 0,
      isProfilesRefreshing: false,
      loadProfiles: mocks.listState.loadProfiles,
      refreshProfilesAfterMutation: vi.fn(),
      isCurrentRepo: () => true,
      commitProfilesSnapshot: mocks.listState.commitProfilesSnapshot,
    };
  },
}));

vi.mock("@/features/config/useProfileCrud", () => ({
  useProfileCrud: () => ({
    deleteProfileById: mocks.deleteProfileById,
    applyProfile: vi.fn(),
    saveProfile: vi.fn(),
    deleteProfile: vi.fn(),
    exportProfiles: vi.fn(),
    applyImportedProfiles: vi.fn(),
    handleLoadProfile: vi.fn(),
    handleCreateProfileFromProjectProfile: vi.fn(),
    ...mocks.crud,
  }),
}));

vi.mock("@/features/config/useQuickCreateProfile", () => ({
  useQuickCreateProfile: (args: Record<string, unknown>) => {
    mocks.quickCreateArgs = args;
    return {
      quickCreateProfileOpen: false,
      quickCreateProfileName: "",
      setQuickCreateProfileName: vi.fn(),
      quickCreateTemplateId: null,
      quickCreateProfileDraft: null,
      quickCreateProfileGroup: "default",
      setQuickCreateProfileGroup: vi.fn(),
      quickCreateProfileCustomGroup: null,
      setQuickCreateProfileCustomGroup: vi.fn(),
      quickCreateProfileSaving: false,
      isQuickCreateEditing: false,
      isQuickCreateViewing: false,
      openQuickCreateProfileDialog: vi.fn(),
      openQuickEditProfileDialog: vi.fn(),
      openQuickViewProfileDialog: vi.fn(),
      handleQuickCreateProfileOpenChange: vi.fn(),
      quickCreateTemplateOptions: [],
      quickCreateProfileGroupOptions: [],
      applyQuickCreateTemplate: vi.fn(),
      updateQuickCreateProfileParameter: vi.fn(),
      handleQuickCreateProfileSave: vi.fn(),
      ...mocks.quickCreate,
    };
  },
}));

vi.mock("@/features/config/useProfileOrdering", () => ({
  useProfileOrdering: (args: Record<string, unknown>) => {
    mocks.orderingArgs = args;
    return { reorderVisibleProfiles: vi.fn() };
  },
}));

vi.mock("@/features/config/useProfileSelection", () => ({
  useProfileSelection: () => ({
    handleSelectProjectProfile: vi.fn(),
    handleSelectProfileFromPanel: vi.fn(),
    ...mocks.selection,
  }),
}));

import { useProfiles } from "@/features/config/useProfiles";
import type { Repository } from "@/lib/store/types";
import type { PublishSelectionRef } from "@/generated/tauri-contracts";

function repoWithSelection(selection: PublishSelectionRef): Repository {
  return {
    id: "repo-1",
    name: "app",
    path: "/repo/app",
    currentBranch: "main",
    branches: [],
    publishConfig: {
      selection,
      drafts: [],
      profiles: [],
      bindings: [],
      appliedBundles: [],
    },
  } as Repository;
}

function params(overrides: Record<string, unknown> = {}) {
  return {
    backendTemplates: [],
    appT: {},
    profileT: {},
    language: "zh",
    selectedRepoId: "repo-1",
    activeProviderId: "dotnet",
    providerSchemas: {},
    applyProfileProvider: vi.fn(),
    updatePublishEditState: vi.fn(),
    selectedRepo: null,
    setProviderParameters: vi.fn(),
    replaceScopedConfigKey: vi.fn(),
    ...overrides,
  } as Parameters<typeof useProfiles>[0];
}

describe("useProfiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.listState = {
      profiles: [],
      loadProfiles: vi.fn(),
      commitProfilesSnapshot: vi.fn(),
    };
    mocks.crud = {};
    mocks.quickCreate = {};
    mocks.quickCreateArgs = {};
    mocks.orderingArgs = {};
    mocks.selection = {};
  });

  it("derives the active profile name from the persisted revision selection", () => {
    mocks.listState.profiles = [
      { id: "cfg-1", name: "Release" },
      { id: "cfg-2", name: "Debug" },
    ];
    const { result } = renderHook(() =>
      useProfiles(
        params({
          selectedRepo: repoWithSelection({
            kind: "revision",
            configurationId: "cfg-2",
          }),
        })
      )
    );

    expect(result.current.activeProfileName).toBe("Debug");
  });

  it("falls back to the local name when the selection matches no profile", () => {
    mocks.listState.profiles = [{ id: "cfg-1", name: "Release" }];
    const { result } = renderHook(() =>
      useProfiles(
        params({
          selectedRepo: repoWithSelection({
            kind: "revision",
            configurationId: "cfg-gone",
          }),
        })
      )
    );

    expect(result.current.activeProfileName).toBeNull();

    act(() => result.current.setActiveProfileName("Local"));
    expect(result.current.activeProfileName).toBe("Local");
  });

  it("clears the local name on repository scope change", () => {
    mocks.listState.profiles = [];
    const { result } = renderHook(() => useProfiles(params()));

    act(() => result.current.setActiveProfileName("Local"));
    expect(result.current.activeProfileName).toBe("Local");

    act(() => (mocks.listState.onRepositoryScopeChange as () => void)());
    expect(result.current.activeProfileName).toBeNull();
  });

  it("passes the draft-selection binding to quick create", () => {
    renderHook(() =>
      useProfiles(
        params({
          selectedRepo: repoWithSelection({
            kind: "draft",
            providerId: "dotnet",
            projectBinding: "dotnet:app",
          }),
        })
      )
    );

    expect(mocks.quickCreateArgs.projectBinding).toBe("dotnet:app");
  });

  it("passes the active profile binding to quick create for revisions", () => {
    mocks.listState.profiles = [
      { id: "cfg-1", name: "Release", projectBinding: "dotnet:lib" },
    ];
    renderHook(() =>
      useProfiles(
        params({
          selectedRepo: repoWithSelection({
            kind: "revision",
            configurationId: "cfg-1",
          }),
        })
      )
    );

    expect(mocks.quickCreateArgs.projectBinding).toBe("dotnet:lib");
  });

  it("deletes a profile from the panel through the crud layer", async () => {
    mocks.deleteProfileById.mockResolvedValue(undefined);
    const { result } = renderHook(() => useProfiles(params()));

    await act(async () => {
      await result.current.handleDeleteProfileFromPanel("cfg-1");
    });

    expect(mocks.deleteProfileById).toHaveBeenCalledWith("repo-1", "cfg-1");
  });

  it("skips panel deletion without a selected repo", async () => {
    const { result } = renderHook(() =>
      useProfiles(params({ selectedRepoId: null }))
    );

    await act(async () => {
      await result.current.handleDeleteProfileFromPanel("cfg-1");
    });

    expect(mocks.deleteProfileById).not.toHaveBeenCalled();
  });

  it("swallows deletion failures", async () => {
    mocks.deleteProfileById.mockRejectedValue(new Error("io"));
    const { result } = renderHook(() => useProfiles(params()));

    await act(async () => {
      await result.current.handleDeleteProfileFromPanel("cfg-1");
    });

    expect(console.error).toHaveBeenCalled();
  });

  it("commits optimistic reorders only with a selected repo", () => {
    renderHook(() => useProfiles(params()));
    const optimistic = mocks.orderingArgs.onOptimisticUpdate as (
      p: unknown[]
    ) => void;

    optimistic([{ id: "p1" }]);
    expect(mocks.listState.commitProfilesSnapshot).toHaveBeenCalledWith(
      "repo-1",
      [{ id: "p1" }]
    );
  });

  it("reloads profiles when a reorder fails", async () => {
    renderHook(() => useProfiles(params()));
    const failed = mocks.orderingArgs.onReorderFailed as () => Promise<void>;

    await act(async () => {
      await failed();
    });

    expect(mocks.listState.loadProfiles).toHaveBeenCalled();
  });
});
