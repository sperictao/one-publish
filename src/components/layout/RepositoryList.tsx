import { useEffect, useState, type FormEvent } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  Plus,
  Settings,
  ChevronDown,
  MoreHorizontal,
  Pencil,
  Trash2,
  RefreshCw,
  FolderGit2,
  FileSearch,
  GitBranch,
  Package,
} from "lucide-react";
import type { Branch, Repository } from "@/types/repository";
import { useI18n } from "@/hooks/useI18n";

// Collapse toggle icon
function CollapseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="2"
        y="2"
        width="12"
        height="12"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      <line x1="6" y1="2" x2="6" y2="14" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M11 6L8 8L11 10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface RepositoryListProps {
  repositories: Repository[];
  selectedRepoId: string | null;
  providers: Array<{ id: string; displayName: string; label?: string }>;
  onSelectRepo: (id: string) => void;
  onAddRepo: () => void;
  onEditRepo: (repo: Repository) => Promise<boolean> | boolean;
  onRemoveRepo: (repo: Repository) => Promise<void> | void;
  onDetectProvider: (
    path: string,
    options?: { silentSuccess?: boolean }
  ) => Promise<string | null>;
  onScanProjectFiles: (path: string) => Promise<string[]>;
  onRefreshBranches: (
    path: string,
    options?: { silentSuccess?: boolean }
  ) => Promise<{ branches: Branch[]; currentBranch: string } | null>;
  branchConnectivityByRepoId: Record<string, boolean>;
  onSettings: () => void;
  onCollapse?: () => void;
}

