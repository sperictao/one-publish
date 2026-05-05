import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useProviderParametersState } from "@/hooks/useProviderParametersState";

describe("useProviderParametersState", () => {
  it("keeps provider parameters scoped by active provider id", () => {
    const { result, rerender } = renderHook(
      ({ activeProviderId }) => useProviderParametersState({ activeProviderId }),
      { initialProps: { activeProviderId: "cargo" } }
    );

    act(() => {
      result.current.setProviderParameters((prev) => ({
        ...prev,
        cargo: { release: true },
        go: { output: "./bin/app" },
      }));
    });

    expect(result.current.activeProviderParameters).toEqual({ release: true });

    rerender({ activeProviderId: "go" });

    expect(result.current.activeProviderParameters).toEqual({
      output: "./bin/app",
    });
  });
});
