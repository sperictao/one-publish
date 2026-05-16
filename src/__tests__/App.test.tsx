import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  noop: vi.fn(),
}));

vi.mock("@/hooks/useAppState", async () => {
  const React = await import("react");

  return {
    useAppState: () => {
      const [isLoading, setIsLoading] = React.useState(true);

      React.useEffect(() => {
        const timer = window.setTimeout(() => {
          setIsLoading(false);
        }, 0);

        return () => {
          window.clearTimeout(timer);
        };
      }, []);

      return {
        state: null,
        isLoading,
        error: null,
        repositories: [],
        selectedRepoId: null,
        recentRepoIds: [],
        recentConfigKeysByRepo: {},
        addRepository: mocks.noop,
        removeRepository: mocks.noop,
        updateRepository: mocks.noop,
        selectRepository: mocks.noop,
        pushRecentPublishConfig: mocks.noop,
        removeRecentPublishConfig: mocks.noop,
        replaceRecentPublishConfigKey: mocks.noop,
        leftPanelWidth: 220,
        middlePanelWidth: 280,
        panelWidthsCustomized: false,
        setLeftPanelWidth: mocks.noop,
        setMiddlePanelWidth: mocks.noop,
        selectedPreset: "release-fd",
        isCustomMode: false,
        customConfig: {
          configuration: "Release",
          runtime: "",
          framework: "",
          selfContained: false,
          outputDir: "",
          noBuild: false,
          noRestore: false,
          verbosity: "",
          noLogo: false,
          properties: {},
          define: [],
          useProfile: false,
          profileName: "",
        },
        setSelectedPreset: mocks.noop,
        setIsCustomMode: mocks.noop,
        setCustomConfig: mocks.noop,
        language: "zh",
        minimizeToTrayOnClose: true,
        defaultOutputDir: "",
        theme: "auto" as const,
        executionHistoryLimit: 20,
        environmentProviderIds: ["dotnet"],
        startupNotice: null,
        setLanguage: mocks.noop,
        setMinimizeToTrayOnClose: mocks.noop,
        setDefaultOutputDir: mocks.noop,
        setTheme: mocks.noop,
        setExecutionHistoryLimit: mocks.noop,
        setEnvironmentProviderIds: mocks.noop,
      };
    },
  };
});

vi.mock("@/hooks/useTheme", () => ({
  useTheme: () => undefined,
}));

vi.mock("@/hooks/useShortcuts", () => ({
  useShortcuts: () => undefined,
}));

vi.mock("@/hooks/useAppDialogs", () => ({
  useAppDialogs: () => ({
    settingsOpen: false,
    setSettingsOpen: mocks.noop,
    shortcutsOpen: false,
    setShortcutsOpen: mocks.noop,
    commandImportOpen: false,
    setCommandImportOpen: mocks.noop,
    configDialogOpen: false,
    environmentDialogOpen: false,
    environmentDefaultProviderIds: [],
    environmentInitialCheck: null,
    handleOpenSettings: mocks.noop,
    openEnvironmentDialog: mocks.noop,
    handleEnvironmentDialogOpenChange: mocks.noop,
    handleConfigDialogOpenChange: mocks.noop,
  }),
}));

vi.mock("@/hooks/useDiagnosticsUiState", () => ({
  useDiagnosticsUiState: () => ({
    environmentLastCheck: null,
    setEnvironmentLastCheck: mocks.noop,
    recentHistoryExports: [],
    trackHistoryExport: mocks.noop,
  }),
}));

vi.mock("@/hooks/useLayoutShellState", () => ({
  useLayoutShellState: () => ({
    leftPanelCollapsed: false,
    setLeftPanelCollapsed: mocks.noop,
    middlePanelCollapsed: false,
    setMiddlePanelCollapsed: mocks.noop,
    effectiveLeftPanelWidth: 220,
    effectiveMiddlePanelWidth: 280,
    handleLeftPanelResize: mocks.noop,
    handleMiddlePanelResize: mocks.noop,
  }),
}));

vi.mock("@/hooks/usePublishHistoryState", () => ({
  usePublishHistoryState: () => ({
    isRerunChecklistEnabled: false,
    setIsRerunChecklistEnabled: mocks.noop,
    executionHistory: [],
    setExecutionHistory: mocks.noop,
    savePublishRecord: mocks.noop,
  }),
}));

vi.mock("@/hooks/useProjectShellState", () => ({
  useProjectShellState: () => ({
    projectInfo: null,
    isProjectInfoRefreshing: false,
    setProjectInfo: mocks.noop,
    scanProject: mocks.noop,
  }),
}));

