import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Folder, Settings } from "lucide-react";

interface TranslationMap {
  [key: string]: string | undefined;
}

export interface MainContentShellProps {
  leftPanelCollapsed: boolean;
  middlePanelCollapsed: boolean;
  appT: TranslationMap;
  configPanelT: TranslationMap;
  onExpandLeftPanel: () => void;
  onExpandMiddlePanel: () => void;
  children: React.ReactNode;
}

export function MainContentShell({
  leftPanelCollapsed,
  middlePanelCollapsed,
  appT,
  configPanelT,
  onExpandLeftPanel,
  onExpandMiddlePanel,
  children,
}: MainContentShellProps) {
  return (
    <div className="flex-1 flex flex-col p-2">
      <div className="glass-card repo-sidebar-shell flex h-full flex-col overflow-hidden rounded-2xl">
        <div className="h-10 flex-shrink-0 bg-[var(--glass-panel-bg)]/30 flex">
          {middlePanelCollapsed && (
            <div
              data-tauri-drag-region
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
                    className="h-6 w-6"
                    onClick={(e) => {
                      e.stopPropagation();
                      onExpandLeftPanel();
                    }}
                    title={appT.expandRepoList || "展开仓库列表"}
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
                    onExpandMiddlePanel();
                  }}
                  title={configPanelT.expandConfigList || "展开配置列表"}
                  data-tauri-no-drag
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
          <div data-tauri-drag-region className="flex-1" />
        </div>
        <div className="repo-list-scroll glass-scrollbar relative flex-1 overflow-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
