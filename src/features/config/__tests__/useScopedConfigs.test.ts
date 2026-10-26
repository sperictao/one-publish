import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import { useScopedConfigs } from "@/features/config/useScopedConfigs";
import { useAppStore } from "@/stores/appStore";

const initialStoreSnapshot = useAppStore.getState();

afterEach(() => {
  useAppStore.setState(initialStoreSnapshot, true);
  localStorage.clear();
});

function params(
  overrides: Partial<Parameters<typeof useScopedConfigs>[0]> = {}
) {
  return {
    selectedRepoId: "repo-1",
    recentConfigByRepo: { "repo-1": ["recent-a", "recent-b"] },
    pushRecentConfig: vi.fn(),
    removeRecentConfig: vi.fn(),
    reorderRecentConfig: vi.fn(),
    ...overrides,
  };
}

describe("useScopedConfigs", () => {
  it("projects recent and favorite keys for the selected repository", () => {
    useAppStore.setState({
      favoriteConfigKeysByRepo: { "repo-1": ["fav-x"] },
    });

    const { result } = renderHook((p) => useScopedConfigs(p), {
      initialProps: params(),
    });

    expect(result.current.recentConfigKeys).toEqual(["recent-a", "recent-b"]);
    expect(result.current.favoriteConfigKeys).toEqual(["fav-x"]);
  });

  it("returns empty projections when no repository is selected", () => {
    const { result } = renderHook((p) => useScopedConfigs(p), {
      initialProps: params({ selectedRepoId: null }),
    });

    expect(result.current.recentConfigKeys).toEqual([]);
    expect(result.current.favoriteConfigKeys).toEqual([]);
  });

  it("returns empty projections for repos without entries", () => {
    const { result } = renderHook((p) => useScopedConfigs(p), {
      initialProps: params({
        selectedRepoId: "repo-9",
        recentConfigByRepo: {},
      }),
    });

    expect(result.current.recentConfigKeys).toEqual([]);
    expect(result.current.favoriteConfigKeys).toEqual([]);
  });

  it("passes store-backed favorite mutations through", () => {
    const { result } = renderHook((p) => useScopedConfigs(p), {
      initialProps: params(),
    });

    result.current.toggleFavoriteConfig("preset:z", "repo-1");

    expect(useAppStore.getState().favoriteConfigKeysByRepo["repo-1"]).toEqual([
      "preset:z",
    ]);
  });

  it("forwards the recent-config callbacks unchanged", () => {
    const p = params();
    const { result } = renderHook(() => useScopedConfigs(p));

    result.current.pushRecentConfig("k", "repo-1");
    result.current.removeRecentConfig("k", "repo-1");
    result.current.reorderRecentConfig(["k"], "repo-1");

    expect(p.pushRecentConfig).toHaveBeenCalledWith("k", "repo-1");
    expect(p.removeRecentConfig).toHaveBeenCalledWith("k", "repo-1");
    expect(p.reorderRecentConfig).toHaveBeenCalledWith(["k"], "repo-1");
  });
});
