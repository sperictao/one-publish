import { useEffect, useMemo, useRef, useState } from "react";

import { checkRepositoryBranchConnectivity } from "@/lib/store/api";
import type { Repository } from "@/lib/store/types";

type BranchConnectivityTarget = {
  id: string;
  path: string;
  currentBranch: string;
  cacheKey: string;
};

function buildBranchConnectivityTarget(
  repo: Repository
): BranchConnectivityTarget {
  const currentBranch = repo.currentBranch ?? "";
  return {
    id: repo.id,
    path: repo.path,
    currentBranch,
    cacheKey: `${repo.id}\u0000${repo.path}\u0000${currentBranch}`,
  };
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
    () => params.repositories.map(buildBranchConnectivityTarget),
    [params.repositories]
  );

  const branchConnectivityCacheKey = useMemo(() => {
    return branchConnectivityTargets
      .map((target) => target.cacheKey)
      .join("\u0001");
  }, [branchConnectivityTargets]);
  const branchConnectivityTargetsRef = useRef(branchConnectivityTargets);
  branchConnectivityTargetsRef.current = branchConnectivityTargets;
  const cachedBranchCacheKeyByRepoIdRef = useRef<Record<string, string>>({});
  const cachedBranchConnectivityByRepoIdRef = useRef<Record<string, boolean>>({});

  const prevBranchConnectivityCacheKeyRef = useRef(branchConnectivityCacheKey);
  if (prevBranchConnectivityCacheKeyRef.current !== branchConnectivityCacheKey) {
    prevBranchConnectivityCacheKeyRef.current = branchConnectivityCacheKey;

    const connectivityTargets = branchConnectivityTargetsRef.current;
    const cachedCacheKeys = cachedBranchCacheKeyByRepoIdRef.current;
    const cachedConnectivity = cachedBranchConnectivityByRepoIdRef.current;

    if (connectivityTargets.length === 0) {
      cachedBranchCacheKeyByRepoIdRef.current = {};
      cachedBranchConnectivityByRepoIdRef.current = {};
      setBranchConnectivityByRepoId({});
    } else {
      const nextConnectivityByRepoId: Record<string, boolean> = {};
      for (const target of connectivityTargets) {
        if (
          cachedCacheKeys[target.id] === target.cacheKey &&
          cachedConnectivity[target.id] !== undefined
        ) {
          nextConnectivityByRepoId[target.id] = cachedConnectivity[target.id];
        }
      }
      setBranchConnectivityByRepoId(nextConnectivityByRepoId);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const connectivityTargets = branchConnectivityTargetsRef.current;
    const cachedCacheKeys = cachedBranchCacheKeyByRepoIdRef.current;
    const cachedConnectivity = cachedBranchConnectivityByRepoIdRef.current;
    const nextConnectivityByRepoId: Record<string, boolean> = {};
    const pendingTargets: BranchConnectivityTarget[] = [];

    for (const target of connectivityTargets) {
      if (
        cachedCacheKeys[target.id] === target.cacheKey &&
        cachedConnectivity[target.id] !== undefined
      ) {
        nextConnectivityByRepoId[target.id] = cachedConnectivity[target.id];
      } else {
        pendingTargets.push(target);
      }
    }

    if (pendingTargets.length === 0) {
      return;
    }

    const checkBranchConnectivity = async () => {
      const entries = await Promise.all(
        pendingTargets.map(async (repo) => {
          try {
            const result = await checkRepositoryBranchConnectivity(
              repo.path,
              repo.currentBranch || undefined
            );
            return [repo.id, repo.cacheKey, result.canConnect] as const;
          } catch {
            return [repo.id, repo.cacheKey, false] as const;
          }
        })
      );

      if (cancelled) {
        return;
      }

      const refreshedConnectivityByRepoId = { ...nextConnectivityByRepoId };
      const refreshedCacheKeyByRepoId = Object.fromEntries(
        connectivityTargets.map((target) => [target.id, target.cacheKey])
      ) as Record<string, string>;

      for (const [repoId, cacheKey, canConnect] of entries) {
        refreshedConnectivityByRepoId[repoId] = canConnect;
        refreshedCacheKeyByRepoId[repoId] = cacheKey;
      }

      cachedBranchCacheKeyByRepoIdRef.current = refreshedCacheKeyByRepoId;
      cachedBranchConnectivityByRepoIdRef.current = refreshedConnectivityByRepoId;
      setBranchConnectivityByRepoId(refreshedConnectivityByRepoId);
    };

    void checkBranchConnectivity();

    return () => {
      cancelled = true;
    };
  }, [branchConnectivityCacheKey]);

  return {
    selectedRepo,
    branchConnectivityByRepoId,
  };
}
