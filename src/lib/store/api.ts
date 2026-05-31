import { invoke } from "@tauri-apps/api/core";

import {
  normalizeEnvironmentProviderIds,
} from "@/features/environment/environment";
import type { ParameterSchema } from "@/types/parameters";
import type {
  AppState,
  ConfigExport,
  ConfigParameters,
  ConfigProfile,
  ExecutionRecord,
  ProfileOrderEntry,
  ProjectScanCandidates,
  ProviderManifest,
  Repository,
  TrayPublishStatus,
  UpdateInfo,
} from "./types";
import {
  normalizeAppState,
  normalizeConfigProfile,
  normalizeImportedConfigProfile,
  normalizeRepository,
  toExportConfigProfile,
} from "./types";
import type {
  AppState as TauriAppState,
  ConfigExport as TauriConfigExport,
  ConfigProfile as TauriConfigProfile,
  ExecutionRecord as TauriExecutionRecord,
  ProjectInfo,
  ProjectPublishProfileFile,
  ProjectScanCandidates as TauriProjectScanCandidates,
  ProviderCatalogEntry as TauriProviderCatalogEntry,
  PublishConfigStore,
  Repository as TauriRepository,
  RepositoryBranchConnectivityResult,
  RepositoryBranchScanResult,
  ShortcutHelp,
  UpdateInfo as TauriUpdateInfo,
  UpdaterConfigHealth,
  UpdaterHelpPaths,
} from "@/generated/tauri-contracts";

export async function getAppState(): Promise<AppState> {
  const state = await invoke<TauriAppState>("get_app_state");
  return normalizeAppState(state);
}

export async function getRepository(repoId: string): Promise<Repository> {
  const repository = await invoke<TauriRepository>("get_repository", { repoId });
  return normalizeRepository(repository);
}

export async function addRepository(repo: Repository): Promise<AppState> {
  const state = await invoke<TauriAppState>("add_repository", { repo });
  return normalizeAppState(state);
}

export async function removeRepository(repoId: string): Promise<AppState> {
  const state = await invoke<TauriAppState>("remove_repository", { repoId });
  return normalizeAppState(state);
}

export async function updateRepository(repo: Repository): Promise<AppState> {
  const state = await invoke<TauriAppState>("update_repository", { repo });
  return normalizeAppState(state);
}

export async function reorderRepositories(repoIds: string[]): Promise<AppState> {
  const state = await invoke<TauriAppState>("reorder_repositories", {
    repoIds,
  });
  return normalizeAppState(state);
}

export async function updateUIState(params: {
  leftPanelWidth?: number;
  middlePanelWidth?: number;
  selectedRepoId?: string | null;
  clearSelectedRepoId?: boolean;
}): Promise<AppState> {
  const state = await invoke<TauriAppState>("update_ui_state", params);
  return normalizeAppState(state);
}

export async function updatePublishState(params: {
  repoId: string;
  selectedPreset?: string;
  isCustomMode?: boolean;
  customConfig?: PublishConfigStore;
}): Promise<AppState> {
  const state = await invoke<TauriAppState>("update_publish_state", params);
  return normalizeAppState(state);
}

export async function updatePreferences(params: {
  language?: string;
  minimizeToTrayOnClose?: boolean;
  defaultOutputDir?: string;
  theme?: "light" | "dark" | "auto";
  executionHistoryLimit?: number;
  environmentProviderIds?: string[];
}): Promise<AppState> {
  const state = await invoke<TauriAppState>("update_preferences", {
    ...params,
    default_output_dir: params.defaultOutputDir,
    execution_history_limit: params.executionHistoryLimit,
    environment_provider_ids:
      params.environmentProviderIds !== undefined
        ? normalizeEnvironmentProviderIds(params.environmentProviderIds)
        : undefined,
  });

  return normalizeAppState(state);
}

export async function pushRecentPublishConfig(params: {
  repoId: string;
  configKey: string;
}): Promise<AppState> {
  const state = await invoke<TauriAppState>("push_recent_publish_config", params);
  return normalizeAppState(state);
}

