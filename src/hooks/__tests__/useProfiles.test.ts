import type { PublishSelectionRef } from "@/generated/tauri-contracts";
import type { Repository } from "@/lib/store/types";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProfiles: vi.fn(),
  saveProfile: vi.fn(),
  updateProfile: vi.fn(),
  deleteProfile: vi.fn(),
  exportConfig: vi.fn(),
  applyImportedConfig: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: mocks.toast,
}));

vi.mock("@/lib/store/api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/store/api")>("@/lib/store/api");
  return {
    ...actual,
    getProfiles: mocks.getProfiles,
    saveProfile: mocks.saveProfile,
    updateProfile: mocks.updateProfile,
    deleteProfile: mocks.deleteProfile,
    exportConfig: mocks.exportConfig,
    applyImportedConfig: mocks.applyImportedConfig,
  };
});

import { useProfiles } from "@/features/config/useProfiles";
import type { ConfigProfile } from "@/lib/store/types";

interface UseProfilesTestProps {
  selectedRepoId: string | null;
  selectedPreset?: string;
  isCustomMode?: boolean;
}

const defaultUseProfilesProps: UseProfilesTestProps = {
  selectedRepoId: "repo-a",
};

function createSelectedRepo(configurationId: string | null): Repository {
  return {
    id: "repo-a",
    name: "repo-a",
    path: "/repo-a",
    currentBranch: "main",
    branches: [],
    isMain: false,
    providerId: "dotnet",
    publishConfig: {
      profiles: [],
      bindings: [],
      appliedBundles: [],
      drafts: [],
      selection:
        configurationId === null
          ? undefined
          : ({
              kind: "revision" as const,
              configurationId,
            } as PublishSelectionRef),
    },
  };
}

