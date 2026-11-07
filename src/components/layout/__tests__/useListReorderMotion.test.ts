import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useListReorderMotion } from "@/components/layout/useListReorderMotion";

type FakeAnimation = {
  cancel: ReturnType<typeof vi.fn>;
  onfinish: (() => void) | null;
  oncancel: (() => void) | null;
};

function makeNode(initialTop: number) {
  const pos = { top: initialTop, visualOffset: 0 };
  const animations: FakeAnimation[] = [];
  const el = document.createElement("div");
  // 活动动画的 transform 会体现在 getBoundingClientRect：用 keyframe 位移模拟视觉位置。
  el.getBoundingClientRect = vi.fn(
    () => ({ top: pos.top + pos.visualOffset }) as DOMRect
  );
  el.animate = vi.fn((keyframes: Keyframe[]) => {
    const match = /translate3d\(0, ([-\d.]+)px/.exec(
      String(keyframes[0]?.transform ?? "")
    );
    pos.visualOffset = match ? Number.parseFloat(match[1]) : 0;
    const anim: FakeAnimation = {
      cancel: vi.fn(() => {
        pos.visualOffset = 0;
      }),
      onfinish: null,
      oncancel: null,
    };
    animations.push(anim);
    return anim as unknown as Animation;
  });
  return { el, pos, animations };
}

function renderReorder() {
  return renderHook(
    (props: { orderedIds: string[]; draggingItemId: string | null }) =>
      useListReorderMotion(props),
    {
      initialProps: {
        orderedIds: ["a", "b"],
        draggingItemId: null,
      } as { orderedIds: string[]; draggingItemId: string | null },
    }
  );
}

// 首个 layout effect 早于 ref 挂载运行；用 draggingItemId dep 翻转触发重跑以录入基线 rect。
function seedBaselineRects(
  rerender: (props: {
    orderedIds: string[];
    draggingItemId: string | null;
  }) => void
) {
  rerender({ orderedIds: ["a", "b"], draggingItemId: "seed" });
}

describe("useListReorderMotion", () => {
  it("skips ordered ids that never mounted an item ref", () => {
    const nodeA = makeNode(0);
    const nodeB = makeNode(40);
    const { result, rerender } = renderReorder();

    result.current.setItemRef("a")(nodeA.el);
    result.current.setItemRef("b")(nodeB.el);
    seedBaselineRects(rerender);
    nodeB.pos.top = 0;
    nodeA.pos.top = 40;
    rerender({ orderedIds: ["b", "ghost", "a"], draggingItemId: null });

    expect(nodeB.el.animate).toHaveBeenCalledTimes(1);
    expect(nodeA.el.animate).toHaveBeenCalledTimes(1);
  });

  it("maps travel distance through the sqrt-normalized duration curve", () => {
    const nodeA = makeNode(0);
    const nodeB = makeNode(40);
    const { result, rerender } = renderReorder();

    result.current.setItemRef("a")(nodeA.el);
    result.current.setItemRef("b")(nodeB.el);
    seedBaselineRects(rerender);
    nodeB.pos.top = 0;
    nodeA.pos.top = 40;
    rerender({ orderedIds: ["b", "a"], draggingItemId: null });

    const expected = Math.round(150 + (230 - 150) * Math.sqrt(40 / 140));
    for (const node of [nodeA, nodeB]) {
      const options = (node.el.animate as ReturnType<typeof vi.fn>).mock
        .calls[0][1] as KeyframeAnimationOptions;
      expect(options.duration).toBe(expected);
    }
  });

  it("clamps the reorder duration at moveMax for overshoot distances", () => {
    const nodeA = makeNode(0);
    const nodeB = makeNode(500);
    const { result, rerender } = renderReorder();

    result.current.setItemRef("a")(nodeA.el);
    result.current.setItemRef("b")(nodeB.el);
    seedBaselineRects(rerender);
    nodeB.pos.top = 0;
    nodeA.pos.top = 500;
    rerender({ orderedIds: ["b", "a"], draggingItemId: null });

    for (const node of [nodeA, nodeB]) {
      const options = (node.el.animate as ReturnType<typeof vi.fn>).mock
        .calls[0][1] as KeyframeAnimationOptions;
      expect(options.duration).toBe(230);
    }
  });

  it("clears the animation ref once the active animation finishes", () => {
    const nodeA = makeNode(0);
    const nodeB = makeNode(40);
    const { result, rerender } = renderReorder();

    result.current.setItemRef("a")(nodeA.el);
    result.current.setItemRef("b")(nodeB.el);
    seedBaselineRects(rerender);
    nodeB.pos.top = 0;
    nodeA.pos.top = 40;
    rerender({ orderedIds: ["b", "a"], draggingItemId: null });
    expect(nodeA.animations).toHaveLength(1);

    nodeA.animations[0].onfinish?.();
    (nodeA.el.getBoundingClientRect as ReturnType<typeof vi.fn>).mockClear();
    nodeA.pos.top = 0;
    nodeB.pos.top = 40;
    rerender({ orderedIds: ["a", "b"], draggingItemId: "next" });

    // 动画 ref 已清 → 重排只做 layoutRect 一次测量，不再为 visualRect 额外采样。
    expect(nodeA.el.getBoundingClientRect).toHaveBeenCalledTimes(1);
  });

  it("keeps a newer animation ref when a stale animation finishes", () => {
    const nodeA = makeNode(0);
    const nodeB = makeNode(40);
    const { result, rerender, unmount } = renderReorder();

    result.current.setItemRef("a")(nodeA.el);
    result.current.setItemRef("b")(nodeB.el);
    seedBaselineRects(rerender);
    nodeB.pos.top = 0;
    nodeA.pos.top = 40;
    rerender({ orderedIds: ["b", "a"], draggingItemId: null });
    nodeB.pos.top = 40;
    nodeA.pos.top = 0;
    rerender({ orderedIds: ["a", "b"], draggingItemId: "next" });
    expect(nodeB.animations).toHaveLength(2);

    nodeB.animations[0].onfinish?.();
    unmount();

    expect(nodeB.animations[1].cancel).toHaveBeenCalled();
  });

  it("drops the item ref when the callback receives null", () => {
    const nodeA = makeNode(0);
    const nodeB = makeNode(40);
    const { result, rerender } = renderReorder();

    result.current.setItemRef("a")(nodeA.el);
    result.current.setItemRef("b")(nodeB.el);
    seedBaselineRects(rerender);
    result.current.setItemRef("a")(null);
    nodeB.pos.top = 0;
    rerender({ orderedIds: ["b", "a"], draggingItemId: null });

    expect(nodeA.el.animate).not.toHaveBeenCalled();
    expect(nodeB.el.animate).toHaveBeenCalledTimes(1);
  });

  it("cancels in-flight animations and resets rects when resetKey changes", () => {
    const nodeA = makeNode(0);
    const nodeB = makeNode(40);
    const { rerender, result } = renderHook(
      (props: {
        orderedIds: string[];
        resetKey: string;
        settledItemId: string | null;
      }) => useListReorderMotion({ ...props, draggingItemId: null }),
      {
        initialProps: {
          orderedIds: ["a", "b"],
          resetKey: "r1",
          settledItemId: null,
        } as {
          orderedIds: string[];
          resetKey: string;
          settledItemId: string | null;
        },
      }
    );

    result.current.setItemRef("a")(nodeA.el);
    result.current.setItemRef("b")(nodeB.el);
    rerender({ orderedIds: ["a", "b"], resetKey: "r1", settledItemId: "seed" });
    nodeB.pos.top = 0;
    nodeA.pos.top = 40;
    rerender({ orderedIds: ["b", "a"], resetKey: "r1", settledItemId: null });
    expect(nodeB.animations).toHaveLength(1);

    rerender({ orderedIds: ["b", "a"], resetKey: "r2", settledItemId: null });
    expect(nodeB.animations[0].cancel).toHaveBeenCalled();

    // 基线已清空 → 新 resetKey 下重排不再补间。
    nodeB.pos.top = 40;
    rerender({ orderedIds: ["a", "b"], resetKey: "r2", settledItemId: null });
    expect(nodeB.animations).toHaveLength(1);
  });

  it("tolerates an empty ordered id list", () => {
    const { rerender } = renderReorder();
    rerender({ orderedIds: [], draggingItemId: null });
  });

  describe("ordered id signature round-trip", () => {
    it("keeps an id containing the delimiter in the effect list", () => {
      // .pubxml 配置名来自文件名（POSIX 允许 `|`），会以 `pubxml:<name>` 作为 id。
      const pipedId = "pubxml:Release|Win";
      const node = makeNode(0);
      const { result, rerender } = renderHook(
        (props: { orderedIds: string[]; draggingItemId: string | null }) =>
          useListReorderMotion(props),
        {
          initialProps: {
            orderedIds: [pipedId],
            draggingItemId: null,
          } as { orderedIds: string[]; draggingItemId: string | null },
        }
      );

      result.current.setItemRef(pipedId)(node.el);
      // 首个 layout effect 早于 ref 挂载；翻转 dep 触发重跑以录入基线 rect。
      rerender({ orderedIds: [pipedId], draggingItemId: "seed" });
      node.pos.top = 40;
      rerender({ orderedIds: [pipedId], draggingItemId: null });

      expect(node.el.getBoundingClientRect).toHaveBeenCalled();
      expect(node.el.animate).toHaveBeenCalledTimes(1);
    });

    it("keeps a single empty-string id instead of treating it as an empty list", () => {
      const node = makeNode(0);
      const { result, rerender } = renderHook(
        (props: { orderedIds: string[]; draggingItemId: string | null }) =>
          useListReorderMotion(props),
        {
          initialProps: {
            orderedIds: [""],
            draggingItemId: null,
          } as { orderedIds: string[]; draggingItemId: string | null },
        }
      );

      result.current.setItemRef("")(node.el);
      rerender({ orderedIds: [""], draggingItemId: "seed" });
      node.pos.top = 40;
      rerender({ orderedIds: [""], draggingItemId: null });

      expect(node.el.animate).toHaveBeenCalledTimes(1);
    });

    it("reruns when two different id arrays share the same joined text", () => {
      const node = makeNode(0);
      const { result, rerender } = renderHook(
        (props: { orderedIds: string[]; draggingItemId: string | null }) =>
          useListReorderMotion(props),
        {
          initialProps: {
            orderedIds: ["a", "b"],
            draggingItemId: null,
          } as { orderedIds: string[]; draggingItemId: string | null },
        }
      );

      result.current.setItemRef("a|b")(node.el);
      const rectSpy = node.el.getBoundingClientRect as ReturnType<typeof vi.fn>;
      rectSpy.mockClear();
      // 旧签名 ["a","b"].join("|") === ["a|b"].join("|")，effect 不会重跑；
      // 可逆编码下签名变化，必须为这个 id 重新采集 rect。
      rerender({ orderedIds: ["a|b"], draggingItemId: null });

      expect(rectSpy).toHaveBeenCalled();
    });
  });

  it("skips the dragged item and nodes without animate support", () => {
    const nodeA = makeNode(0);
    const nodeB = makeNode(40);
    const nodeC = makeNode(80);
    const { rerender, result } = renderHook(
      (props: { orderedIds: string[]; draggingItemId: string | null }) =>
        useListReorderMotion(props),
      {
        initialProps: { orderedIds: ["a", "b", "c"], draggingItemId: null },
      } as {
        initialProps: { orderedIds: string[]; draggingItemId: string | null };
      }
    );
    nodeC.el.animate = undefined as unknown as HTMLElement["animate"];

    result.current.setItemRef("a")(nodeA.el);
    result.current.setItemRef("b")(nodeB.el);
    result.current.setItemRef("c")(nodeC.el);
    rerender({ orderedIds: ["a", "b", "c"], draggingItemId: "seed" });
    nodeB.pos.top = 0;
    nodeA.pos.top = 40;
    nodeC.pos.top = 40;
    rerender({ orderedIds: ["b", "a", "c"], draggingItemId: "a" });

    expect(nodeA.el.animate).not.toHaveBeenCalled();
    expect(nodeB.el.animate).toHaveBeenCalledTimes(1);
    expect(nodeC.animations).toHaveLength(0);
  });
});
