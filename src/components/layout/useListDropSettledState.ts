import { useCallback, useRef, useState } from "react";
import type {
  PointerListDropTarget,
  PointerListPointer,
} from "./usePointerListReorder";

interface PointerLike {
  x: number;
  y: number;
}

interface PointerListDragEndResult<TMeta> {
  activeItemId: string | null;
  target: PointerListDropTarget<TMeta> | null;
  pointer: PointerListPointer | null;
}

export function useListDropSettledState<TItemId extends string>() {
  const [settledItemId, setSettledItemId] = useState<TItemId | null>(null);
  const settledPointerRef = useRef<PointerListPointer | null>(null);

  const clearSettledItem = useCallback(() => {
    settledPointerRef.current = null;
    setSettledItemId((previousId) => (previousId === null ? previousId : null));
  }, []);

  const setSettledItem = useCallback(
    (itemId: TItemId | null, pointer: PointerListPointer | null) => {
      settledPointerRef.current = itemId ? pointer : null;
      setSettledItemId((previousId) => (previousId === itemId ? previousId : itemId));
    },
    []
  );

  const settleFromDragEnd = useCallback(
    <TMeta>(
      result: PointerListDragEndResult<TMeta>,
      resolveSettledItemId: (activeItemId: string) => TItemId
    ) => {
      setSettledItem(
        result.target && result.activeItemId
          ? resolveSettledItemId(result.activeItemId)
          : null,
        result.pointer
      );
    },
    [setSettledItem]
  );

  const shouldIgnorePointerReentry = useCallback(
    (pointer: PointerLike) => {
      if (!settledItemId || !settledPointerRef.current) {
        return false;
      }

      const dx = Math.abs(pointer.x - settledPointerRef.current.x);
      const dy = Math.abs(pointer.y - settledPointerRef.current.y);
      return dx < 2 && dy < 2;
    },
    [settledItemId]
  );

  return {
    settledItemId,
    clearSettledItem,
    setSettledItem,
    settleFromDragEnd,
    shouldIgnorePointerReentry,
  };
}
