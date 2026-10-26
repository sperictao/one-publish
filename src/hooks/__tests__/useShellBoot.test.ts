import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toastWarning = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    warning: toastWarning,
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

import { useShellBoot } from "@/hooks/useShellBoot";

function params(overrides: Record<string, unknown> = {}) {
  return {
    isStateLoading: false,
    theme: "light",
    setTheme: vi.fn(),
    preferenceLanguage: "zh",
    setPreferenceLanguage: vi.fn(),
    minimizeToTrayOnClose: false,
    setMinimizeToTrayOnClose: vi.fn(),
    defaultOutputDir: "",
    setDefaultOutputDir: vi.fn(),
    executionHistoryLimit: 50,
    setExecutionHistoryLimit: vi.fn(),
    environmentProviderIds: ["dotnet"],
    setEnvironmentProviderIds: vi.fn(),
    startupNotice: null,
    leftPanelWidth: 280,
    middlePanelWidth: 360,
    panelWidthsCustomized: false,
    setLeftPanelWidth: vi.fn(),
    setMiddlePanelWidth: vi.fn(),
    ...overrides,
  } as Parameters<typeof useShellBoot>[0];
}

describe("useShellBoot", () => {
  beforeEach(() => {
    localStorage.clear();
    toastWarning.mockClear();
  });

  it("does nothing when the language is unchanged", async () => {
    const setPreferenceLanguage = vi.fn();
    const { result } = renderHook(() =>
      useShellBoot(params({ setPreferenceLanguage }))
    );

    await act(async () => {
      await result.current.handleLanguageChange(result.current.language);
    });

    expect(setPreferenceLanguage).not.toHaveBeenCalled();
  });

  it("persists and applies the new language on change", async () => {
    const setPreferenceLanguage = vi.fn();
    const { result } = renderHook(() =>
      useShellBoot(
        params({
          setPreferenceLanguage,
          preferenceLanguage: "en",
          isStateLoading: true,
        })
      )
    );

    await act(async () => {
      await result.current.handleLanguageChange("en");
    });

    expect(setPreferenceLanguage).toHaveBeenCalledWith("en");
    expect(localStorage.getItem("app-language")).toBe("en");
    await waitFor(() => expect(result.current.language).toBe("en"));
  });

  it("syncs i18n language to a normalized preference once loaded", async () => {
    localStorage.setItem("app-language", "zh");
    const { result } = renderHook(() =>
      useShellBoot(params({ preferenceLanguage: "en" }))
    );

    await waitFor(() => expect(result.current.language).toBe("en"));
    expect(result.current.normalizedPreferenceLanguage).toBe("en");
  });

  it("does not sync language while state is still loading", async () => {
    localStorage.setItem("app-language", "zh");
    const { result } = renderHook(() =>
      useShellBoot(params({ preferenceLanguage: "en", isStateLoading: true }))
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.language).toBe("zh");
  });

  it("shows the startup notice once and trims it", async () => {
    const { rerender } = renderHook((props) => useShellBoot(props), {
      initialProps: params({ startupNotice: "  recovered  " }),
    });

    await waitFor(() => expect(toastWarning).toHaveBeenCalledTimes(1));
    expect(toastWarning).toHaveBeenCalledWith(expect.any(String), {
      description: "recovered",
    });

    rerender(params({ startupNotice: "  recovered  " }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(toastWarning).toHaveBeenCalledTimes(1);
  });

  it("skips blank startup notices", async () => {
    renderHook(() => useShellBoot(params({ startupNotice: "   " })));

    await act(async () => {
      await Promise.resolve();
    });

    expect(toastWarning).not.toHaveBeenCalled();
  });

  it("loads the dialogs host only when a dialog is open", () => {
    const { result } = renderHook(() => useShellBoot(params()));

    expect(result.current.shouldLoadAppDialogsHost).toBe(false);

    act(() => result.current.setSettingsOpen(true));

    expect(result.current.shouldLoadAppDialogsHost).toBe(true);
  });
});
