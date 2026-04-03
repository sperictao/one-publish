import { useCallback } from "react";
import type { Branch, Repository } from "@/types/repository";
import type { ProjectScanCandidates } from "@/types/project";

const loadRepositoryActionsRuntime = () =>
  import("@/hooks/useRepositoryActions.runtime");

interface TranslationMap {
  [key: string]: string | undefined;
}

interface UseRepositoryActionsParams {
  appT: TranslationMap;
  repositories: Repository[];
  selectedRepoId: string | null;
  addRepository: (repo: Repository) => Promise<unknown>;
  removeRepository: (repoId: string) => Promise<unknown>;
  updateRepository: (repo: Repository) => Promise<unknown>;
  setActiveProviderId: (value: string) => void;
}

interface RefreshBranchesResult {
  branches: Branch[];
  currentBranch: string;
}

export function useRepositoryActions({
  appT,
  repositories,
  selectedRepoId,
  addRepository,
  removeRepository,
  updateRepository,
  setActiveProviderId,
}: UseRepositoryActionsParams) {
  const handleAddRepo = useCallback(async () => {
    const { handleAddRepoRuntime } = await loadRepositoryActionsRuntime();
    await handleAddRepoRuntime({ appT, addRepository });
  }, [addRepository, appT]);

  const handleRemoveRepo = useCallback(
    async (repo: Repository) => {
      const { handleRemoveRepoRuntime } = await loadRepositoryActionsRuntime();
      await handleRemoveRepoRuntime({ appT, repo, removeRepository });
    },
    [appT, removeRepository]
  );

  const handleOpenRepoDirectory = useCallback(
    async (repo: Repository) => {
      const { handleOpenRepoDirectoryRuntime } =
        await loadRepositoryActionsRuntime();
      await handleOpenRepoDirectoryRuntime({ appT, repo });
    },
    [appT]
  );

  const handleEditRepo = useCallback(
    async (repo: Repository) => {
      const { handleEditRepoRuntime } = await loadRepositoryActionsRuntime();
      return await handleEditRepoRuntime({
        appT,
        repo,
        repositories,
        selectedRepoId,
        setActiveProviderId,
        updateRepository,
      });
    },
    [appT, repositories, selectedRepoId, setActiveProviderId, updateRepository]
  );

  const handleDetectRepoProvider = useCallback(
    async (path: string, options?: { silentSuccess?: boolean }) => {
      const { handleDetectRepoProviderRuntime } =
        await loadRepositoryActionsRuntime();
      return await handleDetectRepoProviderRuntime({ appT, path, options });
    },
    [appT]
  );

  const handleScanProjectCandidates = useCallback(
    async (path: string): Promise<ProjectScanCandidates | null> => {
      const { handleScanProjectCandidatesRuntime } =
      await loadRepositoryActionsRuntime();
      return await handleScanProjectCandidatesRuntime(path);
    },
    []
  );

  const handleRefreshRepoBranches = useCallback(
    async (
      path: string,
      options?: { silentSuccess?: boolean }
    ): Promise<RefreshBranchesResult | null> => {
      const { handleRefreshRepoBranchesRuntime } =
        await loadRepositoryActionsRuntime();
      return await handleRefreshRepoBranchesRuntime({ appT, path, options });
    },
    [appT]
  );

  return {
    handleAddRepo,
    handleRemoveRepo,
    handleOpenRepoDirectory,
    handleEditRepo,
    handleDetectRepoProvider,
    handleScanProjectCandidates,
    handleRefreshRepoBranches,
  };
}
