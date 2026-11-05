import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLayoutShellState } from "@/hooks/useLayoutShellState";

type HookProps = Parameters<typeof useLayoutShellState>[0];

function createProps(overrides: Partial<HookProps> = {}): HookProps {
  return {
    panelWidthsCustomized: true,
    leftPanelWidth: 220,
    middlePanelWidth: 280,
    setLeftPanelWidth: vi.fn(),
    setMiddlePanelWidth: vi.fn(),
    ...overrides,
  };
}

describe("useLayoutShellState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("同一次拖拽中连续增量 delta 应累加（复现 document 监听持有冻结回调）", () => {
    const setLeftPanelWidth = vi.fn();
    const { result } = renderHook(
      (props: HookProps) => useLayoutShellState(props),
      {
        initialProps: createProps({ setLeftPanelWidth }),
      }
    );

    // ResizeHandle 在 mousedown 时将 handleMouseMove 注册到 document，
    // 整个拖拽序列复用同一个 onResize 引用——这里捕获一次以模拟该行为
    const frozenResize = result.current.handleLeftPanelResize;

    act(() => frozenResize(10));
    act(() => frozenResize(10));
    act(() => frozenResize(10));

    expect(setLeftPanelWidth).toHaveBeenLastCalledWith(250);
  });

  it("中栏拖拽同样累加增量 delta", () => {
    const setMiddlePanelWidth = vi.fn();
    const { result } = renderHook(
      (props: HookProps) => useLayoutShellState(props),
      {
        initialProps: createProps({ setMiddlePanelWidth }),
      }
    );

    const frozenResize = result.current.handleMiddlePanelResize;

    act(() => frozenResize(-20));
    act(() => frozenResize(-20));

    expect(setMiddlePanelWidth).toHaveBeenLastCalledWith(240);
  });

  it("累加结果被钳制在 [150, 400] 区间", () => {
    const setLeftPanelWidth = vi.fn();
    const { result } = renderHook(
      (props: HookProps) => useLayoutShellState(props),
      {
        initialProps: createProps({ setLeftPanelWidth }),
      }
    );

    const frozenResize = result.current.handleLeftPanelResize;

    act(() => frozenResize(-500));
    expect(setLeftPanelWidth).toHaveBeenLastCalledWith(150);

    act(() => frozenResize(1000));
    expect(setLeftPanelWidth).toHaveBeenLastCalledWith(400);
  });

  it("未自定义宽度时首次拖拽以自动宽度为基准，不跳变到 store 默认值", () => {
    const setLeftPanelWidth = vi.fn();
    const autoWidth = Math.max(
      150,
      Math.min(400, Math.round(window.innerWidth * 0.2))
    );
    const { result } = renderHook(
      (props: HookProps) => useLayoutShellState(props),
      {
        initialProps: createProps({
          panelWidthsCustomized: false,
          setLeftPanelWidth,
        }),
      }
    );

    expect(result.current.effectiveLeftPanelWidth).toBe(autoWidth);

    act(() => result.current.handleLeftPanelResize(10));

    expect(setLeftPanelWidth).toHaveBeenLastCalledWith(autoWidth + 10);
  });

  it("外部更新宽度后，新一次拖拽以最新宽度为基准", () => {
    const setLeftPanelWidth = vi.fn();
    const { result, rerender } = renderHook(
      (props: HookProps) => useLayoutShellState(props),
      { initialProps: createProps({ setLeftPanelWidth }) }
    );

    rerender(createProps({ leftPanelWidth: 300, setLeftPanelWidth }));

    act(() => result.current.handleLeftPanelResize(10));

    expect(setLeftPanelWidth).toHaveBeenLastCalledWith(310);
  });

  describe("已持久化的自定义宽度", () => {
    it("越界宽度在渲染前被钳制到 [150, 400]，而不是直接写成 px", () => {
      const { result } = renderHook(
        (props: HookProps) => useLayoutShellState(props),
        {
          initialProps: createProps({
            leftPanelWidth: 5000,
            middlePanelWidth: -30,
          }),
        }
      );

      expect(result.current.effectiveLeftPanelWidth).toBe(400);
      expect(result.current.effectiveMiddlePanelWidth).toBe(150);
    });

    it("非有限宽度回退到最小宽度，避免 NaNpx / Infinitypx", () => {
      const invalidWidths = [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
      ];

      for (const invalidWidth of invalidWidths) {
        const { result, unmount } = renderHook(
          (props: HookProps) => useLayoutShellState(props),
          { initialProps: createProps({ leftPanelWidth: invalidWidth }) }
        );

        expect(result.current.effectiveLeftPanelWidth).toBe(150);
        unmount();
      }
    });

    it("下一次拖拽以钳制后的宽度为基准，不发生跳变", () => {
      const setLeftPanelWidth = vi.fn();
      const { result } = renderHook(
        (props: HookProps) => useLayoutShellState(props),
        {
          initialProps: createProps({
            leftPanelWidth: 5000,
            setLeftPanelWidth,
          }),
        }
      );

      act(() => result.current.handleLeftPanelResize(-10));

      expect(setLeftPanelWidth).toHaveBeenLastCalledWith(390);
    });
  });

  describe("resize 监听", () => {
    it("卸载时移除 resize 监听", () => {
      const removeSpy = vi.spyOn(window, "removeEventListener");
      const { unmount } = renderHook(() =>
        useLayoutShellState(createProps({ panelWidthsCustomized: false }))
      );

      unmount();
      expect(removeSpy).toHaveBeenCalledWith("resize", expect.any(Function));
      removeSpy.mockRestore();
    });
  });
});
