import {
  type EnvironmentCheckResult,
} from "@/features/environment/environment";
import type {
  AppState as TauriAppState,
  Branch as TauriBranch,
  ConfigExportProfile,
  ConfigProfile as TauriConfigProfile,
  ExecutionRecord as TauriExecutionRecord,
  JsonValue,
  ProjectInfo,
  ProjectPublishProfileFile,
  ProjectScanCandidates as TauriProjectScanCandidates,
  ProviderProjectPathKind,
  PublishConfigStore,
  Repository as TauriRepository,
  RepositoryBranchConnectivityResult,
  RepositoryBranchScanResult,
  RepoPublishConfig as TauriRepoPublishConfig,
  ShortcutHelp,
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

export function normalizeConfigProfile(profile: TauriConfigProfile): ConfigProfile {
  return {
    ...profile,
    parameters: normalizeConfigParameters(profile.parameters),
  };
}

export function normalizeImportedConfigProfile(profile: ConfigExportProfile): ConfigProfile {
  return {
    name: profile.name,
    providerId: profile.provider_id,
    parameters: normalizeConfigParameters(profile.parameters),
    profileGroup: profile.profile_group,
    createdAt: profile.created_at,
    isSystemDefault: profile.is_system_default,
  };
}

export function toExportConfigProfile(profile: ConfigProfile): ConfigExportProfile {
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

export function normalizeRepository(repository: TauriRepository): Repository {
  return {
    ...repository,
    branches: repository.branches.map((branch) => ({
      ...branch,
      commitCount: branch.commitCount ?? undefined,
    })),
    publishConfig: normalizeRepoPublishConfig(repository.publishConfig),
  };
}

export function normalizeAppState(state: TauriAppState): AppState {
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

export type {
  EnvironmentCheckResult,
};
