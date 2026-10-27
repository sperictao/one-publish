import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getProfiles: vi.fn() }));

vi.mock("@/lib/store/api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/store/api")>("@/lib/store/api");
  return { ...actual, getProfiles: mocks.getProfiles };
});

import { useProfileListState } from "@/hooks/useProfileListState";
import type { ConfigProfile } from "@/lib/store/types";

function profile(id: string, name = id): ConfigProfile {
  return {
    id,
    revisionId: "r1",
    name,
    providerId: "github",
    parameters: {},
    createdAt: "2026-01-01",
    isSystemDefault: false,
    externalBindingIds: [],
    profileGroup: null,
  };
}

function render(selectedRepoId: string | null = "repo-1") {
  const onRepositoryScopeChange = vi.fn();
  const hook = renderHook(
    ({ repoId }) =>
      useProfileListState({
        selectedRepoId: repoId,
        onRepositoryScopeChange,
      }),
    { initialProps: { repoId: selectedRepoId } }
  );
  return { ...hook, onRepositoryScopeChange };
}

describe("useProfileListState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProfiles.mockResolvedValue([profile("p-1")]);
  });

  it("reports isCurrentRepo against the selected repository", async () => {
    const onScopeChange = vi.fn();
    const { result } = renderHook(() =>
      useProfileListState({
        selectedRepoId: "repo-1",
        onRepositoryScopeChange: onScopeChange,
      })
    );
    await waitFor(() =>
      expect(result.current.profiles.map((p) => p.id)).toEqual(["p-1"])
    );

    expect(result.current.isCurrentRepo("repo-1")).toBe(true);
    expect(result.current.isCurrentRepo("repo-2")).toBe(false);
  });

  it("clears the snapshot and skips fetching when no repository is selected", async () => {
    const onScopeChange = vi.fn();
    const { result } = renderHook(() =>
      useProfileListState({
        selectedRepoId: null,
        onRepositoryScopeChange: onScopeChange,
      })
    );

    await act(async () => {
      const data = await result.current.loadProfiles();
      expect(data).toEqual([]);
    });

    expect(result.current.profiles).toEqual([]);
    expect(result.current.isProfilesRefreshing).toBe(false);
    expect(mocks.getProfiles).not.toHaveBeenCalled();
  });

  it("restores the cached snapshot and reports failure when loading fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = render();

    await waitFor(() =>
      expect(result.current.profiles.map((p) => p.id)).toEqual(["p-1"])
    );

    mocks.getProfiles.mockRejectedValueOnce(new Error("store gone"));
    await act(async () => {
      const data = await result.current.loadProfiles();
      expect(data).toEqual([]);
    });

    expect(errorSpy).toHaveBeenCalled();
    expect(result.current.profiles.map((p) => p.id)).toEqual(["p-1"]);
    expect(result.current.isProfilesRefreshing).toBe(false);
  });

  it("discards a stale load response superseded by a newer request", async () => {
    const { result } = render();
    await waitFor(() =>
      expect(result.current.profiles.map((p) => p.id)).toEqual(["p-1"])
    );

    let resolveStale: ((value: ConfigProfile[]) => void) | undefined;
    mocks.getProfiles.mockImplementationOnce(
      () =>
        new Promise<ConfigProfile[]>((resolve) => {
          resolveStale = resolve;
        })
    );

    let stalePromise!: Promise<ConfigProfile[]>;
    act(() => {
      stalePromise = result.current.loadProfiles();
    });

    mocks.getProfiles.mockResolvedValueOnce([profile("p-new")]);
    await act(async () => {
      await result.current.loadProfiles();
    });
    expect(result.current.profiles.map((p) => p.id)).toEqual(["p-new"]);

    await act(async () => {
      resolveStale?.([profile("p-stale")]);
      const data = await stalePromise;
      expect(data.map((p) => p.id)).toEqual(["p-stale"]);
    });

    expect(result.current.profiles.map((p) => p.id)).toEqual(["p-new"]);
    expect(result.current.isProfilesRefreshing).toBe(false);
  });

  it("does not roll back the visible snapshot when a stale request fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = render();
    await waitFor(() =>
      expect(result.current.profiles.map((p) => p.id)).toEqual(["p-1"])
    );

    let rejectStale: ((err: unknown) => void) | undefined;
    mocks.getProfiles.mockImplementationOnce(
      () =>
        new Promise<ConfigProfile[]>((_, reject) => {
          rejectStale = reject;
        })
    );

    let stalePromise!: Promise<ConfigProfile[]>;
    act(() => {
      stalePromise = result.current.loadProfiles();
    });

    mocks.getProfiles.mockResolvedValueOnce([profile("p-new")]);
    await act(async () => {
      await result.current.loadProfiles();
    });

    await act(async () => {
      rejectStale?.(new Error("stale failed"));
      const data = await stalePromise;
      expect(data).toEqual([]);
    });

    expect(errorSpy).toHaveBeenCalled();
    expect(result.current.profiles.map((p) => p.id)).toEqual(["p-new"]);
    expect(result.current.isProfilesRefreshing).toBe(false);
  });

  it("commits pre-fetched profiles without refetching", async () => {
    const { result } = render();
    await waitFor(() => expect(mocks.getProfiles).toHaveBeenCalledTimes(1));

    await act(async () => {
      const data = await result.current.refreshProfilesAfterMutation("repo-1", [
        profile("p-pre"),
      ]);
      expect(data.map((p: ConfigProfile) => p.id)).toEqual(["p-pre"]);
    });

    expect(mocks.getProfiles).toHaveBeenCalledTimes(1);
    expect(result.current.profiles.map((p) => p.id)).toEqual(["p-pre"]);
  });

  it("reloads through loadProfiles when the mutated repository is selected", async () => {
    const { result } = render();
    await waitFor(() => expect(mocks.getProfiles).toHaveBeenCalledTimes(1));

    mocks.getProfiles.mockResolvedValueOnce([profile("p-2")]);
    await act(async () => {
      const data = await result.current.refreshProfilesAfterMutation("repo-1");
      expect(data.map((p: ConfigProfile) => p.id)).toEqual(["p-2"]);
    });

    expect(mocks.getProfiles).toHaveBeenCalledTimes(2);
    expect(result.current.profiles.map((p) => p.id)).toEqual(["p-2"]);
    expect(result.current.isProfilesRefreshing).toBe(false);
  });

  it("commits a non-selected repository refresh without touching the visible snapshot", async () => {
    const { result } = render();
    await waitFor(() => expect(mocks.getProfiles).toHaveBeenCalled());

    mocks.getProfiles.mockResolvedValueOnce([profile("p-other")]);
    await act(async () => {
      const data = await result.current.refreshProfilesAfterMutation("repo-2");
      expect(data.map((p: ConfigProfile) => p.id)).toEqual(["p-other"]);
    });

    expect(result.current.profiles.map((p) => p.id)).toEqual(["p-1"]);
    expect(result.current.isCurrentRepo("repo-2")).toBe(false);
  });
});
