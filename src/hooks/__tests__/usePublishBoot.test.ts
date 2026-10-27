import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadProfiles: vi.fn(),
  openQuickEditProfileDialog: vi.fn(),
  openQuickCreateProfileDialog: vi.fn(),
  updateProfile: vi.fn(),
  rebindProfileProject: vi.fn(),
  runnerArgs: {} as Record<string, unknown>,
  commandImportArgs: {} as Record<string, unknown>,
  profilesList: [] as Array<{ id: string; revisionId: string }>,
  storePublishResult: null as unknown,
  activeProviderUsesProjectFile: false,
  activeImportFeedback: null as unknown,
}));

vi.mock("@/features/provider/useProviderPresentationState", () => ({
  useProviderPresentationState: () => ({
    activeProviderLabel: "dotnet",
    activeProviderUsesProjectFile: mocks.activeProviderUsesProjectFile,
    activeProviderRequiresProjectBinding: false,
    repositoryProviders: [],
    providerRuntimeBanner: null,
  }),
}));

vi.mock("@/features/config/useScopedConfigs", () => ({
  useScopedConfigs: () => ({
    recentConfigKeys: [],
    favoriteConfigKeys: [],
    pushRecentConfig: vi.fn(),
    removeRecentConfig: vi.fn(),
    reorderRecentConfig: vi.fn(),
    toggleFavoriteConfig: vi.fn(),
    replaceScopedConfigKey: vi.fn(),
  }),
}));

vi.mock("@/features/config/useProfiles", () => ({
  QUICK_CREATE_PROFILE_GROUP_CUSTOM: "custom",
  QUICK_CREATE_PROFILE_GROUP_DEFAULT: "default",
  useProfiles: () => ({
    profiles: mocks.profilesList,
    isProfilesRefreshing: false,
    activeProfileName: null,
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
    loadProfiles: mocks.loadProfiles,
    openQuickCreateProfileDialog: mocks.openQuickCreateProfileDialog,
    openQuickEditProfileDialog: mocks.openQuickEditProfileDialog,
    openQuickViewProfileDialog: vi.fn(),
    handleQuickCreateProfileOpenChange: vi.fn(),
    quickCreateTemplateOptions: [],
    quickCreateProfileGroupOptions: [],
    applyQuickCreateTemplate: vi.fn(),
    updateQuickCreateProfileParameter: vi.fn(),
    handleSelectProjectProfile: vi.fn(),
    handleSelectProfileFromPanel: vi.fn(),
    handleQuickCreateProfileSave: vi.fn(),
    handleDeleteProfileFromPanel: vi.fn(),
    handleLoadProfile: vi.fn(),
    handleCreateProfileFromProjectProfile: vi.fn(),
    handleReorderProfiles: vi.fn(),
    profileManagement: {},
  }),
}));

vi.mock("@/features/publish/usePublishRunner", () => ({
  usePublishRunner: (args: Record<string, unknown>) => {
    mocks.runnerArgs = args;
    return {
      outputLog: "",
      getOutputLogSnapshot: () => "",
      publishPreviewCommand: null,
      preparedRuntime: null,
      runtimePreparationError: null,
      activeRuntime: null,
      runtimeResult: null,
      runPublishSpec: vi.fn(),
      startPublish: vi.fn(),
      cancelPublish: vi.fn(),
    };
  },
}));

vi.mock("@/hooks/useRerunFlow", () => ({
  useRerunFlow: () => ({
    rerunFromHistory: vi.fn(),
    promoteFromHistory: vi.fn(),
  }),
}));

vi.mock("@/hooks/useCommandImport", () => ({
  useCommandImport: (args: Record<string, unknown>) => {
    mocks.commandImportArgs = args;
    return {
      activeImportFeedback: mocks.activeImportFeedback,
      handleCommandImport: vi.fn(),
    };
  },
}));

vi.mock("@/stores/publishStore", () => ({
  usePublishStore: {
    getState: () => ({ publishResult: mocks.storePublishResult }),
  },
}));

vi.mock("@/lib/store/api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/store/api")>("@/lib/store/api");
  return {
    ...actual,
    updateProfile: mocks.updateProfile,
    rebindProfileProject: mocks.rebindProfileProject,
  };
});

import { usePublishBoot } from "@/hooks/usePublishBoot";
import type { Repository } from "@/lib/store/types";
import type { PublishSelectionRef } from "@/generated/tauri-contracts";

