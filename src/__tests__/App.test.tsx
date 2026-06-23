import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

// ── Mocks ───────────────────────────────────────────────────────
// App.tsx only directly imports useAppBoot and a few
// layout components. Mock useAppBoot as the single seam and keep
// component mocks as lightweight testid wrappers.

const { mockUseAppBoot } = vi.hoisted(() => ({
  mockUseAppBoot: vi.fn(),
}));

vi.mock("@/hooks/useTheme", () => ({
  useTheme: () => undefined,
}));

vi.mock("@/hooks/useAppBoot", () => ({
  useAppBoot: mockUseAppBoot,
}));

vi.mock("@/components/layout/ResizeHandle", () => ({
  ResizeHandle: () => <div data-testid="resize-handle" />,
}));

vi.mock("@/components/layout/SidebarPanelShell", () => ({
  SidebarPanelShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/layout/ProviderRuntimeBanner", () => ({
  ProviderRuntimeBanner: () => <div data-testid="provider-runtime-banner" />,
}));

// Lazy-loaded via React.lazy — must be mocked as simple elements
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

// ── Helpers ─────────────────────────────────────────────────────

const noop = () => {};

/**
 * Returns a minimal but structurally-correct boot state that satisfies
 * every property access in App.tsx's loaded branch.  Only the fields
 * actually read by App.tsx are included; the rest can stay undefined
 * since mocked components do not read them.
 */
function makeBoot() {
  return {
    shell: {
      isStateLoading: false,
      appT: { loading: "加载中...", retryAction: "重试" },
      leftPanelCollapsed: false,
      middlePanelCollapsed: false,
      effectiveLeftPanelWidth: 220,
      effectiveMiddlePanelWidth: 280,
      handleLeftPanelResize: noop,
      handleMiddlePanelResize: noop,
      rightPanelView: "home",
      setLeftPanelCollapsed: noop,
      setMiddlePanelCollapsed: noop,
      setRightPanelView: noop,
      handleOpenSettings: noop,
      setShortcutsOpen: noop,
      handleEnvironmentDialogOpenChange: noop,
      environmentDefaultProviderIds: [],
      environmentInitialCheck: null,
      settingsOpen: false,
      setSettingsOpen: noop,
      language: "zh",
      handleLanguageChange: noop,
      minimizeToTrayOnClose: true,
      setMinimizeToTrayOnClose: noop,
      defaultOutputDir: "",
      setDefaultOutputDir: noop,
      executionHistoryLimit: 20,
      setExecutionHistoryLimit: noop,
      environmentProviderIds: ["dotnet"],
      setEnvironmentProviderIds: noop,
      theme: "auto",
      setTheme: noop,
      handleConfigDialogOpenChange: noop,
      translations: { configPanel: {} },
      updaterState: {
        currentVersion: "0.3.2",
        updateInfo: null,
        updaterHelpPaths: null,
        updaterConfigHealth: null,
        isRestartRequired: false,
        isCheckingUpdate: false,
        isInstallingUpdate: false,
        isOpeningUpdaterHelp: false,
        downloadProgress: { stage: "idle", version: null, downloadedBytes: 0, totalBytes: null, percent: null, attempt: 0, maxAttempts: 0, message: null },
      },
      checkForUpdates: noop,
      installAvailableUpdate: noop,
      openUpdaterHelpTarget: noop,
      rerunT: {},
      profileT: {},
      configDialogOpen: false,
      commandImportOpen: false,
      setCommandImportOpen: noop,
      shouldLoadAppDialogsHost: false,
    },
    repo: {
      repositories: [],
      selectedRepoId: null,
      repositoryProviders: [],
      selectRepository: noop,
      handleAddRepo: noop,
      handleOpenRepoDirectory: noop,
      handleEditRepo: noop,
      handleRemoveRepo: noop,
      handleDetectRepoProvider: noop,
      handleScanProjectCandidates: noop,
      handleRefreshRepoBranches: noop,
      branchConnectivityByRepoId: {},
      reorderRepositories: noop,
      setEnvironmentLastCheck: noop,
      environmentLastCheck: null,
      selectedRepo: null,
    },
    publish: {
      providerRuntimeBanner: null,
      publishConfigPanelProps: {},
      showCommandImportResultCard: false,
      commandImportResultCardProps: null,
      publishRunCardProps: null,
      shouldLoadDiagnosticsSection: false,
      diagnosticsSectionProps: null,
      isRerunChecklistEnabled: false,
      setIsRerunChecklistEnabled: noop,
      activeProviderId: "dotnet",
      activeProviderUsesProjectFile: true,
      activeProvider: null,
      providerRuntimeProviders: [],
      rerunChecklistOpen: false,
      pendingRerunRecord: null,
      rerunChecklistState: null,
      setRerunChecklistOpen: noop,
      setRerunChecklistState: noop,
      closeRerunChecklistDialog: noop,
      confirmRerunWithChecklist: noop,
      releaseChecklistOpen: false,
      setReleaseChecklistOpen: noop,
      publishResult: null,
      artifactActionState: { packageResult: null, signResult: null },
      handleCommandImport: noop,
      quickCreateProfileOpen: false,
    },
  };
}

// ── Tests ───────────────────────────────────────────────────────

describe("App", () => {
  it("shows loading spinner when isStateLoading is true", () => {
    const loadingBoot = makeBoot();
    loadingBoot.shell.isStateLoading = true;
    mockUseAppBoot.mockReturnValue(loadingBoot);

    render(<App />);

    expect(screen.getByText("加载中...")).toBeInTheDocument();
  });

  it("renders three-column layout with all panels when loaded", async () => {
    mockUseAppBoot.mockReturnValue(makeBoot());

    render(<App />);

    // All three panels are lazy-loaded via Suspense — use waitFor for reliability
    await waitFor(() => {
      expect(screen.getByTestId("repository-list")).toBeInTheDocument();
      expect(screen.getByTestId("publish-config-panel")).toBeInTheDocument();
      expect(screen.getByTestId("publish-content-section")).toBeInTheDocument();
    });
  });

  it("renders two resize handles when panels are not collapsed", async () => {
    mockUseAppBoot.mockReturnValue(makeBoot());

    render(<App />);

    // Resize handles are direct imports (not lazy) — available immediately
    const handles = screen.getAllByTestId("resize-handle");
    expect(handles).toHaveLength(2);
  });
});
