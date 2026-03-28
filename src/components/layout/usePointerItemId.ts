import { useCallback } from "react";

interface UsePointerItemIdOptions {
  filteredItemIds: string[];
  rowRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
}

/**
 * Resolves a pointer event target to the corresponding item ID,
 * with fallback to nearest-by-Y matching.
 */
export function usePointerItemId({
  filteredItemIds,
  rowRefs,
}: UsePointerItemIdOptions) {
  const resolvePointerItemId = useCallback((target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) {
      return null;
    }

    const rowElement = target.closest<HTMLElement>(
      "[data-list-row='true'][data-list-item-id]"
    );

    return rowElement?.dataset.listItemId ?? null;
  }, []);

  const resolveNearestItemIdByPointerY = useCallback(
    (pointerY: number) => {
      if (filteredItemIds.length === 0) {
        return null;
      }

      let nextItemId: string | null = null;
      let nearestDistance = Number.POSITIVE_INFINITY;

      for (const itemId of filteredItemIds) {
        const rowElement = rowRefs.current[itemId];
        if (!rowElement) {
          continue;
        }
        const rowCenterY = rowElement.offsetTop + rowElement.offsetHeight / 2;
        const distance = Math.abs(pointerY - rowCenterY);

        if (distance < nearestDistance) {
          nearestDistance = distance;
          nextItemId = itemId;
        }
      }

      return nextItemId;
    },
    [filteredItemIds, rowRefs]
  );

  return {
    resolvePointerItemId,
    resolveNearestItemIdByPointerY,
  };
}
