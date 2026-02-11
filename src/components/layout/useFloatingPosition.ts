import { useCallback, useRef, useState } from "react";

export interface FloatingCardRect {
  top: number;
  left: number;
  width: number;
  height: number;
  visible: boolean;
}

export interface FloatingCardRectDraft {
  top: number;
  left: number;
  width: number;
  height: number;
}

export const createHiddenFloatingCardRect = (): FloatingCardRect => ({
  top: 0,
  left: 0,
  width: 0,
  height: 0,
  visible: false,
});

export const hasMeaningfulRectDiff = (
  current: FloatingCardRect | FloatingCardRectDraft,
  next: FloatingCardRect | FloatingCardRectDraft
) =>
  Math.abs(current.left - next.left) > 0.2 ||
  Math.abs(current.top - next.top) > 0.2 ||
  Math.abs(current.width - next.width) > 0.2 ||
  Math.abs(current.height - next.height) > 0.2;

interface UseFloatingPositionOptions {
  isReducedMotionRef: React.MutableRefObject<boolean>;
  rowRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  listRef: React.MutableRefObject<HTMLDivElement | null>;
  onRectCommitted: (nextRect: FloatingCardRectDraft | null, previousRect: FloatingCardRectDraft | null) => void;
}

export function useFloatingPosition({
  isReducedMotionRef,
  rowRefs,
  listRef,
  onRectCommitted,
}: UseFloatingPositionOptions) {
  const [floatingRenderRect, setFloatingRenderRect] = useState<FloatingCardRect>(
    createHiddenFloatingCardRect
  );
  const [isFloatingAnimating, setIsFloatingAnimating] = useState(false);

  const previousFloatingRectRef = useRef<FloatingCardRectDraft | null>(null);
  const floatingTargetRectRef = useRef<FloatingCardRect>(createHiddenFloatingCardRect());
  const floatingRenderRectRef = useRef<FloatingCardRect>(createHiddenFloatingCardRect());
  const floatingFollowRafRef = useRef<number | null>(null);
  const floatingFollowTimestampRef = useRef<number | null>(null);
  const floatingAnimatingRef = useRef(false);
  const isPointerFollowingRef = useRef(false);

  const setFloatingAnimating = useCallback((next: boolean) => {
    if (floatingAnimatingRef.current === next) {
      return;
    }
    floatingAnimatingRef.current = next;
    setIsFloatingAnimating(next);
  }, []);

  const startFloatingCardFollow = useCallback(() => {
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      const currentTarget = floatingTargetRectRef.current;
      floatingRenderRectRef.current = currentTarget;
      setFloatingRenderRect(currentTarget);
      floatingFollowTimestampRef.current = null;
      setFloatingAnimating(false);
      return;
    }

    if (floatingFollowRafRef.current !== null) {
      return;
    }

    const step = (timestamp: number) => {
      const target = floatingTargetRectRef.current;
      const current = floatingRenderRectRef.current;

      if (!target.visible) {
        if (current.visible) {
          const hidden = createHiddenFloatingCardRect();
          floatingRenderRectRef.current = hidden;
          setFloatingRenderRect(hidden);
        }
        floatingFollowRafRef.current = null;
        floatingFollowTimestampRef.current = null;
        setFloatingAnimating(false);
        return;
      }
      const previousTimestamp = floatingFollowTimestampRef.current ?? timestamp;
      const elapsed = Math.min(100, Math.max(1, timestamp - previousTimestamp));
      floatingFollowTimestampRef.current = timestamp;

      const deltaX = target.left - current.left;
      const deltaY = target.top - current.top;
      const travelDistance = Math.hypot(deltaX, deltaY);

      const dynamicFollowRate = (() => {
        if (isReducedMotionRef.current) return 1;
        if (travelDistance > 220) return 0.96;
        if (travelDistance > 140) return 0.90;
        if (travelDistance > 80) return 0.82;
        return 0.72;
      })();

      const frameCompensation = Math.max(1, elapsed / 16.67);
      const smoothing = 1 - Math.pow(1 - dynamicFollowRate, frameCompensation);
      const nextLeft = current.visible
        ? current.left + (target.left - current.left) * smoothing
        : target.left;
      const nextTop = current.visible
        ? current.top + (target.top - current.top) * smoothing
        : target.top;

      const sizeDelta = Math.max(
        Math.abs(target.width - current.width),
        Math.abs(target.height - current.height)
      );
      const dynamicSizeRate = isReducedMotionRef.current
        ? 1
        : sizeDelta > 26 ? 0.88 : sizeDelta > 10 ? 0.78 : 0.66;
      const sizeSmoothing = 1 - Math.pow(1 - dynamicSizeRate, frameCompensation);
      const nextWidth = current.visible
        ? current.width + (target.width - current.width) * sizeSmoothing
        : target.width;
      const nextHeight = current.visible
        ? current.height + (target.height - current.height) * sizeSmoothing
        : target.height;

      const hasConverged =
        Math.abs(target.left - nextLeft) < 0.15 &&
        Math.abs(target.top - nextTop) < 0.15 &&
        Math.abs(target.width - nextWidth) < 0.15 &&
        Math.abs(target.height - nextHeight) < 0.15;

      const nextRect: FloatingCardRect = hasConverged
        ? { left: target.left, top: target.top, width: target.width, height: target.height, visible: true }
        : { left: nextLeft, top: nextTop, width: nextWidth, height: nextHeight, visible: true };

      floatingRenderRectRef.current = nextRect;
      setFloatingRenderRect((prev) => {
        const same =
          prev.visible === nextRect.visible &&
          Math.abs(prev.left - nextRect.left) < 0.01 &&
          Math.abs(prev.top - nextRect.top) < 0.01 &&
          Math.abs(prev.width - nextRect.width) < 0.01 &&
          Math.abs(prev.height - nextRect.height) < 0.01;
        return same ? prev : nextRect;
      });

      if (hasConverged) {
        floatingFollowRafRef.current = null;
        floatingFollowTimestampRef.current = null;
        setFloatingAnimating(false);
        return;
      }

      setFloatingAnimating(true);
      floatingFollowRafRef.current = window.requestAnimationFrame(step);
    };

    setFloatingAnimating(true);
    floatingFollowRafRef.current = window.requestAnimationFrame(step);
  }, [setFloatingAnimating]);

  const commitFloatingRect = useCallback(
    (nextRect: FloatingCardRectDraft | null) => {
      if (!nextRect) {
        const prev = previousFloatingRectRef.current;
        previousFloatingRectRef.current = null;
        const hiddenRect = createHiddenFloatingCardRect();
        floatingTargetRectRef.current = hiddenRect;
        startFloatingCardFollow();
        onRectCommitted(null, prev);
        setFloatingAnimating(false);
        return;
      }

      const previousRect = previousFloatingRectRef.current;
      previousFloatingRectRef.current = nextRect;

      onRectCommitted(nextRect, previousRect);

      const nextFloatingRect: FloatingCardRect = {
        top: nextRect.top,
        left: nextRect.left,
        width: nextRect.width,
        height: nextRect.height,
        visible: true,
      };

      const currentTarget = floatingTargetRectRef.current;
      const targetChanged =
        !currentTarget.visible || hasMeaningfulRectDiff(currentTarget, nextFloatingRect);

      floatingTargetRectRef.current = nextFloatingRect;

      if (targetChanged) {
        setFloatingAnimating(true);
      }

      startFloatingCardFollow();
    },
    [onRectCommitted, setFloatingAnimating, startFloatingCardFollow]
  );

  const updateFloatingRect = useCallback(
    (targetRepoId: string | null) => {
      if (!targetRepoId) {
        commitFloatingRect(null);
        return;
      }

      const rowElement = rowRefs.current[targetRepoId];
      if (!rowElement) {
        commitFloatingRect(null);
        return;
      }

      commitFloatingRect({
        top: rowElement.offsetTop,
        left: rowElement.offsetLeft,
        width: rowElement.offsetWidth,
        height: rowElement.offsetHeight,
      });
    },
    [commitFloatingRect, rowRefs]
  );

  const commitPointerFollowY = useCallback(
    (pointerY: number, repoId: string) => {
      const rowElement = rowRefs.current[repoId];
      if (!rowElement) return;

      const rowHeight = rowElement.offsetHeight;
      const rowLeft = rowElement.offsetLeft;
      const rowWidth = rowElement.offsetWidth;

      let top = pointerY - rowHeight / 2;

      // Clamp to list bounds
      const listElement = listRef.current;
      if (listElement) {
        const maxTop = listElement.scrollHeight - rowHeight;
        top = Math.max(0, Math.min(maxTop, top));
      } else {
        top = Math.max(0, top);
      }

      // Keep previousFloatingRectRef aligned with the row rect
      // so dynamics compute correct transitions on snap-to-row
      previousFloatingRectRef.current = {
        top: rowElement.offsetTop,
        left: rowLeft,
        width: rowWidth,
        height: rowHeight,
      };

      floatingTargetRectRef.current = {
        top,
        left: rowLeft,
        width: rowWidth,
        height: rowHeight,
        visible: true,
      };

      isPointerFollowingRef.current = true;
      startFloatingCardFollow();
    },
    [listRef, rowRefs, startFloatingCardFollow]
  );

  const cancelFollow = useCallback(() => {
    if (
      floatingFollowRafRef.current !== null &&
      typeof window !== "undefined" &&
      typeof window.cancelAnimationFrame === "function"
    ) {
      window.cancelAnimationFrame(floatingFollowRafRef.current);
      floatingFollowRafRef.current = null;
      setFloatingAnimating(false);
    }
  }, [setFloatingAnimating]);

  return {
    floatingRenderRect,
    isFloatingAnimating,
    updateFloatingRect,
    commitPointerFollowY,
    isPointerFollowingRef,
    cancelFollow,
    setFloatingAnimating,
    floatingFollowRafRef,
  };
}
