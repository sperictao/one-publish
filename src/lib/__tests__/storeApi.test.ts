import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import {
  applyImportedConfig,
  deleteProfile,
  exportConfig,
  getProfiles,
  importConfig,
  reorderProfiles,
  scanProjectCandidates,
  setExecutionRecordSnapshot,
  updatePreferences,
  updateProfile,
} from "@/lib/store/api";

describe("store api wrappers", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("scanProjectCandidates passes the selected path using Tauri's camelCase argument key", async () => {
    invokeMock.mockResolvedValue({
      rootPath: "/tmp/demo-repo",
      solutionFiles: ["/tmp/demo-repo/App.sln"],
      projectFiles: ["/tmp/demo-repo/src/App/App.csproj"],
      recommendedProjectFile: "/tmp/demo-repo/src/App/App.csproj",
    });

    const result = await scanProjectCandidates("/tmp/demo-repo");

    expect(invokeMock).toHaveBeenCalledWith("scan_project_candidates", {
      startPath: "/tmp/demo-repo",
    });
    expect(result.recommendedProjectFile).toBe(
      "/tmp/demo-repo/src/App/App.csproj"
    );
  });

  it("scanProjectCandidates normalizes null recommendations to undefined", async () => {
    invokeMock.mockResolvedValue({
      rootPath: "/tmp/demo-repo",
      solutionFiles: [],
      projectFiles: [],
      recommendedProjectFile: null,
    });

    const result = await scanProjectCandidates("/tmp/demo-repo");

    expect(result.recommendedProjectFile).toBeUndefined();
  });

  it("flattens the current immutable profile revision for frontend consumers", async () => {
    invokeMock.mockResolvedValue({
      id: "repo-1",
      name: "Repo 1",
      path: "/repo-1",
      projectFile: null,
      currentBranch: "main",
      branches: [],
      isMain: true,
      providerId: "dotnet",
      publishConfig: {
        selection: {
          kind: "draft" as const,
          providerId: "dotnet",
          projectBinding: null,
        },
        bindings: [
          {
            id: "binding-1",
            configurationId: "profile-42",
            configurationRevisionId: "revision-1",
            externalIdentity: "nightly",
          },
        ],
        profiles: [
          {
            id: "profile-42",
            name: "Renamed",
            profileGroup: "Stable",
            createdAt: "2026-07-21T00:00:00.000Z",
            isSystemDefault: false,
            deletedAt: null,
            blockedReason: "2 automation bindings still reference this profile",
            currentRevisionId: "revision-2",
            revisions: [
              {
                id: "revision-1",
                sequence: 1,
                createdAt: "2026-07-20T00:00:00.000Z",
                contractVersion: 1,
                providerId: "dotnet",
                providerVersion: "1",
                settingsVersion: 1,
                parameters: { configuration: "Debug" },
              },
              {
                id: "revision-2",
                sequence: 2,
                createdAt: "2026-07-21T00:00:00.000Z",
                contractVersion: 1,
                providerId: "dotnet",
                providerVersion: "1",
                settingsVersion: 1,
                parameters: { configuration: "Release" },
              },
            ],
          },
          {
            id: "profile-deleted",
            name: "Deleted",
            profileGroup: null,
            createdAt: "2026-07-19T00:00:00.000Z",
            isSystemDefault: false,
            deletedAt: "2026-07-21T00:00:00.000Z",
            blockedReason: null,
            currentRevisionId: "deleted-revision",
            revisions: [
              {
                id: "deleted-revision",
                sequence: 1,
                createdAt: "2026-07-19T00:00:00.000Z",
                contractVersion: 1,
                providerId: "dotnet",
                providerVersion: "1",
                settingsVersion: 1,
                parameters: {},
              },
            ],
          },
        ],
      },
    });

    await expect(getProfiles("repo-1")).resolves.toEqual([
      {
        id: "profile-42",
        revisionId: "revision-2",
        name: "Renamed",
        providerId: "dotnet",
        parameters: { configuration: "Release" },
        profileGroup: "Stable",
        createdAt: "2026-07-21T00:00:00.000Z",
        isSystemDefault: false,
        externalBindingIds: ["binding-1"],
        blockedReason: "2 automation bindings still reference this profile",
      },
    ]);
  });

  it("uses immutable profile IDs for update, delete, and reorder commands", async () => {
    invokeMock.mockResolvedValue({ repositories: [] });

    await updateProfile({
      repoId: "repo-1",
      profileId: "profile-42",
      name: "Renamed",
      providerId: "dotnet",
      parameters: { configuration: "Release" },
      profileGroup: "Stable",
    });
    await deleteProfile("repo-1", "profile-42");
    await reorderProfiles({
      repoId: "repo-1",
      profiles: [{ id: "profile-42", profileGroup: "Stable" }],
    });

    expect(invokeMock).toHaveBeenNthCalledWith(1, "update_profile", {
      repoId: "repo-1",
      profileId: "profile-42",
      name: "Renamed",
      providerId: "dotnet",
      parameters: { configuration: "Release" },
      profileGroup: "Stable",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "delete_profile", {
      repoId: "repo-1",
      profileId: "profile-42",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "reorder_profiles", {
      repoId: "repo-1",
      profiles: [{ id: "profile-42", profileGroup: "Stable" }],
    });
  });

  it("applyImportedConfig returns the per-outcome counts from the backend", async () => {
    const summary = {
      imported: 1,
      skippedExisting: 2,
      skippedProviderMismatch: 3,
    };
    invokeMock.mockResolvedValue(summary);

    await expect(applyImportedConfig("repo-1", [])).resolves.toEqual(summary);
  });

  // 键名覆盖由 tauriCommandContract.test.ts 从 Rust 签名自动推导；
  // 这里只锁定包装层对实参值的变换（规范化、省略 undefined 等）。
  it.each([
    {
      name: "exportConfig",
      call: () =>
        exportConfig({ repoId: "repo-1", filePath: "/tmp/config.json" }),
      response: "/tmp/config.json",
      command: "export_config",
      args: { repoId: "repo-1", filePath: "/tmp/config.json" },
    },
    {
      name: "importConfig",
      call: () => importConfig("/tmp/config.json"),
      response: {
        version: 1,
        exported_at: "2026-04-02T12:00:00.000Z",
        profiles: [],
      },
      command: "import_config",
      args: { filePath: "/tmp/config.json" },
    },
    {
      name: "applyImportedConfig",
      call: () => applyImportedConfig("repo-1", []),
      response: { imported: 0, skippedExisting: 0, skippedProviderMismatch: 0 },
      command: "apply_imported_config",
      args: { repoId: "repo-1", profiles: [] },
    },
    {
      name: "setExecutionRecordSnapshot",
      call: () => setExecutionRecordSnapshot("record-1", "/tmp/snapshot.json"),
      response: [],
      command: "set_execution_record_snapshot",
      args: { recordId: "record-1", snapshotPath: "/tmp/snapshot.json" },
    },
    {
      name: "updatePreferences",
      call: () =>
        updatePreferences({
          language: "en",
          minimizeToTrayOnClose: true,
          defaultOutputDir: "/tmp/out",
          theme: "dark",
          executionHistoryLimit: 50,
          environmentProviderIds: [" node ", "dotnet", "node", ""],
        }),
      response: { repositories: [] },
      command: "update_preferences",
      args: {
        language: "en",
        minimizeToTrayOnClose: true,
        defaultOutputDir: "/tmp/out",
        theme: "dark",
        executionHistoryLimit: 50,
        environmentProviderIds: ["dotnet", "node"],
      },
    },
    {
      name: "updatePreferences without environmentProviderIds",
      call: () => updatePreferences({ language: "zh" }),
      response: { repositories: [] },
      command: "update_preferences",
      args: { language: "zh" },
    },
  ])(
    "$name invokes $command with camelCase argument keys",
    async ({ call, response, command, args }) => {
      invokeMock.mockResolvedValue(response);

      await call();

      expect(invokeMock).toHaveBeenCalledExactlyOnceWith(command, args);
    }
  );
});
