import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";

import { useDialogDerivedState } from "@/hooks/useDialogDerivedState";

describe("useDialogDerivedState", () => {
  it("prefers selection parameters over active provider parameters", () => {
    const { result } = renderHook(() =>
      useDialogDerivedState({
        activeProviderId: "dotnet",
        selectionParameters: { configuration: "Debug" },
        activeProviderParameters: { configuration: "Release" },
      })
    );

    expect(result.current.currentConfigParameters).toEqual({
      configuration: "Debug",
    });
  });

  it("falls back to provider parameters when no selection scope exists", () => {
    const { result } = renderHook(() =>
      useDialogDerivedState({
        activeProviderId: "dotnet",
        selectionParameters: null,
        activeProviderParameters: { configuration: "Release" },
      })
    );

    expect(result.current.currentConfigParameters).toEqual({
      configuration: "Release",
    });
  });

  it("uses the bound project file for project-file providers", () => {
    const { result } = renderHook(() =>
      useDialogDerivedState({
        activeProviderId: "dotnet",
        activeProviderUsesProjectFile: true,
        selectionParameters: null,
        activeProviderParameters: {},
        projectFile: "/repo/App.csproj",
        selectedRepoPath: "/repo",
      })
    );

    expect(result.current.commandImportProjectPath).toBe("/repo/App.csproj");
  });

  it("uses the repo path for non-project-file providers", () => {
    const { result } = renderHook(() =>
      useDialogDerivedState({
        activeProviderId: "cargo",
        activeProviderUsesProjectFile: false,
        selectionParameters: null,
        activeProviderParameters: {},
        projectFile: "/repo/App.csproj",
        selectedRepoPath: "/repo",
      })
    );

    expect(result.current.commandImportProjectPath).toBe("/repo");
  });

  it("defaults project-file usage to false when unspecified", () => {
    const { result } = renderHook(() =>
      useDialogDerivedState({
        activeProviderId: "cargo",
        selectionParameters: null,
        activeProviderParameters: {},
        projectFile: "/repo/App.csproj",
        selectedRepoPath: "/repo",
      })
    );

    expect(result.current.commandImportProjectPath).toBe("/repo");
  });
});
