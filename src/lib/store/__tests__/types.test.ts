import { describe, expect, it } from "vitest";

import {
  normalizeAppState,
  normalizeImportedConfigProfile,
  normalizeRepository,
  toExportConfigProfile,
  type ConfigProfile,
} from "@/lib/store/types";
import type {
  ConfigExportProfile,
  ConfigProfile as TauriConfigProfile,
  Repository as TauriRepository,
} from "@/generated/tauri-contracts";

const composition = {
  executionBackend: {
    adapterId: "cli",
    settingsVersion: 1,
    settings: {},
    credentials: {},
  },
  artifactStore: {
    adapterId: "fs",
    settingsVersion: 1,
    settings: {},
    credentials: {},
  },
  artifactProcessors: [],
  deliveryRoutes: [],
};

function tauriRevision(overrides: Record<string, unknown> = {}) {
  return {
    id: "rev-1",
    sequence: 1,
    createdAt: "2026-01-01T00:00:00Z",
    contractVersion: 1,
    providerId: "dotnet",
    providerVersion: "8",
    settingsVersion: 1,
    parameters: { output: "/out" },
    composition,
    ...overrides,
  };
}

function tauriProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: "cfg-1",
    name: "Release",
    profileGroup: null,
    createdAt: "2026-01-01T00:00:00Z",
    isSystemDefault: false,
    isDraft: false,
    currentRevisionId: "rev-1",
    revisions: [tauriRevision()],
    deletedAt: null,
    blockedReason: null,
    ...overrides,
  } as TauriConfigProfile;
}

function tauriRepo(profileOverrides: Record<string, unknown>[] = []) {
  return {
    id: "repo-1",
    name: "app",
    path: "/repo/app",
    projectFile: null,
    currentBranch: "main",
    branches: [
      { name: "main", commitCount: null },
      { name: "dev", commitCount: 3 },
    ],
    isMain: true,
    providerId: "dotnet",
    publishConfig: {
      drafts: [],
      profiles: profileOverrides.map((o) => tauriProfile(o)),
      bindings: [],
      appliedBundles: [],
    },
  } as unknown as TauriRepository;
}

describe("normalizeRepository", () => {
  it("converts missing branch commitCount to undefined", () => {
    const repo = normalizeRepository(tauriRepo());

    expect(repo.branches[0].commitCount).toBeUndefined();
    expect(repo.branches[1].commitCount).toBe(3);
  });

  it("filters drafts and deleted profiles from publish config", () => {
    const repo = normalizeRepository(
      tauriRepo([
        { id: "live" },
        { id: "draft", isDraft: true },
        { id: "gone", deletedAt: "2026-01-02T00:00:00Z" },
      ])
    );

    expect(repo.publishConfig.profiles.map((p) => p.id)).toEqual(["live"]);
  });

  it("collects external binding ids per configuration", () => {
    const repo = tauriRepo([{ id: "cfg-a" }]);
    repo.publishConfig.bindings = [
      { id: "b-1", configurationId: "cfg-a" },
      { id: "b-2", configurationId: "cfg-a" },
      { id: "b-3", configurationId: "other" },
    ] as never;

    const normalized = normalizeRepository(repo);

    expect(normalized.publishConfig.profiles[0].externalBindingIds).toEqual([
      "b-1",
      "b-2",
    ]);
  });

  it("throws when the current revision is missing", () => {
    const repo = tauriRepo([{ currentRevisionId: "rev-missing" }]);

    expect(() => normalizeRepository(repo)).toThrow(
      "Profile cfg-1 is missing current revision rev-missing"
    );
  });
});

describe("normalizeImportedConfigProfile", () => {
  it("maps export fields to a fresh profile", () => {
    const exported: ConfigExportProfile = {
      name: "Release",
      provider_id: "dotnet",
      contract_version: 1,
      provider_version: "8",
      settings_version: 2,
      parameters: { output: "/out" },
      composition: null,
      project_binding: "dotnet:app",
      profile_group: "team",
      created_at: "2026-01-01T00:00:00Z",
      is_system_default: false,
    };

    const profile = normalizeImportedConfigProfile(exported);

    expect(profile).toMatchObject({
      id: "",
      revisionId: "",
      name: "Release",
      providerId: "dotnet",
      contractVersion: 1,
      providerVersion: "8",
      settingsVersion: 2,
      projectBinding: "dotnet:app",
      profileGroup: "team",
      externalBindingIds: [],
      blockedReason: null,
    });
  });

  it("normalizes non-object parameters to an empty map", () => {
    const profile = normalizeImportedConfigProfile({
      name: "x",
      provider_id: "dotnet",
      contract_version: 1,
      provider_version: "8",
      settings_version: 1,
      parameters: [1, 2] as never,
      composition: null,
      project_binding: null,
      profile_group: null,
      created_at: "2026-01-01T00:00:00Z",
      is_system_default: false,
    });

    expect(profile.parameters).toEqual({});
  });
});

describe("toExportConfigProfile", () => {
  function profile(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
    return {
      id: "cfg-1",
      revisionId: "rev-1",
      name: "Release",
      providerId: "dotnet",
      parameters: {},
      createdAt: "2026-01-01T00:00:00Z",
      isSystemDefault: false,
      externalBindingIds: [],
      contractVersion: 1,
      providerVersion: "8",
      settingsVersion: 1,
      ...overrides,
    };
  }

  it("exports snake_case fields with null fallbacks", () => {
    const exported = toExportConfigProfile(profile());

    expect(exported).toMatchObject({
      provider_id: "dotnet",
      contract_version: 1,
      provider_version: "8",
      settings_version: 1,
      composition: null,
      project_binding: null,
      profile_group: null,
    });
  });

  it("throws when adapter version data is missing", () => {
    expect(() =>
      toExportConfigProfile(profile({ providerVersion: undefined }))
    ).toThrow("Profile Release is missing adapter version data");
  });
});

describe("normalizeAppState", () => {
  it("falls back to auto theme for unknown values", () => {
    const state = normalizeAppState({
      repositories: [],
      theme: "neon" as never,
      startupNotice: null,
      executionHistory: [],
    } as never);

    expect(state.theme).toBe("auto");
    expect(state.startupNotice).toBeUndefined();
  });

  it("keeps explicit themes and startup notice", () => {
    const state = normalizeAppState({
      repositories: [],
      theme: "dark",
      startupNotice: "recovered",
      executionHistory: [],
    } as never);

    expect(state.theme).toBe("dark");
    expect(state.startupNotice).toBe("recovered");
  });
});
