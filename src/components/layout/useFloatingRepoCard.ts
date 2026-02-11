import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useReducedMotion } from "./useReducedMotion";
import { usePointerRepoId } from "./usePointerRepoId";
import { useFloatingPosition } from "./useFloatingPosition";
import { useFloatingDynamics } from "./useFloatingDynamics";

interface UseFloatingRepoCardOptions {
  filteredRepoIds: string[];
  selectedRepoId: string | null;
}

interface UseFloatingRepoCardResult {
  listRef: React.MutableRefObject<HTMLDivElement | null>;
  floatingCardSurfaceRef: React.MutableRefObject<HTMLDivElement | null>;
  cardTargetRepoId: string | null;
  floatingVisible: boolean;
  floatingCardMotionStyle: CSSProperties;
  floatingCardSurfaceStyle: CSSProperties;
  setRepoRowRef: (repoId: string) => (node: HTMLDivElement | null) => void;
  handleRepoMouseEnter: (repoId: string) => void;
  handleListPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleListPointerEnter: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleListMouseLeave: () => void;
  handleListScroll: () => void;
}

export function useFloatingRepoCard({
  filteredRepoIds,
  selectedRepoId,
}: UseFloatingRepoCardOptions): UseFloatingRepoCardResult {
  const [hoveredRepoId, setHoveredRepoId] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);
  const floatingCardSurfaceRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const cardTargetRepoIdRef = useRef<string | null>(null);

  const isReducedMotionRef = useReducedMotion();

  const {
    hoveredRepoIdRef,
    lastHoveredRepoIdRef,
    resolvePointerRepoId,
    resolveNearestRepoIdByPointerY,
  } = usePointerRepoId({ filteredRepoIds, rowRefs });

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

  const filteredRepoIdsSignature = useMemo(
    () => filteredRepoIds.join("|"),
    [filteredRepoIds]
  );

  const cardTargetRepoId = hoveredRepoId ?? selectedRepoId ?? null;

  const setRepoRowRef = useCallback(
    (repoId: string) => (node: HTMLDivElement | null) => {
      if (node) {
        rowRefs.current[repoId] = node;
        return;
      }
      delete rowRefs.current[repoId];
    },
    []
  );

  const handleRepoMouseEnter = useCallback(
    (repoId: string) => {
      const previousHoveredRepoId = hoveredRepoIdRef.current;
      lastHoveredRepoIdRef.current = previousHoveredRepoId;
      hoveredRepoIdRef.current = repoId;
      setHoveredRepoId(repoId);

      // In pointer-follow mode, skip snap-to-row (let pointerMove control position)
      if (!isPointerFollowingRef.current) {
        updateFloatingRect(repoId);
      }

      const enteredSelectedRepo = repoId === selectedRepoId;
      const enteredFromOutside = lastHoveredRepoIdRef.current === null;
      const enteredFromNonSelectedRepo =
        lastHoveredRepoIdRef.current !== null &&
        lastHoveredRepoIdRef.current !== selectedRepoId;

      if (enteredSelectedRepo && (enteredFromOutside || enteredFromNonSelectedRepo)) {
        triggerSelectedBounce();
      }
    },
    [hoveredRepoIdRef, isPointerFollowingRef, lastHoveredRepoIdRef, selectedRepoId, triggerSelectedBounce, updateFloatingRect]
  );

  const handleListPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType && event.pointerType !== "mouse") return;

      // Compute highlight coordinates relative to the floating card surface
      const cardElement = floatingCardSurfaceRef.current;
      if (cardElement) {
        const cardRect = cardElement.getBoundingClientRect();
        if (cardRect.width > 0 && cardRect.height > 0) {
          const normalizedX = Math.max(0, Math.min(1, (event.clientX - cardRect.left) / cardRect.width));
          const normalizedY = Math.max(0, Math.min(1, (event.clientY - cardRect.top) / cardRect.height));
          updateHighlight(normalizedX, normalizedY);
        }
      }

      // Compute pointerY relative to list container (shared by repo resolution + pointer-follow)
      const listElement = listRef.current;
      if (!listElement) return;
      const pointerY = event.clientY - listElement.getBoundingClientRect().top + listElement.scrollTop;

      // Resolve which repo the pointer is over
      const resolvedRepoId = resolvePointerRepoId(event.target) ?? resolveNearestRepoIdByPointerY(pointerY);

      // Update hovered repo if changed
      if (resolvedRepoId && resolvedRepoId !== hoveredRepoIdRef.current) {
        handleRepoMouseEnter(resolvedRepoId);
      }

      // Pointer-follow: update card Y to track mouse position
      const currentHoveredRepoId = hoveredRepoIdRef.current;
      if (!currentHoveredRepoId) return;

      commitPointerFollowY(pointerY, currentHoveredRepoId);
    },
    [commitPointerFollowY, floatingCardSurfaceRef, handleRepoMouseEnter, hoveredRepoIdRef, resolveNearestRepoIdByPointerY, resolvePointerRepoId, updateHighlight]
  );

  const handleListPointerEnter = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType && event.pointerType !== "mouse") return;

      const fallbackRepoId = resolvePointerRepoId(event.target);
      if (fallbackRepoId) {
        if (fallbackRepoId === hoveredRepoIdRef.current) return;
        handleRepoMouseEnter(fallbackRepoId);
        return;
      }

      const listElement = listRef.current;
      if (!listElement) return;

      const pointerY =
        event.clientY - listElement.getBoundingClientRect().top + listElement.scrollTop;
      const nearestRepoId = resolveNearestRepoIdByPointerY(pointerY);

      if (!nearestRepoId || nearestRepoId === hoveredRepoIdRef.current) return;
      handleRepoMouseEnter(nearestRepoId);
    },
    [handleRepoMouseEnter, hoveredRepoIdRef, resolveNearestRepoIdByPointerY, resolvePointerRepoId]
  );

  const handleListMouseLeave = useCallback(() => {
    isPointerFollowingRef.current = false;

    const previousHoveredRepoId = hoveredRepoIdRef.current;
    lastHoveredRepoIdRef.current = previousHoveredRepoId;

    if (previousHoveredRepoId && previousHoveredRepoId === selectedRepoId) {
      triggerSelectedBounce();
    } else if (previousHoveredRepoId && selectedRepoId) {
      startSelectedGlowDecay();
    }

    hoveredRepoIdRef.current = null;
    cancelFollow();
    updateFloatingRect(selectedRepoId ?? null);
    setHoveredRepoId(null);
  }, [cancelFollow, hoveredRepoIdRef, isPointerFollowingRef, lastHoveredRepoIdRef, selectedRepoId, startSelectedGlowDecay, triggerSelectedBounce, updateFloatingRect]);

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
  }, [floatingDynamics.tiltX, floatingDynamics.tiltY, floatingRenderRect.height, floatingRenderRect.left, floatingRenderRect.top, floatingRenderRect.width, isFloatingAnimating]);

  const floatingCardSurfaceStyle = useMemo<CSSProperties>(
    () =>
      ({
        "--repo-trail-opacity": floatingDynamics.trailOpacity.toFixed(3),
        "--repo-trail-x": `${floatingDynamics.trailOffsetX.toFixed(2)}px`,
        "--repo-trail-y": `${floatingDynamics.trailOffsetY.toFixed(2)}px`,
        "--repo-trail-scale": floatingDynamics.trailScale.toFixed(3),
        "--repo-selected-glow": selectedGlowLevel.toFixed(3),
        "--repo-highlight-x": floatingDynamics.highlightX.toFixed(3),
        "--repo-highlight-y": floatingDynamics.highlightY.toFixed(3),
        "--repo-morph-stretch": floatingDynamics.morphStretch.toFixed(3),
        "--repo-shadow-offset-x": `${floatingDynamics.shadowOffsetX.toFixed(2)}px`,
        "--repo-shadow-offset-y": `${floatingDynamics.shadowOffsetY.toFixed(2)}px`,
        "--repo-specular-sweep": floatingDynamics.specularSweep.toFixed(3),
        "--repo-specular-angle": `${floatingDynamics.specularAngle.toFixed(1)}deg`,
        "--repo-caustic-x": floatingDynamics.causticX.toFixed(3),
        "--repo-caustic-y": floatingDynamics.causticY.toFixed(3),
      }) as CSSProperties,
    [
      floatingDynamics.trailOffsetX,
      floatingDynamics.trailOffsetY,
      floatingDynamics.trailOpacity,
      floatingDynamics.trailScale,
      floatingDynamics.highlightX,
      floatingDynamics.highlightY,
      floatingDynamics.morphStretch,
      floatingDynamics.shadowOffsetX,
      floatingDynamics.shadowOffsetY,
      floatingDynamics.specularSweep,
      floatingDynamics.specularAngle,
      floatingDynamics.causticX,
      floatingDynamics.causticY,
      selectedGlowLevel,
    ]
  );

  const handleListScroll = useCallback(() => {
    updateFloatingRect(cardTargetRepoIdRef.current);
  }, [updateFloatingRect]);

  useEffect(() => {
    cardTargetRepoIdRef.current = cardTargetRepoId;
  }, [cardTargetRepoId]);

  useEffect(() => {
    if (!hoveredRepoId) return;
    if (filteredRepoIds.includes(hoveredRepoId)) return;
    hoveredRepoIdRef.current = null;
    setHoveredRepoId(null);
  }, [filteredRepoIds, hoveredRepoId, hoveredRepoIdRef]);

  // Force snap to row on selection change (overrides pointer-follow)
  useLayoutEffect(() => {
    isPointerFollowingRef.current = false;
    updateFloatingRect(hoveredRepoIdRef.current ?? selectedRepoId);
  }, [selectedRepoId, updateFloatingRect]);

  useLayoutEffect(() => {
    if (isPointerFollowingRef.current) return;
    updateFloatingRect(cardTargetRepoId);
  }, [cardTargetRepoId, filteredRepoIdsSignature, updateFloatingRect]);

  useEffect(() => {
    const listElement = listRef.current;
    if (!listElement || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      updateFloatingRect(cardTargetRepoIdRef.current);
    });

    observer.observe(listElement);
    return () => { observer.disconnect(); };
  }, [updateFloatingRect]);

  useEffect(() => {
    return () => {
      cleanupDynamics();
      if (floatingFollowRafRef.current !== null && typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(floatingFollowRafRef.current);
        floatingFollowRafRef.current = null;
      }
      setFloatingAnimating(false);
    };
  }, [cleanupDynamics, floatingFollowRafRef, setFloatingAnimating]);

  return {
    listRef,
    floatingCardSurfaceRef,
    cardTargetRepoId,
    floatingVisible: floatingRenderRect.visible,
    floatingCardMotionStyle,
    floatingCardSurfaceStyle,
    setRepoRowRef,
    handleRepoMouseEnter,
    handleListPointerMove,
    handleListPointerEnter,
    handleListMouseLeave,
    handleListScroll,
  };
}
