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
import type { Repository } from "@/types/repository";

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

  if (!repository) {
    return (
      <div className="flex h-full flex-col">
        {/* Header with buttons (disabled state) */}
        <div
          data-tauri-drag-region
          className={cn(
            "flex h-10 items-center justify-end border-b px-2",
            showExpandButton && "pl-[100px]"
          )}
        >
          <div className="flex items-center gap-0.5" data-tauri-no-drag>
            {showExpandButton && onExpandRepo && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={(e) => {
                  e.stopPropagation();
                  onExpandRepo();
                }}
                title="展开仓库列表"
                data-tauri-no-drag
              >
                <Folder className="h-4 w-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-6 w-6" disabled>
              <Plus className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" disabled>
              <RefreshCw className="h-4 w-4" />
            </Button>
            {onCollapse && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={(e) => {
                  e.stopPropagation();
                  onCollapse();
                }}
                title="收起面板"
                data-tauri-no-drag
              >
                <CollapseIcon />
              </Button>
            )}
          </div>
        </div>
        {/* Search (disabled) */}
        <div className="border-b px-3 py-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索 worktree"
              disabled
              className="h-8 pl-8 text-sm"
            />
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          请选择一个仓库
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
          "flex h-10 items-center justify-end border-b px-2",
          showExpandButton && "pl-[100px]"
        )}
      >
        <div className="flex items-center gap-0.5" data-tauri-no-drag>
          {showExpandButton && onExpandRepo && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={(e) => {
                e.stopPropagation();
                onExpandRepo();
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
              onCreateBranch?.();
            }}
            title="新建 worktree"
            data-tauri-no-drag
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation();
              onRefresh?.();
            }}
            title="刷新"
            data-tauri-no-drag
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          {onCollapse && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={(e) => {
                e.stopPropagation();
                onCollapse();
              }}
              title="收起面板"
              data-tauri-no-drag
            >
              <CollapseIcon />
            </Button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="border-b px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索 worktree"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>

      {/* Branch List */}
      <div className="flex-1 overflow-auto">
        {filteredBranches.map((branch) => (
          <div
            key={branch.name}
            className={cn(
              "flex items-start gap-2 border-b px-3 py-3 transition-colors hover:bg-accent cursor-pointer",
              branch.isCurrent && "bg-accent/50"
            )}
          >
            <GitBranch
              className={cn(
                "mt-0.5 h-4 w-4 flex-shrink-0",
                branch.isCurrent ? "text-primary" : "text-muted-foreground"
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">
                  {branch.name}
                </span>
                {branch.isMain && (
                  <span className="rounded bg-green-500/20 px-1.5 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">
                    MAIN
                  </span>
                )}
              </div>
              <span className="block truncate text-xs text-muted-foreground mt-0.5">
                {branch.path}
              </span>
            </div>
            {/* Green dot for current branch */}
            {branch.isCurrent && (
              <div className="flex-shrink-0 mt-1">
                <div className="h-2.5 w-2.5 rounded-full bg-green-500" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