function createProfile(name: string): ConfigProfile {
  return {
    id: name,
    revisionId: `${name}-revision`,
    name,
    providerId: "dotnet",
    parameters: {},
    profileGroup: undefined,
    createdAt: "2026-04-02T00:00:00.000Z",
    isSystemDefault: false,
    externalBindingIds: [],
    blockedReason: null,
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
    mocks.saveProfile.mockResolvedValue({ repositories: [] });
    mocks.updateProfile.mockResolvedValue({ repositories: [] });
    mocks.deleteProfile.mockResolvedValue({ repositories: [] });
    mocks.exportConfig.mockResolvedValue("/tmp/one-publish-config.json");
    mocks.applyImportedConfig.mockResolvedValue(undefined);
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
          applyProfileProvider: vi.fn(),
          updatePublishEditState: vi.fn(),
          selectedRepo: null,
          setProviderParameters: vi.fn(),
          replaceScopedConfigKey: vi.fn(),
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
      expect(result.current.profiles.map((profile) => profile.name)).toEqual([
        "beta",
      ]);
    });

    await act(async () => {
      repoA.resolve([createProfile("alpha")]);
    });

    expect(result.current.profiles.map((profile) => profile.name)).toEqual([
      "beta",
    ]);
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
          applyProfileProvider: vi.fn(),
          updatePublishEditState: vi.fn(),
          selectedRepo: null,
          setProviderParameters: vi.fn(),
          replaceScopedConfigKey: vi.fn(),
        }),
      {
        initialProps: "repo-a",
      }
    );

    await act(async () => {
      repoA.resolve([createProfile("alpha")]);
    });

    await waitFor(() => {
      expect(result.current.profiles.map((profile) => profile.name)).toEqual([
        "alpha",
      ]);
    });

    rerender("repo-b");
    expect(result.current.profiles).toEqual([]);

    await act(async () => {
      repoB.resolve([createProfile("beta")]);
    });

    await waitFor(() => {
      expect(result.current.profiles.map((profile) => profile.name)).toEqual([
        "beta",
      ]);
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
          applyProfileProvider: vi.fn(),
          updatePublishEditState: vi.fn(),
          selectedRepo: null,
          setProviderParameters: vi.fn(),
          replaceScopedConfigKey: vi.fn(),
        }),
      {
        initialProps: "repo-a",
      }
    );

    await act(async () => {
      repoAInitial.resolve([createProfile("alpha")]);
    });

    await waitFor(() => {
      expect(result.current.profiles.map((profile) => profile.name)).toEqual([
        "alpha",
      ]);
    });

    rerender("repo-b");

    await act(async () => {
      repoB.resolve([createProfile("beta")]);
    });

    await waitFor(() => {
      expect(result.current.profiles.map((profile) => profile.name)).toEqual([
        "beta",
      ]);
    });

    rerender("repo-a");

    expect(result.current.profiles.map((profile) => profile.name)).toEqual([
      "alpha",
    ]);
    expect(result.current.isProfilesRefreshing).toBe(true);

    await act(async () => {
      repoARefresh.resolve([createProfile("alpha-new")]);
    });

    await waitFor(() => {
      expect(result.current.profiles.map((profile) => profile.name)).toEqual([
        "alpha-new",
      ]);
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
          applyProfileProvider: vi.fn(),
          updatePublishEditState: vi.fn(),
          selectedRepo: null,
          setProviderParameters: vi.fn(),
          replaceScopedConfigKey: vi.fn(),
        }),
      {
        initialProps: "repo-a",
      }
    );

    await act(async () => {
      repoAInitial.resolve([createProfile("alpha")]);
    });

    await waitFor(() => {
      expect(result.current.profiles.map((profile) => profile.name)).toEqual([
        "alpha",
      ]);
      expect(result.current.profilesRevision).toBe(1);
    });

    rerender("repo-b");

    await act(async () => {
      repoB.resolve([createProfile("beta")]);
    });

    await waitFor(() => {
      expect(result.current.profiles.map((profile) => profile.name)).toEqual([
        "beta",
      ]);
      expect(result.current.profilesRevision).toBe(1);
    });

    rerender("repo-a");

    expect(result.current.profiles.map((profile) => profile.name)).toEqual([
      "alpha",
    ]);
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

  it("切回仓库时会从持久化的 userprofile 选择恢复 activeProfileName", async () => {
    const repoAInitial = createDeferred<ConfigProfile[]>();
    const repoB = createDeferred<ConfigProfile[]>();
    const repoARefresh = createDeferred<ConfigProfile[]>();
    mocks.getProfiles
      .mockImplementationOnce(() => repoAInitial.promise)
      .mockImplementationOnce(() => repoB.promise)
      .mockImplementationOnce(() => repoARefresh.promise);

    const { result, rerender } = renderHook(
      (props: UseProfilesTestProps) =>
        useProfiles({
          appT: {},
          profileT: {},
          language: "zh",
          selectedRepoId: props.selectedRepoId,
          activeProviderId: "dotnet",
          providerSchemas: {},
          applyProfileProvider: vi.fn(),
          updatePublishEditState: vi.fn(),
          selectedRepo: createSelectedRepo("alpha"),
          setProviderParameters: vi.fn(),
          replaceScopedConfigKey: vi.fn(),
        }),
      {
        initialProps: {
          selectedRepoId: "repo-a",
        },
      }
    );

    await act(async () => {
      repoAInitial.resolve([createProfile("alpha")]);
    });

    await waitFor(() => {
      expect(result.current.profiles.map((profile) => profile.name)).toEqual([
        "alpha",
      ]);
      expect(result.current.activeProfileName).toBe("alpha");
    });

    rerender({
      ...defaultUseProfilesProps,
      selectedRepoId: "repo-b",
    });

    await act(async () => {
      repoB.resolve([createProfile("beta")]);
    });

    await waitFor(() => {
      expect(result.current.profiles.map((profile) => profile.name)).toEqual([
        "beta",
      ]);
      expect(result.current.activeProfileName).toBeNull();
    });

    rerender({
      selectedRepoId: "repo-a",
    });

    expect(result.current.profiles.map((profile) => profile.name)).toEqual([
      "alpha",
    ]);
    expect(result.current.activeProfileName).toBe("alpha");

    await act(async () => {
      repoARefresh.resolve([createProfile("alpha")]);
    });
  });

  it("普通 dotnet 自定义配置不会沿用之前的 userprofile 选中名", async () => {
    mocks.getProfiles.mockResolvedValue([createProfile("alpha")]);

    const { result, rerender } = renderHook(
      (props: UseProfilesTestProps) =>
        useProfiles({
          appT: {},
          profileT: {},
          language: "zh",
          selectedRepoId: props.selectedRepoId,
          activeProviderId: "dotnet",
          providerSchemas: {},
          applyProfileProvider: vi.fn(),
          updatePublishEditState: vi.fn(),
          selectedRepo: null,
          setProviderParameters: vi.fn(),
          replaceScopedConfigKey: vi.fn(),
        }),
      {
        initialProps: {
          selectedRepoId: "repo-a",
        },
      }
    );

    // 统一协议：仓库无 selection（草稿态）不继承任何 userprofile 选中名。
    await waitFor(() => {
      expect(result.current.profiles.map((profile) => profile.name)).toEqual([
        "alpha",
      ]);
    });
    expect(result.current.activeProfileName).toBeNull();

    rerender({
      selectedRepoId: "repo-a",
    });

    expect(result.current.activeProfileName).toBeNull();
  });

  it("通过 profileManagement 保存配置后刷新同一个 owner snapshot", async () => {
    const releaseProfile = createProfile("Release");
    mocks.saveProfile.mockResolvedValue({
      repositories: [
        { id: "repo-1", publishConfig: { profiles: [releaseProfile] } },
      ],
    });
    mocks.getProfiles.mockResolvedValueOnce([]);

    const { result } = renderHook(() =>
      useProfiles({
        appT: {},
        profileT: {},
        language: "zh",
        selectedRepoId: "repo-1",
        activeProviderId: "dotnet",
        providerSchemas: {},
        applyProfileProvider: vi.fn(),
        updatePublishEditState: vi.fn(),
        selectedRepo: null,
        setProviderParameters: vi.fn(),
        replaceScopedConfigKey: vi.fn(),
      })
    );

    await waitFor(() => {
      expect(mocks.getProfiles).toHaveBeenCalledWith("repo-1");
    });

    await act(async () => {
      await result.current.profileManagement.saveProfile({
        name: "Release",
        providerId: "dotnet",
        parameters: {
          configuration: "Release",
        },
      });
    });

    expect(mocks.saveProfile).toHaveBeenCalledWith({
      repoId: "repo-1",
      name: "Release",
      providerId: "dotnet",
      parameters: {
        configuration: "Release",
      },
      profileGroup: undefined,
    });
    await waitFor(() => {
      expect(result.current.profiles.map((profile) => profile.name)).toEqual([
        "Release",
      ]);
    });
  });

  it("按 profileId 保存重命名修订并保持同一选择 key，不替换收藏或最近使用 key", async () => {
    const original = { ...createProfile("Alpha"), id: "profile-42" };
    const renamed = {
      ...original,
      revisionId: "revision-2",
      name: "Renamed",
    };
    mocks.getProfiles.mockResolvedValue([original]);
    mocks.updateProfile.mockResolvedValue({
      repositories: [{ id: "repo-1", publishConfig: { profiles: [renamed] } }],
    });
    const replaceScopedConfigKey = vi.fn();

    const { result } = renderHook(() =>
      useProfiles({
        appT: {},
        profileT: {},
        language: "zh",
        selectedRepoId: "repo-1",
        activeProviderId: "dotnet",
        providerSchemas: {},
        applyProfileProvider: vi.fn(),
        updatePublishEditState: vi.fn(),
        selectedRepo: createSelectedRepo("profile-42"),
        setProviderParameters: vi.fn(),
        replaceScopedConfigKey,
      })
    );

    await waitFor(() => expect(result.current.profiles).toEqual([original]));

    act(() => {
      result.current.openQuickEditProfileDialog(original);
      result.current.setQuickCreateProfileName("Renamed");
    });
    await act(async () => {
      await result.current.handleQuickCreateProfileSave();
    });

    expect(mocks.updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        repoId: "repo-1",
        profileId: "profile-42",
        name: "Renamed",
      })
    );
    // 统一协议：重命名不回写选择（selection 已是稳定配置 ID）。
    expect(replaceScopedConfigKey).not.toHaveBeenCalled();
    expect(result.current.activeProfileName).toBe("Renamed");
  });

  it("非 dotnet 配置也按稳定 ID 成为当前配置", async () => {
    const cargoProfile = {
      ...createProfile("Cargo Release"),
      id: "cargo-profile-42",
      revisionId: "cargo-revision-7",
      providerId: "cargo",
      parameters: { release: true },
    };
    mocks.getProfiles.mockResolvedValue([cargoProfile]);
    const updatePublishEditState = vi.fn();
    const setProviderParameters = vi.fn();

    const { result } = renderHook(() =>
      useProfiles({
        appT: {},
        profileT: {},
        language: "zh",
        selectedRepoId: "repo-1",
        activeProviderId: "cargo",
        providerSchemas: {},
        applyProfileProvider: vi.fn(),
        updatePublishEditState,
        selectedRepo: null,
        setProviderParameters,
        replaceScopedConfigKey: vi.fn(),
      })
    );
    await waitFor(() =>
      expect(result.current.profiles).toEqual([cargoProfile])
    );

    act(() => {
      result.current.handleSelectProfileFromPanel(cargoProfile);
    });

    // 统一协议：非 dotnet 档案选择提交 revision 引用 + schema 参数注入本地状态。
    expect(updatePublishEditState).toHaveBeenCalledWith({
      selection: {
        kind: "revision",
        configurationId: "cargo-profile-42",
      },
    });
    expect(setProviderParameters).toHaveBeenCalled();
    expect(result.current.activeProfileName).toBe("Cargo Release");
  });

  it("通过 profileManagement 应用导入配置后刷新同一个 owner snapshot", async () => {
    const importedProfiles = [createProfile("Imported")];
    mocks.getProfiles
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(importedProfiles);

    const { result } = renderHook(() =>
      useProfiles({
        appT: {},
        profileT: {},
        language: "zh",
        selectedRepoId: "repo-1",
        activeProviderId: "dotnet",
        providerSchemas: {},
        applyProfileProvider: vi.fn(),
        updatePublishEditState: vi.fn(),
        selectedRepo: null,
        setProviderParameters: vi.fn(),
        replaceScopedConfigKey: vi.fn(),
      })
    );

    await waitFor(() => {
      expect(mocks.getProfiles).toHaveBeenCalledWith("repo-1");
    });

    await act(async () => {
      await result.current.profileManagement.applyImportedProfiles(
        importedProfiles
      );
    });

    expect(mocks.applyImportedConfig).toHaveBeenCalledWith(
      "repo-1",
      importedProfiles
    );
    await waitFor(() => {
      expect(result.current.profiles.map((profile) => profile.name)).toEqual([
        "Imported",
      ]);
    });
  });
});
