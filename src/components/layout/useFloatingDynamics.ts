import { useCallback, useRef, useState } from "react";
import type { FloatingCardRectDraft } from "./useFloatingPosition";

export interface FloatingCardDynamics {
  tiltX: number;
  tiltY: number;
  trailOpacity: number;
  trailOffsetX: number;
  trailOffsetY: number;
  trailScale: number;
  highlightX: number;
  highlightY: number;
  morphStretch: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
}

const createNeutralDynamics = (): FloatingCardDynamics => ({
  tiltX: 0,
  tiltY: 0,
  trailOpacity: 0,
  trailOffsetX: 0,
  trailOffsetY: 0,
  trailScale: 1,
  highlightX: 0.16,
  highlightY: 0,
  morphStretch: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
});

interface UseFloatingDynamicsOptions {
  isReducedMotionRef: React.MutableRefObject<boolean>;
  floatingCardSurfaceRef: React.MutableRefObject<HTMLDivElement | null>;
}

export function useFloatingDynamics({
  isReducedMotionRef,
  floatingCardSurfaceRef,
}: UseFloatingDynamicsOptions) {
  const [floatingDynamics, setFloatingDynamics] = useState<FloatingCardDynamics>(
    createNeutralDynamics
  );
  const [selectedGlowLevel, setSelectedGlowLevel] = useState(0);

  const floatingDynamicsResetTimeoutRef = useRef<number | null>(null);
  const lastDynamicsFrameTimeRef = useRef(0);
  const selectedGlowRafRef = useRef<number | null>(null);
  const selectedGlowTimeoutRef = useRef<number | null>(null);

  const applyDynamics = useCallback(
    (nextRect: FloatingCardRectDraft | null, previousRect: FloatingCardRectDraft | null) => {
      if (!nextRect) {
        if (floatingDynamicsResetTimeoutRef.current !== null && typeof window !== "undefined") {
          window.clearTimeout(floatingDynamicsResetTimeoutRef.current);
          floatingDynamicsResetTimeoutRef.current = null;
        }
        setFloatingDynamics((prev) =>
          prev.tiltX === 0 && prev.tiltY === 0 && prev.trailOpacity === 0 &&
          prev.trailOffsetX === 0 && prev.trailOffsetY === 0 && prev.trailScale === 1 &&
          prev.highlightX === 0.16 && prev.highlightY === 0 &&
          prev.morphStretch === 0 && prev.shadowOffsetX === 0 && prev.shadowOffsetY === 0
            ? prev
            : createNeutralDynamics()
        );
        return;
      }

      if (isReducedMotionRef.current || !previousRect) {
        return;
      }

      const now = typeof window !== "undefined" && typeof window.performance !== "undefined"
        ? window.performance.now()
        : Date.now();

      const deltaX = nextRect.left - previousRect.left;
      const deltaY = nextRect.top - previousRect.top;
      const distance = Math.hypot(deltaX, deltaY);

      if (distance <= 0.6) {
        return;
      }

      const elapsedSinceLastDynamics = now - lastDynamicsFrameTimeRef.current;
      if (elapsedSinceLastDynamics < 60 && distance < 80) {
        return;
      }

      lastDynamicsFrameTimeRef.current = now;

      setFloatingDynamics((prev) => ({
        tiltX: Math.max(-1.6, Math.min(1.6, -deltaY / 36)),
        tiltY: Math.max(-2.2, Math.min(2.2, deltaX / 28)),
        trailOpacity: Math.min(0.22, distance / 240),
        trailOffsetX: Math.max(-10, Math.min(10, -deltaX * 0.13)),
        trailOffsetY: Math.max(-7, Math.min(7, -deltaY * 0.10)),
        trailScale: 1 + Math.min(0.08, distance / 680),
        highlightX: prev.highlightX,
        highlightY: prev.highlightY,
        morphStretch: Math.min(1, distance / 200),
        shadowOffsetX: Math.max(-4, Math.min(4, -deltaX * 0.08)),
        shadowOffsetY: Math.max(-3, Math.min(3, -deltaY * 0.06)),
      }));

      if (floatingDynamicsResetTimeoutRef.current !== null && typeof window !== "undefined") {
        window.clearTimeout(floatingDynamicsResetTimeoutRef.current);
      }

      if (typeof window !== "undefined") {
        floatingDynamicsResetTimeoutRef.current = window.setTimeout(() => {
          setFloatingDynamics(createNeutralDynamics());
          floatingDynamicsResetTimeoutRef.current = null;
        }, 280);
      }
    },
    [isReducedMotionRef]
  );

  const startSelectedGlowDecay = useCallback(() => {
    if (typeof window === "undefined") {
      setSelectedGlowLevel(0);
      return;
    }

    if (selectedGlowTimeoutRef.current !== null) {
      window.clearTimeout(selectedGlowTimeoutRef.current);
      selectedGlowTimeoutRef.current = null;
    }

    if (selectedGlowRafRef.current !== null && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(selectedGlowRafRef.current);
      selectedGlowRafRef.current = null;
    }

    if (isReducedMotionRef.current || typeof window.requestAnimationFrame !== "function") {
      setSelectedGlowLevel(0.22);
      selectedGlowTimeoutRef.current = window.setTimeout(() => {
        setSelectedGlowLevel(0);
        selectedGlowTimeoutRef.current = null;
      }, 240);
      return;
    }

    setSelectedGlowLevel(1);
    const duration = 760;
    const start = window.performance?.now() ?? Date.now();

    const step = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = Math.pow(1 - progress, 2.4);
      setSelectedGlowLevel(eased);

      if (progress >= 1) {
        selectedGlowRafRef.current = null;
        return;
      }

      selectedGlowRafRef.current = window.requestAnimationFrame(step);
    };

    selectedGlowRafRef.current = window.requestAnimationFrame(step);
  }, [isReducedMotionRef]);

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
        { transform: "translateY(-1px) scale(1.005)", offset: 0.4 },
        { transform: "translateY(0) scale(0.998)", offset: 0.72 },
        { transform: "translateY(0) scale(1)" },
      ],
      {
        duration: 480,
        easing: "cubic-bezier(0.22, 1.4, 0.52, 1)",
      }
    );
  }, [floatingCardSurfaceRef, isReducedMotionRef, startSelectedGlowDecay]);

  const updateHighlight = useCallback(
    (normalizedX: number, normalizedY: number) => {
      setFloatingDynamics((prev) => {
        if (
          Math.abs(prev.highlightX - normalizedX) < 0.005 &&
          Math.abs(prev.highlightY - normalizedY) < 0.005
        ) {
          return prev;
        }
        return { ...prev, highlightX: normalizedX, highlightY: normalizedY };
      });
    },
    []
  );

  const cleanupDynamics = useCallback(() => {
    if (selectedGlowRafRef.current !== null && typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(selectedGlowRafRef.current);
      selectedGlowRafRef.current = null;
    }
    if (selectedGlowTimeoutRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(selectedGlowTimeoutRef.current);
      selectedGlowTimeoutRef.current = null;
    }
    if (floatingDynamicsResetTimeoutRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(floatingDynamicsResetTimeoutRef.current);
      floatingDynamicsResetTimeoutRef.current = null;
    }
    lastDynamicsFrameTimeRef.current = 0;
  }, []);

  return {
    floatingDynamics,
    selectedGlowLevel,
    applyDynamics,
    startSelectedGlowDecay,
    triggerSelectedBounce,
    updateHighlight,
    cleanupDynamics,
  };
}
