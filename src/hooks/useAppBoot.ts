import { useEffect, useCallback, useMemo, useState } from "react";
// Hooks
import { useAppDialogs } from "@/hooks/useAppDialogs";
import { useAppState } from "@/hooks/useAppState";
import { useTheme } from "@/hooks/useTheme";
import { useShortcuts } from "@/hooks/useShortcuts";
import { useDiagnosticsUiState } from "@/hooks/useDiagnosticsUiState";
import { useLayoutShellState } from "@/hooks/useLayoutShellState";
import { usePublishHistoryState } from "@/hooks/usePublishHistoryState";
import { useProjectShellState } from "@/hooks/useProjectShellState";
import { useProviderPresentationState } from "@/hooks/useProviderPresentationState";
import { useRepositoryActions } from "@/hooks/useRepositoryActions";
import { useRepositoryViewState } from "@/hooks/useRepositoryViewState";
import { useRecoverableSpec } from "@/hooks/useRecoverableSpec";
import { useRerunFlow } from "@/hooks/useRerunFlow";
import { useStartupRecoveryNotice } from "@/hooks/useStartupRecoveryNotice";
import { usePresetText } from "@/hooks/usePresetText";
import { usePublishRunner } from "@/hooks/usePublishRunner";
import { useTrayRecentPublish } from "@/hooks/useTrayRecentPublish";
import { useProjectPublishProfileOrder } from "@/hooks/useProjectPublishProfileOrder";
import {
  useProfiles,
  QUICK_CREATE_PROFILE_GROUP_CUSTOM,
  QUICK_CREATE_PROFILE_GROUP_DEFAULT,
} from "@/hooks/useProfiles";
import { useCommandImport } from "@/hooks/useCommandImport";
import { useScopedConfigs } from "@/hooks/useScopedConfigs";
import { useAppUpdater } from "@/hooks/useAppUpdater";
import { useCommandImportResultCardProps } from "@/hooks/useCommandImportResultCardProps";
import { useEditorProviderState } from "@/hooks/useEditorProviderState";
import { useProviderRuntime } from "@/hooks/useProviderRuntime";
import { useProviderParametersState } from "@/hooks/useProviderParametersState";
import { useI18n, type Language } from "@/hooks/useI18n";
import type { PublishConfigStore } from "@/lib/store";
import type { PublishConfigPanelProps } from "@/components/layout/PublishConfigPanel";
import { usePublishStore } from "@/store/publishStore";
import { buildDotnetProfileParameters } from "@/lib/dotnetPublishConfig";
import {
  DEFAULT_DOTNET_PRESET_ID,
  DOTNET_PRESETS,
} from "@/lib/dotnetPresets";

type RightPanelView = "home" | "history";

const SPEC_VERSION = 1;
const EMPTY_STRING_LIST: string[] = [];

