import { useState } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Search,
  Plus,
  RefreshCw,
  GitBranch,
  Folder,
} from "lucide-react";
import type { Repository } from "@/lib/store/types";
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
      <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <line x1="6" y1="2" x2="6" y2="14" stroke="currentColor" strokeWidth="1.5" />
      <path d="M11 6L8 8L11 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface BranchPanelProps {
  repository: Repository | null;
  onRefresh?: () => void;
  onCreateBranch?: () => void;
  onCollapse?: () => void;
  showExpandButton?: boolean;
  onExpandRepo?: () => void;
}

export function BranchPanel({
  repository,
  onRefresh,
  onCreateBranch,
  onCollapse,
  showExpandButton,
  onExpandRepo,
}: BranchPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const { translations } = useI18n();
  const branchT = translations.branchPanel || {};

  if (!repository) {
    return (
      <div className="flex h-full flex-col">
        {/* Header with buttons (disabled state) */}
        <div
          data-tauri-drag-region
          className={cn(
            "flex h-10 items-center justify-end border-b border-border px-2",
            showExpandButton && "pl-[100px]"
          )}
        >
          <div className="flex items-center gap-0.5" data-tauri-no-drag>
            {showExpandButton && onExpandRepo && (
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onExpandRepo();
                }}
                aria-label={branchT.expandRepoList || "展开仓库列表"}
                title={branchT.expandRepoList || "展开仓库列表"}
                data-tauri-no-drag
              >
                <Folder className="size-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              disabled
              aria-label={branchT.newWorktree || "新建 worktree"}
            >
              <Plus className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled
              aria-label={branchT.refresh || "刷新"}
            >
              <RefreshCw className="size-4" />
            </Button>
            {onCollapse && (
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onCollapse();
                }}
                aria-label={branchT.collapsePanel || "收起面板"}
                title={branchT.collapsePanel || "收起面板"}
                data-tauri-no-drag
              >
                <CollapseIcon />
              </Button>
            )}
          </div>
        </div>
        {/* Search (disabled) */}
        <div className="border-b border-border px-3 py-2">
          <div className="surface-input relative rounded-md">
            <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={branchT.searchWorktree || "搜索 worktree"}
              disabled
              aria-label={branchT.searchWorktree || "搜索 worktree"}
              className="h-8 pl-8 text-sm"
            />
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {branchT.selectRepository || "请选择一个仓库"}
        </div>
      </div>
    );
  }

  const filteredBranches = repository.branches.filter((branch) =>
    branch.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header with action buttons */}
      <div
        data-tauri-drag-region
        className={cn(
          "flex h-10 items-center justify-end border-b border-border px-2",
          showExpandButton && "pl-[100px]"
        )}
      >
        <div className="flex items-center gap-0.5" data-tauri-no-drag>
          {showExpandButton && onExpandRepo && (
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onExpandRepo();
                }}
                aria-label={branchT.expandRepoList || "展开仓库列表"}
                title={branchT.expandRepoList || "展开仓库列表"}
                data-tauri-no-drag
              >
                <Folder className="size-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                onCreateBranch?.();
              }}
              aria-label={branchT.newWorktree || "新建 worktree"}
              title={branchT.newWorktree || "新建 worktree"}
              data-tauri-no-drag
            >
              <Plus className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                onRefresh?.();
              }}
              aria-label={branchT.refresh || "刷新"}
              title={branchT.refresh || "刷新"}
              data-tauri-no-drag
            >
              <RefreshCw className="size-4" />
            </Button>
            {onCollapse && (
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onCollapse();
                }}
                aria-label={branchT.collapsePanel || "收起面板"}
                title={branchT.collapsePanel || "收起面板"}
                data-tauri-no-drag
              >
                <CollapseIcon />
              </Button>
            )}
        </div>
      </div>

      {/* Search */}
      <div className="border-b border-border px-3 py-2">
        <div className="surface-input relative rounded-md">
          <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={branchT.searchWorktree || "搜索 worktree"}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label={branchT.searchWorktree || "搜索 worktree"}
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>

      {/* Branch List */}
      <div className="flex-1 overflow-auto geist-scrollbar">
        <div>
        {filteredBranches.map((branch) => (
          <div
            key={branch.name}
            className={cn(
              "flex items-start gap-2 border-b border-border px-3 py-3 transition-colors duration-150 ease-geist hover:bg-accent cursor-pointer",
              branch.isCurrent && "rounded-lg mx-1 border-0 bg-accent"
            )}
          >
            <GitBranch
              className={cn(
                "mt-0.5 size-4 flex-shrink-0",
                branch.isCurrent ? "text-interactive" : "text-muted-foreground"
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold">
                  {branch.name}
                </span>
                {branch.isMain && (
                  <span className="status-success rounded px-1.5 py-0.5 text-[10px] font-semibold">
                    {branchT.mainBadge || "MAIN"}
                  </span>
                )}
              </div>
              <span className="block truncate text-xs text-muted-foreground mt-0.5">
                {branch.path}
              </span>
            </div>
            {/* Current-branch indicator */}
            {branch.isCurrent && (
              <div className="flex-shrink-0 mt-1">
                <span className="sr-only">
                  {branchT.currentBranch || "当前分支"}
                </span>
                <div
                  aria-hidden="true"
                  className="size-2.5 rounded-full bg-success"
                />
              </div>
            )}
          </div>
        ))}
        </div>
      </div>
    </div>
  );
}
