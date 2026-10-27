import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useProjectPublishProfileOrder } from "@/hooks/useProjectPublishProfileOrder";

const ORDER_KEY = "one-publish:projectPublishProfileOrder";

function seed(map: Record<string, unknown>) {
  localStorage.setItem(ORDER_KEY, JSON.stringify(map));
}

function hookProps(
  overrides: Partial<Parameters<typeof useProjectPublishProfileOrder>[0]> = {}
) {
  return {
    repoId: "repo-1",
    projectFilePath: "/repo/App.csproj",
    projectPublishProfiles: ["Release", "Debug", "Staging"],
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("useProjectPublishProfileOrder", () => {
  it("returns the declared order when nothing is stored", () => {
    const { result } = renderHook(() =>
      useProjectPublishProfileOrder(hookProps())
    );

    expect(result.current.orderedProjectPublishProfiles).toEqual([
      "Release",
      "Debug",
      "Staging",
    ]);
  });

  it("applies the stored order for the repo+project scope", () => {
    seed({ "repo-1::/repo/App.csproj": ["Staging", "Release"] });

    const { result } = renderHook(() =>
      useProjectPublishProfileOrder(hookProps())
    );

    expect(result.current.orderedProjectPublishProfiles).toEqual([
      "Staging",
      "Release",
      "Debug",
    ]);
  });

  it("scopes order per project file — other scopes stay at declared order", () => {
    seed({ "repo-1::/other.csproj": ["Staging"] });

    const { result } = renderHook(() =>
      useProjectPublishProfileOrder(hookProps())
    );

    expect(result.current.orderedProjectPublishProfiles).toEqual([
      "Release",
      "Debug",
      "Staging",
    ]);
  });

  it("persists a reorder under the scope key", () => {
    const { result } = renderHook(() =>
      useProjectPublishProfileOrder(hookProps())
    );

    act(() => {
      result.current.reorderProjectPublishProfiles(["Debug", "Release"]);
    });

    expect(result.current.orderedProjectPublishProfiles).toEqual([
      "Debug",
      "Release",
      "Staging",
    ]);
    const stored = JSON.parse(localStorage.getItem(ORDER_KEY) ?? "{}");
    expect(stored["repo-1::/repo/App.csproj"]).toEqual([
      "Debug",
      "Release",
      "Staging",
    ]);
  });

  it("ignores reorder when no scope can be resolved", () => {
    const { result } = renderHook(() =>
      useProjectPublishProfileOrder(
        hookProps({ repoId: null, projectFilePath: undefined })
      )
    );

    act(() => {
      result.current.reorderProjectPublishProfiles(["Debug"]);
    });

    expect(result.current.orderedProjectPublishProfiles).toEqual([
      "Release",
      "Debug",
      "Staging",
    ]);
    expect(localStorage.getItem(ORDER_KEY)).toBeNull();
  });

  it("tolerates malformed stored payloads", () => {
    localStorage.setItem(ORDER_KEY, "{not-json");

    const { result } = renderHook(() =>
      useProjectPublishProfileOrder(hookProps())
    );

    expect(result.current.orderedProjectPublishProfiles).toEqual([
      "Release",
      "Debug",
      "Staging",
    ]);
  });

  it("filters non-string entries out of stored scopes", () => {
    seed({
      "repo-1::/repo/App.csproj": ["Staging", 42, null, "Debug"],
    });

    const { result } = renderHook(() =>
      useProjectPublishProfileOrder(hookProps())
    );

    expect(result.current.orderedProjectPublishProfiles).toEqual([
      "Staging",
      "Debug",
      "Release",
    ]);
  });

  it("ignores non-object JSON payloads and non-array scope values", () => {
    localStorage.setItem(ORDER_KEY, "42");

    const { result } = renderHook(() =>
      useProjectPublishProfileOrder(hookProps())
    );
    expect(result.current.orderedProjectPublishProfiles).toEqual([
      "Release",
      "Debug",
      "Staging",
    ]);

    seed({
      "repo-1::/repo/App.csproj": ["Staging"],
      "repo-2::/repo/Other.csproj": "not-an-array",
      "repo-3::/repo/Third.csproj": [42, null],
    });

    const { result: scoped } = renderHook(() =>
      useProjectPublishProfileOrder(hookProps())
    );
    expect(scoped.current.orderedProjectPublishProfiles).toEqual([
      "Staging",
      "Release",
      "Debug",
    ]);
  });
});
