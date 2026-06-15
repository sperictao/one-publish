import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useReducedMotion } from "./useReducedMotion";
import { usePointerItemId } from "./usePointerItemId";
import { useFloatingPosition } from "./useFloatingPosition";
import { useFloatingDynamics } from "./useFloatingDynamics";

interface UseFloatingListCardOptions {
  filteredItemIds: string[];
  targetItemId: string | null;
  restingTargetItemId: string | null;
  selectedItemId: string | null;
  snapTargetItemId?: string | null;
  draggingItemId?: string | null;
  freezeFloating: boolean;
  onListPointerEnter: () => void;
  onListPointerLeave: () => void;
  onPointerItemChange: (itemId: string | null) => void;
  preserveHoverOnGap?: boolean;
}

export interface FloatingListCardResult {
  listRef: React.MutableRefObject<HTMLDivElement | null>;
  floatingCardMotionRef: React.MutableRefObject<HTMLDivElement | null>;
  floatingCardSurfaceRef: React.MutableRefObject<HTMLDivElement | null>;
  cardTargetItemId: string | null;
  floatingVisible: boolean;
  setItemRowRef: (itemId: string) => (node: HTMLDivElement | null) => void;
  handleListPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleListPointerEnter: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleListPointerLeave: () => void;
  handleListScroll: () => void;
}

