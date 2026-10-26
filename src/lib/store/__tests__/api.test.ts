import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import * as api from "@/lib/store/api";

const APP_STATE = {
  repositories: [],
  selectedRepoId: null,
  leftPanelWidth: 220,
  middlePanelWidth: 280,
  panelWidthsCustomized: false,
  minimizeToTrayOnClose: true,
  language: "zh",
  defaultOutputDir: "",
  theme: "auto",
  executionHistoryLimit: 20,
  environmentProviderIds: [],
  recentRepoIds: [],
  recentConfigKeysByRepo: {},
  executionHistory: [],
  startupNotice: null,
};

const TAURI_REPO = {
  id: "r",
  name: "r",
  path: "/repo",
  projectFile: null,
  currentBranch: "main",
  branches: [],
  isMain: true,
  providerId: null,
  publishConfig: { bindings: [], profiles: [], compositions: [] },
};

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({});
});

describe("invoke command boundary", () => {
  it.each<[string, () => Promise<unknown>, unknown[], unknown?]>([
    ["get_app_state", () => api.getAppState(), [undefined], APP_STATE],
    [
      "get_repository",
      () => api.getRepository("r1"),
      [{ repoId: "r1" }],
      TAURI_REPO,
    ],
    [
      "add_repository",
      () => api.addRepository({ id: "r" } as never),
      [{ repo: { id: "r" } }],
      APP_STATE,
    ],
    [
      "remove_repository",
      () => api.removeRepository("r1"),
      [{ repoId: "r1" }],
      APP_STATE,
    ],
    [
      "update_repository",
      () => api.updateRepository({ id: "r" } as never),
      [{ repo: { id: "r" } }],
      APP_STATE,
    ],
    [
      "reorder_repositories",
      () => api.reorderRepositories(["a", "b"]),
      [{ repoIds: ["a", "b"] }],
      APP_STATE,
    ],
    [
      "update_ui_state",
      () => api.updateUIState({ leftPanelWidth: 1 }),
      [{ leftPanelWidth: 1 }],
      APP_STATE,
    ],
    [
      "update_publish_edit_state",
      () =>
        api.updatePublishEditState({
          repoId: "r",
          update: { draft: { providerId: "dotnet", parameters: {} } },
        }),
      [
        {
          repoId: "r",
          update: { draft: { providerId: "dotnet", parameters: {} } },
        },
      ],
      APP_STATE,
    ],
    [
      "push_recent_publish_config",
      () => api.pushRecentPublishConfig({ repoId: "r", configKey: "k" }),
      [{ repoId: "r", configKey: "k" }],
      APP_STATE,
    ],
    [
      "remove_recent_publish_config",
      () => api.removeRecentPublishConfig({ repoId: "r", configKey: "k" }),
      [{ repoId: "r", configKey: "k" }],
      APP_STATE,
    ],
    [
      "replace_recent_publish_config_key",
      () =>
        api.replaceRecentPublishConfigKey({
          repoId: "r",
          previousKey: "a",
          nextKey: "b",
        }),
      [{ repoId: "r", previousKey: "a", nextKey: "b" }],
      APP_STATE,
    ],
    [
      "reorder_recent_publish_configs",
      () => api.reorderRecentPublishConfigs({ repoId: "r", configKeys: ["k"] }),
      [{ repoId: "r", configKeys: ["k"] }],
      APP_STATE,
    ],
    [
      "get_provider_schema",
      () => api.getProviderSchema("dotnet"),
      [{ providerId: "dotnet" }],
    ],
    [
      "read_project_publish_profile",
      () => api.readProjectPublishProfile("/p.csproj", "Release"),
      [{ projectFile: "/p.csproj", profileName: "Release" }],
    ],
    [
      "detect_repository_provider",
      () => api.detectRepositoryProvider("/repo"),
      [{ path: "/repo" }],
    ],
    [
      "scan_project",
      () => api.scanProject("/start"),
      [{ startPath: "/start" }],
    ],
    [
      "resolve_project_info",
      () => api.resolveProjectInfo("/p.csproj"),
      [{ projectFile: "/p.csproj" }],
    ],
    [
      "scan_repository_branches",
      () => api.scanRepositoryBranches("/repo", { refreshRemote: true }),
      [{ path: "/repo", refreshRemote: true }],
    ],
    [
      "install_update",
      () => api.installUpdate("1.2.3"),
      [{ expectedVersion: "1.2.3" }],
    ],
    ["get_updater_help_paths", () => api.getUpdaterHelpPaths(), [undefined]],
    [
      "get_updater_config_health",
      () => api.getUpdaterConfigHealth(),
      [undefined],
    ],
    [
      "open_updater_help",
      () => api.openUpdaterHelp("docs"),
      [{ target: "docs" }],
    ],
    ["get_current_version", () => api.getCurrentVersion(), [undefined]],
    ["get_shortcuts_help", () => api.getShortcutsHelp(), [undefined]],
    [
      "save_profile",
      () =>
        api.saveProfile({
          repoId: "r",
          name: "n",
          providerId: "dotnet",
          parameters: {},
        }),
      [{ repoId: "r", name: "n", providerId: "dotnet", parameters: {} }],
      APP_STATE,
    ],
    [
      "update_profile",
      () =>
        api.updateProfile({
          repoId: "r",
          profileId: "p",
          name: "n",
          providerId: "dotnet",
          parameters: {},
        }),
      [
        {
          repoId: "r",
          profileId: "p",
          name: "n",
          providerId: "dotnet",
          parameters: {},
        },
      ],
      APP_STATE,
    ],
    [
      "load_release_settings_draft",
      () => api.loadReleaseSettingsDraft({ repoId: "r", profileId: "p" }),
      [{ repoId: "r", profileId: "p" }],
    ],
    [
      "update_profile_release_settings",
      () =>
        api.updateProfileReleaseSettings({
          repoId: "r",
          profileId: "p",
          settings: {} as never,
        }),
      [{ repoId: "r", profileId: "p", settings: {} }],
      APP_STATE,
    ],
    [
      "list_publish_adapter_catalog",
      () => api.listPublishAdapterCatalog(),
      [undefined],
    ],
    [
      "rebind_profile_project",
      () => api.rebindProfileProject({ repoId: "r", profileId: "p" }),
      [{ repoId: "r", profileId: "p" }],
      APP_STATE,
    ],
    [
      "delete_profile",
      () => api.deleteProfile("r", "p"),
      [{ repoId: "r", profileId: "p" }],
      APP_STATE,
    ],
    [
      "export_config",
      () => api.exportConfig({ repoId: "r", filePath: "/f" }),
      [{ repoId: "r", filePath: "/f" }],
    ],
    ["get_execution_history", () => api.getExecutionHistory(), [undefined]],
    [
      "add_execution_record",
      () => api.addExecutionRecord({ id: "e" } as never),
      [{ record: { id: "e" } }],
    ],
    [
      "set_execution_record_snapshot",
      () => api.setExecutionRecordSnapshot("e", "/snap"),
      [{ recordId: "e", snapshotPath: "/snap" }],
    ],
    [
      "open_execution_snapshot",
      () => api.openExecutionSnapshot({ snapshotPath: "/s" }),
      [{ snapshotPath: "/s", outputDir: null }],
    ],
    ["open_directory", () => api.openDirectory("/d"), [{ path: "/d" }]],
    [
      "open_output_directory",
      () => api.openOutputDirectory("/out"),
      [{ outputDir: "/out" }],
    ],
    ["show_main_window", () => api.showMainWindow(), [undefined]],
    [
      "set_tray_publish_status",
      () => api.setTrayPublishStatus("publishing"),
      [{ status: "publishing" }],
    ],
  ])(
    "calls %s with the expected payload",
    async (command, call, args, response) => {
      invokeMock.mockResolvedValue(response ?? {});
      await call();
      if (args[0] === undefined) {
        expect(invokeMock).toHaveBeenCalledWith(command);
      } else {
        expect(invokeMock).toHaveBeenCalledWith(command, args[0]);
      }
    }
  );
});

