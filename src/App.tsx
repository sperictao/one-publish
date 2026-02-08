import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";

// Hooks
import { useAppState } from "@/hooks/useAppState";
import { useTheme } from "@/hooks/useTheme";
import { useShortcuts } from "@/hooks/useShortcuts";
import { useI18n, type Language } from "@/hooks/useI18n";
import {
  addExecutionRecord,
  detectRepositoryProvider,
  getExecutionHistory,
  getProviderSchema,
  listProviders,
  openExecutionSnapshot,
  scanRepositoryBranches,
  setExecutionRecordSnapshot,
  type ExecutionRecord,
  type PublishConfigStore,
  type ProviderManifest,
} from "@/lib/store";

// Layout Components
import { CollapsiblePanel } from "@/components/layout/CollapsiblePanel";
import { RepositoryList } from "@/components/layout/RepositoryList";
import { BranchPanel } from "@/components/layout/BranchPanel";
import { ResizeHandle } from "@/components/layout/ResizeHandle";
import { SettingsDialog } from "@/components/layout/SettingsDialog";
import { ShortcutsDialog } from "@/components/layout/ShortcutsDialog";
import { EnvironmentCheckDialog } from "@/components/environment/EnvironmentCheckDialog";

// Publish Components
import { CommandImportDialog } from "@/components/publish/CommandImportDialog";
import { ConfigDialog } from "@/components/publish/ConfigDialog";
import { ParameterEditor } from "@/components/publish/ParameterEditor";
import {
  ArtifactActions,
  type ArtifactActionState,
} from "@/components/publish/ArtifactActions";
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
  Terminal,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  GitBranch,
  Import,
  ListChecks,
  Square,
  Copy,
} from "lucide-react";

// Types
import type { Repository } from "@/types/repository";
import {
  runEnvironmentCheck,
  type EnvironmentCheckResult,
} from "@/lib/environment";
import { mapImportedSpecByProvider } from "@/lib/commandImportMapping";
import { deriveFailureSignature } from "@/lib/failureSignature";
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
  type HistoryExportFormat,
  type HistoryFilterPreset,
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

interface PublishResult {
  provider_id: string;
  success: boolean;
  cancelled: boolean;
  output: string;
  error: string | null;
  output_dir: string;
  file_count: number;
}

interface ProviderPublishSpec {
  version: number;
  provider_id: string;
  project_path: string;
  parameters: Record<string, unknown>;
}

interface ImportFeedback {
  providerId: string;
  mappedKeys: string[];
  unmappedKeys: string[];
}

interface PublishLogChunkEvent {
  sessionId: string;
  line: string;
}

interface ExecutionSnapshotPayload {
  generatedAt: string;
  providerId: string;
  spec: ProviderPublishSpec;
  command: {
    line: string;
  };
  environmentSummary: {
    providerIds: string[];
    warningCount: number;
    criticalCount: number;
  };
  result: {
    success: boolean;
    cancelled: boolean;
    error: string | null;
    outputDir: string;
    fileCount: number;
  };
  output: {
    lineCount: number;
    log: string;
  };
}

interface FailureGroupBundleRecordPayload {
  id: string;
  providerId: string;
  projectPath: string;
  startedAt: string;
  finishedAt: string;
  outputDir: string | null;
  error: string | null;
  commandLine: string | null;
  snapshotPath: string | null;
  fileCount: number;
}

interface FailureGroupBundlePayload {
  generatedAt: string;
  providerId: string;
  signature: string;
  frequency: number;
  representativeRecordId: string;
  records: FailureGroupBundleRecordPayload[];
}

interface DiagnosticsIndexPayload {
  generatedAt: string;
  summary: {
    historyCount: number;
    filteredHistoryCount: number;
    failureGroupCount: number;
    snapshotCount: number;
    bundleCount: number;
    historyExportCount: number;
  };
  links: {
    snapshots: string[];
    bundles: string[];
    historyExports: string[];
  };
}

type HistoryFilterStatus = "all" | "success" | "failed" | "cancelled";
type HistoryFilterWindow = "all" | "24h" | "7d" | "30d";

const SPEC_VERSION = 1;

// Preset configurations
const PRESETS = [
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

interface HistoryFilterState {
  provider: string;
  status: HistoryFilterStatus;
  window: HistoryFilterWindow;
  keyword: string;
}

function filterExecutionHistory(
  records: ExecutionRecord[],
  filter: HistoryFilterState,
  now = Date.now()
): ExecutionRecord[] {
  const keyword = filter.keyword.trim().toLowerCase();
  const windowStartMs =
    filter.window === "24h"
      ? now - 24 * 60 * 60 * 1000
      : filter.window === "7d"
        ? now - 7 * 24 * 60 * 60 * 1000
        : filter.window === "30d"
          ? now - 30 * 24 * 60 * 60 * 1000
          : null;

  return records.filter((record) => {
    if (filter.provider !== "all" && record.providerId !== filter.provider) {
      return false;
    }

    if (filter.status === "success" && !record.success) {
      return false;
    }
    if (filter.status === "cancelled" && !record.cancelled) {
      return false;
    }
    if (filter.status === "failed" && (record.success || record.cancelled)) {
      return false;
    }

    if (windowStartMs !== null) {
      const finishedAt = Date.parse(record.finishedAt);
      if (Number.isNaN(finishedAt) || finishedAt < windowStartMs) {
        return false;
      }
    }

    if (!keyword) {
      return true;
    }

    const haystack = [
      record.providerId,
      record.projectPath,
      record.error || "",
      record.commandLine || "",
      record.failureSignature || "",
    ]
      .join("\n")
      .toLowerCase();

    return haystack.includes(keyword);
  });
}

function remapPathPrefix(path: string, oldPrefix: string, newPrefix: string): string {
  if (!oldPrefix || oldPrefix === newPrefix) {
    return path;
  }

  if (path === oldPrefix) {
    return newPrefix;
  }

  if (path.startsWith(`${oldPrefix}/`) || path.startsWith(`${oldPrefix}\\`)) {
    return `${newPrefix}${path.slice(oldPrefix.length)}`;
  }

  return path;
}


type BranchRefreshFailureReason =
  | "path_not_found"
  | "not_directory"
  | "git_missing"
  | "cannot_connect_repo"
  | "not_git_repo"
  | "permission_denied"
  | "dubious_ownership"
  | "no_branches"
  | "unknown";

function extractInvokeErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object") {
    const payload = error as {
      message?: unknown;
      details?: unknown;
      error?: unknown;
    };

    const parts = [payload.message, payload.details, payload.error]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .map((part) => part.trim());

    if (parts.length > 0) {
      return parts.join(" | ");
    }

    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  return String(error);
}

