import { useEffect, useMemo, useRef, useState } from "react";

import {
  checkRepositoryBranchConnectivity,
  scanRepositoryBranches,
} from "@/lib/store/api";
import type { Repository } from "@/lib/store/types";

type BranchConnectivityTarget = {
  id: string;
  path: string;
  currentBranch: string;
  cacheKey: string;
};

// 窗口频繁切换焦点时限制实际分支重扫的最小间隔
const ACTUAL_BRANCH_RESCAN_MIN_INTERVAL_MS = 5000;

function buildBranchConnectivityTarget(
  repo: Repository,
  actualBranch: string | undefined
): BranchConnectivityTarget | null {
  // 实际分支尚未扫描完成时暂不检查连通性，避免用过期的存量分支多查一轮
  if (actualBranch === undefined) {
    return null;
  }

  const currentBranch = actualBranch || repo.currentBranch || "";
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
  const [actualBranchByRepoId, setActualBranchByRepoId] = useState<
    Record<string, string>
  >({});

  const selectedRepo = useMemo(
    () =>
      params.repositories.find((repo) => repo.id === params.selectedRepoId) ||
      null,
    [params.repositories, params.selectedRepoId]
  );

  const repositoriesRef = useRef(params.repositories);
  repositoriesRef.current = params.repositories;

  // 仅当仓库集合（id + 路径）变化时重新扫描实际分支
  const actualBranchScanKey = useMemo(
    () =>
      params.repositories
        .map((repo) => `${repo.id}\u0000${repo.path}`)
        .join("\u0001"),
    [params.repositories]
  );
  const lastActualBranchScanAtRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const scanActualBranches = async () => {
      lastActualBranchScanAtRef.current = Date.now();
      const entries = await Promise.all(
        repositoriesRef.current.map(async (repo) => {
          try {
            const result = await scanRepositoryBranches(repo.path, {
              refreshRemote: false,
            });
            return [repo.id, result.current_branch.trim()] as const;
          } catch {
            return [repo.id, ""] as const;
          }
        })
      );

      if (cancelled) {
        return;
      }

      setActualBranchByRepoId((prev) => {
        const unchanged =
          Object.keys(prev).length === entries.length &&
          entries.every(([repoId, branch]) => prev[repoId] === branch);
        return unchanged ? prev : Object.fromEntries(entries);
      });
    };

    void scanActualBranches();

    // 窗口重新获得焦点时刷新，捕捉用户在外部切换分支的变化
    const handleWindowFocus = () => {
      if (
        Date.now() - lastActualBranchScanAtRef.current <
        ACTUAL_BRANCH_RESCAN_MIN_INTERVAL_MS
      ) {
        return;
      }
      void scanActualBranches();
    };

    window.addEventListener("focus", handleWindowFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [actualBranchScanKey]);

  const branchConnectivityTargets = useMemo<BranchConnectivityTarget[]>(
    () =>
      params.repositories
        .map((repo) =>
          buildBranchConnectivityTarget(repo, actualBranchByRepoId[repo.id])
        )
        .filter(
          (target): target is BranchConnectivityTarget => target !== null
        ),
    [params.repositories, actualBranchByRepoId]
  );

  const branchConnectivityCacheKey = useMemo(() => {
    return branchConnectivityTargets
      .map((target) => target.cacheKey)
      .join("\u0001");
  }, [branchConnectivityTargets]);
  const branchConnectivityTargetsRef = useRef(branchConnectivityTargets);
  branchConnectivityTargetsRef.current = branchConnectivityTargets;
  const cachedBranchCacheKeyByRepoIdRef = useRef<Record<string, string>>({});
  const cachedBranchConnectivityByRepoIdRef = useRef<Record<string, boolean>>(
    {}
  );

  const prevBranchConnectivityCacheKeyRef = useRef(branchConnectivityCacheKey);
  if (
    prevBranchConnectivityCacheKeyRef.current !== branchConnectivityCacheKey
  ) {
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
      cachedBranchConnectivityByRepoIdRef.current =
        refreshedConnectivityByRepoId;
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
    actualBranchByRepoId,
  };
}
