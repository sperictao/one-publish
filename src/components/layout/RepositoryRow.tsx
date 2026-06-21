import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { memo } from "react";
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

export const RepositoryRow = memo(function RepositoryRow({
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
}: RepositoryRowProps): ReactNode {
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
          "flex w-full items-start gap-2.5 rounded-md border border-transparent bg-transparent py-2.5 pr-11 text-left shadow-none outline-none transition-colors duration-150 ease-geist hover:bg-accent focus-visible:ring-2 focus-visible:ring-interactive/30 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          isSelected && "bg-accent",
          dragHandleVisible ? "pl-10" : "pl-3"
        )}
        onClick={() => {
          onSelect(repo.id);
        }}
      >
        <span
          className={cn(
            "mt-0.5 flex size-8 flex-shrink-0 items-center justify-center rounded-md transition-colors duration-150 ease-geist",
            isSelected
              ? "bg-interactive/10"
              : "bg-muted group-hover:bg-interactive/10"
          )}
        >
          <FolderGit2
            className={cn(
              "size-4 transition-colors duration-150 ease-geist",
              isSelected
                ? "text-interactive"
                : "text-muted-foreground group-hover:text-interactive"
            )}
          />
        </span>

        <div className="min-w-0 flex-1">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "block min-w-0 truncate text-label-13 font-semibold transition-colors duration-150 ease-geist",
                  isSelected ? "text-foreground" : "text-foreground/78"
                )}
              >
                {repo.name}
              </span>
              {repo.providerId ? (
                <span className="flex-shrink-0 rounded-full bg-interactive/10 px-1.5 py-0.5 text-label-12 font-semibold text-interactive">
                  {repo.providerId}
                </span>
              ) : null}
            </div>
            <p
              className="mt-0.5 truncate text-label-12 text-muted-foreground"
              title={repo.path}
            >
              {repo.path}
            </p>
          </div>

          <div className="mt-1.5 min-w-0">
            <span
              className={cn(
                "inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-label-12 transition-colors duration-150",
                canConnectBranch
                  ? "border border-success/20 bg-success/10 text-success"
                  : "border border-border bg-muted text-muted-foreground"
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
});
