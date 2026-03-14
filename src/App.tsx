import { useEffect, useCallback } from "react";
// Hooks
import { useAppDialogs } from "@/hooks/useAppDialogs";
import { useAppState } from "@/hooks/useAppState";
import { useTheme } from "@/hooks/useTheme";
import { useShortcuts } from "@/hooks/useShortcuts";
import { useDiagnosticsExports } from "@/hooks/useDiagnosticsExports";
import { useDiagnosticsUiState } from "@/hooks/useDiagnosticsUiState";
import { useLayoutShellState } from "@/hooks/useLayoutShellState";
import { useProjectExecutionState } from "@/hooks/useProjectExecutionState";
import { useProjectShellState } from "@/hooks/useProjectShellState";
import { useProviderPresentationState } from "@/hooks/useProviderPresentationState";
import { usePublishExecutionCallSurface } from "@/hooks/usePublishExecutionCallSurface";
import { useRepositoryActions } from "@/hooks/useRepositoryActions";
import { useRepositoryViewState } from "@/hooks/useRepositoryViewState";
import { useRecoverableSpec } from "@/hooks/useRecoverableSpec";
import { useRerunFlow } from "@/hooks/useRerunFlow";
import { usePresetText } from "@/hooks/usePresetText";
import { usePublishExecution } from "@/hooks/usePublishExecution";
import {
  useProfiles,
  QUICK_CREATE_PROFILE_GROUP_CUSTOM,
  QUICK_CREATE_PROFILE_GROUP_DEFAULT,
} from "@/hooks/useProfiles";
import { useCommandImport } from "@/hooks/useCommandImport";
import { useScopedConfigs } from "@/hooks/useScopedConfigs";
import { useFailureGroupSelection } from "@/hooks/useFailureGroupSelection";
import { useHistoryActions } from "@/hooks/useHistoryActions";
import { useHistoryDiagnosticsState } from "@/hooks/useHistoryDiagnosticsState";
import { useExecutionHistoryCardProps } from "@/hooks/useExecutionHistoryCardProps";
import { useFailureGroupDetailCardProps } from "@/hooks/useFailureGroupDetailCardProps";
import { useFailureGroupsCardProps } from "@/hooks/useFailureGroupsCardProps";
import { useOutputLogCardProps } from "@/hooks/useOutputLogCardProps";
import { useCommandImportResultCardProps } from "@/hooks/useCommandImportResultCardProps";
import {
  useDotnetPublishCardProps,
  useGenericProviderPublishCardProps,
} from "@/hooks/usePublishCardProps";
import { useDialogsCompositionState } from "@/hooks/useDialogsCompositionState";
import { useProviderRuntime } from "@/hooks/useProviderRuntime";
import { useI18n, type Language } from "@/hooks/useI18n";

// Layout Components
import { AppDialogs } from "@/components/layout/AppDialogs";
import { RepositoryList } from "@/components/layout/RepositoryList";
import { PublishConfigPanel } from "@/components/layout/PublishConfigPanel";
import { PublishContentSection } from "@/components/layout/PublishContentSection";
import { MainContentShell } from "@/components/layout/MainContentShell";
import { ResizeHandle } from "@/components/layout/ResizeHandle";
import { SidebarPanelShell } from "@/components/layout/SidebarPanelShell";

// UI Components
import {
  Loader2,
} from "lucide-react";

// Types

interface DotnetPreset {
  id: string;
  name: string;
  description: string;
  config: {
    configuration: string;
    runtime: string;
    self_contained: boolean;
  };
}

const SPEC_VERSION = 1;

