import { useCallback, useLayoutEffect, useRef } from "react";
import { useReducedMotion } from "./useReducedMotion";

const MOTION_DURATION_MS = 160;
const MOTION_EASING = "cubic-bezier(0.22,1,0.36,1)";

export function useListReorderMotion(params: {
  orderedIds: readonly string[];
  draggingItemId: string | null;
}) {
  const { orderedIds, draggingItemId } = params;
  const reducedMotionRef = useReducedMotion();
  const itemRefs = useRef<Record<string, HTMLElement | null>>({});
  const previousRectsRef = useRef<Record<string, DOMRect>>({});
  const orderedIdsSignature = orderedIds.join("|");

  const setItemRef = useCallback(
    (itemId: string) => (node: HTMLElement | null) => {
      if (node) {
        itemRefs.current[itemId] = node;
        return;
      }

      delete itemRefs.current[itemId];
    },
    []
  );

  useLayoutEffect(() => {
    const nextRects: Record<string, DOMRect> = {};

    for (const itemId of orderedIds) {
      const node = itemRefs.current[itemId];
      if (!node) {
        continue;
      }

      const visualRect = node.getBoundingClientRect();
      const animations = node.getAnimations?.() ?? [];
      for (const animation of animations) {
        animation.cancel();
      }

      const layoutRect = node.getBoundingClientRect();
      nextRects[itemId] = layoutRect;

      if (
        reducedMotionRef.current ||
        !node.animate ||
        draggingItemId === itemId
      ) {
        continue;
      }

      const previousRect = previousRectsRef.current[itemId];
      const startTop =
        animations.length > 0 ? visualRect.top : previousRect?.top ?? layoutRect.top;
      const deltaY = startTop - layoutRect.top;

      if (Math.abs(deltaY) < 0.5) {
        continue;
      }

      node.animate(
        [
          { transform: `translate3d(0, ${deltaY}px, 0)` },
          { transform: "translate3d(0, 0, 0)" },
        ],
        {
          duration: MOTION_DURATION_MS,
          easing: MOTION_EASING,
        }
      );
    }

    previousRectsRef.current = nextRects;
  }, [draggingItemId, orderedIdsSignature, reducedMotionRef]);

  return {
    setItemRef,
  };
}
