import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isMacPlatform: vi.fn(),
}));

vi.mock("@/lib/platform", () => ({
  isMacPlatform: mocks.isMacPlatform,
}));

import { useShortcuts, type ShortcutHandlers } from "@/hooks/useShortcuts";

function pressKey(init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  window.dispatchEvent(event);
  return event;
}

function createHandlers() {
  return {
    onRefresh: vi.fn(),
    onPublish: vi.fn(),
    onOpenSettings: vi.fn(),
  } satisfies ShortcutHandlers;
}

describe("useShortcuts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isMacPlatform.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Ctrl+P 调用发布回调并阻止 webview 默认打印", () => {
    const handlers = createHandlers();
    renderHook(() => useShortcuts(handlers));

    const event = pressKey({ key: "p", ctrlKey: true });

    expect(handlers.onPublish).toHaveBeenCalledTimes(1);
    expect(handlers.onRefresh).not.toHaveBeenCalled();
    expect(handlers.onOpenSettings).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("Ctrl+R / Ctrl+, 分别调用刷新与设置回调", () => {
    const handlers = createHandlers();
    renderHook(() => useShortcuts(handlers));

    expect(pressKey({ key: "r", ctrlKey: true }).defaultPrevented).toBe(true);
    expect(pressKey({ key: ",", ctrlKey: true }).defaultPrevented).toBe(true);

    expect(handlers.onRefresh).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenSettings).toHaveBeenCalledTimes(1);
    expect(handlers.onPublish).not.toHaveBeenCalled();
  });

  it("macOS 使用 Cmd 而非 Ctrl", () => {
    mocks.isMacPlatform.mockReturnValue(true);
    const handlers = createHandlers();
    renderHook(() => useShortcuts(handlers));

    pressKey({ key: "p", ctrlKey: true });
    expect(handlers.onPublish).not.toHaveBeenCalled();

    pressKey({ key: "p", metaKey: true });
    expect(handlers.onPublish).toHaveBeenCalledTimes(1);
  });

  it("忽略无主修饰键、附加 Shift/Alt 或其他按键的组合", () => {
    const handlers = createHandlers();
    renderHook(() => useShortcuts(handlers));

    const ignored = [
      pressKey({ key: "p" }),
      pressKey({ key: "p", ctrlKey: true, shiftKey: true }),
      pressKey({ key: "p", ctrlKey: true, altKey: true }),
      pressKey({ key: "t", ctrlKey: true }),
    ];

    expect(handlers.onPublish).not.toHaveBeenCalled();
    expect(ignored.every((event) => !event.defaultPrevented)).toBe(true);
  });

  it("长按自动重复时仍阻止默认行为但不重复触发", () => {
    const handlers = createHandlers();
    renderHook(() => useShortcuts(handlers));

    const event = pressKey({ key: "p", ctrlKey: true, repeat: true });

    expect(event.defaultPrevented).toBe(true);
    expect(handlers.onPublish).not.toHaveBeenCalled();
  });

  it("只注册一次监听，并始终调用最新回调；卸载后移除监听", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const firstPublish = vi.fn();
    const latestPublish = vi.fn();

    const { rerender, unmount } = renderHook(
      ({ onPublish }) => useShortcuts({ onPublish }),
      { initialProps: { onPublish: firstPublish } }
    );
    rerender({ onPublish: latestPublish });

    pressKey({ key: "p", ctrlKey: true });

    expect(firstPublish).not.toHaveBeenCalled();
    expect(latestPublish).toHaveBeenCalledTimes(1);
    const keydownRegistrations = addSpy.mock.calls.filter(
      ([type]) => type === "keydown"
    );
    expect(keydownRegistrations).toHaveLength(1);

    unmount();

    expect(removeSpy).toHaveBeenCalledWith(
      "keydown",
      keydownRegistrations[0][1]
    );
    pressKey({ key: "p", ctrlKey: true });
    expect(latestPublish).toHaveBeenCalledTimes(1);
  });
});
