import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import { useTheme } from "@/hooks/useTheme";

const originalMatchMedia = window.matchMedia;

function stubMatchMedia(matches: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mql = {
    matches,
    media: "(prefers-color-scheme: dark)",
    addEventListener: vi.fn((_t: string, l: (e: MediaQueryListEvent) => void) =>
      listeners.add(l)
    ),
    removeEventListener: vi.fn(
      (_t: string, l: (e: MediaQueryListEvent) => void) => listeners.delete(l)
    ),
    addListener: vi.fn((l: (e: MediaQueryListEvent) => void) =>
      listeners.add(l)
    ),
    removeListener: vi.fn((l: (e: MediaQueryListEvent) => void) =>
      listeners.delete(l)
    ),
    dispatch: (next: boolean) => {
      for (const l of listeners) {
        l({ matches: next } as MediaQueryListEvent);
      }
    },
  };
  Object.defineProperty(window, "matchMedia", {
    value: vi.fn().mockReturnValue(mql),
    configurable: true,
  });
  return mql;
}

afterEach(() => {
  Object.defineProperty(window, "matchMedia", {
    value: originalMatchMedia,
    configurable: true,
  });
  document.documentElement.classList.remove("light", "dark");
});

describe("useTheme", () => {
  it("applies the explicit theme class", () => {
    stubMatchMedia(false);
    renderHook(() => useTheme("dark"));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("follows the system preference under auto", () => {
    stubMatchMedia(true);
    renderHook(() => useTheme("auto"));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("reacts to system theme changes under auto and cleans up", () => {
    const mql = stubMatchMedia(false);
    const { unmount } = renderHook(() => useTheme("auto"));

    expect(document.documentElement.classList.contains("light")).toBe(true);

    mql.dispatch(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    unmount();
    mql.dispatch(false);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
