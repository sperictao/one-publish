import { useState, useEffect, useCallback, useMemo } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

// Hooks
import { useAppDialogs } from "@/hooks/useAppDialogs";
import { useAppState } from "@/hooks/useAppState";
import { useTheme } from "@/hooks/useTheme";
import { useShortcuts } from "@/hooks/useShortcuts";
import { useDiagnosticsExports } from "@/hooks/useDiagnosticsExports";
import { useRepositoryActions } from "@/hooks/useRepositoryActions";
import { useRecoverableSpec } from "@/hooks/useRecoverableSpec";
import { useRerunFlow } from "@/hooks/useRerunFlow";
import { useProjectScanner } from "@/hooks/useProjectScanner";
import { usePresetText } from "@/hooks/usePresetText";
import {
  usePublishExecution,
  type ProviderPublishSpec,
  type PublishResult,
} from "@/hooks/usePublishExecution";
import {
  useProfiles,
  QUICK_CREATE_PROFILE_GROUP_CUSTOM,
  QUICK_CREATE_PROFILE_GROUP_DEFAULT,
} from "@/hooks/useProfiles";
import { useCommandImport } from "@/hooks/useCommandImport";
import { useScopedConfigs } from "@/hooks/useScopedConfigs";
import { useHistoryActions } from "@/hooks/useHistoryActions";
import { useHistoryViewState } from "@/hooks/useHistoryViewState";
import { useEnvironmentStatus } from "@/hooks/useEnvironmentStatus";
import { useDialogDerivedState } from "@/hooks/useDialogDerivedState";
import { useProviderRuntime } from "@/hooks/useProviderRuntime";
import { useAppDialogsProps } from "@/hooks/useAppDialogsProps";
import { useI18n, type Language } from "@/hooks/useI18n";
import { cn } from "@/lib/utils";
import {
  addExecutionRecord,
  checkRepositoryBranchConnectivity,
  getExecutionHistory,
  type ExecutionRecord,
  type PublishConfigStore,
  type ProviderManifest,
} from "@/lib/store";

// Layout Components
import { AppDialogs } from "@/components/layout/AppDialogs";
import { CollapsiblePanel } from "@/components/layout/CollapsiblePanel";
import { RepositoryList } from "@/components/layout/RepositoryList";
import { PublishConfigPanel } from "@/components/layout/PublishConfigPanel";
import { ResizeHandle } from "@/components/layout/ResizeHandle";

// Publish Components
import { CommandImportResultCard } from "@/components/publish/CommandImportResultCard";
import { ExecutionHistoryCard } from "@/components/publish/ExecutionHistoryCard";
import { DotnetPublishCard } from "@/components/publish/DotnetPublishCard";
import { FailureGroupDetailCard } from "@/components/publish/FailureGroupDetailCard";
import { GenericProviderPublishCard } from "@/components/publish/GenericProviderPublishCard";
import { FailureGroupsCard } from "@/components/publish/FailureGroupsCard";
import { OutputLogCard } from "@/components/publish/OutputLogCard";

// UI Components
import { Button } from "@/components/ui/button";
import {
  Folder,
  Settings,
  Loader2,
} from "lucide-react";

// Types
import type { EnvironmentCheckResult } from "@/lib/environment";
import { deriveFailureSignature } from "@/lib/failureSignature";
import { type IssueDraftTemplate } from "@/lib/issueDraft";
import {
  type HistoryFilterStatus,
  type HistoryFilterWindow,
} from "@/lib/historyFilterPresets";
import {
  getRepresentativeRecord,
  groupExecutionFailures,
  type FailureGroup,
} from "@/lib/failureGroups";
import {
  loadRerunChecklistPreference,
  saveRerunChecklistPreference,
} from "@/lib/rerunChecklistPreference";
import { isRecordInRepository } from "@/features/history/utils/historyFilters";

interface ProjectInfo {
  root_path: string;
  project_file: string;
  publish_profiles: string[];
}

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

const FALLBACK_PROVIDERS: ProviderManifest[] = [
  { id: "dotnet", displayName: "dotnet", version: "1" },
  { id: "cargo", displayName: "cargo", version: "1" },
  { id: "go", displayName: "go", version: "1" },
  { id: "java", displayName: "java", version: "1" },
];

