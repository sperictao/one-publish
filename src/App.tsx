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
import { useI18n } from "@/hooks/useI18n";
import {
  addExecutionRecord,
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
  getRepresentativeRecord,
  groupExecutionFailures,
  type FailureGroup,
} from "@/lib/failureGroups";
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

function App() {
  // 使用持久化的应用状态
  const {
    isLoading: isStateLoading,
    repositories,
    selectedRepoId,
    addRepository,
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
    minimizeToTrayOnClose,
    defaultOutputDir,
    theme,
    executionHistoryLimit,
    setMinimizeToTrayOnClose,
    setDefaultOutputDir,
    setTheme,
    setExecutionHistoryLimit,
  } = useAppState();

  // 应用主题
  useTheme(theme);

  // 国际化
  const { language, setLanguage } = useI18n();

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
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);
  const [lastExecutedSpec, setLastExecutedSpec] =
    useState<ProviderPublishSpec | null>(null);
  const [executionHistory, setExecutionHistory] = useState<ExecutionRecord[]>([]);
  const [historyFilterProvider, setHistoryFilterProvider] = useState("all");
  const [historyFilterStatus, setHistoryFilterStatus] = useState<
    "all" | "success" | "failed" | "cancelled"
  >("all");
  const [historyFilterKeyword, setHistoryFilterKeyword] = useState("");
  const [selectedFailureGroupKey, setSelectedFailureGroupKey] =
    useState<string | null>(null);
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

  const filteredExecutionHistory = useMemo(() => {
    const keyword = historyFilterKeyword.trim().toLowerCase();

    return executionHistory.filter((record) => {
      if (historyFilterProvider !== "all" && record.providerId !== historyFilterProvider) {
        return false;
      }

      if (historyFilterStatus === "success" && !record.success) {
        return false;
      }
      if (historyFilterStatus === "cancelled" && !record.cancelled) {
        return false;
      }
      if (
        historyFilterStatus === "failed" &&
        (record.success || record.cancelled)
      ) {
        return false;
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
  }, [
    executionHistory,
    historyFilterProvider,
    historyFilterStatus,
    historyFilterKeyword,
  ]);

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
  }, []);

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
      toast.success("项目检测成功", {
        description: `找到项目: ${info.project_file}`,
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
      title: "选择仓库目录",
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
        toast.success("仓库已添加", { description: name });
      } catch (err) {
        toast.error("添加仓库失败", { description: String(err) });
      }
    }
  };

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
          toast.error("环境未就绪，已阻止发布", {
            description: critical.description,
          });
          openEnvironmentDialog(env, [spec.provider_id]);
          return;
        }

        const warning = env.issues.find((i) => i.severity === "warning");
        if (warning) {
          toast.warning("环境存在警告", {
            description: warning.description,
          });
        }
      } catch (err) {
        toast.error("环境检查失败", { description: String(err) });
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
          toast.success("发布成功!", {
            description: result.output_dir
              ? `输出目录: ${result.output_dir}`
              : "命令执行成功",
          });
        } else if (result.cancelled) {
          toast.warning("发布已取消", {
            description: result.error || "用户取消了执行任务",
          });
        } else {
          toast.error("发布失败", {
            description: result.error || "未知错误",
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
        toast.error("发布执行错误", {
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
      toast.error(`缺少可复制的${label}`);
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
          throw new Error("复制失败");
        }
      }

      toast.success(`${label}已复制`);
    } catch (err) {
      toast.error(`复制${label}失败`, { description: String(err) });
    }
  }, []);

  const copyGroupSignature = useCallback(
    async (group: FailureGroup) => {
      await copyText(group.signature, "失败签名");
    },
    [copyText]
  );

  const copyRecordCommand = useCallback(
    async (record: ExecutionRecord) => {
      if (!record.commandLine) {
        toast.error("该记录缺少命令行信息");
        return;
      }

      await copyText(record.commandLine, "命令行");
    },
    [copyText]
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

      toast.success("已打开执行快照", { description: openedPath });
    } catch (err) {
      toast.error("打开执行快照失败", { description: String(err) });
    }
  }, []);

  const rerunFromHistory = useCallback(
    async (record: ExecutionRecord) => {
      const spec = extractSpecFromRecord(record);
      if (!spec) {
        toast.error("历史记录缺少可恢复的发布参数", {
          description: "请使用最新版本重新执行一次后再重跑",
        });
        return;
      }

      restoreSpecToEditor(spec);
      await runPublishWithSpec(spec);
    },
    [extractSpecFromRecord, restoreSpecToEditor, runPublishWithSpec]
  );

  // Execute publish
  const executePublish = async () => {
    if (!selectedRepo) {
      toast.error("请先选择仓库");
      return;
    }

    let spec: ProviderPublishSpec;

    if (activeProviderId === "dotnet") {
      if (!projectInfo) {
        toast.error("请先选择 .NET 项目");
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
        toast.message("正在取消发布...");
      } else {
        toast.message("当前没有运行中的发布任务");
      }
    } catch (err) {
      toast.error("取消发布失败", { description: String(err) });
    } finally {
      setIsCancellingPublish(false);
    }
  };

  const exportExecutionSnapshot = async () => {
    if (!publishResult || !lastExecutedSpec) {
      toast.error("暂无可导出的执行快照");
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:]/g, "-");
    const defaultPath = publishResult.output_dir
      ? `${publishResult.output_dir}/execution-snapshot-${timestamp}.md`
      : `execution-snapshot-${timestamp}.md`;

    const selected = await save({
      title: "导出执行快照",
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

      toast.success("执行快照已导出", { description: outputPath });
    } catch (err) {
      toast.error("导出执行快照失败", { description: String(err) });
    } finally {
      setIsExportingSnapshot(false);
    }
  };

  const exportFailureGroupBundle = async () => {
    if (!selectedFailureGroup) {
      toast.error("请先选择失败分组");
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
      title: "导出失败组诊断包",
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

      toast.success("失败组诊断包已导出", { description: outputPath });
    } catch (err) {
      toast.error("导出失败组诊断包失败", { description: String(err) });
    } finally {
      setIsExportingFailureBundle(false);
    }
  };

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
      toast.error("未找到可映射参数", {
        description: `未映射字段: ${mapping.unmappedKeys.join(", ")}`,
      });
      return;
    }

    if (mapping.unmappedKeys.length > 0) {
      toast.message("参数已部分导入", {
        description: `已映射 ${mapping.mappedKeys.length} 个字段，未映射 ${mapping.unmappedKeys.length} 个字段`,
      });
      return;
    }

    toast.success("参数已导入", {
      description: `已映射 ${mapping.mappedKeys.length} 个字段`,
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

    toast.success("配置文件已加载", {
      description: `已加载配置文件: ${profile.name}`,
    });
  };

  // Show loading state
  if (isStateLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="text-muted-foreground">加载中...</span>
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
            onSelectRepo={selectRepository}
            onAddRepo={handleAddRepo}
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
            onRefresh={() => toast.info("刷新分支列表")}
            onCreateBranch={() => toast.info("创建分支功能开发中")}
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
                      title="展开仓库列表"
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
                    title="展开分支列表"
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
                        项目信息
                      </CardTitle>
                      <CardDescription>
                        {selectedRepo ? selectedRepo.name : "未选择仓库"}
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        value={activeProviderId}
                        onValueChange={setActiveProviderId}
                      >
                        <SelectTrigger className="w-[190px] h-9">
                          <SelectValue placeholder="选择 Provider" />
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
                        <span className="ml-1">刷新</span>
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
                          项目根目录:
                        </span>
                        <code className="bg-muted px-2 py-0.5 rounded text-xs">
                          {projectInfo.root_path}
                        </code>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        <span className="text-muted-foreground">项目文件:</span>
                        <code className="bg-muted px-2 py-0.5 rounded text-xs">
                          {projectInfo.project_file}
                        </code>
                      </div>
                      {projectInfo.publish_profiles.length > 0 && (
                        <div className="flex items-start gap-2">
                          <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                          <span className="text-muted-foreground">
                            发布配置:
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
                        <span className="text-muted-foreground">仓库路径:</span>
                        <code className="bg-muted px-2 py-0.5 rounded text-xs">
                          {selectedRepo.path}
                        </code>
                      </div>
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700 text-xs">
                        当前 Provider: {activeProviderLabel}。可进行环境检查、命令解析、参数编辑与通用执行。
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <XCircle className="h-4 w-4 text-destructive" />
                      <span>
                        {selectedRepo
                          ? "当前仓库不是 .NET 项目"
                          : "请从左侧选择一个仓库"}
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
                          发布配置
                        </CardTitle>
                        <CardDescription>
                          选择预设配置或自定义发布参数
                        </CardDescription>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCommandImportOpen(true)}
                        disabled={!selectedRepo}
                      >
                        <Import className="h-4 w-4 mr-1" />
                        从命令导入
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Mode Toggle */}
                    <div className="flex items-center justify-between">
                      <Label htmlFor="custom-mode">自定义模式</Label>
                      <Switch
                        id="custom-mode"
                        checked={isCustomMode}
                        onCheckedChange={setIsCustomMode}
                      />
                    </div>

                    {!isCustomMode ? (
                      /* Preset Selection */
                      <div className="space-y-2">
                        <Label>选择预设配置</Label>
                        <Select
                          value={selectedPreset}
                          onValueChange={setSelectedPreset}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="选择发布配置" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectLabel>Release 配置</SelectLabel>
                              {PRESETS.filter((p) =>
                                p.id.startsWith("release")
                              ).map((preset) => (
                                <SelectItem key={preset.id} value={preset.id}>
                                  <div className="flex flex-col">
                                    <span>{preset.name}</span>
                                    <span className="text-xs text-muted-foreground">
                                      {preset.description}
                                    </span>
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectGroup>
                            <SelectGroup>
                              <SelectLabel>Debug 配置</SelectLabel>
                              {PRESETS.filter((p) =>
                                p.id.startsWith("debug")
                              ).map((preset) => (
                                <SelectItem key={preset.id} value={preset.id}>
                                  <div className="flex flex-col">
                                    <span>{preset.name}</span>
                                    <span className="text-xs text-muted-foreground">
                                      {preset.description}
                                    </span>
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectGroup>
                            {projectInfo.publish_profiles.length > 0 && (
                              <SelectGroup>
                                <SelectLabel>项目发布配置</SelectLabel>
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
                          <Label htmlFor="configuration">配置类型</Label>
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
                          <Label htmlFor="runtime">运行时</Label>
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
                              <SelectItem value="none">框架依赖</SelectItem>
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
                          <Label htmlFor="output-dir">输出目录</Label>
                          <Input
                            id="output-dir"
                            value={customConfig.outputDir}
                            onChange={(e) =>
                              handleCustomConfigUpdate({
                                outputDir: e.target.value,
                              })
                            }
                            placeholder="留空使用默认目录"
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
                          <Label htmlFor="self-contained">自包含部署</Label>
                        </div>
                      </div>
                    )}

                    {/* Current Config Preview */}
                    <div className="mt-4 p-3 bg-muted rounded-lg">
                      <div className="text-xs text-muted-foreground mb-2">
                        将执行的命令:
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
                          发布中...
                        </>
                      ) : (
                        <>
                          <Play className="h-5 w-5 mr-2" />
                          执行发布
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
                            取消中...
                          </>
                        ) : (
                          <>
                            <Square className="h-4 w-4 mr-2" />
                            取消发布
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
                          发布配置
                        </CardTitle>
                        <CardDescription>
                          {activeProviderLabel} Provider 已就绪（支持参数映射与通用执行）
                        </CardDescription>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCommandImportOpen(true)}
                      >
                        <Import className="h-4 w-4 mr-1" />
                        从命令导入
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700 text-sm">
                      当前已支持 {activeProviderLabel} 的命令导入映射、参数编辑与通用执行。
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
                        正在加载 Provider 参数定义...
                      </div>
                    )}
                    <div className="rounded-md bg-muted p-3">
                      <div className="text-xs text-muted-foreground mb-2">
                        当前参数快照（可保存为配置文件）:
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
                      打开环境检查
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
                          发布中...
                        </>
                      ) : (
                        <>
                          <Play className="h-5 w-5 mr-2" />
                          执行发布
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
                            取消中...
                          </>
                        ) : (
                          <>
                            <Square className="h-4 w-4 mr-2" />
                            取消发布
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
                      命令导入映射结果
                    </CardTitle>
                    <CardDescription>
                      Provider: {formatProviderLabel(activeProvider)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-700">
                      已映射字段 ({activeImportFeedback.mappedKeys.length}):{" "}
                      {activeImportFeedback.mappedKeys.length > 0
                        ? activeImportFeedback.mappedKeys.join(", ")
                        : "无"}
                    </div>
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700">
                      未映射字段 ({activeImportFeedback.unmappedKeys.length}):{" "}
                      {activeImportFeedback.unmappedKeys.length > 0
                        ? activeImportFeedback.unmappedKeys.join(", ")
                        : "无"}
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
                      输出日志
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
                            ? "成功"
                            : publishResult.cancelled
                              ? "已取消"
                              : "失败"}
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
                            导出中...
                          </>
                        ) : (
                          "导出执行快照"
                        )}
                      </Button>
                    )}
                    {publishResult?.success && publishResult.output_dir && (
                      <>
                        <CardDescription>
                          输出目录: {publishResult.output_dir} (
                          {publishResult.file_count} 个文件)
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
                              打开签名发布清单
                            </Button>
                          </>
                        )}
                      </>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="bg-gray-950 text-gray-100 p-4 rounded-lg font-mono text-xs max-h-80 overflow-auto">
                      <pre className="whitespace-pre-wrap">
                        {outputLog || publishResult?.error || "无输出"}
                      </pre>
                    </div>
                  </CardContent>
                </Card>
              )}

              {failureGroups.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">失败诊断聚合</CardTitle>
                    <CardDescription>
                      相同失败签名自动归并，支持分组钻取与快速复制
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
                              最近 {group.count} 次
                            </span>
                          </div>
                          <div className="mt-1 rounded bg-muted px-2 py-1 font-mono text-xs break-all">
                            {group.signature}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            最新时间: {new Date(group.latestRecord.finishedAt).toLocaleString()}
                          </div>
                          {group.latestRecord.error && (
                            <div className="text-xs text-muted-foreground break-all">
                              最新错误: {group.latestRecord.error}
                            </div>
                          )}
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant={isSelected ? "default" : "outline"}
                              onClick={() => setSelectedFailureGroupKey(group.key)}
                            >
                              {isSelected ? "已选中" : "查看详情"}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => void copyGroupSignature(group)}
                            >
                              <Copy className="mr-1 h-3 w-3" />
                              复制签名
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
                              打开代表快照
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => void rerunFromHistory(group.latestRecord)}
                              disabled={isPublishing}
                            >
                              重跑代表记录
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
                    <CardTitle className="text-lg">失败组详情</CardTitle>
                    <CardDescription>
                      {selectedFailureGroup.providerId} · 最近 {selectedFailureGroup.count} 次失败（按完成时间倒序）
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="rounded bg-muted px-2 py-1 font-mono text-xs break-all">
                      {selectedFailureGroup.signature}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void copyGroupSignature(selectedFailureGroup)}
                      >
                        <Copy className="mr-1 h-3 w-3" />
                        复制签名
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
                        复制代表命令
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
                            导出中...
                          </>
                        ) : (
                          "导出诊断包"
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
                            {index === 0 ? "最新失败记录" : `历史失败记录 #${index + 1}`}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(record.finishedAt).toLocaleString()}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {record.projectPath}
                        </div>
                        <div className="mt-1 rounded bg-muted px-2 py-1 font-mono text-xs break-all">
                          {record.commandLine || "(无命令行记录)"}
                        </div>
                        {record.error && (
                          <div className="mt-1 text-xs text-muted-foreground break-all">
                            错误: {record.error}
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
                            复制命令
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => void openSnapshotFromRecord(record)}
                            disabled={!record.snapshotPath && !record.outputDir}
                          >
                            打开快照
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => void rerunFromHistory(record)}
                            disabled={isPublishing}
                          >
                            重跑记录
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
                    <CardTitle className="text-lg">最近执行历史</CardTitle>
                    <CardDescription>
                      本地保留最近 {executionHistoryLimit} 条发布记录
                      {filteredExecutionHistory.length !== executionHistory.length
                        ? ` · 当前筛选 ${filteredExecutionHistory.length}/${executionHistory.length}`
                        : ""}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid gap-2 md:grid-cols-3">
                      <Select
                        value={historyFilterProvider}
                        onValueChange={setHistoryFilterProvider}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue placeholder="筛选 Provider" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">全部 Provider</SelectItem>
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
                          setHistoryFilterStatus(
                            value as "all" | "success" | "failed" | "cancelled"
                          )
                        }
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue placeholder="筛选状态" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">全部状态</SelectItem>
                          <SelectItem value="success">成功</SelectItem>
                          <SelectItem value="failed">失败</SelectItem>
                          <SelectItem value="cancelled">已取消</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        className="h-8"
                        value={historyFilterKeyword}
                        onChange={(e) => setHistoryFilterKeyword(e.target.value)}
                        placeholder="关键词（签名/错误/命令）"
                      />
                    </div>
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setHistoryFilterProvider("all");
                          setHistoryFilterStatus("all");
                          setHistoryFilterKeyword("");
                        }}
                        disabled={
                          historyFilterProvider === "all" &&
                          historyFilterStatus === "all" &&
                          historyFilterKeyword.length === 0
                        }
                      >
                        清空筛选
                      </Button>
                    </div>

                    {filteredExecutionHistory.length === 0 ? (
                      <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
                        当前筛选条件下无执行记录
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
                                ? "成功"
                                : record.cancelled
                                  ? "已取消"
                                  : "失败"}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {record.projectPath}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            完成时间: {new Date(record.finishedAt).toLocaleString()}
                          </div>
                          <div className="mt-2 flex gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => void openSnapshotFromRecord(record)}
                              disabled={!record.snapshotPath && !record.outputDir}
                            >
                              打开快照
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => void rerunFromHistory(record)}
                              disabled={isPublishing}
                            >
                              重新执行
                            </Button>
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
        onLanguageChange={setLanguage}
        minimizeToTrayOnClose={minimizeToTrayOnClose}
        onMinimizeToTrayOnCloseChange={setMinimizeToTrayOnClose}
        defaultOutputDir={defaultOutputDir}
        onDefaultOutputDirChange={setDefaultOutputDir}
        executionHistoryLimit={executionHistoryLimit}
        onExecutionHistoryLimitChange={setExecutionHistoryLimit}
        theme={theme}
        onThemeChange={setTheme}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onOpenConfig={() => setConfigDialogOpen(true)}
        environmentStatus={environmentStatus}
        environmentCheckedAt={environmentLastResult?.checked_at}
        onOpenEnvironment={() => openEnvironmentDialog(null, [activeProviderId])}
      />

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