// Preset configurations
const PRESETS: DotnetPreset[] = [
  {
    id: "release-fd",
    name: "Release - 框架依赖",
    description: "推荐用于开发/测试",
    config: { configuration: "Release", runtime: "", self_contained: false },
  },
  {
    id: "release-win-x64",
    name: "Release - Windows x64",
    description: "自包含部署",
    config: {
      configuration: "Release",
      runtime: "win-x64",
      self_contained: true,
    },
  },
  {
    id: "release-osx-arm64",
    name: "Release - macOS ARM64",
    description: "Apple Silicon",
    config: {
      configuration: "Release",
      runtime: "osx-arm64",
      self_contained: true,
    },
  },
  {
    id: "release-osx-x64",
    name: "Release - macOS x64",
    description: "Intel Mac",
    config: {
      configuration: "Release",
      runtime: "osx-x64",
      self_contained: true,
    },
  },
  {
    id: "release-linux-x64",
    name: "Release - Linux x64",
    description: "自包含部署",
    config: {
      configuration: "Release",
      runtime: "linux-x64",
      self_contained: true,
    },
  },
  {
    id: "debug-fd",
    name: "Debug - 框架依赖",
    description: "调试模式",
    config: { configuration: "Debug", runtime: "", self_contained: false },
  },
  {
    id: "debug-win-x64",
    name: "Debug - Windows x64",
    description: "自包含部署",
    config: {
      configuration: "Debug",
      runtime: "win-x64",
      self_contained: true,
    },
  },
  {
    id: "debug-osx-arm64",
    name: "Debug - macOS ARM64",
    description: "Apple Silicon",
    config: {
      configuration: "Debug",
      runtime: "osx-arm64",
      self_contained: true,
    },
  },
  {
    id: "debug-osx-x64",
    name: "Debug - macOS x64",
    description: "Intel Mac",
    config: { configuration: "Debug", runtime: "osx-x64", self_contained: true },
  },
  {
    id: "debug-linux-x64",
    name: "Debug - Linux x64",
    description: "自包含部署",
    config: {
      configuration: "Debug",
      runtime: "linux-x64",
      self_contained: true,
    },
  },
];

