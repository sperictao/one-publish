import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  listen: vi.fn(),
  checkUpdate: vi.fn(),
  getCurrentVersion: vi.fn(),
  getUpdaterConfigHealth: vi.fn(),
  getUpdaterHelpPaths: vi.fn(),
  installUpdate: vi.fn(),
  openUpdaterHelp: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: mocks.isTauri,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

vi.mock("@/lib/store/api", () => ({
  checkUpdate: mocks.checkUpdate,
  getCurrentVersion: mocks.getCurrentVersion,
  getUpdaterConfigHealth: mocks.getUpdaterConfigHealth,
  getUpdaterHelpPaths: mocks.getUpdaterHelpPaths,
  installUpdate: mocks.installUpdate,
  openUpdaterHelp: mocks.openUpdaterHelp,
}));

vi.mock("@/hooks/useI18n", () => ({
  useI18n: () => ({ translations: {} }),
  t: (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

import { useAppUpdater } from "@/hooks/useAppUpdater";

describe("useAppUpdater", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTauri.mockReturnValue(true);
    mocks.checkUpdate.mockResolvedValue(null);
    mocks.getCurrentVersion.mockResolvedValue("0.0.0");
    mocks.getUpdaterConfigHealth.mockResolvedValue(null);
    mocks.getUpdaterHelpPaths.mockResolvedValue(null);
  });

  it("卸载发生在 listen Promise 解析之前时，仍会释放监听器", async () => {
    const dispose = vi.fn();
    let resolveListen: ((d: () => void) => void) | null = null;
    mocks.listen.mockImplementation(
      () =>
        new Promise<() => void>((resolve) => {
          resolveListen = resolve;
        })
    );

    const { unmount } = renderHook(() => useAppUpdater());
    unmount();

    await act(async () => {
      resolveListen?.(dispose);
    });

    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
