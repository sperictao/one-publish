import { describe, expect, it } from "vitest";

import {
  createPresetConfigKey,
  createProjectProfileConfigKey,
  createProjectProfileSelectedPreset,
  createRecentConfigRenderId,
  createUserProfileConfigKey,
  getActiveProfileNameFromSelection,
  getProjectProfileNameFromConfigKey,
  getProjectProfileNameFromSelection,
  getProjectProfileNameFromRenderId,
  getRecentConfigKeyFromSelection,
  getRecentConfigKeyFromRenderId,
  getSelectedProjectProfileName,
  getUserProfileNameFromConfigKey,
  getUserProfileNameFromRenderId,
  normalizeRenderableConfigId,
  parsePublishConfigKey,
  resolveDotnetRecentConfigKeyForSelection,
  resolvePublishSelectionIdentity,
  resolveSelectedPublishConfigKey,
  resolveSelectedPublishConfigKeyFromIdentity,
} from "@/lib/publishConfigIdentity";

describe("publishConfigIdentity", () => {
  it("round-trips project profile selected presets", () => {
    const selectedPreset = createProjectProfileSelectedPreset(" FolderProfile ");

    expect(selectedPreset).toBe("profile-FolderProfile");
    expect(getSelectedProjectProfileName(selectedPreset)).toBe("FolderProfile");
    expect(getSelectedProjectProfileName("folder")).toBeNull();
    expect(getSelectedProjectProfileName("profile-   ")).toBeNull();
  });

  it("parses publish config keys without losing values that contain colon", () => {
    expect(parsePublishConfigKey("pubxml:Release:Folder")).toEqual({
      kind: "project-profile",
      profileName: "Release:Folder",
    });
    expect(parsePublishConfigKey("userprofile: Team:Prod ")).toEqual({
      kind: "user-profile",
      profileName: "Team:Prod",
    });
    expect(parsePublishConfigKey("preset:folder")).toEqual({
      kind: "preset",
      id: "folder",
    });
  });

  it("rejects unsupported or empty publish config keys", () => {
    expect(parsePublishConfigKey("recent:userprofile:alpha")).toBeNull();
    expect(parsePublishConfigKey("pubxml:")).toBeNull();
    expect(parsePublishConfigKey("unknown:alpha")).toBeNull();
    expect(parsePublishConfigKey("alpha")).toBeNull();
  });

  it("normalizes recent render ids back to their underlying config key", () => {
    const configKey = createUserProfileConfigKey("alpha");
    const renderId = createRecentConfigRenderId(configKey);

    expect(renderId).toBe("recent:userprofile:alpha");
    expect(getRecentConfigKeyFromRenderId(renderId)).toBe(configKey);
    expect(normalizeRenderableConfigId(renderId)).toBe(configKey);
    expect(normalizeRenderableConfigId(createProjectProfileConfigKey("Folder"))).toBe(
      "pubxml:Folder"
    );
  });

  it("resolves current dotnet selection into recent config keys", () => {
    expect(
      resolveDotnetRecentConfigKeyForSelection({
        activeProviderId: "dotnet",
        isCustomMode: true,
        activeProfileName: "stale-alpha",
        selectedPreset: "userprofile:alpha",
      })
    ).toBe("userprofile:alpha");

    expect(
      resolveDotnetRecentConfigKeyForSelection({
        activeProviderId: "dotnet",
        isCustomMode: false,
        activeProfileName: null,
        selectedPreset: "profile-FolderProfile",
      })
    ).toBe("pubxml:FolderProfile");

    expect(
      resolveDotnetRecentConfigKeyForSelection({
        activeProviderId: "cargo",
        isCustomMode: false,
        activeProfileName: null,
        selectedPreset: "release",
      })
    ).toBeNull();
  });

  it("resolves publish selection identity from selectedPreset", () => {
    const userProfileIdentity = resolvePublishSelectionIdentity({
      activeProviderId: "dotnet",
      isCustomMode: true,
      selectedPreset: "userprofile:alpha",
    });
    expect(userProfileIdentity).toEqual({
      kind: "user-profile",
      profileName: "alpha",
      configKey: "userprofile:alpha",
    });
    expect(getActiveProfileNameFromSelection(userProfileIdentity)).toBe("alpha");
    expect(getRecentConfigKeyFromSelection(userProfileIdentity)).toBe(
      "userprofile:alpha"
    );

    const projectProfileIdentity = resolvePublishSelectionIdentity({
      activeProviderId: "dotnet",
      isCustomMode: false,
      selectedPreset: "profile-Folder",
    });
    expect(projectProfileIdentity).toEqual({
      kind: "project-profile",
      profileName: "Folder",
      configKey: "pubxml:Folder",
    });
    expect(getProjectProfileNameFromSelection(projectProfileIdentity)).toBe(
      "Folder"
    );

    expect(
      resolvePublishSelectionIdentity({
        activeProviderId: "cargo",
        isCustomMode: false,
        selectedPreset: "release",
      })
    ).toEqual({
      kind: "provider",
      providerId: "cargo",
    });
  });

  it("does not derive user profile identity from stale activeProfileName", () => {
    expect(
      resolveDotnetRecentConfigKeyForSelection({
        activeProviderId: "dotnet",
        isCustomMode: true,
        activeProfileName: "stale-alpha",
        selectedPreset: "folder",
      })
    ).toBeNull();

    expect(
      resolveSelectedPublishConfigKey({
        isCustomMode: true,
        activeProfileName: "stale-alpha",
        selectedPreset: "folder",
      })
    ).toBeNull();
  });

  it("resolves selected renderable config keys through one identity rule", () => {
    expect(
      resolveSelectedPublishConfigKey({
        isCustomMode: true,
        activeProfileName: "stale-alpha",
        selectedPreset: "userprofile:alpha",
      })
    ).toBe("userprofile:alpha");

    expect(
      resolveSelectedPublishConfigKey({
        isCustomMode: false,
        activeProfileName: null,
        selectedPreset: "profile-Folder",
        hasProjectProfile: (name) => name === "Folder",
      })
    ).toBe("pubxml:Folder");

    expect(
      resolveSelectedPublishConfigKey({
        isCustomMode: false,
        activeProfileName: null,
        selectedPreset: "profile-Missing",
        hasProjectProfile: (name) => name === "Folder",
      })
    ).toBeNull();

    expect(getProjectProfileNameFromConfigKey("pubxml:Folder")).toBe("Folder");
  });

  it("resolves selected config keys from selection identity", () => {
    expect(
      resolveSelectedPublishConfigKeyFromIdentity({
        kind: "user-profile",
        profileName: "alpha",
        configKey: "userprofile:alpha",
      })
    ).toBe("userprofile:alpha");

    expect(
      resolveSelectedPublishConfigKeyFromIdentity(
        {
          kind: "project-profile",
          profileName: "Folder",
          configKey: "pubxml:Folder",
        },
        {
          hasProjectProfile: (name) => name === "Folder",
        }
      )
    ).toBe("pubxml:Folder");

    expect(
      resolveSelectedPublishConfigKeyFromIdentity(
        {
          kind: "project-profile",
          profileName: "Missing",
          configKey: "pubxml:Missing",
        },
        {
          hasProjectProfile: (name) => name === "Folder",
        }
      )
    ).toBeNull();
  });

  it("extracts profile names from config keys via convenience helpers", () => {
    expect(getProjectProfileNameFromConfigKey("pubxml:Release")).toBe("Release");
    expect(getProjectProfileNameFromConfigKey("userprofile:alpha")).toBeNull();
    expect(getProjectProfileNameFromConfigKey("preset:folder")).toBeNull();

    expect(getUserProfileNameFromConfigKey("userprofile:Team")).toBe("Team");
    expect(getUserProfileNameFromConfigKey("pubxml:Release")).toBeNull();
    expect(getUserProfileNameFromConfigKey("")).toBeNull();
  });

  it("extracts profile names from render ids", () => {
    expect(getProjectProfileNameFromRenderId("pubxml:Folder")).toBe("Folder");
    expect(getProjectProfileNameFromRenderId("userprofile:alpha")).toBeNull();
    expect(getProjectProfileNameFromRenderId(null)).toBeNull();
    expect(getProjectProfileNameFromRenderId("")).toBeNull();

    expect(getUserProfileNameFromRenderId("userprofile:Team")).toBe("Team");
    expect(getUserProfileNameFromRenderId("pubxml:Foo")).toBeNull();
    expect(getUserProfileNameFromRenderId(null)).toBeNull();
  });

  it("creates preset config keys explicitly", () => {
    expect(createPresetConfigKey("release-fd")).toBe("preset:release-fd");
    expect(createPresetConfigKey("  debug  ")).toBe("preset:debug");

    const userKey = createUserProfileConfigKey(" My Team ");
    expect(userKey).toBe("userprofile:My Team");
    expect(parsePublishConfigKey(userKey)).toEqual({
      kind: "user-profile",
      profileName: "My Team",
    });
  });

  it("handles identity value trimming consistently", () => {
    expect(createProjectProfileConfigKey(" Folder ")).toBe("pubxml:Folder");
    expect(createUserProfileConfigKey(" Alpha ")).toBe("userprofile:Alpha");
    expect(getSelectedProjectProfileName("profile-   \t")).toBeNull();
    expect(getSelectedProjectProfileName("profile- \t Name ")).toBe("Name");
  });

  it("resolves dotnet recent config key for preset-only selection", () => {
    expect(
      resolveDotnetRecentConfigKeyForSelection({
        activeProviderId: "dotnet",
        isCustomMode: false,
        activeProfileName: null,
        selectedPreset: "release-fd",
      })
    ).toBe("preset:release-fd");

    expect(
      resolveDotnetRecentConfigKeyForSelection({
        activeProviderId: "dotnet",
        isCustomMode: true,
        activeProfileName: null,
        selectedPreset: "folder",
      })
    ).toBeNull();
  });

  it("resolves selected config key with missing hasProjectProfile guard", () => {
    expect(
      resolveSelectedPublishConfigKey({
        isCustomMode: false,
        activeProfileName: null,
        selectedPreset: "profile-Folder",
      })
    ).toBe("pubxml:Folder");

    expect(
      resolveSelectedPublishConfigKey({
        isCustomMode: false,
        activeProfileName: null,
        selectedPreset: "release-fd",
      })
    ).toBeNull();
  });
});
