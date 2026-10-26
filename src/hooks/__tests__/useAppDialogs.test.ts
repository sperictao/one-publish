import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useAppDialogs } from "@/hooks/useAppDialogs";
import { DEFAULT_ENVIRONMENT_PROVIDER_IDS } from "@/features/environment/environment";

describe("useAppDialogs", () => {
  it("starts with all dialogs closed and normalized env provider ids", () => {
    const { result } = renderHook(() =>
      useAppDialogs([" dotnet ", "cargo", "cargo", ""])
    );

    expect(result.current.settingsOpen).toBe(false);
    expect(result.current.shortcutsOpen).toBe(false);
    expect(result.current.commandImportOpen).toBe(false);
    expect(result.current.configDialogOpen).toBe(false);
    expect(result.current.environmentDialogOpen).toBe(false);
    expect(result.current.environmentDefaultProviderIds).toEqual([
      "cargo",
      "dotnet",
    ]);
    expect(result.current.environmentInitialCheck).toBeNull();
  });

  it("falls back to default provider ids when the list is empty", () => {
    const { result } = renderHook(() => useAppDialogs([]));

    expect(result.current.environmentDefaultProviderIds).toEqual(
      DEFAULT_ENVIRONMENT_PROVIDER_IDS
    );
  });

  it("opens settings via handleOpenSettings", () => {
    const { result } = renderHook(() => useAppDialogs(["dotnet"]));

    act(() => result.current.handleOpenSettings());

    expect(result.current.settingsOpen).toBe(true);
  });

  it("openEnvironmentDialog normalizes explicit provider ids and opens", () => {
    const { result } = renderHook(() => useAppDialogs(["dotnet"]));

    act(() =>
      result.current.openEnvironmentDialog(null, ["cargo", " dotnet ", "cargo"])
    );

    expect(result.current.environmentDialogOpen).toBe(true);
    expect(result.current.environmentDefaultProviderIds).toEqual([
      "cargo",
      "dotnet",
    ]);
  });

  it("openEnvironmentDialog defaults to the hook provider ids", () => {
    const { result } = renderHook(() => useAppDialogs(["tauri"]));

    act(() => result.current.openEnvironmentDialog());

    expect(result.current.environmentDefaultProviderIds).toEqual(["tauri"]);
    expect(result.current.environmentDialogOpen).toBe(true);
  });

  it("drops an incompatible initial check snapshot when rescoping", () => {
    const incompatibleSnapshot = {
      providerIds: ["other-provider"],
      result: {
        is_ready: true,
        providers: [],
        issues: [],
        checked_at: "2026-01-01T00:00:00Z",
      },
    };
    const { result } = renderHook(() => useAppDialogs(["dotnet"]));

    act(() =>
      result.current.openEnvironmentDialog(incompatibleSnapshot, ["dotnet"])
    );

    expect(result.current.environmentInitialCheck).toBeNull();
    expect(result.current.environmentDialogOpen).toBe(true);
  });

  it("clears the initial check when the environment dialog closes", () => {
    const { result } = renderHook(() => useAppDialogs(["dotnet"]));

    act(() => result.current.handleEnvironmentDialogOpenChange(false));

    expect(result.current.environmentDialogOpen).toBe(false);
    expect(result.current.environmentInitialCheck).toBeNull();
  });

  it("invokes onClose only when the config dialog closes", () => {
    const { result } = renderHook(() => useAppDialogs(["dotnet"]));
    const onClose = vi.fn();

    act(() => result.current.handleConfigDialogOpenChange(true, onClose));
    expect(result.current.configDialogOpen).toBe(true);
    expect(onClose).not.toHaveBeenCalled();

    act(() => result.current.handleConfigDialogOpenChange(false, onClose));
    expect(result.current.configDialogOpen).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
