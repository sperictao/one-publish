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

interface FloatingCardRect {
  top: number;
  left: number;
  width: number;
  height: number;
  visible: boolean;
}

interface FloatingCardRectDraft {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface FloatingCardDynamics {
  tiltX: number;
  tiltY: number;
  trailOpacity: number;
  trailOffsetX: number;
  trailOffsetY: number;
  trailScale: number;
}

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

const createNeutralFloatingCardDynamics = (): FloatingCardDynamics => ({
  tiltX: 0,
  tiltY: 0,
  trailOpacity: 0,
  trailOffsetX: 0,
  trailOffsetY: 0,
  trailScale: 1,
});

const createHiddenFloatingCardRect = (): FloatingCardRect => ({
  top: 0,
  left: 0,
  width: 0,
  height: 0,
  visible: false,
});

const hasMeaningfulRectDiff = (
  current: FloatingCardRect | FloatingCardRectDraft,
  next: FloatingCardRect | FloatingCardRectDraft
) =>
  Math.abs(current.left - next.left) > 0.2 ||
  Math.abs(current.top - next.top) > 0.2 ||
  Math.abs(current.width - next.width) > 0.2 ||
  Math.abs(current.height - next.height) > 0.2;

export function useFloatingRepoCard({
  filteredRepoIds,
  selectedRepoId,
}: UseFloatingRepoCardOptions): UseFloatingRepoCardResult {
  const [hoveredRepoId, setHoveredRepoId] = useState<string | null>(null);
  const [floatingDynamics, setFloatingDynamics] = useState<FloatingCardDynamics>(
    createNeutralFloatingCardDynamics
  );
  const [selectedGlowLevel, setSelectedGlowLevel] = useState(0);
  const [floatingRenderRect, setFloatingRenderRect] = useState<FloatingCardRect>(
    createHiddenFloatingCardRect
  );
  const [isFloatingAnimating, setIsFloatingAnimating] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);
  const floatingCardSurfaceRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const hoveredRepoIdRef = useRef<string | null>(null);
  const lastHoveredRepoIdRef = useRef<string | null>(null);
  const isReducedMotionRef = useRef(false);
  const cardTargetRepoIdRef = useRef<string | null>(null);
  const previousFloatingRectRef = useRef<FloatingCardRectDraft | null>(null);
  const floatingTargetRectRef = useRef<FloatingCardRect>(createHiddenFloatingCardRect());
  const floatingRenderRectRef = useRef<FloatingCardRect>(createHiddenFloatingCardRect());
  const floatingFollowRafRef = useRef<number | null>(null);
  const floatingFollowTimestampRef = useRef<number | null>(null);
  const floatingDynamicsResetTimeoutRef = useRef<number | null>(null);
  const lastDynamicsFrameTimeRef = useRef(0);
  const selectedGlowRafRef = useRef<number | null>(null);
  const selectedGlowTimeoutRef = useRef<number | null>(null);
  const floatingAnimatingRef = useRef(false);

  const filteredRepoIdsSignature = useMemo(
    () => filteredRepoIds.join("|"),
    [filteredRepoIds]
  );

  const cardTargetRepoId = hoveredRepoId ?? selectedRepoId ?? null;

  const setFloatingAnimating = useCallback((next: boolean) => {
    if (floatingAnimatingRef.current === next) {
      return;
    }

    floatingAnimatingRef.current = next;
    setIsFloatingAnimating(next);
  }, []);

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
        if (isReducedMotionRef.current) {
          return 1;
        }

        if (travelDistance > 220) {
          return 1;
        }

        if (travelDistance > 140) {
          return 0.97;
        }

        if (travelDistance > 80) {
          return 0.92;
        }

        return 0.84;
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
        : sizeDelta > 26
          ? 0.94
          : sizeDelta > 10
            ? 0.86
            : 0.76;
      const sizeSmoothing = 1 - Math.pow(1 - dynamicSizeRate, frameCompensation);
      const nextWidth = current.visible
        ? current.width + (target.width - current.width) * sizeSmoothing
        : target.width;
      const nextHeight = current.visible
        ? current.height + (target.height - current.height) * sizeSmoothing
        : target.height;

      const hasConverged =
        Math.abs(target.left - nextLeft) < 0.3 &&
        Math.abs(target.top - nextTop) < 0.3 &&
        Math.abs(target.width - nextWidth) < 0.3 &&
        Math.abs(target.height - nextHeight) < 0.3;

      const nextRect: FloatingCardRect = hasConverged
        ? {
            left: target.left,
            top: target.top,
            width: target.width,
            height: target.height,
            visible: true,
          }
        : {
            left: nextLeft,
            top: nextTop,
            width: nextWidth,
            height: nextHeight,
            visible: true,
          };