function repoWithSelection(selection: PublishSelectionRef | null): Repository {
  return {
    id: "repo-1",
    name: "app",
    path: "/repo/app",
    currentBranch: "main",
    branches: [],
    publishConfig: {
      selection: selection ?? undefined,
      drafts: [
        {
          providerId: "dotnet",
          content: {
            providerId: "dotnet",
            contractVersion: 1,
            providerVersion: "1",
            settingsVersion: 1,
            parameters: { outputDir: "/draft-out" },
            composition: {
              executionBackend: {
                adapterId: "cli",
                settingsVersion: 1,
                settings: {},
                credentials: {},
              },
              artifactStore: {
                adapterId: "fs",
                settingsVersion: 1,
                settings: {},
                credentials: {},
              },
              artifactProcessors: [],
              deliveryRoutes: [],
            },
          },
        },
      ],
      profiles: [
        {
          id: "cfg-1",
          revisionId: "rev-1",
          name: "Release",
          providerId: "dotnet",
          parameters: { outputDir: "/profile-out" },
          createdAt: "2026-01-01T00:00:00Z",
          isSystemDefault: false,
          externalBindingIds: [],
        },
      ],
      bindings: [],
      appliedBundles: [],
    },
  } as Repository;
}

function params(overrides: Record<string, unknown> = {}) {
  return {
    updatePublishEditState: vi.fn(),
    recentConfigKeysByRepo: {},
    pushRecentPublishConfig: vi.fn(),
    removeRecentPublishConfig: vi.fn(),
    reorderRecentPublishConfigs: vi.fn(),
    replaceRecentPublishConfigKey: vi.fn(),
    defaultOutputDir: "",
    executionHistoryLimit: 50,
    configT: {},
    publishT: {},
    appT: {},
    historyT: {},
    failureT: {},
    profileT: {},
    language: "zh",
    openEnvironmentDialog: vi.fn(),
    leftPanelCollapsed: false,
    setLeftPanelCollapsed: vi.fn(),
    middlePanelCollapsed: false,
    setMiddlePanelCollapsed: vi.fn(),
    rightPanelView: "home",
    handleConfigDialogOpenChange: vi.fn(),
    selectedRepoId: "repo-1",
    selectedRepo: repoWithSelection(null),
    projectInfo: null,
    isProjectInfoRefreshing: false,
    scanProject: vi.fn(),
    orderedProjectPublishProfiles: [],
    reorderProjectPublishProfiles: vi.fn(),
    extractSpecFromRecord: vi.fn(),
    setEnvironmentLastCheck: vi.fn(),
    recentHistoryExports: [],
    trackHistoryExport: vi.fn(),
    activeProviderId: "dotnet",
    setActiveProviderId: vi.fn(),
    providerListState: { status: "ready", data: [], error: null },
    activeProviderSchemaState: {
      status: "ready",
      data: {} as never,
      error: null,
    },
    retryProviderList: vi.fn(),
    retryProviderSchema: vi.fn(),
    providerSchemas: {},
    providerRuntimeProviders: [],
    activeProvider: null,
    activeProviderParameters: {},
    setProviderParameters: vi.fn(),
    applyProfileProvider: vi.fn(),
    applySelectedRepositoryProvider: vi.fn(),
    executionHistory: [],
    savePublishRecord: vi.fn(),
    isPublishing: false,
    isCancellingPublish: false,
    publishResult: null,
    releaseChecklistOpen: false,
    setReleaseChecklistOpen: vi.fn(),
    artifactActionState: { packageResult: null, signResult: null },
    setArtifactActionState: vi.fn(),
    ...overrides,
  } as Parameters<typeof usePublishBoot>[0];
}

