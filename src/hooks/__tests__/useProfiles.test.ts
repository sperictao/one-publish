import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProfiles: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: mocks.toast,
}));

vi.mock("@/lib/store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/store")>("@/lib/store");
  return {
    ...actual,
    getProfiles: mocks.getProfiles,
  };
});

import { useProfiles } from "@/hooks/useProfiles";
import type { ConfigProfile } from "@/lib/store";

function createProfile(name: string): ConfigProfile {
  return {
    name,
    providerId: "dotnet",
    parameters: {},
    profileGroup: undefined,
    createdAt: "2026-04-02T00:00:00.000Z",
    isSystemDefault: false,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("useProfiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("会忽略旧仓库晚到的配置列表响应", async () => {
    const repoA = createDeferred<ConfigProfile[]>();
    const repoB = createDeferred<ConfigProfile[]>();
    mocks.getProfiles
      .mockImplementationOnce(() => repoA.promise)
      .mockImplementationOnce(() => repoB.promise);

    const { result, rerender } = renderHook(
      (selectedRepoId: string | null) =>
        useProfiles({
          appT: {},
          profileT: {},
          language: "zh",
          selectedRepoId,
          activeProviderId: "dotnet",
          providerSchemas: {},
          setActiveProviderId: vi.fn(),
          setIsCustomMode: vi.fn(),
          isCustomMode: false,
          setSelectedPreset: vi.fn(),
          setProviderParameters: vi.fn(),
          applyDotnetCustomConfig: vi.fn(),
          replaceScopedConfigKey: vi.fn(),
          presets: [],
          defaultPresetId: "release-fd",
          getPresetText: (_presetId, fallbackName, fallbackDescription) => ({
            name: fallbackName,
            description: fallbackDescription,
          }),
          buildProfileParameters: () => ({}),
        }),
      {
        initialProps: "repo-a",
      }
    );

    rerender("repo-b");

    await act(async () => {
      repoB.resolve([createProfile("beta")]);
    });

    await waitFor(() => {
      expect(result.current.profiles.map((profile) => profile.name)).toEqual(["beta"]);
    });

    await act(async () => {
      repoA.resolve([createProfile("alpha")]);
    });

    expect(result.current.profiles.map((profile) => profile.name)).toEqual(["beta"]);
    expect(mocks.getProfiles).toHaveBeenNthCalledWith(1, "repo-a");
    expect(mocks.getProfiles).toHaveBeenNthCalledWith(2, "repo-b");
  });

  it("切换仓库时会先清空旧列表，再等待新仓库返回", async () => {
    const repoA = createDeferred<ConfigProfile[]>();
    const repoB = createDeferred<ConfigProfile[]>();
    mocks.getProfiles
      .mockImplementationOnce(() => repoA.promise)
      .mockImplementationOnce(() => repoB.promise);

    const { result, rerender } = renderHook(
      (selectedRepoId: string | null) =>
        useProfiles({
          appT: {},
          profileT: {},
          language: "zh",
          selectedRepoId,
          activeProviderId: "dotnet",
          providerSchemas: {},
          setActiveProviderId: vi.fn(),
          setIsCustomMode: vi.fn(),
          isCustomMode: false,
          setSelectedPreset: vi.fn(),
          setProviderParameters: vi.fn(),
          applyDotnetCustomConfig: vi.fn(),
          replaceScopedConfigKey: vi.fn(),
          presets: [],
          defaultPresetId: "release-fd",
          getPresetText: (_presetId, fallbackName, fallbackDescription) => ({
            name: fallbackName,
            description: fallbackDescription,
          }),
          buildProfileParameters: () => ({}),
        }),
      {
        initialProps: "repo-a",
      }
    );

    await act(async () => {
      repoA.resolve([createProfile("alpha")]);
    });

    await waitFor(() => {
      expect(result.current.profiles.map((profile) => profile.name)).toEqual(["alpha"]);
    });

    rerender("repo-b");
    expect(result.current.profiles).toEqual([]);

    await act(async () => {
      repoB.resolve([createProfile("beta")]);
    });

    await waitFor(() => {
      expect(result.current.profiles.map((profile) => profile.name)).toEqual(["beta"]);
    });
  });

  it("切回已访问仓库时会立即回显该仓库缓存，再后台刷新", async () => {
    const repoAInitial = createDeferred<ConfigProfile[]>();
    const repoB = createDeferred<ConfigProfile[]>();
    const repoARefresh = createDeferred<ConfigProfile[]>();
    mocks.getProfiles
      .mockImplementationOnce(() => repoAInitial.promise)
      .mockImplementationOnce(() => repoB.promise)
      .mockImplementationOnce(() => repoARefresh.promise);

    const { result, rerender } = renderHook(
      (selectedRepoId: string | null) =>
        useProfiles({
          appT: {},
          profileT: {},
          language: "zh",
          selectedRepoId,
          activeProviderId: "dotnet",
          providerSchemas: {},
          setActiveProviderId: vi.fn(),
          setIsCustomMode: vi.fn(),
          isCustomMode: false,
          setSelectedPreset: vi.fn(),
          setProviderParameters: vi.fn(),
          applyDotnetCustomConfig: vi.fn(),
          replaceScopedConfigKey: vi.fn(),
          presets: [],
          defaultPresetId: "release-fd",
          getPresetText: (_presetId, fallbackName, fallbackDescription) => ({
            name: fallbackName,
            description: fallbackDescription,
          }),
          buildProfileParameters: () => ({}),
        }),
      {
        initialProps: "repo-a",
      }
    );

    await act(async () => {
      repoAInitial.resolve([createProfile("alpha")]);
    });

    await waitFor(() => {
      expect(result.current.profiles.map((profile) => profile.name)).toEqual(["alpha"]);
    });

    rerender("repo-b");

    await act(async () => {
      repoB.resolve([createProfile("beta")]);
    });

    await waitFor(() => {
      expect(result.current.profiles.map((profile) => profile.name)).toEqual(["beta"]);
    });

    rerender("repo-a");

    expect(result.current.profiles.map((profile) => profile.name)).toEqual(["alpha"]);
    expect(result.current.isProfilesRefreshing).toBe(true);

    await act(async () => {
      repoARefresh.resolve([createProfile("alpha-new")]);
    });

    await waitFor(() => {
      expect(result.current.profiles.map((profile) => profile.name)).toEqual(["alpha-new"]);
      expect(result.current.isProfilesRefreshing).toBe(false);
    });
  });

  it("切回已访问仓库时只回显缓存 revision，提交新快照后才推进 profilesRevision", async () => {
    const repoAInitial = createDeferred<ConfigProfile[]>();
    const repoB = createDeferred<ConfigProfile[]>();
    const repoARefresh = createDeferred<ConfigProfile[]>();
    mocks.getProfiles
      .mockImplementationOnce(() => repoAInitial.promise)
      .mockImplementationOnce(() => repoB.promise)
      .mockImplementationOnce(() => repoARefresh.promise);

    const { result, rerender } = renderHook(
      (selectedRepoId: string | null) =>
        useProfiles({
          appT: {},
          profileT: {},
          language: "zh",
          selectedRepoId,
          activeProviderId: "dotnet",
          providerSchemas: {},
          setActiveProviderId: vi.fn(),
          setIsCustomMode: vi.fn(),
          isCustomMode: false,
          setSelectedPreset: vi.fn(),
          setProviderParameters: vi.fn(),
          applyDotnetCustomConfig: vi.fn(),
          replaceScopedConfigKey: vi.fn(),
          presets: [],
          defaultPresetId: "release-fd",
          getPresetText: (_presetId, fallbackName, fallbackDescription) => ({
            name: fallbackName,
            description: fallbackDescription,
          }),
          buildProfileParameters: () => ({}),
        }),
      {
        initialProps: "repo-a",
      }
    );

    await act(async () => {
      repoAInitial.resolve([createProfile("alpha")]);
    });

    await waitFor(() => {
      expect(result.current.profiles.map((profile) => profile.name)).toEqual(["alpha"]);
      expect(result.current.profilesRevision).toBe(1);
    });

    rerender("repo-b");

    await act(async () => {
      repoB.resolve([createProfile("beta")]);
    });

    await waitFor(() => {
      expect(result.current.profiles.map((profile) => profile.name)).toEqual(["beta"]);
      expect(result.current.profilesRevision).toBe(1);
    });

    rerender("repo-a");

    expect(result.current.profiles.map((profile) => profile.name)).toEqual(["alpha"]);
    expect(result.current.profilesRevision).toBe(1);
    expect(result.current.isProfilesRefreshing).toBe(true);

    await act(async () => {
      repoARefresh.resolve([createProfile("alpha-new")]);
    });

    await waitFor(() => {
      expect(result.current.profiles.map((profile) => profile.name)).toEqual([
        "alpha-new",
      ]);
      expect(result.current.profilesRevision).toBe(2);
      expect(result.current.isProfilesRefreshing).toBe(false);
    });
  });
});