export function useFloatingListCard({
  filteredItemIds,
  targetItemId,
  restingTargetItemId,
  selectedItemId,
  snapTargetItemId = null,
  draggingItemId = null,
  freezeFloating,
  onListPointerEnter,
  onListPointerLeave,
  onPointerItemChange,
  preserveHoverOnGap = false,
}: UseFloatingListCardOptions): FloatingListCardResult {
  const listRef = useRef<HTMLDivElement | null>(null);
  const floatingCardMotionRef = useRef<HTMLDivElement | null>(null);
  const floatingCardSurfaceRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const cardTargetItemIdRef = useRef<string | null>(null);
  const activePointerItemIdRef = useRef<string | null>(null);
  const previousTargetItemIdRef = useRef<string | null>(null);
  const previousDraggingItemIdRef = useRef<string | null>(draggingItemId);

  const isReducedMotionRef = useReducedMotion();

  const { resolvePointerItemId, resolveNearestItemIdByPointerY } =
    usePointerItemId({ filteredItemIds, rowRefs });

  const {
    applyDynamics,
    startSelectedGlowDecay,
    triggerSelectedBounce,
    updateHighlight,
    cleanupDynamics,
  } = useFloatingDynamics({
    isReducedMotionRef,
    floatingCardSurfaceRef,
    floatingCardMotionRef,
  });

  const {
    floatingVisible,
    updateFloatingRect,
    commitPointerFollowY,
    isPointerFollowingRef,
    cancelFollow,
    setFloatingAnimating,
    floatingFollowRafRef,
  } = useFloatingPosition({
    isReducedMotionRef,
    rowRefs,
    listRef,
    floatingCardMotionRef,
    onRectCommitted: applyDynamics,
  });

  const filteredItemIdsSignature = useMemo(
    () => filteredItemIds.join("|"),
    [filteredItemIds]
  );
  const updateTargetRect = useCallback(
    (itemId: string | null, options?: { immediate?: boolean }) => {
      const isDraggingTarget =
        freezeFloating && draggingItemId !== null && itemId === draggingItemId;

      updateFloatingRect(itemId, {
        ignoreTransforms: isDraggingTarget,
        immediate: options?.immediate ?? isDraggingTarget,
      });
    },
    [draggingItemId, freezeFloating, updateFloatingRect]
  );

  const setItemRowRef = useCallback(
    (itemId: string) => (node: HTMLDivElement | null) => {
      if (node) {
        rowRefs.current[itemId] = node;
        return;
      }

      delete rowRefs.current[itemId];
    },
    []
  );

  const handleListPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType && event.pointerType !== "mouse") return;

      const cardElement = floatingCardSurfaceRef.current;
      if (cardElement) {
        const cardRect = cardElement.getBoundingClientRect();
        if (cardRect.width > 0 && cardRect.height > 0) {
          const normalizedX = Math.max(
            0,
            Math.min(1, (event.clientX - cardRect.left) / cardRect.width)
          );
          const normalizedY = Math.max(
            0,
            Math.min(1, (event.clientY - cardRect.top) / cardRect.height)
          );
          updateHighlight(normalizedX, normalizedY);
        }
      }

      const listElement = listRef.current;
      if (!listElement) return;
      const pointerY =
        event.clientY - listElement.getBoundingClientRect().top + listElement.scrollTop;

      if (freezeFloating) {
        return;
      }

      const pointerItemId = resolvePointerItemId(event.target);
      const resolvedItemId =
        pointerItemId ??
        (preserveHoverOnGap && activePointerItemIdRef.current
          ? null
          : resolveNearestItemIdByPointerY(pointerY));

      if (resolvedItemId && resolvedItemId !== activePointerItemIdRef.current) {
        activePointerItemIdRef.current = resolvedItemId;
        onPointerItemChange(resolvedItemId);
      }

      const currentPointerItemId = activePointerItemIdRef.current;
      if (!currentPointerItemId) {
        return;
      }

      commitPointerFollowY(pointerY, currentPointerItemId);
    },
    [
      commitPointerFollowY,
      floatingCardSurfaceRef,
      freezeFloating,
      onPointerItemChange,
      preserveHoverOnGap,
      resolveNearestItemIdByPointerY,
      resolvePointerItemId,
      updateHighlight,
    ]
  );

  const handleListPointerEnter = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType && event.pointerType !== "mouse") return;

      onListPointerEnter();

      if (freezeFloating) {
        return;
      }

      const fallbackItemId = resolvePointerItemId(event.target);
      if (fallbackItemId) {
        if (fallbackItemId !== activePointerItemIdRef.current) {
          activePointerItemIdRef.current = fallbackItemId;
          onPointerItemChange(fallbackItemId);
        }
        return;
      }

      const listElement = listRef.current;
      if (!listElement) return;

      const pointerY =
        event.clientY - listElement.getBoundingClientRect().top + listElement.scrollTop;
      const nearestItemId = resolveNearestItemIdByPointerY(pointerY);

      if (!nearestItemId || nearestItemId === activePointerItemIdRef.current) {
        return;
      }

      activePointerItemIdRef.current = nearestItemId;
      onPointerItemChange(nearestItemId);
    },
    [
      freezeFloating,
      onListPointerEnter,
      onPointerItemChange,
      resolveNearestItemIdByPointerY,
      resolvePointerItemId,
    ]
  );

  const handleListPointerLeave = useCallback(() => {
    isPointerFollowingRef.current = false;
    onListPointerLeave();

    const previousPointerItemId = activePointerItemIdRef.current;
    activePointerItemIdRef.current = null;

    if (previousPointerItemId && previousPointerItemId === selectedItemId) {
      triggerSelectedBounce();
    } else if (previousPointerItemId && selectedItemId) {
      startSelectedGlowDecay();
    }

    cancelFollow();

    if (freezeFloating) {
      updateTargetRect(targetItemId);
      return;
    }

    updateTargetRect(restingTargetItemId);
    onPointerItemChange(null);
  }, [
    cancelFollow,
    freezeFloating,
    isPointerFollowingRef,
    onListPointerLeave,
    onPointerItemChange,
    restingTargetItemId,
    selectedItemId,
    startSelectedGlowDecay,
    targetItemId,
    triggerSelectedBounce,
    updateTargetRect,
  ]);

  const handleListScroll = useCallback(() => {
    updateTargetRect(cardTargetItemIdRef.current);
  }, [updateTargetRect]);

  useEffect(() => {
    cardTargetItemIdRef.current = targetItemId;
  }, [targetItemId]);

  useEffect(() => {
    previousDraggingItemIdRef.current = draggingItemId;
  }, [draggingItemId]);

  useEffect(() => {
    const previousTargetItemId = previousTargetItemIdRef.current;
    previousTargetItemIdRef.current = targetItemId;

    if (
      targetItemId &&
      targetItemId === selectedItemId &&
      previousTargetItemId !== selectedItemId
    ) {
      triggerSelectedBounce();
    }
  }, [selectedItemId, targetItemId, triggerSelectedBounce]);

  useLayoutEffect(() => {
    const justDroppedDraggedItem =
      previousDraggingItemIdRef.current !== null &&
      draggingItemId === null &&
      targetItemId !== null &&
      targetItemId === previousDraggingItemIdRef.current;
    const shouldSnapToTarget =
      targetItemId !== null && snapTargetItemId !== null && targetItemId === snapTargetItemId;
    const scheduleImmediateResync = () => {
      if (
        !targetItemId ||
        typeof window === "undefined" ||
        typeof window.requestAnimationFrame !== "function"
      ) {
        return null;
      }

      return window.requestAnimationFrame(() => {
        updateTargetRect(targetItemId, { immediate: true });
      });
    };
    let resyncFrameId: number | null = null;

    if (freezeFloating) {
      isPointerFollowingRef.current = false;
      updateTargetRect(targetItemId, {
        immediate: shouldSnapToTarget,
      });
      resyncFrameId = scheduleImmediateResync();
      return () => {
        if (resyncFrameId !== null) {
          window.cancelAnimationFrame(resyncFrameId);
        }
      };
    }

    if (shouldSnapToTarget || justDroppedDraggedItem) {
      updateTargetRect(targetItemId, { immediate: true });
      resyncFrameId = scheduleImmediateResync();
      return () => {
        if (resyncFrameId !== null) {
          window.cancelAnimationFrame(resyncFrameId);
        }
      };
    }

    if (isPointerFollowingRef.current) return;
    updateTargetRect(targetItemId);
  }, [
    filteredItemIdsSignature,
    freezeFloating,
    draggingItemId,
    isPointerFollowingRef,
    snapTargetItemId,
    targetItemId,
    updateTargetRect,
  ]);

  useEffect(() => {
    const activePointerItemId = activePointerItemIdRef.current;
    if (!activePointerItemId) return;
    if (filteredItemIds.includes(activePointerItemId)) return;
    activePointerItemIdRef.current = null;
  }, [filteredItemIds, filteredItemIdsSignature]);

  useEffect(() => {
    const listElement = listRef.current;
    if (!listElement || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      updateTargetRect(cardTargetItemIdRef.current);
    });

    observer.observe(listElement);
    return () => {
      observer.disconnect();
    };
  }, [updateTargetRect]);

  useEffect(() => {
    const listElement = listRef.current;
    if (
      !listElement ||
      typeof window === "undefined" ||
      typeof window.requestAnimationFrame !== "function" ||
      typeof window.cancelAnimationFrame !== "function"
    ) {
      return;
    }

    let resyncFrameId: number | null = null;

    const schedulePostAnimationResync = () => {
      if (isPointerFollowingRef.current) {
        return;
      }

      const targetItemId = cardTargetItemIdRef.current;
      if (!targetItemId) {
        return;
      }

      if (resyncFrameId !== null) {
        window.cancelAnimationFrame(resyncFrameId);
      }

      resyncFrameId = window.requestAnimationFrame(() => {
        resyncFrameId = null;
        updateTargetRect(cardTargetItemIdRef.current, { immediate: true });
      });
    };

    listElement.addEventListener("animationend", schedulePostAnimationResync);
    listElement.addEventListener("animationcancel", schedulePostAnimationResync);

    return () => {
      listElement.removeEventListener(
        "animationend",
        schedulePostAnimationResync
      );
      listElement.removeEventListener(
        "animationcancel",
        schedulePostAnimationResync
      );

      if (resyncFrameId !== null) {
        window.cancelAnimationFrame(resyncFrameId);
      }
    };
  }, [isPointerFollowingRef, updateTargetRect]);

  useEffect(() => {
    return () => {
      cleanupDynamics();
      const floatingFollowRaf = floatingFollowRafRef.current;
      if (
        floatingFollowRaf !== null &&
        typeof window !== "undefined" &&
        typeof window.cancelAnimationFrame === "function"
      ) {
        window.cancelAnimationFrame(floatingFollowRaf);
        if (floatingFollowRafRef.current === floatingFollowRaf) {
          floatingFollowRafRef.current = null;
        }
      }
      setFloatingAnimating(false);
    };
  }, [cleanupDynamics, floatingFollowRafRef, setFloatingAnimating]);

  return {
    listRef,
    floatingCardMotionRef,
    floatingCardSurfaceRef,
    cardTargetItemId: targetItemId,
    floatingVisible,
    setItemRowRef,
    handleListPointerMove,
    handleListPointerEnter,
    handleListPointerLeave,
    handleListScroll,
  };
}
