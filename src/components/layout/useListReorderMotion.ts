import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import motionTokens from "../../../motion-tokens.json";
import { useReducedMotion } from "./useReducedMotion";

const MOTION_EASING = motionTokens.easing.move;

function resolveReorderDuration(distance: number) {
  const clampedDistance = Math.max(0, Math.min(140, distance));
  const normalizedDistance = clampedDistance / 140;
  return Math.round(
    motionTokens.duration.moveMin +
      (motionTokens.duration.moveMax - motionTokens.duration.moveMin) *
        Math.sqrt(normalizedDistance)
  );
}

export function useListReorderMotion(params: {
  orderedIds: readonly string[];
  draggingItemId: string | null;
  settledItemId?: string | null;
  resetKey?: string | null;
}) {
  const {
    orderedIds,
    draggingItemId,
    settledItemId = null,
    resetKey = null,
  } = params;
  const reducedMotionRef = useReducedMotion();
  const itemRefs = useRef<Record<string, HTMLElement | null>>({});
  const previousRectsRef = useRef<Record<string, DOMRect>>({});
  const animationRefs = useRef<Record<string, Animation | null>>({});
  const previousResetKeyRef = useRef<string | null>(resetKey);
  // 用可逆编码生成 effect 依赖：id 来自用户可控的配置名 / 文件名（POSIX 允许
  // `|`、空串），join("|") 会把它们拆错、吞掉或让两个不同数组撞出同一签名。
  const orderedIdsSignature = JSON.stringify(orderedIds);

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
    if (previousResetKeyRef.current !== resetKey) {
      previousResetKeyRef.current = resetKey;
      for (const animation of Object.values(animationRefs.current)) {
        animation?.cancel();
      }
      for (const itemId of Object.keys(animationRefs.current)) {
        delete animationRefs.current[itemId];
      }
      previousRectsRef.current = {};
    }
  }, [resetKey]);

  useLayoutEffect(() => {
    const nextRects: Record<string, DOMRect> = {};
    // 从 dep 跟踪的签名派生迭代列表：orderedIds 参数本身每次渲染都可能是新数组，
    // 签名在内容不变时保持稳定；JSON 往返无损，含 `|` 的 id、空串 id 与
    // 不同数组都能原样还原，避免用分隔符切分时丢失或碰撞。
    const effectOrderedIds = JSON.parse(orderedIdsSignature) as string[];

    for (const itemId of effectOrderedIds) {
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
      const startTop = visualRect?.top ?? previousRect?.top ?? layoutRect.top;
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

      animation.onfinish = clearAnimationRef;
      animation.oncancel = clearAnimationRef;
    }

    previousRectsRef.current = nextRects;
  }, [draggingItemId, orderedIdsSignature, reducedMotionRef, settledItemId]);

  useEffect(() => {
    const activeAnimationRefs = animationRefs.current;
    return () => {
      for (const animation of Object.values(activeAnimationRefs)) {
        animation?.cancel();
      }
      for (const itemId of Object.keys(activeAnimationRefs)) {
        delete activeAnimationRefs[itemId];
      }
    };
  }, []);

  return {
    setItemRef,
  };
}
