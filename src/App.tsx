import { Suspense, lazy, useEffect, useCallback, useMemo, useState } from "react";
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
import { useProviderRuntime } from "@/hooks/useProviderRuntime";
import { useI18n, type Language } from "@/hooks/useI18n";
import type { PublishConfigStore } from "@/lib/store";
import { buildDotnetProfileParameters } from "@/lib/dotnetPublishConfig";

// Layout Components
import { ResizeHandle } from "@/components/layout/ResizeHandle";
import { SidebarPanelShell } from "@/components/layout/SidebarPanelShell";
import { ProviderRuntimeBanner } from "@/components/layout/ProviderRuntimeBanner";

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

type RightPanelView = "home" | "history";

const SPEC_VERSION = 1;
const AppDialogsHost = lazy(async () => {
  const mod = await import("@/components/layout/AppDialogsHost");
  return { default: mod.AppDialogsHost };
});
const RepositoryList = lazy(async () => {
  const mod = await import("@/components/layout/RepositoryList");
  return { default: mod.RepositoryList };
});
const PublishConfigPanel = lazy(async () => {
  const mod = await import("@/components/layout/PublishConfigPanel");
  return { default: mod.PublishConfigPanel };
});
const PublishContentSection = lazy(async () => {
  const mod = await import("@/components/layout/PublishContentSection");
  return { default: mod.PublishContentSection };
});
const MainContentShell = lazy(async () => {
  const mod = await import("@/components/layout/MainContentShell");
  return { default: mod.MainContentShell };
});

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
const EMPTY_STRING_LIST: string[] = [];

