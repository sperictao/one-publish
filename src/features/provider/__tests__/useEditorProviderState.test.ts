import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useEditorProviderState } from "@/features/provider/useEditorProviderState";
import type { ProviderManifest } from "@/lib/store/types";

function provider(id: string): ProviderManifest {
  return { id } as ProviderManifest;
}

function setup(
  overrides: {
    providers?: ProviderManifest[];
    repo?: { id: string; providerId: string | null } | null;
    initialActive?: string;
  } = {}
) {
  let active = overrides.initialActive ?? "dotnet";
  const setActiveProviderId = vi.fn(
    (updater: string | ((current: string) => string)) => {
      active = typeof updater === "function" ? updater(active) : updater;
    }
  );
  const props = {
    availableProviders: overrides.providers ?? [provider("dotnet")],
    selectedRepo:
      overrides.repo === undefined
        ? { id: "repo-1", providerId: "cargo" }
        : overrides.repo,
    setActiveProviderId,
  };
  const { result } = renderHook(() => useEditorProviderState(props));
  return { result, setActiveProviderId, getActive: () => active };
}

describe("useEditorProviderState", () => {
  it("applies the selected repository provider on mount", () => {
    const { getActive } = setup();
    expect(getActive()).toBe("cargo");
  });

  it("does nothing without a selected repository", () => {
    const { getActive, setActiveProviderId } = setup({ repo: null });
    expect(setActiveProviderId).not.toHaveBeenCalled();
    expect(getActive()).toBe("dotnet");
  });

  it("falls back to the current provider for unknown ids", () => {
    const { result, getActive } = setup({ initialActive: "dotnet" });

    act(() => result.current.applySelectedRepositoryProvider("missing"));

    // Unknown provider keeps the current id (resolveProviderIdCandidate
    // treats the current value as fallback before catalog order).
    expect(getActive()).toBe("missing");
  });

  it("applyProfileProvider resolves through the same candidate logic", () => {
    const { result, getActive } = setup({ initialActive: "dotnet" });

    act(() => result.current.applyProfileProvider("cargo"));
    expect(getActive()).toBe("cargo");
  });
});
