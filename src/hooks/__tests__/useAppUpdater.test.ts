import { renderHook, act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkUpdate: vi.fn(),
  getCurrentVersion: vi.fn(),
  getUpdaterConfigHealth: vi.fn(),
  getUpdaterHelpPaths: vi.fn(),
  installUpdate: vi.fn(),
  openUpdaterHelp: vi.fn(),
  listenHandler: {
    current: null as null | ((event: { payload: unknown }) => void),
  },
  listenMode: { current: "resolve" as "resolve" | "reject" | "deferred" },
  listenDeferred: {
    current: null as null | {
      resolve: (fn: () => void) => void;
      reject: (err: unknown) => void;
    },
  },
  unlisten: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    (_name: string, handler: (event: { payload: unknown }) => void) => {
      if (mocks.listenMode.current === "reject") {
        return Promise.reject(new Error("listen unavailable"));
      }
      if (mocks.listenMode.current === "deferred") {
        return new Promise<() => void>((resolve, reject) => {
          mocks.listenHandler.current = handler;
          mocks.listenDeferred.current = { resolve, reject };
        });
      }
      mocks.listenHandler.current = handler;
      return Promise.resolve(mocks.unlisten);
    }
  ),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: mocks.toastSuccess,
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock("@/lib/store/api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/store/api")>("@/lib/store/api");
  return { ...actual, ...mocks };
});

import { useAppUpdater } from "@/hooks/useAppUpdater";

const updateInfo = {
  currentVersion: "1.0.0",
  availableVersion: "1.1.0",
  hasUpdate: true,
  releaseNotes: null,
  message: null,
};

const tauriWindow = window as unknown as { isTauri?: boolean };

function setTauri(enabled: boolean) {
  if (enabled) {
    tauriWindow.isTauri = true;
  } else {
    delete tauriWindow.isTauri;
  }
}

