import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatElapsed,
  useElapsedTimer,
} from "@/features/publish/useElapsedTimer";

describe("formatElapsed", () => {
  it("格式化为 mm:ss", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(5_000)).toBe("00:05");
    expect(formatElapsed(65_000)).toBe("01:05");
    expect(formatElapsed(600_000)).toBe("10:00");
  });

  it("负值与不足一秒归零", () => {
    expect(formatElapsed(-100)).toBe("00:00");
    expect(formatElapsed(999)).toBe("00:00");
  });
});

describe("useElapsedTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("active=false 时保持 0 且不起定时器", () => {
    const { result } = renderHook(() => useElapsedTimer(false));
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current).toBe(0);
  });

  it("active 后按秒累加单调时钟差值", () => {
    const { result } = renderHook(() => useElapsedTimer(true));
    act(() => {
      vi.advanceTimersByTime(2_500);
    });
    expect(result.current).toBeGreaterThanOrEqual(2_000);
  });

  it("active 翻 false 停表，再翻 true 归零重计", () => {
    const { result, rerender } = renderHook(
      ({ active }) => useElapsedTimer(active),
      { initialProps: { active: true } }
    );
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(result.current).toBeGreaterThanOrEqual(2_000);

    rerender({ active: false });
    const stopped = result.current;
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current).toBe(stopped);

    rerender({ active: true });
    expect(result.current).toBe(0);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current).toBeGreaterThanOrEqual(1_000);
    expect(result.current).toBeLessThan(stopped + 10_000);
  });

  it("卸载后不再触发 setState", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = renderHook(() => useElapsedTimer(true));
    unmount();
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
