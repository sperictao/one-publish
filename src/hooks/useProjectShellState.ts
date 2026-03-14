import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { useProjectScanner } from "@/hooks/useProjectScanner";

interface ProjectInfo {
  root_path: string;
  project_file: string;
  publish_profiles: string[];
}

interface TranslationMap {
  [key: string]: string | undefined;
}

export function useProjectShellState(params: {
  appT: TranslationMap;
  selectedRepoId: string | null;
  selectedRepoPath?: string;
  isStateLoading: boolean;
  activeProviderId: string;
}) {
  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null);
  const { scanProject } = useProjectScanner({
    appT: params.appT,
    setProjectInfo,
  });

  useEffect(() => {
    if (!params.selectedRepoPath || params.isStateLoading) {
      return;
    }

    if (params.activeProviderId === "dotnet") {
      void scanProject(params.selectedRepoPath, {
        silentSuccess: true,
        silentFailure: true,
      });
      return;
    }

    setProjectInfo(null);
  }, [
    params.selectedRepoId,
    params.selectedRepoPath,
    params.isStateLoading,
    params.activeProviderId,
    scanProject,
  ]);

  useEffect(() => {
    if (!(window as any).__TAURI__) {
      return;
    }

    const appWindow = getCurrentWindow();

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const dragRegion = target.closest("[data-tauri-drag-region]");
      const noDrag = target.closest("[data-tauri-no-drag]");

      if (dragRegion && !noDrag && e.buttons === 1) {
        e.preventDefault();
        if (e.detail === 2) {
          void appWindow.toggleMaximize().catch(() => {});
        } else {
          void appWindow.startDragging().catch(() => {});
        }
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, []);

  return {
    projectInfo,
    setProjectInfo,
    scanProject,
  };
}
