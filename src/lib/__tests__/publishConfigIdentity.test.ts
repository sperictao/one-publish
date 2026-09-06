import { describe, expect, it } from "vitest";

import {
  createPresetConfigKey,
  createProjectProfileConfigKey,
  createProjectProfileSelectedPreset,
  createRecentConfigRenderId,
  createUserProfileConfigKey,
  getProjectProfileNameFromConfigKey,
  getProjectProfileNameFromRenderId,
  getRecentConfigKeyFromRenderId,
  getSelectedProjectProfileName,
  getUserProfileIdFromConfigKey,
  getUserProfileIdFromRenderId,
  normalizeRenderableConfigId,
  parsePublishConfigKey,
  resolveDotnetRecentConfigKeyForSelection,
  resolveSelectedPublishConfigKeyFromIdentity,
} from "@/lib/publishConfigIdentity";

describe("publishConfigIdentity", () => {
  it("round-trips project profile selected presets", () => {
    const selectedPreset =
      createProjectProfileSelectedPreset(" FolderProfile ");

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
    expect(parsePublishConfigKey("userprofile: profile-42 ")).toEqual({
      kind: "user-profile",
      profileId: "profile-42",
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
    expect(
      normalizeRenderableConfigId(createProjectProfileConfigKey("Folder"))
    ).toBe("pubxml:Folder");
  });

  it("resolves current dotnet selection into recent config keys", () => {
    expect(
      resolveDotnetRecentConfigKeyForSelection({
        activeProviderId: "dotnet",
        selection: {
          kind: "revision" as const,
          configurationId: "alpha",
        },
      })
    ).toBe("userprofile:alpha");

    expect(
      resolveDotnetRecentConfigKeyForSelection({
        activeProviderId: "dotnet",
        selection: {
          kind: "projectProfile" as const,
          providerId: "dotnet",
          reference: "FolderProfile",
        },
      })
    ).toBe("pubxml:FolderProfile");

    expect(
      resolveDotnetRecentConfigKeyForSelection({
        activeProviderId: "cargo",
        selection: null,
      })
    ).toBeNull();
  });

  it("draft selection does not derive user profile identity", () => {
    expect(
      resolveDotnetRecentConfigKeyForSelection({
        activeProviderId: "dotnet",
        selection: {
          kind: "draft",
          providerId: "dotnet",
          projectBinding: null,
        },
      })
    ).toBeNull();
  });

  it("resolves selected config keys from selection identity", () => {
    expect(
      resolveSelectedPublishConfigKeyFromIdentity({
        kind: "user-profile",
        profileId: "alpha",
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
    expect(getProjectProfileNameFromConfigKey("pubxml:Release")).toBe(
      "Release"
    );
    expect(getProjectProfileNameFromConfigKey("userprofile:alpha")).toBeNull();
    expect(getProjectProfileNameFromConfigKey("preset:folder")).toBeNull();

    expect(getUserProfileIdFromConfigKey("userprofile:profile-42")).toBe(
      "profile-42"
    );
    expect(getUserProfileIdFromConfigKey("pubxml:Release")).toBeNull();
    expect(getUserProfileIdFromConfigKey("")).toBeNull();
  });

  it("extracts profile names from render ids", () => {
    expect(getProjectProfileNameFromRenderId("pubxml:Folder")).toBe("Folder");
    expect(getProjectProfileNameFromRenderId("userprofile:alpha")).toBeNull();
    expect(getProjectProfileNameFromRenderId(null)).toBeNull();
    expect(getProjectProfileNameFromRenderId("")).toBeNull();

    expect(getUserProfileIdFromRenderId("userprofile:profile-42")).toBe(
      "profile-42"
    );
    expect(getUserProfileIdFromRenderId("pubxml:Foo")).toBeNull();
    expect(getUserProfileIdFromRenderId(null)).toBeNull();
  });

  it("keeps a user profile key stable when its display name changes", () => {
    const configKey = createUserProfileConfigKey("profile-42");

    expect(configKey).toBe("userprofile:profile-42");
    expect(parsePublishConfigKey(configKey)).toEqual({
      kind: "user-profile",
      profileId: "profile-42",
    });
  });

  it("creates preset config keys explicitly", () => {
    expect(createPresetConfigKey("release-fd")).toBe("preset:release-fd");
    expect(createPresetConfigKey("  debug  ")).toBe("preset:debug");

    const userKey = createUserProfileConfigKey(" My Team ");
    expect(userKey).toBe("userprofile:My Team");
    expect(parsePublishConfigKey(userKey)).toEqual({
      kind: "user-profile",
      profileId: "My Team",
    });
  });

  it("handles identity value trimming consistently", () => {
    expect(createProjectProfileConfigKey(" Folder ")).toBe("pubxml:Folder");
    expect(createUserProfileConfigKey(" Alpha ")).toBe("userprofile:Alpha");
    expect(getSelectedProjectProfileName("profile-   \t")).toBeNull();
    expect(getSelectedProjectProfileName("profile- \t Name ")).toBe("Name");
  });

  it("resolves dotnet recent config key for template selection", () => {
    expect(
      resolveDotnetRecentConfigKeyForSelection({
        activeProviderId: "dotnet",
        selection: {
          kind: "template" as const,
          providerId: "dotnet",
          templateId: "release-fd",
        },
      })
    ).toBe("preset:release-fd");

    expect(
      resolveDotnetRecentConfigKeyForSelection({
        activeProviderId: "dotnet",
        selection: null,
      })
    ).toBeNull();
  });
});
