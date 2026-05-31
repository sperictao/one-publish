import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useEnvironmentStatus: vi.fn(() => "ready"),
  useDialogDerivedState: vi.fn(() => ({
    commandImportProjectPath: "/repo/App.csproj",
    currentConfigParameters: { configuration: "Release" },
  })),
}));

vi.mock("@/features/environment/useEnvironmentStatus", () => ({
  useEnvironmentStatus: mocks.useEnvironmentStatus,
}));

vi.mock("@/hooks/useDialogDerivedState", () => ({
  useDialogDerivedState: mocks.useDialogDerivedState,
}));

import { createEnvironmentCheckSnapshot } from "@/features/environment/environment";
import { defaultPublishConfigStore } from "@/lib/store/types";
import { useDialogsCompositionState } from "@/hooks/useDialogsCompositionState";

describe("useDialogsCompositionState", () => {
  it("按分组返回对话框 props，并对齐环境快照作用域", () => {
    const snapshot = createEnvironmentCheckSnapshot(
      {
        is_ready: true,
        checked_at: "2026-04-02T10:00:00Z",
        providers: [
          {
            provider_id: "dotnet",
            installed: true,
          },
        ],
        issues: [],
      },
      ["dotnet"]
    );

    const { result } = renderHook(() =>
      useDialogsCompositionState({
        shortcutsOpen: false,
        setShortcutsOpen: vi.fn(),
        environmentDialogOpen: false,
        handleEnvironmentDialogOpenChange: vi.fn(),
        environmentDefaultProviderIds: ["dotnet"],
        environmentInitialCheck: snapshot,
        setEnvironmentLastCheck: vi.fn(),
        settingsOpen: true,
        setSettingsOpen: vi.fn(),
        language: "zh",
        handleLanguageChange: vi.fn(),
        minimizeToTrayOnClose: true,
        setMinimizeToTrayOnClose: vi.fn(),
        defaultOutputDir: "/exports",
        setDefaultOutputDir: vi.fn(),
        executionHistoryLimit: 20,
        setExecutionHistoryLimit: vi.fn(),
        environmentProviderIds: ["dotnet"],
        setEnvironmentProviderIds: vi.fn(),
        isRerunChecklistEnabled: true,
        setIsRerunChecklistEnabled: vi.fn(),
        theme: "auto",
        setTheme: vi.fn(),
        handleConfigDialogOpenChange: vi.fn(),
        environmentLastCheck: snapshot,
        openEnvironmentDialog: vi.fn(),
        activeProviderId: "dotnet",
        activeProviderUsesProjectFile: true,
        activeProvider: {
          id: "dotnet",
          displayName: ".NET (dotnet)",
          version: "1.0.0",
          label: ".NET (dotnet)",
          commandExample: "dotnet publish App.csproj",
          environmentLabel: ".NET",
          environmentDescription: "dotnet SDK",
          requiresProjectBinding: true,
          projectPathKind: "project_file",
          supportsCommandImport: true,
        },
        availableProviders: [
          {
            id: "dotnet",
            displayName: ".NET (dotnet)",
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
        updaterState: {
          currentVersion: null,
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
        checkForUpdates: vi.fn(),
        installAvailableUpdate: vi.fn(),
        openUpdaterHelpTarget: vi.fn(),
        rerunChecklistOpen: false,
        pendingRerunRecord: null,
        selectedRepoCurrentBranch: "main",
        rerunChecklistState: {
          branch: true,
          environment: true,
          output: true,
        },
        rerunT: {},
        setRerunChecklistOpen: vi.fn(),
        setRerunChecklistState: vi.fn(),
        closeRerunChecklistDialog: vi.fn(),
        confirmRerunWithChecklist: vi.fn(),
        releaseChecklistOpen: false,
        setReleaseChecklistOpen: vi.fn(),
        publishResult: null,
        packageResult: null,
        signResult: null,
        handleOpenSettings: vi.fn(),
        selectedRepoExists: true,
        commandImportOpen: false,
        setCommandImportOpen: vi.fn(),
        handleCommandImport: vi.fn(),
        quickCreateProfileOpen: false,
        quickCreateTemplateId: "default",
        quickCreateTemplateOptions: [],
        quickCreateProfileName: "",
        quickCreateProfileGroup: "",
        quickCreateProfileGroupOptions: [],
        quickCreateProfileCustomGroup: "",
        quickCreateProfileDraft: { ...defaultPublishConfigStore },
        projectFrameworkOptions: ["net8.0"],
        quickCreateProfileSaving: false,
        quickCreateEditing: false,
        dotnetSchema: undefined,
        quickCreateGroupDefaultValue: "default",
        quickCreateGroupCustomValue: "custom",
        profileT: {},
        appT: {},
        cancelLabel: "取消",
        handleQuickCreateProfileOpenChange: vi.fn(),
        applyQuickCreateTemplate: vi.fn(),
        setQuickCreateProfileName: vi.fn(),
        setQuickCreateProfileGroup: vi.fn(),
        setQuickCreateProfileCustomGroup: vi.fn(),
        updateQuickCreateProfileDraft: vi.fn(),
        handleQuickCreateProfileSave: vi.fn(),
        configDialogOpen: false,
        profileManagement: {
          profiles: [],
          isRefreshing: false,
          refreshProfiles: vi.fn(),
          saveProfile: vi.fn(),
          deleteProfile: vi.fn(),
          exportProfiles: vi.fn(),
          applyImportedProfiles: vi.fn(),
        },
        handleLoadProfile: vi.fn(),
        selectedRepoId: "repo-1",
        customConfig: { ...defaultPublishConfigStore },
        activeProviderParameters: { configuration: "Release" },
        projectFile: "/repo/App.csproj",
        selectedRepoPath: "/repo",
      })
    );

    expect(result.current.appDialogsProps.settings.environmentInitialCheck).toEqual(
      snapshot
    );
    expect(result.current.appDialogsProps.release.environmentResult?.checked_at).toBe(
      "2026-04-02T10:00:00Z"
    );
    expect(result.current.appDialogsProps.commandImport.projectPath).toBe(
      "/repo/App.csproj"
    );
    expect(mocks.useDialogDerivedState).toHaveBeenCalledWith(
      expect.objectContaining({
        activeProviderUsesProjectFile: true,
      })
    );
  });
});
