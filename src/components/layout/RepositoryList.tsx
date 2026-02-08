import { useState } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Search,
  Plus,
  Settings,
  ChevronDown,
} from "lucide-react";
import type { Repository } from "@/types/repository";
import { useI18n } from "@/hooks/useI18n";

// Custom repo icon matching the screenshot
function RepoIcon({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <line x1="6" y1="2" x2="6" y2="14" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="10" cy="6" r="1.5" fill="currentColor" />
      <circle cx="10" cy="10" r="1.5" fill="currentColor" />
    </svg>
  );
}

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

interface RepositoryListProps {
  repositories: Repository[];
  selectedRepoId: string | null;
  onSelectRepo: (id: string) => void;
  onAddRepo: () => void;
  onSettings: () => void;
  onCollapse?: () => void;
}

export function RepositoryList({
  repositories,
  selectedRepoId,
  onSelectRepo,
  onAddRepo,
  onSettings,
  onCollapse,
}: RepositoryListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterExpanded, setFilterExpanded] = useState(true);
  const { translations } = useI18n();
  const repoT = translations.repositoryList || {};

  const filteredRepos = repositories.filter(
    (repo) =>
      repo.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      repo.path.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
      <div className="flex-1 overflow-auto px-3 py-2 space-y-2">
        {filteredRepos.map((repo) => (
          <button
            key={repo.id}
            className={cn(
              "group flex w-full items-start gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-accent",
              selectedRepoId === repo.id
                ? "bg-accent border-border"
                : "border-transparent hover:border-border"
            )}
            onClick={() => onSelectRepo(repo.id)}
          >
            <RepoIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">
                  {repo.name}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSettings();
                  }}
                >
                  <Settings className="h-3 w-3" />
                </Button>
              </div>
              <span className="block truncate text-xs text-muted-foreground">
                {repo.path}
              </span>
            </div>
          </button>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t px-3 py-2">
        <button
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={onAddRepo}
        >
          <Plus className="h-3 w-3" />
          <span>{repoT.addRepository || "添加仓库"}</span>
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onSettings}
        >
          <Settings className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
