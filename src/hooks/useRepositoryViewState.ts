import { useEffect, useMemo, useState } from "react";

import { checkRepositoryBranchConnectivity } from "@/lib/store";
import type { Repository } from "@/types/repository";

export function useRepositoryViewState(params: {
  repositories: Repository[];
  selectedRepoId: string | null;
}) {
  const [branchConnectivityByRepoId, setBranchConnectivityByRepoId] = useState<
    Record<string, boolean>
  >({});

  const selectedRepo = useMemo(
    () => params.repositories.find((repo) => repo.id === params.selectedRepoId) || null,
    [params.repositories, params.selectedRepoId]
  );

  useEffect(() => {
    let cancelled = false;

    if (params.repositories.length === 0) {
      setBranchConnectivityByRepoId({});
      return;
    }

    const checkBranchConnectivity = async () => {
      const entries = await Promise.all(
        params.repositories.map(async (repo) => {
          try {
            const result = await checkRepositoryBranchConnectivity(
              repo.path,
              repo.currentBranch
            );
            return [repo.id, result.canConnect] as const;
          } catch {
            return [repo.id, false] as const;
          }
        })
      );

      if (cancelled) {
        return;
      }

      setBranchConnectivityByRepoId(
        Object.fromEntries(entries) as Record<string, boolean>
      );
    };

    void checkBranchConnectivity();

    return () => {
      cancelled = true;
    };
  }, [params.repositories]);

  return {
    selectedRepo,
    branchConnectivityByRepoId,
  };
}
