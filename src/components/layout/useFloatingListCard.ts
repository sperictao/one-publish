import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
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
  freezeFloating: boolean;
  onListPointerEnter: () => void;
  onListPointerLeave: () => void;
  onPointerItemChange: (itemId: string | null) => void;
  preserveHoverOnGap?: boolean;
}

export interface FloatingListCardResult {
  listRef: React.MutableRefObject<HTMLDivElement | null>;
  floatingCardSurfaceRef: React.MutableRefObject<HTMLDivElement | null>;
  cardTargetItemId: string | null;
  floatingVisible: boolean;
  floatingCardMotionStyle: CSSProperties;
  floatingCardSurfaceStyle: CSSProperties;
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
  freezeFloating,
  onListPointerEnter,
  onListPointerLeave,
  onPointerItemChange,
  preserveHoverOnGap = false,
}: UseFloatingListCardOptions): FloatingListCardResult {
  const listRef = useRef<HTMLDivElement | null>(null);
  const floatingCardSurfaceRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const cardTargetItemIdRef = useRef<string | null>(null);
  const activePointerItemIdRef = useRef<string | null>(null);
  const previousTargetItemIdRef = useRef<string | null>(null);

  const isReducedMotionRef = useReducedMotion();

  const { resolvePointerItemId, resolveNearestItemIdByPointerY } =
    usePointerItemId({ filteredItemIds, rowRefs });

  const {
    floatingDynamics,
    selectedGlowLevel,
    applyDynamics,
    startSelectedGlowDecay,
    triggerSelectedBounce,
    updateHighlight,
    cleanupDynamics,
  } = useFloatingDynamics({ isReducedMotionRef, floatingCardSurfaceRef });

  const {
    floatingRenderRect,
    isFloatingAnimating,
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
    onRectCommitted: applyDynamics,
  });

  const filteredItemIdsSignature = useMemo(
    () => filteredItemIds.join("|"),
    [filteredItemIds]
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
      updateFloatingRect(targetItemId);
      return;
    }

    updateFloatingRect(restingTargetItemId);
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
    updateFloatingRect,
  ]);

  const floatingCardMotionStyle = useMemo<CSSProperties>(() => {
    const style: CSSProperties = {
      position: "absolute",
      top: 0,
      left: 0,
      width: floatingRenderRect.width,
      height: floatingRenderRect.height,
      transform:
        `perspective(900px) translate3d(${floatingRenderRect.left}px, ${floatingRenderRect.top}px, 0) ` +
        `rotateX(${floatingDynamics.tiltX.toFixed(2)}deg) rotateY(${floatingDynamics.tiltY.toFixed(2)}deg)`,
    };

    if (isFloatingAnimating) {
      style.willChange = "transform,width,height,opacity";
    }

    return style;
  }, [
    floatingDynamics.tiltX,
    floatingDynamics.tiltY,
    floatingRenderRect.height,
    floatingRenderRect.left,
    floatingRenderRect.top,
    floatingRenderRect.width,
    isFloatingAnimating,
  ]);

  const floatingCardSurfaceStyle = useMemo<CSSProperties>(
    () =>
      ({
        "--list-card-trail-opacity": floatingDynamics.trailOpacity.toFixed(3),
        "--list-card-trail-x": `${floatingDynamics.trailOffsetX.toFixed(2)}px`,
        "--list-card-trail-y": `${floatingDynamics.trailOffsetY.toFixed(2)}px`,
        "--list-card-trail-scale": floatingDynamics.trailScale.toFixed(3),
        "--list-card-selected-glow": selectedGlowLevel.toFixed(3),
        "--list-card-highlight-x": floatingDynamics.highlightX.toFixed(3),
        "--list-card-highlight-y": floatingDynamics.highlightY.toFixed(3),
        "--list-card-morph-stretch": floatingDynamics.morphStretch.toFixed(3),
        "--list-card-shadow-offset-x": `${floatingDynamics.shadowOffsetX.toFixed(2)}px`,
        "--list-card-shadow-offset-y": `${floatingDynamics.shadowOffsetY.toFixed(2)}px`,
        "--list-card-specular-sweep": floatingDynamics.specularSweep.toFixed(3),
        "--list-card-specular-angle": `${floatingDynamics.specularAngle.toFixed(1)}deg`,
        "--list-card-caustic-x": floatingDynamics.causticX.toFixed(3),
        "--list-card-caustic-y": floatingDynamics.causticY.toFixed(3),
      }) as CSSProperties,
    [
      floatingDynamics.causticX,
      floatingDynamics.causticY,
      floatingDynamics.highlightX,
      floatingDynamics.highlightY,
      floatingDynamics.morphStretch,
      floatingDynamics.shadowOffsetX,
      floatingDynamics.shadowOffsetY,
      floatingDynamics.specularAngle,
      floatingDynamics.specularSweep,
      floatingDynamics.trailOffsetX,
      floatingDynamics.trailOffsetY,
      floatingDynamics.trailOpacity,
      floatingDynamics.trailScale,
      selectedGlowLevel,
    ]
  );

  const handleListScroll = useCallback(() => {
    updateFloatingRect(cardTargetItemIdRef.current);
  }, [updateFloatingRect]);

  useEffect(() => {
    cardTargetItemIdRef.current = targetItemId;
  }, [targetItemId]);

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
    if (freezeFloating) {
      isPointerFollowingRef.current = false;
      updateFloatingRect(targetItemId);
      return;
    }

    if (isPointerFollowingRef.current) return;
    updateFloatingRect(targetItemId);
  }, [
    filteredItemIdsSignature,
    freezeFloating,
    isPointerFollowingRef,
    targetItemId,
    updateFloatingRect,
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
      updateFloatingRect(cardTargetItemIdRef.current);
    });

    observer.observe(listElement);
    return () => {
      observer.disconnect();
    };
  }, [updateFloatingRect]);

  useEffect(() => {
    return () => {
      cleanupDynamics();
      if (
        floatingFollowRafRef.current !== null &&
        typeof window !== "undefined" &&
        typeof window.cancelAnimationFrame === "function"
      ) {
        window.cancelAnimationFrame(floatingFollowRafRef.current);
        floatingFollowRafRef.current = null;
      }
      setFloatingAnimating(false);
    };
  }, [cleanupDynamics, floatingFollowRafRef, setFloatingAnimating]);

  return {
    listRef,
    floatingCardSurfaceRef,
    cardTargetItemId: targetItemId,
    floatingVisible: floatingRenderRect.visible,
    floatingCardMotionStyle,
    floatingCardSurfaceStyle,
    setItemRowRef,
    handleListPointerMove,
    handleListPointerEnter,
    handleListPointerLeave,
    handleListScroll,
  };
}
