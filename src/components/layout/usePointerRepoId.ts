import { useCallback, useRef } from "react";

interface UsePointerRepoIdOptions {
  filteredRepoIds: string[];
  rowRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
}

/**
 * Resolves a pointer event target to the corresponding repo ID,
 * with fallback to nearest-by-Y matching.
 */
export function usePointerRepoId({
  filteredRepoIds,
  rowRefs,
}: UsePointerRepoIdOptions) {
  const hoveredRepoIdRef = useRef<string | null>(null);
  const lastHoveredRepoIdRef = useRef<string | null>(null);

  const resolvePointerRepoId = useCallback((target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) {
      return null;
    }

    const rowElement = target.closest<HTMLElement>(
      "[data-repo-row='true'][data-repo-id]"
    );

    return rowElement?.dataset.repoId ?? null;
  }, []);

  const resolveNearestRepoIdByPointerY = useCallback(
    (pointerY: number) => {
      if (filteredRepoIds.length === 0) {
        return null;
      }

      let nextRepoId: string | null = null;
      let nearestDistance = Number.POSITIVE_INFINITY;

      for (const repoId of filteredRepoIds) {
        const rowElement = rowRefs.current[repoId];
        if (!rowElement) {
          continue;
        }
        const rowCenterY = rowElement.offsetTop + rowElement.offsetHeight / 2;
        const distance = Math.abs(pointerY - rowCenterY);

        if (distance < nearestDistance) {
          nearestDistance = distance;
          nextRepoId = repoId;
        }
      }

      return nextRepoId;
    },
    [filteredRepoIds, rowRefs]
  );

  return {
    hoveredRepoIdRef,
    lastHoveredRepoIdRef,
    resolvePointerRepoId,
    resolveNearestRepoIdByPointerY,
  };
}