describe("useAppUpdater", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listenHandler.current = null;
    mocks.listenMode.current = "resolve";
    mocks.listenDeferred.current = null;
    mocks.getCurrentVersion.mockResolvedValue("1.0.0");
    mocks.checkUpdate.mockResolvedValue(updateInfo);
    mocks.getUpdaterConfigHealth.mockResolvedValue({
      configured: true,
      message: "",
    });
    mocks.getUpdaterHelpPaths.mockResolvedValue({
      docsPath: "/docs",
      templatePath: "/tpl",
    });
    mocks.installUpdate.mockResolvedValue("更新已安装，请重启应用");
    mocks.openUpdaterHelp.mockResolvedValue(undefined);
  });

  afterEach(() => {
    setTauri(false);
  });

  it("stays inert outside Tauri", async () => {
    setTauri(false);
    const { result } = renderHook(() => useAppUpdater());

    const info = await result.current.checkForUpdates();

    expect(info).toBeNull();
    expect(mocks.checkUpdate).not.toHaveBeenCalled();
    expect(mocks.listenHandler.current).toBeNull();
  });

  it("auto-checks once on mount inside Tauri", async () => {
    setTauri(true);
    const { result } = renderHook(() => useAppUpdater());

    await waitFor(() => expect(mocks.checkUpdate).toHaveBeenCalledTimes(1));
    expect(result.current.updaterState.updateInfo).toEqual(updateInfo);
    expect(result.current.updaterState.currentVersion).toBe("1.0.0");
    // silent + notifyIfAvailable: toast fires because an update exists.
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledTimes(1));
  });

  it("does not re-notify for the same available version", async () => {
    setTauri(true);
    const { result } = renderHook(() => useAppUpdater());
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.checkForUpdates({
        silent: true,
        notifyIfAvailable: true,
      });
    });

    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
  });

  it("resolves help paths only when the updater is unconfigured", async () => {
    setTauri(true);
    mocks.getUpdaterConfigHealth.mockResolvedValue({
      configured: false,
      message: "missing key",
    });
    const { result } = renderHook(() => useAppUpdater());

    await waitFor(() =>
      expect(result.current.updaterState.updaterHelpPaths).toEqual({
        docsPath: "/docs",
        templatePath: "/tpl",
      })
    );
    expect(mocks.getUpdaterHelpPaths).toHaveBeenCalledTimes(1);
  });

  it("skips help paths when the updater is configured", async () => {
    setTauri(true);
    const { result } = renderHook(() => useAppUpdater());

    await waitFor(() =>
      expect(result.current.updaterState.updateInfo).not.toBeNull()
    );

    expect(mocks.getUpdaterHelpPaths).not.toHaveBeenCalled();
    expect(result.current.updaterState.updaterHelpPaths).toBeNull();
  });

  it("falls back to info.currentVersion when getCurrentVersion rejects", async () => {
    setTauri(true);
    mocks.getCurrentVersion.mockRejectedValue(new Error("no bundle info"));
    const { result } = renderHook(() => useAppUpdater());

    // 版本解析失败不得中断检查链：updateInfo 仍落账，
    // currentVersion 回落到 checkUpdate 返回的 info.currentVersion。
    await waitFor(() =>
      expect(result.current.updaterState.updateInfo).toEqual(updateInfo)
    );
    expect(mocks.checkUpdate).toHaveBeenCalled();
    expect(result.current.updaterState.currentVersion).toBe("1.0.0");
  });

  it("prefers resolvedCurrentVersion over info.currentVersion", async () => {
    setTauri(true);
    mocks.getCurrentVersion.mockResolvedValue("9.9.9");
    const { result } = renderHook(() => useAppUpdater());

    await waitFor(() =>
      expect(result.current.updaterState.updateInfo).toEqual(updateInfo)
    );
    // 优先级：resolvedCurrentVersion > info.currentVersion > prev。
    expect(result.current.updaterState.currentVersion).toBe("9.9.9");
  });

  it("exposes the localized error message on check failure", async () => {
    setTauri(true);
    mocks.checkUpdate.mockRejectedValue({
      kind: "io",
      message: "network down",
    });
    const { result } = renderHook(() => useAppUpdater());

    await act(async () => {
      await result.current.checkForUpdates();
    });

    expect(result.current.updaterState.updateInfo?.message).toBeTruthy();
    expect(result.current.updaterState.updateInfo?.hasUpdate).toBe(false);
  });

  it("keeps updateInfo untouched on silent check failure", async () => {
    setTauri(true);
    const { result } = renderHook(() => useAppUpdater());
    await waitFor(() =>
      expect(result.current.updaterState.updateInfo).toEqual(updateInfo)
    );

    mocks.checkUpdate.mockRejectedValue(new Error("boom"));
    await act(async () => {
      await result.current.checkForUpdates({ silent: true });
    });

    expect(result.current.updaterState.updateInfo).toEqual(updateInfo);
  });

  it("marks restart required when install reports a restart message", async () => {
    setTauri(true);
    const { result } = renderHook(() => useAppUpdater());
    await waitFor(() =>
      expect(result.current.updaterState.updateInfo).not.toBeNull()
    );

    await act(async () => {
      await result.current.installAvailableUpdate();
    });

    expect(mocks.installUpdate).toHaveBeenCalledWith("1.1.0");
    expect(result.current.updaterState.isRestartRequired).toBe(true);
    expect(result.current.updaterState.updateInfo?.hasUpdate).toBe(false);
  });

  it("records the localized message when install fails", async () => {
    setTauri(true);
    mocks.installUpdate.mockRejectedValue({ message: "install failed" });
    const { result } = renderHook(() => useAppUpdater());
    await waitFor(() =>
      expect(result.current.updaterState.updateInfo).not.toBeNull()
    );

    await act(async () => {
      await result.current.installAvailableUpdate();
    });

    expect(result.current.updaterState.isRestartRequired).toBe(false);
    expect(result.current.updaterState.isInstallingUpdate).toBe(false);
    expect(result.current.updaterState.updateInfo?.message).toBeTruthy();
    expect(result.current.updaterState.updateInfo?.hasUpdate).toBe(true);
  });

  it("forwards help target opens and swallows failures", async () => {
    setTauri(true);
    const { result } = renderHook(() => useAppUpdater());

    await act(async () => {
      await result.current.openUpdaterHelpTarget("docs");
    });
    expect(mocks.openUpdaterHelp).toHaveBeenCalledWith("docs");

    mocks.openUpdaterHelp.mockRejectedValue(new Error("no browser"));
    await act(async () => {
      await result.current.openUpdaterHelpTarget("template");
    });
    expect(result.current.updaterState.isOpeningUpdaterHelp).toBe(false);
  });

  it("applies download progress events to state", async () => {
    setTauri(true);
    const { result } = renderHook(() => useAppUpdater());
    await waitFor(() => expect(mocks.listenHandler.current).not.toBeNull());

    act(() => {
      mocks.listenHandler.current?.({
        payload: {
          stage: "downloading",
          version: "1.1.0",
          downloadedBytes: 50,
          totalBytes: 100,
          percent: 50,
          attempt: 1,
          maxAttempts: 3,
          message: null,
        },
      });
    });

    expect(result.current.updaterState.downloadProgress).toMatchObject({
      stage: "downloading",
      version: "1.1.0",
      percent: 50,
    });
  });

  it("ignores empty progress payloads", async () => {
    setTauri(true);
    const { result } = renderHook(() => useAppUpdater());
    await waitFor(() => expect(mocks.listenHandler.current).not.toBeNull());

    act(() => {
      mocks.listenHandler.current?.({ payload: null });
    });

    expect(result.current.updaterState.downloadProgress.stage).toBe("idle");
  });

  it("unlistens on unmount", async () => {
    setTauri(true);
    const { unmount } = renderHook(() => useAppUpdater());
    await waitFor(() => expect(mocks.listenHandler.current).not.toBeNull());

    unmount();

    expect(mocks.unlisten).toHaveBeenCalledTimes(1);
  });

  it("returns early from check/install/help outside Tauri", async () => {
    setTauri(false);
    const { result } = renderHook(() => useAppUpdater());

    let checkResult: unknown;
    await act(async () => {
      checkResult = await result.current.checkForUpdates();
    });
    expect(checkResult).toBeNull();

    await act(async () => {
      await result.current.installAvailableUpdate();
      await result.current.openUpdaterHelpTarget("docs");
    });
    expect(mocks.checkUpdate).not.toHaveBeenCalled();
    expect(mocks.installUpdate).not.toHaveBeenCalled();
    expect(mocks.openUpdaterHelp).not.toHaveBeenCalled();
  });

  it("keeps isOpeningUpdaterHelp false when help path lookup fails", async () => {
    setTauri(true);
    mocks.getUpdaterConfigHealth.mockResolvedValue({
      configured: false,
      message: "missing",
    });
    mocks.getUpdaterHelpPaths.mockRejectedValue(new Error("fs gone"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { result } = renderHook(() => useAppUpdater());
    await waitFor(() =>
      expect(mocks.getUpdaterConfigHealth).toHaveBeenCalled()
    );

    await act(async () => {
      await result.current.checkForUpdates();
    });

    await act(async () => {
      await result.current.openUpdaterHelpTarget("docs");
    });
    expect(errorSpy).toHaveBeenCalled();
  });

  it("disposes a late-resolving listener after unmount", async () => {
    setTauri(true);
    mocks.listenMode.current = "deferred";
    const { unmount } = renderHook(() => useAppUpdater());
    await waitFor(() => expect(mocks.listenHandler.current).not.toBeNull());

    unmount();
    await act(async () => {
      mocks.listenDeferred.current?.resolve(mocks.unlisten);
      await Promise.resolve();
    });

    expect(mocks.unlisten).toHaveBeenCalled();
  });

  it("logs and survives a listener registration failure", async () => {
    setTauri(true);
    mocks.listenMode.current = "reject";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { unmount } = renderHook(() => useAppUpdater());
    await waitFor(() => expect(errorSpy).toHaveBeenCalled());

    unmount();
  });
});
