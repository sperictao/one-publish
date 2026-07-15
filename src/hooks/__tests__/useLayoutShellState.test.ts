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
    const { result } = renderHook((props: HookProps) => useLayoutShellState(props), {
      initialProps: createProps({ setLeftPanelWidth }),
    });

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
    const { result } = renderHook((props: HookProps) => useLayoutShellState(props), {
      initialProps: createProps({ setMiddlePanelWidth }),
    });

    const frozenResize = result.current.handleMiddlePanelResize;

    act(() => frozenResize(-20));
    act(() => frozenResize(-20));

    expect(setMiddlePanelWidth).toHaveBeenLastCalledWith(240);
  });

  it("累加结果被钳制在 [150, 400] 区间", () => {
    const setLeftPanelWidth = vi.fn();
    const { result } = renderHook((props: HookProps) => useLayoutShellState(props), {
      initialProps: createProps({ setLeftPanelWidth }),
    });

    const frozenResize = result.current.handleLeftPanelResize;

    act(() => frozenResize(-500));
    expect(setLeftPanelWidth).toHaveBeenLastCalledWith(150);

    act(() => frozenResize(1000));
    expect(setLeftPanelWidth).toHaveBeenLastCalledWith(400);
  });

  it("未自定义宽度时首次拖拽以自动宽度为基准，不跳变到 store 默认值", () => {
    const setLeftPanelWidth = vi.fn();
    const autoWidth = Math.max(150, Math.min(400, Math.round(window.innerWidth * 0.2)));
    const { result } = renderHook((props: HookProps) => useLayoutShellState(props), {
      initialProps: createProps({ panelWidthsCustomized: false, setLeftPanelWidth }),
    });

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
});
