import { useCallback, useState } from "react";
import { useRepositoryViewState } from "@/features/repository/useRepositoryViewState";
import { useRepositoryActions } from "@/features/repository/useRepositoryActions";
import { useProjectShellState } from "@/features/repository/useProjectShellState";
import { useProjectPublishProfileOrder } from "@/hooks/useProjectPublishProfileOrder";
import { extractSpecFromRecord as specFromRecord } from "@/features/history/specFromRecord";
import type { Repository } from "@/lib/store/types";
import type { ProviderManifest } from "@/lib/store/types";
import type { EnvironmentCheckSnapshot } from "@/features/environment/environment";

interface TranslationMap {
  [key: string]: string | undefined;
}

interface UseRepoBootParams {
  // From useAppState (repo domain)
  repositories: Repository[];
  selectedRepoId: string | null;
  addRepository: (repo: Repository) => Promise<unknown>;
  removeRepository: (repoId: string) => Promise<unknown>;
  updateRepository: (repo: Repository) => Promise<unknown>;
  reorderRepositories: (repoIds: string[]) => void;
  selectRepository: (repoId: string | null) => void;

  // Cross-domain dependencies
  appT: TranslationMap;
  providerRuntimeProviders: ProviderManifest[];
  isStateLoading: boolean;
  activeProviderUsesProjectFile: boolean;
  applySelectedRepositoryProvider: (providerId?: string | null) => void;
}

export function useRepoBoot(params: UseRepoBootParams) {
  // Local state
  const [environmentLastCheck, setEnvironmentLastCheck] =
    useState<EnvironmentCheckSnapshot | null>(null);
  const [recentHistoryExports, setRecentHistoryExports] = useState<string[]>(
    []
  );

  const trackHistoryExport = useCallback((outputPath: string) => {
    setRecentHistoryExports((prev) =>
      [outputPath, ...prev.filter((item) => item !== outputPath)].slice(0, 20)
    );
  }, []);

  // Repository view state
  const { selectedRepo, branchConnectivityByRepoId, actualBranchByRepoId } =
    useRepositoryViewState({
      repositories: params.repositories,
      selectedRepoId: params.selectedRepoId,
    });

  // Repository actions
  const {
    handleAddRepo,
    handleRemoveRepo,
    handleOpenRepoDirectory,
    handleEditRepo,
    handleDetectRepoProvider,
    handleScanProjectCandidates,
    handleRefreshRepoBranches,
  } = useRepositoryActions({
    appT: params.appT,
    providers: params.providerRuntimeProviders,
    repositories: params.repositories,
    selectedRepoId: params.selectedRepoId,
    addRepository: params.addRepository,
    removeRepository: params.removeRepository,
    updateRepository: params.updateRepository,
    applySelectedRepositoryProvider: params.applySelectedRepositoryProvider,
  });

  // Project shell state
  const { projectInfo, isProjectInfoRefreshing, scanProject } =
    useProjectShellState({
      appT: params.appT,
      selectedRepoId: params.selectedRepoId,
      selectedRepoPath: selectedRepo?.path,
      selectedRepoProjectFile: selectedRepo?.projectFile ?? undefined,
      isStateLoading: params.isStateLoading,
      activeProviderUsesProjectFile: params.activeProviderUsesProjectFile,
    });

  // Project publish profile ordering
  const { orderedProjectPublishProfiles, reorderProjectPublishProfiles } =
    useProjectPublishProfileOrder({
      repoId: params.selectedRepoId,
      projectFilePath: projectInfo?.project_file,
      projectPublishProfiles: projectInfo?.publish_profiles || [],
    });

  // Recoverable spec
  const extractSpecFromRecord = specFromRecord;

  return {
    // Repo domain
    repositories: params.repositories,
    selectedRepoId: params.selectedRepoId,
    addRepository: params.addRepository,
    removeRepository: params.removeRepository,
    updateRepository: params.updateRepository,
    reorderRepositories: params.reorderRepositories,
    selectRepository: params.selectRepository,
    selectedRepo,
    branchConnectivityByRepoId,
    actualBranchByRepoId,
    handleAddRepo,
    handleRemoveRepo,
    handleOpenRepoDirectory,
    handleEditRepo,
    handleDetectRepoProvider,
    handleScanProjectCandidates,
    handleRefreshRepoBranches,
    environmentLastCheck,
    setEnvironmentLastCheck,
    recentHistoryExports,
    trackHistoryExport,

    // Exposed for cross-domain use (used by publish domain)
    projectInfo,
    isProjectInfoRefreshing,
    scanProject,
    orderedProjectPublishProfiles,
    reorderProjectPublishProfiles,
    extractSpecFromRecord,
  };
}

export type UseRepoBootReturn = ReturnType<typeof useRepoBoot>;
