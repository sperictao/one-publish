import { useCallback, useMemo } from "react";
import { useAppState } from "@/hooks/useAppState";
import { useShellBoot, type UseShellBootReturn } from "@/hooks/useShellBoot";
import { useRepoBoot, type UseRepoBootReturn } from "@/hooks/useRepoBoot";
import { usePublishBoot, type UsePublishBootReturn } from "@/hooks/usePublishBoot";
import { useProviderRuntime } from "@/features/provider/useProviderRuntime";
import { useProviderParametersState } from "@/features/provider/useProviderParametersState";
import { usePublishHistoryState } from "@/features/history/usePublishHistoryState";
import { useEditorProviderState } from "@/features/provider/useEditorProviderState";
import { useProviderPresentationState } from "@/features/provider/useProviderPresentationState";
import { useRerunFlow } from "@/hooks/useRerunFlow";
import { useTrayRecentPublish } from "@/hooks/useTrayRecentPublish";
import { usePublishStore } from "@/store/publishStore";

const SPEC_VERSION = 1;

export type ShellState = UseShellBootReturn;
export type RepoState = UseRepoBootReturn;
export type PublishState = UsePublishBootReturn;

export function useAppBoot() {
  // ============================================================
  // 1. Persisted application state
  // ============================================================
  const appState = useAppState();

  // ============================================================
  // 2. Lifted hooks (shared by multiple domains, no deps on domain hooks)
  // ============================================================

  // Provider runtime (no external deps)
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

  // Provider parameters state
  const { activeProviderParameters, setProviderParameters } =
    useProviderParametersState({ activeProviderId });

  // Publish history state
  const {
    isRerunChecklistEnabled,
    setIsRerunChecklistEnabled,
    executionHistory,
    savePublishRecord,
  } = usePublishHistoryState({
    executionHistoryLimit: appState.executionHistoryLimit,
  });

  // Publish store (global Zustand selectors)
  const isPublishing = usePublishStore((s) => s.isPublishing);
  const isCancellingPublish = usePublishStore((s) => s.isCancellingPublish);
  const publishResult = usePublishStore((s) => s.publishResult);
  const releaseChecklistOpen = usePublishStore((s) => s.releaseChecklistOpen);
  const setReleaseChecklistOpen = usePublishStore((s) => s.setReleaseChecklistOpen);
  const artifactActionState = usePublishStore((s) => s.artifactActionState);

  // ============================================================
  // 3. Shell domain (layout, dialogs, theme, i18n, shortcuts, updater)
  // ============================================================

  // Shortcut callbacks built as closures that capture the latest values.
  // These are initially placeholders; they will be correct after the first
  // render when repo and publish state becomes available. This is safe
  // because shortcuts are event-driven and never fire during render.
  const shell = useShellBoot({
    isStateLoading: appState.isLoading,
    theme: appState.theme as "light" | "dark" | "auto",
    setTheme: appState.setTheme,
    preferenceLanguage: appState.language,
    setPreferenceLanguage: appState.setLanguage,
    minimizeToTrayOnClose: appState.minimizeToTrayOnClose,
    setMinimizeToTrayOnClose: appState.setMinimizeToTrayOnClose,
    defaultOutputDir: appState.defaultOutputDir,
    setDefaultOutputDir: appState.setDefaultOutputDir,
    executionHistoryLimit: appState.executionHistoryLimit,
    setExecutionHistoryLimit: appState.setExecutionHistoryLimit,
    environmentProviderIds: appState.environmentProviderIds,
    setEnvironmentProviderIds: appState.setEnvironmentProviderIds,
    startupNotice: appState.startupNotice,
    leftPanelWidth: appState.leftPanelWidth,
    middlePanelWidth: appState.middlePanelWidth,
    panelWidthsCustomized: appState.panelWidthsCustomized,
    setLeftPanelWidth: appState.setLeftPanelWidth,
    setMiddlePanelWidth: appState.setMiddlePanelWidth,
    // Shortcut handlers — built after all domains below
    onRefreshShortcut: undefined,
    onPublishShortcut: undefined,
  });

  // ============================================================
  // 4. Provider presentation (lifted — needs appT from shell)
  // ============================================================
  const {
    activeProviderUsesProjectFile,
    activeProviderRequiresProjectBinding,
    repositoryProviders,
  } = useProviderPresentationState({
    providerRuntimeProviders,
    providerListState,
    activeProviderSchemaState,
    activeProvider,
    activeProviderId,
    appT: shell.appT,
    retryProviderList,
    retryProviderSchema,
  });

  // Editor provider state (depends on providerRuntimeProviders, selectedRepo)
  const selectedRepoForEditor =
    appState.repositories.find((r) => r.id === appState.selectedRepoId) ?? null;

  const {
    applyProfileProvider,
    applyRecoveredSpecProvider,
    applySelectedRepositoryProvider,
  } = useEditorProviderState({
    availableProviders: providerRuntimeProviders,
    selectedRepo: selectedRepoForEditor,
    setActiveProviderId,
  });

  // ============================================================
  // 5. Repo domain
  // ============================================================
  const repo = useRepoBoot({
    repositories: appState.repositories,
    selectedRepoId: appState.selectedRepoId,
    addRepository: appState.addRepository,
    removeRepository: appState.removeRepository,
    updateRepository: appState.updateRepository,
    reorderRepositories: appState.reorderRepositories,
    selectRepository: appState.selectRepository,
    appT: shell.appT,
    providerRuntimeProviders,
    isStateLoading: appState.isLoading,
    activeProviderUsesProjectFile,
    applySelectedRepositoryProvider,
    setCustomConfig: appState.setCustomConfig,
    setIsCustomMode: appState.setIsCustomMode,
    applyRecoveredSpecProvider,
    setProviderParameters,
  });

  // ============================================================
  // 6. Publish domain
  // ============================================================
  const publish = usePublishBoot({
    // From useAppState
    selectedPreset: appState.selectedPreset,
    isCustomMode: appState.isCustomMode,
    customConfig: appState.customConfig,
    setSelectedPreset: appState.setSelectedPreset,
    setIsCustomMode: appState.setIsCustomMode,
    setCustomConfig: appState.setCustomConfig,
    recentConfigKeysByRepo: appState.recentConfigKeysByRepo,
    pushRecentPublishConfig: appState.pushRecentPublishConfig,
    removeRecentPublishConfig: appState.removeRecentPublishConfig,
    reorderRecentPublishConfigs: appState.reorderRecentPublishConfigs,
    replaceRecentPublishConfigKey: appState.replaceRecentPublishConfigKey,
    defaultOutputDir: appState.defaultOutputDir,
    executionHistoryLimit: appState.executionHistoryLimit,
    // From shell domain
    configT: shell.configT,
    publishT: shell.publishT,
    appT: shell.appT,
    historyT: shell.historyT,
    failureT: shell.failureT,
    rerunT: shell.rerunT,
    profileT: shell.profileT,
    language: shell.language,
    openEnvironmentDialog: shell.openEnvironmentDialog,
    leftPanelCollapsed: shell.leftPanelCollapsed,
    setLeftPanelCollapsed: shell.setLeftPanelCollapsed,
    middlePanelCollapsed: shell.middlePanelCollapsed,
    setMiddlePanelCollapsed: shell.setMiddlePanelCollapsed,
    rightPanelView: shell.rightPanelView,
    handleConfigDialogOpenChange: shell.handleConfigDialogOpenChange,
    // From repo domain
    selectedRepoId: repo.selectedRepoId,
    selectedRepo: repo.selectedRepo,
    projectInfo: repo.projectInfo,
    isProjectInfoRefreshing: repo.isProjectInfoRefreshing,
    scanProject: repo.scanProject,
    orderedProjectPublishProfiles: repo.orderedProjectPublishProfiles,
    reorderProjectPublishProfiles: repo.reorderProjectPublishProfiles,
    extractSpecFromRecord: repo.extractSpecFromRecord,
    restoreSpecToEditor: repo.restoreSpecToEditor,
    getRecentConfigKeyFromSpec: repo.getRecentConfigKeyFromSpec,
    setEnvironmentLastCheck: repo.setEnvironmentLastCheck,
    recentHistoryExports: repo.recentHistoryExports,
    trackHistoryExport: repo.trackHistoryExport,
    // Lifted provider state
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
    // Lifted publish history state
    isRerunChecklistEnabled,
    setIsRerunChecklistEnabled,
    executionHistory,
    savePublishRecord,
    // Lifted publish store state
    isPublishing,
    isCancellingPublish,
    publishResult,
    releaseChecklistOpen,
    setReleaseChecklistOpen,
    artifactActionState,
  });

  // ============================================================
  // 7. Cross-domain hooks (need both repo and publish values)
  // ============================================================

  // Rerun flow
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
    historyT: shell.historyT,
    rerunT: shell.rerunT,
    extractSpecFromRecord: repo.extractSpecFromRecord,
    restoreSpecToEditor: repo.restoreSpecToEditor,
    getRecentConfigKeyFromSpec: repo.getRecentConfigKeyFromSpec,
    runPublishSpec: publish.runPublishSpec,
  });

  // Tray recent publish
  useTrayRecentPublish({
    appT: shell.appT,
    defaultOutputDir: appState.defaultOutputDir,
    specVersion: SPEC_VERSION,
    runPublishSpec: publish.runPublishSpec,
  });

  // ============================================================
  // 8. Shortcut callbacks (built after all domains for correct closures)
  // ============================================================
  const onRefreshShortcut = useCallback(() => {
    if (repo.selectedRepo && !appState.isLoading && activeProviderUsesProjectFile) {
      repo.scanProject(repo.selectedRepo.path, {
        projectFile: repo.selectedRepo.projectFile ?? undefined,
      });
    }
  }, [repo.selectedRepo, appState.isLoading, activeProviderUsesProjectFile, repo.scanProject]);

  const onPublishShortcut = useCallback(() => {
    if (isPublishing) {
      return;
    }
    if (activeProviderRequiresProjectBinding) {
      if (repo.projectInfo) {
        publish.startPublish();
      }
      return;
    }
    if (repo.selectedRepo) {
      publish.startPublish();
    }
  }, [isPublishing, activeProviderRequiresProjectBinding, repo.projectInfo, repo.selectedRepo, publish.startPublish]);

  // ============================================================
  // 9. Fix up diagnosticsSectionProps with actual rerunFromHistory
  // ============================================================
  const diagnosticsSectionProps = useMemo(() => {
    if (!publish.diagnosticsSectionProps) {
      return null;
    }
    return {
      ...publish.diagnosticsSectionProps,
      rerunFromHistory,
    };
  }, [publish.diagnosticsSectionProps, rerunFromHistory]);

  // ============================================================
  // 10. Compute shouldLoadAppDialogsHost (includes publish/rurun dialogs)
  // ============================================================
  const shouldLoadAppDialogsHost =
    shell.shouldLoadAppDialogsHost ||
    rerunChecklistOpen ||
    releaseChecklistOpen ||
    publish.quickCreateProfileOpen;

  // ============================================================
  // 11. Merge return objects (maintain backward compatibility with App.tsx)
  // ============================================================
  return {
    shell: {
      ...shell,
      // Override shortcut handlers with correct closures
      onRefreshShortcut,
      onPublishShortcut,
      shouldLoadAppDialogsHost,
    },
    repo: {
      repositories: repo.repositories,
      selectedRepoId: repo.selectedRepoId,
      addRepository: repo.addRepository,
      removeRepository: repo.removeRepository,
      updateRepository: repo.updateRepository,
      reorderRepositories: repo.reorderRepositories,
      selectRepository: repo.selectRepository,
      selectedRepo: repo.selectedRepo,
      branchConnectivityByRepoId: repo.branchConnectivityByRepoId,
      handleAddRepo: repo.handleAddRepo,
      handleRemoveRepo: repo.handleRemoveRepo,
      handleOpenRepoDirectory: repo.handleOpenRepoDirectory,
      handleEditRepo: repo.handleEditRepo,
      handleDetectRepoProvider: repo.handleDetectRepoProvider,
      handleScanProjectCandidates: repo.handleScanProjectCandidates,
      handleRefreshRepoBranches: repo.handleRefreshRepoBranches,
      environmentLastCheck: repo.environmentLastCheck,
      setEnvironmentLastCheck: repo.setEnvironmentLastCheck,
      recentHistoryExports: repo.recentHistoryExports,
      trackHistoryExport: repo.trackHistoryExport,
      repositoryProviders,
    },
    publish: {
      ...publish,
      diagnosticsSectionProps,
      rerunChecklistOpen,
      setRerunChecklistOpen,
      pendingRerunRecord,
      rerunChecklistState,
      setRerunChecklistState,
      rerunFromHistory,
      closeRerunChecklistDialog,
      confirmRerunWithChecklist,
    },
  };
}
