import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useProfileSelection } from "@/features/config/useProfileSelection";
import type { ConfigProfile } from "@/lib/store/types";

function params(overrides: Record<string, unknown> = {}) {
  return {
    updatePublishEditState: vi.fn(),
    setActiveProfileName: vi.fn(),
    applyProfile: vi.fn().mockReturnValue(true),
    ...overrides,
  };
}

describe("useProfileSelection", () => {
  it("selects a project profile and clears the active profile name", () => {
    const p = params();
    const { result } = renderHook(() => useProfileSelection(p));

    result.current.handleSelectProjectProfile("Release");

    expect(p.updatePublishEditState).toHaveBeenCalledWith({
      selection: {
        kind: "projectProfile",
        providerId: "dotnet",
        reference: "Release",
      },
    });
    expect(p.setActiveProfileName).toHaveBeenCalledWith(null);
  });

  it("delegates panel selection to applyProfile", () => {
    const p = params();
    const { result } = renderHook(() => useProfileSelection(p));
    const profile = { id: "cfg-1", name: "Release" } as ConfigProfile;

    result.current.handleSelectProfileFromPanel(profile);

    expect(p.applyProfile).toHaveBeenCalledWith(profile);
    expect(p.updatePublishEditState).not.toHaveBeenCalled();
  });
});
