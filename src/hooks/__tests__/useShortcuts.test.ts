import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: mocks.isTauri,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

import { useShortcuts } from "@/hooks/useShortcuts";

describe("useShortcuts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTauri.mockReturnValue(true);
  });

  it("只注册一次快捷键监听，并始终调用最新回调", async () => {
    const eventCallbacks: Record<string, () => void> = {};
    const unlisteners = {
      "shortcut-refresh": vi.fn(),
      "shortcut-publish": vi.fn(),
      "shortcut-settings": vi.fn(),
    };

    mocks.listen.mockImplementation(async (event: string, handler: () => void) => {
      eventCallbacks[event] = handler;
      return unlisteners[event as keyof typeof unlisteners];
    });

    const firstRefresh = vi.fn();
    const latestRefresh = vi.fn();

    const { rerender, unmount } = renderHook(
      ({ onRefresh }) =>
        useShortcuts({
          onRefresh,
          onPublish: vi.fn(),
          onOpenSettings: vi.fn(),
        }),
      {
        initialProps: {
          onRefresh: firstRefresh,
        },
      }
    );

    await waitFor(() => {
      expect(mocks.listen).toHaveBeenCalledTimes(3);
    });

    rerender({
      onRefresh: latestRefresh,
    });

    act(() => {
      eventCallbacks["shortcut-refresh"]();
    });

    expect(firstRefresh).not.toHaveBeenCalled();
    expect(latestRefresh).toHaveBeenCalledTimes(1);
    expect(mocks.listen).toHaveBeenCalledTimes(3);

    unmount();

    expect(unlisteners["shortcut-refresh"]).toHaveBeenCalledTimes(1);
    expect(unlisteners["shortcut-publish"]).toHaveBeenCalledTimes(1);
    expect(unlisteners["shortcut-settings"]).toHaveBeenCalledTimes(1);
  });
});