function analyzeBranchRefreshFailure(error: unknown): BranchRefreshFailureReason {
  const normalized = extractInvokeErrorMessage(error).toLowerCase();

  if (normalized.includes("repository path does not exist")) {
    return "path_not_found";
  }

  if (normalized.includes("repository path is not a directory")) {
    return "not_directory";
  }

  if (
    normalized.includes("failed to execute git") &&
    (normalized.includes("no such file or directory") ||
      normalized.includes("os error 2") ||
      normalized.includes("系统找不到指定的文件"))
  ) {
    return "git_missing";
  }

  if (
    normalized.includes("unable to access") ||
    normalized.includes("failed to connect") ||
    normalized.includes("could not resolve host") ||
    normalized.includes("connection timed out") ||
    normalized.includes("connection refused") ||
    normalized.includes("unable to connect") ||
    normalized.includes("unable to look up") ||
    normalized.includes("couldn't connect to server") ||
    normalized.includes("network is unreachable") ||
    normalized.includes("could not read from remote repository") ||
    normalized.includes("could not read username") ||
    normalized.includes("authentication failed") ||
    normalized.includes("publickey") ||
    normalized.includes("repository not found") ||
    normalized.includes("proxy connect aborted") ||
    normalized.includes("无法连接") ||
    normalized.includes("连接超时") ||
    normalized.includes("连接被拒绝") ||
    normalized.includes("无法访问远程仓库") ||
    normalized.includes("无法从远程仓库读取") ||
    normalized.includes("无法解析主机") ||
    normalized.includes("网络不可达")
  ) {
    return "cannot_connect_repo";
  }

  if (
    normalized.includes("not a git repository") ||
    normalized.includes("不是 git 仓库") ||
    normalized.includes("不是一个git仓库")
  ) {
    return "not_git_repo";
  }

  if (normalized.includes("detected dubious ownership")) {
    return "dubious_ownership";
  }

  if (
    normalized.includes("permission denied") ||
    normalized.includes("operation not permitted") ||
    normalized.includes("访问被拒绝") ||
    normalized.includes("权限")
  ) {
    return "permission_denied";
  }

  if (normalized.includes("no git branches found")) {
    return "no_branches";
  }

  return "unknown";
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
  const projectT = translations.project || {};
  const configT = translations.config || {};
  const publishT = translations.publish || {};
  const appT = translations.app || {};
  const historyT = translations.history || {};
  const failureT = translations.failure || {};
  const rerunT = translations.rerun || {};

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
  const [environmentDialogOpen, setEnvironmentDialogOpen] = useState(false);
  const [environmentDefaultProviderIds, setEnvironmentDefaultProviderIds] =
    useState<string[]>(["dotnet"]);
  const [environmentInitialResult, setEnvironmentInitialResult] =
    useState<EnvironmentCheckResult | null>(null);
  const [environmentLastResult, setEnvironmentLastResult] =
    useState<EnvironmentCheckResult | null>(null);
  const [releaseChecklistOpen, setReleaseChecklistOpen] = useState(false);
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
  const [artifactActionState, setArtifactActionState] =
    useState<ArtifactActionState>({
      packageResult: null,
      signResult: null,
    });

  // Min/Max constraints
  const MIN_PANEL_WIDTH = 150;
  const MAX_PANEL_WIDTH = 400;

  // Resize handlers
  const handleLeftPanelResize = useCallback(
    (delta: number) => {
      const newWidth = Math.max(
        MIN_PANEL_WIDTH,
        Math.min(MAX_PANEL_WIDTH, leftPanelWidth + delta)
      );
      setLeftPanelWidth(newWidth);
    },
    [leftPanelWidth, setLeftPanelWidth]
  );

  const handleMiddlePanelResize = useCallback(
    (delta: number) => {
      const newWidth = Math.max(
        MIN_PANEL_WIDTH,
        Math.min(MAX_PANEL_WIDTH, middlePanelWidth + delta)
      );
      setMiddlePanelWidth(newWidth);
    },
    [middlePanelWidth, setMiddlePanelWidth]
  );

  // Project State (runtime only)
  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isCancellingPublish, setIsCancellingPublish] = useState(false);
  const [isExportingSnapshot, setIsExportingSnapshot] = useState(false);
  const [isExportingFailureBundle, setIsExportingFailureBundle] =
    useState(false);
  const [isExportingHistory, setIsExportingHistory] = useState(false);
  const [isExportingDiagnosticsIndex, setIsExportingDiagnosticsIndex] =
    useState(false);
  const [recentBundleExports, setRecentBundleExports] = useState<string[]>([]);
  const [recentHistoryExports, setRecentHistoryExports] = useState<string[]>([]);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);
  const [lastExecutedSpec, setLastExecutedSpec] =
    useState<ProviderPublishSpec | null>(null);
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
  const [currentExecutionRecordId, setCurrentExecutionRecordId] =
    useState<string | null>(null);
  const [outputLog, setOutputLog] = useState<string>("");
  const [isScanning, setIsScanning] = useState(false);

  // Open settings dialog
  const handleOpenSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);

  // Get selected repository
  const selectedRepo = repositories.find((r) => r.id === selectedRepoId) || null;

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

  const historyProviderOptions = useMemo(
    () =>
      Array.from(new Set(executionHistory.map((record) => record.providerId))).sort(),
    [executionHistory]
  );

  const filteredExecutionHistory = useMemo(
    () =>
      filterExecutionHistory(executionHistory, {
        provider: historyFilterProvider,
        status: historyFilterStatus,
        window: historyFilterWindow,
        keyword: historyFilterKeyword,
      }),
    [
      executionHistory,
      historyFilterProvider,
      historyFilterStatus,
      historyFilterWindow,
      historyFilterKeyword,
    ]
  );

  const dailyTriageRecords = useMemo(
    () =>
      filterExecutionHistory(executionHistory, {
        provider: dailyTriagePreset.provider,
        status: dailyTriagePreset.status,
        window: dailyTriagePreset.window,
        keyword: dailyTriagePreset.keyword,
      }),
    [executionHistory, dailyTriagePreset]
  );

  const snapshotPaths = useMemo(
    () =>
      Array.from(
        new Set(
          executionHistory
            .map((record) => record.snapshotPath?.trim())
            .filter((value): value is string => Boolean(value))
        )
      ),
    [executionHistory]
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

    return () => {
      mounted = false;
    };
  }, []);

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

  useEffect(() => {
    if (!(window as any).__TAURI__) {
      return;
    }

    let unlisten: (() => void) | null = null;

    listen<PublishLogChunkEvent>("provider-publish-log", (event) => {
      const line = event.payload?.line?.trimEnd();
      if (!line) return;

      setOutputLog((prev) => (prev ? `${prev}\n${line}` : line));
    })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch((err) => {
        console.error("监听发布日志失败:", err);
      });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  // Load project info when repo or provider changes
  useEffect(() => {
    if (!selectedRepo || isStateLoading) return;

    if (activeProviderId === "dotnet") {
      scanProject(selectedRepo.path);
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
  const scanProject = useCallback(async (path?: string) => {
    setIsScanning(true);
    try {
      const info = await invoke<ProjectInfo>("scan_project", {
        startPath: path,
      });
      setProjectInfo(info);
      toast.success(appT.scanProjectSuccess || "项目检测成功", {
        description: `${appT.foundProject || "找到项目"}: ${info.project_file}`,
      });
    } catch (err) {
      // Silently fail for now - project might not be a .NET project
      setProjectInfo(null);
    } finally {
      setIsScanning(false);
    }
  }, []);

  // Add repository
  const handleAddRepo = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: appT.selectRepositoryDirectory || "选择仓库目录",
    });
    if (selected) {
      const path = selected as string;
      const name = path.split("/").pop() || "Unknown";
      const newRepo: Repository = {
        id: Date.now().toString(),
        name,
        path,
        currentBranch: "main",
        branches: [{ name: "main", isMain: true, isCurrent: true, path }],
      };
      try {
        await addRepository(newRepo);
        toast.success(appT.repositoryAdded || "仓库已添加", { description: name });
      } catch (err) {
        toast.error(appT.addRepositoryFailed || "添加仓库失败", { description: String(err) });
      }
    }
  };

  const handleRemoveRepo = useCallback(
    async (repo: Repository) => {
      const confirmed = window.confirm(
        (appT.removeRepositoryConfirm || "确认移除仓库「{{name}}」？").replace(
          "{{name}}",
          repo.name
        )
      );

      if (!confirmed) {
        return;
      }

      try {
        await removeRepository(repo.id);
        toast.success(appT.repositoryRemoved || "仓库已移除", {
          description: repo.name,
        });
      } catch (err) {
        toast.error(appT.removeRepositoryFailed || "移除仓库失败", {
          description: String(err),
        });
      }
    },
    [appT, removeRepository]
  );

  const handleEditRepo = useCallback(
    async (repo: Repository) => {
      const targetRepo = repositories.find((item) => item.id === repo.id);

      if (!targetRepo) {
        toast.error(appT.repositoryNotFound || "未找到目标仓库");
        return false;
      }

      const nextName = repo.name.trim();
      const nextPath = repo.path.trim();
      const nextProjectFile = repo.projectFile?.trim() || "";
      const nextCurrentBranch = repo.currentBranch.trim();
      const nextProviderId = repo.providerId?.trim() || "";

      if (!nextName || !nextPath) {
        toast.error(appT.repositoryInfoInvalid || "仓库名称和路径不能为空");
        return false;
      }

      const normalizedRepo: Repository = {
        ...repo,
        name: nextName,
        path: nextPath,
        projectFile:
          remapPathPrefix(nextProjectFile, targetRepo.path, nextPath) || undefined,
        currentBranch: nextCurrentBranch || targetRepo.currentBranch,
        providerId: nextProviderId || undefined,
        branches: repo.branches.map((branch) => ({
          ...branch,
          path: remapPathPrefix(branch.path, targetRepo.path, nextPath),
        })),
      };

      try {
        await updateRepository(normalizedRepo);

        if (selectedRepoId === repo.id && nextProviderId) {
          setActiveProviderId(nextProviderId);
        }

        toast.success(appT.repositoryUpdated || "仓库信息已更新", {
          description: nextName,
        });
        return true;
      } catch (err) {
        toast.error(appT.updateRepositoryFailed || "更新仓库失败", {
          description: String(err),
        });
        return false;
      }
    },
    [appT, repositories, selectedRepoId, setActiveProviderId, updateRepository]
  );

  const handleDetectRepoProvider = useCallback(
    async (path: string, options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;
      const nextPath = path.trim();

      if (!nextPath) {
        if (!silent) {
          toast.error(appT.repositoryPathRequired || "请输入仓库路径");
        }
        return null;
      }

      try {
        const providerId = await detectRepositoryProvider(nextPath);

        if (!silent) {
          toast.success(appT.providerDetected || "已自动检测 Provider", {
            description: providerId,
          });
        }

        return providerId;
      } catch (err) {
        if (!silent) {
          toast.error(appT.detectProviderFailed || "自动检测 Provider 失败", {
            description: String(err),
          });
        }
        return null;
      }
    },
    [appT]
  );

  const handleRefreshRepoBranches = useCallback(
    async (path: string, options?: { silentSuccess?: boolean }) => {
      const silentSuccess = options?.silentSuccess ?? false;
      const nextPath = path.trim();

      if (!nextPath) {
        toast.error(appT.repositoryPathRequired || "请输入仓库路径");
        return null;
      }

      try {
        const result = await scanRepositoryBranches(nextPath);
        const branchCountLabel = appT.branchesCountUnit || "个分支";

        if (!silentSuccess) {
          toast.success(appT.branchesRefreshed || "分支列表已刷新", {
            description: `${result.branches.length}${branchCountLabel}`,
          });
        }

        return result;
      } catch (err) {
        const rawErrorMessage = extractInvokeErrorMessage(err);
        const failureReason = analyzeBranchRefreshFailure(err);

        if (failureReason === "path_not_found") {
          toast.error(appT.branchPullPathNotFound || "仓库路径不存在", {
            description:
              appT.branchPullPathNotFoundDesc || "请确认仓库路径存在且可访问。",
          });
          return null;
        }

        if (failureReason === "not_directory") {
          toast.error(appT.branchPullNotDirectory || "仓库路径不是目录", {
            description:
              appT.branchPullNotDirectoryDesc || "请确认填写的是仓库目录而非文件路径。",
          });
          return null;
        }

        if (failureReason === "git_missing") {
          toast.error(appT.branchPullGitMissing || "未检测到 Git 命令", {
            description:
              appT.branchPullGitMissingDesc ||
              "请先安装 Git，并确保 git 已加入 PATH。",
          });
          return null;
        }

        if (failureReason === "cannot_connect_repo") {
          toast.error(appT.branchPullCannotConnect || "无法连接 Git 仓库", {
            description:
              appT.branchPullCannotConnectDesc ||
              "请检查网络代理、仓库地址和凭据后重试。",
          });
          return null;
        }

        if (failureReason === "not_git_repo") {
          toast.error(appT.branchPullNotGitRepo || "该目录不是 Git 仓库", {
            description:
              appT.branchPullNotGitRepoDesc ||
              "请确认目录包含 .git，或先执行 git init。",
          });
          return null;
        }

        if (failureReason === "permission_denied") {
          toast.error(appT.branchPullPermissionDenied || "缺少仓库访问权限", {
            description:
              appT.branchPullPermissionDeniedDesc ||
              "请检查当前用户对仓库目录和 .git 目录的读权限。",
          });
          return null;
        }

        if (failureReason === "dubious_ownership") {
          toast.error(appT.branchPullDubiousOwnership || "仓库所有权校验失败", {
            description:
              appT.branchPullDubiousOwnershipDesc ||
              "Git 检测到目录所有权异常，请按提示配置 safe.directory。",
          });
          return null;
        }

        if (failureReason === "no_branches") {
          toast.error(appT.branchPullNoBranches || "未读取到分支", {
            description:
              appT.branchPullNoBranchesDesc ||
              "当前仓库没有可用分支，请先创建并提交至少一个分支。",
          });
          return null;
        }

        toast.error(appT.refreshBranchesFailed || "拉取分支失败", {
          description: rawErrorMessage,
        });
        return null;
      }
    },
    [appT]
  );

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

  const persistExecutionRecord = useCallback((record: ExecutionRecord) => {
    setCurrentExecutionRecordId(record.id);

    addExecutionRecord(record)
      .then((history) => {
        setExecutionHistory(history);
      })
      .catch((err) => {
        console.error("保存执行历史失败:", err);
      });
  }, []);

  const buildExecutionRecord = useCallback(
    (params: {
      spec: ProviderPublishSpec;
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

  const runPublishWithSpec = useCallback(
    async (spec: ProviderPublishSpec) => {
      try {
        const env = await runEnvironmentCheck([spec.provider_id]);
        setEnvironmentLastResult(env);

        const critical = env.issues.find((i) => i.severity === "critical");
        if (critical) {
          toast.error(appT.environmentBlocked || "环境未就绪，已阻止发布", {
            description: critical.description,
          });
          openEnvironmentDialog(env, [spec.provider_id]);
          return;
        }

        const warning = env.issues.find((i) => i.severity === "warning");
        if (warning) {
          toast.warning(appT.environmentWarning || "环境存在警告", {
            description: warning.description,
          });
        }
      } catch (err) {
        toast.error(appT.environmentCheckFailed || "环境检查失败", { description: String(err) });
      }

      setLastExecutedSpec(spec);
      setCurrentExecutionRecordId(null);
      setIsPublishing(true);
      setPublishResult(null);
      setOutputLog("");
      setReleaseChecklistOpen(false);
      setArtifactActionState({ packageResult: null, signResult: null });

      const executionStartedAt = new Date().toISOString();

      try {
        const result = await invoke<PublishResult>("execute_provider_publish", {
          spec,
        });

        setPublishResult(result);
        setOutputLog(result.output);

        if (result.success) {
          toast.success(publishT.success || "发布成功!", {
            description: result.output_dir
              ? `${publishT.output || "输出目录"}: ${result.output_dir}`
              : appT.commandExecuted || "命令执行成功",
          });
        } else if (result.cancelled) {
          toast.warning(appT.publishCancelled || "发布已取消", {
            description: result.error || appT.userCancelledTask || "用户取消了执行任务",
          });
        } else {
          toast.error(publishT.failed || "发布失败", {
            description: result.error || appT.unknownError || "未知错误",
          });
        }

        const record = buildExecutionRecord({
          spec,
          startedAt: executionStartedAt,
          finishedAt: new Date().toISOString(),
          result,
          output: result.output,
        });
        persistExecutionRecord(record);
      } catch (err) {
        const errorMsg = String(err);
        const failedResult: PublishResult = {
          provider_id: spec.provider_id,
          success: false,
          cancelled: false,
          output: "",
          error: errorMsg,
          output_dir: "",
          file_count: 0,
        };
        setPublishResult(failedResult);
        toast.error(appT.publishExecutionError || "发布执行错误", {
          description: errorMsg,
        });

        const record = buildExecutionRecord({
          spec,
          startedAt: executionStartedAt,
          finishedAt: new Date().toISOString(),
          result: failedResult,
          output: "",
        });
        persistExecutionRecord(record);
      } finally {
        setIsPublishing(false);
        setIsCancellingPublish(false);
      }
    },
    [buildExecutionRecord, openEnvironmentDialog, persistExecutionRecord]
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
      await runPublishWithSpec(spec);
    },
    [extractSpecFromRecord, restoreSpecToEditor, runPublishWithSpec]
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

  // Execute publish
  const executePublish = async () => {
    if (!selectedRepo) {
      toast.error(appT.selectRepositoryFirst || "请先选择仓库");
      return;
    }

    let spec: ProviderPublishSpec;

    if (activeProviderId === "dotnet") {
      if (!projectInfo) {
        toast.error(appT.selectDotnetProjectFirst || "请先选择 .NET 项目");
        return;
      }

      const config = getCurrentConfig();
      const parameters: Record<string, unknown> = {};

      if (config.use_profile && config.profile_name) {
        parameters.properties = {
          PublishProfile: config.profile_name,
        };
      } else {
        parameters.configuration = config.configuration;
        if (config.runtime) {
          parameters.runtime = config.runtime;
        }
        if (config.self_contained) {
          parameters.self_contained = true;
        }
        if (config.output_dir) {
          parameters.output = config.output_dir;
        }
      }

      spec = {
        version: SPEC_VERSION,
        provider_id: "dotnet",
        project_path: projectInfo.project_file,
        parameters,
      };
    } else {
      spec = {
        version: SPEC_VERSION,
        provider_id: activeProviderId,
        project_path: selectedRepo.path,
        parameters: activeProviderParameters,
      };
    }

    await runPublishWithSpec(spec);
  };

  const cancelPublish = async () => {
    if (!isPublishing || isCancellingPublish) {
      return;
    }

    setIsCancellingPublish(true);
    try {
      const cancelled = await invoke<boolean>("cancel_provider_publish");
      if (cancelled) {
        toast.message(appT.cancellingPublish || "正在取消发布...");
      } else {
        toast.message(appT.noRunningPublishTask || "当前没有运行中的发布任务");
      }
    } catch (err) {
      toast.error(appT.cancelPublishFailed || "取消发布失败", { description: String(err) });
    } finally {
      setIsCancellingPublish(false);
    }
  };

  const exportExecutionSnapshot = async () => {
    if (!publishResult || !lastExecutedSpec) {
      toast.error(historyT.noSnapshotToExport || "暂无可导出的执行快照");
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:]/g, "-");
    const defaultPath = publishResult.output_dir
      ? `${publishResult.output_dir}/execution-snapshot-${timestamp}.md`
      : `execution-snapshot-${timestamp}.md`;

    const selected = await save({
      title: historyT.exportSnapshotTitle || "导出执行快照",
      defaultPath,
      filters: [
        { name: "Markdown", extensions: ["md"] },
        { name: "JSON", extensions: ["json"] },
      ],
    });

    if (!selected) return;

    const commandLine =
      outputLog
        .split("\n")
        .find((line) => line.startsWith("$ ")) || "(not captured)";
    const providerStatuses = environmentLastResult?.providers || [];
    const warningCount = (environmentLastResult?.issues || []).filter(
      (item) => item.severity === "warning"
    ).length;
    const criticalCount = (environmentLastResult?.issues || []).filter(
      (item) => item.severity === "critical"
    ).length;

    const snapshot: ExecutionSnapshotPayload = {
      generatedAt: new Date().toISOString(),
      providerId: publishResult.provider_id,
      spec: lastExecutedSpec,
      command: {
        line: commandLine,
      },
      environmentSummary: {
        providerIds: providerStatuses.map((status: { provider_id: string }) => status.provider_id),
        warningCount,
        criticalCount,
      },
      result: {
        success: publishResult.success,
        cancelled: publishResult.cancelled,
        error: publishResult.error,
        outputDir: publishResult.output_dir,
        fileCount: publishResult.file_count,
      },
      output: {
        lineCount: outputLog ? outputLog.split("\n").length : 0,
        log: outputLog,
      },
    };

    setIsExportingSnapshot(true);
    try {
      const outputPath = await invoke<string>("export_execution_snapshot", {
        filePath: selected,
        snapshot,
      });

      if (currentExecutionRecordId) {
        const history = await setExecutionRecordSnapshot(
          currentExecutionRecordId,
          outputPath
        );
        setExecutionHistory(history);
      }

      toast.success(historyT.snapshotExported || "执行快照已导出", { description: outputPath });
    } catch (err) {
      toast.error(historyT.exportSnapshotFailed || "导出执行快照失败", { description: String(err) });
    } finally {
      setIsExportingSnapshot(false);
    }
  };

  const exportFailureGroupBundle = async () => {
    if (!selectedFailureGroup) {
      toast.error(failureT.selectFailureGroupFirst || "请先选择失败分组");
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:]/g, "-");
    const representativeRecord = representativeFailureRecord;
    const defaultDir =
      selectedFailureGroup.latestRecord.outputDir ||
      selectedRepo?.path ||
      "";
    const defaultPath = defaultDir
      ? `${defaultDir}/failure-group-bundle-${timestamp}.md`
      : `failure-group-bundle-${timestamp}.md`;

    const selected = await save({
      title: failureT.exportBundleTitle || "导出失败组诊断包",
      defaultPath,
      filters: [
        { name: "Markdown", extensions: ["md"] },
        { name: "JSON", extensions: ["json"] },
      ],
    });

    if (!selected || !representativeRecord) {
      return;
    }

    const bundle: FailureGroupBundlePayload = {
      generatedAt: new Date().toISOString(),
      providerId: selectedFailureGroup.providerId,
      signature: selectedFailureGroup.signature,
      frequency: selectedFailureGroup.count,
      representativeRecordId: representativeRecord.id,
      records: selectedFailureGroup.records.map((record) => ({
        id: record.id,
        providerId: record.providerId,
        projectPath: record.projectPath,
        startedAt: record.startedAt,
        finishedAt: record.finishedAt,
        outputDir: record.outputDir ?? null,
        error: record.error ?? null,
        commandLine: record.commandLine ?? null,
        snapshotPath: record.snapshotPath ?? null,
        fileCount: record.fileCount,
      })),
    };

    setIsExportingFailureBundle(true);
    try {
      const outputPath = await invoke<string>("export_failure_group_bundle", {
        bundle,
        filePath: selected,
      });

      trackBundleExport(outputPath);
      toast.success(failureT.bundleExported || "失败组诊断包已导出", { description: outputPath });
    } catch (err) {
      toast.error(failureT.exportBundleFailed || "导出失败组诊断包失败", { description: String(err) });
    } finally {
      setIsExportingFailureBundle(false);
    }
  };

  const exportExecutionHistory = async (options?: {
    records?: ExecutionRecord[];
    format?: HistoryExportFormat;
    title?: string;
    filePrefix?: string;
    successMessage?: string;
  }) => {
    const records = options?.records ?? filteredExecutionHistory;
    if (records.length === 0) {
      toast.error(
        options?.records
          ? historyT.noPresetHistoryToExport || "预设下没有可导出的执行历史"
          : historyT.noHistoryToExport || "当前没有可导出的执行历史"
      );
      return;
    }

    const format = options?.format;
    const timestamp = new Date().toISOString().replace(/[:]/g, "-");
    const extension = format ?? "csv";
    const prefix = options?.filePrefix ?? "execution-history";
    const defaultDir = selectedRepo?.path || "";
    const defaultPath = defaultDir
      ? `${defaultDir}/${prefix}-${timestamp}.${extension}`
      : `${prefix}-${timestamp}.${extension}`;

    const filters =
      format === "csv"
        ? [{ name: "CSV", extensions: ["csv"] }]
        : format === "json"
          ? [{ name: "JSON", extensions: ["json"] }]
          : [
              { name: "CSV", extensions: ["csv"] },
              { name: "JSON", extensions: ["json"] },
            ];

    const selected = await save({
      title: options?.title ?? (historyT.exportHistoryTitle || "导出执行历史"),
      defaultPath,
      filters,
    });

    if (!selected) {
      return;
    }

    const history = records.map((record) => ({
      id: record.id,
      providerId: record.providerId,
      projectPath: record.projectPath,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      success: record.success,
      cancelled: record.cancelled,
      outputDir: record.outputDir ?? null,
      error: record.error ?? null,
      commandLine: record.commandLine ?? null,
      snapshotPath: record.snapshotPath ?? null,
      failureSignature: record.failureSignature ?? null,
      fileCount: record.fileCount,
    }));

    setIsExportingHistory(true);
    try {
      const outputPath = await invoke<string>("export_execution_history", {
        history,
        filePath: selected,
      });

      trackHistoryExport(outputPath);
      toast.success(options?.successMessage ?? (historyT.historyExported || "执行历史已导出"), {
        description: outputPath,
      });
    } catch (err) {
      toast.error(historyT.exportHistoryFailed || "导出执行历史失败", { description: String(err) });
    } finally {
      setIsExportingHistory(false);
    }
  };

  const exportDailyTriageReport = async () => {
    if (!dailyTriagePreset.enabled) {
      toast.message(historyT.dailyPresetDisabled || "每日排障预设已禁用");
      return;
    }

    if (dailyTriageRecords.length === 0) {
      toast.error(historyT.noDailyHistoryToExport || "日报预设下没有可导出的执行历史");
      return;
    }

    setHistoryFilterProvider(dailyTriagePreset.provider);
    setHistoryFilterStatus(dailyTriagePreset.status);
    setHistoryFilterWindow(dailyTriagePreset.window);
    setHistoryFilterKeyword(dailyTriagePreset.keyword);
    setSelectedHistoryPresetId("none");

    await exportExecutionHistory({
      records: dailyTriageRecords,
      format: dailyTriagePreset.format,
      title: historyT.exportDailyReportTitle || "导出每日排障报告",
      filePrefix: "daily-triage-report",
      successMessage: historyT.dailyReportExported || "每日排障报告已导出",
    });
  };

  const exportDiagnosticsIndex = async () => {
    const hasAnyLinks =
      snapshotPaths.length > 0 ||
      recentBundleExports.length > 0 ||
      recentHistoryExports.length > 0;
    if (!hasAnyLinks) {
      toast.error(historyT.noDiagnosticsToIndex || "暂无可索引的诊断导出记录", {
        description: historyT.noDiagnosticsToIndexHint || "请先导出诊断包、历史或执行快照",
      });
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:]/g, "-");
    const defaultDir = selectedRepo?.path || "";
    const defaultPath = defaultDir
      ? `${defaultDir}/diagnostics-index-${timestamp}.md`
      : `diagnostics-index-${timestamp}.md`;

    const selected = await save({
      title: historyT.exportDiagnosticsIndexTitle || "导出诊断索引",
      defaultPath,
      filters: [
        { name: "Markdown", extensions: ["md"] },
        { name: "HTML", extensions: ["html"] },
      ],
    });

    if (!selected) {
      return;
    }

    const indexPayload: DiagnosticsIndexPayload = {
      generatedAt: new Date().toISOString(),
      summary: {
        historyCount: executionHistory.length,
        filteredHistoryCount: filteredExecutionHistory.length,
        failureGroupCount: failureGroups.length,
        snapshotCount: snapshotPaths.length,
        bundleCount: recentBundleExports.length,
        historyExportCount: recentHistoryExports.length,
      },
      links: {
        snapshots: snapshotPaths,
        bundles: recentBundleExports,
        historyExports: recentHistoryExports,
      },
    };

    setIsExportingDiagnosticsIndex(true);
    try {
      const outputPath = await invoke<string>("export_diagnostics_index", {
        index: indexPayload,
        filePath: selected,
      });

      toast.success(historyT.diagnosticsIndexExported || "诊断索引已导出", { description: outputPath });
    } catch (err) {
      toast.error(historyT.exportDiagnosticsIndexFailed || "导出诊断索引失败", { description: String(err) });
    } finally {
      setIsExportingDiagnosticsIndex(false);
    }
  };

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

  // Handle custom config updates
  const handleCustomConfigUpdate = (
    updates: Partial<PublishConfigStore>
  ) => {
    setCustomConfig({ ...customConfig, ...updates });
  };

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

  const handleLoadProfile = (profile: any) => {
    const profileProviderId =
      profile.providerId || profile.provider_id || activeProviderId;
    const schema = providerSchemas[profileProviderId];
    const mapping = mapImportedSpecByProvider(
      {
        providerId: profileProviderId,
        parameters: profile.parameters || {},
      },
      profileProviderId,
      {
        supportedKeys: schema ? Object.keys(schema.parameters) : undefined,
      }
    );

    if (profileProviderId !== activeProviderId) {
      setActiveProviderId(profileProviderId);
    }

    if (mapping.providerId === "dotnet") {
      handleCustomConfigUpdate(mapping.dotnetUpdates);
      setIsCustomMode(true);
    } else {
      setProviderParameters((prev) => ({
        ...prev,
        [mapping.providerId]: mapping.providerParameters,
      }));
    }

    toast.success(appT.profileLoaded || "配置文件已加载", {
      description: `${appT.loadedProfile || "已加载配置文件"}: ${profile.name}`,
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
        <CollapsiblePanel
          collapsed={leftPanelCollapsed}
          side="left"
          width={`${leftPanelWidth}px`}
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
            onRefreshBranches={handleRefreshRepoBranches}
            onSettings={handleOpenSettings}
            onCollapse={() => setLeftPanelCollapsed(true)}
          />
        </CollapsiblePanel>

        {/* Left Resize Handle */}
        {!leftPanelCollapsed && (
          <ResizeHandle onResize={handleLeftPanelResize} />
        )}

        {/* Middle Panel - Branch List */}
        <CollapsiblePanel
          collapsed={middlePanelCollapsed}
          side="left"
          width={`${middlePanelWidth}px`}
        >
          <BranchPanel
            repository={selectedRepo}
            onRefresh={() => toast.info(appT.refreshBranches || "刷新分支列表")}
            onCreateBranch={() => toast.info(appT.createBranchComingSoon || "创建分支功能开发中")}
            onCollapse={() => setMiddlePanelCollapsed(true)}
            showExpandButton={leftPanelCollapsed}
            onExpandRepo={() => setLeftPanelCollapsed(false)}
          />
        </CollapsiblePanel>

        {/* Middle Resize Handle */}
        {!middlePanelCollapsed && (
          <ResizeHandle onResize={handleMiddlePanelResize} />
        )}

        {/* Right Panel - Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Drag region header */}
          <div className="h-10 flex-shrink-0 border-b bg-card/30 flex">
            {/* Left column for expand buttons - only show when branch panel is collapsed */}
            {middlePanelCollapsed && (
              <div
                data-tauri-drag-region
                className={`flex items-center justify-end px-2 border-r ${
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
                    title={appT.expandBranchList || "展开分支列表"}
                    data-tauri-no-drag
                  >
                    <GitBranch className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
            {/* Main drag region */}
            <div data-tauri-drag-region className="flex-1" />
          </div>
          {/* Content area */}
          <div className="flex-1 overflow-auto p-6">
            <div className="mx-auto max-w-3xl space-y-6">
              {/* Project Info Card */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Folder className="h-5 w-5" />
                        {projectT.title || "项目信息"}
                      </CardTitle>
                      <CardDescription>
                        {selectedRepo ? selectedRepo.name : projectT.notSelected || "未选择仓库"}
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        value={activeProviderId}
                        onValueChange={setActiveProviderId}
                      >
                        <SelectTrigger className="w-[190px] h-9">
                          <SelectValue placeholder={appT.selectProvider || "选择 Provider"} />
                        </SelectTrigger>
                        <SelectContent>
                          {availableProviders.map((provider) => (
                            <SelectItem key={provider.id} value={provider.id}>
                              {formatProviderLabel(provider)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          selectedRepo &&
                          activeProviderId === "dotnet" &&
                          scanProject(selectedRepo.path)
                        }
                        disabled={
                          isScanning ||
                          !selectedRepo ||
                          activeProviderId !== "dotnet"
                        }
                      >
                        {isScanning ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                        <span className="ml-1">{configT.refresh || "刷新"}</span>
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {projectInfo ? (
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        <span className="text-muted-foreground">
                          {appT.projectRootLabel || "项目根目录:"}
                        </span>
                        <code className="bg-muted px-2 py-0.5 rounded text-xs">
                          {projectInfo.root_path}
                        </code>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        <span className="text-muted-foreground">{appT.projectFileLabel || "项目文件:"}</span>
                        <code className="bg-muted px-2 py-0.5 rounded text-xs">
                          {projectInfo.project_file}
                        </code>
                      </div>
                      {projectInfo.publish_profiles.length > 0 && (
                        <div className="flex items-start gap-2">
                          <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                          <span className="text-muted-foreground">
                            {projectT.profiles || "发布配置:"}
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {projectInfo.publish_profiles.map((profile) => (
                              <span
                                key={profile}
                                className="bg-primary/10 text-primary px-2 py-0.5 rounded text-xs"
                              >
                                {profile}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : activeProviderId !== "dotnet" && selectedRepo ? (
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        <span className="text-muted-foreground">{appT.repositoryPathLabel || "仓库路径:"}</span>
                        <code className="bg-muted px-2 py-0.5 rounded text-xs">
                          {selectedRepo.path}
                        </code>
                      </div>
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700 text-xs">
                        {(appT.providerReadyMessage || "当前 Provider: {{provider}}。可进行环境检查、命令解析、参数编辑与通用执行。").replace("{{provider}}", activeProviderLabel)}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <XCircle className="h-4 w-4 text-destructive" />
                      <span>
                        {selectedRepo
                          ? projectT.not || "当前仓库不是 .NET 项目"
                          : projectT.notSelected || "请从左侧选择一个仓库"}
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>

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
                          onValueChange={setSelectedPreset}
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
                    <div className="mt-4 p-3 bg-muted rounded-lg">
                      <div className="text-xs text-muted-foreground mb-2">
                        {publishT.command || "将执行的命令:"}
                      </div>
                      <code className="text-xs font-mono break-all">
                        dotnet publish "{projectInfo.project_file}" -c{" "}
                        {getCurrentConfig().configuration}
                        {getCurrentConfig().runtime &&
                          ` --runtime ${getCurrentConfig().runtime}`}
                        {getCurrentConfig().self_contained && " --self-contained"}
                        {getCurrentConfig().output_dir &&
                          ` -o "${getCurrentConfig().output_dir}"`}
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
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700 text-sm">
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
                    <div className="rounded-md bg-muted p-3">
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
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-700">
                      {(appT.mappedFieldsLabel || "已映射字段") + ` (${activeImportFeedback.mappedKeys.length}):`} 
                      {activeImportFeedback.mappedKeys.length > 0
                        ? activeImportFeedback.mappedKeys.join(", ")
                        : appT.none || "无"}
                    </div>
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700">
                      {(appT.unmappedFieldsLabel || "未映射字段") + ` (${activeImportFeedback.unmappedKeys.length}):`} 
                      {activeImportFeedback.unmappedKeys.length > 0
                        ? activeImportFeedback.unmappedKeys.join(", ")
                        : appT.none || "无"}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Output Log Card */}
              {(outputLog || publishResult) && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Terminal className="h-5 w-5" />
                      {appT.outputLogTitle || "输出日志"}
                      {publishResult && (
                        <span
                          className={`ml-2 text-sm font-normal ${
                            publishResult.success
                              ? "text-green-500"
                              : publishResult.cancelled
                                ? "text-amber-500"
                                : "text-destructive"
                          }`}
                        >
                          {publishResult.success
                            ? appT.statusSuccess || "成功"
                            : publishResult.cancelled
                              ? appT.statusCancelled || "已取消"
                              : appT.statusFailed || "失败"}
                        </span>
                      )}
                    </CardTitle>
                    {publishResult && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-fit"
                        onClick={exportExecutionSnapshot}
                        disabled={isExportingSnapshot}
                      >
                        {isExportingSnapshot ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            {appT.exporting || "导出中..."}
                          </>
                        ) : (
                          appT.exportSnapshot || "导出执行快照"
                        )}
                      </Button>
                    )}
                    {publishResult?.success && publishResult.output_dir && (
                      <>
                        <CardDescription>
                          {(appT.outputDirectoryLabel || "输出目录")}: {publishResult.output_dir} (
                          {publishResult.file_count} {appT.fileCountUnit || "个文件"})
                        </CardDescription>
                        {publishResult.provider_id === "dotnet" && (
                          <>
                            <ArtifactActions
                              outputDir={publishResult.output_dir}
                              onStateChange={setArtifactActionState}
                            />
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              className="w-fit"
                              onClick={() => setReleaseChecklistOpen(true)}
                            >
                              <ListChecks className="h-4 w-4 mr-1" />
                              {appT.openReleaseChecklist || "打开签名发布清单"}
                            </Button>
                          </>
                        )}
                      </>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="bg-gray-950 text-gray-100 p-4 rounded-lg font-mono text-xs max-h-80 overflow-auto">
                      <pre className="whitespace-pre-wrap">
                        {outputLog || publishResult?.error || appT.noOutput || "无输出"}
                      </pre>
                    </div>
                  </CardContent>
                </Card>
              )}

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
                          className="rounded-md border px-3 py-2 text-sm"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{group.providerId}</span>
                            <span className="text-xs text-muted-foreground">
                              {(failureT.recentCount || "最近 {{count}} 次").replace("{{count}}", String(group.count))}
                            </span>
                          </div>
                          <div className="mt-1 rounded bg-muted px-2 py-1 font-mono text-xs break-all">
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
                    <div className="rounded bg-muted px-2 py-1 font-mono text-xs break-all">
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
                        className="rounded-md border px-3 py-2 text-sm"
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
                        <div className="mt-1 rounded bg-muted px-2 py-1 font-mono text-xs break-all">
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

              {executionHistory.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">{historyT.title || "最近执行历史"}</CardTitle>
                    <CardDescription>
                      {(historyT.description || "本地保留最近 {{count}} 条发布记录").replace("{{count}}", String(executionHistoryLimit))}
                      {filteredExecutionHistory.length !== executionHistory.length
                        ? ` · ${(historyT.currentFilter || "当前筛选")} ${filteredExecutionHistory.length}/${executionHistory.length}`
                        : ""}
                    </CardDescription>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-fit"
                        onClick={() => void exportExecutionHistory()}
                        disabled={
                          isExportingHistory || filteredExecutionHistory.length === 0
                        }
                      >
                        {isExportingHistory ? (
                          <>
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            {appT.exporting || "导出中..."}
                          </>
                        ) : (
                          historyT.exportHistory || "导出历史"
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-fit"
                        onClick={exportDailyTriageReport}
                        disabled={!dailyTriagePreset.enabled || isExportingHistory}
                      >
                        {isExportingHistory ? (
                          <>
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            {appT.exporting || "导出中..."}
                          </>
                        ) : (
                          historyT.exportDailyReport || "一键导出日报"
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-fit"
                        onClick={exportDiagnosticsIndex}
                        disabled={isExportingDiagnosticsIndex}
                      >
                        {isExportingDiagnosticsIndex ? (
                          <>
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            {historyT.generating || "生成中..."}
                          </>
                        ) : (
                          historyT.exportDiagnosticsIndex || "导出诊断索引"
                        )}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid gap-2 md:grid-cols-4">
                      <Select
                        value={historyFilterProvider}
                        onValueChange={setHistoryFilterProvider}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue placeholder={historyT.filterProvider || "筛选 Provider"} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{historyT.allProviders || "全部 Provider"}</SelectItem>
                          {historyProviderOptions.map((providerId) => (
                            <SelectItem key={providerId} value={providerId}>
                              {providerId}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={historyFilterStatus}
                        onValueChange={(value) =>
                          setHistoryFilterStatus(value as HistoryFilterStatus)
                        }
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue placeholder={historyT.filterStatus || "筛选状态"} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{historyT.allStatuses || "全部状态"}</SelectItem>
                          <SelectItem value="success">{appT.statusSuccess || "成功"}</SelectItem>
                          <SelectItem value="failed">{appT.statusFailed || "失败"}</SelectItem>
                          <SelectItem value="cancelled">{appT.statusCancelled || "已取消"}</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select
                        value={historyFilterWindow}
                        onValueChange={(value) =>
                          setHistoryFilterWindow(value as HistoryFilterWindow)
                        }
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue placeholder={historyT.timeWindow || "时间窗口"} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{historyT.allTime || "全部时间"}</SelectItem>
                          <SelectItem value="24h">{historyT.last24Hours || "最近 24 小时"}</SelectItem>
                          <SelectItem value="7d">{historyT.last7Days || "最近 7 天"}</SelectItem>
                          <SelectItem value="30d">{historyT.last30Days || "最近 30 天"}</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        className="h-8"
                        value={historyFilterKeyword}
                        onChange={(e) => setHistoryFilterKeyword(e.target.value)}
                        placeholder={historyT.keywordPlaceholder || "关键词（签名/错误/命令）"}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        value={selectedHistoryPresetId}
                        onValueChange={applyHistoryPreset}
                      >
                        <SelectTrigger className="h-8 w-[220px]">
                          <SelectValue placeholder={historyT.selectPreset || "选择筛选预设"} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{historyT.noPreset || "(不使用预设)"}</SelectItem>
                          {historyFilterPresets.map((preset) => (
                            <SelectItem key={preset.id} value={preset.id}>
                              {preset.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={saveCurrentHistoryPreset}
                      >
                        {historyT.saveAsPreset || "保存为预设"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={deleteSelectedHistoryPreset}
                        disabled={selectedHistoryPresetId === "none"}
                      >
                        {historyT.deletePreset || "删除预设"}
                      </Button>
                    </div>
                    <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium">{historyT.dailyPresetTitle || "每日排障预设"}</p>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{historyT.enabled || "启用"}</span>
                          <Switch
                            checked={dailyTriagePreset.enabled}
                            onCheckedChange={(checked) =>
                              setDailyTriagePreset((prev) => ({
                                ...prev,
                                enabled: checked,
                              }))
                            }
                          />
                        </div>
                      </div>
                      <div className="grid gap-2 md:grid-cols-5">
                        <Select
                          value={dailyTriagePreset.provider}
                          onValueChange={(value) =>
                            setDailyTriagePreset((prev) => ({
                              ...prev,
                              provider: value,
                            }))
                          }
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue placeholder={historyT.provider || "Provider"} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">{historyT.allProviders || "全部 Provider"}</SelectItem>
                            {historyProviderOptions.map((providerId) => (
                              <SelectItem key={`triage-${providerId}`} value={providerId}>
                                {providerId}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={dailyTriagePreset.status}
                          onValueChange={(value) =>
                            setDailyTriagePreset((prev) => ({
                              ...prev,
                              status: value as HistoryFilterStatus,
                            }))
                          }
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue placeholder={historyT.status || "状态"} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">{historyT.allStatuses || "全部状态"}</SelectItem>
                            <SelectItem value="success">{appT.statusSuccess || "成功"}</SelectItem>
                            <SelectItem value="failed">{appT.statusFailed || "失败"}</SelectItem>
                            <SelectItem value="cancelled">{appT.statusCancelled || "已取消"}</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select
                          value={dailyTriagePreset.window}
                          onValueChange={(value) =>
                            setDailyTriagePreset((prev) => ({
                              ...prev,
                              window: value as HistoryFilterWindow,
                            }))
                          }
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue placeholder={historyT.timeWindow || "时间窗口"} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">{historyT.allTime || "全部时间"}</SelectItem>
                            <SelectItem value="24h">{historyT.last24Hours || "最近 24 小时"}</SelectItem>
                            <SelectItem value="7d">{historyT.last7Days || "最近 7 天"}</SelectItem>
                            <SelectItem value="30d">{historyT.last30Days || "最近 30 天"}</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select
                          value={dailyTriagePreset.format}
                          onValueChange={(value) =>
                            setDailyTriagePreset((prev) => ({
                              ...prev,
                              format: value as HistoryExportFormat,
                            }))
                          }
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue placeholder={historyT.format || "格式"} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="csv">CSV</SelectItem>
                            <SelectItem value="json">JSON</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          className="h-8"
                          value={dailyTriagePreset.keyword}
                          onChange={(event) =>
                            setDailyTriagePreset((prev) => ({
                              ...prev,
                              keyword: event.target.value,
                            }))
                          }
                          placeholder={historyT.dailyKeyword || "日报关键词（可选）"}
                        />
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {(historyT.dailyPresetMatches || "当前预设命中 {{count}} 条记录").replace("{{count}}", String(dailyTriageRecords.length))}
                        {dailyTriagePreset.enabled ? "" : historyT.disabled || "（已禁用）"}
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          setDailyTriagePreset(DEFAULT_DAILY_TRIAGE_PRESET)
                        }
                      >
                        {historyT.resetDailyPreset || "恢复日报默认预设"}
                      </Button>
                    </div>
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setHistoryFilterProvider("all");
                          setHistoryFilterStatus("all");
                          setHistoryFilterWindow("all");
                          setHistoryFilterKeyword("");
                          setSelectedHistoryPresetId("none");
                        }}
                        disabled={
                          historyFilterProvider === "all" &&
                          historyFilterStatus === "all" &&
                          historyFilterWindow === "all" &&
                          historyFilterKeyword.length === 0
                        }
                      >
                        {historyT.clearFilters || "清空筛选"}
                      </Button>
                    </div>

                    {filteredExecutionHistory.length === 0 ? (
                      <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
                        {historyT.noRecords || "当前筛选条件下无执行记录"}
                      </div>
                    ) : (
                      filteredExecutionHistory.slice(0, 6).map((record) => (
                        <div
                          key={record.id}
                          className="rounded-md border px-3 py-2 text-sm"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{record.providerId}</span>
                            <span
                              className={`text-xs ${
                                record.success
                                  ? "text-green-600"
                                  : record.cancelled
                                    ? "text-amber-600"
                                    : "text-red-600"
                              }`}
                            >
                              {record.success
                                ? appT.statusSuccess || "成功"
                                : record.cancelled
                                  ? appT.statusCancelled || "已取消"
                                  : appT.statusFailed || "失败"}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {record.projectPath}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {(historyT.completedAt || "完成时间")}: {new Date(record.finishedAt).toLocaleString()}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
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
                              {historyT.rerun || "重新执行"}
                            </Button>
                            {record.success && (
                              <>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    void copyHandoffSnippet(record, "shell")
                                  }
                                >
                                  {historyT.copyShellSnippet || "复制 Shell 片段"}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    void copyHandoffSnippet(record, "github-actions")
                                  }
                                >
                                  {historyT.copyGhaSnippet || "复制 GHA 片段"}
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              )}
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
            <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
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
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
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
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
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
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
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

      {/* Config Dialog */}
      <ConfigDialog
        open={configDialogOpen}
        onOpenChange={setConfigDialogOpen}
        onLoadProfile={handleLoadProfile}
        currentProviderId={activeProviderId}
        currentParameters={
          activeProviderId === "dotnet"
            ? {
                configuration: customConfig.configuration,
                runtime: customConfig.runtime,
                output: customConfig.outputDir,
                self_contained: customConfig.selfContained,
              }
            : activeProviderParameters
        }
      />
    </div>
  );
}

export default App;
