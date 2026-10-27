import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useReducedMotion } from "@/components/layout/useReducedMotion";

const originalMatchMedia = window.matchMedia;

function setMatchMedia(
  mql: Partial<MediaQueryList> & { matches: boolean }
): MediaQueryList {
  const list = { media: "(prefers-reduced-motion: reduce)" };
  Object.defineProperties(list, Object.getOwnPropertyDescriptors(mql));
  Object.defineProperty(window, "matchMedia", {
    value: vi.fn().mockReturnValue(list),
    configurable: true,
    writable: true,
  });
  return list as MediaQueryList;
}

afterEach(() => {
  Object.defineProperty(window, "matchMedia", {
    value: originalMatchMedia,
    configurable: true,
    writable: true,
  });
});

describe("useReducedMotion", () => {
  it("tracks the media query and reacts to change events", () => {
    const listeners = new Set<(e: MediaQueryListEvent) => void>();
    const state = { matches: false };
    const mql = setMatchMedia({
      get matches() {
        return state.matches;
      },
      addEventListener: vi.fn(
        (_: string, l: (e: MediaQueryListEvent) => void) => listeners.add(l)
      ) as MediaQueryList["addEventListener"],
      removeEventListener: vi.fn(
        (_: string, l: (e: MediaQueryListEvent) => void) => listeners.delete(l)
      ) as MediaQueryList["removeEventListener"],
    });

    const { result, unmount } = renderHook(() => useReducedMotion());
    expect(result.current.current).toBe(false);

    act(() => {
      state.matches = true;
      listeners.forEach((l) => l({ matches: true } as MediaQueryListEvent));
    });
    expect(result.current.current).toBe(true);

    unmount();
    expect(mql.removeEventListener).toHaveBeenCalled();
  });

  it("falls back to the legacy addListener/removeListener API", () => {
    const listeners = new Set<(e: MediaQueryListEvent) => void>();
    const mql = setMatchMedia({
      matches: true,
      addListener: vi.fn((l: (e: MediaQueryListEvent) => void) =>
        listeners.add(l)
      ) as MediaQueryList["addListener"],
      removeListener: vi.fn((l: (e: MediaQueryListEvent) => void) =>
        listeners.delete(l)
      ) as MediaQueryList["removeListener"],
      addEventListener: undefined,
    });

    const { result, unmount } = renderHook(() => useReducedMotion());
    expect(result.current.current).toBe(true);
    expect(mql.addListener).toHaveBeenCalled();

    unmount();
    expect(mql.removeListener).toHaveBeenCalled();
  });

  it("stays false when matchMedia is unavailable", () => {
    Object.defineProperty(window, "matchMedia", {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const { result } = renderHook(() => useReducedMotion());
    expect(result.current.current).toBe(false);
  });
});
