import { invoke } from "@tauri-apps/api/core";

import {
  normalizeEnvironmentProviderIds,
  type EnvironmentCheckResult,
} from "@/lib/environment";
import type { ParameterSchema } from "@/types/parameters";
import type {
  AppState as TauriAppState,
  Branch as TauriBranch,
  ConfigExport as TauriConfigExport,
  ConfigExportProfile,
  ConfigProfile as TauriConfigProfile,
  ExecutionRecord as TauriExecutionRecord,
  JsonValue,
  ProjectInfo,
  ProjectPublishProfileFile,
  ProjectScanCandidates as TauriProjectScanCandidates,
  ProviderCatalogEntry as TauriProviderCatalogEntry,
  ProviderProjectPathKind,
  PublishConfigStore,
  Repository as TauriRepository,
  RepositoryBranchConnectivityResult,
  RepositoryBranchScanResult,
  RepoPublishConfig as TauriRepoPublishConfig,
  ShortcutHelp,
  UpdateInfo as TauriUpdateInfo,
  UpdaterConfigHealth,
  UpdaterHelpPaths,
} from "@/generated/tauri-contracts";

export type { JsonValue, PublishConfigStore };
export type {
  ProviderProjectPathKind,
  ProjectInfo,
  ProjectPublishProfileFile,
  RepositoryBranchConnectivityResult,
  RepositoryBranchScanResult,
  ShortcutHelp,
  UpdaterConfigHealth,
  UpdaterHelpPaths,
};

export interface Branch extends Omit<TauriBranch, "commitCount"> {
  commitCount?: number | null;
}

export interface ExecutionRecord
  extends Omit<
    TauriExecutionRecord,
    | "repoId"
    | "outputDir"
    | "error"
    | "commandLine"
    | "snapshotPath"
    | "failureSignature"
    | "outputExcerpt"
    | "spec"
  > {
  repoId?: string | null;
  outputDir?: string | null;
  error?: string | null;
  commandLine?: string | null;
  snapshotPath?: string | null;
  failureSignature?: string | null;
  outputExcerpt?: string | null;
  spec?: JsonValue | null;
}

export interface ProjectScanCandidates
  extends Omit<TauriProjectScanCandidates, "recommendedProjectFile"> {
  recommendedProjectFile?: string | null;
}

export type ConfigParameters = Record<string, JsonValue>;

export interface ConfigProfile
  extends Omit<TauriConfigProfile, "parameters" | "profileGroup"> {
  parameters: ConfigParameters;
  profileGroup?: string | null;
}

export interface ProfileOrderEntry {
  name: string;
  profileGroup?: string | null;
}

export interface RepoPublishConfig
  extends Omit<TauriRepoPublishConfig, "profiles"> {
  profiles: ConfigProfile[];
}

export interface Repository
  extends Omit<TauriRepository, "publishConfig" | "projectFile" | "providerId" | "isMain" | "branches"> {
  projectFile?: string | null;
  providerId?: string | null;
  isMain?: boolean;
  branches: Branch[];
  publishConfig: RepoPublishConfig;
}

export type BootstrapState = Omit<AppState, "executionHistory">;

export interface AppState
  extends Omit<TauriAppState, "repositories" | "theme" | "startupNotice" | "executionHistory"> {
  repositories: Repository[];
  theme: "light" | "dark" | "auto";
  startupNotice?: string | null;
  executionHistory: ExecutionRecord[];
}

export interface ProviderManifest {
  id: string;
  displayName: string;
  version: string;
  label: string;
  commandExample: string;
  environmentLabel: string;
  environmentDescription: string;
  requiresProjectBinding: boolean;
  projectPathKind: ProviderProjectPathKind;
  supportsCommandImport: boolean;
}

export interface UpdateInfo {
  currentVersion: string;
  availableVersion: string | null;
  hasUpdate: boolean;
  releaseNotes: string | null;
  message: string | null;
}

export type TrayPublishStatus = "idle" | "publishing" | "success" | "failure";

export interface ConfigExport {
  version: number;
  exportedAt: string;
  profiles: ConfigProfile[];
}

function isJsonRecord(value: JsonValue | null | undefined): value is ConfigParameters {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeConfigParameters(
  value: JsonValue | null | undefined
): ConfigParameters {
  return isJsonRecord(value) ? value : {};
}

function normalizeConfigProfile(profile: TauriConfigProfile): ConfigProfile {
  return {
    ...profile,
    parameters: normalizeConfigParameters(profile.parameters),
  };
}

function normalizeImportedConfigProfile(profile: ConfigExportProfile): ConfigProfile {
  return {
    name: profile.name,
    providerId: profile.provider_id,
    parameters: normalizeConfigParameters(profile.parameters),
    profileGroup: profile.profile_group,
    createdAt: profile.created_at,
    isSystemDefault: profile.is_system_default,
  };
}

function toExportConfigProfile(profile: ConfigProfile): ConfigExportProfile {
  return {
    name: profile.name,
    provider_id: profile.providerId,
    parameters: profile.parameters,
    profile_group: profile.profileGroup ?? null,
    created_at: profile.createdAt,
    is_system_default: profile.isSystemDefault,
  };
}

function normalizeRepoPublishConfig(config: TauriRepoPublishConfig): RepoPublishConfig {
  return {
    ...config,
    profiles: config.profiles.map(normalizeConfigProfile),
  };
}

function normalizeRepository(repository: TauriRepository): Repository {
  return {
    ...repository,
    branches: repository.branches.map((branch) => ({
      ...branch,
      commitCount: branch.commitCount ?? undefined,
    })),
    publishConfig: normalizeRepoPublishConfig(repository.publishConfig),
  };
}

function normalizeAppState(state: TauriAppState): AppState {
  return {
    ...state,
    repositories: state.repositories.map(normalizeRepository),
    theme:
      state.theme === "light" || state.theme === "dark" || state.theme === "auto"
        ? state.theme
        : "auto",
    startupNotice: state.startupNotice ?? undefined,
    executionHistory: state.executionHistory,
  };
}

export const defaultBootstrapState: BootstrapState = {
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
  environmentProviderIds: ["dotnet"],
  recentRepoIds: [],
  recentConfigKeysByRepo: {},
  startupNotice: null,
};

export const defaultPublishConfigStore: PublishConfigStore = {
  configuration: "Release",
  runtime: "",
  framework: "",
  selfContained: false,
  outputDir: "",
  noBuild: false,
  noRestore: false,
  verbosity: "",
  noLogo: false,
  deleteExistingFiles: false,
  properties: {},
  define: [],
  useProfile: false,
  profileName: "",
};

export const defaultAppState: AppState = {
  ...defaultBootstrapState,
  executionHistory: [],
};

export const defaultRepoPublishConfig: RepoPublishConfig = {
  selectedPreset: "release-fd",
  isCustomMode: false,
  customConfig: { ...defaultPublishConfigStore },
  profiles: [],
};

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

export type {
  EnvironmentCheckResult,
};