export function useAppBoot() {
  const [rightPanelView, setRightPanelView] = useState<RightPanelView>("home");

  // 使用持久化的应用状态
  const {
    isLoading: isStateLoading,
    repositories,
    selectedRepoId,
    recentConfigKeysByRepo,
    addRepository,
    removeRepository,
    updateRepository,
    reorderRepositories,
    selectRepository,
    pushRecentPublishConfig,
    removeRecentPublishConfig,
    reorderRecentPublishConfigs,
    replaceRecentPublishConfigKey,
    leftPanelWidth,
    middlePanelWidth,
    panelWidthsCustomized,
    setLeftPanelWidth,
    setMiddlePanelWidth,
    selectedPreset,
    isCustomMode,
    customConfig,
    setSelectedPreset,
    setIsCustomMode,
    setCustomConfig,
    language: preferenceLanguage,
    minimizeToTrayOnClose,
    defaultOutputDir,
    theme,
    executionHistoryLimit,
    environmentProviderIds,
    startupNotice,
    setMinimizeToTrayOnClose,
    setDefaultOutputDir,
    setTheme,
    setExecutionHistoryLimit,
    setEnvironmentProviderIds,
    setLanguage: setPreferenceLanguage,
  } = useAppState();
  useStartupRecoveryNotice(startupNotice);

  // 应用主题
  useTheme(theme);

  // 国际化
  const { language, setLanguage: setI18nLanguage, translations } = useI18n();
  const configT = translations.config || {};
  const publishT = translations.publish || {};
  const appT = translations.app || {};
  const historyT = translations.history || {};
  const failureT = translations.failure || {};
  const rerunT = translations.rerun || {};
  const profileT = translations.profiles || {};

  const { getPresetText } = usePresetText(configT);
  const {
    updaterState,
    checkForUpdates,
    installAvailableUpdate,
    openUpdaterHelpTarget,
  } = useAppUpdater();

  const normalizedPreferenceLanguage: Language =
    preferenceLanguage === "en" ? "en" : "zh";

  const handleLanguageChange = useCallback(
    async (nextLanguage: Language) => {
      if (nextLanguage === language) {
        return;
      }

      setPreferenceLanguage(nextLanguage);
      await setI18nLanguage(nextLanguage);
    },
    [language, setPreferenceLanguage, setI18nLanguage]
  );

  useEffect(() => {
    if (isStateLoading || language === normalizedPreferenceLanguage) {
      return;
    }

    void setI18nLanguage(normalizedPreferenceLanguage);
  }, [isStateLoading, language, normalizedPreferenceLanguage, setI18nLanguage]);

  const {
    activeProviderId,
    setActiveProviderId,
    providerListState,
    activeProviderSchemaState,
    retryProviderList,
    retryProviderSchema,
    providerSchemas,
    availableProviders: providerRuntimeProviders,
    activeProvider,
  } = useProviderRuntime();
  const { activeProviderParameters, setProviderParameters } =
    useProviderParametersState({ activeProviderId });

  // 快捷键处理
  useShortcuts({
    onRefresh: () => {
      if (selectedRepo && !isStateLoading && activeProviderUsesProjectFile) {
        scanProject(selectedRepo.path, {
          projectFile: selectedRepo.projectFile ?? undefined,
        });
      }
    },
    onPublish: () => {
      if (isPublishing) {
        return;
      }

      if (activeProviderRequiresProjectBinding) {
        if (projectInfo) {
          startPublish();
        }
        return;
      }

      if (selectedRepo) {
        startPublish();
      }
    },
    onOpenSettings: () => {
      setSettingsOpen(true);
    },
  });

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
  } = useAppDialogs(environmentProviderIds);

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
    panelWidthsCustomized,
    leftPanelWidth,
    middlePanelWidth,
    setLeftPanelWidth,
    setMiddlePanelWidth,
  });

  const {
    selectedRepo,
    branchConnectivityByRepoId,
  } = useRepositoryViewState({
    repositories,
    selectedRepoId,
  });
  const {
    applyProfileProvider,
    applyRecoveredSpecProvider,
    applySelectedRepositoryProvider,
  } = useEditorProviderState({
    availableProviders: providerRuntimeProviders,
    selectedRepo,
    setActiveProviderId,
  });
  const {
    environmentLastCheck,
    setEnvironmentLastCheck,
    recentHistoryExports,
    trackHistoryExport,
  } = useDiagnosticsUiState();

  const {
    recentConfigKeys,
    favoriteConfigKeys,
    pushRecentConfig,
    removeRecentConfig,
    reorderRecentConfig,
    toggleFavoriteConfig,
    replaceScopedConfigKey,
  } = useScopedConfigs({
    selectedRepoId,
    recentConfigByRepo: recentConfigKeysByRepo,
    pushRecentConfig: pushRecentPublishConfig,
    removeRecentConfig: removeRecentPublishConfig,
    reorderRecentConfig: reorderRecentPublishConfigs,
    replaceRecentConfigKey: replaceRecentPublishConfigKey,
  });

  const {
    activeProviderLabel,
    activeProviderUsesProjectFile,
    activeProviderRequiresProjectBinding,
    repositoryProviders,
    providerRuntimeBanner,
  } = useProviderPresentationState({
    providerRuntimeProviders,
    providerListState,
    activeProviderSchemaState,
    activeProvider,
    activeProviderId,
    appT,
    retryProviderList,
    retryProviderSchema,
  });

  const applyDotnetCustomConfig = useCallback(
    (config: PublishConfigStore) => {
      setCustomConfig(config);
      setIsCustomMode(true);
    },
    [setCustomConfig, setIsCustomMode]
  );

  const { activeImportFeedback, handleCommandImport } = useCommandImport({
    activeProviderId,
    appT,
    providerSchemas,
    onDotnetConfigReplace: applyDotnetCustomConfig,
    setProviderParameters,
  });

  const profilesState = useProfiles({
    appT,
    profileT,
    language,
    selectedRepoId,
    activeProviderId,
    providerSchemas,
    applyProfileProvider,
    setIsCustomMode,
    isCustomMode,
    setSelectedPreset,
    setProviderParameters,
    applyDotnetCustomConfig,
    replaceScopedConfigKey,
    presets: DOTNET_PRESETS,
    defaultPresetId: DEFAULT_DOTNET_PRESET_ID,
    getPresetText,
    buildProfileParameters: buildDotnetProfileParameters,
  });

  const { projectInfo, isProjectInfoRefreshing, scanProject } = useProjectShellState({
    appT,
    selectedRepoId,
    selectedRepoPath: selectedRepo?.path,
    selectedRepoProjectFile: selectedRepo?.projectFile ?? undefined,
    isStateLoading,
    activeProviderUsesProjectFile,
  });

  const {
    orderedProjectPublishProfiles,
    reorderProjectPublishProfiles,
  } = useProjectPublishProfileOrder({
    repoId: selectedRepoId,
    projectFilePath: projectInfo?.project_file,
    projectPublishProfiles: projectInfo?.publish_profiles || [],
  });

  const {
    profiles,
    isProfilesRefreshing,
    activeProfileName,
    quickCreateProfileOpen,
    quickCreateProfileName,
    setQuickCreateProfileName,
    quickCreateTemplateId,
    quickCreateProfileDraft,
    quickCreateProfileGroup,
    setQuickCreateProfileGroup,
    quickCreateProfileCustomGroup,
    setQuickCreateProfileCustomGroup,
    quickCreateProfileSaving,
    isQuickCreateEditing,
    loadProfiles,
    openQuickCreateProfileDialog,
    openQuickEditProfileDialog,
    handleQuickCreateProfileOpenChange,
    quickCreateTemplateOptions,
    quickCreateProfileGroupOptions,
    applyQuickCreateTemplate,
    updateQuickCreateProfileDraft,
    handleSelectProjectProfile,
    handleSelectProfileFromPanel,
    handleQuickCreateProfileSave,
    handleDeleteProfileFromPanel,
    handleLoadProfile,
    handleCreateProfileFromProjectProfile,
    handleReorderProfiles,
    profileManagement,
  } = profilesState;

  const {
    isRerunChecklistEnabled,
    setIsRerunChecklistEnabled,
    executionHistory,
    setExecutionHistory,
    savePublishRecord,
  } = usePublishHistoryState({
    executionHistoryLimit,
  });

  const {
    handleAddRepo,
    handleRemoveRepo,
    handleOpenRepoDirectory,
    handleEditRepo,
    handleDetectRepoProvider,
    handleScanProjectCandidates,
    handleRefreshRepoBranches,
  } = useRepositoryActions({
    appT,
    providers: providerRuntimeProviders,
    repositories,
    selectedRepoId,
    addRepository,
    removeRepository,
    updateRepository,
    applySelectedRepositoryProvider,
  });

  const isPublishing = usePublishStore((s) => s.isPublishing);
  const isCancellingPublish = usePublishStore((s) => s.isCancellingPublish);
  const publishResult = usePublishStore((s) => s.publishResult);
  const releaseChecklistOpen = usePublishStore(
    (s) => s.releaseChecklistOpen
  );
  const setReleaseChecklistOpen = usePublishStore(
    (s) => s.setReleaseChecklistOpen
  );
  const artifactActionState = usePublishStore(
    (s) => s.artifactActionState
  );

  const {
    outputLog,
    isResolvingSelectedProjectProfile,
    publishPreviewCommand,
    runPublishSpec,
    startPublish,
    cancelPublish,
  } = usePublishRunner({
    appT,
    publishT,
    selectedRepoId,
    selectedRepo,
    activeProviderId,
    activeProviderUsesProjectFile,
    activeProviderParameters,
    selectedPreset,
    isCustomMode,
    activeProfileName,
    customConfig,
    defaultOutputDir,
    projectInfo,
    presets: DOTNET_PRESETS,
    specVersion: SPEC_VERSION,
    pushRecentConfig,
    openEnvironmentDialog,
    setEnvironmentLastCheck,
    savePublishRecord,
  });

  const {
    extractSpecFromRecord,
    restoreSpecToEditor,
    getRecentConfigKeyFromSpec,
  } = useRecoverableSpec({
    specVersion: SPEC_VERSION,
    setCustomConfig,
    setIsCustomMode,
    applyRecoveredSpecProvider,
    setProviderParameters,
  });

  const {
    rerunChecklistOpen,
    setRerunChecklistOpen,
    pendingRerunRecord,
    rerunChecklistState,
    setRerunChecklistState,
    rerunFromHistory,
    closeRerunChecklistDialog,
    confirmRerunWithChecklist,
  } = useRerunFlow({
    isRerunChecklistEnabled,
    historyT,
    rerunT,
    extractSpecFromRecord,
    restoreSpecToEditor,
    getRecentConfigKeyFromSpec,
    runPublishSpec,
  });

  useTrayRecentPublish({
    appT,
    defaultOutputDir,
    specVersion: SPEC_VERSION,
    runPublishSpec,
  });

  const projectFrameworkOptions =
    projectInfo?.target_frameworks ?? EMPTY_STRING_LIST;
  const isProjectProfilesRefreshing =
    Boolean(selectedRepo) &&
    activeProviderUsesProjectFile &&
    isProjectInfoRefreshing;

  const isPublishRunCardRefreshing =
    Boolean(selectedRepo) &&
    activeProviderUsesProjectFile &&
    (isProjectInfoRefreshing || isResolvingSelectedProjectProfile);

  const publishRunCardProps = useMemo(
    () => ({
      outputLog,
      publishResult,
      appT,
      isRefreshing: isPublishRunCardRefreshing,
      publishActions:
        selectedRepo &&
        (activeProviderRequiresProjectBinding ? Boolean(projectInfo) : true)
          ? {
              publishCommand: publishPreviewCommand || null,
              publishCommandLabel: publishT.command || "将执行的命令:",
              startLabel: configT.execute || "执行发布",
              publishingLabel: configT.publishing || "发布中...",
              cancelLabel: appT.cancelPublish || "取消发布",
              cancellingLabel: appT.cancelling || "取消中...",
              isPublishing,
              isCancellingPublish,
              startDisabled: !selectedRepo,
              onStartPublish: startPublish,
              onCancelPublish: cancelPublish,
            }
          : null,
    }),
    [
      activeProviderRequiresProjectBinding,
      appT,
      cancelPublish,
      configT.execute,
      configT.publishing,
      isCancellingPublish,
      isPublishRunCardRefreshing,
      isPublishing,
      outputLog,
      publishPreviewCommand,
      projectInfo,
      publishResult,
      publishT.command,
      selectedRepo,
      startPublish,
    ]
  );

  const commandImportResultCardProps = useCommandImportResultCardProps({
    activeImportFeedback,
    providerLabel: activeProviderLabel,
    appT,
  });

  const showCommandImportResultCard = Boolean(
    selectedRepo && commandImportResultCardProps
  );
  const shouldLoadDiagnosticsSection = selectedRepo
    ? rightPanelView === "history"
    : false;
  const diagnosticsSectionProps = shouldLoadDiagnosticsSection && selectedRepo
    ? {
        rightPanelView,
        appT,
        historyT,
        failureT,
        executionHistory,
        executionHistoryLimit,
        selectedRepo,
        isPublishing,
        recentHistoryExports,
        setExecutionHistory,
        trackHistoryExport,
        extractSpecFromRecord,
        rerunFromHistory,
      }
    : null;
  const shouldLoadAppDialogsHost =
    shortcutsOpen ||
    environmentDialogOpen ||
    settingsOpen ||
    rerunChecklistOpen ||
    releaseChecklistOpen ||
    commandImportOpen ||
    quickCreateProfileOpen ||
    configDialogOpen;

  const publishConfigPanelProps = useMemo<PublishConfigPanelProps>(
    () => ({
      selectedRepoId,
      selectedPreset,
      isCustomMode,
      profiles,
      isProfilesRefreshing: Boolean(selectedRepo) && isProfilesRefreshing,
      activeProfileName,
      onSelectProfile: handleSelectProfileFromPanel,
      onCreateProfile: openQuickCreateProfileDialog,
      onEditProfile: openQuickEditProfileDialog,
      onRefreshProfiles: loadProfiles,
      onOpenConfigDialog: () => handleConfigDialogOpenChange(true),
      onDeleteProfile: handleDeleteProfileFromPanel,
      projectPublishProfiles: orderedProjectPublishProfiles,
      isProjectProfilesRefreshing,
      projectFilePath: projectInfo?.project_file,
      projectFrameworkOptions,
      onSelectProjectProfile: handleSelectProjectProfile,
      onCopyProjectProfileToCustom: handleCreateProfileFromProjectProfile,
      recentConfigKeys,
      favoriteConfigKeys,
      onToggleFavoriteConfig: toggleFavoriteConfig,
      onRemoveRecentConfig: removeRecentConfig,
      onReorderRecentConfigs: reorderRecentConfig,
      onReorderProjectProfiles: reorderProjectPublishProfiles,
      onReorderProfiles: handleReorderProfiles,
      onCollapse: () => setMiddlePanelCollapsed(true),
      showExpandButton: leftPanelCollapsed,
      onExpandRepo: () => setLeftPanelCollapsed(false),
    }),
    [
      activeProfileName,
      favoriteConfigKeys,
      handleCreateProfileFromProjectProfile,
      handleConfigDialogOpenChange,
      handleDeleteProfileFromPanel,
      handleReorderProfiles,
      handleSelectProfileFromPanel,
      handleSelectProjectProfile,
      isCustomMode,
      isProfilesRefreshing,
      isProjectProfilesRefreshing,
      leftPanelCollapsed,
      loadProfiles,
      openQuickCreateProfileDialog,
      openQuickEditProfileDialog,
      orderedProjectPublishProfiles,
      profiles,
      projectFrameworkOptions,
      projectInfo?.project_file,
      recentConfigKeys,
      removeRecentConfig,
      reorderProjectPublishProfiles,
      reorderRecentConfig,
      selectedPreset,
      selectedRepo,
      selectedRepoId,
      setLeftPanelCollapsed,
      setMiddlePanelCollapsed,
      toggleFavoriteConfig,
    ]
  );

  return {
    // Domain-grouped return values
    shell: {
      rightPanelView,
      setRightPanelView,
      isStateLoading,
      leftPanelWidth,
      middlePanelWidth,
      panelWidthsCustomized,
      setLeftPanelWidth,
      setMiddlePanelWidth,
      preferenceLanguage,
      setPreferenceLanguage,
      minimizeToTrayOnClose,
      setMinimizeToTrayOnClose,
      defaultOutputDir,
      setDefaultOutputDir,
      theme,
      setTheme,
      executionHistoryLimit,
      setExecutionHistoryLimit,
      environmentProviderIds,
      setEnvironmentProviderIds,
      startupNotice,
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
    },
    repo: {
      repositories,
      selectedRepoId,
      addRepository,
      removeRepository,
      updateRepository,
      reorderRepositories,
      selectRepository,
      selectedRepo,
      branchConnectivityByRepoId,
      handleAddRepo,
      handleRemoveRepo,
      handleOpenRepoDirectory,
      handleEditRepo,
      handleDetectRepoProvider,
      handleScanProjectCandidates,
      handleRefreshRepoBranches,
      environmentLastCheck,
      setEnvironmentLastCheck,
      recentHistoryExports,
      trackHistoryExport,
      repositoryProviders,
    },
    publish: {
      pushRecentPublishConfig,
      removeRecentPublishConfig,
      reorderRecentPublishConfigs,
      replaceRecentPublishConfigKey,
      selectedPreset,
      isCustomMode,
      customConfig,
      setSelectedPreset,
      setIsCustomMode,
      setCustomConfig,
      activeProviderId,
      setActiveProviderId,
      providerListState,
      activeProviderSchemaState,
      retryProviderList,
      retryProviderSchema,
      providerSchemas,
      providerRuntimeProviders,
      activeProvider,
      activeProviderParameters,
      setProviderParameters,
      applyProfileProvider,
      applyRecoveredSpecProvider,
      applySelectedRepositoryProvider,
      recentConfigKeys,
      favoriteConfigKeys,
      pushRecentConfig,
      removeRecentConfig,
      reorderRecentConfig,
      toggleFavoriteConfig,
      replaceScopedConfigKey,
      activeProviderLabel,
      activeProviderUsesProjectFile,
      activeProviderRequiresProjectBinding,
      providerRuntimeBanner,
      applyDotnetCustomConfig,
      activeImportFeedback,
      handleCommandImport,
      projectInfo,
      isProjectInfoRefreshing,
      scanProject,
      orderedProjectPublishProfiles,
      reorderProjectPublishProfiles,
      profiles,
      isProfilesRefreshing,
      activeProfileName,
      quickCreateProfileOpen,
      quickCreateProfileName,
      setQuickCreateProfileName,
      quickCreateTemplateId,
      quickCreateProfileDraft,
      quickCreateProfileGroup,
      setQuickCreateProfileGroup,
      quickCreateProfileCustomGroup,
      setQuickCreateProfileCustomGroup,
      quickCreateProfileSaving,
      isQuickCreateEditing,
      loadProfiles,
      openQuickCreateProfileDialog,
      openQuickEditProfileDialog,
      handleQuickCreateProfileOpenChange,
      quickCreateTemplateOptions,
      quickCreateProfileGroupOptions,
      applyQuickCreateTemplate,
      updateQuickCreateProfileDraft,
      handleSelectProjectProfile,
      handleSelectProfileFromPanel,
      handleQuickCreateProfileSave,
      handleDeleteProfileFromPanel,
      handleLoadProfile,
      handleCreateProfileFromProjectProfile,
      handleReorderProfiles,
      profileManagement,
      isRerunChecklistEnabled,
      setIsRerunChecklistEnabled,
      executionHistory,
      setExecutionHistory,
      savePublishRecord,
      isPublishing,
      isCancellingPublish,
      publishResult,
      releaseChecklistOpen,
      setReleaseChecklistOpen,
      artifactActionState,
      outputLog,
      isResolvingSelectedProjectProfile,
      publishPreviewCommand,
      runPublishSpec,
      startPublish,
      cancelPublish,
      extractSpecFromRecord,
      restoreSpecToEditor,
      getRecentConfigKeyFromSpec,
      rerunChecklistOpen,
      setRerunChecklistOpen,
      pendingRerunRecord,
      rerunChecklistState,
      setRerunChecklistState,
      rerunFromHistory,
      closeRerunChecklistDialog,
      confirmRerunWithChecklist,
      projectFrameworkOptions,
      isProjectProfilesRefreshing,
      isPublishRunCardRefreshing,
      publishConfigPanelProps,
      publishRunCardProps,
      commandImportResultCardProps,
      showCommandImportResultCard,
      shouldLoadDiagnosticsSection,
      diagnosticsSectionProps,
      QUICK_CREATE_PROFILE_GROUP_CUSTOM,
      QUICK_CREATE_PROFILE_GROUP_DEFAULT,
    },
  };
}
