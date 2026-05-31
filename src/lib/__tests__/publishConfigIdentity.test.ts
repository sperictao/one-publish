import { describe, expect, it } from "vitest";

import {
  createProjectProfileConfigKey,
  createProjectProfileSelectedPreset,
  createRecentConfigRenderId,
  createUserProfileConfigKey,
  getProjectProfileNameFromConfigKey,
  getRecentConfigKeyFromRenderId,
  getSelectedProjectProfileName,
  normalizeRenderableConfigId,
  parsePublishConfigKey,
  resolveDotnetRecentConfigKeyForSelection,
  resolveSelectedPublishConfigKey,
} from "@/features/config/publishConfigIdentity";

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
        activeProfileName: "alpha",
        selectedPreset: "folder",
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

  it("resolves selected renderable config keys through one identity rule", () => {
    expect(
      resolveSelectedPublishConfigKey({
        isCustomMode: true,
        activeProfileName: "alpha",
        selectedPreset: "folder",
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
});