export function RepositoryList({
  repositories,
  selectedRepoId,
  providers,
  onSelectRepo,
  onAddRepo,
  onEditRepo,
  onRemoveRepo,
  onDetectProvider,
  onScanProjectFiles,
  onRefreshBranches,
  branchConnectivityByRepoId,
  onSettings,
  onCollapse,
}: RepositoryListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterExpanded, setFilterExpanded] = useState(true);
  const [actionMenuRepoId, setActionMenuRepoId] = useState<string | null>(null);
  const [editingRepo, setEditingRepo] = useState<Repository | null>(null);
  const [editName, setEditName] = useState("");
  const [editPath, setEditPath] = useState("");
  const [editProjectFile, setEditProjectFile] = useState("");
  const [editCurrentBranch, setEditCurrentBranch] = useState("");
  const [editProviderId, setEditProviderId] = useState("");
  const [isSavingRepo, setIsSavingRepo] = useState(false);
  const [isDetectingProvider, setIsDetectingProvider] = useState(false);
  const [isRefreshingBranches, setIsRefreshingBranches] = useState(false);
  const [shouldAutoDetectProvider, setShouldAutoDetectProvider] = useState(false);
  const [shouldAutoRefreshBranches, setShouldAutoRefreshBranches] = useState(false);
  const [projectFileOptions, setProjectFileOptions] = useState<string[]>([]);
  const [isScanningProjectFiles, setIsScanningProjectFiles] = useState(false);
  const [isProjectFileManual, setIsProjectFileManual] = useState(false);
  const { translations } = useI18n();
  const repoT = translations.repositoryList || {};

  const NO_PROVIDER_VALUE = "__none__";
  const MANUAL_INPUT_VALUE = "__manual__";
  const NO_PROJECT_FILE_VALUE = "__none__";
  const DEFAULT_BRANCH_VALUE = "master";

  const filteredRepos = repositories.filter(
    (repo) =>
      repo.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      repo.path.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const providerOptions = (() => {
    const uniqueOptions = Array.from(
      new Map(
        providers.map((provider) => [provider.id, provider] as const)
      ).values()
    );

    if (
      editProviderId &&
      editProviderId !== NO_PROVIDER_VALUE &&
      !uniqueOptions.some((provider) => provider.id === editProviderId)
    ) {
      uniqueOptions.unshift({
        id: editProviderId,
        displayName: editProviderId,
        label: editProviderId,
      });
    }

    return uniqueOptions;
  })();

  const branchOptions = (() => {
    if (!editingRepo) {
      return [] as string[];
    }

    const options = Array.from(
      new Set(
        editingRepo.branches
          .map((branch) => branch.name.trim())
          .filter((branchName) => branchName.length > 0)
      )
    );

    if (editCurrentBranch && !options.includes(editCurrentBranch)) {
      options.unshift(editCurrentBranch);
    }

    return options;
  })();

  const resolveBranchSelection = (branches: Branch[], preferredBranch: string) => {
    const normalizedPreferred = preferredBranch.trim();

    if (
      normalizedPreferred &&
      branches.some((branch) => branch.name === normalizedPreferred)
    ) {
      return normalizedPreferred;
    }

    return DEFAULT_BRANCH_VALUE;
  };

  useEffect(() => {
    if (!actionMenuRepoId) {
      return;
    }

    const handleWindowClick = () => {
      setActionMenuRepoId(null);
    };

    window.addEventListener("click", handleWindowClick);
    return () => {
      window.removeEventListener("click", handleWindowClick);
    };
  }, [actionMenuRepoId]);

  const openEditDialog = (repo: Repository) => {
    const initialBranch = repo.currentBranch?.trim() || DEFAULT_BRANCH_VALUE;
    const initialProviderId = repo.providerId?.trim() || "";

    setEditingRepo(repo);
    setEditName(repo.name);
    setEditPath(repo.path);
    setEditProjectFile(repo.projectFile || "");
    setEditCurrentBranch(initialBranch);
    setEditProviderId(initialProviderId || NO_PROVIDER_VALUE);
    setIsDetectingProvider(false);
    setIsRefreshingBranches(false);
    setShouldAutoDetectProvider(!initialProviderId);
    setShouldAutoRefreshBranches(true);
    setProjectFileOptions([]);
    setIsScanningProjectFiles(false);
    setIsProjectFileManual(false);
    setActionMenuRepoId(null);

    // Auto-scan project files on dialog open
    if (repo.path.trim()) {
      setIsScanningProjectFiles(true);
      void onScanProjectFiles(repo.path.trim()).then((files) => {
        setProjectFileOptions(files);
        setIsScanningProjectFiles(false);
        // If current value is not in scanned list, switch to manual mode
        const currentFile = repo.projectFile?.trim() || "";
        if (currentFile && files.length > 0 && !files.includes(currentFile)) {
          setIsProjectFileManual(true);
        }
        // If no files found, default to manual mode
        if (files.length === 0) {
          setIsProjectFileManual(true);
        }
      });
    } else {
      setIsProjectFileManual(true);
    }
  };

  const handleEditDialogChange = (open: boolean) => {
    if (!open) {
      setEditingRepo(null);
      setEditProjectFile("");
      setIsSavingRepo(false);
      setIsDetectingProvider(false);
      setIsRefreshingBranches(false);
      setShouldAutoDetectProvider(false);
      setShouldAutoRefreshBranches(false);
      setProjectFileOptions([]);
      setIsScanningProjectFiles(false);
      setIsProjectFileManual(false);
    }
  };

  const handleDetectProvider = async () => {
    const detectPath = editPath.trim();

    setShouldAutoDetectProvider(false);
    setIsDetectingProvider(true);
    try {
      const providerId = await onDetectProvider(detectPath);
      if (providerId) {
        setEditProviderId(providerId);
      }
    } finally {
      setIsDetectingProvider(false);
    }
  };

  const handleScanProjectFiles = async () => {
    const scanPath = editPath.trim();
    if (!scanPath) return;

    setIsScanningProjectFiles(true);
    try {
      const files = await onScanProjectFiles(scanPath);
      setProjectFileOptions(files);
      if (files.length === 0) {
        setIsProjectFileManual(true);
      } else {
        setIsProjectFileManual(false);
        // Auto-select first if nothing is set
        if (!editProjectFile.trim()) {
          setEditProjectFile(files[0]);
        }
      }
    } finally {
      setIsScanningProjectFiles(false);
    }
  };

  useEffect(() => {
    if (!editingRepo || !shouldAutoDetectProvider) {
      return;
    }

    if (editProviderId !== NO_PROVIDER_VALUE) {
      setShouldAutoDetectProvider(false);
      return;
    }

    const detectPath = editPath.trim();
    if (!detectPath) {
      setShouldAutoDetectProvider(false);
      return;
    }

    let cancelled = false;

    const detect = async () => {
      setIsDetectingProvider(true);
      try {
        const providerId = await onDetectProvider(detectPath, {
          silentSuccess: true,
        });
        if (!cancelled && providerId) {
          setEditProviderId(providerId);
        }
      } finally {
        if (!cancelled) {
          setIsDetectingProvider(false);
          setShouldAutoDetectProvider(false);
        }
      }
    };

    void detect();

    return () => {
      cancelled = true;
    };
  }, [
    editPath,
    editProviderId,
    editingRepo,
    onDetectProvider,
    shouldAutoDetectProvider,
    NO_PROVIDER_VALUE,
  ]);

  useEffect(() => {
    if (!editingRepo || !shouldAutoRefreshBranches) {
      return;
    }

    const refreshPath = editPath.trim();
    if (!refreshPath) {
      setShouldAutoRefreshBranches(false);
      return;
    }

    const savedBranch = editingRepo.currentBranch?.trim() || "";
    let cancelled = false;

    const refresh = async () => {
      setIsRefreshingBranches(true);
      try {
        const refreshed = await onRefreshBranches(refreshPath, {
          silentSuccess: true,
        });

        if (!cancelled && refreshed) {
          const nextCurrentBranch = resolveBranchSelection(
            refreshed.branches,
            savedBranch
          );

          setEditingRepo((prev) => {
            if (!prev) {
              return prev;
            }

            return {
              ...prev,
              branches: refreshed.branches,
              currentBranch: nextCurrentBranch,
            };
          });
          setEditCurrentBranch(nextCurrentBranch);
        }
      } finally {
        if (!cancelled) {
          setIsRefreshingBranches(false);
          setShouldAutoRefreshBranches(false);
        }
      }
    };

    void refresh();

    return () => {
      cancelled = true;
    };
  }, [
    editPath,
    editingRepo,
    onRefreshBranches,
    shouldAutoRefreshBranches,
  ]);

  const handleRefreshBranches = async () => {
    const refreshPath = editPath.trim();

    setShouldAutoRefreshBranches(false);
    setIsRefreshingBranches(true);
    try {
      const refreshed = await onRefreshBranches(refreshPath);

      if (!refreshed || !editingRepo) {
        return;
      }

      const preferredBranch = editCurrentBranch.trim() || editingRepo.currentBranch;
      const nextCurrentBranch = resolveBranchSelection(
        refreshed.branches,
        preferredBranch
      );

      setEditingRepo((prev) => {
        if (!prev) {
          return prev;
        }

        return {
          ...prev,
          branches: refreshed.branches,
          currentBranch: nextCurrentBranch,
        };
      });

      setEditCurrentBranch(nextCurrentBranch);
    } finally {
      setIsRefreshingBranches(false);
    }
  };

  const handleEditSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!editingRepo) {
      return;
    }

    const nextName = editName.trim();
    const nextPath = editPath.trim();
    const nextProjectFile = editProjectFile.trim();
    const nextCurrentBranch = editCurrentBranch.trim();
    const nextProviderId = editProviderId.trim();
    const normalizedProviderId =
      nextProviderId === NO_PROVIDER_VALUE ? "" : nextProviderId;
    const fallbackBranch =
      editingRepo.currentBranch || editingRepo.branches[0]?.name || DEFAULT_BRANCH_VALUE;

    if (!nextName || !nextPath) {
      return;
    }

    setIsSavingRepo(true);
    try {
      const updated = await onEditRepo({
        ...editingRepo,
        name: nextName,
        path: nextPath,
        projectFile: nextProjectFile || undefined,
        currentBranch: nextCurrentBranch || fallbackBranch,
        providerId: normalizedProviderId || undefined,
      });

      if (updated) {
        setEditingRepo(null);
      }
    } finally {
      setIsSavingRepo(false);
    }
  };

  const isEditNameEmpty = editName.trim().length === 0;
  const isEditPathEmpty = editPath.trim().length === 0;

  return (
    <div className="flex h-full flex-col">
      {/* Header - glass title bar with drag region */}
      <div
        data-tauri-drag-region
        className="flex h-10 items-center justify-between border-b border-[var(--glass-divider)] pl-[100px] pr-2"
      >
        <div className="flex items-center gap-1.5" data-tauri-no-drag>
          <div className="flex h-5 w-5 items-center justify-center rounded-md bg-primary/10">
            <Package className="h-3 w-3 text-primary" />
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/70">
            One Publish
          </span>
        </div>
        <div className="flex items-center gap-0.5" data-tauri-no-drag>
          {onCollapse && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 rounded-lg text-muted-foreground/60 hover:bg-[var(--glass-bg)] hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onCollapse();
              }}
              title={repoT.collapsePanel || "收起面板"}
              data-tauri-no-drag
            >
              <CollapseIcon />
            </Button>
          )}
        </div>
      </div>

      {/* Filter row - glass pill style */}
      <div className="flex items-center justify-between border-b border-[var(--glass-divider)] px-3 py-2">
        <button
          className="glass-surface flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-all duration-300 hover:bg-[var(--glass-bg-hover)]"
          onClick={() => setFilterExpanded(!filterExpanded)}
        >
          <span className="text-foreground/80">{repoT.all || "全部"}</span>
          <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary/12 px-1 text-[10px] font-bold leading-none text-primary">
            {repositories.length}
          </span>
          <ChevronDown
            className={cn(
              "h-3 w-3 text-muted-foreground/60 transition-transform duration-300",
              filterExpanded ? "" : "-rotate-90"
            )}
          />
        </button>
        <button
          className="glass-surface flex h-7 w-7 items-center justify-center rounded-full transition-all duration-300 hover:bg-[var(--glass-bg-hover)]"
          onClick={(e) => {
            e.stopPropagation();
            onAddRepo();
          }}
          title={repoT.addRepository || "添加仓库"}
          data-tauri-no-drag
        >
          <Plus className="h-3.5 w-3.5 text-muted-foreground transition-transform duration-300 hover:rotate-90" />
        </button>
      </div>

      {/* Search - glass input */}
      <div className="border-b border-[var(--glass-divider)] px-3 py-2">
        <div className="group/search glass-input relative rounded-xl">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50 transition-colors duration-300 group-focus-within/search:text-primary" />
          <Input
            placeholder={repoT.searchRepository || "搜索仓库"}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 border-none bg-transparent pl-8 text-sm shadow-none focus-visible:ring-0"
          />
        </div>
      </div>

      {/* Repository List - glass cards */}
      <div className="scrollbar-fade glass-scrollbar relative flex-1 overflow-auto space-y-1.5 px-2.5 py-2">
        {filteredRepos.length === 0 ? (
          /* Empty state - glass container */
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 py-8">
            <div className="glass-surface flex h-16 w-16 items-center justify-center rounded-2xl">
              <FolderGit2 className="h-7 w-7 text-muted-foreground/30" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-foreground/60">
                {repoT.noRepositories || "暂无仓库"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground/50">
                {repoT.noRepositoriesHint || "点击下方添加仓库"}
              </p>
            </div>
          </div>
        ) : (
          filteredRepos.map((repo) => {
            const isActionMenuOpen = actionMenuRepoId === repo.id;
            const isSelected = selectedRepoId === repo.id;
            const currentBranchName =
              repo.currentBranch?.trim() ||
              repoT.currentBranchUnknown ||
              "未知分支";
            const canConnectBranch = branchConnectivityByRepoId[repo.id] ?? false;
            const providerLabel = repo.providerId
              ? providers.find((p) => p.id === repo.providerId)?.label ||
                providers.find((p) => p.id === repo.providerId)?.displayName ||
                repo.providerId
              : null;

            return (
              <button
                key={repo.id}
                className={cn(
                  "glass-hover-lift group relative flex w-full items-start gap-2.5 rounded-2xl px-3 py-2.5 text-left",
                  isActionMenuOpen && "z-30",
                  isSelected
                    ? "glass-surface-selected"
                    : "border border-[var(--glass-border-subtle)]/40 bg-[var(--glass-bg)]/30 shadow-[0_1px_4px_rgba(0,0,0,0.03)] transition-all duration-300 hover:border-[var(--glass-border-subtle)] hover:bg-[var(--glass-bg)] hover:shadow-[var(--glass-shadow)]"
                )}
                onClick={() => {
                  setActionMenuRepoId(null);
                  onSelectRepo(repo.id);
                }}
              >
                {/* Icon - glass container */}
                <span
                  className={cn(
                    "mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                    isSelected
                      ? "scale-105 bg-primary/12 shadow-[0_0_12px_hsl(var(--primary)/0.2)]"
                      : "bg-[var(--glass-input-bg)] group-hover:scale-105 group-hover:bg-primary/8"
                  )}
                >
                  <FolderGit2
                    className={cn(
                      "h-4 w-4 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                      isSelected
                        ? "scale-110 text-primary drop-shadow-[0_0_4px_hsl(var(--primary)/0.3)]"
                        : "text-muted-foreground/60 group-hover:text-primary group-hover:drop-shadow-[0_0_3px_hsl(var(--primary)/0.15)]"
                    )}
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <span className={cn(
                        "block truncate text-[13px] font-medium tracking-tight transition-colors duration-300",
                        isSelected ? "text-foreground" : "text-foreground/80"
                      )}>
                        {repo.name}
                      </span>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-1">
                      {providerLabel && (
                        <span className="rounded-md bg-[var(--glass-input-bg)] px-1.5 py-0.5 text-[9px] font-medium uppercase leading-none tracking-wide text-muted-foreground/60">
                          {providerLabel}
                        </span>
                      )}
                      <div
                        className="relative"
                        onClick={(event) => {
                          event.stopPropagation();
                        }}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(
                            "h-5 w-5 rounded-lg transition-all duration-300",
                            isActionMenuOpen
                              ? "translate-y-0 bg-[var(--glass-bg)] opacity-100"
                              : "-translate-y-0.5 opacity-0 group-hover:translate-y-0 group-hover:opacity-70"
                          )}
                          title={repoT.moreActions || "更多操作"}
                          onClick={(event) => {
                            event.stopPropagation();
                            setActionMenuRepoId((prev) =>
                              prev === repo.id ? null : repo.id
                            );
                          }}
                        >
                          <MoreHorizontal className="h-3 w-3" />
                        </Button>

                        {isActionMenuOpen && (
                          <div
                            className="absolute right-0 top-7 z-20 flex min-w-[130px] flex-col rounded-xl border border-[var(--glass-border)] bg-[var(--glass-panel-bg)] p-1 shadow-[var(--glass-shadow-lg)] backdrop-blur-xl animate-in fade-in slide-in-from-top-1 zoom-in-95 duration-150"
                            onClick={(event) => {
                              event.stopPropagation();
                            }}
                          >
                            <button
                              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs transition-all duration-150 hover:bg-[var(--glass-bg-hover)] active:scale-[0.97]"
                              onClick={() => {
                                openEditDialog(repo);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5 text-muted-foreground/70" />
                              <span>{repoT.edit || "编辑"}</span>
                            </button>
                            <div className="mx-2 my-0.5 h-px bg-[var(--glass-divider)]" />
                            <button
                              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs text-destructive transition-all duration-150 hover:bg-destructive/10 active:scale-[0.97]"
                              onClick={() => {
                                setActionMenuRepoId(null);
                                void onRemoveRepo(repo);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              <span>{repoT.remove || "移除"}</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="mt-1.5 min-w-0">
                    <span
                      className={cn(
                        "inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] leading-4 transition-all duration-300",
                        canConnectBranch
                          ? "capsule-breathe bg-emerald-600/20 text-emerald-700 dark:bg-emerald-500/25 dark:text-emerald-300"
                          : "bg-[var(--glass-input-bg)] text-muted-foreground/60"
                      )}
                      title={
                        canConnectBranch
                          ? repoT.branchConnectable || "分支可连接"
                          : repoT.branchUnreachable || "分支不可连接"
                      }
                    >
                      <GitBranch className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">{currentBranchName}</span>
                    </span>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      <Dialog open={Boolean(editingRepo)} onOpenChange={handleEditDialogChange}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{repoT.editRepository || "编辑项目信息"}</DialogTitle>
            <DialogDescription>
              {repoT.editRepositoryDescription ||
                "可编辑仓库名称、Project Root、Project File 与当前分支信息。"}
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-4" onSubmit={handleEditSubmit}>
            <div className="space-y-2">
              <Label htmlFor="repo-edit-name">
                {repoT.repositoryName || "仓库名称"}
              </Label>
              <Input
                id="repo-edit-name"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                placeholder={repoT.repositoryNamePlaceholder || "请输入仓库名称"}
              />
              {isEditNameEmpty && (
                <p className="text-xs text-destructive">
                  {repoT.repositoryNameRequired || "请输入仓库名称"}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="repo-edit-path">
                {repoT.repositoryPath || "Project Root"}
              </Label>
              <Input
                id="repo-edit-path"
                value={editPath}
                onChange={(event) => setEditPath(event.target.value)}
                placeholder={repoT.repositoryPathPlaceholder || "请输入项目根目录路径"}
              />
              {isEditPathEmpty && (
                <p className="text-xs text-destructive">
                  {repoT.repositoryPathRequired || "请输入项目根目录路径"}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="repo-edit-project-file">
                {repoT.projectFile || "Project File"}
              </Label>
              <div className="flex items-center gap-2">
                {isProjectFileManual ? (
                  <Input
                    id="repo-edit-project-file"
                    className="flex-1"
                    value={editProjectFile}
                    onChange={(event) => setEditProjectFile(event.target.value)}
                    placeholder={
                      repoT.projectFilePlaceholder ||
                      "可选：请输入项目文件路径"
                    }
                  />
                ) : (
                  <Select
                    value={editProjectFile || NO_PROJECT_FILE_VALUE}
                    onValueChange={(value) => {
                      if (value === MANUAL_INPUT_VALUE) {
                        setIsProjectFileManual(true);
                        return;
                      }
                      setEditProjectFile(
                        value === NO_PROJECT_FILE_VALUE ? "" : value
                      );
                    }}
                    disabled={isScanningProjectFiles}
                  >
                    <SelectTrigger
                      id="repo-edit-project-file"
                      className="flex-1"
                    >
                      <SelectValue
                        placeholder={
                          isScanningProjectFiles
                            ? repoT.scanningProjectFiles || "扫描中..."
                            : repoT.projectFilePlaceholder ||
                              "可选：请输入项目文件路径"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_PROJECT_FILE_VALUE}>
                        {repoT.projectFileNone || "未设置"}
                      </SelectItem>
                      {projectFileOptions.map((filePath) => (
                        <SelectItem key={filePath} value={filePath}>
                          {filePath.split("/").pop() || filePath}
                        </SelectItem>
                      ))}
                      <SelectItem value={MANUAL_INPUT_VALUE}>
                        {repoT.projectFileManualInput || "手动输入..."}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => {
                    if (isProjectFileManual && projectFileOptions.length > 0) {
                      // Switch back to select mode
                      setIsProjectFileManual(false);
                    } else {
                      void handleScanProjectFiles();
                    }
                  }}
                  title={repoT.scanProjectFiles || "扫描项目文件"}
                  disabled={
                    isSavingRepo ||
                    isScanningProjectFiles ||
                    !editPath.trim()
                  }
                >
                  <FileSearch
                    className={cn(
                      "h-4 w-4",
                      isScanningProjectFiles && "animate-spin"
                    )}
                  />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {repoT.projectFileScanHint ||
                  "可从自动扫描结果中选择，或切换到手动输入。"}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="repo-edit-provider">
                {repoT.provider || "Provider"}
              </Label>
              <div className="flex items-center gap-2">
                <Select
                  value={editProviderId}
                  onValueChange={(value) => {
                    setShouldAutoDetectProvider(false);
                    setEditProviderId(value);
                  }}
                  disabled={isDetectingProvider}
                >
                  <SelectTrigger id="repo-edit-provider" className="flex-1">
                    <SelectValue
                      placeholder={repoT.providerPlaceholder || "选择 Provider"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PROVIDER_VALUE}>
                      {repoT.providerUnspecified || "未设置"}
                    </SelectItem>
                    {providerOptions.map((provider) => (
                      <SelectItem key={provider.id} value={provider.id}>
                        {provider.label || provider.displayName || provider.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => {
                    void handleDetectProvider();
                  }}
                  title={repoT.detectProvider || "自动检测 Provider"}
                  disabled={isSavingRepo || isDetectingProvider || isRefreshingBranches}
                >
                  <RefreshCw
                    className={cn("h-4 w-4", isDetectingProvider && "animate-spin")}
                  />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {repoT.providerDetectHint ||
                  "可手动填写 Provider，或点击右侧按钮自动检测。"}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="repo-edit-branch">
                {repoT.currentBranch || "当前分支"}
              </Label>
              <div className="flex items-center gap-2">
                <Select
                  value={editCurrentBranch}
                  onValueChange={setEditCurrentBranch}
                  disabled={branchOptions.length === 0 || isRefreshingBranches}
                >
                  <SelectTrigger id="repo-edit-branch" className="flex-1">
                    <SelectValue
                      placeholder={repoT.currentBranchPlaceholder || "请选择分支"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {branchOptions.map((branchName) => (
                      <SelectItem key={branchName} value={branchName}>
                        {branchName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => {
                    void handleRefreshBranches();
                  }}
                  title={repoT.refreshBranches || "刷新分支"}
                  disabled={isSavingRepo || isDetectingProvider || isRefreshingBranches}
                >
                  <RefreshCw
                    className={cn("h-4 w-4", isRefreshingBranches && "animate-spin")}
                  />
                </Button>
              </div>
              {branchOptions.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {repoT.noBranches || "暂无可选分支"}
                </p>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingRepo(null)}
                disabled={isSavingRepo || isDetectingProvider || isRefreshingBranches}
              >
                {repoT.cancel || "取消"}
              </Button>
              <Button
                type="submit"
                disabled={
                  isSavingRepo ||
                  isDetectingProvider ||
                  isRefreshingBranches ||
                  isEditNameEmpty ||
                  isEditPathEmpty
                }
              >
                {isSavingRepo
                  ? repoT.saving || "保存中..."
                  : repoT.save || "保存"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Footer - glass bar */}
      <div className="relative flex items-center justify-between border-t border-[var(--glass-divider)] px-3 py-2">
        {/* Top fade shadow to hint scrollability */}
        <div className="pointer-events-none absolute -top-6 left-0 right-0 h-6 bg-gradient-to-t from-[var(--glass-panel-bg)] to-transparent" />
        <button
          className="glass-surface flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs text-muted-foreground/70 transition-all duration-300 hover:bg-[var(--glass-bg-hover)] hover:text-foreground/80"
          onClick={onAddRepo}
        >
          <Plus className="h-3 w-3" />
          <span>{repoT.addRepository || "添加仓库"}</span>
        </button>
        <button
          className="flex h-7 w-7 items-center justify-center rounded-xl text-muted-foreground/50 transition-all duration-300 hover:bg-[var(--glass-bg)] hover:text-foreground/70"
          onClick={onSettings}
        >
          <Settings className="h-3.5 w-3.5 transition-transform duration-500 hover:rotate-90" />
        </button>
      </div>
    </div>
  );
}
