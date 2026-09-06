import { useCallback } from "react";
import type { Repository, ProjectInfo } from "@/lib/store/types";

interface UseAppShortcutsPropsParams {
  selectedRepo: Repository | null;
  isStateLoading: boolean;
  activeProviderUsesProjectFile: boolean;
  isPublishing: boolean;
  scanProject: (
    path?: string,
    options?: { projectFile?: string }
  ) => Promise<ProjectInfo | null>;
  startPublish: () => void;
}

interface AppShortcutCallbacks {
  onRefreshShortcut: () => void;
  onPublishShortcut: () => void;
}

export function useAppShortcutsProps(
  params: UseAppShortcutsPropsParams
): AppShortcutCallbacks {
  const onRefreshShortcut = useCallback(() => {
    if (
      params.selectedRepo &&
      !params.isStateLoading &&
      params.activeProviderUsesProjectFile
    ) {
      params.scanProject(params.selectedRepo.path, {
        projectFile: params.selectedRepo.projectFile ?? undefined,
      });
    }
  }, [
    params.selectedRepo,
    params.isStateLoading,
    params.activeProviderUsesProjectFile,
    params.scanProject,
  ]);

  const onPublishShortcut = useCallback(() => {
    if (params.isPublishing) {
      return;
    }
    if (params.selectedRepo) {
      params.startPublish();
    }
  }, [params.isPublishing, params.selectedRepo, params.startPublish]);

  return { onRefreshShortcut, onPublishShortcut };
}