function formatProviderLabel(provider: ProviderManifest): string {
  if (provider.id === "dotnet") return ".NET (dotnet)";
  if (provider.id === "cargo") return "Rust (cargo)";
  if (provider.id === "go") return "Go";
  if (provider.id === "java") return "Java (gradle)";
  return provider.displayName || provider.id;
}

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

  // Layout State (local only - collapse state doesn't need persistence)
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [middlePanelCollapsed, setMiddlePanelCollapsed] = useState(false);
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
  const [environmentLastResult, setEnvironmentLastResult] =
    useState<EnvironmentCheckResult | null>(null);
  const [isRerunChecklistEnabled, setIsRerunChecklistEnabled] = useState(
    () => loadRerunChecklistPreference().enabled
  );
  // Min/Max constraints
  const MIN_PANEL_WIDTH = 150;
  const MAX_PANEL_WIDTH = 400;

  // 按 2:2:6 比例计算默认面板宽度（用户未自定义时）
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);

  useEffect(() => {
    if (panelWidthsCustomized) return;
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [panelWidthsCustomized]);

  const effectiveLeftPanelWidth = panelWidthsCustomized
    ? leftPanelWidth
    : Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, Math.round(windowWidth * 0.2)));
  const effectiveMiddlePanelWidth = panelWidthsCustomized
    ? middlePanelWidth
    : Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, Math.round(windowWidth * 0.2)));

  // Resize handlers
  const handleLeftPanelResize = useCallback(
    (delta: number) => {
      const newWidth = Math.max(
        MIN_PANEL_WIDTH,
        Math.min(MAX_PANEL_WIDTH, effectiveLeftPanelWidth + delta)
      );
      setLeftPanelWidth(newWidth);
    },
    [effectiveLeftPanelWidth, setLeftPanelWidth]
  );

  const handleMiddlePanelResize = useCallback(
    (delta: number) => {
      const newWidth = Math.max(
        MIN_PANEL_WIDTH,
        Math.min(MAX_PANEL_WIDTH, effectiveMiddlePanelWidth + delta)
      );
      setMiddlePanelWidth(newWidth);
    },
    [effectiveMiddlePanelWidth, setMiddlePanelWidth]
  );

  // Project State (runtime only)
  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null);
  const [recentBundleExports, setRecentBundleExports] = useState<string[]>([]);
  const [recentHistoryExports, setRecentHistoryExports] = useState<string[]>([]);
  const [executionHistory, setExecutionHistory] = useState<ExecutionRecord[]>([]);
  const [historyFilterProvider, setHistoryFilterProvider] = useState("all");
  const [historyFilterStatus, setHistoryFilterStatus] =
    useState<HistoryFilterStatus>("all");
  const [historyFilterWindow, setHistoryFilterWindow] =
    useState<HistoryFilterWindow>("all");
  const [historyFilterKeyword, setHistoryFilterKeyword] = useState("");
  const [selectedFailureGroupKey, setSelectedFailureGroupKey] =
    useState<string | null>(null);
  const [issueDraftTemplate, setIssueDraftTemplate] =
    useState<IssueDraftTemplate>("bug");
  const [issueDraftSections, setIssueDraftSections] = useState({
    impact: true,
    workaround: true,
    owner: false,
  });
  const [branchConnectivityByRepoId, setBranchConnectivityByRepoId] = useState<
    Record<string, boolean>
  >({});

  // Get selected repository
  const selectedRepo = repositories.find((r) => r.id === selectedRepoId) || null;

  useEffect(() => {
    let cancelled = false;

    if (repositories.length === 0) {
      setBranchConnectivityByRepoId({});
      return;
    }

    const checkBranchConnectivity = async () => {
      const entries = await Promise.all(
        repositories.map(async (repo) => {
          try {
            const result = await checkRepositoryBranchConnectivity(
              repo.path,
              repo.currentBranch
            );
            return [repo.id, result.canConnect] as const;
          } catch {
            return [repo.id, false] as const;
          }
        })
      );

      if (cancelled) {
        return;
      }

      setBranchConnectivityByRepoId(
        Object.fromEntries(entries) as Record<string, boolean>
      );
    };

    void checkBranchConnectivity();

    return () => {
      cancelled = true;
    };
  }, [repositories]);

  const { 
    recentConfigKeys,
    favoriteConfigKeys,
    pushRecentConfig,
    removeRecentConfig,
    toggleFavoriteConfig,
  } = useScopedConfigs(selectedRepoId);

  const availableProviders =
    providerRuntimeProviders.length > 0 ? providerRuntimeProviders : FALLBACK_PROVIDERS;
  const resolvedActiveProvider =
    activeProvider ||
    availableProviders.find((p) => p.id === activeProviderId) ||
    availableProviders[0] ||
    FALLBACK_PROVIDERS[0];
  const activeProviderLabel = formatProviderLabel(resolvedActiveProvider);

  const scopedExecutionHistory = useMemo(() => {
    if (!selectedRepo) {
      return [];
    }

    return executionHistory.filter((record) =>
      isRecordInRepository(record, selectedRepo)
    );
  }, [executionHistory, selectedRepo]);

  const historyProviderOptions = useMemo(
    () =>
      Array.from(
        new Set(scopedExecutionHistory.map((record) => record.providerId))
      ).sort(),
    [scopedExecutionHistory]
  );

  const {
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
  } = useHistoryViewState({
    historyT,
    scopedExecutionHistory,
    historyFilterProvider,
    historyFilterStatus,
    historyFilterWindow,
    historyFilterKeyword,
    setHistoryFilterProvider,
    setHistoryFilterStatus,
    setHistoryFilterWindow,
    setHistoryFilterKeyword,
  });

  const snapshotPaths = useMemo(
    () =>
      Array.from(
        new Set(
          scopedExecutionHistory
            .map((record) => record.snapshotPath?.trim())
            .filter((value): value is string => Boolean(value))
        )
      ),
    [scopedExecutionHistory]
  );

  const failureGroups = useMemo<FailureGroup[]>(
    () => groupExecutionFailures(filteredExecutionHistory),
    [filteredExecutionHistory]
  );

  const selectedFailureGroup = useMemo(
    () =>
      failureGroups.find((group) => group.key === selectedFailureGroupKey) ||
      null,
    [failureGroups, selectedFailureGroupKey]
  );

  const representativeFailureRecord = useMemo(
    () =>
      selectedFailureGroup ? getRepresentativeRecord(selectedFailureGroup) : null,
    [selectedFailureGroup]
  );

  const environmentStatus = useEnvironmentStatus(environmentLastResult);

  const { commandImportProjectPath, currentConfigParameters } =
    useDialogDerivedState({
      activeProviderId,
      customConfig,
      activeProviderParameters,
      projectFile: projectInfo?.project_file,
      selectedRepoPath: selectedRepo?.path,
    });

  const handleCustomConfigUpdate = useCallback(
    (updates: Partial<PublishConfigStore>) => {
      setCustomConfig({ ...customConfig, ...updates });
    },
    [customConfig, setCustomConfig]
  );

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

  const persistExecutionRecord = useCallback((record: ExecutionRecord) => {
    addExecutionRecord(record)
      .then((history) => {
        setExecutionHistory(history);
      })
      .catch((err) => {
        console.error("保存执行历史失败:", err);
      });
  }, []);

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

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  const handleSelectPresetValueChange = useCallback(
    (presetValue: string) => {
      if (presetValue.startsWith("profile-")) {
        handleSelectProjectProfile(presetValue.slice("profile-".length));
        return;
      }

      setSelectedPreset(presetValue);
      setIsCustomMode(false);
      setActiveProfileName(null);
    },
    [handleSelectProjectProfile, setActiveProfileName, setIsCustomMode, setSelectedPreset]
  );

  useEffect(() => {
    getExecutionHistory()
      .then((history) => {
        setExecutionHistory(history);
      })
      .catch((err) => {
        console.error("加载执行历史失败:", err);
      });
  }, []);

  useEffect(() => {
    saveRerunChecklistPreference({ enabled: isRerunChecklistEnabled });
  }, [isRerunChecklistEnabled]);

  useEffect(() => {
    setExecutionHistory((prev) => prev.slice(0, executionHistoryLimit));
  }, [executionHistoryLimit]);

  useEffect(() => {
    if (failureGroups.length === 0) {
      if (selectedFailureGroupKey !== null) {
        setSelectedFailureGroupKey(null);
      }
      return;
    }

    if (
      !selectedFailureGroupKey ||
      !failureGroups.some((group) => group.key === selectedFailureGroupKey)
    ) {
      setSelectedFailureGroupKey(failureGroups[0].key);
    }
  }, [failureGroups, selectedFailureGroupKey]);

  // Load project info when repo or provider changes
  useEffect(() => {
    if (!selectedRepo || isStateLoading) return;

    if (activeProviderId === "dotnet") {
      scanProject(selectedRepo.path, {
        silentSuccess: true,
        silentFailure: true,
      });
      return;
    }

    setProjectInfo(null);
  }, [selectedRepoId, isStateLoading, activeProviderId]);

  // Setup window drag functionality for Tauri 2.x
  useEffect(() => {
    if (!(window as any).__TAURI__) {
      return;
    }

    const appWindow = getCurrentWindow();

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Check if the target or any parent has data-tauri-drag-region
      const dragRegion = target.closest("[data-tauri-drag-region]");
      const noDrag = target.closest("[data-tauri-no-drag]");

      if (dragRegion && !noDrag && e.buttons === 1) {
        e.preventDefault();
        if (e.detail === 2) {
          // Double click to toggle maximize
          void appWindow.toggleMaximize().catch(() => {});
        } else {
          // Single click to start dragging
          void appWindow.startDragging().catch(() => {});
        }
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, []);

  const { scanProject } = useProjectScanner({
    appT,
    setProjectInfo,
  });

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

  const buildExecutionRecord = useCallback(
    (params: {
      spec: ProviderPublishSpec;
      repoId: string | null;
      startedAt: string;
      finishedAt: string;
      result: PublishResult;
      output: string;
    }): ExecutionRecord => {
      const commandLine =
        params.output
          .split("\n")
          .find((line) => line.startsWith("$ ")) || null;
      const failureSignature =
        !params.result.success && !params.result.cancelled
          ? deriveFailureSignature({
              error: params.result.error,
              output: params.output,
            })
          : null;

      return {
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        repoId: params.repoId,
        providerId: params.spec.provider_id,
        projectPath: params.spec.project_path,
        startedAt: params.startedAt,
        finishedAt: params.finishedAt,
        success: params.result.success,
        cancelled: params.result.cancelled,
        outputDir: params.result.output_dir || null,
        error: params.result.error,
        commandLine,
        snapshotPath: null,
        failureSignature,
        spec: params.spec,
        fileCount: params.result.file_count,
      };
    },
    []
  );

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
    pushRecentConfig,
    openEnvironmentDialog,
    setEnvironmentLastResult,
    buildExecutionRecord,
    persistExecutionRecord,
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

  const trackBundleExport = useCallback((outputPath: string) => {
    setRecentBundleExports((prev) =>
      [outputPath, ...prev.filter((item) => item !== outputPath)].slice(0, 20)
    );
  }, []);

  const trackHistoryExport = useCallback((outputPath: string) => {
    setRecentHistoryExports((prev) =>
      [outputPath, ...prev.filter((item) => item !== outputPath)].slice(0, 20)
    );
  }, []);

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

  const appDialogsProps = useAppDialogsProps({
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
    environmentStatus,
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
    commandImportProjectPath,
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
    currentConfigParameters,
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
        <div className={cn(
          "flex flex-col p-2 transition-all duration-300 ease-in-out",
          leftPanelCollapsed && "p-0"
        )}>
          <CollapsiblePanel
            collapsed={leftPanelCollapsed}
            side="left"
            width={`${effectiveLeftPanelWidth}px`}
            className="glass-card repo-sidebar-shell h-full rounded-2xl"
          >
            <RepositoryList
              repositories={repositories}
              selectedRepoId={selectedRepoId}
              providers={availableProviders.map((provider) => ({
                ...provider,
                label: formatProviderLabel(provider),
              }))}
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
          </CollapsiblePanel>
        </div>

        {/* Left Resize Handle */}
        {!leftPanelCollapsed && (
          <ResizeHandle onResize={handleLeftPanelResize} showHeaderBorder={false} />
        )}

        {/* Middle Panel - Publish Config */}
        <div
          className={cn(
            "flex flex-col p-2 transition-all duration-300 ease-in-out",
            middlePanelCollapsed && "p-0"
          )}
        >
          <CollapsiblePanel
            collapsed={middlePanelCollapsed}
            side="left"
            width={`${effectiveMiddlePanelWidth}px`}
            className="glass-card repo-sidebar-shell h-full rounded-2xl"
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
          </CollapsiblePanel>
        </div>

        {/* Middle Resize Handle */}
        {!middlePanelCollapsed && (
          <ResizeHandle onResize={handleMiddlePanelResize} />
        )}

        {/* Right Panel - Main Content */}
        <div className="flex-1 flex flex-col p-2">
          <div className="glass-card repo-sidebar-shell flex h-full flex-col overflow-hidden rounded-2xl">
            {/* Drag region header */}
            <div className="h-10 flex-shrink-0 bg-[var(--glass-panel-bg)]/30 flex">
              {/* Left column for expand buttons - only show when branch panel is collapsed */}
              {middlePanelCollapsed && (
                <div
                  data-tauri-drag-region
                  className={`flex items-center justify-end px-2 ${
                    leftPanelCollapsed ? "pl-[100px]" : ""
                  }`}
                >
                  <div className="flex items-center gap-0.5" data-tauri-no-drag>
                    {leftPanelCollapsed && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLeftPanelCollapsed(false);
                        }}
                        title={appT.expandRepoList || "展开仓库列表"}
                        data-tauri-no-drag
                      >
                        <Folder className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMiddlePanelCollapsed(false);
                      }}
                      title={(translations.configPanel || {}).expandConfigList || "展开配置列表"}
                      data-tauri-no-drag
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
              {/* Main drag region */}
              <div data-tauri-drag-region className="flex-1" />
            </div>
            {/* Content area */}
            <div className="repo-list-scroll glass-scrollbar relative flex-1 overflow-auto">
              <div className="mx-auto max-w-3xl space-y-6 p-6">
                {/* Publish Configuration Card */}
                {selectedRepo && activeProviderId === "dotnet" && projectInfo && (
                <DotnetPublishCard
                  configT={configT}
                  appT={appT}
                  publishT={publishT}
                  isCustomMode={isCustomMode}
                  selectedPreset={selectedPreset}
                  releasePresets={PRESETS.filter((preset) => preset.id.startsWith("release")).map((preset) => ({
                    ...preset,
                    ...getPresetText(preset.id, preset.name, preset.description),
                  }))}
                  debugPresets={PRESETS.filter((preset) => preset.id.startsWith("debug")).map((preset) => ({
                    ...preset,
                    ...getPresetText(preset.id, preset.name, preset.description),
                  }))}
                  projectPublishProfiles={projectInfo.publish_profiles}
                  customConfig={customConfig}
                  dotnetPublishPreviewCommand={dotnetPublishPreviewCommand}
                  isPublishing={isPublishing}
                  isCancellingPublish={isCancellingPublish}
                  disabled={!selectedRepo}
                  onOpenCommandImport={() => setCommandImportOpen(true)}
                  onCustomModeChange={setIsCustomMode}
                  onPresetChange={handleSelectPresetValueChange}
                  onCustomConfigUpdate={handleCustomConfigUpdate}
                  onExecutePublish={executePublish}
                  onCancelPublish={cancelPublish}
                />
              )}

              {selectedRepo && activeProviderId !== "dotnet" && (
                <GenericProviderPublishCard
                  activeProviderLabel={activeProviderLabel}
                  activeProviderSchema={activeProviderSchema}
                  activeProviderParameters={activeProviderParameters}
                  appT={appT}
                  configT={configT}
                  isPublishing={isPublishing}
                  isCancellingPublish={isCancellingPublish}
                  onOpenCommandImport={() => setCommandImportOpen(true)}
                  onProviderParametersChange={handleProviderParametersChange}
                  onOpenEnvironmentCheck={() =>
                    openEnvironmentDialog(null, [activeProviderId])
                  }
                  onExecutePublish={executePublish}
                  onCancelPublish={cancelPublish}
                />
              )}

              {selectedRepo && activeImportFeedback && (
                <CommandImportResultCard
                  activeImportFeedback={activeImportFeedback}
                  providerLabel={formatProviderLabel(resolvedActiveProvider)}
                  appT={appT}
                />
              )}

              <OutputLogCard
                outputLog={outputLog}
                publishResult={publishResult}
                appT={appT}
                isExportingSnapshot={isExportingSnapshot}
                onExportExecutionSnapshot={exportExecutionSnapshot}
                onOpenReleaseChecklist={() => setReleaseChecklistOpen(true)}
                onArtifactActionStateChange={setArtifactActionState}
              />

              <FailureGroupsCard
                failureGroups={failureGroups}
                selectedFailureGroupKey={selectedFailureGroupKey}
                failureT={failureT}
                isPublishing={isPublishing}
                onSelectFailureGroup={setSelectedFailureGroupKey}
                onCopyGroupSignature={copyGroupSignature}
                onOpenSnapshotFromRecord={openSnapshotFromRecord}
                onRerunFromHistory={rerunFromHistory}
              />

              <FailureGroupDetailCard
                selectedFailureGroup={selectedFailureGroup}
                representativeFailureRecord={representativeFailureRecord}
                issueDraftTemplate={issueDraftTemplate}
                issueDraftSections={issueDraftSections}
                failureT={failureT}
                appT={appT}
                isExportingFailureBundle={isExportingFailureBundle}
                isPublishing={isPublishing}
                onIssueDraftTemplateChange={setIssueDraftTemplate}
                onToggleIssueDraftSection={(key) =>
                  setIssueDraftSections((prev) => ({
                    ...prev,
                    [key]: !prev[key],
                  }))
                }
                onCopyGroupSignature={copyGroupSignature}
                onCopyRecordCommand={copyRecordCommand}
                onCopyFailureIssueDraft={copyFailureIssueDraft}
                onExportFailureGroupBundle={exportFailureGroupBundle}
                onOpenSnapshotFromRecord={openSnapshotFromRecord}
                onRerunFromHistory={rerunFromHistory}
              />

              <ExecutionHistoryCard
                scopedExecutionHistory={scopedExecutionHistory}
                filteredExecutionHistory={filteredExecutionHistory}
                executionHistoryLimit={executionHistoryLimit}
                historyProviderOptions={historyProviderOptions}
                historyFilterProvider={historyFilterProvider}
                historyFilterStatus={historyFilterStatus}
                historyFilterWindow={historyFilterWindow}
                historyFilterKeyword={historyFilterKeyword}
                selectedHistoryPresetId={effectiveSelectedHistoryPresetId}
                historyFilterPresets={historyFilterPresets}
                dailyTriagePreset={dailyTriagePreset}
                dailyTriageRecords={dailyTriageRecords}
                isExportingHistory={isExportingHistory}
                isExportingDiagnosticsIndex={isExportingDiagnosticsIndex}
                isPublishing={isPublishing}
                appT={appT}
                historyT={historyT}
                failureT={failureT}
                onHistoryFilterProviderChange={setHistoryFilterProvider}
                onHistoryFilterStatusChange={setHistoryFilterStatus}
                onHistoryFilterWindowChange={setHistoryFilterWindow}
                onHistoryFilterKeywordChange={setHistoryFilterKeyword}
                onApplyHistoryPreset={applyHistoryPresetToFilters}
                onSaveCurrentHistoryPreset={saveCurrentHistoryPreset}
                onDeleteSelectedHistoryPreset={deleteSelectedHistoryPreset}
                onDailyTriagePresetChange={setDailyTriagePreset}
                onResetDailyTriagePreset={resetDailyTriagePreset}
                onExportExecutionHistory={exportExecutionHistory}
                onExportDailyTriageReport={exportDailyTriageReport}
                onExportDiagnosticsIndex={exportDiagnosticsIndex}
                onClearFilters={clearHistoryFilters}
                onOpenSnapshotFromRecord={openSnapshotFromRecord}
                onRerunFromHistory={rerunFromHistory}
                onCopyHandoffSnippet={copyHandoffSnippet}
              />
              </div>
            </div>
          </div>
        </div>
      </div>

      <AppDialogs {...appDialogsProps} />
    </div>
  );
}

export default App;
