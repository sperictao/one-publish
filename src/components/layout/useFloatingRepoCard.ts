import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  type PointerEvent as ReactPointerEvent,
  useRef,
  type CSSProperties,
} from "react";
import { useReducedMotion } from "./useReducedMotion";
import { usePointerRepoId } from "./usePointerRepoId";
import { useFloatingPosition } from "./useFloatingPosition";
import { useFloatingDynamics } from "./useFloatingDynamics";

interface UseFloatingRepoCardOptions {
  filteredRepoIds: string[];
  targetRepoId: string | null;
  selectedRepoId: string | null;
  freezeFloating: boolean;
  onListPointerEnter: () => void;
  onListPointerLeave: () => void;
  onPointerRepoChange: (repoId: string | null) => void;
}

interface UseFloatingRepoCardResult {
  listRef: React.MutableRefObject<HTMLDivElement | null>;
  floatingCardSurfaceRef: React.MutableRefObject<HTMLDivElement | null>;
  cardTargetRepoId: string | null;
  floatingVisible: boolean;
  floatingCardMotionStyle: CSSProperties;
  floatingCardSurfaceStyle: CSSProperties;
  setRepoRowRef: (repoId: string) => (node: HTMLDivElement | null) => void;
  handleListPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleListPointerEnter: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleListMouseLeave: () => void;
  handleListScroll: () => void;
}

export function useFloatingRepoCard({
  filteredRepoIds,
  targetRepoId,
  selectedRepoId,
  freezeFloating,
  onListPointerEnter,
  onListPointerLeave,
  onPointerRepoChange,
}: UseFloatingRepoCardOptions): UseFloatingRepoCardResult {
  const listRef = useRef<HTMLDivElement | null>(null);
  const floatingCardSurfaceRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const cardTargetRepoIdRef = useRef<string | null>(null);
  const activePointerRepoIdRef = useRef<string | null>(null);
  const previousTargetRepoIdRef = useRef<string | null>(null);

  const isReducedMotionRef = useReducedMotion();

  const { resolvePointerRepoId, resolveNearestRepoIdByPointerY } =
    usePointerRepoId({ filteredRepoIds, rowRefs });

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

      if (freezeFloating) {
        return;
      }

      // Resolve which repo the pointer is over
      const resolvedRepoId = resolvePointerRepoId(event.target) ?? resolveNearestRepoIdByPointerY(pointerY);

      if (!resolvedRepoId) {
        return;
      }

      if (resolvedRepoId !== activePointerRepoIdRef.current) {
        activePointerRepoIdRef.current = resolvedRepoId;
        onPointerRepoChange(resolvedRepoId);
      }

      commitPointerFollowY(pointerY, resolvedRepoId);
    },
    [
      commitPointerFollowY,
      floatingCardSurfaceRef,
      freezeFloating,
      onPointerRepoChange,
      resolveNearestRepoIdByPointerY,
      resolvePointerRepoId,
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

      const fallbackRepoId = resolvePointerRepoId(event.target);
      if (fallbackRepoId) {
        if (fallbackRepoId !== activePointerRepoIdRef.current) {
          activePointerRepoIdRef.current = fallbackRepoId;
          onPointerRepoChange(fallbackRepoId);
        }
        return;
      }

      const listElement = listRef.current;
      if (!listElement) return;

      const pointerY =
        event.clientY - listElement.getBoundingClientRect().top + listElement.scrollTop;
      const nearestRepoId = resolveNearestRepoIdByPointerY(pointerY);

      if (!nearestRepoId || nearestRepoId === activePointerRepoIdRef.current) return;

      activePointerRepoIdRef.current = nearestRepoId;
      onPointerRepoChange(nearestRepoId);
    },
    [
      freezeFloating,
      onListPointerEnter,
      onPointerRepoChange,
      resolveNearestRepoIdByPointerY,
      resolvePointerRepoId,
    ]
  );

  const handleListMouseLeave = useCallback(() => {
    isPointerFollowingRef.current = false;
    onListPointerLeave();

    const previousPointerRepoId = activePointerRepoIdRef.current;
    activePointerRepoIdRef.current = null;

    if (previousPointerRepoId && previousPointerRepoId === selectedRepoId) {
      triggerSelectedBounce();
    } else if (previousPointerRepoId && selectedRepoId) {
      startSelectedGlowDecay();
    }

    cancelFollow();

    if (freezeFloating) {
      updateFloatingRect(targetRepoId);
      return;
    }

    onPointerRepoChange(null);
  }, [
    cancelFollow,
    freezeFloating,
    isPointerFollowingRef,
    onListPointerLeave,
    onPointerRepoChange,
    selectedRepoId,
    startSelectedGlowDecay,
    targetRepoId,
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
    cardTargetRepoIdRef.current = targetRepoId;
  }, [targetRepoId]);

  useEffect(() => {
    const previousTargetRepoId = previousTargetRepoIdRef.current;
    previousTargetRepoIdRef.current = targetRepoId;

    if (
      targetRepoId &&
      targetRepoId === selectedRepoId &&
      previousTargetRepoId !== selectedRepoId
    ) {
      triggerSelectedBounce();
    }
  }, [selectedRepoId, targetRepoId, triggerSelectedBounce]);

  useLayoutEffect(() => {
    if (freezeFloating) {
      isPointerFollowingRef.current = false;
      updateFloatingRect(targetRepoId);
      return;
    }

    if (isPointerFollowingRef.current) return;
    updateFloatingRect(targetRepoId);
  }, [freezeFloating, filteredRepoIdsSignature, isPointerFollowingRef, targetRepoId, updateFloatingRect]);

  useEffect(() => {
    const activePointerRepoId = activePointerRepoIdRef.current;
    if (!activePointerRepoId) return;
    if (filteredRepoIds.includes(activePointerRepoId)) return;
    activePointerRepoIdRef.current = null;
  }, [filteredRepoIds, filteredRepoIdsSignature]);

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
    cardTargetRepoId: targetRepoId,
    floatingVisible: floatingRenderRect.visible,
    floatingCardMotionStyle,
    floatingCardSurfaceStyle,
    setRepoRowRef,
    handleListPointerMove,
    handleListPointerEnter,
    handleListMouseLeave,
    handleListScroll,
  };
}
