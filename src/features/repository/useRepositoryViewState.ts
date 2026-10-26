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
  useEffect(() => {
    repositoriesRef.current = params.repositories;
  });

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
  // 连通性结果缓存：repoId → 结果与所属 cacheKey，cacheKey 匹配才可结转。
  const [connectivityCache, setConnectivityCache] = useState<
    Record<string, { cacheKey: string; connected: boolean }>
  >({});
  // 扫描 effect 只随 cacheKey 触发；内部经 ref 读最新 targets/cache，
  // 避免外部 rerender 造成重复扫描。
  const branchConnectivityTargetsRef = useRef(branchConnectivityTargets);
  const connectivityCacheRef = useRef(connectivityCache);
  useEffect(() => {
    branchConnectivityTargetsRef.current = branchConnectivityTargets;
    connectivityCacheRef.current = connectivityCache;
  });

  const [prevBranchConnectivityCacheKey, setPrevBranchConnectivityCacheKey] =
    useState(branchConnectivityCacheKey);
  if (prevBranchConnectivityCacheKey !== branchConnectivityCacheKey) {
    setPrevBranchConnectivityCacheKey(branchConnectivityCacheKey);

    if (branchConnectivityTargets.length === 0) {
      setConnectivityCache({});
      setBranchConnectivityByRepoId({});
    } else {
      const nextConnectivityByRepoId: Record<string, boolean> = {};
      for (const target of branchConnectivityTargets) {
        const cached = connectivityCache[target.id];
        if (cached && cached.cacheKey === target.cacheKey) {
          nextConnectivityByRepoId[target.id] = cached.connected;
        }
      }
      setBranchConnectivityByRepoId(nextConnectivityByRepoId);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const connectivityTargets = branchConnectivityTargetsRef.current;
    const currentCache = connectivityCacheRef.current;
    const nextConnectivityByRepoId: Record<string, boolean> = {};
    const pendingTargets: BranchConnectivityTarget[] = [];

    for (const target of connectivityTargets) {
      const cached = currentCache[target.id];
      if (cached && cached.cacheKey === target.cacheKey) {
        nextConnectivityByRepoId[target.id] = cached.connected;
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
      for (const [repoId, , canConnect] of entries) {
        refreshedConnectivityByRepoId[repoId] = canConnect;
      }
      setBranchConnectivityByRepoId(refreshedConnectivityByRepoId);

      const currentTargetIds = new Set(
        connectivityTargets.map((target) => target.id)
      );
      setConnectivityCache((prev) => {
        const next: typeof prev = {};
        // 只保留仍在检查目标内的缓存项，并写入本轮新结果。
        for (const [repoId, entry] of Object.entries(prev)) {
          if (currentTargetIds.has(repoId)) {
            next[repoId] = entry;
          }
        }
        for (const [repoId, cacheKey, canConnect] of entries) {
          next[repoId] = { cacheKey, connected: canConnect };
        }
        return next;
      });
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
