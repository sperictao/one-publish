import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "sonner";

// Hooks
import { useAppState } from "@/hooks/useAppState";
import { useTheme } from "@/hooks/useTheme";
import { useShortcuts } from "@/hooks/useShortcuts";
import { useDiagnosticsExports } from "@/hooks/useDiagnosticsExports";
import { useRepositoryActions } from "@/hooks/useRepositoryActions";
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
import { useI18n, type Language } from "@/hooks/useI18n";
import { cn } from "@/lib/utils";
import {
  addExecutionRecord,
  checkRepositoryBranchConnectivity,
  getExecutionHistory,
  getProviderSchema,
  listProviders,
  openExecutionSnapshot,
  setExecutionRecordSnapshot,
  type ExecutionRecord,
  type PublishConfigStore,
  type ProviderManifest,
} from "@/lib/store";

// Layout Components
import { CollapsiblePanel } from "@/components/layout/CollapsiblePanel";
import { RepositoryList } from "@/components/layout/RepositoryList";
import { PublishConfigPanel } from "@/components/layout/PublishConfigPanel";
import { ResizeHandle } from "@/components/layout/ResizeHandle";
import { SettingsDialog } from "@/components/layout/SettingsDialog";
import { ShortcutsDialog } from "@/components/layout/ShortcutsDialog";
import { EnvironmentCheckDialog } from "@/components/environment/EnvironmentCheckDialog";

// Publish Components
import { CommandImportDialog } from "@/components/publish/CommandImportDialog";
import { ConfigDialog } from "@/components/publish/ConfigDialog";
import { ParameterEditor } from "@/components/publish/ParameterEditor";
import { ExecutionHistoryCard } from "@/components/publish/ExecutionHistoryCard";
import { OutputLogCard } from "@/components/publish/OutputLogCard";
import { ReleaseChecklistDialog } from "@/components/release/ReleaseChecklistDialog";

// UI Components
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Folder,
  Play,
  Settings,
  Loader2,
  Import,
  Square,
  Copy,
  Save,
  Check,
} from "lucide-react";