function App() {
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
    setProviderParameters,
    availableProviders: providerRuntimeProviders,
    activeProvider,
    activeProviderParameters,
  } = useProviderRuntime();

  // 快捷键处理
  useShortcuts({
    onRefresh: () => {
      if (
        selectedRepo &&
        !isStateLoading &&
        activeProviderId === "dotnet"
      ) {
        scanProject(selectedRepo.path, {
          projectFile: selectedRepo.projectFile ?? undefined,
        });
      }
    },
    onPublish: () => {
      if (isPublishing) {
        return;
      }

      if (activeProviderId === "dotnet") {
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
    repositoryProviders,
  } = useProviderPresentationState({
    providerRuntimeProviders,
    activeProvider,
    activeProviderId,
    customConfig,
    setCustomConfig,
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
    setActiveProviderId,
    setIsCustomMode,
    isCustomMode,
    setSelectedPreset,
    setProviderParameters,
    applyDotnetCustomConfig,
    replaceScopedConfigKey,
    presets: PRESETS,
    defaultPresetId: PRESETS[0]?.id ?? "release-fd",
    getPresetText,
    buildProfileParameters: buildDotnetProfileParameters,
  });

  const { projectInfo, isProjectInfoRefreshing, scanProject } = useProjectShellState({
    appT,
    selectedRepoId,
    selectedRepoPath: selectedRepo?.path,
    selectedRepoProjectFile: selectedRepo?.projectFile ?? undefined,
    isStateLoading,
    activeProviderId,
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
    repositories,
    selectedRepoId,
    addRepository,
    removeRepository,
    updateRepository,
    setActiveProviderId,
  });

  const {
    isPublishing,
    isCancellingPublish,
    publishResult,
    outputLog,
    isResolvingSelectedProjectProfile,
    releaseChecklistOpen,
    setReleaseChecklistOpen,
    artifactActionState,
    dotnetPublishPreviewCommand,
    runPublishSpec,
    startPublish,
    cancelPublish,
  } = usePublishRunner({
    appT,
    publishT,
    selectedRepoId,
    selectedRepo,
    activeProviderId,
    activeProviderParameters,
    selectedPreset,
    isCustomMode,
    activeProfileName,
    customConfig,
    defaultOutputDir,
    projectInfo,
    presets: PRESETS,
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
    setActiveProviderId,
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
    activeProviderId === "dotnet" &&
    isProjectInfoRefreshing;

  const isPublishRunCardRefreshing =
    Boolean(selectedRepo) &&
    activeProviderId === "dotnet" &&
    (isProjectInfoRefreshing || isResolvingSelectedProjectProfile);

  const publishRunCardProps = useMemo(
    () => ({
      outputLog,
      publishResult,
      appT,
      isRefreshing: isPublishRunCardRefreshing,
      publishActions:
        selectedRepo &&
        (activeProviderId === "dotnet" ? Boolean(projectInfo) : true)
          ? {
              publishCommand:
                activeProviderId === "dotnet" ? dotnetPublishPreviewCommand : null,
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
      activeProviderId,
      appT,
      cancelPublish,
      configT.execute,
      configT.publishing,
      dotnetPublishPreviewCommand,
      isCancellingPublish,
      isPublishRunCardRefreshing,
      isPublishing,
      outputLog,
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

  const providerRuntimeBanner = useMemo(() => {
    if (providerListState.status === "loading" && !providerListState.data?.length) {
      return {
        key: "provider-loading",
        status: "loading" as const,
        title: appT.loadingProviders || "正在加载 Provider 列表...",
        description:
          appT.loadingProvidersDescription ||
          "等待 Provider 运行时初始化完成后，参数编辑和命令导入功能才会恢复。",
        onRetry: retryProviderList,
      };
    }

    if (providerListState.status === "error") {
      return {
        key: "provider-error",
        status: "error" as const,
        title: appT.providerListLoadFailed || "Provider 列表加载失败",
        description:
          String(providerListState.error) ||
          appT.providerListLoadFailedDescription ||
          "未能读取可用 Provider，请重试。",
        onRetry: retryProviderList,
      };
    }

    if (
      activeProviderSchemaState.status === "loading" &&
      !activeProviderSchemaState.data
    ) {
      return {
        key: "provider-schema-loading",
        status: "loading" as const,
        title: appT.loadingProviderSchema || "正在加载 Provider 参数定义...",
        description:
          appT.loadingProviderSchemaDescription ||
          "参数表单和命令映射会在 schema 就绪后继续可用。",
        onRetry: retryProviderSchema,
      };
    }

    if (activeProviderSchemaState.status === "error") {
      return {
        key: "provider-schema-error",
        status: "error" as const,
        title: appT.providerSchemaLoadFailed || "Provider 参数定义加载失败",
        description:
          String(activeProviderSchemaState.error) ||
          appT.providerSchemaLoadFailedDescription ||
          "无法读取当前 Provider 的参数定义，请重试。",
        onRetry: retryProviderSchema,
      };
    }

    return null;
  }, [
    activeProviderSchemaState,
    appT.loadingProviderSchema,
    appT.loadingProviderSchemaDescription,
    appT.loadingProviders,
    appT.loadingProvidersDescription,
    appT.providerListLoadFailed,
    appT.providerListLoadFailedDescription,
    appT.providerSchemaLoadFailed,
    appT.providerSchemaLoadFailedDescription,
    providerListState,
    retryProviderList,
    retryProviderSchema,
  ]);

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

  return (
    <div className="flex h-screen flex-col bg-background">
      {providerRuntimeBanner ? (
        <ProviderRuntimeBanner
          key={providerRuntimeBanner.key}
          title={providerRuntimeBanner.title}
          description={providerRuntimeBanner.description}
          status={providerRuntimeBanner.status}
          retryLabel={appT.retryAction || "重试"}
          onRetry={providerRuntimeBanner.onRetry}
        />
      ) : null}

      {/* Main Content - Three Column Layout (no separate title bar) */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel - Repository List */}
        <SidebarPanelShell
          collapsed={leftPanelCollapsed}
          width={`${effectiveLeftPanelWidth}px`}
        >
          <Suspense fallback={<div className="flex h-full flex-col" />}>
            <RepositoryList
              repositories={repositories}
              selectedRepoId={selectedRepoId}
              providers={repositoryProviders}
              onSelectRepo={selectRepository}
              onAddRepo={handleAddRepo}
              onOpenRepoDirectory={handleOpenRepoDirectory}
              onEditRepo={handleEditRepo}
              onRemoveRepo={handleRemoveRepo}
              onDetectProvider={handleDetectRepoProvider}
              onScanProjectCandidates={handleScanProjectCandidates}
              onRefreshBranches={handleRefreshRepoBranches}
              branchConnectivityByRepoId={branchConnectivityByRepoId}
              onSettings={handleOpenSettings}
              onCollapse={() => setLeftPanelCollapsed(true)}
              onReorderRepositories={reorderRepositories}
            />
          </Suspense>
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
          <Suspense fallback={<div className="flex h-full flex-col" />}>
            <PublishConfigPanel
              selectedPreset={selectedPreset}
              isCustomMode={isCustomMode}
              profiles={profiles}
              isProfilesRefreshing={Boolean(selectedRepo) && isProfilesRefreshing}
              activeProfileName={activeProfileName}
              onSelectProfile={handleSelectProfileFromPanel}
              onCreateProfile={openQuickCreateProfileDialog}
              onEditProfile={openQuickEditProfileDialog}
              onRefreshProfiles={loadProfiles}
              onOpenConfigDialog={() => handleConfigDialogOpenChange(true)}
              onDeleteProfile={handleDeleteProfileFromPanel}
              projectPublishProfiles={orderedProjectPublishProfiles}
              isProjectProfilesRefreshing={isProjectProfilesRefreshing}
              projectFilePath={projectInfo?.project_file}
              projectFrameworkOptions={projectFrameworkOptions}
              onSelectProjectProfile={handleSelectProjectProfile}
              onCopyProjectProfileToCustom={handleCreateProfileFromProjectProfile}
              recentConfigKeys={recentConfigKeys}
              favoriteConfigKeys={favoriteConfigKeys}
              onToggleFavoriteConfig={toggleFavoriteConfig}
              onRemoveRecentConfig={removeRecentConfig}
              onReorderRecentConfigs={reorderRecentConfig}
              onReorderProjectProfiles={reorderProjectPublishProfiles}
              onReorderProfiles={handleReorderProfiles}
              onCollapse={() => setMiddlePanelCollapsed(true)}
              showExpandButton={leftPanelCollapsed}
              onExpandRepo={() => setLeftPanelCollapsed(false)}
            />
          </Suspense>
        </SidebarPanelShell>

        {/* Middle Resize Handle */}
        {!middlePanelCollapsed && (
          <ResizeHandle onResize={handleMiddlePanelResize} />
        )}

        {/* Right Panel - Main Content */}
        <Suspense fallback={<div className="flex h-full flex-1 flex-col" />}>
          <MainContentShell
            leftPanelCollapsed={leftPanelCollapsed}
            middlePanelCollapsed={middlePanelCollapsed}
            appT={appT}
            configPanelT={translations.configPanel || {}}
            rightPanelView={rightPanelView}
            onExpandLeftPanel={() => setLeftPanelCollapsed(false)}
            onExpandMiddlePanel={() => setMiddlePanelCollapsed(false)}
            onSelectHomeView={() => setRightPanelView("home")}
            onSelectHistoryView={() => setRightPanelView("history")}
          >
            <Suspense fallback={<div className="flex h-full flex-col" />}>
              <PublishContentSection
                showCommandImportResultCard={showCommandImportResultCard}
                commandImportResultCardProps={commandImportResultCardProps}
                publishRunCardProps={publishRunCardProps}
                shouldLoadDiagnosticsSection={shouldLoadDiagnosticsSection}
                diagnosticsSectionProps={diagnosticsSectionProps}
                rightPanelView={rightPanelView}
              />
            </Suspense>
          </MainContentShell>
        </Suspense>
      </div>

      {shouldLoadAppDialogsHost ? (
        <Suspense fallback={null}>
          <AppDialogsHost
            shortcutsOpen={shortcutsOpen}
            setShortcutsOpen={setShortcutsOpen}
            environmentDialogOpen={environmentDialogOpen}
            handleEnvironmentDialogOpenChange={handleEnvironmentDialogOpenChange}
            environmentDefaultProviderIds={environmentDefaultProviderIds}
            environmentInitialCheck={environmentInitialCheck}
            setEnvironmentLastCheck={setEnvironmentLastCheck}
            settingsOpen={settingsOpen}
            setSettingsOpen={setSettingsOpen}
            language={language}
            handleLanguageChange={handleLanguageChange}
            minimizeToTrayOnClose={minimizeToTrayOnClose}
            setMinimizeToTrayOnClose={setMinimizeToTrayOnClose}
            defaultOutputDir={defaultOutputDir}
            setDefaultOutputDir={setDefaultOutputDir}
            executionHistoryLimit={executionHistoryLimit}
            setExecutionHistoryLimit={setExecutionHistoryLimit}
            environmentProviderIds={environmentProviderIds}
            setEnvironmentProviderIds={setEnvironmentProviderIds}
            isRerunChecklistEnabled={isRerunChecklistEnabled}
            setIsRerunChecklistEnabled={setIsRerunChecklistEnabled}
            theme={theme}
            setTheme={setTheme}
            handleConfigDialogOpenChange={handleConfigDialogOpenChange}
            environmentLastCheck={environmentLastCheck}
            openEnvironmentDialog={openEnvironmentDialog}
            activeProviderId={activeProviderId}
            updaterState={updaterState}
            checkForUpdates={async () => {
              await checkForUpdates();
            }}
            installAvailableUpdate={installAvailableUpdate}
            openUpdaterHelpTarget={openUpdaterHelpTarget}
            rerunChecklistOpen={rerunChecklistOpen}
            pendingRerunRecord={pendingRerunRecord}
            selectedRepoCurrentBranch={selectedRepo?.currentBranch}
            rerunChecklistState={rerunChecklistState}
            rerunT={rerunT}
            setRerunChecklistOpen={setRerunChecklistOpen}
            setRerunChecklistState={setRerunChecklistState}
            closeRerunChecklistDialog={closeRerunChecklistDialog}
            confirmRerunWithChecklist={confirmRerunWithChecklist}
            releaseChecklistOpen={releaseChecklistOpen}
            setReleaseChecklistOpen={setReleaseChecklistOpen}
            publishResult={publishResult}
            packageResult={artifactActionState.packageResult}
            signResult={artifactActionState.signResult}
            handleOpenSettings={handleOpenSettings}
            selectedRepoExists={Boolean(selectedRepo)}
            commandImportOpen={commandImportOpen}
            setCommandImportOpen={setCommandImportOpen}
            handleCommandImport={handleCommandImport}
            quickCreateProfileOpen={quickCreateProfileOpen}
            quickCreateTemplateId={quickCreateTemplateId}
            quickCreateTemplateOptions={quickCreateTemplateOptions}
            quickCreateProfileName={quickCreateProfileName}
            quickCreateProfileGroup={quickCreateProfileGroup}
            quickCreateProfileGroupOptions={quickCreateProfileGroupOptions}
            quickCreateProfileCustomGroup={quickCreateProfileCustomGroup}
            quickCreateProfileDraft={quickCreateProfileDraft}
            projectFrameworkOptions={projectFrameworkOptions}
            quickCreateProfileSaving={quickCreateProfileSaving}
            quickCreateEditing={isQuickCreateEditing}
            dotnetSchema={providerSchemas.dotnet}
            quickCreateGroupDefaultValue={QUICK_CREATE_PROFILE_GROUP_DEFAULT}
            quickCreateGroupCustomValue={QUICK_CREATE_PROFILE_GROUP_CUSTOM}
            profileT={profileT}
            appT={appT}
            cancelLabel={rerunT.cancel || "取消"}
            handleQuickCreateProfileOpenChange={handleQuickCreateProfileOpenChange}
            applyQuickCreateTemplate={applyQuickCreateTemplate}
            setQuickCreateProfileName={setQuickCreateProfileName}
            setQuickCreateProfileGroup={setQuickCreateProfileGroup}
            setQuickCreateProfileCustomGroup={setQuickCreateProfileCustomGroup}
            updateQuickCreateProfileDraft={updateQuickCreateProfileDraft}
            handleQuickCreateProfileSave={handleQuickCreateProfileSave}
            configDialogOpen={configDialogOpen}
            loadProfiles={loadProfiles}
            handleLoadProfile={handleLoadProfile}
            selectedRepoId={selectedRepoId}
            customConfig={customConfig}
            activeProviderParameters={activeProviderParameters}
            projectFile={projectInfo?.project_file}
            selectedRepoPath={selectedRepo?.path}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

export default App;
