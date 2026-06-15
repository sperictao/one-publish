import { useCallback, useRef } from "react";
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
  specularSweep: number;
  specularAngle: number;
  causticX: number;
  causticY: number;
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
  specularSweep: 0.5,
  specularAngle: 90,
  causticX: 0.16,
  causticY: 0,
});

const isNeutralDynamics = (d: FloatingCardDynamics) =>
  d.tiltX === 0 && d.tiltY === 0 && d.trailOpacity === 0 &&
  d.trailOffsetX === 0 && d.trailOffsetY === 0 && d.trailScale === 1 &&
  d.highlightX === 0.16 && d.highlightY === 0 &&
  d.morphStretch === 0 && d.shadowOffsetX === 0 && d.shadowOffsetY === 0 &&
  d.specularSweep === 0.5 && d.specularAngle === 90 &&
  d.causticX === 0.16 && d.causticY === 0;

interface UseFloatingDynamicsOptions {
  isReducedMotionRef: React.MutableRefObject<boolean>;
  floatingCardSurfaceRef: React.MutableRefObject<HTMLDivElement | null>;
  floatingCardMotionRef: React.MutableRefObject<HTMLDivElement | null>;
}

export function useFloatingDynamics({
  isReducedMotionRef,
  floatingCardSurfaceRef,
  floatingCardMotionRef,
}: UseFloatingDynamicsOptions) {
  // 动效值经 ref 直写 DOM CSS 变量，绕过 React 渲染管线（性能关键路径）
  const dynamicsRef = useRef<FloatingCardDynamics>(createNeutralDynamics());

  const floatingDynamicsResetTimeoutRef = useRef<number | null>(null);
  const lastDynamicsFrameTimeRef = useRef(0);
  const selectedGlowRafRef = useRef<number | null>(null);
  const selectedGlowTimeoutRef = useRef<number | null>(null);

  const writeGlowToDom = useCallback(
    (glowLevel: number) => {
      floatingCardSurfaceRef.current?.style.setProperty(
        "--list-card-selected-glow",
        glowLevel.toFixed(3)
      );
    },
    [floatingCardSurfaceRef]
  );

  const writeDynamicsToDom = useCallback(
    (d: FloatingCardDynamics) => {
      const surface = floatingCardSurfaceRef.current;
      if (surface) {
        const { style } = surface;
        style.setProperty("--list-card-trail-opacity", d.trailOpacity.toFixed(3));
        style.setProperty("--list-card-trail-x", `${d.trailOffsetX.toFixed(2)}px`);
        style.setProperty("--list-card-trail-y", `${d.trailOffsetY.toFixed(2)}px`);
        style.setProperty("--list-card-trail-scale", d.trailScale.toFixed(3));
        style.setProperty("--list-card-highlight-x", d.highlightX.toFixed(3));
        style.setProperty("--list-card-highlight-y", d.highlightY.toFixed(3));
        style.setProperty("--list-card-morph-stretch", d.morphStretch.toFixed(3));
        style.setProperty("--list-card-shadow-offset-x", `${d.shadowOffsetX.toFixed(2)}px`);
        style.setProperty("--list-card-shadow-offset-y", `${d.shadowOffsetY.toFixed(2)}px`);
        style.setProperty("--list-card-specular-sweep", d.specularSweep.toFixed(3));
        style.setProperty("--list-card-specular-angle", `${d.specularAngle.toFixed(1)}deg`);
        style.setProperty("--list-card-caustic-x", d.causticX.toFixed(3));
        style.setProperty("--list-card-caustic-y", d.causticY.toFixed(3));
      }

      const motion = floatingCardMotionRef.current;
      if (motion) {
        motion.style.setProperty("--fc-tilt-x", `${d.tiltX.toFixed(2)}deg`);
        motion.style.setProperty("--fc-tilt-y", `${d.tiltY.toFixed(2)}deg`);
      }
    },
    [floatingCardMotionRef, floatingCardSurfaceRef]
  );

  const commitDynamics = useCallback(
    (next: FloatingCardDynamics) => {
      dynamicsRef.current = next;
      writeDynamicsToDom(next);
    },
    [writeDynamicsToDom]
  );

  const applyDynamics = useCallback(
    (nextRect: FloatingCardRectDraft | null, previousRect: FloatingCardRectDraft | null) => {
      if (!nextRect) {
        if (floatingDynamicsResetTimeoutRef.current !== null && typeof window !== "undefined") {
          window.clearTimeout(floatingDynamicsResetTimeoutRef.current);
          floatingDynamicsResetTimeoutRef.current = null;
        }
        if (!isNeutralDynamics(dynamicsRef.current)) {
          commitDynamics(createNeutralDynamics());
        }
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

      const moveAngleRad = Math.atan2(deltaY, deltaX);
      const prev = dynamicsRef.current;

      commitDynamics({
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
        specularSweep: Math.max(0.05, Math.min(0.95, 0.5 + Math.cos(moveAngleRad) * Math.min(0.45, distance / 180))),
        specularAngle: ((moveAngleRad * 180 / Math.PI + 90) % 360 + 360) % 360,
        causticX: prev.causticX,
        causticY: prev.causticY,
      });

      if (floatingDynamicsResetTimeoutRef.current !== null && typeof window !== "undefined") {
        window.clearTimeout(floatingDynamicsResetTimeoutRef.current);
      }

      if (typeof window !== "undefined") {
        floatingDynamicsResetTimeoutRef.current = window.setTimeout(() => {
          commitDynamics(createNeutralDynamics());
          floatingDynamicsResetTimeoutRef.current = null;
        }, 280);
      }
    },
    [commitDynamics, isReducedMotionRef]
  );

  const startSelectedGlowDecay = useCallback(() => {
    if (typeof window === "undefined") {
      writeGlowToDom(0);
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
      writeGlowToDom(0.22);
      selectedGlowTimeoutRef.current = window.setTimeout(() => {
        writeGlowToDom(0);
        selectedGlowTimeoutRef.current = null;
      }, 240);
      return;
    }

    writeGlowToDom(1);
    const duration = 760;
    const start = window.performance?.now() ?? Date.now();

    const step = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = Math.pow(1 - progress, 2.4);
      writeGlowToDom(eased);

      if (progress >= 1) {
        selectedGlowRafRef.current = null;
        return;
      }

      selectedGlowRafRef.current = window.requestAnimationFrame(step);
    };

    selectedGlowRafRef.current = window.requestAnimationFrame(step);
  }, [isReducedMotionRef, writeGlowToDom]);

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
      const prev = dynamicsRef.current;
      const nextCausticX = prev.causticX + (normalizedX - prev.causticX) * 0.35;
      const nextCausticY = prev.causticY + (normalizedY - prev.causticY) * 0.35;
      if (
        Math.abs(prev.highlightX - normalizedX) < 0.005 &&
        Math.abs(prev.highlightY - normalizedY) < 0.005 &&
        Math.abs(prev.causticX - nextCausticX) < 0.003 &&
        Math.abs(prev.causticY - nextCausticY) < 0.003
      ) {
        return;
      }
      commitDynamics({
        ...prev,
        highlightX: normalizedX,
        highlightY: normalizedY,
        causticX: nextCausticX,
        causticY: nextCausticY,
      });
    },
    [commitDynamics]
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
    applyDynamics,
    startSelectedGlowDecay,
    triggerSelectedBounce,
    updateHighlight,
    cleanupDynamics,
  };
}
