import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { useProjectScanner } from "@/features/repository/useProjectScanner";
import { resolvePreferredDotnetProjectInfo } from "@/lib/dotnetProjectInfo";
import type { ProjectInfo } from "@/lib/store/types";

interface TranslationMap {
  [key: string]: string | undefined;
}

interface ProjectInfoSnapshot {
  projectInfo: ProjectInfo | null;
  revision: number;
  fingerprint: string;
}

const EMPTY_PROJECT_INFO_SNAPSHOT: ProjectInfoSnapshot = {
  projectInfo: null,
  revision: 0,
  fingerprint: "",
};

function buildProjectInfoListFingerprint(projectInfo: ProjectInfo | null): string {
  if (!projectInfo) {
    return "";
  }

  return [
    projectInfo.root_path,
    projectInfo.project_file,
    projectInfo.publish_profiles.join("\u0001"),
  ].join("\u0000");
}

function createProjectInfoSnapshot(
  projectInfo: ProjectInfo | null,
  previousSnapshot: ProjectInfoSnapshot = EMPTY_PROJECT_INFO_SNAPSHOT
): ProjectInfoSnapshot {
  const fingerprint = buildProjectInfoListFingerprint(projectInfo);
  const isSameSnapshot = previousSnapshot.fingerprint === fingerprint;

  return {
    projectInfo,
    revision:
      isSameSnapshot
        ? previousSnapshot.revision
        : previousSnapshot.revision === 0 && fingerprint === ""
          ? 0
          : previousSnapshot.revision + 1,
    fingerprint,
  };
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
  activeProviderId?: string;
  activeProviderUsesProjectFile?: boolean;
}) {
  const providerUsesProjectFile = params.activeProviderUsesProjectFile ?? true;
  const [visibleProjectInfoSnapshot, setVisibleProjectInfoSnapshot] =
    useState<ProjectInfoSnapshot>(EMPTY_PROJECT_INFO_SNAPSHOT);
  const [isProjectInfoRefreshing, setIsProjectInfoRefreshing] = useState(false);
  const scanRequestIdRef = useRef(0);
  const projectInfoCacheRef = useRef<Record<string, ProjectInfoSnapshot>>({});
  const currentScopeKey = buildProjectInfoScopeKey({
    selectedRepoId: params.selectedRepoId,
    selectedRepoPath: params.selectedRepoPath,
    selectedRepoProjectFile: params.selectedRepoProjectFile,
  });
  const selectedScopeKeyRef = useRef<string | null>(currentScopeKey);
  const canExposeProjectInfoRef = useRef(
    Boolean(
      params.selectedRepoPath &&
        !params.isStateLoading &&
        providerUsesProjectFile
    )
  );
  const projectInfo = visibleProjectInfoSnapshot.projectInfo;
  const projectProfilesRevision = visibleProjectInfoSnapshot.revision;
  selectedScopeKeyRef.current = currentScopeKey;
  canExposeProjectInfoRef.current = Boolean(
    params.selectedRepoPath &&
      !params.isStateLoading &&
      providerUsesProjectFile
  );
  const {
    scanProject: scanProjectRequest,
    resolveProjectInfo: resolveProjectInfoRequest,
  } = useProjectScanner({
    appT: params.appT,
  });

  const commitProjectInfoSnapshot = useCallback(
    (scopeKey: string | null, nextProjectInfo: ProjectInfo | null) => {
      const previousSnapshot =
        scopeKey && projectInfoCacheRef.current[scopeKey]
          ? projectInfoCacheRef.current[scopeKey]
          : EMPTY_PROJECT_INFO_SNAPSHOT;
      const nextSnapshot = createProjectInfoSnapshot(
        nextProjectInfo,
        previousSnapshot
      );

      if (scopeKey) {
        if (nextProjectInfo) {
          projectInfoCacheRef.current[scopeKey] = nextSnapshot;
        } else {
          delete projectInfoCacheRef.current[scopeKey];
        }
      }

      if (selectedScopeKeyRef.current === scopeKey) {
        setVisibleProjectInfoSnapshot(nextSnapshot);
      }

      return nextSnapshot;
    },
    []
  );

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

      if (!targetPath || !providerUsesProjectFile) {
        setVisibleProjectInfoSnapshot(EMPTY_PROJECT_INFO_SNAPSHOT);
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
        selectedScopeKeyRef.current !== currentScopeKey ||
        !canExposeProjectInfoRef.current ||
        !info ||
        params.selectedRepoPath?.trim() !== targetPath ||
        (boundProjectFile &&
          params.selectedRepoProjectFile?.trim() !== boundProjectFile)
      ) {
        if (
          requestId === scanRequestIdRef.current &&
          selectedScopeKeyRef.current === currentScopeKey &&
          canExposeProjectInfoRef.current &&
          !info
        ) {
          commitProjectInfoSnapshot(currentScopeKey, null);
          setIsProjectInfoRefreshing(false);
        }
        return info;
      }

      commitProjectInfoSnapshot(currentScopeKey, info);
      setIsProjectInfoRefreshing(false);
      return info;
    },
    [
      commitProjectInfoSnapshot,
      providerUsesProjectFile,
      params.selectedRepoId,
      params.selectedRepoPath,
      params.selectedRepoProjectFile,
      resolveProjectInfoRequest,
      scanProjectRequest,
    ]
  );

  useLayoutEffect(() => {
    if (
      !params.selectedRepoPath ||
      params.isStateLoading ||
      !providerUsesProjectFile
    ) {
      scanRequestIdRef.current += 1;
      setVisibleProjectInfoSnapshot(EMPTY_PROJECT_INFO_SNAPSHOT);
      setIsProjectInfoRefreshing(false);
      return;
    }

    const currentScopeKey = buildProjectInfoScopeKey({
      selectedRepoId: params.selectedRepoId,
      selectedRepoPath: params.selectedRepoPath,
      selectedRepoProjectFile: params.selectedRepoProjectFile,
    });
    const cachedSnapshot = currentScopeKey
      ? projectInfoCacheRef.current[currentScopeKey] ?? EMPTY_PROJECT_INFO_SNAPSHOT
      : EMPTY_PROJECT_INFO_SNAPSHOT;

    setVisibleProjectInfoSnapshot(cachedSnapshot);
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
    providerUsesProjectFile,
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
    projectProfilesRevision,
    isProjectInfoRefreshing,
    scanProject,
  };
}
