import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const attachConsoleMock = vi.fn(() => Promise.resolve(() => {}));

vi.mock("@tauri-apps/plugin-log", () => ({
  attachConsole: (...args: unknown[]) => attachConsoleMock(...args),
}));

import {
  __resetFrontendErrorHooksForTest,
  installFrontendErrorHooks,
} from "@/lib/frontendLog";

function setTauriInternals(present: boolean) {
  const win = window as unknown as Record<string, unknown>;
  if (present) {
    win.isTauri = true;
  } else {
    delete win.isTauri;
  }
}

describe("installFrontendErrorHooks", () => {
  beforeEach(() => {
    __resetFrontendErrorHooksForTest();
    attachConsoleMock.mockClear();
  });

  afterEach(() => {
    setTauriInternals(false);
    vi.restoreAllMocks();
  });

  it("Tauri 环境下桥接 console 并注册全局监听（幂等）", () => {
    setTauriInternals(true);
    installFrontendErrorHooks();
    installFrontendErrorHooks();
    expect(attachConsoleMock).toHaveBeenCalledTimes(1);
  });

  it("非 Tauri 环境不安装任何钩子", () => {
    setTauriInternals(false);
    installFrontendErrorHooks();
    expect(attachConsoleMock).not.toHaveBeenCalled();
  });

  it("脚本错误与未处理 rejection 经 console.error 进入转发通道", () => {
    setTauriInternals(true);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    installFrontendErrorHooks();

    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "boom",
        filename: "app.js",
        lineno: 12,
        colno: 3,
      })
    );
    expect(consoleSpy).toHaveBeenCalledWith("[unhandled] boom at app.js:12:3");

    const event = new Event("unhandledrejection");
    Object.defineProperty(event, "reason", {
      value: new Error("invoke 失败"),
    });
    window.dispatchEvent(event);
    expect(consoleSpy).toHaveBeenCalledWith(
      "[unhandledrejection] Error: invoke 失败"
    );
  });
});
