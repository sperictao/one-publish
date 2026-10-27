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
  unlisten: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (_name: string, handler: (event: { payload: unknown }) => void) => {
      mocks.listenHandler.current = handler;
      return mocks.unlisten;
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
});
