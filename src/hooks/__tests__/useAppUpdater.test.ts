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

// 只给真实 zh 的 errors 分支：其余文案走 hook 内兜底，错误码文案校验已登记。
vi.mock("@/hooks/useI18n", async () => {
  const zh = (await import("@/i18n/zh.json")).default;
  const translations = { errors: zh.errors };
  return {
    useI18n: () => ({ translations }),
    t: (key: string) => key,
  };
});

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

  it("安装失败按错误码本地化更新提示，而不是只展示后端原文", async () => {
    mocks.listen.mockResolvedValue(() => {});
    // Tauri invoke 以 AppError 对象 reject，而不是 Error 实例。
    mocks.installUpdate.mockRejectedValue({
      kind: "updater",
      message: "download failed",
      details: "status: 503 (retries: 2)",
      code: "download_update_failed",
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const { result } = renderHook(() => useAppUpdater());
    await act(async () => {
      await result.current.installAvailableUpdate();
    });

    expect(result.current.updaterState.updateInfo?.message).toBe(
      "下载更新失败 | status: 503 (retries: 2)"
    );
    consoleError.mockRestore();
  });
});
