import { useEffect, useMemo, useRef, useState } from "react";

import { checkRepositoryBranchConnectivity } from "@/lib/store/api";
import type { Repository } from "@/lib/store/types";

type BranchConnectivityTarget = {
  id: string;
  path: string;
  currentBranch: string;
  signature: string;
};

function buildBranchConnectivityTarget(
  repo: Repository
): BranchConnectivityTarget {
  const currentBranch = repo.currentBranch ?? "";
  return {
    id: repo.id,
    path: repo.path,
    currentBranch,
    signature: `${repo.id}\u0000${repo.path}\u0000${currentBranch}`,
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

  const branchConnectivitySignature = useMemo(() => {
    return branchConnectivityTargets
      .map((target) => target.signature)
      .join("\u0001");
  }, [branchConnectivityTargets]);
  const branchConnectivityTargetsRef = useRef(branchConnectivityTargets);
  branchConnectivityTargetsRef.current = branchConnectivityTargets;
  const cachedBranchSignatureByRepoIdRef = useRef<Record<string, string>>({});
  const cachedBranchConnectivityByRepoIdRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    const connectivityTargets = branchConnectivityTargetsRef.current;
    const cachedSignatures = cachedBranchSignatureByRepoIdRef.current;
    const cachedConnectivity = cachedBranchConnectivityByRepoIdRef.current;
    const nextConnectivityByRepoId: Record<string, boolean> = {};
    const pendingTargets: BranchConnectivityTarget[] = [];

    if (connectivityTargets.length === 0) {
      cachedBranchSignatureByRepoIdRef.current = {};
      cachedBranchConnectivityByRepoIdRef.current = {};
      setBranchConnectivityByRepoId({});
      return;
    }

    for (const target of connectivityTargets) {
      if (
        cachedSignatures[target.id] === target.signature &&
        cachedConnectivity[target.id] !== undefined
      ) {
        nextConnectivityByRepoId[target.id] = cachedConnectivity[target.id];
      } else {
        pendingTargets.push(target);
      }
    }

    setBranchConnectivityByRepoId(nextConnectivityByRepoId);

    if (pendingTargets.length === 0) {
      cachedBranchSignatureByRepoIdRef.current = Object.fromEntries(
        connectivityTargets.map((target) => [target.id, target.signature])
      );
      cachedBranchConnectivityByRepoIdRef.current = nextConnectivityByRepoId;
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
            return [repo.id, repo.signature, result.canConnect] as const;
          } catch {
            return [repo.id, repo.signature, false] as const;
          }
        })
      );

      if (cancelled) {
        return;
      }

      const refreshedConnectivityByRepoId = { ...nextConnectivityByRepoId };
      const refreshedSignatureByRepoId = Object.fromEntries(
        connectivityTargets.map((target) => [target.id, target.signature])
      ) as Record<string, string>;

      for (const [repoId, signature, canConnect] of entries) {
        refreshedConnectivityByRepoId[repoId] = canConnect;
        refreshedSignatureByRepoId[repoId] = signature;
      }

      cachedBranchSignatureByRepoIdRef.current = refreshedSignatureByRepoId;
      cachedBranchConnectivityByRepoIdRef.current = refreshedConnectivityByRepoId;
      setBranchConnectivityByRepoId(refreshedConnectivityByRepoId);
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
