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
  floatingCardMotionRef: React.MutableRefObject<HTMLDivElement | null>;
  rectInsetX?: number;
  onRectCommitted: (nextRect: FloatingCardRectDraft | null, previousRect: FloatingCardRectDraft | null) => void;
}

interface UpdateFloatingRectOptions {
  ignoreTransforms?: boolean;
  immediate?: boolean;
}

function resolveOffsetWithinAncestor(
  element: HTMLElement,
  ancestor: HTMLElement
): { top: number; left: number } | null {
  let top = 0;
  let left = 0;
  let current: HTMLElement | null = element;

  while (current && current !== ancestor) {
    top += current.offsetTop;
    left += current.offsetLeft;

    const nextOffsetParent: Element | null = current.offsetParent;
    if (!(nextOffsetParent instanceof HTMLElement)) {
      return null;
    }

    current = nextOffsetParent;
  }

  if (current !== ancestor) {
    return null;
  }

  return { top, left };
}

export function useFloatingPosition({
  isReducedMotionRef,
  rowRefs,
  listRef,
  floatingCardMotionRef,
  rectInsetX = 0,
  onRectCommitted,
}: UseFloatingPositionOptions) {
  // 帧级 rect 跟随经 ref 直写 DOM；React state 仅承载低频的可见性切换
  const [floatingVisible, setFloatingVisible] = useState(false);

  const previousFloatingRectRef = useRef<FloatingCardRectDraft | null>(null);
  const floatingTargetRectRef = useRef<FloatingCardRect>(createHiddenFloatingCardRect());
  const floatingRenderRectRef = useRef<FloatingCardRect>(createHiddenFloatingCardRect());
  const floatingFollowRafRef = useRef<number | null>(null);
  const floatingFollowTimestampRef = useRef<number | null>(null);
  const floatingAnimatingRef = useRef(false);
  const isPointerFollowingRef = useRef(false);

  const writeRectToDom = useCallback(
    (rect: FloatingCardRect) => {
      const element = floatingCardMotionRef.current;
      if (!element) {
        return;
      }
      element.style.width = `${rect.width}px`;
      element.style.height = `${rect.height}px`;
      // tilt 变量由 useFloatingDynamics 直写，transform 经 var() 组合两者
      element.style.transform =
        `perspective(900px) translate3d(${rect.left}px, ${rect.top}px, 0) ` +
        "rotateX(var(--fc-tilt-x, 0deg)) rotateY(var(--fc-tilt-y, 0deg))";
    },
    [floatingCardMotionRef]
  );

  const commitRenderRect = useCallback(
    (rect: FloatingCardRect) => {
      floatingRenderRectRef.current = rect;
      writeRectToDom(rect);
      setFloatingVisible(rect.visible);
    },
    [writeRectToDom]
  );

  const setFloatingAnimating = useCallback(
    (next: boolean) => {
      if (floatingAnimatingRef.current === next) {
        return;
      }
      floatingAnimatingRef.current = next;
      const element = floatingCardMotionRef.current;
      if (element) {
        element.style.willChange = next ? "transform,width,height" : "";
      }
    },
    [floatingCardMotionRef]
  );

  const getRowRectDraft = useCallback(
    (
      rowElement: HTMLDivElement,
      options?: { ignoreTransforms?: boolean }
    ): FloatingCardRectDraft => {
      const listElement = listRef.current;
      const rowWidth = rowElement.offsetWidth;
      const rowHeight = rowElement.offsetHeight;
      const insetX = Math.max(0, Math.min(rectInsetX, rowWidth / 2));

      if (listElement) {
        if (options?.ignoreTransforms) {
          const layoutOffset = resolveOffsetWithinAncestor(rowElement, listElement);

          if (layoutOffset) {
            return {
              top: layoutOffset.top,
              left: layoutOffset.left + insetX,
              width: Math.max(0, rowWidth - insetX * 2),
              height: rowHeight,
            };
          }
        }

        const rowRect = rowElement.getBoundingClientRect();
        const listRect = listElement.getBoundingClientRect();

        return {
          top: rowRect.top - listRect.top + listElement.scrollTop,
          left: rowRect.left - listRect.left + listElement.scrollLeft + insetX,
          width: Math.max(0, rowRect.width - insetX * 2),
          height: rowRect.height,
        };
      }

      return {
        top: rowElement.offsetTop,
        left: rowElement.offsetLeft + insetX,
        width: Math.max(0, rowWidth - insetX * 2),
        height: rowHeight,
      };
    },
    [listRef, rectInsetX]
  );

  const startFloatingCardFollow = useCallback(() => {
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      commitRenderRect(floatingTargetRectRef.current);
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
          commitRenderRect(createHiddenFloatingCardRect());
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

      commitRenderRect(nextRect);

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
  }, [commitRenderRect, isReducedMotionRef, setFloatingAnimating]);

  const commitFloatingRect = useCallback(
    (
      nextRect: FloatingCardRectDraft | null,
      options?: { immediate?: boolean }
    ) => {
      if (!nextRect) {
        const prev = previousFloatingRectRef.current;
        previousFloatingRectRef.current = null;
        floatingTargetRectRef.current = createHiddenFloatingCardRect();
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

      if (options?.immediate) {
        commitRenderRect(nextFloatingRect);
        floatingFollowTimestampRef.current = null;
        if (
          floatingFollowRafRef.current !== null &&
          typeof window !== "undefined" &&
          typeof window.cancelAnimationFrame === "function"
        ) {
          window.cancelAnimationFrame(floatingFollowRafRef.current);
          floatingFollowRafRef.current = null;
        }
        setFloatingAnimating(false);
        return;
      }

      if (targetChanged) {
        setFloatingAnimating(true);
      }

      startFloatingCardFollow();
    },
    [commitRenderRect, floatingFollowRafRef, onRectCommitted, setFloatingAnimating, startFloatingCardFollow]
  );

  const updateFloatingRect = useCallback(
    (
      targetRepoId: string | null,
      options?: UpdateFloatingRectOptions
    ) => {
      if (!targetRepoId) {
        commitFloatingRect(null);
        return;
      }

      const rowElement = rowRefs.current[targetRepoId];
      if (!rowElement) {
        commitFloatingRect(null);
        return;
      }

      commitFloatingRect(getRowRectDraft(rowElement, options), {
        immediate: options?.immediate,
      });
    },
    [commitFloatingRect, getRowRectDraft, rowRefs]
  );

  const commitPointerFollowY = useCallback(
    (pointerY: number, repoId: string) => {
      const rowElement = rowRefs.current[repoId];
      if (!rowElement) return;

      const rowRect = getRowRectDraft(rowElement);
      const rowHeight = rowRect.height;
      const rowLeft = rowRect.left;
      const rowWidth = rowRect.width;

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
      previousFloatingRectRef.current = rowRect;

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
    [getRowRectDraft, listRef, rowRefs, startFloatingCardFollow]
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
    floatingVisible,
    updateFloatingRect,
    commitPointerFollowY,
    isPointerFollowingRef,
    cancelFollow,
    setFloatingAnimating,
    floatingFollowRafRef,
  };
}
