import { useEffect, useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { useAppDialogs } from "@/hooks/useAppDialogs";
import { useTheme, type Theme } from "@/hooks/useTheme";
import { useShortcuts } from "@/hooks/useShortcuts";
import { useLayoutShellState } from "@/hooks/useLayoutShellState";
import { useAppUpdater } from "@/hooks/useAppUpdater";
import { useI18n, type Language } from "@/hooks/useI18n";
import { usePresetText } from "@/hooks/usePresetText";

type RightPanelView = "home" | "history";

interface UseShellBootParams {
  // Persisted state from useAppState
  isStateLoading: boolean;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  preferenceLanguage: string | undefined;
  setPreferenceLanguage: (language: string) => void;
  minimizeToTrayOnClose: boolean;
  setMinimizeToTrayOnClose: (value: boolean) => void;
  defaultOutputDir: string;
  setDefaultOutputDir: (value: string) => void;
  executionHistoryLimit: number;
  setExecutionHistoryLimit: (value: number) => void;
  environmentProviderIds: string[];
  setEnvironmentProviderIds: (value: string[]) => void;
  startupNotice: string | null | undefined;
  leftPanelWidth: number;
  middlePanelWidth: number;
  panelWidthsCustomized: boolean;
  setLeftPanelWidth: (width: number) => void;
  setMiddlePanelWidth: (width: number) => void;

  // Shortcut handler callbacks (built in useAppBoot from cross-domain values)
  onRefreshShortcut?: () => void;
  onPublishShortcut?: () => void;
}

export function useShellBoot(params: UseShellBootParams) {
  const [rightPanelView, setRightPanelView] = useState<RightPanelView>("home");

  // Theme
  useTheme(params.theme);

  // I18n
  const { language, setLanguage: setI18nLanguage, translations } = useI18n();
  const configT = translations.config || {};
  const publishT = translations.publish || {};
  const appT = translations.app || {};
  const historyT = translations.history || {};
  const failureT = translations.failure || {};
  const rerunT = translations.rerun || {};
  const profileT = translations.profiles || {};

  // Preset text
  const { getPresetText } = usePresetText(configT);

  // App updater
  const {
    updaterState,
    checkForUpdates,
    installAvailableUpdate,
    openUpdaterHelpTarget,
  } = useAppUpdater();

  // Language preference sync
  const normalizedPreferenceLanguage: Language =
    params.preferenceLanguage === "en" ? "en" : "zh";

  const handleLanguageChange = useCallback(
    async (nextLanguage: Language) => {
      if (nextLanguage === language) {
        return;
      }
      params.setPreferenceLanguage(nextLanguage);
      await setI18nLanguage(nextLanguage);
    },
    [language, params.setPreferenceLanguage, setI18nLanguage]
  );

  useEffect(() => {
    if (params.isStateLoading || language === normalizedPreferenceLanguage) {
      return;
    }
    void setI18nLanguage(normalizedPreferenceLanguage);
  }, [params.isStateLoading, language, normalizedPreferenceLanguage, setI18nLanguage]);

  // Startup recovery notice
  const shownNoticeRef = useRef<string | null>(null);

  useEffect(() => {
    const nextNotice = params.startupNotice?.trim();
    if (!nextNotice || shownNoticeRef.current === nextNotice) {
      return;
    }
    shownNoticeRef.current = nextNotice;
    toast.warning("已恢复安全配置", {
      description: nextNotice,
    });
  }, [params.startupNotice]);

  // Dialogs
  const {
    settingsOpen,
    setSettingsOpen,
    shortcutsOpen,
    setShortcutsOpen,
    commandImportOpen,
    setCommandImportOpen,
    configDialogOpen,
    environmentDialogOpen,
    environmentDefaultProviderIds,
    environmentInitialCheck,
    handleOpenSettings,
    openEnvironmentDialog,
    handleEnvironmentDialogOpenChange,
    handleConfigDialogOpenChange,
  } = useAppDialogs(params.environmentProviderIds);

  // Keyboard shortcuts
  useShortcuts({
    onRefresh: params.onRefreshShortcut,
    onPublish: params.onPublishShortcut,
    onOpenSettings: () => {
      setSettingsOpen(true);
    },
  });

  // Layout shell state
  const {
    leftPanelCollapsed,
    setLeftPanelCollapsed,
    middlePanelCollapsed,
    setMiddlePanelCollapsed,
    effectiveLeftPanelWidth,
    effectiveMiddlePanelWidth,
    handleLeftPanelResize,
    handleMiddlePanelResize,
  } = useLayoutShellState({
    panelWidthsCustomized: params.panelWidthsCustomized,
    leftPanelWidth: params.leftPanelWidth,
    middlePanelWidth: params.middlePanelWidth,
    setLeftPanelWidth: params.setLeftPanelWidth,
    setMiddlePanelWidth: params.setMiddlePanelWidth,
  });

  // Derived: whether to load the dialogs host
  const shouldLoadAppDialogsHost =
    shortcutsOpen ||
    environmentDialogOpen ||
    settingsOpen ||
    commandImportOpen ||
    configDialogOpen;

  return {
    rightPanelView,
    setRightPanelView,
    isStateLoading: params.isStateLoading,
    leftPanelWidth: params.leftPanelWidth,
    middlePanelWidth: params.middlePanelWidth,
    panelWidthsCustomized: params.panelWidthsCustomized,
    setLeftPanelWidth: params.setLeftPanelWidth,
    setMiddlePanelWidth: params.setMiddlePanelWidth,
    preferenceLanguage: params.preferenceLanguage,
    setPreferenceLanguage: params.setPreferenceLanguage,
    minimizeToTrayOnClose: params.minimizeToTrayOnClose,
    setMinimizeToTrayOnClose: params.setMinimizeToTrayOnClose,
    defaultOutputDir: params.defaultOutputDir,
    setDefaultOutputDir: params.setDefaultOutputDir,
    theme: params.theme,
    setTheme: params.setTheme,
    executionHistoryLimit: params.executionHistoryLimit,
    setExecutionHistoryLimit: params.setExecutionHistoryLimit,
    environmentProviderIds: params.environmentProviderIds,
    setEnvironmentProviderIds: params.setEnvironmentProviderIds,
    startupNotice: params.startupNotice,
    language,
    setI18nLanguage,
    translations,
    configT,
    publishT,
    appT,
    historyT,
    failureT,
    rerunT,
    profileT,
    getPresetText,
    updaterState,
    checkForUpdates,
    installAvailableUpdate,
    openUpdaterHelpTarget,
    normalizedPreferenceLanguage,
    handleLanguageChange,
    settingsOpen,
    setSettingsOpen,
    shortcutsOpen,
    setShortcutsOpen,
    commandImportOpen,
    setCommandImportOpen,
    configDialogOpen,
    environmentDialogOpen,
    environmentDefaultProviderIds,
    environmentInitialCheck,
    handleOpenSettings,
    openEnvironmentDialog,
    handleEnvironmentDialogOpenChange,
    handleConfigDialogOpenChange,
    leftPanelCollapsed,
    setLeftPanelCollapsed,
    middlePanelCollapsed,
    setMiddlePanelCollapsed,
    effectiveLeftPanelWidth,
    effectiveMiddlePanelWidth,
    handleLeftPanelResize,
    handleMiddlePanelResize,
    shouldLoadAppDialogsHost,
  };
}

export type UseShellBootReturn = ReturnType<typeof useShellBoot>;