      floatingRenderRectRef.current = nextRect;
      setFloatingRenderRect((prev) => {
        const hasSameGeometry =
          prev.visible === nextRect.visible &&
          Math.abs(prev.left - nextRect.left) < 0.01 &&
          Math.abs(prev.top - nextRect.top) < 0.01 &&
          Math.abs(prev.width - nextRect.width) < 0.01 &&
          Math.abs(prev.height - nextRect.height) < 0.01;

        return hasSameGeometry ? prev : nextRect;
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

  const startSelectedGlowDecay = useCallback(() => {
    if (typeof window === "undefined") {
      setSelectedGlowLevel(0);
      return;
    }

    if (selectedGlowTimeoutRef.current !== null) {
      window.clearTimeout(selectedGlowTimeoutRef.current);
      selectedGlowTimeoutRef.current = null;
    }

    if (
      selectedGlowRafRef.current !== null &&
      typeof window.cancelAnimationFrame === "function"
    ) {
      window.cancelAnimationFrame(selectedGlowRafRef.current);
      selectedGlowRafRef.current = null;
    }

    if (isReducedMotionRef.current || typeof window.requestAnimationFrame !== "function") {
      setSelectedGlowLevel(0.28);
      selectedGlowTimeoutRef.current = window.setTimeout(() => {
        setSelectedGlowLevel(0);
        selectedGlowTimeoutRef.current = null;
      }, 180);
      return;
    }

    setSelectedGlowLevel(1);
    const duration = 620;
    const start = window.performance?.now() ?? Date.now();

    const step = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = Math.pow(1 - progress, 2.05);
      setSelectedGlowLevel(eased);

      if (progress >= 1) {
        selectedGlowRafRef.current = null;
        return;
      }

      selectedGlowRafRef.current = window.requestAnimationFrame(step);
    };

    selectedGlowRafRef.current = window.requestAnimationFrame(step);
  }, []);

  const commitFloatingRect = useCallback(
    (nextRect: FloatingCardRectDraft | null) => {
      if (!nextRect) {
        previousFloatingRectRef.current = null;
        const hiddenRect = createHiddenFloatingCardRect();
        floatingTargetRectRef.current = hiddenRect;
        startFloatingCardFollow();

        if (
          floatingDynamicsResetTimeoutRef.current !== null &&
          typeof window !== "undefined"
        ) {
          window.clearTimeout(floatingDynamicsResetTimeoutRef.current);
          floatingDynamicsResetTimeoutRef.current = null;
        }
        setFloatingDynamics((prev) =>
          prev.tiltX === 0 &&
          prev.tiltY === 0 &&
          prev.trailOpacity === 0 &&
          prev.trailOffsetX === 0 &&
          prev.trailOffsetY === 0 &&
          prev.trailScale === 1
            ? prev
            : createNeutralFloatingCardDynamics()
        );
        setFloatingAnimating(false);
        return;
      }

      const previousRect = previousFloatingRectRef.current;
      previousFloatingRectRef.current = nextRect;

      const now =
        typeof window !== "undefined" && typeof window.performance !== "undefined"
          ? window.performance.now()
          : Date.now();

      if (!isReducedMotionRef.current && previousRect) {
        const deltaX = nextRect.left - previousRect.left;
        const deltaY = nextRect.top - previousRect.top;
        const distance = Math.hypot(deltaX, deltaY);

        if (distance > 0.6) {
          const elapsedSinceLastDynamics = now - lastDynamicsFrameTimeRef.current;
          const shouldRefreshDynamics =
            elapsedSinceLastDynamics >= 78 || distance >= 110;

          if (shouldRefreshDynamics) {
            lastDynamicsFrameTimeRef.current = now;

            setFloatingDynamics({
              tiltX: Math.max(-2.4, Math.min(2.4, -deltaY / 24)),
              tiltY: Math.max(-3.2, Math.min(3.2, deltaX / 20)),
              trailOpacity: Math.min(0.34, distance / 175),
              trailOffsetX: Math.max(-14, Math.min(14, -deltaX * 0.18)),
              trailOffsetY: Math.max(-10, Math.min(10, -deltaY * 0.15)),
              trailScale: 1 + Math.min(0.13, distance / 520),
            });

            if (
              floatingDynamicsResetTimeoutRef.current !== null &&
              typeof window !== "undefined"
            ) {
              window.clearTimeout(floatingDynamicsResetTimeoutRef.current);
            }

            if (typeof window !== "undefined") {
              floatingDynamicsResetTimeoutRef.current = window.setTimeout(() => {
                setFloatingDynamics(createNeutralFloatingCardDynamics());
                floatingDynamicsResetTimeoutRef.current = null;
              }, 200);
            }
          }
        }
      }

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
    [setFloatingAnimating, startFloatingCardFollow]
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
    [commitFloatingRect]
  );

  const triggerSelectedBounce = useCallback(() => {
    startSelectedGlowDecay();

    if (isReducedMotionRef.current) {
      return;
    }

    const cardElement = floatingCardSurfaceRef.current;
    if (!cardElement) {
      return;
    }

    cardElement.getAnimations().forEach((animation) => {
      animation.cancel();
    });

    cardElement.animate(
      [
        { transform: "translateY(0) scale(1)" },
        { transform: "translateY(-2px) scale(1.01)", offset: 0.4 },
        { transform: "translateY(0) scale(0.995)", offset: 0.72 },
        { transform: "translateY(0) scale(1)" },
      ],
      {
        duration: 390,
        easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      }
    );
  }, [startSelectedGlowDecay]);

  const handleRepoMouseEnter = useCallback(
    (repoId: string) => {
      const previousHoveredRepoId = hoveredRepoIdRef.current;
      lastHoveredRepoIdRef.current = previousHoveredRepoId;
      hoveredRepoIdRef.current = repoId;
      setHoveredRepoId(repoId);
      updateFloatingRect(repoId);

      const enteredSelectedRepo = repoId === selectedRepoId;
      const enteredFromOutside = lastHoveredRepoIdRef.current === null;
      const enteredFromNonSelectedRepo =
        lastHoveredRepoIdRef.current !== null &&
        lastHoveredRepoIdRef.current !== selectedRepoId;

      if (enteredSelectedRepo && (enteredFromOutside || enteredFromNonSelectedRepo)) {
        triggerSelectedBounce();
      }
    },
    [selectedRepoId, triggerSelectedBounce, updateFloatingRect]
  );

  const resolvePointerRepoId = useCallback((target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) {
      return null;
    }

    const rowElement = target.closest<HTMLElement>(
      "[data-repo-row='true'][data-repo-id]"
    );

    return rowElement?.dataset.repoId ?? null;
  }, []);

  const resolveNearestRepoIdByPointerY = useCallback(
    (pointerY: number) => {
      if (filteredRepoIds.length === 0) {
        return null;
      }

      let nextRepoId: string | null = null;
      let nearestDistance = Number.POSITIVE_INFINITY;

      for (const repoId of filteredRepoIds) {
        const rowElement = rowRefs.current[repoId];
        if (!rowElement) {
          continue;
        }

        const rowCenterY = rowElement.offsetTop + rowElement.offsetHeight / 2;
        const distance = Math.abs(pointerY - rowCenterY);

        if (distance < nearestDistance) {
          nearestDistance = distance;
          nextRepoId = repoId;
        }
      }

      return nextRepoId;
    },
    [filteredRepoIds]
  );

  const handleListPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType && event.pointerType !== "mouse") {
        return;
      }