vi.mock("@/hooks/useProviderPresentationState", () => ({
  useProviderPresentationState: () => ({
    activeProviderLabel: "dotnet",
    activeProviderUsesProjectFile: true,
    activeProviderRequiresProjectBinding: true,
    repositoryProviders: [],
    providerRuntimeBanner: null,
  }),
}));

vi.mock("@/hooks/useRepositoryActions", () => ({
  useRepositoryActions: () => ({
    handleAddRepo: mocks.noop,
    handleRemoveRepo: mocks.noop,
    handleEditRepo: mocks.noop,
    handleDetectRepoProvider: mocks.noop,
    handleScanProjectCandidates: mocks.noop,
    handleRefreshRepoBranches: mocks.noop,
  }),
}));

vi.mock("@/hooks/useRepositoryViewState", () => ({
  useRepositoryViewState: () => ({
    selectedRepo: null,
    branchConnectivityByRepoId: {},
  }),
}));

vi.mock("@/hooks/useRecoverableSpec", () => ({
  useRecoverableSpec: () => ({
    extractSpecFromRecord: mocks.noop,
    restoreSpecToEditor: mocks.noop,
    getRecentConfigKeyFromSpec: mocks.noop,
  }),
}));

vi.mock("@/hooks/useRerunFlow", () => ({
  useRerunFlow: () => ({
    rerunChecklistOpen: false,
    setRerunChecklistOpen: mocks.noop,
    pendingRerunRecord: null,
    rerunChecklistState: null,
    setRerunChecklistState: mocks.noop,
    rerunFromHistory: mocks.noop,
    closeRerunChecklistDialog: mocks.noop,
    confirmRerunWithChecklist: mocks.noop,
  }),
}));

vi.mock("@/hooks/usePresetText", () => ({
  usePresetText: () => ({
    getPresetText: (presetId: string, fallbackName: string, fallbackDescription: string) => ({
      id: presetId,
      name: fallbackName,
      description: fallbackDescription,
    }),
  }),
}));

vi.mock("@/hooks/usePublishRunner", () => ({
  usePublishRunner: () => ({
    outputLog: "",
    isResolvingSelectedProjectProfile: false,
    publishPreviewCommand: null,
    runPublishSpec: mocks.noop,
    startPublish: mocks.noop,
    cancelPublish: mocks.noop,
  }),
}));

vi.mock("@/hooks/useTrayRecentPublish", () => ({
  useTrayRecentPublish: () => undefined,
}));

vi.mock("@/hooks/useProfiles", () => ({
  QUICK_CREATE_PROFILE_GROUP_CUSTOM: "__custom__",
  QUICK_CREATE_PROFILE_GROUP_DEFAULT: "__default__",
  useProfiles: () => ({
    profiles: [],
    isProfilesRefreshing: false,
    activeProfileName: null,
    quickCreateProfileOpen: false,
    quickCreateProfileName: "",
    setQuickCreateProfileName: mocks.noop,
    quickCreateTemplateId: "custom",
    quickCreateProfileDraft: null,
    quickCreateProfileGroup: "__default__",
    setQuickCreateProfileGroup: mocks.noop,
    quickCreateProfileCustomGroup: "",
    setQuickCreateProfileCustomGroup: mocks.noop,
    quickCreateProfileSaving: false,
    isQuickCreateEditing: false,
    loadProfiles: mocks.noop,
    openQuickCreateProfileDialog: mocks.noop,
    openQuickEditProfileDialog: mocks.noop,
    handleQuickCreateProfileOpenChange: mocks.noop,
    quickCreateTemplateOptions: [],
    quickCreateProfileGroupOptions: [],
    applyQuickCreateTemplate: mocks.noop,
    updateQuickCreateProfileDraft: mocks.noop,
    handleSelectProjectProfile: mocks.noop,
    handleSelectProfileFromPanel: mocks.noop,
    handleQuickCreateProfileSave: mocks.noop,
    handleDeleteProfileFromPanel: mocks.noop,
    handleLoadProfile: mocks.noop,
    handleCreateProfileFromProjectProfile: mocks.noop,
    handleReorderProfiles: mocks.noop,
    profileManagement: {
      profiles: [],
      isRefreshing: false,
      refreshProfiles: mocks.noop,
      saveProfile: mocks.noop,
      deleteProfile: mocks.noop,
      exportProfiles: mocks.noop,
      applyImportedProfiles: mocks.noop,
    },
  }),
}));

vi.mock("@/hooks/useCommandImport", () => ({
  useCommandImport: () => ({
    activeImportFeedback: null,
    handleCommandImport: mocks.noop,
  }),
}));

vi.mock("@/hooks/useScopedConfigs", () => ({
  useScopedConfigs: () => ({
    recentConfigKeys: [],
    favoriteConfigKeys: [],
    pushRecentConfig: mocks.noop,
    removeRecentConfig: mocks.noop,
    toggleFavoriteConfig: mocks.noop,
    replaceScopedConfigKey: mocks.noop,
  }),
}));

