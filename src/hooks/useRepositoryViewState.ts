import { useEffect, useMemo, useRef, useState } from "react";

import { checkRepositoryBranchConnectivity } from "@/lib/store";
import type { Repository } from "@/types/repository";

type BranchConnectivityTarget = {
  id: string;
  path: string;
  currentBranch: string;
};

function buildBranchConnectivitySignature(targets: BranchConnectivityTarget[]) {
  return targets
    .map(
      (target) => `${target.id}\u0000${target.path}\u0000${target.currentBranch}`
    )
    .join("\u0001");
}

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

  const branchConnectivityTargets = useMemo<BranchConnectivityTarget[]>(
    () =>
      params.repositories.map((repo) => ({
        id: repo.id,
        path: repo.path,
        currentBranch: repo.currentBranch ?? "",
      })),
    [params.repositories]
  );

  const branchConnectivitySignature = useMemo(
    () => buildBranchConnectivitySignature(branchConnectivityTargets),
    [branchConnectivityTargets]
  );
  const branchConnectivityTargetsRef = useRef(branchConnectivityTargets);
  branchConnectivityTargetsRef.current = branchConnectivityTargets;

  useEffect(() => {
    let cancelled = false;
    const connectivityTargets = branchConnectivityTargetsRef.current;

    if (connectivityTargets.length === 0) {
      setBranchConnectivityByRepoId({});
      return;
    }

    const checkBranchConnectivity = async () => {
      const entries = await Promise.all(
        connectivityTargets.map(async (repo) => {
          try {
            const result = await checkRepositoryBranchConnectivity(
              repo.path,
              repo.currentBranch || undefined
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
  }, [branchConnectivitySignature]);

  return {
    selectedRepo,
    branchConnectivityByRepoId,
  };
}
