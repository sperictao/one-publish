import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useAppDialogsProps } from "@/hooks/useAppDialogsProps";
import type { ProviderManifest } from "@/lib/store/types";

function params(overrides: Record<string, unknown> = {}) {
  return {
    shortcutsOpen: false,
    setShortcutsOpen: vi.fn(),
    environmentDialogOpen: false,
    handleEnvironmentDialogOpenChange: vi.fn(),
    environmentDefaultProviderIds: ["dotnet"],
    environmentInitialCheck: null,
    setEnvironmentLastCheck: vi.fn(),
    settingsOpen: false,
    setSettingsOpen: vi.fn(),
    language: "zh",
    handleLanguageChange: vi.fn(),
    minimizeToTrayOnClose: false,
    setMinimizeToTrayOnClose: vi.fn(),
    defaultOutputDir: "",
    setDefaultOutputDir: vi.fn(),
    executionHistoryLimit: 50,
    setExecutionHistoryLimit: vi.fn(),
    environmentProviderIds: ["dotnet"],
    setEnvironmentProviderIds: vi.fn(),
    theme: "light",
    setTheme: vi.fn(),
    handleConfigDialogOpenChange: vi.fn(),
    environmentStatus: "unknown",
    environmentLastCheck: null,
    environmentSettingsInitialCheck: null,
    currentProviderEnvironmentResult: null,
    availableProviders: [],
    activeProvider: null,
    activeProviderId: "dotnet",
    updaterState: {} as never,
    checkForUpdates: vi.fn(),
    installAvailableUpdate: vi.fn(),
    openUpdaterHelpTarget: vi.fn(),
    releaseChecklistOpen: false,
    setReleaseChecklistOpen: vi.fn(),
    publishResult: null,
    packageResult: null,
    signResult: null,
    openEnvironmentDialog: vi.fn(),
    handleOpenSettings: vi.fn(),
    selectedRepoExists: false,
    commandImportProjectPath: "/repo/app",
    commandImportOpen: false,
    setCommandImportOpen: vi.fn(),
    handleCommandImport: vi.fn(),
    quickCreateProfileOpen: false,
    quickCreateTemplateId: "t-1",
    quickCreateTemplateOptions: [],
    quickCreateProfileName: "",
    quickCreateProfileGroup: "default",
    quickCreateProfileGroupOptions: [],
    quickCreateProfileCustomGroup: "",
    quickCreateProfileDraft: {} as never,
    quickCreateProfileSaving: false,
    quickCreateEditing: false,
    quickCreateViewing: false,
    providerSchemas: {},
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
    updateQuickCreateProfileParameter: vi.fn(),
    handleQuickCreateProfileSave: vi.fn(),
    configDialogOpen: false,
    profileManagement: {} as never,
    handleLoadProfile: vi.fn(),
    selectedRepoId: null,
    currentConfigParameters: {},
    ...overrides,
  } as Parameters<typeof useAppDialogsProps>[0];
}

describe("useAppDialogsProps", () => {
  it("disables command import without a repo or provider support", () => {
    const { result } = renderHook(() =>
      useAppDialogsProps(params({ selectedRepoExists: false }))
    );
    expect(result.current.commandImport.enabled).toBe(false);
  });

  it("enables command import only with repo and provider support", () => {
    const activeProvider = {
      supportsCommandImport: true,
    } as unknown as ProviderManifest;
    const { result } = renderHook(() =>
      useAppDialogsProps(params({ selectedRepoExists: true, activeProvider }))
    );
    expect(result.current.commandImport.enabled).toBe(true);
  });

  it("disables command import when the provider lacks support", () => {
    const activeProvider = {
      supportsCommandImport: false,
    } as unknown as ProviderManifest;
    const { result } = renderHook(() =>
      useAppDialogsProps(params({ selectedRepoExists: true, activeProvider }))
    );
    expect(result.current.commandImport.enabled).toBe(false);
  });

  it("opens the environment dialog scoped to the active provider", () => {
    const openEnvironmentDialog = vi.fn();
    const environmentLastCheck = { providerIds: ["dotnet"], result: {} };
    const { result } = renderHook(() =>
      useAppDialogsProps(
        params({
          openEnvironmentDialog,
          environmentLastCheck,
          activeProviderId: "dotnet",
        })
      )
    );

    result.current.release.onOpenEnvironment();

    expect(openEnvironmentDialog).toHaveBeenCalledWith(environmentLastCheck, [
      "dotnet",
    ]);
  });

  it("exposes the environment checked_at timestamp", () => {
    const currentProviderEnvironmentResult = {
      checked_at: "2026-01-01T00:00:00Z",
    };
    const { result } = renderHook(() =>
      useAppDialogsProps(params({ currentProviderEnvironmentResult }))
    );

    expect(result.current.settings.environmentCheckedAt).toBe(
      "2026-01-01T00:00:00Z"
    );
  });

  it("opens shortcuts from the settings dialog", () => {
    const setShortcutsOpen = vi.fn();
    const { result } = renderHook(() =>
      useAppDialogsProps(params({ setShortcutsOpen }))
    );

    result.current.settings.onOpenShortcuts();

    expect(setShortcutsOpen).toHaveBeenCalledWith(true);
  });
});
