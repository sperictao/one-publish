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
  GitBranch,
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
  const { translations } = useI18n();
  const repoT = translations.repositoryList || {};

  const NO_PROVIDER_VALUE = "__none__";
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
    setActionMenuRepoId(null);
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
      {/* Header - drag region with traffic light padding */}
      <div
        data-tauri-drag-region
        className="flex h-10 items-center justify-end border-b pl-[100px] pr-2"
      >
        <div className="flex items-center gap-0.5" data-tauri-no-drag>
          {onCollapse && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
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

      {/* Filter row - 全部 and + button */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <button
          className="flex items-center gap-1 text-sm font-medium hover:text-primary"
          onClick={() => setFilterExpanded(!filterExpanded)}
        >
          <span>{repoT.all || "全部"}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {repositories.length}
          </span>
          <ChevronDown
            className={cn(
              "h-3 w-3 transition-transform",
              filterExpanded ? "" : "-rotate-90"
            )}
          />
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={(e) => {
            e.stopPropagation();
            onAddRepo();
          }}
          title={repoT.addRepository || "添加仓库"}
          data-tauri-no-drag
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Search */}
      <div className="border-b px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={repoT.searchRepository || "搜索仓库"}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>

      {/* Repository List */}
      <div className="flex-1 overflow-auto space-y-2 px-3 py-2">
        {filteredRepos.map((repo) => {
          const isActionMenuOpen = actionMenuRepoId === repo.id;
          const isSelected = selectedRepoId === repo.id;
          const currentBranchName =
            repo.currentBranch?.trim() ||
            repoT.currentBranchUnknown ||
            "未知分支";
          const canConnectBranch = branchConnectivityByRepoId[repo.id] ?? false;

          return (
            <button
              key={repo.id}
              className={cn(
                "group relative flex w-full items-start gap-2 rounded-xl border px-3 py-2.5 text-left",
                "transition-[transform,box-shadow,border-color,background-color] duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]",
                "hover:-translate-y-[1px] hover:bg-accent/80 hover:shadow-sm",
                isSelected
                  ? "border-border bg-accent shadow-sm ring-1 ring-border/40"
                  : "border-transparent hover:border-border/80"
              )}
              onClick={() => {
                setActionMenuRepoId(null);
                onSelectRepo(repo.id);
              }}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border transition-colors duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]",
                  isSelected
                    ? "border-primary/30 bg-primary/10"
                    : "border-transparent bg-muted/45 group-hover:border-border/70 group-hover:bg-background"
                )}
              >
                <FolderGit2
                  className={cn(
                    "h-4 w-4 transition-colors duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]",
                    isSelected
                      ? "text-primary"
                      : "text-muted-foreground group-hover:text-foreground"
                  )}
                />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium tracking-tight">
                    {repo.name}
                  </span>
                  <div
                    className="relative flex-shrink-0"
                    onClick={(event) => {
                      event.stopPropagation();
                    }}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn(
                        "h-5 w-5 transition-all duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]",
                        isActionMenuOpen
                          ? "translate-y-0 opacity-100"
                          : "-translate-y-0.5 opacity-0 group-hover:translate-y-0 group-hover:opacity-100"
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
                        className="absolute right-0 top-6 z-20 flex min-w-[120px] flex-col rounded-md border bg-popover p-1 shadow-md"
                        onClick={(event) => {
                          event.stopPropagation();
                        }}
                      >
                        <button
                          className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
                          onClick={() => {
                            openEditDialog(repo);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          <span>{repoT.edit || "编辑"}</span>
                        </button>
                        <button
                          className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10"
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
                <div className="mt-1 min-w-0">
                  <span
                    className={cn(
                      "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-4 transition-colors duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]",
                      canConnectBranch
                        ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "border-muted-foreground/25 bg-muted/35 text-muted-foreground"
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
        })}
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
              <Input
                id="repo-edit-project-file"
                value={editProjectFile}
                onChange={(event) => setEditProjectFile(event.target.value)}
                placeholder={repoT.projectFilePlaceholder || "可选：请输入项目文件路径"}
              />
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

      {/* Footer */}
      <div className="flex items-center justify-between border-t px-3 py-2">
        <button
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={onAddRepo}
        >
          <Plus className="h-3 w-3" />
          <span>{repoT.addRepository || "添加仓库"}</span>
        </button>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onSettings}>
          <Settings className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
