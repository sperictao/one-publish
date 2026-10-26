import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { error: toastMocks.error, success: toastMocks.success },
}));

import {
  useProfileCrud,
  type UseProfileCrudParams,
} from "@/features/config/useProfileCrud";
import type { ConfigProfile } from "@/lib/store/types";

function params(overrides: Partial<UseProfileCrudParams> = {}) {
  return {
    selectedRepoId: "repo-1",
    repositoryProviderId: "dotnet",
    profiles: [],
    activeProfileId: null,
    updatePublishEditState: vi.fn(),
    profileT: {},
    appT: {},
    activeProviderId: "dotnet",
    providerSchemas: {},
    applyProfileProvider: vi.fn(),
    setProviderParameters: vi.fn(),
    setActiveProfileName: vi.fn(),
    refreshProfilesAfterMutation: vi.fn().mockResolvedValue([]),
    isCurrentRepo: vi.fn().mockReturnValue(true),
    saveProfileToStore: vi.fn(),
    deleteProfileFromStore: vi.fn(),
    exportConfigFn: vi.fn(),
    applyImportedConfigFn: vi.fn(),
    ...overrides,
  } satisfies UseProfileCrudParams;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("applyProfile", () => {
  it("rejects profiles incompatible with the repository provider", () => {
    const p = params({ repositoryProviderId: "cargo" });
    const { result } = renderHook(() => useProfileCrud(p));

    const applied = result.current.applyProfile({
      id: "p1",
      name: "release",
      providerId: "dotnet",
    });

    expect(applied).toBe(false);
    expect(toastMocks.error).toHaveBeenCalledWith(
      "无法加载配置",
      expect.objectContaining({
        description: expect.stringContaining("cargo"),
      })
    );
    expect(p.updatePublishEditState).not.toHaveBeenCalled();
  });

  it("applies a compatible profile: selection, parameters, name, toast", () => {
    const p = params({
      providerSchemas: {
        dotnet: { parameters: { configuration: {} } } as never,
      },
    });
    const { result } = renderHook(() => useProfileCrud(p));

    const applied = result.current.applyProfile({
      id: "p1",
      name: "release",
      providerId: "dotnet",
      parameters: { configuration: "Release", orphan: "x" },
    });

    expect(applied).toBe(true);
    expect(p.updatePublishEditState).toHaveBeenCalledWith({
      selection: { kind: "revision", configurationId: "p1" },
    });
    // Schema filtering drops keys the provider doesn't know.
    const setParams = vi.mocked(p.setProviderParameters);
    const updater = setParams.mock.calls[0][0] as (prev: object) => object;
    expect(updater({})).toEqual({
      dotnet: { configuration: "Release" },
    });
    expect(p.setActiveProfileName).toHaveBeenCalledWith("release");
    expect(toastMocks.success).toHaveBeenCalledWith(
      "配置文件已加载",
      expect.objectContaining({
        description: expect.stringContaining("release"),
      })
    );
  });

  it("switches providers when the profile's provider differs", () => {
    const p = params({
      repositoryProviderId: null,
      activeProviderId: "dotnet",
    });
    const { result } = renderHook(() => useProfileCrud(p));

    result.current.applyProfile({
      id: "p1",
      name: "cargo-profile",
      provider_id: "cargo",
    });

    expect(p.applyProfileProvider).toHaveBeenCalledWith("cargo");
  });
});

describe("saveProfile / deleteProfile", () => {
  it("saves via the store and refreshes with returned profiles", async () => {
    const returnedProfiles = [{ id: "p1" } as ConfigProfile];
    const p = params({
      saveProfileToStore: vi.fn().mockResolvedValue({
        repositories: [
          { id: "repo-1", publishConfig: { profiles: returnedProfiles } },
        ],
      }),
    });
    const { result } = renderHook(() => useProfileCrud(p));

    await result.current.saveProfile({
      name: "n",
      providerId: "dotnet",
      parameters: {},
    });

    expect(p.saveProfileToStore).toHaveBeenCalledWith({
      repoId: "repo-1",
      name: "n",
      providerId: "dotnet",
      parameters: {},
      profileGroup: undefined,
    });
    expect(p.refreshProfilesAfterMutation).toHaveBeenCalledWith(
      "repo-1",
      returnedProfiles
    );
  });

  it("throws when no repository is selected", async () => {
    const p = params({ selectedRepoId: null });
    const { result } = renderHook(() => useProfileCrud(p));

    await expect(
      result.current.saveProfile({
        name: "n",
        providerId: "dotnet",
        parameters: {},
      })
    ).rejects.toThrow("保存配置文件失败");
    expect(p.saveProfileToStore).not.toHaveBeenCalled();
  });

  it("deletes by id, refreshes, and clears the active name for the active profile", async () => {
    const profilesAfter = [] as ConfigProfile[];
    const p = params({
      activeProfileId: "p1",
      deleteProfileFromStore: vi.fn().mockResolvedValue({
        repositories: [
          { id: "repo-1", publishConfig: { profiles: profilesAfter } },
        ],
      }),
    });
    const { result } = renderHook(() => useProfileCrud(p));

    await result.current.deleteProfile({ id: "p1" } as ConfigProfile);

    expect(p.deleteProfileFromStore).toHaveBeenCalledWith("repo-1", "p1");
    expect(p.refreshProfilesAfterMutation).toHaveBeenCalledWith(
      "repo-1",
      profilesAfter
    );
    expect(p.setActiveProfileName).toHaveBeenCalledWith(null);
  });

  it("keeps the active name when a different repo/profile is deleted", async () => {
    const p = params({
      activeProfileId: "other",
      isCurrentRepo: vi.fn().mockReturnValue(false),
      deleteProfileFromStore: vi.fn().mockResolvedValue({ repositories: [] }),
    });
    const { result } = renderHook(() => useProfileCrud(p));

    await result.current.deleteProfileById("repo-9", "p1");

    expect(p.setActiveProfileName).not.toHaveBeenCalled();
  });
});

describe("exportProfiles / applyImportedProfiles", () => {
  it("exports through the injected function", async () => {
    const p = params({
      exportConfigFn: vi.fn().mockResolvedValue("/out/export.json"),
    });
    const { result } = renderHook(() => useProfileCrud(p));

    await expect(
      result.current.exportProfiles("/out/export.json")
    ).resolves.toBe("/out/export.json");
    expect(p.exportConfigFn).toHaveBeenCalledWith({
      repoId: "repo-1",
      filePath: "/out/export.json",
    });
  });

  it("applies imported profiles then refreshes", async () => {
    const summary = { imported: 2 };
    const p = params({
      applyImportedConfigFn: vi.fn().mockResolvedValue(summary),
    });
    const { result } = renderHook(() => useProfileCrud(p));
    const imported = [{ id: "x" } as ConfigProfile];

    await expect(
      result.current.applyImportedProfiles(imported, "skip")
    ).resolves.toBe(summary);
    expect(p.applyImportedConfigFn).toHaveBeenCalledWith(
      "repo-1",
      imported,
      "skip"
    );
    expect(p.refreshProfilesAfterMutation).toHaveBeenCalledWith("repo-1");
  });
});

describe("handleCreateProfileFromProjectProfile", () => {
  it("dedupes the name, saves, activates, and selects the new revision", async () => {
    const created = { id: "new-1", name: "Release-copy2" } as ConfigProfile;
    const p = params({
      profiles: [{ name: "Release-copy" } as ConfigProfile],
      saveProfileToStore: vi.fn().mockResolvedValue({
        repositories: [
          { id: "repo-1", publishConfig: { profiles: [created] } },
        ],
      }),
      refreshProfilesAfterMutation: vi
        .fn()
        .mockResolvedValue([
          { name: "Release-copy" } as ConfigProfile,
          created,
        ]),
    });
    const { result } = renderHook(() => useProfileCrud(p));

    const name = await result.current.handleCreateProfileFromProjectProfile(
      "Release",
      { configuration: "Release" }
    );

    expect(name).toBe("Release-copy2");
    expect(p.saveProfileToStore).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Release-copy2", providerId: "dotnet" })
    );
    expect(p.setActiveProfileName).toHaveBeenCalledWith("Release-copy2");
    expect(p.updatePublishEditState).toHaveBeenCalledWith({
      selection: { kind: "revision", configurationId: "new-1" },
    });
  });

  it("throws when the created profile cannot be found after refresh", async () => {
    const p = params({
      saveProfileToStore: vi.fn().mockResolvedValue({ repositories: [] }),
      refreshProfilesAfterMutation: vi.fn().mockResolvedValue([]),
    });
    const { result } = renderHook(() => useProfileCrud(p));

    await expect(
      result.current.handleCreateProfileFromProjectProfile("Release", {})
    ).rejects.toThrow("保存后未找到配置身份");
  });
});