      const hoveredRepoIdByTarget = resolvePointerRepoId(event.target);
      if (hoveredRepoIdByTarget) {
        if (hoveredRepoIdByTarget === hoveredRepoIdRef.current) {
          return;
        }

        handleRepoMouseEnter(hoveredRepoIdByTarget);
        return;
      }

      const listElement = listRef.current;
      if (!listElement) {
        return;
      }

      const pointerY =
        event.clientY - listElement.getBoundingClientRect().top + listElement.scrollTop;
      const nearestRepoId = resolveNearestRepoIdByPointerY(pointerY);

      if (!nearestRepoId || nearestRepoId === hoveredRepoIdRef.current) {
        return;
      }

      handleRepoMouseEnter(nearestRepoId);
    },
    [handleRepoMouseEnter, resolveNearestRepoIdByPointerY, resolvePointerRepoId]
  );

  const handleListPointerEnter = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType && event.pointerType !== "mouse") {
        return;
      }

      const fallbackRepoId = resolvePointerRepoId(event.target);
      if (fallbackRepoId) {
        if (fallbackRepoId === hoveredRepoIdRef.current) {
          return;
        }

        handleRepoMouseEnter(fallbackRepoId);
        return;
      }

      const listElement = listRef.current;
      if (!listElement) {
        return;
      }

      const pointerY =
        event.clientY - listElement.getBoundingClientRect().top + listElement.scrollTop;
      const nearestRepoId = resolveNearestRepoIdByPointerY(pointerY);

      if (!nearestRepoId || nearestRepoId === hoveredRepoIdRef.current) {
        return;
      }

      handleRepoMouseEnter(nearestRepoId);
    },
    [handleRepoMouseEnter, resolveNearestRepoIdByPointerY, resolvePointerRepoId]
  );

  const handleListMouseLeave = useCallback(() => {
    const previousHoveredRepoId = hoveredRepoIdRef.current;
    lastHoveredRepoIdRef.current = previousHoveredRepoId;

    if (previousHoveredRepoId && previousHoveredRepoId === selectedRepoId) {
      triggerSelectedBounce();
    } else if (previousHoveredRepoId && selectedRepoId) {
      startSelectedGlowDecay();
    }

    hoveredRepoIdRef.current = null;
    updateFloatingRect(selectedRepoId ?? null);

    if (
      floatingFollowRafRef.current !== null &&
      typeof window !== "undefined" &&
      typeof window.cancelAnimationFrame === "function"
    ) {
      window.cancelAnimationFrame(floatingFollowRafRef.current);
      floatingFollowRafRef.current = null;
      setFloatingAnimating(false);
    }

    setHoveredRepoId(null);
  }, [selectedRepoId, setFloatingAnimating, startSelectedGlowDecay, triggerSelectedBounce, updateFloatingRect]);

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
        "--repo-trail-opacity": floatingDynamics.trailOpacity.toFixed(3),
        "--repo-trail-x": `${floatingDynamics.trailOffsetX.toFixed(2)}px`,
        "--repo-trail-y": `${floatingDynamics.trailOffsetY.toFixed(2)}px`,
        "--repo-trail-scale": floatingDynamics.trailScale.toFixed(3),
        "--repo-selected-glow": selectedGlowLevel.toFixed(3),
      }) as CSSProperties,
    [
      floatingDynamics.trailOffsetX,
      floatingDynamics.trailOffsetY,
      floatingDynamics.trailOpacity,
      floatingDynamics.trailScale,
      selectedGlowLevel,
    ]
  );

  const handleListScroll = useCallback(() => {
    updateFloatingRect(cardTargetRepoIdRef.current);
  }, [updateFloatingRect]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => {
      isReducedMotionRef.current = mediaQuery.matches;
    };

    updatePreference();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updatePreference);
      return () => {
        mediaQuery.removeEventListener("change", updatePreference);
      };
    }

    mediaQuery.addListener(updatePreference);
    return () => {
      mediaQuery.removeListener(updatePreference);
    };
  }, []);

  useEffect(() => {
    cardTargetRepoIdRef.current = cardTargetRepoId;
  }, [cardTargetRepoId]);

  useEffect(() => {
    if (!hoveredRepoId) {
      return;
    }

    if (filteredRepoIds.includes(hoveredRepoId)) {
      return;
    }

    hoveredRepoIdRef.current = null;
    setHoveredRepoId(null);
  }, [filteredRepoIds, hoveredRepoId]);

  useLayoutEffect(() => {
    updateFloatingRect(cardTargetRepoId);
  }, [cardTargetRepoId, filteredRepoIdsSignature, updateFloatingRect]);

  useEffect(() => {
    const listElement = listRef.current;
    if (!listElement || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      updateFloatingRect(cardTargetRepoIdRef.current);
    });

    observer.observe(listElement);

    return () => {
      observer.disconnect();
    };
  }, [updateFloatingRect]);

  useEffect(() => {
    return () => {
      if (
        selectedGlowRafRef.current !== null &&
        typeof window !== "undefined" &&
        typeof window.cancelAnimationFrame === "function"
      ) {
        window.cancelAnimationFrame(selectedGlowRafRef.current);
        selectedGlowRafRef.current = null;
      }

      if (selectedGlowTimeoutRef.current !== null && typeof window !== "undefined") {
        window.clearTimeout(selectedGlowTimeoutRef.current);
        selectedGlowTimeoutRef.current = null;
      }

      if (
        floatingDynamicsResetTimeoutRef.current !== null &&
        typeof window !== "undefined"
      ) {
        window.clearTimeout(floatingDynamicsResetTimeoutRef.current);
        floatingDynamicsResetTimeoutRef.current = null;
      }

      if (
        floatingFollowRafRef.current !== null &&
        typeof window !== "undefined" &&
        typeof window.cancelAnimationFrame === "function"
      ) {
        window.cancelAnimationFrame(floatingFollowRafRef.current);
        floatingFollowRafRef.current = null;
      }

      setFloatingAnimating(false);
      lastDynamicsFrameTimeRef.current = 0;
    };
  }, [setFloatingAnimating]);

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
