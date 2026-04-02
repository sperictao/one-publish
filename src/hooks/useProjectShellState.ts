import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { useProjectScanner } from "@/hooks/useProjectScanner";
import { resolvePreferredDotnetProjectInfo } from "@/lib/dotnetProjectInfo";
import type { ProjectInfo } from "@/types/project";

interface TranslationMap {
  [key: string]: string | undefined;
}

export function useProjectShellState(params: {
  appT: TranslationMap;
  selectedRepoId: string | null;
  selectedRepoPath?: string;
  selectedRepoProjectFile?: string;
  isStateLoading: boolean;
  activeProviderId: string;
}) {
  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null);
  const scanRequestIdRef = useRef(0);
  const {
    scanProject: scanProjectRequest,
    resolveProjectInfo: resolveProjectInfoRequest,
  } = useProjectScanner({
    appT: params.appT,
  });

  const scanProject = useCallback(
    async (
      path?: string,
      options?: {
        silentSuccess?: boolean;
        silentFailure?: boolean;
        projectFile?: string;
      }
    ) => {
      const targetPath = path?.trim();
      const boundProjectFile = options?.projectFile?.trim();
      const requestId = scanRequestIdRef.current + 1;
      scanRequestIdRef.current = requestId;

      if (!targetPath || params.activeProviderId !== "dotnet") {
        setProjectInfo(null);
        return null;
      }

      setProjectInfo(null);
      const info = await resolvePreferredDotnetProjectInfo({
        repoPath: targetPath,
        projectFile: boundProjectFile,
        resolveProjectInfo: (projectFile) =>
          resolveProjectInfoRequest(projectFile, {
            silentFailure: true,
          }),
        scanProject: (repoPath) =>
          scanProjectRequest(repoPath, {
            silentSuccess: options?.silentSuccess,
            silentFailure: options?.silentFailure,
          }),
      });

      if (
        requestId !== scanRequestIdRef.current ||
        !info ||
        params.selectedRepoPath?.trim() !== targetPath ||
        (boundProjectFile &&
          params.selectedRepoProjectFile?.trim() !== boundProjectFile)
      ) {
        return info;
      }

      setProjectInfo(info);
      return info;
    },
    [
      params.activeProviderId,
      params.selectedRepoPath,
      params.selectedRepoProjectFile,
      resolveProjectInfoRequest,
      scanProjectRequest,
    ]
  );

  useEffect(() => {
    if (
      !params.selectedRepoPath ||
      params.isStateLoading ||
      params.activeProviderId !== "dotnet"
    ) {
      scanRequestIdRef.current += 1;
      setProjectInfo(null);
      return;
    }

    void scanProject(params.selectedRepoPath, {
      silentSuccess: true,
      silentFailure: true,
      projectFile: params.selectedRepoProjectFile,
    });
  }, [
    params.selectedRepoId,
    params.selectedRepoPath,
    params.selectedRepoProjectFile,
    params.isStateLoading,
    params.activeProviderId,
    scanProject,
  ]);

  useEffect(() => {
    if (!isTauri()) {
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
