import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { useProjectScanner } from "@/hooks/useProjectScanner";
import { resolvePreferredDotnetProjectInfo } from "@/lib/dotnetProjectInfo";
import type { ProjectInfo } from "@/types/project";

interface TranslationMap {
  [key: string]: string | undefined;
}

function buildProjectInfoScopeKey(params: {
  selectedRepoId: string | null;
  selectedRepoPath?: string;
  selectedRepoProjectFile?: string;
}) {
  const normalizedRepoId = params.selectedRepoId?.trim() || "";
  const normalizedRepoPath = params.selectedRepoPath?.trim() || "";
  const normalizedProjectFile = params.selectedRepoProjectFile?.trim() || "";

  if (!normalizedRepoId && !normalizedRepoPath && !normalizedProjectFile) {
    return null;
  }

  return JSON.stringify({
    selectedRepoId: normalizedRepoId,
    selectedRepoPath: normalizedRepoPath,
    selectedRepoProjectFile: normalizedProjectFile,
  });
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
  const [isProjectInfoRefreshing, setIsProjectInfoRefreshing] = useState(false);
  const scanRequestIdRef = useRef(0);
  const projectInfoCacheRef = useRef<Record<string, ProjectInfo>>({});
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
      const currentScopeKey = buildProjectInfoScopeKey({
        selectedRepoId: params.selectedRepoId,
        selectedRepoPath: params.selectedRepoPath,
        selectedRepoProjectFile: params.selectedRepoProjectFile,
      });

      if (!targetPath || params.activeProviderId !== "dotnet") {
        setProjectInfo(null);
        setIsProjectInfoRefreshing(false);
        return null;
      }

      setIsProjectInfoRefreshing(true);
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
        if (requestId === scanRequestIdRef.current && !info) {
          if (currentScopeKey) {
            delete projectInfoCacheRef.current[currentScopeKey];
          }
          setProjectInfo(null);
          setIsProjectInfoRefreshing(false);
        }
        return info;
      }

      if (currentScopeKey) {
        projectInfoCacheRef.current[currentScopeKey] = info;
      }
      setProjectInfo(info);
      setIsProjectInfoRefreshing(false);
      return info;
    },
    [
      params.activeProviderId,
      params.selectedRepoId,
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
      setIsProjectInfoRefreshing(false);
      return;
    }

    const currentScopeKey = buildProjectInfoScopeKey({
      selectedRepoId: params.selectedRepoId,
      selectedRepoPath: params.selectedRepoPath,
      selectedRepoProjectFile: params.selectedRepoProjectFile,
    });
    const cachedProjectInfo = currentScopeKey
      ? projectInfoCacheRef.current[currentScopeKey] ?? null
      : null;

    setProjectInfo(cachedProjectInfo);
    setIsProjectInfoRefreshing(true);

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
    isProjectInfoRefreshing,
    setProjectInfo,
    scanProject,
  };
}