export async function removeRecentPublishConfig(params: {
  repoId: string;
  configKey: string;
}): Promise<AppState> {
  const state = await invoke<TauriAppState>("remove_recent_publish_config", params);
  return normalizeAppState(state);
}

export async function replaceRecentPublishConfigKey(params: {
  repoId: string;
  previousKey: string;
  nextKey: string;
}): Promise<AppState> {
  const state = await invoke<TauriAppState>("replace_recent_publish_config_key", params);
  return normalizeAppState(state);
}

export async function reorderRecentPublishConfigs(params: {
  repoId: string;
  configKeys: string[];
}): Promise<AppState> {
  const state = await invoke<TauriAppState>("reorder_recent_publish_configs", params);
  return normalizeAppState(state);
}

export async function listProviders(): Promise<ProviderManifest[]> {
  const catalog = await invoke<TauriProviderCatalogEntry[]>("list_providers");
  return catalog.map((entry) => ({
    id: entry.id,
    displayName: entry.display_name,
    version: entry.version,
    label: entry.label,
    commandExample: entry.command_example,
    environmentLabel: entry.environment_label,
    environmentDescription: entry.environment_description,
    requiresProjectBinding: entry.requires_project_binding,
    projectPathKind: entry.project_path_kind,
    supportsCommandImport: entry.supports_command_import,
  }));
}

export async function getProviderSchema(
  providerId: string
): Promise<ParameterSchema> {
  return await invoke<ParameterSchema>("get_provider_schema", { providerId });
}

export async function readProjectPublishProfile(
  projectFile: string,
  profileName: string
): Promise<ProjectPublishProfileFile> {
  return await invoke<ProjectPublishProfileFile>("read_project_publish_profile", {
    projectFile,
    profileName,
  });
}

export async function detectRepositoryProvider(path: string): Promise<string> {
  return await invoke<string>("detect_repository_provider", { path });
}

export async function scanProjectFiles(path: string): Promise<string[]> {
  return await invoke<string[]>("scan_project_files", { path });
}

export async function scanProject(startPath?: string): Promise<ProjectInfo> {
  return await invoke<ProjectInfo>("scan_project", { startPath });
}

export async function scanProjectCandidates(
  startPath?: string
): Promise<ProjectScanCandidates> {
  const result = await invoke<TauriProjectScanCandidates>("scan_project_candidates", {
    startPath,
  });
  return {
    ...result,
    recommendedProjectFile: result.recommendedProjectFile ?? undefined,
  };
}

export async function resolveProjectInfo(projectFile: string): Promise<ProjectInfo> {
  return await invoke<ProjectInfo>("resolve_project_info", { projectFile });
}

export async function scanRepositoryBranches(
  path: string,
  options?: { refreshRemote?: boolean }
): Promise<RepositoryBranchScanResult> {
  return await invoke<RepositoryBranchScanResult>("scan_repository_branches", {
    path,
    refreshRemote: options?.refreshRemote,
  });
}

export async function checkRepositoryBranchConnectivity(
  path: string,
  currentBranch?: string
): Promise<RepositoryBranchConnectivityResult> {
  return await invoke<RepositoryBranchConnectivityResult>(
    "check_repository_branch_connectivity",
    {
      path,
      currentBranch: currentBranch?.trim() || null,
    }
  );
}

export async function checkUpdate(): Promise<UpdateInfo> {
  const result = await invoke<TauriUpdateInfo>("check_update");
  return {
    currentVersion: result.current_version,
    availableVersion: result.available_version,
    hasUpdate: result.has_update,
    releaseNotes: result.release_notes,
    message: result.message,
  };
}

export async function installUpdate(
  expectedVersion?: string | null
): Promise<string> {
  return await invoke<string>("install_update", { expectedVersion });
}

export async function getUpdaterHelpPaths(): Promise<UpdaterHelpPaths> {
  return await invoke<UpdaterHelpPaths>("get_updater_help_paths");
}

export async function getUpdaterConfigHealth(): Promise<UpdaterConfigHealth> {
  return await invoke<UpdaterConfigHealth>("get_updater_config_health");
}

