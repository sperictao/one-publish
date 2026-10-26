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
  const {
    selectedRepo,
    isStateLoading,
    activeProviderUsesProjectFile,
    isPublishing,
    scanProject,
    startPublish,
  } = params;
  const onRefreshShortcut = useCallback(() => {
    if (selectedRepo && !isStateLoading && activeProviderUsesProjectFile) {
      scanProject(selectedRepo.path, {
        projectFile: selectedRepo.projectFile ?? undefined,
      });
    }
  }, [
    selectedRepo,
    isStateLoading,
    activeProviderUsesProjectFile,
    scanProject,
  ]);

  const onPublishShortcut = useCallback(() => {
    if (isPublishing) {
      return;
    }
    if (selectedRepo) {
      startPublish();
    }
  }, [isPublishing, selectedRepo, startPublish]);

  return { onRefreshShortcut, onPublishShortcut };
}