function App() {
  // 使用持久化的应用状态
  const {
    isLoading: isStateLoading,
    repositories,
    selectedRepoId,
    addRepository,
    removeRepository,
    updateRepository,
    selectRepository,
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
    setMinimizeToTrayOnClose,
    setDefaultOutputDir,
    setTheme,
    setExecutionHistoryLimit,
    setLanguage: setPreferenceLanguage,
  } = useAppState();

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
    providerSchemas,
    setProviderParameters,
    availableProviders: providerRuntimeProviders,
    activeProvider,
    activeProviderSchema,
    activeProviderParameters,
    handleProviderParametersChange,
  } = useProviderRuntime();

  // 快捷键处理
  useShortcuts({
    onRefresh: () => {
      if (
        selectedRepo &&
        !isStateLoading &&
        activeProviderId === "dotnet"
      ) {
        scanProject(selectedRepo.path);
      }
    },
    onPublish: () => {
      if (isPublishing) {
        return;
      }

      if (activeProviderId === "dotnet") {
        if (projectInfo) {
          executePublish();
        }
        return;
      }

      if (selectedRepo) {
        executePublish();
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
    environmentInitialResult,
    handleOpenSettings,
    openEnvironmentDialog,
    handleEnvironmentDialogOpenChange,
    handleConfigDialogOpenChange,
  } = useAppDialogs(activeProviderId);

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
    environmentLastResult,
    setEnvironmentLastResult,
    recentBundleExports,
    recentHistoryExports,
    trackBundleExport,
    trackHistoryExport,
  } = useDiagnosticsUiState();

  const {
    recentConfigKeys,
    favoriteConfigKeys,
    pushRecentConfig,
    removeRecentConfig,
    toggleFavoriteConfig,
  } = useScopedConfigs(selectedRepoId);

  const {
    activeProviderLabel,
    repositoryProviders,
    handleCustomConfigUpdate,
  } = useProviderPresentationState({
    providerRuntimeProviders,
    activeProvider,
    activeProviderId,
    customConfig,
    setCustomConfig,
  });

  const { activeImportFeedback, handleCommandImport } = useCommandImport({
    activeProviderId,
    appT,
    providerSchemas,
    onDotnetConfigUpdate: handleCustomConfigUpdate,
    onEnableCustomMode: () => setIsCustomMode(true),
    setProviderParameters,
  });

  const profilesState = useProfiles({
    appT,
    profileT,
    language,
    selectedRepoId,
    activeProviderId,
    providerSchemas,
    setActiveProviderId,
    setIsCustomMode,
    isCustomMode,
    setSelectedPreset,
    setProviderParameters,
    handleCustomConfigUpdate,
    pushRecentConfig,
    presets: PRESETS,
    defaultPresetId: PRESETS[0]?.id ?? "release-fd",
    getPresetText,
    buildProfileParameters: (config) => ({
      configuration: config.configuration,
      runtime: config.runtime,
      output: config.outputDir,
      self_contained: config.selfContained,
    }),
  });

  const { projectInfo, scanProject } = useProjectShellState({
    appT,
    selectedRepoId,
    selectedRepoPath: selectedRepo?.path,
    isStateLoading,
    activeProviderId,
  });

  const {
    profiles,
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
    loadProfiles,
    setActiveProfileName,
    openQuickCreateProfileDialog,
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
  } = profilesState;

  const {
    isRerunChecklistEnabled,
    setIsRerunChecklistEnabled,
    executionHistory,
    setExecutionHistory,
    persistExecutionRecord,
    buildExecutionRecord,
    handleSelectPresetValueChange,
  } = useProjectExecutionState({
    executionHistoryLimit,
    selectedPreset,
    setSelectedPreset,
    setIsCustomMode,
    setActiveProfileName,
    handleSelectProjectProfile,
  });

  const {
    historyFilterProvider,
    setHistoryFilterProvider,
    historyFilterStatus,
    setHistoryFilterStatus,
    historyFilterWindow,
    setHistoryFilterWindow,
    historyFilterKeyword,
    setHistoryFilterKeyword,
    issueDraftTemplate,
    setIssueDraftTemplate,
    issueDraftSections,
    setIssueDraftSections,
    scopedExecutionHistory,
    historyProviderOptions,
    historyFilterPresets,
    dailyTriagePreset,
    setDailyTriagePreset,
    selectedHistoryPresetId: effectiveSelectedHistoryPresetId,
    setSelectedHistoryPresetId,
    saveCurrentHistoryPreset,
    deleteSelectedHistoryPreset,
    filteredExecutionHistory,
    dailyTriageRecords,
    applyHistoryPresetToFilters,
    resetDailyTriagePreset,
    clearHistoryFilters,
    snapshotPaths,
    failureGroups,
  } = useHistoryDiagnosticsState({
    historyT,
    executionHistory,
    selectedRepo,
  });

  const {
    selectedFailureGroupKey,
    setSelectedFailureGroupKey,
    selectedFailureGroup,
    representativeFailureRecord,
  } = useFailureGroupSelection(failureGroups);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  const {
    handleAddRepo,
    handleRemoveRepo,
    handleEditRepo,
    handleDetectRepoProvider,
    handleScanProjectFiles,
    handleRefreshRepoBranches,
  } = useRepositoryActions({
    appT,
    repositories,
    selectedRepoId,
    addRepository,
    removeRepository,
    updateRepository,
    setActiveProviderId,
  });

  const publishExecutionCallSurface = usePublishExecutionCallSurface({
    pushRecentConfig,
    openEnvironmentDialog,
    setEnvironmentLastResult,
    buildExecutionRecord,
    persistExecutionRecord,
  });

  const {
    isPublishing,
    isCancellingPublish,
    publishResult,
    lastExecutedSpec,
    currentExecutionRecordId,
    outputLog,
    releaseChecklistOpen,
    setReleaseChecklistOpen,
    artifactActionState,
    setArtifactActionState,
    dotnetPublishPreviewCommand,
    runPublishWithSpec,
    executePublish,
    cancelPublish,
  } = usePublishExecution({
    appT,
    publishT,
    selectedRepoId,
    selectedRepo,
    activeProviderId,
    activeProviderParameters,
    selectedPreset,
    isCustomMode,
    customConfig,
    defaultOutputDir,
    projectInfo,
    presets: PRESETS,
    specVersion: SPEC_VERSION,
    callSurface: publishExecutionCallSurface,
  });

  const {
    extractSpecFromRecord,
    restoreSpecToEditor,
    getRecentConfigKeyFromSpec,
  } = useRecoverableSpec({
    specVersion: SPEC_VERSION,
    customConfig,
    setCustomConfig,
    setIsCustomMode,
    setActiveProviderId,
    setProviderParameters,
  });

  const {
    copyGroupSignature,
    copyFailureIssueDraft,
    copyRecordCommand,
    copyHandoffSnippet,
    openSnapshotFromRecord,
  } = useHistoryActions({
    appT,
    historyT,
    failureT,
    issueDraftTemplate,
    issueDraftSections,
    extractSpecFromRecord,
    setExecutionHistory,
  });

  const {
    isExportingSnapshot,
    isExportingFailureBundle,
    isExportingHistory,
    isExportingDiagnosticsIndex,
    exportExecutionSnapshot,
    exportFailureGroupBundle,
    exportExecutionHistory,
    exportDailyTriageReport,
    exportDiagnosticsIndex,
  } = useDiagnosticsExports({
    historyT,
    failureT,
    publishResult,
    lastExecutedSpec,
    outputLog,
    environmentLastResult,
    currentExecutionRecordId,
    selectedFailureGroup,
    representativeFailureRecord,
    dailyTriagePreset,
    dailyTriageRecords,
    snapshotPaths,
    recentBundleExports,
    recentHistoryExports,
    scopedExecutionHistory,
    filteredExecutionHistory,
    failureGroupsCount: failureGroups.length,
    selectedRepoPath: selectedRepo?.path || "",
    setExecutionHistory,
    trackBundleExport,
    trackHistoryExport,
    setHistoryFilterProvider,
    setHistoryFilterStatus,
    setHistoryFilterWindow,
    setHistoryFilterKeyword,
    setSelectedHistoryPresetId,
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
    runPublishWithSpec,
  });

  const { appDialogsProps } = useDialogsCompositionState({
    shortcutsOpen,
    setShortcutsOpen,
    environmentDialogOpen,
    handleEnvironmentDialogOpenChange,
    environmentDefaultProviderIds,
    environmentInitialResult,
    setEnvironmentLastResult,
    settingsOpen,
    setSettingsOpen,
    language,
    handleLanguageChange,
    minimizeToTrayOnClose,
    setMinimizeToTrayOnClose,
    defaultOutputDir,
    setDefaultOutputDir,
    executionHistoryLimit,
    setExecutionHistoryLimit,
    isRerunChecklistEnabled,
    setIsRerunChecklistEnabled,
    theme,
    setTheme,
    handleConfigDialogOpenChange,
    environmentLastResult,
    openEnvironmentDialog,
    activeProviderId,
    rerunChecklistOpen,
    pendingRerunRecord,
    selectedRepoCurrentBranch: selectedRepo?.currentBranch,
    rerunChecklistState,
    rerunT,
    setRerunChecklistOpen,
    setRerunChecklistState,
    closeRerunChecklistDialog,
    confirmRerunWithChecklist,
    releaseChecklistOpen,
    setReleaseChecklistOpen,
    publishResult,
    packageResult: artifactActionState.packageResult,
    signResult: artifactActionState.signResult,
    handleOpenSettings,
    selectedRepoExists: Boolean(selectedRepo),
    commandImportOpen,
    setCommandImportOpen,
    handleCommandImport,
    quickCreateProfileOpen,
    quickCreateTemplateId,
    quickCreateTemplateOptions,
    quickCreateProfileName,
    quickCreateProfileGroup,
    quickCreateProfileGroupOptions,
    quickCreateProfileCustomGroup,
    quickCreateProfileDraft,
    quickCreateProfileSaving,
    quickCreateGroupDefaultValue: QUICK_CREATE_PROFILE_GROUP_DEFAULT,
    quickCreateGroupCustomValue: QUICK_CREATE_PROFILE_GROUP_CUSTOM,
    profileT,
    appT,
    cancelLabel: rerunT.cancel || "取消",
    handleQuickCreateProfileOpenChange,
    applyQuickCreateTemplate,
    setQuickCreateProfileName,
    setQuickCreateProfileGroup,
    setQuickCreateProfileCustomGroup,
    updateQuickCreateProfileDraft,
    handleQuickCreateProfileSave,
    configDialogOpen,
    loadProfiles,
    handleLoadProfile,
    selectedRepoId,
    customConfig,
    activeProviderParameters,
    projectFile: projectInfo?.project_file,
    selectedRepoPath: selectedRepo?.path,
  });

  const executionHistoryCardProps = useExecutionHistoryCardProps({
    scopedExecutionHistory,
    filteredExecutionHistory,
    executionHistoryLimit,
    historyProviderOptions,
    historyFilterProvider,
    historyFilterStatus,
    historyFilterWindow,
    historyFilterKeyword,
    selectedHistoryPresetId: effectiveSelectedHistoryPresetId,
    historyFilterPresets,
    dailyTriagePreset,
    dailyTriageRecords,
    isExportingHistory,
    isExportingDiagnosticsIndex,
    isPublishing,
    appT,
    historyT,
    failureT,
    setHistoryFilterProvider,
    setHistoryFilterStatus,
    setHistoryFilterWindow,
    setHistoryFilterKeyword,
    applyHistoryPresetToFilters,
    saveCurrentHistoryPreset,
    deleteSelectedHistoryPreset,
    setDailyTriagePreset,
    resetDailyTriagePreset,
    exportExecutionHistory,
    exportDailyTriageReport,
    exportDiagnosticsIndex,
    clearHistoryFilters,
    openSnapshotFromRecord,
    rerunFromHistory,
    copyHandoffSnippet,
  });

  const failureGroupDetailCardProps = useFailureGroupDetailCardProps({
    selectedFailureGroup,
    representativeFailureRecord,
    issueDraftTemplate,
    issueDraftSections,
    failureT,
    appT,
    isExportingFailureBundle,
    isPublishing,
    setIssueDraftTemplate,
    setIssueDraftSections,
    copyGroupSignature,
    copyRecordCommand,
    copyFailureIssueDraft,
    exportFailureGroupBundle,
    openSnapshotFromRecord,
    rerunFromHistory,
  });

  const outputLogCardProps = useOutputLogCardProps({
    outputLog,
    publishResult,
    appT,
    isExportingSnapshot,
    exportExecutionSnapshot,
    setReleaseChecklistOpen,
    setArtifactActionState,
  });

  const failureGroupsCardProps = useFailureGroupsCardProps({
    failureGroups,
    selectedFailureGroupKey,
    failureT,
    isPublishing,
    setSelectedFailureGroupKey,
    copyGroupSignature,
    openSnapshotFromRecord,
    rerunFromHistory,
  });

  const dotnetPublishCardProps = useDotnetPublishCardProps({
    configT,
    appT,
    publishT,
    isCustomMode,
    selectedPreset,
    presets: PRESETS,
    getPresetText,
    projectPublishProfiles: projectInfo?.publish_profiles || [],
    customConfig,
    dotnetPublishPreviewCommand,
    isPublishing,
    isCancellingPublish,
    disabled: !selectedRepo,
    setCommandImportOpen,
    setIsCustomMode,
    handleSelectPresetValueChange,
    handleCustomConfigUpdate,
    executePublish,
    cancelPublish,
  });

  const genericProviderPublishCardProps = useGenericProviderPublishCardProps({
    activeProviderLabel,
    activeProviderSchema,
    activeProviderParameters,
    appT,
    configT,
    isPublishing,
    isCancellingPublish,
    setCommandImportOpen,
    handleProviderParametersChange,
    openEnvironmentDialog,
    activeProviderId,
    executePublish,
    cancelPublish,
  });

  const commandImportResultCardProps = useCommandImportResultCardProps({
    activeImportFeedback,
    providerLabel: activeProviderLabel,
    appT,
  });

  // Show loading state
  if (isStateLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="text-muted-foreground">{appT.loading || "加载中..."}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Main Content - Three Column Layout (no separate title bar) */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel - Repository List */}
        <SidebarPanelShell
          collapsed={leftPanelCollapsed}
          width={`${effectiveLeftPanelWidth}px`}
        >
          <RepositoryList
            repositories={repositories}
            selectedRepoId={selectedRepoId}
            providers={repositoryProviders}
            onSelectRepo={selectRepository}
            onAddRepo={handleAddRepo}
            onEditRepo={handleEditRepo}
            onRemoveRepo={handleRemoveRepo}
            onDetectProvider={handleDetectRepoProvider}
            onScanProjectFiles={handleScanProjectFiles}
            onRefreshBranches={handleRefreshRepoBranches}
            branchConnectivityByRepoId={branchConnectivityByRepoId}
            onSettings={handleOpenSettings}
            onCollapse={() => setLeftPanelCollapsed(true)}
          />
        </SidebarPanelShell>

        {/* Left Resize Handle */}
        {!leftPanelCollapsed && (
          <ResizeHandle onResize={handleLeftPanelResize} showHeaderBorder={false} />
        )}

        {/* Middle Panel - Publish Config */}
        <SidebarPanelShell
          collapsed={middlePanelCollapsed}
          width={`${effectiveMiddlePanelWidth}px`}
        >
          <PublishConfigPanel
            selectedPreset={selectedPreset}
            isCustomMode={isCustomMode}
            profiles={profiles}
            activeProfileName={activeProfileName}
            onSelectProfile={handleSelectProfileFromPanel}
            onCreateProfile={openQuickCreateProfileDialog}
            onRefreshProfiles={loadProfiles}
            onDeleteProfile={handleDeleteProfileFromPanel}
            projectPublishProfiles={projectInfo?.publish_profiles || []}
            onSelectProjectProfile={handleSelectProjectProfile}
            recentConfigKeys={recentConfigKeys}
            favoriteConfigKeys={favoriteConfigKeys}
            onToggleFavoriteConfig={toggleFavoriteConfig}
            onRemoveRecentConfig={removeRecentConfig}
            onCollapse={() => setMiddlePanelCollapsed(true)}
            showExpandButton={leftPanelCollapsed}
            onExpandRepo={() => setLeftPanelCollapsed(false)}
          />
        </SidebarPanelShell>

        {/* Middle Resize Handle */}
        {!middlePanelCollapsed && (
          <ResizeHandle onResize={handleMiddlePanelResize} />
        )}

        {/* Right Panel - Main Content */}
        <MainContentShell
          leftPanelCollapsed={leftPanelCollapsed}
          middlePanelCollapsed={middlePanelCollapsed}
          appT={appT}
          configPanelT={translations.configPanel || {}}
          onExpandLeftPanel={() => setLeftPanelCollapsed(false)}
          onExpandMiddlePanel={() => setMiddlePanelCollapsed(false)}
        >
          <PublishContentSection
            showDotnetPublishCard={Boolean(
              selectedRepo && activeProviderId === "dotnet" && projectInfo
            )}
            showGenericProviderPublishCard={Boolean(
              selectedRepo && activeProviderId !== "dotnet"
            )}
            showCommandImportResultCard={Boolean(
              selectedRepo && commandImportResultCardProps
            )}
            dotnetPublishCardProps={dotnetPublishCardProps}
            genericProviderPublishCardProps={genericProviderPublishCardProps}
            commandImportResultCardProps={commandImportResultCardProps}
            outputLogCardProps={outputLogCardProps}
            failureGroupsCardProps={failureGroupsCardProps}
            failureGroupDetailCardProps={failureGroupDetailCardProps}
            executionHistoryCardProps={executionHistoryCardProps}
          />
        </MainContentShell>
      </div>

      <AppDialogs {...appDialogsProps} />
    </div>
  );
}

export default App;
