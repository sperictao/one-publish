import {
  Suspense,
  lazy,
  useCallback,
  useMemo,
  useState,
  memo,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import {
  reorderItemsByDrop,
} from "@/lib/listOrdering";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Search,
  Plus,
  Settings,
  ChevronDown,
  FolderGit2,
  ArrowUpDown,
} from "lucide-react";
import type { ProjectScanCandidates } from "@/lib/store/types";
import type { Branch, Repository } from "@/lib/store/types";
import { useI18n } from "@/hooks/useI18n";
import { RepositoryRow } from "@/components/layout/RepositoryRow";
import { topbarIconButtonClass } from "@/components/layout/topbarButtonStyles";
import { useRepositoryListInteractionState } from "@/components/layout/useRepositoryListInteractionState";
import { usePointerListReorder } from "@/components/layout/usePointerListReorder";
import { composeNodeRefs } from "@/components/layout/composeNodeRefs";
import { useListReorderMotion } from "@/components/layout/useListReorderMotion";
import { useListDropSettledState } from "@/components/layout/useListDropSettledState";

const EditRepositoryDialog = lazy(async () => {
  const mod = await import("@/components/layout/EditRepositoryDialog");
  return { default: mod.EditRepositoryDialog };
});

function hasSameStringOrder(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function CollapseIcon(): ReactNode {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="1.5"
        y="1.5"
        width="13"
        height="13"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1"
        fill="none"
      />
      <line
        x1="5.5"
        y1="1.5"
        x2="5.5"
        y2="14.5"
        stroke="currentColor"
        strokeWidth="1"
      />
      <path
        className="transition-transform duration-150 ease-geist group-hover:-translate-x-0.5"
        d="M11.5 5.5L9 8L11.5 10.5"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AppBrandIcon(): ReactNode {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 128 128"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <g transform="translate(64 64) scale(2.3) translate(-18 -18)">
        <g className="fill-primary">
          <rect x="0" y="12" width="36" height="12" rx="6" />
          <rect
            x="0"
            y="12"
            width="36"
            height="12"
            rx="6"
            transform="rotate(45 18 18)"
          />
          <rect
            x="0"
            y="12"
            width="36"
            height="12"
            rx="6"
            transform="rotate(90 18 18)"
          />
          <rect
            x="0"
            y="12"
            width="36"
            height="12"
            rx="6"
            transform="rotate(135 18 18)"
          />
          <rect
            x="0"
            y="12"
            width="36"
            height="12"
            rx="6"
            transform="rotate(180 18 18)"
          />
          <rect
            x="0"
            y="12"
            width="36"
            height="12"
            rx="6"
            transform="rotate(225 18 18)"
          />
        </g>
        <circle cx="18" cy="18" r="5" className="fill-warning" />
      </g>
    </svg>
  );
}

interface RepositoryListProps {
  repositories: Repository[];
  selectedRepoId: string | null;
  providers: Array<{ id: string; displayName: string; label?: string }>;
  onSelectRepo: (id: string) => void;
  onAddRepo: () => void;
  onOpenRepoDirectory: (repo: Repository) => Promise<unknown> | unknown;
  onEditRepo: (repo: Repository) => Promise<boolean> | boolean;
  onRemoveRepo: (repo: Repository) => Promise<void> | void;
  onDetectProvider: (
    path: string,
    options?: { silentSuccess?: boolean }
  ) => Promise<string | null>;
  onScanProjectCandidates: (path: string) => Promise<ProjectScanCandidates | null>;
  onRefreshBranches: (
    path: string,
    options?: { silentSuccess?: boolean }
  ) => Promise<{ branches: Branch[]; currentBranch: string } | null>;
  branchConnectivityByRepoId: Record<string, boolean>;
  onSettings: () => void;
  onCollapse?: () => void;
  onReorderRepositories: (repoIds: string[]) => void;
}

export const RepositoryList = memo(function RepositoryList({
  repositories,
  selectedRepoId,
  providers,
  onSelectRepo,
  onAddRepo,
  onOpenRepoDirectory,
  onEditRepo,
  onRemoveRepo,
  onDetectProvider,
  onScanProjectCandidates,
  onRefreshBranches,
  branchConnectivityByRepoId,
  onSettings,
  onCollapse,
  onReorderRepositories,
}: RepositoryListProps): ReactNode {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterExpanded, setFilterExpanded] = useState(true);
  const [editingRepo, setEditingRepo] = useState<Repository | null>(null);
  const [showReorderControls, setShowReorderControls] = useState(false);
  const { translations } = useI18n();
  const repoT = useMemo(
    () => translations.repositoryList || {},
    [translations.repositoryList]
  );
  const listActionButtonClass =
    "flex size-7 items-center justify-center rounded-full border border-border bg-background transition-colors duration-150 ease-geist hover:bg-accent";
  const reorderControlsLabel = showReorderControls
    ? repoT.hideReorderControls || "关闭排序"
    : repoT.showReorderControls || "开启排序";

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
  const repoSortModeEnabled = showReorderControls;
  const repoDragEnabled =
    repoSortModeEnabled &&
    searchQuery.trim().length === 0 &&
    repositories.length > 1;

  const interaction = useRepositoryListInteractionState({
    filteredRepoIds,
    selectedRepoId,
  });
  const {
    settledItemId: settledRepoId,
    clearSettledItem: clearSettledRepoId,
    settleFromDragEnd: settleRepoFromDragEnd,
    shouldIgnorePointerReentry: shouldIgnoreRepoPointerReentry,
  } = useListDropSettledState<string>();
  const handleListPointerReentry = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      return shouldIgnoreRepoPointerReentry({
        x: event.clientX,
        y: event.clientY,
      });
    },
    [shouldIgnoreRepoPointerReentry]
  );
  const handleListPointerLeave = useCallback(() => {
    clearSettledRepoId();
  }, [clearSettledRepoId]);
  const repositoryReorder = usePointerListReorder({
    enabled: repoDragEnabled,
    onStart: () => {
      clearSettledRepoId();
      interaction.handleListPointerLeave();
    },
    onEnd: (result) => {
      settleRepoFromDragEnd(result, (itemId) => itemId);
    },
    onCommit: (activeRepoId, target) => {
      const nextRepoIds = reorderItemsByDrop(
        repositories,
        (repo) => repo.id,
        activeRepoId,
        target.itemId,
        target.position
      ).map((repo) => repo.id);

      if (
        hasSameStringOrder(
          nextRepoIds,
          repositories.map((repo) => repo.id)
        )
      ) {
        return;
      }

      onReorderRepositories(nextRepoIds);
    },
  });
  const draggingRepoId = repositoryReorder.draggingItemId;
  const previewRepos = useMemo(
    () =>
      draggingRepoId && repositoryReorder.dropTarget
        ? reorderItemsByDrop(
            filteredRepos,
            (repo) => repo.id,
            draggingRepoId,
            repositoryReorder.dropTarget.itemId,
            repositoryReorder.dropTarget.position
          )
        : filteredRepos,
    [draggingRepoId, filteredRepos, repositoryReorder.dropTarget]
  );
  const previewRepoIds = useMemo(
    () => previewRepos.map((repo) => repo.id),
    [previewRepos]
  );
  const repoMotion = useListReorderMotion({
    orderedIds: previewRepoIds,
    draggingItemId: draggingRepoId,
    settledItemId: settledRepoId,
  });
  const visualTargetRepoId =
    draggingRepoId ?? settledRepoId ?? interaction.visualTargetRepoId;

  const openEditDialog = useCallback((repo: Repository) => {
    setEditingRepo(repo);
  }, []);

  const handleEditDialogChange = useCallback((open: boolean) => {
    if (!open) {
      setEditingRepo(null);
    }
  }, []);

  const repoListContent = useMemo(
    () => {
      // Stable per-row ref composer: avoids allocating a fresh closure per row
      // per render, which would bust RepositoryRow's React.memo.
      const composeRowRef = (repoId: string) => (node: HTMLDivElement | null) =>
        composeNodeRefs(
          repositoryReorder.setItemRef(repoId, undefined),
          repoMotion.setItemRef(repoId)
        )(node);

      return (
        <div
          className="list-scroll-shell geist-scrollbar relative flex-1 overflow-auto px-2 py-2"
          onPointerEnter={(event) => {
            if (handleListPointerReentry(event)) {
              return;
            }
            clearSettledRepoId();
            interaction.handleListPointerEnter();
          }}
          onPointerLeave={() => {
            handleListPointerLeave();
            interaction.handleListPointerLeave();
          }}
        >
          {previewRepos.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-4 py-8">
              <div className="surface-raised flex size-16 items-center justify-center rounded-lg">
                <FolderGit2 className="size-7 text-muted-foreground/30" />
              </div>
              <div className="text-center">
                <p className="text-label-14 font-normal text-foreground/60">
                  {repoT.noRepositories || "暂无仓库"}
                </p>
                <p className="mt-1 text-label-12 text-muted-foreground">
                  {repoT.noRepositoriesHint || "点击下方添加仓库"}
                </p>
              </div>
            </div>
          ) : (
            <div className="repo-list-grid space-y-1.5">
              {previewRepos.map((repo) => (
                <RepositoryRow
                  key={repo.id}
                  repo={repo}
                  isSelected={selectedRepoId === repo.id}
                  isVisualTarget={visualTargetRepoId === repo.id}
                  isMenuOpen={interaction.isMenuOpenForRepo(repo.id)}
                  canConnectBranch={branchConnectivityByRepoId[repo.id] ?? false}
                  repoT={repoT}
                  rowRef={composeRowRef(repo.id)}
                  onSelect={onSelectRepo}
                  onOpenDirectory={onOpenRepoDirectory}
                  onEdit={openEditDialog}
                  onRemove={onRemoveRepo}
                  onRowMouseEnter={interaction.handleRowMouseEnter}
                  onRowFocus={interaction.handleRowFocus}
                  onRowBlur={interaction.handleRowBlur}
                  onMenuOpenChange={interaction.handleMenuOpenChange}
                  dragEnabled={repoDragEnabled}
                  dragHandleVisible={repoDragEnabled}
                  dragHandleLabel={repoT.dragToReorder || "拖动排序"}
                  dragDisabledLabel={
                    repoT.dragDisabledWhileSearching || "搜索时无法排序"
                  }
                  isDragging={repositoryReorder.draggingItemId === repo.id}
                  dragPreviewStyle={repositoryReorder.dragPreviewStyle}
                  onHandlePointerDown={repositoryReorder.startDrag}
                />
              ))}
            </div>
          )}
        </div>
      );
    },
    [
      branchConnectivityByRepoId,
      handleListPointerLeave,
      handleListPointerReentry,
      previewRepos,
      interaction.handleListPointerEnter,
      interaction.handleListPointerLeave,
      interaction.handleMenuOpenChange,
      interaction.handleRowBlur,
      interaction.handleRowFocus,
      interaction.handleRowMouseEnter,
      interaction.isMenuOpenForRepo,
      onRemoveRepo,
      onOpenRepoDirectory,
      onSelectRepo,
      openEditDialog,
      repoT,
      repoMotion,
      repoDragEnabled,
      repositoryReorder.dragPreviewStyle,
      repositoryReorder.draggingItemId,
      repositoryReorder.setItemRef,
      repositoryReorder.startDrag,
      clearSettledRepoId,
      selectedRepoId,
      visualTargetRepoId,
    ]
  );

  return (
    <div className="repo-list-root flex h-full flex-col">
      <div
        data-tauri-drag-region
        className="flex h-10 items-center justify-between pl-[100px] pr-2"
      >
        <div className="flex items-center gap-1.5" data-tauri-no-drag>
          <div className="flex size-5 items-center justify-center">
            <AppBrandIcon />
          </div>
          <span className="text-label-12 font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            One Publish
          </span>
        </div>
        <div className="flex items-center gap-0.5" data-tauri-no-drag>
          {onCollapse && (
            <Button
              variant="ghost"
              size="icon"
              className={cn(topbarIconButtonClass, "group [&_svg]:!stroke-[1]")}
              onClick={(event) => {
                event.stopPropagation();
                onCollapse();
              }}
              title={repoT.collapsePanel || "收起面板"}
              aria-label={repoT.collapsePanel || "收起面板"}
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
          className="flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-button-14 font-normal transition-colors duration-150 ease-geist hover:bg-accent"
          onClick={() => setFilterExpanded(!filterExpanded)}
        >
          <span className="text-foreground/80">{repoT.all || "全部"}</span>
          <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-interactive/10 px-1 text-label-12 font-semibold text-interactive">
            {repositories.length}
          </span>
          <ChevronDown
            className={cn(
              "size-3 text-muted-foreground/60 transition-transform duration-150 ease-geist",
              filterExpanded ? "" : "-rotate-90"
            )}
          />
        </button>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className={listActionButtonClass}
            onClick={(event) => {
              event.stopPropagation();
              onAddRepo();
            }}
            title={repoT.addRepository || "添加仓库"}
            data-tauri-no-drag
          >
            <Plus className="size-3.5 text-muted-foreground transition-transform duration-150 ease-geist hover:rotate-90" />
          </button>
          <button
            type="button"
            className={cn(
              listActionButtonClass,
              showReorderControls && "bg-accent"
            )}
            onClick={(event) => {
              event.stopPropagation();
              setShowReorderControls((value) => !value);
            }}
            title={reorderControlsLabel}
            aria-label={reorderControlsLabel}
            aria-pressed={showReorderControls}
            data-tauri-no-drag
          >
            <ArrowUpDown
              className={cn(
                "size-3.5 transition-[transform,color] duration-150 ease-geist",
                showReorderControls
                  ? "rotate-180 hover:rotate-[360deg] text-interactive"
                  : "rotate-0 hover:rotate-180 text-muted-foreground"
              )}
            />
          </button>
        </div>
      </div>

      <div className="px-3 py-1.5">
        <div className="group/search search-input-shell surface-input relative rounded-md">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50 transition-colors duration-150 ease-geist group-focus-within/search:text-muted-foreground" />
          <Input
            bare
            data-testid="repo-search-input"
            placeholder={repoT.searchRepository || "搜索仓库"}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            aria-label={repoT.searchRepository || "搜索仓库"}
            className="h-8 pl-8 text-label-14"
          />
        </div>
      </div>

      {repoListContent}

      {editingRepo ? (
        <Suspense fallback={null}>
          <EditRepositoryDialog
            repository={editingRepo}
            providers={providers}
            repoT={repoT}
            onOpenChange={handleEditDialogChange}
            onEditRepo={onEditRepo}
            onDetectProvider={onDetectProvider}
            onScanProjectCandidates={onScanProjectCandidates}
            onRefreshBranches={onRefreshBranches}
          />
        </Suspense>
      ) : null}

      <div className="relative flex items-center px-3 py-2">
        <div className="pointer-events-none absolute -top-6 left-0 right-0 h-6 " />
        <button
          type="button"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground/50 transition-colors duration-150 ease-geist hover:bg-muted hover:text-foreground/70"
          onClick={onSettings}
        >
          <Settings className="size-3.5 transition-transform duration-150 ease-geist hover:rotate-90" />
        </button>
      </div>
    </div>
  );
});