vi.mock("@/hooks/useAppUpdater", () => ({
  useAppUpdater: () => ({
    updaterState: {
      currentVersion: "0.3.2",
      updateInfo: null,
      updaterHelpPaths: null,
      updaterConfigHealth: null,
      isRestartRequired: false,
      isCheckingUpdate: false,
      isInstallingUpdate: false,
      isOpeningUpdaterHelp: false,
      downloadProgress: {
        stage: "idle",
        version: null,
        downloadedBytes: 0,
        totalBytes: null,
        percent: null,
        attempt: 0,
        maxAttempts: 0,
        message: null,
      },
    },
    checkForUpdates: mocks.noop,
    installAvailableUpdate: mocks.noop,
    openUpdaterHelpTarget: mocks.noop,
  }),
}));

vi.mock("@/hooks/useCommandImportResultCardProps", () => ({
  useCommandImportResultCardProps: () => null,
}));

vi.mock("@/hooks/useProviderRuntime", () => ({
  useProviderRuntime: () => ({
    activeProviderId: "dotnet",
    setActiveProviderId: mocks.noop,
    providerListState: {
      status: "ready",
      data: [
        {
          id: "dotnet",
          displayName: ".NET",
          version: "1.0.0",
          label: ".NET (dotnet)",
          commandExample: "dotnet publish App.csproj",
          environmentLabel: ".NET",
          environmentDescription: "dotnet SDK",
          requiresProjectBinding: true,
          projectPathKind: "project_file",
          supportsCommandImport: true,
        },
      ],
      error: null,
    },
    activeProviderSchemaState: {
      status: "ready",
      data: null,
      error: null,
    },
    retryProviderList: mocks.noop,
    retryProviderSchema: mocks.noop,
    providerSchemas: {},
    setProviderParameters: mocks.noop,
    availableProviders: [
      {
        id: "dotnet",
        displayName: ".NET",
        version: "1.0.0",
        label: ".NET (dotnet)",
        commandExample: "dotnet publish App.csproj",
        environmentLabel: ".NET",
        environmentDescription: "dotnet SDK",
        requiresProjectBinding: true,
        projectPathKind: "project_file",
        supportsCommandImport: true,
      },
    ],
    activeProvider: {
      id: "dotnet",
      displayName: ".NET",
      version: "1.0.0",
      label: ".NET (dotnet)",
      commandExample: "dotnet publish App.csproj",
      environmentLabel: ".NET",
      environmentDescription: "dotnet SDK",
      requiresProjectBinding: true,
      projectPathKind: "project_file",
      supportsCommandImport: true,
    },
    activeProviderParameters: {},
  }),
}));

vi.mock("@/hooks/useI18n", () => ({
  useI18n: () => ({
    language: "zh",
    setLanguage: mocks.noop,
    t: (key: string) => key,
    translations: {
      app: {
        loading: "加载中...",
        cancelPublish: "取消发布",
        cancelling: "取消中...",
      },
      config: {
        execute: "执行发布",
        publishing: "发布中...",
      },
      publish: {
        command: "将执行的命令:",
      },
      history: {},
      failure: {},
      rerun: {},
      profiles: {},
      configPanel: {},
    },
  }),
}));

vi.mock("@/components/layout/ResizeHandle", () => ({
  ResizeHandle: () => <div data-testid="resize-handle" />,
}));

vi.mock("@/components/layout/SidebarPanelShell", () => ({
  SidebarPanelShell: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/layout/AppDialogsHost", () => ({
  AppDialogsHost: () => <div data-testid="app-dialogs-host" />,
}));

vi.mock("@/components/layout/RepositoryList", () => ({
  RepositoryList: () => <div data-testid="repository-list" />,
}));

vi.mock("@/components/layout/PublishConfigPanel", () => ({
  PublishConfigPanel: () => <div data-testid="publish-config-panel" />,
}));

vi.mock("@/components/layout/PublishContentSection", () => ({
  PublishContentSection: () => <div data-testid="publish-content-section" />,
}));

vi.mock("@/components/layout/MainContentShell", () => ({
  MainContentShell: ({ children }: { children?: ReactNode }) => (
    <div data-testid="main-content-shell">{children}</div>
  ),
}));

import App from "@/App";

beforeAll(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      matches: false,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  );
});

describe("App", () => {
  it("状态从 loading 切到 loaded 时仍能正常完成首屏渲染", async () => {
    render(<App />);

    expect(screen.getByText("加载中...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("repository-list")).toBeInTheDocument();
      expect(screen.getByTestId("publish-config-panel")).toBeInTheDocument();
      expect(screen.getByTestId("publish-content-section")).toBeInTheDocument();
    });
  });
});