export async function openUpdaterHelp(
  target: "docs" | "template"
): Promise<string> {
  return await invoke<string>("open_updater_help", { target });
}

export async function getCurrentVersion(): Promise<string> {
  return await invoke<string>("get_current_version");
}

export async function getShortcutsHelp(): Promise<ShortcutHelp[]> {
  return await invoke<ShortcutHelp[]>("get_shortcuts_help");
}

export async function getProfiles(repoId: string): Promise<ConfigProfile[]> {
  const profiles = await invoke<TauriConfigProfile[]>("get_profiles", { repoId });
  return profiles.map(normalizeConfigProfile);
}

export async function saveProfile(params: {
  repoId: string;
  name: string;
  providerId: string;
  parameters: ConfigParameters;
  profileGroup?: string;
}): Promise<AppState> {
  const state = await invoke<TauriAppState>("save_profile", params);
  return normalizeAppState(state);
}

export async function updateProfile(params: {
  repoId: string;
  originalName: string;
  name: string;
  providerId: string;
  parameters: ConfigParameters;
  profileGroup?: string;
}): Promise<AppState> {
  const state = await invoke<TauriAppState>("update_profile", params);
  return normalizeAppState(state);
}

export async function reorderProfiles(params: {
  repoId: string;
  profiles: ProfileOrderEntry[];
}): Promise<AppState> {
  const state = await invoke<TauriAppState>("reorder_profiles", {
    repoId: params.repoId,
    profiles: params.profiles.map((profile) => ({
      name: profile.name,
      profileGroup: profile.profileGroup ?? null,
    })),
  });
  return normalizeAppState(state);
}

export async function deleteProfile(repoId: string, name: string): Promise<AppState> {
  const state = await invoke<TauriAppState>("delete_profile", { repoId, name });
  return normalizeAppState(state);
}

export async function exportConfig(params: {
  profiles: ConfigProfile[];
  filePath: string;
}): Promise<string> {
  return await invoke<string>("export_config", {
    profiles: params.profiles.map(toExportConfigProfile),
    file_path: params.filePath,
  });
}

export async function importConfig(filePath: string): Promise<ConfigExport> {
  const config = await invoke<TauriConfigExport>("import_config", {
    file_path: filePath,
  });

  return {
    version: config.version,
    exportedAt: config.exported_at,
    profiles: config.profiles.map(normalizeImportedConfigProfile),
  };
}

export async function applyImportedConfig(
  repoId: string,
  profiles: ConfigProfile[]
): Promise<void> {
  await invoke("apply_imported_config", {
    repoId,
    profiles: profiles.map(toExportConfigProfile),
  });
}

export async function getExecutionHistory(): Promise<ExecutionRecord[]> {
  return await invoke<TauriExecutionRecord[]>("get_execution_history");
}

export async function addExecutionRecord(
  record: ExecutionRecord
): Promise<ExecutionRecord[]> {
  return await invoke<TauriExecutionRecord[]>("add_execution_record", { record });
}

export async function setExecutionRecordSnapshot(
  recordId: string,
  snapshotPath: string
): Promise<ExecutionRecord[]> {
  return await invoke<TauriExecutionRecord[]>("set_execution_record_snapshot", {
    record_id: recordId,
    snapshot_path: snapshotPath,
  });
}

export async function openExecutionSnapshot(params: {
  snapshotPath?: string | null;
  outputDir?: string | null;
}): Promise<string> {
  return await invoke<string>("open_execution_snapshot", {
    snapshotPath: params.snapshotPath ?? null,
    outputDir: params.outputDir ?? null,
  });
}

export async function openDirectory(path: string): Promise<string> {
  return await invoke<string>("open_directory", { path });
}

export async function openOutputDirectory(outputDir: string): Promise<string> {
  return await invoke<string>("open_output_directory", { outputDir });
}

export async function showMainWindow(): Promise<boolean> {
  return await invoke<boolean>("show_main_window");
}

export async function setTrayPublishStatus(
  status: TrayPublishStatus
): Promise<boolean> {
  return await invoke<boolean>("set_tray_publish_status", { status });
}