// Types
import type { EnvironmentCheckResult } from "@/lib/environment";
import { mapImportedSpecByProvider } from "@/lib/commandImportMapping";
import { deriveFailureSignature } from "@/lib/failureSignature";
import {
  analyzeProjectScanFailure,
  extractInvokeErrorMessage,
} from "@/lib/tauri/invokeErrors";
import {
  buildGitHubActionsSnippet,
  buildShellHandoffSnippet,
  type HandoffSnippetFormat,
} from "@/lib/handoffSnippet";
import {
  buildFailureIssueDraft,
  type IssueDraftTemplate,
} from "@/lib/issueDraft";
import {
  DEFAULT_DAILY_TRIAGE_PRESET,
  loadDailyTriagePreset,
  loadHistoryFilterPresets,
  saveDailyTriagePreset,
  saveHistoryFilterPresets,
  type DailyTriagePreset,
  type HistoryFilterStatus,
  type HistoryFilterPreset,
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
import {
  filterExecutionHistory,
  isRecordInRepository,
} from "@/features/history/utils/historyFilters";
import type { ParameterSchema, ParameterValue } from "@/types/parameters";

interface ProjectInfo {
  root_path: string;
  project_file: string;
  publish_profiles: string[];
}

interface PublishConfig {
  configuration: string;
  runtime: string;
  self_contained: boolean;
  output_dir: string;
  use_profile: boolean;
  profile_name: string;
}

interface ImportFeedback {
  providerId: string;
  mappedKeys: string[];
  unmappedKeys: string[];
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

const toDotnetProfileParameters = (
  config: Pick<
    PublishConfigStore,
    "configuration" | "runtime" | "outputDir" | "selfContained"
  >
) => ({
  configuration: config.configuration,
  runtime: config.runtime,
  output: config.outputDir,
  self_contained: config.selfContained,
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

  const presetTextMap = useMemo(
    () => ({
      "release-fd": {
        name: configT.releaseFd || "Release - 框架依赖",
        description: configT.releaseFdDesc || "推荐用于开发/测试",
      },
      "release-win-x64": {
        name: configT.releaseWin || "Release - Windows x64",
        description: configT.releaseWinDesc || "自包含部署",
      },
      "release-osx-arm64": {
        name: configT.releaseOsxA || "Release - macOS ARM64",
        description: configT.releaseOsxADesc || "Apple Silicon",
      },
      "release-osx-x64": {
        name: configT.releaseOsxX || "Release - macOS x64",
        description: configT.releaseOsxXDesc || "Intel Mac",
      },
      "release-linux-x64": {
        name: configT.releaseLinux || "Release - Linux x64",
        description: configT.releaseLinuxDesc || "自包含部署",
      },
      "debug-fd": {
        name: configT.debugFd || "Debug - 框架依赖",
        description: configT.debugFdDesc || "调试模式",
      },
      "debug-win-x64": {
        name: configT.debugWin || "Debug - Windows x64",
        description: configT.debugWinDesc || "自包含部署",
      },
      "debug-osx-arm64": {
        name: configT.debugOsxA || "Debug - macOS ARM64",
        description: configT.debugOsxADesc || "Apple Silicon",
      },
      "debug-osx-x64": {
        name: configT.debugOsxX || "Debug - macOS x64",
        description: configT.debugOsxXDesc || "Intel Mac",
      },
      "debug-linux-x64": {
        name: configT.debugLinux || "Debug - Linux x64",
        description: configT.debugLinuxDesc || "自包含部署",
      },
    }),
    [configT]
  );

  const getPresetText = useCallback(
    (presetId: string, fallbackName: string, fallbackDescription: string) => {
      const presetText =
        presetTextMap[presetId as keyof typeof presetTextMap] || null;
      return {
        name: presetText?.name || fallbackName,
        description: presetText?.description || fallbackDescription,
      };
    },
    [presetTextMap]
  );

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

  const [providers, setProviders] = useState<ProviderManifest[]>([]);
  const [activeProviderId, setActiveProviderId] = useState("dotnet");
  const [providerSchemas, setProviderSchemas] = useState<
    Record<string, ParameterSchema>
  >({});
  const [providerParameters, setProviderParameters] = useState<
    Record<string, Record<string, ParameterValue>>
  >({});
  const [lastImportFeedback, setLastImportFeedback] =
    useState<ImportFeedback | null>(null);

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [commandImportOpen, setCommandImportOpen] = useState(false);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);

  // Recently used config keys (persisted in localStorage, scoped by repo id)
  const RECENT_CONFIGS_KEY = "one-publish:recentConfigs";
  const FAVORITE_CONFIGS_KEY = "one-publish:favoriteConfigs";
  const LEGACY_CONFIG_SCOPE = "__legacy__";
  const MAX_RECENT = 6;

  const parseScopedConfigKeys = useCallback((storageKey: string) => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        return {} as Record<string, string[]>;
      }

      const parsed = JSON.parse(raw);

      if (Array.isArray(parsed)) {
        const legacy = parsed.filter((item): item is string => typeof item === "string");
        if (legacy.length === 0) {
          return {} as Record<string, string[]>;
        }
        return { [LEGACY_CONFIG_SCOPE]: legacy };
      }

      if (!parsed || typeof parsed !== "object") {
        return {} as Record<string, string[]>;
      }

      return Object.entries(parsed as Record<string, unknown>).reduce<Record<string, string[]>>(
        (acc, [repoId, keys]) => {
          if (!Array.isArray(keys)) {
            return acc;
          }

          const normalized = keys.filter(
            (item): item is string => typeof item === "string"
          );

          if (normalized.length > 0) {
            acc[repoId] = normalized;
          }

          return acc;
        },
        {}
      );
    } catch {
      return {} as Record<string, string[]>;
    }
  }, []);

  const persistScopedConfigKeys = useCallback(
    (storageKey: string, data: Record<string, string[]>) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(data));
      } catch {
        // noop
      }
    },
    []
  );

  const [recentConfigByRepo, setRecentConfigByRepo] = useState<Record<string, string[]>>(() =>
    parseScopedConfigKeys(RECENT_CONFIGS_KEY)
  );
  const [favoriteConfigByRepo, setFavoriteConfigByRepo] = useState<Record<string, string[]>>(() =>
    parseScopedConfigKeys(FAVORITE_CONFIGS_KEY)
  );

  useEffect(() => {
    if (!selectedRepoId) {
      return;
    }

    setRecentConfigByRepo((prev) => {
      const legacy = prev[LEGACY_CONFIG_SCOPE];
      if (!legacy || prev[selectedRepoId]) {
        return prev;
      }

      const next = {
        ...prev,
        [selectedRepoId]: legacy,
      };
      delete next[LEGACY_CONFIG_SCOPE];
      persistScopedConfigKeys(RECENT_CONFIGS_KEY, next);
      return next;
    });

    setFavoriteConfigByRepo((prev) => {
      const legacy = prev[LEGACY_CONFIG_SCOPE];
      if (!legacy || prev[selectedRepoId]) {
        return prev;
      }

      const next = {
        ...prev,
        [selectedRepoId]: legacy,
      };
      delete next[LEGACY_CONFIG_SCOPE];
      persistScopedConfigKeys(FAVORITE_CONFIGS_KEY, next);
      return next;
    });
  }, [selectedRepoId, persistScopedConfigKeys]);

  const recentConfigKeys = useMemo(() => {
    if (!selectedRepoId) {
      return [];
    }
    return recentConfigByRepo[selectedRepoId] ?? [];
  }, [recentConfigByRepo, selectedRepoId]);

  const favoriteConfigKeys = useMemo(() => {
    if (!selectedRepoId) {
      return [];
    }
    return favoriteConfigByRepo[selectedRepoId] ?? [];
  }, [favoriteConfigByRepo, selectedRepoId]);

  const pushRecentConfig = useCallback(
    (key: string, repoId: string | null = selectedRepoId) => {
      if (!repoId) {
        return;
      }

      setRecentConfigByRepo((prev) => {
        const scoped = prev[repoId] ?? [];
        const nextScoped = [key, ...scoped.filter((k) => k !== key)].slice(0, MAX_RECENT);
        const next = {
          ...prev,
          [repoId]: nextScoped,
        };
        persistScopedConfigKeys(RECENT_CONFIGS_KEY, next);
        return next;
      });
    },
    [selectedRepoId, persistScopedConfigKeys]
  );

  const removeRecentConfig = useCallback(
    (key: string, repoId: string | null = selectedRepoId) => {
      if (!repoId) {
        return;
      }

      setRecentConfigByRepo((prev) => {
        const scoped = prev[repoId] ?? [];
        const next = {
          ...prev,
          [repoId]: scoped.filter((k) => k !== key),
        };
        persistScopedConfigKeys(RECENT_CONFIGS_KEY, next);
        return next;
      });
    },
    [selectedRepoId, persistScopedConfigKeys]
  );

  const toggleFavoriteConfig = useCallback(
    (key: string, repoId: string | null = selectedRepoId) => {
      if (!repoId) {
        return;
      }

      const scoped = favoriteConfigByRepo[repoId] ?? [];
      const isFavorite = scoped.includes(key);

      setFavoriteConfigByRepo((prev) => {
        const current = prev[repoId] ?? [];
        const nextScoped = isFavorite
          ? current.filter((k) => k !== key)
          : [key, ...current.filter((k) => k !== key)];

        const next = {
          ...prev,
          [repoId]: nextScoped,
        };
        persistScopedConfigKeys(FAVORITE_CONFIGS_KEY, next);
        return next;
      });

      if (!isFavorite) {
        pushRecentConfig(key, repoId);
      }
    },
    [selectedRepoId, favoriteConfigByRepo, persistScopedConfigKeys, pushRecentConfig]
  );

  const [environmentDialogOpen, setEnvironmentDialogOpen] = useState(false);
  const [environmentDefaultProviderIds, setEnvironmentDefaultProviderIds] =
    useState<string[]>(["dotnet"]);
  const [environmentInitialResult, setEnvironmentInitialResult] =
    useState<EnvironmentCheckResult | null>(null);
  const [environmentLastResult, setEnvironmentLastResult] =
    useState<EnvironmentCheckResult | null>(null);
  const [isRerunChecklistEnabled, setIsRerunChecklistEnabled] = useState(
    () => loadRerunChecklistPreference().enabled
  );
  const [rerunChecklistOpen, setRerunChecklistOpen] = useState(false);
  const [pendingRerunRecord, setPendingRerunRecord] =
    useState<ExecutionRecord | null>(null);
  const [rerunChecklistState, setRerunChecklistState] = useState({
    branch: false,
    environment: false,
    output: false,
  });
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
  const [historyFilterPresets, setHistoryFilterPresets] = useState<
    HistoryFilterPreset[]
  >([]);
  const [dailyTriagePreset, setDailyTriagePreset] = useState<DailyTriagePreset>(
    () => loadDailyTriagePreset()
  );
  const [selectedHistoryPresetId, setSelectedHistoryPresetId] =
    useState("none");
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

  // Open settings dialog
  const handleOpenSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);

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

  const availableProviders =
    providers.length > 0 ? providers : FALLBACK_PROVIDERS;
  const activeProvider =
    availableProviders.find((p) => p.id === activeProviderId) ||
    availableProviders[0] ||
    FALLBACK_PROVIDERS[0];
  const activeProviderLabel = formatProviderLabel(activeProvider);
  const activeProviderSchema = providerSchemas[activeProviderId];
  const activeProviderParameters = providerParameters[activeProviderId] || {};
  const activeImportFeedback =
    lastImportFeedback?.providerId === activeProviderId
      ? lastImportFeedback
      : null;

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

  const filteredExecutionHistory = useMemo(
    () =>
      filterExecutionHistory(scopedExecutionHistory, {
        provider: historyFilterProvider,
        status: historyFilterStatus,
        window: historyFilterWindow,
        keyword: historyFilterKeyword,
      }),
    [
      scopedExecutionHistory,
      historyFilterProvider,
      historyFilterStatus,
      historyFilterWindow,
      historyFilterKeyword,
    ]
  );

  const dailyTriageRecords = useMemo(
    () =>
      filterExecutionHistory(scopedExecutionHistory, {
        provider: dailyTriagePreset.provider,
        status: dailyTriagePreset.status,
        window: dailyTriagePreset.window,
        keyword: dailyTriagePreset.keyword,
      }),
    [scopedExecutionHistory, dailyTriagePreset]
  );

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

  const environmentStatus = useMemo(() => {
    if (!environmentLastResult) return "unknown" as const;
    if (environmentLastResult.issues.some((i) => i.severity === "critical")) {
      return "blocked" as const;
    }
    if (environmentLastResult.issues.some((i) => i.severity === "warning")) {
      return "warning" as const;
    }
    return "ready" as const;
  }, [environmentLastResult]);

  const commandImportProjectPath = useMemo(() => {
    if (projectInfo?.project_file) return projectInfo.project_file;
    return selectedRepo?.path || "";
  }, [projectInfo, selectedRepo]);

  const openEnvironmentDialog = useCallback(
    (
      initialResult: EnvironmentCheckResult | null = null,
      providerIds: string[] = [activeProviderId]
    ) => {
      setEnvironmentDefaultProviderIds(providerIds);
      setEnvironmentInitialResult(initialResult);
      setEnvironmentDialogOpen(true);
    },
    [activeProviderId]
  );

  const handleCustomConfigUpdate = useCallback(
    (updates: Partial<PublishConfigStore>) => {
      setCustomConfig({ ...customConfig, ...updates });
    },
    [customConfig, setCustomConfig]
  );

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
    buildProfileParameters: toDotnetProfileParameters,
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
    let mounted = true;

    listProviders()
      .then((items) => {
        if (!mounted) return;
        if (items.length > 0) {
          setProviders(items);
          if (!items.some((item) => item.id === activeProviderId)) {
            setActiveProviderId(items[0].id);
          }
        }
      })
      .catch((err) => {
        console.error("加载 Provider 列表失败:", err);
      });

    loadProfiles();

    return () => {
      mounted = false;
    };
  }, []);

  // 切换仓库时重新加载 profiles
  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    if (providerSchemas[activeProviderId]) return;

    let mounted = true;

    getProviderSchema(activeProviderId)
      .then((schema) => {
        if (!mounted) return;
        setProviderSchemas((prev) => ({
          ...prev,
          [activeProviderId]: schema,
        }));
      })
      .catch((err) => {
        console.error("加载 Provider Schema 失败:", err);
      });

    return () => {
      mounted = false;
    };
  }, [activeProviderId, providerSchemas]);

  useEffect(() => {
    getExecutionHistory()
      .then((history) => {
        setExecutionHistory(history);
      })
      .catch((err) => {
        console.error("加载执行历史失败:", err);
      });

    setHistoryFilterPresets(loadHistoryFilterPresets());
  }, []);

  useEffect(() => {
    saveHistoryFilterPresets(historyFilterPresets);
  }, [historyFilterPresets]);

  useEffect(() => {
    saveDailyTriagePreset(dailyTriagePreset);
  }, [dailyTriagePreset]);

  useEffect(() => {
    saveRerunChecklistPreference({ enabled: isRerunChecklistEnabled });
  }, [isRerunChecklistEnabled]);

  useEffect(() => {
    if (
      selectedHistoryPresetId !== "none" &&
      !historyFilterPresets.some((preset) => preset.id === selectedHistoryPresetId)
    ) {
      setSelectedHistoryPresetId("none");
    }
  }, [historyFilterPresets, selectedHistoryPresetId]);

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

  // Scan for project
  const scanProject = useCallback(
    async (
      path?: string,
      options?: { silentSuccess?: boolean; silentFailure?: boolean }
    ) => {
      const silentSuccess = options?.silentSuccess ?? false;
      const silentFailure = options?.silentFailure ?? false;

      try {
        const info = await invoke<ProjectInfo>("scan_project", {
          startPath: path,
        });
        setProjectInfo(info);

        if (!silentSuccess) {
          toast.success(appT.scanProjectSuccess || "项目检测成功", {
            description: `${appT.foundProject || "找到项目"}: ${info.project_file}`,
          });
        }
      } catch (err) {
        setProjectInfo(null);

        if (silentFailure) {
          return;
        }

        const rawErrorMessage = extractInvokeErrorMessage(err);
        const failureReason = analyzeProjectScanFailure(err);

        if (failureReason === "path_not_found") {
          toast.error(appT.scanProjectPathNotFound || "Project Root 路径不存在", {
            description:
              appT.scanProjectPathNotFoundDesc || "请确认 Project Root 路径存在且可访问。",
          });
          return;
        }

        if (failureReason === "project_root_not_found") {
          toast.error(appT.scanProjectRootNotFound || "未检测到项目根目录", {
            description:
              appT.scanProjectRootNotFoundDesc ||
              "未找到 .sln 文件，请确认当前目录或上级目录包含解决方案文件。",
          });
          return;
        }

        if (failureReason === "project_file_not_found") {
          toast.error(appT.scanProjectFileNotFound || "未检测到项目文件", {
            description:
              appT.scanProjectFileNotFoundDesc ||
              "已找到解决方案，但未发现 .csproj 文件，请检查项目结构。",
          });
          return;
        }

        if (failureReason === "permission_denied") {
          toast.error(appT.scanProjectPermissionDenied || "缺少目录访问权限", {
            description:
              appT.scanProjectPermissionDeniedDesc ||
              "请检查当前用户对 Project Root 及其父目录的读取权限。",
          });
          return;
        }

        if (failureReason === "current_dir_failed") {
          toast.error(appT.scanProjectCurrentDirFailed || "读取当前目录失败", {
            description:
              appT.scanProjectCurrentDirFailedDesc ||
              "请确认应用运行目录有效，或手动指定 Project Root 后重试。",
          });
          return;
        }

        toast.error(appT.scanProjectFailed || "项目检测失败", {
          description: rawErrorMessage,
        });
      }
    },
    [appT]
  );

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

  // Convert store config to publish config
  const storeConfigToPublishConfig = (
    config: PublishConfigStore
  ): PublishConfig => ({
    configuration: config.configuration,
    runtime: config.runtime,
    self_contained: config.selfContained,
    output_dir: config.outputDir,
    use_profile: config.useProfile,
    profile_name: config.profileName,
  });

  // Get current publish config
  const getCurrentConfig = useCallback((): PublishConfig => {
    if (isCustomMode) {
      // 自定义模式，如果用户没有指定输出目录，使用默认目录
      const config = storeConfigToPublishConfig(customConfig);
      if (!config.output_dir && defaultOutputDir) {
        return { ...config, output_dir: defaultOutputDir };
      }
      return config;
    }

    if (selectedPreset.startsWith("profile-")) {
      const profileName = selectedPreset.slice("profile-".length).trim();
      if (profileName) {
        return {
          configuration: "Release",
          runtime: "",
          self_contained: false,
          output_dir: "",
          use_profile: true,
          profile_name: profileName,
        };
      }
    }

    const preset = PRESETS.find((p) => p.id === selectedPreset);
    if (!preset) {
      const config = storeConfigToPublishConfig(customConfig);
      return {
        ...config,
        output_dir: config.output_dir || defaultOutputDir || "",
      };
    }

    // 预设模式：优先使用默认目录，否则使用项目特定目录
    const outputDir = defaultOutputDir
      ? defaultOutputDir
      : projectInfo
        ? `${projectInfo.root_path}/publish/${selectedPreset}`
        : "";

    return {
      ...preset.config,
      output_dir: outputDir,
      use_profile: false,
      profile_name: "",
    };
  }, [isCustomMode, customConfig, selectedPreset, projectInfo, defaultOutputDir]);

  const dotnetPublishPreviewCommand = useMemo(() => {
    if (!projectInfo) {
      return "";
    }

    const config = getCurrentConfig();
    const baseCommand = `dotnet publish "${projectInfo.project_file}"`;

    if (config.use_profile && config.profile_name) {
      return `${baseCommand} -p:PublishProfile="${config.profile_name}"`;
    }

    return [
      baseCommand,
      `-c ${config.configuration}`,
      config.runtime ? `--runtime ${config.runtime}` : null,
      config.self_contained ? "--self-contained" : null,
      config.output_dir ? `-o "${config.output_dir}"` : null,
    ]
      .filter((part): part is string => Boolean(part))
      .join(" ");
  }, [getCurrentConfig, projectInfo]);

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

  const extractSpecFromRecord = useCallback(
    (record: ExecutionRecord): ProviderPublishSpec | null => {
      const raw = record.spec;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return null;
      }

      const payload = raw as Record<string, unknown>;
      const providerId = payload.provider_id;
      const projectPath = payload.project_path;
      if (typeof providerId !== "string" || typeof projectPath !== "string") {
        return null;
      }

      const version =
        typeof payload.version === "number" ? payload.version : SPEC_VERSION;
      const parametersRaw = payload.parameters;
      const parameters =
        parametersRaw &&
        typeof parametersRaw === "object" &&
        !Array.isArray(parametersRaw)
          ? (parametersRaw as Record<string, unknown>)
          : {};

      return {
        version,
        provider_id: providerId,
        project_path: projectPath,
        parameters,
      };
    },
    []
  );

  const restoreSpecToEditor = useCallback(
    (spec: ProviderPublishSpec) => {
      setActiveProviderId(spec.provider_id);

      if (spec.provider_id === "dotnet") {
        const parameters = spec.parameters || {};
        const propertiesRaw = parameters.properties;
        const properties =
          propertiesRaw &&
          typeof propertiesRaw === "object" &&
          !Array.isArray(propertiesRaw)
            ? (propertiesRaw as Record<string, unknown>)
            : null;
        const profileName =
          properties && typeof properties.PublishProfile === "string"
            ? properties.PublishProfile
            : "";

        if (profileName) {
          setCustomConfig({
            ...customConfig,
            configuration: "Release",
            runtime: "",
            selfContained: false,
            outputDir:
              typeof parameters.output === "string" ? parameters.output : "",
            useProfile: true,
            profileName,
          });
        } else {
          setCustomConfig({
            ...customConfig,
            configuration:
              typeof parameters.configuration === "string"
                ? parameters.configuration
                : "Release",
            runtime: typeof parameters.runtime === "string" ? parameters.runtime : "",
            selfContained: parameters.self_contained === true,
            outputDir:
              typeof parameters.output === "string" ? parameters.output : "",
            useProfile: false,
            profileName: "",
          });
        }

        setIsCustomMode(true);
      } else {
        setProviderParameters((prev) => ({
          ...prev,
          [spec.provider_id]: spec.parameters as Record<string, ParameterValue>,
        }));
      }
    },
    [customConfig, setCustomConfig, setIsCustomMode]
  );

  const getRecentConfigKeyFromSpec = useCallback(
    (spec: ProviderPublishSpec) => {
      if (spec.provider_id !== "dotnet") {
        return null;
      }

      const propertiesRaw = spec.parameters?.properties;
      if (
        propertiesRaw &&
        typeof propertiesRaw === "object" &&
        !Array.isArray(propertiesRaw)
      ) {
        const profileName = (propertiesRaw as Record<string, unknown>).PublishProfile;
        if (typeof profileName === "string" && profileName.trim()) {
          return `pubxml:${profileName.trim()}`;
        }
      }

      return null;
    },
    []
  );

  const copyText = useCallback(async (text: string, label: string) => {
    const normalized = text.trim();
    if (!normalized) {
      toast.error((appT.missingCopyTarget || "缺少可复制的{{label}}")
        .replace("{{label}}", label));
      return;
    }

    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(normalized);
      } else {
        const input = document.createElement("textarea");
        input.value = normalized;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.focus();
        input.select();

        const copied = document.execCommand("copy");
        document.body.removeChild(input);

        if (!copied) {
          throw new Error(appT.copyFailed || "复制失败");
        }
      }

      toast.success((appT.copySuccess || "{{label}}已复制").replace("{{label}}", label));
    } catch (err) {
      toast.error((appT.copyFailedWithLabel || "复制{{label}}失败").replace("{{label}}", label), { description: String(err) });
    }
  }, []);

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

  const copyGroupSignature = useCallback(
    async (group: FailureGroup) => {
      await copyText(group.signature, failureT.signatureLabel || "失败签名");
    },
    [copyText]
  );

  const copyFailureIssueDraft = useCallback(
    async (group: FailureGroup) => {
      const representative = getRepresentativeRecord(group);
      const draft = buildFailureIssueDraft({
        providerId: group.providerId,
        signature: group.signature,
        frequency: group.count,
        representativeCommand: representative.commandLine,
        template: issueDraftTemplate,
        includeImpact: issueDraftSections.impact,
        includeWorkaround: issueDraftSections.workaround,
        includeOwner: issueDraftSections.owner,
        records: group.records.map((record) => ({
          id: record.id,
          finishedAt: record.finishedAt,
          projectPath: record.projectPath,
          error: record.error,
          commandLine: record.commandLine,
          snapshotPath: record.snapshotPath,
          outputDir: record.outputDir,
        })),
      });

      await copyText(draft, failureT.issueDraftLabel || "Issue 草稿");
    },
    [copyText, issueDraftSections, issueDraftTemplate]
  );

  const copyRecordCommand = useCallback(
    async (record: ExecutionRecord) => {
      if (!record.commandLine) {
        toast.error(failureT.missingCommandLine || "该记录缺少命令行信息");
        return;
      }

      await copyText(record.commandLine, failureT.commandLineLabel || "命令行");
    },
    [copyText]
  );

  const copyHandoffSnippet = useCallback(
    async (record: ExecutionRecord, format: HandoffSnippetFormat) => {
      if (!record.success) {
        toast.error(historyT.handoffOnlySuccess || "仅成功记录支持生成交接片段");
        return;
      }

      const spec = extractSpecFromRecord(record);
      if (!spec) {
        toast.error(historyT.missingRecoverableSpec || "该记录缺少可恢复的发布参数");
        return;
      }

      const snippet =
        format === "shell"
          ? buildShellHandoffSnippet({
              spec,
              commandLine: record.commandLine,
            })
          : buildGitHubActionsSnippet({
              spec,
              commandLine: record.commandLine,
            });

      await copyText(
        snippet,
        format === "shell"
          ? historyT.shellSnippetLabel || "Shell 交接片段"
          : historyT.ghaSnippetLabel || "GitHub Actions 交接片段"
      );
    },
    [copyText, extractSpecFromRecord]
  );

  const openSnapshotFromRecord = useCallback(async (record: ExecutionRecord) => {
    try {
      const openedPath = await openExecutionSnapshot({
        snapshotPath: record.snapshotPath ?? null,
        outputDir: record.outputDir ?? null,
      });

      if (!record.snapshotPath || record.snapshotPath !== openedPath) {
        const history = await setExecutionRecordSnapshot(record.id, openedPath);
        setExecutionHistory(history);
      }

      toast.success(historyT.snapshotOpened || "已打开执行快照", { description: openedPath });
    } catch (err) {
      toast.error(historyT.openSnapshotFailed || "打开执行快照失败", { description: String(err) });
    }
  }, []);

  const executeRerunFromRecord = useCallback(
    async (record: ExecutionRecord) => {
      const spec = extractSpecFromRecord(record);
      if (!spec) {
        toast.error(historyT.historyMissingRecoverableSpec || "历史记录缺少可恢复的发布参数", {
          description: historyT.historyMissingRecoverableSpecHint || "请使用最新版本重新执行一次后再重跑",
        });
        return;
      }

      restoreSpecToEditor(spec);
      await runPublishWithSpec(spec, getRecentConfigKeyFromSpec(spec));
    },
    [
      extractSpecFromRecord,
      getRecentConfigKeyFromSpec,
      restoreSpecToEditor,
      runPublishWithSpec,
    ]
  );

  const rerunFromHistory = useCallback(
    async (record: ExecutionRecord) => {
      if (!isRerunChecklistEnabled) {
        await executeRerunFromRecord(record);
        return;
      }

      setPendingRerunRecord(record);
      setRerunChecklistState({
        branch: false,
        environment: false,
        output: false,
      });
      setRerunChecklistOpen(true);
    },
    [executeRerunFromRecord, isRerunChecklistEnabled]
  );

  const closeRerunChecklistDialog = useCallback(() => {
    setRerunChecklistOpen(false);
    setPendingRerunRecord(null);
    setRerunChecklistState({
      branch: false,
      environment: false,
      output: false,
    });
  }, []);

  const confirmRerunWithChecklist = useCallback(async () => {
    if (!pendingRerunRecord) {
      return;
    }

    if (
      !rerunChecklistState.branch ||
      !rerunChecklistState.environment ||
      !rerunChecklistState.output
    ) {
      toast.error(rerunT.requireChecklist || "请先完成重跑前确认清单");
      return;
    }

    const record = pendingRerunRecord;
    closeRerunChecklistDialog();
    await executeRerunFromRecord(record);
  }, [
    closeRerunChecklistDialog,
    executeRerunFromRecord,
    pendingRerunRecord,
    rerunChecklistState,
  ]);

  const applyHistoryPreset = useCallback(
    (presetId: string) => {
      if (presetId === "none") {
        setSelectedHistoryPresetId("none");
        return;
      }

      const preset = historyFilterPresets.find((item) => item.id === presetId);
      if (!preset) {
        toast.error(historyT.presetNotFound || "未找到筛选预设");
        return;
      }

      setHistoryFilterProvider(preset.provider);
      setHistoryFilterStatus(preset.status);
      setHistoryFilterWindow(preset.window);
      setHistoryFilterKeyword(preset.keyword);
      setSelectedHistoryPresetId(preset.id);
    },
    [historyFilterPresets]
  );

  const saveCurrentHistoryPreset = useCallback(() => {
    const defaultName = (historyT.presetNamePrefix || "筛选预设") + ` ${historyFilterPresets.length + 1}`;
    const input =
      typeof window !== "undefined"
        ? window.prompt(historyT.promptPresetName || "输入筛选预设名称", defaultName)
        : defaultName;
    if (!input) {
      return;
    }

    const name = input.trim();
    if (!name) {
      toast.error(historyT.presetNameRequired || "筛选预设名称不能为空");
      return;
    }

    const existingPreset = historyFilterPresets.find((item) => item.name === name);
    const presetId =
      existingPreset?.id || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    const preset: HistoryFilterPreset = {
      id: presetId,
      name,
      provider: historyFilterProvider,
      status: historyFilterStatus,
      window: historyFilterWindow,
      keyword: historyFilterKeyword,
    };

    setHistoryFilterPresets((prev) => {
      const existingIndex = prev.findIndex((item) => item.id === presetId);
      if (existingIndex >= 0) {
        const next = [...prev];
        next[existingIndex] = preset;
        return next;
      }

      return [preset, ...prev].slice(0, 20);
    });

    setSelectedHistoryPresetId(presetId);
    toast.success(historyT.presetSaved || "筛选预设已保存", { description: name });
  }, [
    historyFilterKeyword,
    historyFilterPresets,
    historyFilterProvider,
    historyFilterStatus,
    historyFilterWindow,
  ]);

  const deleteSelectedHistoryPreset = useCallback(() => {
    if (selectedHistoryPresetId === "none") {
      toast.error(historyT.selectPresetToDelete || "请先选择要删除的筛选预设");
      return;
    }

    const current = historyFilterPresets.find(
      (preset) => preset.id === selectedHistoryPresetId
    );

    setHistoryFilterPresets((prev) =>
      prev.filter((preset) => preset.id !== selectedHistoryPresetId)
    );
    setSelectedHistoryPresetId("none");

    toast.success(historyT.presetDeleted || "筛选预设已删除", {
      description: current?.name || "",
    });
  }, [historyFilterPresets, selectedHistoryPresetId]);

  const handleProviderParametersChange = useCallback(
    (parameters: Record<string, ParameterValue>) => {
      setProviderParameters((prev) => ({
        ...prev,
        [activeProviderId]: parameters,
      }));
    },
    [activeProviderId]
  );

  // Handle command import
  const handleCommandImport = (spec: any) => {
    const importedProviderId =
      spec?.provider_id || spec?.providerId || activeProviderId;
    const schema = providerSchemas[importedProviderId];
    const mapping = mapImportedSpecByProvider(spec, activeProviderId, {
      supportedKeys: schema ? Object.keys(schema.parameters) : undefined,
    });

    setLastImportFeedback({
      providerId: mapping.providerId,
      mappedKeys: mapping.mappedKeys,
      unmappedKeys: mapping.unmappedKeys,
    });

    if (mapping.providerId === "dotnet") {
      if (Object.keys(mapping.dotnetUpdates).length > 0) {
        handleCustomConfigUpdate(mapping.dotnetUpdates);
        setIsCustomMode(true);
      }
    } else {
      setProviderParameters((prev) => ({
        ...prev,
        [mapping.providerId]: mapping.providerParameters,
      }));
    }

    if (mapping.mappedKeys.length === 0 && mapping.unmappedKeys.length > 0) {
      toast.error(appT.noMappableParameters || "未找到可映射参数", {
        description: `${appT.unmappedFields || "未映射字段"}: ${mapping.unmappedKeys.join(", ")}`,
      });
      return;
    }

    if (mapping.unmappedKeys.length > 0) {
      toast.message(appT.partialImport || "参数已部分导入", {
        description: `${appT.mappedFields || "已映射"} ${mapping.mappedKeys.length} ${appT.fieldsUnit || "个字段"}，${appT.unmappedFields || "未映射字段"} ${mapping.unmappedKeys.length} ${appT.fieldsUnit || "个字段"}`,
      });
      return;
    }

    toast.success(appT.parametersImported || "参数已导入", {
      description: `${appT.mappedFields || "已映射"} ${mapping.mappedKeys.length} ${appT.fieldsUnit || "个字段"}`,
    });
  };

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
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Settings className="h-5 w-5" />
                          {configT.title || "发布配置"}
                        </CardTitle>
                        <CardDescription>
                          {configT.description || "选择预设配置或自定义发布参数"}
                        </CardDescription>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCommandImportOpen(true)}
                        disabled={!selectedRepo}
                      >
                        <Import className="h-4 w-4 mr-1" />
                        {appT.importFromCommand || "从命令导入"}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Mode Toggle */}
                    <div className="flex items-center justify-between">
                      <Label htmlFor="custom-mode">{configT.customMode || "自定义模式"}</Label>
                      <Switch
                        id="custom-mode"
                        checked={isCustomMode}
                        onCheckedChange={setIsCustomMode}
                      />
                    </div>

                    {!isCustomMode ? (
                      /* Preset Selection */
                      <div className="space-y-2">
                        <Label>{configT.presets || "选择预设配置"}</Label>
                        <Select
                          value={selectedPreset}
                          onValueChange={handleSelectPresetValueChange}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={appT.selectPublishConfig || "选择发布配置"} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectLabel>{appT.releaseConfigs || "Release 配置"}</SelectLabel>
                              {PRESETS.filter((p) =>
                                p.id.startsWith("release")
                              ).map((preset) => {
                                const presetText = getPresetText(
                                  preset.id,
                                  preset.name,
                                  preset.description
                                );

                                return (
                                  <SelectItem key={preset.id} value={preset.id}>
                                    <div className="flex flex-col">
                                      <span>{presetText.name}</span>
                                      <span className="text-xs text-muted-foreground">
                                        {presetText.description}
                                      </span>
                                    </div>
                                  </SelectItem>
                                );
                              })}
                            </SelectGroup>
                            <SelectGroup>
                              <SelectLabel>{appT.debugConfigs || "Debug 配置"}</SelectLabel>
                              {PRESETS.filter((p) =>
                                p.id.startsWith("debug")
                              ).map((preset) => {
                                const presetText = getPresetText(
                                  preset.id,
                                  preset.name,
                                  preset.description
                                );

                                return (
                                  <SelectItem key={preset.id} value={preset.id}>
                                    <div className="flex flex-col">
                                      <span>{presetText.name}</span>
                                      <span className="text-xs text-muted-foreground">
                                        {presetText.description}
                                      </span>
                                    </div>
                                  </SelectItem>
                                );
                              })}
                            </SelectGroup>
                            {projectInfo.publish_profiles.length > 0 && (
                              <SelectGroup>
                                <SelectLabel>{appT.projectPublishProfiles || "项目发布配置"}</SelectLabel>
                                {projectInfo.publish_profiles.map((profile) => (
                                  <SelectItem
                                    key={`profile-${profile}`}
                                    value={`profile-${profile}`}
                                  >
                                    {profile}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : (
                      /* Custom Configuration */
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="configuration">{appT.configurationType || "配置类型"}</Label>
                          <Select
                            value={customConfig.configuration}
                            onValueChange={(v) =>
                              handleCustomConfigUpdate({ configuration: v })
                            }
                          >
                            <SelectTrigger id="configuration">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Release">Release</SelectItem>
                              <SelectItem value="Debug">Debug</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="runtime">{appT.runtimeLabel || "运行时"}</Label>
                          <Select
                            value={customConfig.runtime || "none"}
                            onValueChange={(v) =>
                              handleCustomConfigUpdate({
                                runtime: v === "none" ? "" : v,
                              })
                            }
                          >
                            <SelectTrigger id="runtime">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">{appT.frameworkDependent || "框架依赖"}</SelectItem>
                              <SelectItem value="win-x64">
                                Windows x64
                              </SelectItem>
                              <SelectItem value="osx-arm64">
                                macOS ARM64
                              </SelectItem>
                              <SelectItem value="osx-x64">macOS x64</SelectItem>
                              <SelectItem value="linux-x64">
                                Linux x64
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="col-span-2 space-y-2">
                          <Label htmlFor="output-dir">{appT.outputDirLabel || "输出目录"}</Label>
                          <Input
                            id="output-dir"
                            value={customConfig.outputDir}
                            onChange={(e) =>
                              handleCustomConfigUpdate({
                                outputDir: e.target.value,
                              })
                            }
                            placeholder={appT.outputDirPlaceholder || "留空使用默认目录"}
                          />
                        </div>

                        <div className="col-span-2 flex items-center gap-2">
                          <Switch
                            id="self-contained"
                            checked={customConfig.selfContained}
                            onCheckedChange={(checked) =>
                              handleCustomConfigUpdate({
                                selfContained: checked,
                              })
                            }
                            disabled={!customConfig.runtime}
                          />
                          <Label htmlFor="self-contained">{appT.selfContained || "自包含部署"}</Label>
                        </div>
                      </div>
                    )}

                    {/* Current Config Preview */}
                    <div className="mt-4 p-3 bg-[var(--glass-input-bg)] rounded-xl border border-[var(--glass-border-subtle)]">
                      <div className="text-xs text-muted-foreground mb-2">
                        {publishT.command || "将执行的命令:"}
                      </div>
                      <code className="text-xs font-mono break-all">
                        {dotnetPublishPreviewCommand}
                      </code>
                    </div>

                    {/* Publish Button */}
                    <Button
                      className="w-full"
                      size="lg"
                      onClick={executePublish}
                      disabled={!projectInfo || isPublishing}
                    >
                      {isPublishing ? (
                        <>
                          <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                          {configT.publishing || "发布中..."}
                        </>
                      ) : (
                        <>
                          <Play className="h-5 w-5 mr-2" />
                          {configT.execute || "执行发布"}
                        </>
                      )}
                    </Button>
                    {isPublishing && (
                      <Button
                        type="button"
                        variant="destructive"
                        className="w-full"
                        onClick={cancelPublish}
                        disabled={isCancellingPublish}
                      >
                        {isCancellingPublish ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            {appT.cancelling || "取消中..."}
                          </>
                        ) : (
                          <>
                            <Square className="h-4 w-4 mr-2" />
                            {appT.cancelPublish || "取消发布"}
                          </>
                        )}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )}

              {selectedRepo && activeProviderId !== "dotnet" && (
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Settings className="h-5 w-5" />
                          {configT.title || "发布配置"}
                        </CardTitle>
                        <CardDescription>
                          {(appT.providerConfigReady || "{{provider}} Provider 已就绪（支持参数映射与通用执行）").replace("{{provider}}", activeProviderLabel)}
                        </CardDescription>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCommandImportOpen(true)}
                      >
                        <Import className="h-4 w-4 mr-1" />
                        {appT.importFromCommand || "从命令导入"}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="rounded-xl border border-amber-200/60 bg-amber-50/80 px-3 py-2 text-amber-700 text-sm">
                      {(appT.providerConfigHint || "当前已支持 {{provider}} 的命令导入映射、参数编辑与通用执行。").replace("{{provider}}", activeProviderLabel)}
                    </div>
                    {activeProviderSchema ? (
                      <ParameterEditor
                        schema={activeProviderSchema}
                        parameters={activeProviderParameters}
                        onChange={handleProviderParametersChange}
                      />
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {appT.loadingProviderSchema || "正在加载 Provider 参数定义..."}
                      </div>
                    )}
                    <div className="rounded-xl bg-[var(--glass-input-bg)] p-3">
                      <div className="text-xs text-muted-foreground mb-2">
                        {appT.parameterSnapshot || "当前参数快照（可保存为配置文件）:"}
                      </div>
                      <pre className="text-xs font-mono overflow-auto max-h-40">
                        {JSON.stringify(activeProviderParameters, null, 2)}
                      </pre>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => openEnvironmentDialog(null, [activeProviderId])}
                    >
                      {appT.openEnvironmentCheck || "打开环境检查"}
                    </Button>
                    <Button
                      className="w-full"
                      size="lg"
                      onClick={executePublish}
                      disabled={isPublishing}
                    >
                      {isPublishing ? (
                        <>
                          <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                          {configT.publishing || "发布中..."}
                        </>
                      ) : (
                        <>
                          <Play className="h-5 w-5 mr-2" />
                          {configT.execute || "执行发布"}
                        </>
                      )}
                    </Button>
                    {isPublishing && (
                      <Button
                        type="button"
                        variant="destructive"
                        className="w-full"
                        onClick={cancelPublish}
                        disabled={isCancellingPublish}
                      >
                        {isCancellingPublish ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            {appT.cancelling || "取消中..."}
                          </>
                        ) : (
                          <>
                            <Square className="h-4 w-4 mr-2" />
                            {appT.cancelPublish || "取消发布"}
                          </>
                        )}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )}

              {selectedRepo && activeImportFeedback && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Import className="h-5 w-5" />
                      {appT.commandImportResult || "命令导入映射结果"}
                    </CardTitle>
                    <CardDescription>
                      Provider: {formatProviderLabel(activeProvider)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="rounded-xl border border-emerald-200/60 bg-emerald-50/80 px-3 py-2 text-emerald-700">
                      {(appT.mappedFieldsLabel || "已映射字段") + ` (${activeImportFeedback.mappedKeys.length}):`} 
                      {activeImportFeedback.mappedKeys.length > 0
                        ? activeImportFeedback.mappedKeys.join(", ")
                        : appT.none || "无"}
                    </div>
                    <div className="rounded-xl border border-amber-200/60 bg-amber-50/80 px-3 py-2 text-amber-700">
                      {(appT.unmappedFieldsLabel || "未映射字段") + ` (${activeImportFeedback.unmappedKeys.length}):`} 
                      {activeImportFeedback.unmappedKeys.length > 0
                        ? activeImportFeedback.unmappedKeys.join(", ")
                        : appT.none || "无"}
                    </div>
                  </CardContent>
                </Card>
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

              {failureGroups.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">{failureT.groupTitle || "失败诊断聚合"}</CardTitle>
                    <CardDescription>
                      {failureT.groupDescription || "相同失败签名自动归并，支持分组钻取与快速复制"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {failureGroups.slice(0, 6).map((group) => {
                      const isSelected = group.key === selectedFailureGroupKey;

                      return (
                        <div
                          key={group.key}
                          className="rounded-xl border border-[var(--glass-border-subtle)] px-3 py-2 text-sm"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{group.providerId}</span>
                            <span className="text-xs text-muted-foreground">
                              {(failureT.recentCount || "最近 {{count}} 次").replace("{{count}}", String(group.count))}
                            </span>
                          </div>
                          <div className="mt-1 rounded-lg bg-[var(--glass-code-bg)] px-2 py-1 font-mono text-xs break-all">
                            {group.signature}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {(failureT.latestTime || "最新时间")}: {new Date(group.latestRecord.finishedAt).toLocaleString()}
                          </div>
                          {group.latestRecord.error && (
                            <div className="text-xs text-muted-foreground break-all">
                              {(failureT.latestError || "最新错误")}: {group.latestRecord.error}
                            </div>
                          )}
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant={isSelected ? "default" : "outline"}
                              onClick={() => setSelectedFailureGroupKey(group.key)}
                            >
                              {isSelected ? failureT.selected || "已选中" : failureT.viewDetails || "查看详情"}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => void copyGroupSignature(group)}
                            >
                              <Copy className="mr-1 h-3 w-3" />
                              {failureT.copySignature || "复制签名"}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                void openSnapshotFromRecord(group.latestRecord)
                              }
                              disabled={
                                !group.latestRecord.snapshotPath &&
                                !group.latestRecord.outputDir
                              }
                            >
                              {failureT.openRepresentativeSnapshot || "打开代表快照"}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => void rerunFromHistory(group.latestRecord)}
                              disabled={isPublishing}
                            >
                              {failureT.rerunRepresentative || "重跑代表记录"}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              )}

              {selectedFailureGroup && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">{failureT.detailTitle || "失败组详情"}</CardTitle>
                    <CardDescription>
                      {(failureT.detailDescription || "{{provider}} · 最近 {{count}} 次失败（按完成时间倒序）")
                        .replace("{{provider}}", selectedFailureGroup.providerId)
                        .replace("{{count}}", String(selectedFailureGroup.count))}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="rounded-lg bg-[var(--glass-code-bg)] px-2 py-1 font-mono text-xs break-all">
                      {selectedFailureGroup.signature}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        value={issueDraftTemplate}
                        onValueChange={(value) =>
                          setIssueDraftTemplate(value as IssueDraftTemplate)
                        }
                      >
                        <SelectTrigger className="h-8 w-[180px]">
                          <SelectValue placeholder={failureT.issueTemplate || "Issue 模板"} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="bug">{failureT.bugTemplate || "Bug 模板"}</SelectItem>
                          <SelectItem value="incident">{failureT.incidentTemplate || "Incident 模板"}</SelectItem>
                          <SelectItem value="postmortem">{failureT.postmortemTemplate || "Postmortem 模板"}</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        size="sm"
                        variant={issueDraftSections.impact ? "default" : "outline"}
                        onClick={() =>
                          setIssueDraftSections((prev) => ({
                            ...prev,
                            impact: !prev.impact,
                          }))
                        }
                      >
                        Impact
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={issueDraftSections.workaround ? "default" : "outline"}
                        onClick={() =>
                          setIssueDraftSections((prev) => ({
                            ...prev,
                            workaround: !prev.workaround,
                          }))
                        }
                      >
                        Workaround
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={issueDraftSections.owner ? "default" : "outline"}
                        onClick={() =>
                          setIssueDraftSections((prev) => ({
                            ...prev,
                            owner: !prev.owner,
                          }))
                        }
                      >
                        Owner
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void copyGroupSignature(selectedFailureGroup)}
                      >
                        <Copy className="mr-1 h-3 w-3" />
                        {failureT.copySignature || "复制签名"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          representativeFailureRecord
                            ? void copyRecordCommand(representativeFailureRecord)
                            : undefined
                        }
                        disabled={!representativeFailureRecord?.commandLine}
                      >
                        <Copy className="mr-1 h-3 w-3" />
                        {failureT.copyRepresentativeCommand || "复制代表命令"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void copyFailureIssueDraft(selectedFailureGroup)}
                      >
                        {failureT.copyIssueDraft || "复制 Issue 草稿"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={exportFailureGroupBundle}
                        disabled={isExportingFailureBundle}
                      >
                        {isExportingFailureBundle ? (
                          <>
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            {appT.exporting || "导出中..."}
                          </>
                        ) : (
                          failureT.exportBundle || "导出诊断包"
                        )}
                      </Button>
                    </div>
                    {selectedFailureGroup.records.slice(0, 6).map((record, index) => (
                      <div
                        key={record.id}
                        className="rounded-xl border border-[var(--glass-border-subtle)] px-3 py-2 text-sm"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">
                            {index === 0
                              ? failureT.latestFailureRecord || "最新失败记录"
                              : (failureT.historyFailureRecord || "历史失败记录 #{{index}}")
                                  .replace("{{index}}", String(index + 1))}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(record.finishedAt).toLocaleString()}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {record.projectPath}
                        </div>
                        <div className="mt-1 rounded-lg bg-[var(--glass-code-bg)] px-2 py-1 font-mono text-xs break-all">
                          {record.commandLine || failureT.noCommandLine || "(无命令行记录)"}
                        </div>
                        {record.error && (
                          <div className="mt-1 text-xs text-muted-foreground break-all">
                            {(failureT.errorLabel || "错误")}: {record.error}
                          </div>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => void copyRecordCommand(record)}
                            disabled={!record.commandLine}
                          >
                            <Copy className="mr-1 h-3 w-3" />
                            {failureT.copyCommand || "复制命令"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => void openSnapshotFromRecord(record)}
                            disabled={!record.snapshotPath && !record.outputDir}
                          >
                            {failureT.openSnapshot || "打开快照"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => void rerunFromHistory(record)}
                            disabled={isPublishing}
                          >
                            {failureT.rerunRecord || "重跑记录"}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              <ExecutionHistoryCard
                scopedExecutionHistory={scopedExecutionHistory}
                filteredExecutionHistory={filteredExecutionHistory}
                executionHistoryLimit={executionHistoryLimit}
                historyProviderOptions={historyProviderOptions}
                historyFilterProvider={historyFilterProvider}
                historyFilterStatus={historyFilterStatus}
                historyFilterWindow={historyFilterWindow}
                historyFilterKeyword={historyFilterKeyword}
                selectedHistoryPresetId={selectedHistoryPresetId}
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
                onApplyHistoryPreset={applyHistoryPreset}
                onSaveCurrentHistoryPreset={saveCurrentHistoryPreset}
                onDeleteSelectedHistoryPreset={deleteSelectedHistoryPreset}
                onDailyTriagePresetChange={setDailyTriagePreset}
                onResetDailyTriagePreset={() =>
                  setDailyTriagePreset(DEFAULT_DAILY_TRIAGE_PRESET)
                }
                onExportExecutionHistory={exportExecutionHistory}
                onExportDailyTriageReport={exportDailyTriageReport}
                onExportDiagnosticsIndex={exportDiagnosticsIndex}
                onClearFilters={() => {
                  setHistoryFilterProvider("all");
                  setHistoryFilterStatus("all");
                  setHistoryFilterWindow("all");
                  setHistoryFilterKeyword("");
                  setSelectedHistoryPresetId("none");
                }}
                onOpenSnapshotFromRecord={openSnapshotFromRecord}
                onRerunFromHistory={rerunFromHistory}
                onCopyHandoffSnippet={copyHandoffSnippet}
              />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Shortcuts Dialog */}
      <ShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
      />

      {/* Environment Check Dialog */}
      <EnvironmentCheckDialog
        open={environmentDialogOpen}
        onOpenChange={(v) => {
          setEnvironmentDialogOpen(v);
          if (!v) setEnvironmentInitialResult(null);
        }}
        defaultProviderIds={environmentDefaultProviderIds}
        initialResult={environmentInitialResult}
        onChecked={(res) => setEnvironmentLastResult(res)}
      />

      {/* Settings Dialog */}
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        language={language}
        onLanguageChange={handleLanguageChange}
        minimizeToTrayOnClose={minimizeToTrayOnClose}
        onMinimizeToTrayOnCloseChange={setMinimizeToTrayOnClose}
        defaultOutputDir={defaultOutputDir}
        onDefaultOutputDirChange={setDefaultOutputDir}
        executionHistoryLimit={executionHistoryLimit}
        onExecutionHistoryLimitChange={setExecutionHistoryLimit}
        preRerunChecklistEnabled={isRerunChecklistEnabled}
        onPreRerunChecklistEnabledChange={setIsRerunChecklistEnabled}
        theme={theme}
        onThemeChange={setTheme}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onOpenConfig={() => setConfigDialogOpen(true)}
        environmentStatus={environmentStatus}
        environmentCheckedAt={environmentLastResult?.checked_at}
        onOpenEnvironment={() => openEnvironmentDialog(null, [activeProviderId])}
      />

      <Dialog
        open={rerunChecklistOpen}
        onOpenChange={(open) => {
          if (open) {
            setRerunChecklistOpen(true);
            return;
          }
          closeRerunChecklistDialog();
        }}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{rerunT.title || "重跑前确认清单"}</DialogTitle>
            <DialogDescription>
              {rerunT.description || "请确认以下检查项，避免在敏感分支或错误目标上触发重跑。"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-xl border border-[var(--glass-border-subtle)] bg-[var(--glass-input-bg)] p-3 text-sm space-y-1">
              <div>
                <span className="text-muted-foreground">{rerunT.provider || "Provider:"}</span>{" "}
                {pendingRerunRecord?.providerId || rerunT.unknown || "(未知)"}
              </div>
              <div>
                <span className="text-muted-foreground">{rerunT.currentBranch || "当前分支:"}</span>{" "}
                {selectedRepo?.currentBranch || rerunT.unknown || "(未知)"}
              </div>
              <div>
                <span className="text-muted-foreground">{rerunT.environmentStatus || "环境状态:"}</span>{" "}
                {environmentStatus === "ready"
                  ? rerunT.ready || "已就绪"
                  : environmentStatus === "warning"
                    ? rerunT.warning || "存在警告"
                    : environmentStatus === "blocked"
                      ? rerunT.blocked || "存在阻断问题"
                      : rerunT.notChecked || "未检查"}
              </div>
              <div>
                <span className="text-muted-foreground">{rerunT.outputTarget || "输出目标:"}</span>{" "}
                {pendingRerunRecord?.outputDir || rerunT.unrecorded || "(未记录)"}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-xl border border-[var(--glass-border-subtle)] px-3 py-2">
                <Label htmlFor="rerun-check-branch" className="text-sm">
                  {rerunT.branchCheck || "我已确认当前分支允许重跑"}
                </Label>
                <Switch
                  id="rerun-check-branch"
                  checked={rerunChecklistState.branch}
                  onCheckedChange={(checked) =>
                    setRerunChecklistState((prev) => ({
                      ...prev,
                      branch: checked,
                    }))
                  }
                />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-[var(--glass-border-subtle)] px-3 py-2">
                <Label htmlFor="rerun-check-env" className="text-sm">
                  {rerunT.environmentCheck || "我已确认环境状态满足预期"}
                </Label>
                <Switch
                  id="rerun-check-env"
                  checked={rerunChecklistState.environment}
                  onCheckedChange={(checked) =>
                    setRerunChecklistState((prev) => ({
                      ...prev,
                      environment: checked,
                    }))
                  }
                />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-[var(--glass-border-subtle)] px-3 py-2">
                <Label htmlFor="rerun-check-output" className="text-sm">
                  {rerunT.outputCheck || "我已确认输出目标目录与日志窗口"}
                </Label>
                <Switch
                  id="rerun-check-output"
                  checked={rerunChecklistState.output}
                  onCheckedChange={(checked) =>
                    setRerunChecklistState((prev) => ({
                      ...prev,
                      output: checked,
                    }))
                  }
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={closeRerunChecklistDialog}>
              {rerunT.cancel || "取消"}
            </Button>
            <Button
              onClick={() => void confirmRerunWithChecklist()}
              disabled={
                !rerunChecklistState.branch ||
                !rerunChecklistState.environment ||
                !rerunChecklistState.output
              }
            >
              {rerunT.confirm || "确认并重跑"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReleaseChecklistDialog
        open={releaseChecklistOpen}
        onOpenChange={setReleaseChecklistOpen}
        publishResult={publishResult}
        environmentResult={environmentLastResult}
        packageResult={artifactActionState.packageResult}
        signResult={artifactActionState.signResult}
        onOpenEnvironment={() => openEnvironmentDialog(environmentLastResult, [activeProviderId])}
        onOpenSettings={handleOpenSettings}
      />

      {/* Command Import Dialog */}
      {selectedRepo && commandImportProjectPath && (
        <CommandImportDialog
          open={commandImportOpen}
          onOpenChange={setCommandImportOpen}
          providerId={activeProviderId}
          projectPath={commandImportProjectPath}
          onImport={handleCommandImport}
        />
      )}

      <Dialog
        open={quickCreateProfileOpen}
        onOpenChange={handleQuickCreateProfileOpenChange}
      >
        <DialogContent className="sm:max-w-[840px] max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {profileT.quickCreateTitle || "创建发布配置"}
            </DialogTitle>
            <DialogDescription>
              {profileT.quickCreateDescription || "填写与自定义模式一致的参数并保存为发布配置。"}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 space-y-4 overflow-y-auto">
            <fieldset className="space-y-2.5">
              <Label>{profileT.quickCreateTemplate || "预置模板"}</Label>
              <div className="grid max-h-[240px] grid-cols-2 gap-2 overflow-y-auto pr-1 md:grid-cols-4">
                {quickCreateTemplateOptions.map((option) => {
                  const isSelected = quickCreateTemplateId === option.id;

                  return (
                    <label
                      key={`quick-template-${option.id}`}
                      title={
                        option.description
                          ? `${option.name} - ${option.description}`
                          : option.name
                      }
                      className={cn(
                        "group relative flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 transition-all duration-150",
                        isSelected
                          ? "border-primary/45 bg-primary/10 shadow-[0_6px_16px_hsl(var(--primary)/0.12)]"
                          : "border-[var(--glass-divider)] bg-[var(--glass-bg)] hover:border-primary/30 hover:bg-[var(--glass-bg-hover)]"
                      )}
                      htmlFor={`quick-template-${option.id}`}
                    >
                      <input
                        id={`quick-template-${option.id}`}
                        type="radio"
                        name="quick-profile-template"
                        className="sr-only"
                        checked={isSelected}
                        onChange={() => applyQuickCreateTemplate(option.id)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium leading-5">
                          {option.name}
                        </div>
                        {option.description && (
                          <div className="truncate text-[11px] text-muted-foreground">
                            {option.description}
                          </div>
                        )}
                      </div>
                      <div className="flex items-start">
                        <span
                          className={cn(
                            "mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border transition-colors duration-200",
                            isSelected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-[var(--glass-divider)] bg-background/70 text-transparent group-hover:border-primary/45"
                          )}
                        >
                          <Check className="h-3 w-3" />
                        </span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="space-y-2">
              <Label htmlFor="quick-profile-name">
                {profileT.quickCreateName || "配置名称"}
              </Label>
              <Input
                id="quick-profile-name"
                placeholder={profileT.profileNamePlaceholder || "输入配置文件名称"}
                value={quickCreateProfileName}
                onChange={(e) => setQuickCreateProfileName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !quickCreateProfileSaving) {
                    e.preventDefault();
                    handleQuickCreateProfileSave();
                  }
                }}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="quick-profile-group">
                {profileT.quickCreateGroup || "发布配置组"}
              </Label>
              <Select
                value={quickCreateProfileGroup}
                onValueChange={setQuickCreateProfileGroup}
              >
                <SelectTrigger id="quick-profile-group">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={QUICK_CREATE_PROFILE_GROUP_DEFAULT}>
                    {profileT.quickCreateGroupDefault || "默认分组"}
                  </SelectItem>
                  {quickCreateProfileGroupOptions.map((group) => (
                    <SelectItem key={`quick-profile-group-${group}`} value={group}>
                      {group}
                    </SelectItem>
                  ))}
                  <SelectItem value={QUICK_CREATE_PROFILE_GROUP_CUSTOM}>
                    {profileT.quickCreateGroupCustom || "自定义分组"}
                  </SelectItem>
                </SelectContent>
              </Select>
              {quickCreateProfileGroup === QUICK_CREATE_PROFILE_GROUP_CUSTOM && (
                <Input
                  id="quick-profile-group-custom"
                  value={quickCreateProfileCustomGroup}
                  onChange={(e) =>
                    setQuickCreateProfileCustomGroup(e.target.value)
                  }
                  placeholder={
                    profileT.quickCreateGroupCustomPlaceholder ||
                    "输入自定义发布配置组名称"
                  }
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="quick-profile-configuration">
                  {appT.configurationType || "配置类型"}
                </Label>
                <Select
                  value={quickCreateProfileDraft.configuration}
                  onValueChange={(value) =>
                    updateQuickCreateProfileDraft({ configuration: value })
                  }
                >
                  <SelectTrigger id="quick-profile-configuration">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Release">Release</SelectItem>
                    <SelectItem value="Debug">Debug</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="quick-profile-runtime">
                  {appT.runtimeLabel || "运行时"}
                </Label>
                <Select
                  value={quickCreateProfileDraft.runtime || "none"}
                  onValueChange={(value) =>
                    updateQuickCreateProfileDraft({
                      runtime: value === "none" ? "" : value,
                    })
                  }
                >
                  <SelectTrigger id="quick-profile-runtime">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      {appT.frameworkDependent || "框架依赖"}
                    </SelectItem>
                    <SelectItem value="win-x64">Windows x64</SelectItem>
                    <SelectItem value="osx-arm64">macOS ARM64</SelectItem>
                    <SelectItem value="osx-x64">macOS x64</SelectItem>
                    <SelectItem value="linux-x64">Linux x64</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="col-span-2 space-y-2">
                <Label htmlFor="quick-profile-output">
                  {appT.outputDirLabel || "输出目录"}
                </Label>
                <Input
                  id="quick-profile-output"
                  value={quickCreateProfileDraft.outputDir}
                  onChange={(e) =>
                    updateQuickCreateProfileDraft({ outputDir: e.target.value })
                  }
                  placeholder={appT.outputDirPlaceholder || "留空使用默认目录"}
                />
              </div>

              <div className="col-span-2 flex items-center gap-2">
                <Switch
                  id="quick-profile-self-contained"
                  checked={quickCreateProfileDraft.selfContained}
                  onCheckedChange={(checked) =>
                    updateQuickCreateProfileDraft({ selfContained: checked })
                  }
                  disabled={!quickCreateProfileDraft.runtime}
                />
                <Label htmlFor="quick-profile-self-contained">
                  {appT.selfContained || "自包含部署"}
                </Label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleQuickCreateProfileOpenChange(false)}
              disabled={quickCreateProfileSaving}
            >
              {rerunT.cancel || "取消"}
            </Button>
            <Button
              type="button"
              onClick={handleQuickCreateProfileSave}
              disabled={quickCreateProfileSaving || !quickCreateProfileName.trim()}
            >
              {quickCreateProfileSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {profileT.quickCreateSaving || "保存中..."}
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  {profileT.quickCreateAction || "创建并保存"}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Config Dialog */}
      <ConfigDialog
        open={configDialogOpen}
        onOpenChange={(open) => {
          setConfigDialogOpen(open);
          if (!open) {
            loadProfiles();
          }
        }}
        onLoadProfile={handleLoadProfile}
        currentProviderId={activeProviderId}
        repoId={selectedRepoId}
        currentParameters={
          activeProviderId === "dotnet"
            ? toDotnetProfileParameters(customConfig)
            : activeProviderParameters
        }
      />
    </div>
  );
}

export default App;