describe("response transforms", () => {
  it("maps provider catalog entries to camelCase manifests", async () => {
    invokeMock.mockResolvedValue([
      {
        id: "dotnet",
        display_name: ".NET",
        version: "1.0",
        label: "dotnet",
        command_example: "dotnet publish",
        environment_label: "dotnet-sdk",
        environment_description: "desc",
        requires_project_binding: true,
        project_path_kind: "project_file",
        supports_command_import: true,
        templates: [],
      },
    ]);

    await expect(api.listProviders()).resolves.toEqual([
      {
        id: "dotnet",
        displayName: ".NET",
        version: "1.0",
        label: "dotnet",
        commandExample: "dotnet publish",
        environmentLabel: "dotnet-sdk",
        environmentDescription: "desc",
        requiresProjectBinding: true,
        projectPathKind: "project_file",
        supportsCommandImport: true,
        templates: [],
      },
    ]);
  });

  it("maps update info fields to camelCase", async () => {
    invokeMock.mockResolvedValue({
      current_version: "1.0.0",
      available_version: "1.1.0",
      has_update: true,
      release_notes: "notes",
      message: null,
    });

    await expect(api.checkUpdate()).resolves.toEqual({
      currentVersion: "1.0.0",
      availableVersion: "1.1.0",
      hasUpdate: true,
      releaseNotes: "notes",
      message: null,
    });
  });

  it("converts recommendedProjectFile null to undefined", async () => {
    invokeMock.mockResolvedValue({
      candidates: [],
      recommendedProjectFile: null,
    });
    await expect(api.scanProjectCandidates("/p")).resolves.toEqual({
      candidates: [],
      recommendedProjectFile: undefined,
    });
    expect(invokeMock).toHaveBeenCalledWith("scan_project_candidates", {
      startPath: "/p",
      providerId: undefined,
    });
  });

  it("normalizes environment provider ids before persisting preferences", async () => {
    invokeMock.mockResolvedValue(APP_STATE);
    await api.updatePreferences({ environmentProviderIds: [" b ", "a", ""] });
    expect(invokeMock).toHaveBeenCalledWith("update_preferences", {
      environmentProviderIds: ["a", "b"],
    });

    invokeMock.mockClear();
    await api.updatePreferences({ theme: "dark" });
    expect(invokeMock).toHaveBeenCalledWith("update_preferences", {
      theme: "dark",
      environmentProviderIds: undefined,
    });
  });

  it("coerces blank currentBranch to null for connectivity checks", async () => {
    await api.checkRepositoryBranchConnectivity("/repo", "  ");
    expect(invokeMock).toHaveBeenCalledWith(
      "check_repository_branch_connectivity",
      { path: "/repo", currentBranch: null }
    );

    await api.checkRepositoryBranchConnectivity("/repo", "main");
    expect(invokeMock).toHaveBeenLastCalledWith(
      "check_repository_branch_connectivity",
      { path: "/repo", currentBranch: "main" }
    );
  });

  it("maps reorder entries with null profileGroup", async () => {
    invokeMock.mockResolvedValue(APP_STATE);
    await api.reorderProfiles({
      repoId: "r",
      profiles: [{ id: "p1", profileGroup: "g" }, { id: "p2" }] as never,
    });
    expect(invokeMock).toHaveBeenCalledWith("reorder_profiles", {
      repoId: "r",
      profiles: [
        { id: "p1", profileGroup: "g" },
        { id: "p2", profileGroup: null },
      ],
    });
  });

  it("coerces openExecutionSnapshot absent params to null", async () => {
    await api.openExecutionSnapshot({});
    expect(invokeMock).toHaveBeenCalledWith("open_execution_snapshot", {
      snapshotPath: null,
      outputDir: null,
    });
  });

  it("normalizes imported config profiles on import", async () => {
    invokeMock.mockResolvedValue({
      version: 1,
      exported_at: "2026-01-01",
      profiles: [],
    });
    await expect(api.importConfig("/f.json")).resolves.toEqual({
      version: 1,
      exportedAt: "2026-01-01",
      profiles: [],
    });
    expect(invokeMock).toHaveBeenCalledWith("import_config", {
      filePath: "/f.json",
    });
  });

  it("exports profiles through toExportConfigProfile on apply", async () => {
    invokeMock.mockResolvedValue({ imported: 0 });
    await api.applyImportedConfig("r", [], "overwrite");
    expect(invokeMock).toHaveBeenCalledWith("apply_imported_config", {
      repoId: "r",
      profiles: [],
      conflictStrategy: "overwrite",
    });
  });
});
