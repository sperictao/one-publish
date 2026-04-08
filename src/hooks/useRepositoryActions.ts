import { useCallback } from "react";
import type { ProviderManifest } from "@/lib/store";
import type { ProjectScanCandidates } from "@/types/project";
import type { Branch, Repository } from "@/types/repository";

const loadRepositoryActionsRuntime = () =>
  import("@/hooks/useRepositoryActions.runtime");

interface TranslationMap {
  [key: string]: string | undefined;
}

interface UseRepositoryActionsParams {
  appT: TranslationMap;
  providers: ProviderManifest[];
  repositories: Repository[];
  selectedRepoId: string | null;
  addRepository: (repo: Repository) => Promise<unknown>;
  removeRepository: (repoId: string) => Promise<unknown>;
  updateRepository: (repo: Repository) => Promise<unknown>;
  applySelectedRepositoryProvider: (providerId?: string | null) => void;
}

interface RefreshBranchesResult {
  branches: Branch[];
  currentBranch: string;
}

export function useRepositoryActions({
  appT,
  providers,
  repositories,
  selectedRepoId,
  addRepository,
  removeRepository,
  updateRepository,
  applySelectedRepositoryProvider,
}: UseRepositoryActionsParams) {
  const handleAddRepo = useCallback(async () => {
    const { handleAddRepoRuntime } = await loadRepositoryActionsRuntime();
    await handleAddRepoRuntime({ appT, providers, addRepository });
  }, [addRepository, appT, providers]);

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
        applySelectedRepositoryProvider,
        updateRepository,
      });
    },
    [
      appT,
      repositories,
      selectedRepoId,
      applySelectedRepositoryProvider,
      updateRepository,
    ]
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
