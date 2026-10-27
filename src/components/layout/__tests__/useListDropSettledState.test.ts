import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useListDropSettledState } from "@/components/layout/useListDropSettledState";

describe("useListDropSettledState", () => {
  it("无落点或活动项时不产生 settled 项", () => {
    const { result } = renderHook(() => useListDropSettledState<string>());

    act(() => {
      result.current.settleFromDragEnd(
        { activeItemId: "a", target: null, pointer: { x: 1, y: 1 } },
        (id) => id
      );
    });

    expect(result.current.settledItemId).toBeNull();
  });

  it("落点 settle 后小半径内指针重入被忽略、超出则放行", () => {
    const { result } = renderHook(() => useListDropSettledState<string>());

    act(() => {
      result.current.settleFromDragEnd(
        {
          activeItemId: "a",
          target: { itemId: "b", position: "after", meta: undefined },
          pointer: { x: 10, y: 20 },
        },
        (id) => `settled-${id}`
      );
    });

    expect(result.current.settledItemId).toBe("settled-a");
    expect(result.current.shouldIgnorePointerReentry({ x: 11, y: 21 })).toBe(
      true
    );
    expect(result.current.shouldIgnorePointerReentry({ x: 30, y: 20 })).toBe(
      false
    );
  });

  it("clearSettledItem 清空后指针重入不再被忽略", () => {
    const { result } = renderHook(() => useListDropSettledState<string>());

    act(() => {
      result.current.setSettledItem("a", { x: 5, y: 5 });
    });
    act(() => {
      result.current.clearSettledItem();
    });

    expect(result.current.settledItemId).toBeNull();
    expect(result.current.shouldIgnorePointerReentry({ x: 5, y: 5 })).toBe(
      false
    );
  });

  it("resetKey 变化时重置 settled 状态", () => {
    const { result, rerender } = renderHook(
      ({ resetKey }) => useListDropSettledState<string>({ resetKey }),
      { initialProps: { resetKey: "r1" } }
    );

    act(() => {
      result.current.setSettledItem("a", { x: 5, y: 5 });
    });
    expect(result.current.settledItemId).toBe("a");

    rerender({ resetKey: "r2" });

    expect(result.current.settledItemId).toBeNull();
    expect(result.current.shouldIgnorePointerReentry({ x: 5, y: 5 })).toBe(
      false
    );
  });

  it("null itemId 清指针且同 id 复用状态", () => {
    const { result } = renderHook(() => useListDropSettledState<string>());

    act(() => {
      result.current.setSettledItem("a", { x: 5, y: 5 });
    });
    const firstId = result.current.settledItemId;
    act(() => {
      result.current.setSettledItem("a", { x: 9, y: 9 });
    });
    expect(result.current.settledItemId).toBe(firstId);

    act(() => {
      result.current.setSettledItem(null, { x: 9, y: 9 });
    });
    expect(result.current.settledItemId).toBeNull();
    expect(result.current.shouldIgnorePointerReentry({ x: 9, y: 9 })).toBe(
      false
    );
  });

  it("无 settled 状态时 reset/clear 保持空态", () => {
    const { result, rerender } = renderHook(
      ({ resetKey }) => useListDropSettledState<string>({ resetKey }),
      { initialProps: { resetKey: "r1" } }
    );

    act(() => {
      result.current.clearSettledItem();
    });
    rerender({ resetKey: "r2" });

    expect(result.current.settledItemId).toBeNull();
  });
});