describe("usePublishBoot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.profilesList = [];
    mocks.storePublishResult = null;
    mocks.runnerArgs = {};
    mocks.commandImportArgs = {};
    mocks.activeProviderUsesProjectFile = false;
    mocks.activeImportFeedback = null;
  });

  it("exposes draft selection parameters for hydration", () => {
    const { result } = renderHook(() =>
      usePublishBoot(
        params({
          selectedRepo: repoWithSelection({
            kind: "draft",
            providerId: "dotnet",
            projectBinding: null,
          }),
        })
      )
    );

    expect(result.current.selectionParameters).toEqual({
      outputDir: "/draft-out",
    });
  });

  it("exposes revision selection parameters from the scoped profile", () => {
    const { result } = renderHook(() =>
      usePublishBoot(
        params({
          selectedRepo: repoWithSelection({
            kind: "revision",
            configurationId: "cfg-1",
          }),
        })
      )
    );

    expect(result.current.selectionParameters).toEqual({
      outputDir: "/profile-out",
    });
  });

  it("returns null selection parameters without a selection", () => {
    const { result } = renderHook(() => usePublishBoot(params()));

    expect(result.current.selectionParameters).toBeNull();
  });

  it("passes the selected configuration revision to the runner", () => {
    mocks.profilesList = [{ id: "cfg-1", revisionId: "rev-1" }] as never;
    renderHook(() =>
      usePublishBoot(
        params({
          selectedRepo: repoWithSelection({
            kind: "revision",
            configurationId: "cfg-1",
          }),
        })
      )
    );

    expect(mocks.runnerArgs.configurationRevisionId).toBe("rev-1");
    expect(mocks.runnerArgs.selectionKey).toBe("userprofile:cfg-1");
  });

  it("saves a profile composition then reloads profiles", async () => {
    const { result } = renderHook(() => usePublishBoot(params()));
    const profile = {
      id: "cfg-1",
      name: "Release",
      providerId: "dotnet",
      parameters: {},
    };
    const composition = { executionBackend: {}, artifactStore: {} };

    await act(async () => {
      await result.current.publishConfigPanelProps.onSaveProfileComposition(
        profile as never,
        composition as never
      );
    });

    expect(mocks.updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        repoId: "repo-1",
        profileId: "cfg-1",
        name: "Release",
        providerId: "dotnet",
        composition,
      })
    );
    expect(mocks.loadProfiles).toHaveBeenCalled();
  });

  it("skips composition save when no repo is selected", async () => {
    const { result } = renderHook(() =>
      usePublishBoot(params({ selectedRepoId: null, selectedRepo: null }))
    );

    await act(async () => {
      await result.current.publishConfigPanelProps.onSaveProfileComposition(
        { id: "cfg-1" } as never,
        {} as never
      );
    });

    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });

  it("rebinds a profile project then reloads profiles", async () => {
    const { result } = renderHook(() => usePublishBoot(params()));

    await act(async () => {
      await result.current.publishConfigPanelProps.onRebindProfileProject({
        id: "cfg-1",
      } as never);
    });

    expect(mocks.rebindProfileProject).toHaveBeenCalledWith({
      repoId: "repo-1",
      profileId: "cfg-1",
    });
    expect(mocks.loadProfiles).toHaveBeenCalled();
  });

  it("only loads the diagnostics section in history view with a repo", () => {
    const { result, rerender } = renderHook((props) => usePublishBoot(props), {
      initialProps: params(),
    });

    expect(result.current.shouldLoadDiagnosticsSection).toBe(false);

    rerender(params({ rightPanelView: "history" }));
    expect(result.current.shouldLoadDiagnosticsSection).toBe(true);
    expect(result.current.diagnosticsSectionProps).not.toBeNull();

    rerender(params({ rightPanelView: "history", selectedRepo: null }));
    expect(result.current.shouldLoadDiagnosticsSection).toBe(false);
    expect(result.current.diagnosticsSectionProps).toBeNull();
  });

  it("drops artifact state updates when the publish result went stale", () => {
    const publishResult = { id: "run-1" };
    const setArtifactActionState = vi.fn();
    const { result, rerender } = renderHook((props) => usePublishBoot(props), {
      initialProps: params({
        publishResult,
        setArtifactActionState,
      }),
    });

    mocks.storePublishResult = publishResult;
    act(() => {
      result.current.publishRunCardProps.onArtifactStateChange?.({
        packageResult: { ok: true },
      } as never);
    });
    expect(setArtifactActionState).toHaveBeenCalledTimes(1);

    // A newer publish result replaces the one this card captured.
    mocks.storePublishResult = { id: "run-2" };
    rerender(params({ publishResult, setArtifactActionState }));
    act(() => {
      result.current.publishRunCardProps.onArtifactStateChange?.({
        packageResult: { ok: true },
      } as never);
    });
    expect(setArtifactActionState).toHaveBeenCalledTimes(1);
  });

  it("routes panel edit to the quick-edit dialog", () => {
    const { result } = renderHook(() => usePublishBoot(params()));
    const profile = { id: "cfg-1" };

    act(() => {
      result.current.publishConfigPanelProps.onEditProfile(profile as never);
    });

    expect(mocks.openQuickEditProfileDialog).toHaveBeenCalledWith(profile);
  });

  it("skips project rebind when no repo is selected", async () => {
    const { result } = renderHook(() =>
      usePublishBoot(params({ selectedRepoId: null, selectedRepo: null }))
    );

    await act(async () => {
      await result.current.publishConfigPanelProps.onRebindProfileProject({
        id: "cfg-1",
      } as never);
    });

    expect(mocks.rebindProfileProject).not.toHaveBeenCalled();
  });

  it("derives selection keys for project-profile, template, and draft", () => {
    const { result, rerender } = renderHook((props) => usePublishBoot(props), {
      initialProps: params({
        selectedRepo: repoWithSelection({
          kind: "projectProfile",
          providerId: "dotnet",
          reference: "Release",
        }),
      }),
    });
    expect(mocks.runnerArgs.selectionKey).toBe("profile-Release");

    rerender(
      params({
        selectedRepo: repoWithSelection({
          kind: "template",
          providerId: "dotnet",
          templateId: "tmpl-1",
        }),
      })
    );
    expect(mocks.runnerArgs.selectionKey).toBe("tmpl-1");

    rerender(
      params({
        selectedRepo: repoWithSelection({
          kind: "draft",
          providerId: "dotnet",
          projectBinding: null,
        }),
      })
    );
    expect(mocks.runnerArgs.selectionKey).toBe("custom");
    expect(result.current.selectionParameters).toEqual({
      outputDir: "/draft-out",
    });
  });

  it("falls back to empty parameters when the scoped draft lacks them", () => {
    const repo = repoWithSelection({
      kind: "draft",
      providerId: "dotnet",
      projectBinding: null,
    });
    (
      repo.publishConfig.drafts[0].content as Record<string, unknown>
    ).parameters = undefined;

    const { result } = renderHook(() =>
      usePublishBoot(params({ selectedRepo: repo }))
    );

    expect(result.current.selectionParameters).toEqual({});
  });

  it("returns null parameters when the scoped profile is absent or empty", () => {
    const missing = repoWithSelection({
      kind: "revision",
      configurationId: "no-such-cfg",
    });
    const { result, rerender } = renderHook((props) => usePublishBoot(props), {
      initialProps: params({ selectedRepo: missing }),
    });

    expect(result.current.selectionParameters).toBeNull();

    const noParams = repoWithSelection({
      kind: "revision",
      configurationId: "cfg-1",
    });
    (
      noParams.publishConfig.profiles[0] as unknown as Record<string, unknown>
    ).parameters = undefined;
    rerender(params({ selectedRepo: noParams }));

    expect(result.current.selectionParameters).toEqual({});

    const noProfiles = repoWithSelection({
      kind: "revision",
      configurationId: "cfg-1",
    });
    delete (noProfiles.publishConfig as unknown as Record<string, unknown>)
      .profiles;
    rerender(params({ selectedRepo: noProfiles }));
    expect(result.current.selectionParameters).toBeNull();
  });

  it("returns null selection parameters when the scoped draft is missing", () => {
    const { result } = renderHook(() =>
      usePublishBoot(
        params({
          selectedRepo: repoWithSelection({
            kind: "draft",
            providerId: "other-provider",
            projectBinding: null,
          }),
        })
      )
    );

    expect(result.current.selectionParameters).toBeNull();
  });

  it("routes command import results into the quick-create dialog", () => {
    renderHook(() => usePublishBoot(params()));

    act(() => {
      (mocks.commandImportArgs.onImportDraft as (result: unknown) => void)?.({
        providerId: "dotnet",
        parameters: { x: 1 },
      });
    });

    expect(mocks.openQuickCreateProfileDialog).toHaveBeenCalledWith({
      providerId: "dotnet",
      parameters: { x: 1 },
    });
  });

  it("flags project-profile and run-card refreshing only for project-file providers", () => {
    mocks.activeProviderUsesProjectFile = true;
    const { result } = renderHook(() =>
      usePublishBoot(params({ isProjectInfoRefreshing: true }))
    );

    expect(result.current.isProjectProfilesRefreshing).toBe(true);
    expect(result.current.publishRunCardProps.isRefreshing).toBe(true);
  });

  it("opens the release checklist from the run card", () => {
    const setReleaseChecklistOpen = vi.fn();
    const { result } = renderHook(() =>
      usePublishBoot(params({ setReleaseChecklistOpen }))
    );

    act(() => {
      result.current.publishRunCardProps.onOpenReleaseChecklist?.();
    });

    expect(setReleaseChecklistOpen).toHaveBeenCalledWith(true);
  });

  it("builds the import result card props when feedback is active", () => {
    mocks.activeImportFeedback = { kind: "success", command: "dotnet publish" };
    const { result } = renderHook(() => usePublishBoot(params()));

    expect(result.current.commandImportResultCardProps).toMatchObject({
      activeImportFeedback: {
        kind: "success",
        command: "dotnet publish",
      },
      providerLabel: "dotnet",
    });
    expect(result.current.showCommandImportResultCard).toBe(true);
  });

  it("wires panel collapse, expand, and config-dialog callbacks", () => {
    const setMiddlePanelCollapsed = vi.fn();
    const setLeftPanelCollapsed = vi.fn();
    const handleConfigDialogOpenChange = vi.fn();
    const { result } = renderHook(() =>
      usePublishBoot(
        params({
          setMiddlePanelCollapsed,
          setLeftPanelCollapsed,
          handleConfigDialogOpenChange,
        })
      )
    );

    act(() => {
      result.current.publishConfigPanelProps.onCollapse?.();
      result.current.publishConfigPanelProps.onExpandRepo?.();
      result.current.publishConfigPanelProps.onOpenConfigDialog?.();
    });

    expect(setMiddlePanelCollapsed).toHaveBeenCalledWith(true);
    expect(setLeftPanelCollapsed).toHaveBeenCalledWith(false);
    expect(handleConfigDialogOpenChange).toHaveBeenCalledWith(true);
  });
});
