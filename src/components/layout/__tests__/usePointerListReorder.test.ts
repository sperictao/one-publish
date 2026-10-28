import { act, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  usePointerListReorder,
  type PointerListDropTarget,
  type PointerListPointer,
} from "@/components/layout/usePointerListReorder";

type Meta = { label: string };

const rect = (top: number, height = 50): DOMRect =>
  ({
    left: 0,
    top,
    width: 100,
    height,
    right: 100,
    bottom: top + height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

function makeNode(r: DOMRect, animations: { cancel: () => void }[] = []) {
  return {
    getBoundingClientRect: () => r,
    getAnimations: () => animations,
  } as unknown as HTMLElement;
}

function pointerEvent(
  clientX: number,
  clientY: number,
  currentTarget?: HTMLElement
) {
  return {
    clientX,
    clientY,
    currentTarget: currentTarget ?? ({} as HTMLElement),
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.PointerEvent<HTMLElement>;
}

function setup(options: {
  enabled?: boolean;
  onCommit?: (
    activeItemId: string,
    target: PointerListDropTarget<Meta>
  ) => void;
  onEnd?: (result: {
    activeItemId: string | null;
    target: PointerListDropTarget<Meta> | null;
    pointer: PointerListPointer | null;
  }) => void;
  onStart?: () => void;
}) {
  const onCommit = vi.fn(options.onCommit ?? (() => {}));
  const onEnd = vi.fn(options.onEnd ?? (() => {}));
  const onStart = vi.fn(options.onStart ?? (() => {}));
  const hook = renderHook(() =>
    usePointerListReorder<Meta>({
      enabled: options.enabled ?? true,
      onCommit,
      onEnd,
      onStart,
    })
  );
  return { ...hook, onCommit, onEnd, onStart };
}

function register(
  result: { current: ReturnType<typeof usePointerListReorder<Meta>> },
  entries: [string, Meta, HTMLElement][]
) {
  act(() => {
    for (const [id, meta, node] of entries) {
      result.current.setItemRef(id, meta)(node);
    }
  });
}

describe("usePointerListReorder", () => {
  const metaA = { label: "A" };
  const metaB = { label: "B" };
  const metaC = { label: "C" };
  let nodeA: HTMLElement;
  let nodeB: HTMLElement;
  let nodeC: HTMLElement;

  beforeEach(() => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    nodeA = makeNode(rect(0));
    nodeB = makeNode(rect(60));
    nodeC = makeNode(rect(120));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  });

  it("enabled=false 时 startDrag 不生效", () => {
    const onStart = vi.fn();
    const { result } = setup({ enabled: false, onStart });
    register(result, [["A", metaA, nodeA]]);

    act(() => {
      result.current.startDrag("A", pointerEvent(10, 25));
    });

    expect(result.current.draggingItemId).toBeNull();
    expect(onStart).not.toHaveBeenCalled();
  });

  it("未注册且无最近行节点时 startDrag 提前返回", () => {
    const currentTarget = {
      closest: vi.fn().mockReturnValue(null),
    } as unknown as HTMLElement;
    const { result, onStart } = setup({});

    act(() => {
      result.current.startDrag("ghost", pointerEvent(10, 25, currentTarget));
    });

    expect(result.current.draggingItemId).toBeNull();
    expect(onStart).not.toHaveBeenCalled();
  });

  it("startDrag 取消行内动画并初始化拖拽状态", () => {
    const animation = { cancel: vi.fn() };
    nodeA = makeNode(rect(0), [animation]);
    const { result, onStart } = setup({});
    register(result, [["A", metaA, nodeA]]);

    act(() => {
      result.current.startDrag("A", pointerEvent(10, 25));
    });

    expect(animation.cancel).toHaveBeenCalled();
    expect(result.current.draggingItemId).toBe("A");
    expect(result.current.dragPointer).toEqual({ x: 10, y: 25 });
    expect(result.current.dragAnchor).toEqual({ x: 10, y: 25 });
    expect(result.current.draggedItemSize).toEqual({ width: 100, height: 50 });
    expect(result.current.dragPreviewStyle?.transform).toBe(
      "translate3d(0px, 0px, 0)"
    );
    expect(document.body.style.userSelect).toBe("none");
    expect(document.body.style.cursor).toBe("grabbing");
    expect(onStart).toHaveBeenCalled();
  });

  it("拖拽到下一位目标并在抬起时提交", () => {
    const { result, onCommit, onEnd } = setup({});
    register(result, [
      ["A", metaA, nodeA],
      ["B", metaB, nodeB],
      ["C", metaC, nodeC],
    ]);

    act(() => {
      result.current.startDrag("A", pointerEvent(10, 25));
    });
    act(() => {
      fireEvent.pointerMove(window, { clientX: 10, clientY: 80 });
    });

    expect(result.current.liveTarget).toEqual({
      itemId: "B",
      position: "before",
      meta: metaB,
    });
    expect(result.current.dragDirection).toBe("down");

    act(() => {
      fireEvent.pointerUp(window, { clientX: 10, clientY: 80 });
    });

    expect(onCommit).toHaveBeenCalledWith("A", {
      itemId: "B",
      position: "before",
      meta: metaB,
    });
    expect(onEnd).toHaveBeenCalledWith({
      activeItemId: "A",
      target: { itemId: "B", position: "before", meta: metaB },
      pointer: { x: 10, y: 80 },
    });
    expect(result.current.draggingItemId).toBeNull();
    expect(result.current.liveTarget).toBeNull();
    expect(document.body.style.userSelect).toBe("");
    expect(document.body.style.cursor).toBe("");
  });

  it("同一目标重复移动保持引用，回到锚点不更新预览偏移", () => {
    const { result } = setup({});
    register(result, [
      ["A", metaA, nodeA],
      ["B", metaB, nodeB],
    ]);

    act(() => {
      result.current.startDrag("A", pointerEvent(10, 25));
    });
    act(() => {
      fireEvent.pointerMove(window, { clientX: 10, clientY: 80 });
    });
    const firstTarget = result.current.liveTarget;
    const firstOffset = result.current.dragPreviewStyle;

    // 移回拖拽起始坐标：投影回到锚点，nextOffset 与当前值一致，
    // 命中 <0.5px 去重臂；落点仍解析为同一目标，命中引用去重。
    act(() => {
      fireEvent.pointerMove(window, { clientX: 10, clientY: 25 });
    });

    expect(result.current.liveTarget).toBe(firstTarget);
    expect(result.current.dragPreviewStyle).toBe(firstOffset);
  });

  it("重复指针坐标不更新指针状态", () => {
    const { result } = setup({});
    register(result, [
      ["A", metaA, nodeA],
      ["B", metaB, nodeB],
    ]);

    act(() => {
      result.current.startDrag("A", pointerEvent(10, 25));
    });
    act(() => {
      fireEvent.pointerMove(window, { clientX: 10, clientY: 80 });
    });
    const firstPointer = result.current.dragPointer;

    act(() => {
      fireEvent.pointerMove(window, { clientX: 10, clientY: 80 });
    });

    expect(result.current.dragPointer).toBe(firstPointer);
  });

  it("向上移动记录 dragDirection=up", () => {
    const { result } = setup({});
    register(result, [
      ["A", metaA, nodeA],
      ["B", metaB, nodeB],
    ]);

    act(() => {
      result.current.startDrag("A", pointerEvent(10, 25));
    });
    act(() => {
      fireEvent.pointerMove(window, { clientX: 10, clientY: 80 });
    });
    act(() => {
      fireEvent.pointerMove(window, { clientX: 10, clientY: 40 });
    });

    expect(result.current.dragDirection).toBe("up");
  });

  it("拖拽行节点被卸载时回落到初始矩形继续计算", () => {
    const { result } = setup({});
    register(result, [
      ["A", metaA, nodeA],
      ["B", metaB, nodeB],
    ]);

    act(() => {
      result.current.startDrag("A", pointerEvent(10, 25));
    });
    act(() => {
      result.current.setItemRef("A", metaA)(null);
    });
    act(() => {
      fireEvent.pointerMove(window, { clientX: 10, clientY: 80 });
    });

    expect(result.current.liveTarget).toEqual({
      itemId: "B",
      position: "before",
      meta: metaB,
    });
  });

  it("零尺寸候选节点不参与目标计算", () => {
    const zeroNode = makeNode(rect(60, 0));
    const { result, onCommit } = setup({});
    register(result, [
      ["A", metaA, nodeA],
      ["B", metaB, zeroNode],
      ["C", metaC, nodeC],
    ]);

    act(() => {
      result.current.startDrag("A", pointerEvent(10, 25));
    });
    act(() => {
      fireEvent.pointerMove(window, { clientX: 10, clientY: 160 });
    });

    expect(result.current.liveTarget).toEqual({
      itemId: "C",
      position: "after",
      meta: metaC,
    });

    act(() => {
      fireEvent.pointerUp(window, { clientX: 10, clientY: 160 });
    });
    expect(onCommit).toHaveBeenCalledWith("A", {
      itemId: "C",
      position: "after",
      meta: metaC,
    });
  });

  it("无目标抬起时只回调 onEnd 不提交", () => {
    const { result, onCommit, onEnd } = setup({});
    register(result, [["A", metaA, nodeA]]);

    act(() => {
      result.current.startDrag("A", pointerEvent(10, 25));
    });
    act(() => {
      fireEvent.pointerUp(window, { clientX: 10, clientY: 25 });
    });

    expect(onCommit).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledWith({
      activeItemId: "A",
      target: null,
      pointer: { x: 10, y: 25 },
    });
  });

  it("clearDragState 复位全部状态并移除全局监听", () => {
    const { result, onCommit } = setup({});
    register(result, [
      ["A", metaA, nodeA],
      ["B", metaB, nodeB],
    ]);

    act(() => {
      result.current.startDrag("A", pointerEvent(10, 25));
    });
    act(() => {
      result.current.clearDragState();
    });

    expect(result.current.draggingItemId).toBeNull();
    expect(result.current.dragPointer).toBeNull();
    expect(result.current.dragAnchor).toBeNull();
    expect(result.current.draggedItemSize).toBeNull();
    expect(result.current.dragDirection).toBeNull();
    expect(result.current.dragPreviewStyle).toBeUndefined();
    expect(document.body.style.userSelect).toBe("");

    act(() => {
      fireEvent.pointerMove(window, { clientX: 10, clientY: 80 });
      fireEvent.pointerUp(window, { clientX: 10, clientY: 80 });
    });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("移动到不同目标时 liveTarget 切换为新目标", () => {
    const { result } = setup({});
    register(result, [
      ["A", metaA, nodeA],
      ["B", metaB, nodeB],
      ["C", metaC, nodeC],
    ]);

    act(() => {
      result.current.startDrag("A", pointerEvent(10, 25));
    });
    act(() => {
      fireEvent.pointerMove(window, { clientX: 10, clientY: 80 });
    });
    expect(result.current.liveTarget?.itemId).toBe("B");

    act(() => {
      fireEvent.pointerMove(window, { clientX: 10, clientY: 160 });
    });
    expect(result.current.liveTarget).toEqual({
      itemId: "C",
      position: "after",
      meta: metaC,
    });
  });

  it("blur 事件收尾时使用最后记录的指针位置", () => {
    const { result, onEnd } = setup({});
    register(result, [["A", metaA, nodeA]]);

    act(() => {
      result.current.startDrag("A", pointerEvent(10, 25));
    });
    act(() => {
      fireEvent.pointerMove(window, { clientX: 10, clientY: 60 });
    });
    act(() => {
      fireEvent(window, new FocusEvent("blur"));
    });

    expect(onEnd).toHaveBeenCalledWith({
      activeItemId: "A",
      target: null,
      pointer: { x: 10, y: 60 },
    });
    expect(result.current.draggingItemId).toBeNull();
  });

  it("pointercancel 走同一收尾流程", () => {
    const { result, onEnd, onCommit } = setup({});
    register(result, [["A", metaA, nodeA]]);

    act(() => {
      result.current.startDrag("A", pointerEvent(10, 25));
    });
    act(() => {
      fireEvent(
        window,
        new MouseEvent("pointercancel", { clientX: 10, clientY: 30 })
      );
    });

    expect(onEnd).toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(result.current.draggingItemId).toBeNull();
  });

  it("blur 事件回落到最后已知指针位置收尾", () => {
    const { result, onEnd } = setup({});
    register(result, [["A", metaA, nodeA]]);

    act(() => {
      result.current.startDrag("A", pointerEvent(10, 25));
    });
    act(() => {
      fireEvent.pointerMove(window, { clientX: 10, clientY: 80 });
    });
    act(() => {
      fireEvent(window, new FocusEvent("blur"));
    });

    expect(onEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        activeItemId: "A",
        pointer: { x: 10, y: 80 },
      })
    );
    expect(result.current.draggingItemId).toBeNull();
  });

  it("卸载时清理全局监听", () => {
    const { result, unmount } = setup({});
    register(result, [["A", metaA, nodeA]]);

    act(() => {
      result.current.startDrag("A", pointerEvent(10, 25));
    });
    unmount();

    expect(document.body.style.userSelect).toBe("");
    expect(document.body.style.cursor).toBe("");
  });
});
