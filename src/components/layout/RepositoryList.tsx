import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Search,
  Plus,
  Settings,
  ChevronDown,
  MoreHorizontal,
  Pencil,
  Trash2,
  FolderGit2,
  GitBranch,
  Package,
} from "lucide-react";
import type { Branch, Repository } from "@/types/repository";
import { useI18n } from "@/hooks/useI18n";
import { EditRepositoryDialog } from "@/components/layout/EditRepositoryDialog";
import { useFloatingRepoCard } from "@/components/layout/useFloatingRepoCard";

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
  const { translations } = useI18n();
  const repoT = translations.repositoryList || {};

  const filteredRepos = useMemo(
    () =>
      repositories.filter(
        (repo) =>
          repo.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          repo.path.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    [repositories, searchQuery]
  );

  const filteredRepoIds = useMemo(
    () => filteredRepos.map((repo) => repo.id),
    [filteredRepos]
  );

  const {
    listRef,
    floatingCardSurfaceRef,
    cardTargetRepoId,
    floatingVisible,
    floatingCardMotionStyle,
    floatingCardSurfaceStyle,
    setRepoRowRef,
    handleRepoMouseEnter,
    handleListPointerMove,
    handleListPointerEnter,
    handleListMouseLeave,
    handleListScroll,
  } = useFloatingRepoCard({
    filteredRepoIds,
    selectedRepoId,
  });

  const handleRepoRowKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>, repoId: string) => {
      if (event.currentTarget !== event.target) {
        return;
      }

      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      setActionMenuRepoId(null);
      onSelectRepo(repoId);
    },
    [onSelectRepo]
  );

  const openEditDialog = useCallback((repo: Repository) => {
    setEditingRepo(repo);
    setActionMenuRepoId(null);
  }, []);

  const handleEditDialogChange = useCallback((open: boolean) => {
    if (!open) {
      setEditingRepo(null);
    }
  }, []);

  useEffect(() => {
    if (!actionMenuRepoId) {
      return;
    }

    const handleWindowClick = () => {
      setActionMenuRepoId(null);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActionMenuRepoId(null);
      }
    };

    window.addEventListener("click", handleWindowClick);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("click", handleWindowClick);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [actionMenuRepoId]);

  return (
    <div className="flex h-full flex-col">
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
              onClick={(event) => {
                event.stopPropagation();
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

      <div className="flex items-center justify-between border-b border-[var(--glass-divider)] px-3 py-2">
        <button
          type="button"
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
          type="button"
          className="glass-surface flex h-7 w-7 items-center justify-center rounded-full transition-all duration-300 hover:bg-[var(--glass-bg-hover)]"
          onClick={(event) => {
            event.stopPropagation();
            onAddRepo();
          }}
          title={repoT.addRepository || "添加仓库"}
          data-tauri-no-drag
        >
          <Plus className="h-3.5 w-3.5 text-muted-foreground transition-transform duration-300 hover:rotate-90" />
        </button>
      </div>

      <div className="border-b border-[var(--glass-divider)] px-3 py-2">
        <div className="group/search glass-input relative rounded-xl">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50 transition-colors duration-300 group-focus-within/search:text-primary" />
          <Input
            placeholder={repoT.searchRepository || "搜索仓库"}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="h-8 border-none bg-transparent pl-8 text-sm shadow-none focus-visible:ring-0"
          />
        </div>
      </div>

      <div
        ref={listRef}
        className="scrollbar-fade glass-scrollbar relative flex-1 overflow-auto px-2.5 py-2"
        onPointerEnter={handleListPointerEnter}
        onPointerMove={handleListPointerMove}
        onMouseLeave={handleListMouseLeave}
        onScroll={handleListScroll}
      >
        <div
          aria-hidden
          className={cn(
            "pointer-events-none !absolute z-0 origin-top-left transition-opacity duration-120 ease-linear",
            floatingVisible ? "opacity-100" : "opacity-0"
          )}
          style={floatingCardMotionStyle}
        >
          <div
            ref={floatingCardSurfaceRef}
            data-selected={cardTargetRepoId === selectedRepoId ? "true" : "false"}
            className="repo-floating-card h-full w-full transition-[box-shadow] duration-220 ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={floatingCardSurfaceStyle}
          />
        </div>

        {filteredRepos.length === 0 ? (
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
          <div className="space-y-1.5">
            {filteredRepos.map((repo) => {
              const isActionMenuOpen = actionMenuRepoId === repo.id;
              const isSelected = selectedRepoId === repo.id;
              const currentBranchName =
                repo.currentBranch?.trim() ||
                repoT.currentBranchUnknown ||
                "未知分支";
              const canConnectBranch = branchConnectivityByRepoId[repo.id] ?? false;
              const providerLabel = repo.providerId
                ? providers.find((provider) => provider.id === repo.providerId)?.label ||
                  providers.find((provider) => provider.id === repo.providerId)?.displayName ||
                  repo.providerId
                : null;

              return (
                <div
                  key={repo.id}
                  ref={setRepoRowRef(repo.id)}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-label={`${repoT.selectRepository || "选择仓库"}: ${repo.name}`}
                  data-repo-row="true"
                  data-repo-id={repo.id}
                  className={cn(
                    "group relative z-10 flex w-full cursor-pointer items-start gap-2.5 rounded-2xl border border-transparent bg-transparent px-3 py-2.5 text-left shadow-none outline-none transition-all duration-300 focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                    isActionMenuOpen && "z-30"
                  )}
                  onClick={() => {
                    setActionMenuRepoId(null);
                    onSelectRepo(repo.id);
                  }}
                  onMouseEnter={() => {
                    handleRepoMouseEnter(repo.id);
                  }}
                  onFocus={() => {
                    handleRepoMouseEnter(repo.id);
                  }}
                  onKeyDown={(event) => {
                    handleRepoRowKeyDown(event, repo.id);
                  }}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[14px] transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                      isSelected
                        ? "scale-105 bg-primary/10 shadow-[0_0_18px_hsl(var(--primary)/0.24)]"
                        : "bg-white/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] group-hover:scale-105 group-hover:bg-primary/8"
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
                        <span
                          className={cn(
                            "block truncate text-[13px] font-medium tracking-tight transition-colors duration-300",
                            isSelected ? "text-foreground" : "text-foreground/78"
                          )}
                        >
                          {repo.name}
                        </span>
                        <p
                          className="mt-0.5 truncate text-[11px] text-muted-foreground/55"
                          title={repo.path}
                        >
                          {repo.path}
                        </p>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-1">
                        {providerLabel && (
                          <span className="rounded-full border border-white/55 bg-white/36 px-2 py-0.5 text-[10px] font-medium uppercase leading-none tracking-[0.08em] text-muted-foreground/62 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]">
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
                            type="button"
                            variant="ghost"
                            size="icon"
                            className={cn(
                              "h-5 w-5 rounded-lg transition-all duration-300",
                              isActionMenuOpen
                                ? "translate-y-0 bg-white/52 opacity-100"
                                : "-translate-y-0.5 opacity-0 group-hover:translate-y-0 group-hover:opacity-70 group-focus-within:translate-y-0 group-focus-within:opacity-70"
                            )}
                            title={repoT.moreActions || "更多操作"}
                            aria-haspopup="menu"
                            aria-expanded={isActionMenuOpen}
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
                              role="menu"
                              aria-label={repoT.moreActions || "更多操作"}
                              className="absolute right-0 top-7 z-20 flex min-w-[130px] flex-col rounded-xl border border-[var(--glass-border)] bg-[var(--glass-panel-bg)] p-1 shadow-[var(--glass-shadow-lg)] backdrop-blur-xl animate-in fade-in slide-in-from-top-1 zoom-in-95 duration-150"
                              onClick={(event) => {
                                event.stopPropagation();
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Escape") {
                                  event.stopPropagation();
                                  setActionMenuRepoId(null);
                                }
                              }}
                            >
                              <button
                                type="button"
                                role="menuitem"
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
                                type="button"
                                role="menuitem"
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
                            : "border border-white/55 bg-white/34 text-muted-foreground/64 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"
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
                </div>
              );
            })}
          </div>
        )}
      </div>

      <EditRepositoryDialog
        repository={editingRepo}
        providers={providers}
        repoT={repoT}
        onOpenChange={handleEditDialogChange}
        onEditRepo={onEditRepo}
        onDetectProvider={onDetectProvider}
        onScanProjectFiles={onScanProjectFiles}
        onRefreshBranches={onRefreshBranches}
      />

      <div className="relative flex items-center justify-between border-t border-[var(--glass-divider)] px-3 py-2">
        <div className="pointer-events-none absolute -top-6 left-0 right-0 h-6 bg-gradient-to-t from-[var(--glass-panel-bg)] to-transparent" />
        <button
          type="button"
          className="glass-surface flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs text-muted-foreground/70 transition-all duration-300 hover:bg-[var(--glass-bg-hover)] hover:text-foreground/80"
          onClick={onAddRepo}
        >
          <Plus className="h-3 w-3" />
          <span>{repoT.addRepository || "添加仓库"}</span>
        </button>
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-xl text-muted-foreground/50 transition-all duration-300 hover:bg-[var(--glass-bg)] hover:text-foreground/70"
          onClick={onSettings}
        >
          <Settings className="h-3.5 w-3.5 transition-transform duration-500 hover:rotate-90" />
        </button>
      </div>
    </div>
  );
}
