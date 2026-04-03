import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useReducedMotion } from "./useReducedMotion";

const MIN_MOTION_DURATION_MS = 150;
const MAX_MOTION_DURATION_MS = 230;
const MOTION_EASING = "cubic-bezier(0.22,1,0.36,1)";

function resolveReorderDuration(distance: number) {
  const clampedDistance = Math.max(0, Math.min(140, distance));
  const normalizedDistance = clampedDistance / 140;
  return Math.round(
    MIN_MOTION_DURATION_MS +
      (MAX_MOTION_DURATION_MS - MIN_MOTION_DURATION_MS) *
        Math.sqrt(normalizedDistance)
  );
}

export function useListReorderMotion(params: {
  orderedIds: readonly string[];
  draggingItemId: string | null;
  settledItemId?: string | null;
}) {
  const { orderedIds, draggingItemId, settledItemId = null } = params;
  const reducedMotionRef = useReducedMotion();
  const itemRefs = useRef<Record<string, HTMLElement | null>>({});
  const previousRectsRef = useRef<Record<string, DOMRect>>({});
  const animationRefs = useRef<Record<string, Animation | null>>({});
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

      const activeAnimation = animationRefs.current[itemId];
      const visualRect = activeAnimation ? node.getBoundingClientRect() : null;
      activeAnimation?.cancel();
      animationRefs.current[itemId] = null;

      const layoutRect = node.getBoundingClientRect();
      nextRects[itemId] = layoutRect;

      if (
        reducedMotionRef.current ||
        !node.animate ||
        draggingItemId === itemId ||
        settledItemId === itemId
      ) {
        continue;
      }

      const previousRect = previousRectsRef.current[itemId];
      const startTop =
        visualRect?.top ?? previousRect?.top ?? layoutRect.top;
      const deltaY = startTop - layoutRect.top;

      if (Math.abs(deltaY) < 0.5) {
        continue;
      }

      const animation = node.animate(
        [
          { transform: `translate3d(0, ${deltaY}px, 0)` },
          { transform: "translate3d(0, 0, 0)" },
        ],
        {
          duration: resolveReorderDuration(Math.abs(deltaY)),
          easing: MOTION_EASING,
          fill: "both",
        }
      );
      animationRefs.current[itemId] = animation;

      const clearAnimationRef = () => {
        if (animationRefs.current[itemId] === animation) {
          animationRefs.current[itemId] = null;
        }
      };

      if (typeof animation.addEventListener === "function") {
        animation.addEventListener("finish", clearAnimationRef, { once: true });
        animation.addEventListener("cancel", clearAnimationRef, { once: true });
      } else {
        animation.onfinish = clearAnimationRef;
        animation.oncancel = clearAnimationRef;
      }
    }

    previousRectsRef.current = nextRects;
  }, [draggingItemId, orderedIdsSignature, reducedMotionRef, settledItemId]);

  useEffect(() => {
    return () => {
      for (const animation of Object.values(animationRefs.current)) {
        animation?.cancel();
      }
      animationRefs.current = {};
    };
  }, []);

  return {
    setItemRef,
  };
}
