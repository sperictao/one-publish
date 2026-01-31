import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";

// Hooks
import { useAppState } from "@/hooks/useAppState";
import { useTheme } from "@/hooks/useTheme";
import type { PublishConfigStore } from "@/lib/store";

// Layout Components
import { CollapsiblePanel } from "@/components/layout/CollapsiblePanel";
import { RepositoryList } from "@/components/layout/RepositoryList";
import { BranchPanel } from "@/components/layout/BranchPanel";
import { ResizeHandle } from "@/components/layout/ResizeHandle";
import { SettingsDialog } from "@/components/layout/SettingsDialog";
import { ShortcutsDialog } from "@/components/layout/ShortcutsDialog";

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
} from "lucide-react";

// Types
import type { Repository } from "@/types/repository";

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
  success: boolean;
  output: string;
  error: string | null;
  output_dir: string;
  file_count: number;
}

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
    language,
    minimizeToTrayOnClose,
    defaultOutputDir,
    theme,
    setLanguage,
    setMinimizeToTrayOnClose,
    setDefaultOutputDir,
    setTheme,
  } = useAppState();

  // 应用主题
  useTheme(theme);

  // 快捷键处理（待实现事件监听）
  // useShortcuts({
  //   onRefresh: () => {
  //     // 刷新项目
  //     if (selectedRepo && !isStateLoading) {
  //       scanProject(selectedRepo.path);
  //     }
  //   },
  //   onPublish: () => {
  //     // 执行发布
  //     if (!isPublishing && projectInfo) {
  //       executePublish();
  //     }
  //   },
  //   onOpenSettings: () => {
  //     // 打开设置
  //     setSettingsOpen(true);
  //   },
  // });

  // Layout State (local only - collapse state doesn't need persistence)
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [middlePanelCollapsed, setMiddlePanelCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

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
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);
  const [outputLog, setOutputLog] = useState<string>("");
  const [isScanning, setIsScanning] = useState(false);

  // Open settings dialog
  const handleOpenSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);

  // Get selected repository
  const selectedRepo = repositories.find((r) => r.id === selectedRepoId) || null;

  // Load project info when repo changes
  useEffect(() => {
    if (selectedRepo && !isStateLoading) {
      scanProject(selectedRepo.path);
    }
  }, [selectedRepoId, isStateLoading]);

  // Setup window drag functionality for Tauri 2.x
  useEffect(() => {
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

  // Execute publish
  const executePublish = async () => {
    if (!projectInfo) {
      toast.error("请先选择项目目录");
      return;
    }

    setIsPublishing(true);
    setPublishResult(null);
    setOutputLog("");

    const config = getCurrentConfig();

    try {
      const result = await invoke<PublishResult>("execute_publish", {
        projectPath: projectInfo.project_file,
        config,
      });

      setPublishResult(result);
      setOutputLog(result.output);

      if (result.success) {
        toast.success("发布成功!", {
          description: `输出目录: ${result.output_dir}`,
        });
      } else {
        toast.error("发布失败", {
          description: result.error || "未知错误",
        });
      }
    } catch (err) {
      const errorMsg = String(err);
      setPublishResult({
        success: false,
        output: "",
        error: errorMsg,
        output_dir: "",
        file_count: 0,
      });
      toast.error("发布执行错误", {
        description: errorMsg,
      });
    } finally {
      setIsPublishing(false);
    }
  };

  // Handle custom config updates
  const handleCustomConfigUpdate = (
    updates: Partial<PublishConfigStore>
  ) => {
    setCustomConfig({ ...customConfig, ...updates });
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
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          selectedRepo && scanProject(selectedRepo.path)
                        }
                        disabled={isScanning || !selectedRepo}
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
              {projectInfo && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Settings className="h-5 w-5" />
                      发布配置
                    </CardTitle>
                    <CardDescription>
                      选择预设配置或自定义发布参数
                    </CardDescription>
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
                              : "text-destructive"
                          }`}
                        >
                          {publishResult.success ? "成功" : "失败"}
                        </span>
                      )}
                    </CardTitle>
                    {publishResult?.success && (
                      <CardDescription>
                        输出目录: {publishResult.output_dir} (
                        {publishResult.file_count} 个文件)
                      </CardDescription>
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
            </div>
          </div>
        </div>
      </div>

      {/* Shortcuts Dialog */}
      <ShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
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
        theme={theme}
        onThemeChange={setTheme}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />
    </div>
  );
}

export default App;
