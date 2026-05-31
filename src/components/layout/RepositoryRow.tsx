import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
} from "react";
import { cn } from "@/lib/utils";
import { FolderGit2, GitBranch } from "lucide-react";
import type { Repository } from "@/lib/store/types";
import { ListDragHandle } from "./ListReorderControls";
import { RepositoryRowActionsMenu } from "./RepositoryRowActionsMenu";

interface RepositoryRowProps {
  repo: Repository;
  isSelected: boolean;
  isVisualTarget: boolean;
  isMenuOpen: boolean;
  canConnectBranch: boolean;
  repoT: Record<string, string | undefined>;
  rowRef: (node: HTMLDivElement | null) => void;
  onSelect: (repoId: string) => void;
  onOpenDirectory: (repo: Repository) => Promise<unknown> | unknown;
  onEdit: (repo: Repository) => Promise<unknown> | unknown;
  onRemove: (repo: Repository) => Promise<unknown> | unknown;
  onRowMouseEnter: (repoId: string) => void;
  onRowFocus: (repoId: string) => void;
  onRowBlur: (repoId: string) => void;
  onMenuOpenChange: (repoId: string, open: boolean) => void;
  dragEnabled: boolean;
  dragHandleVisible: boolean;
  dragHandleLabel: string;
  dragDisabledLabel: string;
  isDragging: boolean;
  dragPreviewStyle?: CSSProperties;
  onHandlePointerDown: (
    repoId: string,
    event: ReactPointerEvent<HTMLButtonElement>
  ) => void;
}

export function RepositoryRow({
  repo,
  isSelected,
  isVisualTarget,
  isMenuOpen,
  canConnectBranch,
  repoT,
  rowRef,
  onSelect,
  onOpenDirectory,
  onEdit,
  onRemove,
  onRowMouseEnter,
  onRowFocus,
  onRowBlur,
  onMenuOpenChange,
  dragEnabled,
  dragHandleVisible,
  dragHandleLabel,
  dragDisabledLabel,
  isDragging,
  dragPreviewStyle,
  onHandlePointerDown,
}: RepositoryRowProps): JSX.Element {
  const currentBranchName =
    repo.currentBranch?.trim() || repoT.currentBranchUnknown || "未知分支";

  return (
    <div
      ref={rowRef}
      data-list-row="true"
      data-list-item-id={repo.id}
      data-list-visual-target={isVisualTarget ? "true" : "false"}
      data-list-menu-open={isMenuOpen ? "true" : "false"}
      className={cn(
        "group relative z-10",
        isDragging && "pointer-events-none z-40"
      )}
      style={isDragging ? dragPreviewStyle : undefined}
      onMouseEnter={() => {
        onRowMouseEnter(repo.id);
      }}
      onFocusCapture={() => {
        onRowFocus(repo.id);
      }}
      onBlurCapture={(event) => {
        const nextFocusTarget = event.relatedTarget;
        if (nextFocusTarget instanceof Node && event.currentTarget.contains(nextFocusTarget)) {
          return;
        }

        onRowBlur(repo.id);
      }}
    >
      <ListDragHandle
        visible={dragHandleVisible}
        enabled={dragEnabled}
        label={dragHandleLabel}
        disabledLabel={dragDisabledLabel}
        onPointerDown={(event) => {
          onHandlePointerDown(repo.id, event);
        }}
      />
      <button
        type="button"
        aria-pressed={isSelected}
        aria-label={`${repoT.selectRepository || "选择仓库"}: ${repo.name}`}
        className={cn(
          "flex w-full items-start gap-2.5 rounded-2xl border border-transparent bg-transparent py-2.5 pr-11 text-left shadow-none outline-none transition-all duration-300 hover:bg-[var(--glass-bg)]/20 focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          dragHandleVisible ? "pl-10" : "pl-3"
        )}
        onClick={() => {
          onSelect(repo.id);
        }}
      >
        <span
          className={cn(
            "mt-0.5 flex size-8 flex-shrink-0 items-center justify-center rounded-[14px] transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
            isSelected
              ? "scale-105 bg-primary/10 shadow-[0_0_18px_hsl(var(--primary)/0.24)]"
              : "bg-[var(--glass-icon-bg)] shadow-[var(--glass-icon-highlight)] group-hover:scale-105 group-hover:bg-primary/8"
          )}
        >
          <FolderGit2
            className={cn(
              "size-4 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
              isSelected
                ? "scale-110 text-primary drop-shadow-[0_0_4px_hsl(var(--primary)/0.3)]"
                : "text-muted-foreground/60 group-hover:text-primary group-hover:drop-shadow-[0_0_3px_hsl(var(--primary)/0.15)]"
            )}
          />
        </span>

        <div className="min-w-0 flex-1">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "block min-w-0 truncate text-[13px] font-medium tracking-tight transition-colors duration-300",
                  isSelected ? "text-foreground" : "text-foreground/78"
                )}
              >
                {repo.name}
              </span>
              {repo.providerId ? (
                <span className="flex-shrink-0 rounded-full bg-primary/12 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                  {repo.providerId}
                </span>
              ) : null}
            </div>
            <p
              className="mt-0.5 truncate text-[11px] text-muted-foreground/55"
              title={repo.path}
            >
              {repo.path}
            </p>
          </div>

          <div className="mt-1.5 min-w-0">
            <span
              className={cn(
                "inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] leading-4 transition-all duration-300",
                canConnectBranch
                  ? "capsule-breathe bg-[var(--glass-branch-connected-bg)] text-[var(--glass-branch-connected-text)]"
                  : "border border-[var(--glass-branch-disconnected-border)] bg-[var(--glass-branch-disconnected-bg)] text-muted-foreground/64 shadow-[var(--glass-branch-disconnected-highlight)]"
              )}
              title={
                canConnectBranch
                  ? repoT.branchConnectable || "分支可连接"
                  : repoT.branchUnreachable || "分支不可连接"
              }
            >
              <GitBranch className="size-3 flex-shrink-0" />
              <span className="truncate">{currentBranchName}</span>
            </span>
          </div>
        </div>
      </button>

      <div className="absolute inset-y-0 right-3 flex items-center">
        <RepositoryRowActionsMenu
          repo={repo}
          open={isMenuOpen}
          repoT={repoT}
          onOpenChange={(open) => {
            onMenuOpenChange(repo.id, open);
          }}
          onOpenDirectory={onOpenDirectory}
          onEdit={onEdit}
          onRemove={onRemove}
        />
      </div>
    </div>
  );
}
