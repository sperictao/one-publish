import { useCallback, useRef, useState } from "react";
import type {
  ProjectScanCandidates,
  ProviderManifest,
} from "@/lib/store/types";
import type { Branch, Repository } from "@/lib/store/types";
import type { AddRepositoryOutcome } from "@/features/repository/useRepositoryActions.runtime";

const loadRepositoryActionsRuntime = () =>
  import("@/features/repository/useRepositoryActions.runtime");

export type { AddRepositoryOutcome };

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
  // 添加流程是「选目录 → 检测 → 扫描分支 → 写库」的长链路，
  // 期间必须让入口可见地进入进行中状态，并禁止并发触发第二次目录选择。
  const [isAddingRepo, setIsAddingRepo] = useState(false);
  const isAddingRepoRef = useRef(false);

  const handleAddRepo = useCallback(async (): Promise<AddRepositoryOutcome> => {
    if (isAddingRepoRef.current) {
      return { status: "cancelled" };
    }

    isAddingRepoRef.current = true;
    setIsAddingRepo(true);

    try {
      const { handleAddRepoRuntime } = await loadRepositoryActionsRuntime();
      return await handleAddRepoRuntime({
        appT,
        providers,
        repositories,
        addRepository,
      });
    } finally {
      isAddingRepoRef.current = false;
      setIsAddingRepo(false);
    }
  }, [addRepository, appT, providers, repositories]);

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
    async (
      path: string,
      providerId?: string
    ): Promise<ProjectScanCandidates | null> => {
      const { handleScanProjectCandidatesRuntime } =
        await loadRepositoryActionsRuntime();
      return await handleScanProjectCandidatesRuntime(path, providerId);
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
    isAddingRepo,
    handleRemoveRepo,
    handleOpenRepoDirectory,
    handleEditRepo,
    handleDetectRepoProvider,
    handleScanProjectCandidates,
    handleRefreshRepoBranches,
  };
}
