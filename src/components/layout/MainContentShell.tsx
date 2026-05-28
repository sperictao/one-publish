import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FileCog, Folder, History, LayoutDashboard } from "lucide-react";

interface TranslationMap {
  [key: string]: string | undefined;
}

export interface MainContentShellProps {
  leftPanelCollapsed: boolean;
  middlePanelCollapsed: boolean;
  appT: TranslationMap;
  configPanelT: TranslationMap;
  rightPanelView: "home" | "history";
  onExpandLeftPanel: () => void;
  onExpandMiddlePanel: () => void;
  onSelectHomeView: () => void;
  onSelectHistoryView: () => void;
  children: React.ReactNode;
}

export function MainContentShell({
  leftPanelCollapsed,
  middlePanelCollapsed,
  appT,
  configPanelT,
  rightPanelView,
  onExpandLeftPanel,
  onExpandMiddlePanel,
  onSelectHomeView,
  onSelectHistoryView,
  children,
}: MainContentShellProps) {
  const headerIconButtonClass =
    "h-7 w-9 rounded-full p-0 text-muted-foreground/60 hover:bg-black/[0.045] hover:text-foreground hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_1px_2px_rgba(15,23,42,0.06)] dark:hover:bg-white/[0.06] dark:hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]";
  const viewButtonClass =
    "flex h-7 w-9 items-center justify-center rounded-full p-0 transition-all duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background";

  return (
    <div className="flex min-w-0 flex-1 flex-col p-2">
      <div className="glass-card repo-sidebar-shell flex h-full min-w-0 flex-col overflow-hidden rounded-2xl">
        <div
          data-tauri-drag-region
          className="flex h-10 flex-shrink-0 items-center bg-[var(--glass-panel-bg)]/30"
        >
          {middlePanelCollapsed && (
            <div
              className={cn(
                "flex items-center justify-end px-2",
                leftPanelCollapsed && "pl-[100px]"
              )}
            >
              <div className="flex items-center gap-0.5" data-tauri-no-drag>
                {leftPanelCollapsed && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className={headerIconButtonClass}
                    onClick={(e) => {
                      e.stopPropagation();
                      onExpandLeftPanel();
                    }}
                    title={appT.expandRepoList || "展开仓库列表"}
                    data-tauri-no-drag
                  >
                    <Folder className="size-4" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className={headerIconButtonClass}
                  onClick={(e) => {
                    e.stopPropagation();
                    onExpandMiddlePanel();
                  }}
                  title={configPanelT.expandConfigList || "展开配置列表"}
                  data-tauri-no-drag
                >
                  <FileCog className="size-4" />
                </Button>
              </div>
            </div>
          )}
          <div className="flex-1" />
          <div className="flex items-center gap-0.5 px-2" data-tauri-no-drag>
            <button
              type="button"
              className={cn(
                viewButtonClass,
                rightPanelView === "home"
                  ? "bg-background/95 text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_1px_2px_rgba(15,23,42,0.08)] dark:bg-white/90 dark:text-slate-900"
                  : "text-muted-foreground/65 hover:bg-black/[0.045] hover:text-foreground hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_1px_2px_rgba(15,23,42,0.06)] dark:hover:bg-white/[0.06] dark:hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
              )}
              onClick={(e) => {
                e.stopPropagation();
                onSelectHomeView();
              }}
              aria-label={appT.rightPanelHome || "主页"}
              title={appT.rightPanelHome || "主页"}
              aria-pressed={rightPanelView === "home"}
              data-tauri-no-drag
            >
              <LayoutDashboard className="size-3.5" />
            </button>
            <button
              type="button"
              className={cn(
                viewButtonClass,
                rightPanelView === "history"
                  ? "bg-background/95 text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_1px_2px_rgba(15,23,42,0.08)] dark:bg-white/90 dark:text-slate-900"
                  : "text-muted-foreground/65 hover:bg-black/[0.045] hover:text-foreground hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_1px_2px_rgba(15,23,42,0.06)] dark:hover:bg-white/[0.06] dark:hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
              )}
              onClick={(e) => {
                e.stopPropagation();
                onSelectHistoryView();
              }}
              aria-label={appT.rightPanelHistory || "历史记录"}
              title={appT.rightPanelHistory || "历史记录"}
              aria-pressed={rightPanelView === "history"}
              data-tauri-no-drag
            >
              <History className="size-3.5" />
            </button>
          </div>
        </div>
        <div className="list-scroll-shell glass-scrollbar relative flex-1 min-w-0 overflow-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
