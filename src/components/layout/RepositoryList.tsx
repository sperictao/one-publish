import {
  startTransition,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Plus, Settings, ChevronDown, FolderGit2, Package } from "lucide-react";
import type { Branch, Repository } from "@/types/repository";
import { useI18n } from "@/hooks/useI18n";
import type { RepositoryListFloatingBindings } from "@/components/layout/RepositoryListFloatingLayer";
import { RepositoryRow } from "@/components/layout/RepositoryRow";
import { useRepositoryListInteractionState } from "@/components/layout/useRepositoryListInteractionState";

const EditRepositoryDialog = lazy(async () => {
  const mod = await import("@/components/layout/EditRepositoryDialog");
  return { default: mod.EditRepositoryDialog };
});
const RepositoryListFloatingLayer = lazy(async () => {
  const mod = await import("@/components/layout/RepositoryListFloatingLayer");
  return { default: mod.RepositoryListFloatingLayer };
});

const EMPTY_FLOATING_STYLE: CSSProperties = {};

function CollapseIcon(): JSX.Element {
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
}: RepositoryListProps): JSX.Element {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterExpanded, setFilterExpanded] = useState(true);
  const [editingRepo, setEditingRepo] = useState<Repository | null>(null);
  const [floatingEnhancerEnabled, setFloatingEnhancerEnabled] = useState(false);
  const { translations } = useI18n();
  const repoT = translations.repositoryList || {};
  const fallbackListRef = useRef<HTMLDivElement | null>(null);
  const fallbackFloatingCardSurfaceRef = useRef<HTMLDivElement | null>(null);

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

  const interaction = useRepositoryListInteractionState({
    filteredRepoIds,
    selectedRepoId,
  });

  useEffect(() => {
    if (floatingEnhancerEnabled) {
      return;
    }

    const timerId = window.setTimeout(() => {
      startTransition(() => {
        setFloatingEnhancerEnabled(true);
      });
    }, 0);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [floatingEnhancerEnabled]);

  const createFallbackRowRef = useCallback(
    (_repoId: string) => (_node: HTMLDivElement | null) => {},
    []
  );
  const noopPointerHandler = useCallback(
    (_event: ReactPointerEvent<HTMLDivElement>) => {},
    []
  );
  const noopVoidHandler = useCallback(() => {}, []);
  const handleFallbackListPointerEnter = useCallback(
    (_event: ReactPointerEvent<HTMLDivElement>) => {
      interaction.handleListPointerEnter();
    },
    [interaction.handleListPointerEnter]
  );
  const handleFallbackListPointerLeave = useCallback(() => {
    interaction.handleListPointerLeave();
  }, [interaction.handleListPointerLeave]);

  const fallbackFloatingBindings = useMemo<RepositoryListFloatingBindings>(
    () => ({
      listRef: fallbackListRef as MutableRefObject<HTMLDivElement | null>,
      floatingCardSurfaceRef:
        fallbackFloatingCardSurfaceRef as MutableRefObject<HTMLDivElement | null>,
      cardTargetRepoId: interaction.visualTargetRepoId,
      floatingVisible: false,
      floatingCardMotionStyle: EMPTY_FLOATING_STYLE,
      floatingCardSurfaceStyle: EMPTY_FLOATING_STYLE,
      setRepoRowRef: createFallbackRowRef,
      handleListPointerMove: noopPointerHandler,
      handleListPointerEnter: handleFallbackListPointerEnter,
      handleListMouseLeave: handleFallbackListPointerLeave,
      handleListScroll: noopVoidHandler,
    }),
    [
      createFallbackRowRef,
      handleFallbackListPointerEnter,
      handleFallbackListPointerLeave,
      interaction.visualTargetRepoId,
      noopPointerHandler,
      noopVoidHandler,
    ]
  );

  const openEditDialog = useCallback((repo: Repository) => {
    setEditingRepo(repo);
  }, []);

  const handleEditDialogChange = useCallback((open: boolean) => {
    if (!open) {
      setEditingRepo(null);
    }
  }, []);

  const renderRepoListContent = useCallback(
    (floating: RepositoryListFloatingBindings) => (
      <div
        ref={floating.listRef}
        className="repo-list-scroll scrollbar-fade glass-scrollbar relative flex-1 overflow-auto px-2.5 py-2"
        onPointerEnter={floating.handleListPointerEnter}
        onPointerMove={floating.handleListPointerMove}
        onPointerLeave={floating.handleListMouseLeave}
        onScroll={floating.handleListScroll}
      >
        <div
          aria-hidden
          className={cn(
            "pointer-events-none !absolute z-0 origin-top-left transition-opacity duration-120 ease-linear",
            floating.floatingVisible ? "opacity-100" : "opacity-0"
          )}
          style={floating.floatingCardMotionStyle}
        >
          <div
            ref={floating.floatingCardSurfaceRef}
            data-selected={floating.cardTargetRepoId === selectedRepoId ? "true" : "false"}
            className="repo-floating-card h-full w-full transition-[box-shadow] duration-320 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={floating.floatingCardSurfaceStyle}
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
          <div className="repo-list-grid space-y-1.5">
            {filteredRepos.map((repo) => (
              <RepositoryRow
                key={repo.id}
                repo={repo}
                isSelected={selectedRepoId === repo.id}
                isVisualTarget={interaction.visualTargetRepoId === repo.id}
                isMenuOpen={interaction.isMenuOpenForRepo(repo.id)}
                canConnectBranch={branchConnectivityByRepoId[repo.id] ?? false}
                repoT={repoT}
                rowRef={floating.setRepoRowRef(repo.id)}
                onSelect={onSelectRepo}
                onEdit={openEditDialog}
                onRemove={onRemoveRepo}
                onRowMouseEnter={interaction.handleRowMouseEnter}
                onRowFocus={interaction.handleRowFocus}
                onRowBlur={interaction.handleRowBlur}
                onMenuOpenChange={interaction.handleMenuOpenChange}
              />
            ))}
          </div>
        )}
      </div>
    ),
    [
      branchConnectivityByRepoId,
      filteredRepos,
      interaction.handleMenuOpenChange,
      interaction.handleRowBlur,
      interaction.handleRowFocus,
      interaction.handleRowMouseEnter,
      interaction.isMenuOpenForRepo,
      interaction.visualTargetRepoId,
      onRemoveRepo,
      onSelectRepo,
      openEditDialog,
      repoT,
      selectedRepoId,
    ]
  );

  return (
    <div className="repo-list-root flex h-full flex-col">
      <div
        data-tauri-drag-region
        className="flex h-10 items-center justify-between pl-[100px] pr-2"
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
              className="h-7 w-9 rounded-full p-0 text-muted-foreground/60 hover:bg-black/[0.045] hover:text-foreground hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_1px_2px_rgba(15,23,42,0.06)] dark:hover:bg-white/[0.06] dark:hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
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

      <div className="flex items-center justify-between px-3 py-2">
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

      <div className="px-3 py-1.5">
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

      {!floatingEnhancerEnabled ? (
        renderRepoListContent(fallbackFloatingBindings)
      ) : (
        <Suspense fallback={renderRepoListContent(fallbackFloatingBindings)}>
          <RepositoryListFloatingLayer
            filteredRepoIds={filteredRepoIds}
            targetRepoId={interaction.visualTargetRepoId}
            selectedRepoId={selectedRepoId}
            freezeFloating={interaction.freezeFloating}
            onListPointerEnter={interaction.handleListPointerEnter}
            onListPointerLeave={interaction.handleListPointerLeave}
            onPointerRepoChange={interaction.handlePointerRepoChange}
          >
            {renderRepoListContent}
          </RepositoryListFloatingLayer>
        </Suspense>
      )}

      {editingRepo ? (
        <Suspense fallback={null}>
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
        </Suspense>
      ) : null}

      <div className="relative flex items-center px-3 py-2">
        <div className="pointer-events-none absolute -top-6 left-0 right-0 h-6 bg-gradient-to-t from-[var(--glass-panel-bg)] to-transparent" />
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
