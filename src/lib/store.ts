// Store API - 与 Rust 后端持久化模块交互

import { invoke } from "@tauri-apps/api/core";
import type { Branch, Repository } from "@/types/repository";
import type { ParameterSchema } from "@/types/parameters";

// 发布配置存储类型
export interface PublishConfigStore {
  configuration: string;
  runtime: string;
  selfContained: boolean;
  outputDir: string;
  useProfile: boolean;
  profileName: string;
}

// 配置文件类型（用于配置导入导出）
export interface ConfigProfile {
  name: string;
  providerId: string;
  parameters: Record<string, any>;
  createdAt: string;
  isSystemDefault: boolean;
}

export interface ExecutionRecord {
  id: string;
  providerId: string;
  projectPath: string;
  startedAt: string;
  finishedAt: string;
  success: boolean;
  cancelled: boolean;
  outputDir?: string | null;
  error?: string | null;
  commandLine?: string | null;
  snapshotPath?: string | null;
  failureSignature?: string | null;
  spec?: unknown;
  fileCount: number;
}

// 应用状态类型
export interface AppState {
  repositories: Repository[];
  selectedRepoId: string | null;
  leftPanelWidth: number;
  middlePanelWidth: number;
  selectedPreset: string;
  isCustomMode: boolean;
  customConfig: PublishConfigStore;
  minimizeToTrayOnClose: boolean;
  language: string;
  defaultOutputDir: string;
  theme: "light" | "dark" | "auto";
  profiles: ConfigProfile[];
  executionHistory: ExecutionRecord[];
  executionHistoryLimit: number;
}

// 默认状态
export const defaultAppState: AppState = {
  repositories: [],
  selectedRepoId: null,
  leftPanelWidth: 220,
  middlePanelWidth: 280,
  selectedPreset: "release-fd",
  isCustomMode: false,
  customConfig: {
    configuration: "Release",
    runtime: "",
    selfContained: false,
    outputDir: "",
    useProfile: false,
    profileName: "",
  },
  minimizeToTrayOnClose: true,
  language: "zh",
  defaultOutputDir: "",
  theme: "auto",
  profiles: [],
  executionHistory: [],
  executionHistoryLimit: 20,
};

/**
 * 获取应用状态
 */
export async function getAppState(): Promise<AppState> {
  try {
    return await invoke<AppState>("get_app_state");
  } catch (error) {
    console.error("获取应用状态失败:", error);
    return defaultAppState;
  }
}

/**
 * 保存完整应用状态
 */
export async function saveAppState(state: AppState): Promise<void> {
  await invoke("save_app_state", { state });
}

/**
 * 添加仓库
 */
export async function addRepository(repo: Repository): Promise<AppState> {
  return await invoke<AppState>("add_repository", { repo });
}

/**
 * 删除仓库
 */
export async function removeRepository(repoId: string): Promise<AppState> {
  return await invoke<AppState>("remove_repository", { repoId });
}

/**
 * 更新仓库
 */
export async function updateRepository(repo: Repository): Promise<AppState> {
  return await invoke<AppState>("update_repository", { repo });
}

/**
 * 更新 UI 状态
 */
export async function updateUIState(params: {
  leftPanelWidth?: number;
  middlePanelWidth?: number;
  selectedRepoId?: string | null;
}): Promise<void> {
  await invoke("update_ui_state", params);
}

/**
 * 更新发布配置状态
 */
export async function updatePublishState(params: {
  selectedPreset?: string;
  isCustomMode?: boolean;
  customConfig?: PublishConfigStore;
}): Promise<void> {
  await invoke("update_publish_state", params);
}

/**
 * 更新通用偏好（语言、托盘行为、主题等）
 */
export async function updatePreferences(params: {
  language?: string;
  minimizeToTrayOnClose?: boolean;
  defaultOutputDir?: string;
  theme?: "light" | "dark" | "auto";
  executionHistoryLimit?: number;
}): Promise<AppState> {
  return await invoke<AppState>("update_preferences", {
    ...params,
    default_output_dir: params.defaultOutputDir,
    execution_history_limit: params.executionHistoryLimit,
  });
}

// ==================== Provider 相关 ====================

export interface ProviderManifest {
  id: string;
  displayName: string;
  version: string;
}

/**
 * 获取 Provider 列表
 */
export async function listProviders(): Promise<ProviderManifest[]> {
  const manifests = await invoke<
    Array<{ id: string; display_name: string; version: string }>
  >("list_providers");

  return manifests.map((item) => ({
    id: item.id,
    displayName: item.display_name,
    version: item.version,
  }));
}

/**
 * 获取指定 Provider 的参数 Schema
 */
export async function getProviderSchema(
  providerId: string
): Promise<ParameterSchema> {
  return await invoke<ParameterSchema>("get_provider_schema", { providerId });
}

/**
 * 自动检测仓库 Provider
 */
export async function detectRepositoryProvider(path: string): Promise<string> {
  return await invoke<string>("detect_repository_provider", { path });
}

export interface RepositoryBranchScanResult {
  branches: Branch[];
  currentBranch: string;
}

export interface RepositoryBranchConnectivityResult {
  canConnect: boolean;
}

/**
 * 刷新仓库分支列表
 */
export async function scanRepositoryBranches(
  path: string
): Promise<RepositoryBranchScanResult> {
  return await invoke<RepositoryBranchScanResult>("scan_repository_branches", {
    path,
  });
}

/**
 * 检查当前分支与远端连接状态
 */
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

// ==================== 版本更新相关 ====================

export interface UpdateInfo {
  currentVersion: string;
  availableVersion: string | null;
  hasUpdate: boolean;
  releaseNotes: string | null;
  message: string | null;
}

export interface UpdaterHelpPaths {
  docsPath: string;
  templatePath: string;
}

export interface UpdaterConfigHealth {
  configured: boolean;
  message: string;
}

/**
 * 检查更新
 */
export async function checkUpdate(): Promise<UpdateInfo> {
  const result = await invoke<{
    current_version: string;
    available_version: string | null;
    has_update: boolean;
    release_notes: string | null;
    message: string | null;
  }>("check_update");

  return {
    currentVersion: result.current_version,
    availableVersion: result.available_version,
    hasUpdate: result.has_update,
    releaseNotes: result.release_notes,
    message: result.message,
  };
}

/**
 * 安装更新
 */
export async function installUpdate(): Promise<string> {
  return await invoke<string>("install_update");
}

/**
 * 获取 updater 指南与模板路径
 */
export async function getUpdaterHelpPaths(): Promise<UpdaterHelpPaths> {
  return await invoke<UpdaterHelpPaths>("get_updater_help_paths");
}

/**
 * 获取 updater 配置健康状态
 */
export async function getUpdaterConfigHealth(): Promise<UpdaterConfigHealth> {
  return await invoke<UpdaterConfigHealth>("get_updater_config_health");
}

/**
 * 打开 updater 指南或模板
 */
export async function openUpdaterHelp(target: "docs" | "template"): Promise<string> {
  return await invoke<string>("open_updater_help", { target });
}

/**
 * 获取当前版本
 */
export async function getCurrentVersion(): Promise<string> {
  return await invoke<string>("get_current_version");
}

// ==================== 快捷键相关 ====================

export interface ShortcutHelp {
  key: string;
  description: string;
}

/**
 * 获取快捷键帮助
 */
export async function getShortcutsHelp(): Promise<ShortcutHelp[]> {
  return await invoke<ShortcutHelp[]>("get_shortcuts_help");
}

// ==================== 配置导入导出相关 ====================

export interface ConfigExport {
  version: number;
  exportedAt: string;
  profiles: ConfigProfile[];
}

/**
 * 获取所有配置文件
 */
export async function getProfiles(): Promise<ConfigProfile[]> {
  return await invoke<ConfigProfile[]>("get_profiles");
}

/**
 * 保存配置文件
 */
export async function saveProfile(params: {
  name: string;
  providerId: string;
  parameters: Record<string, any>;
}): Promise<AppState> {
  return await invoke<AppState>("save_profile", params);
}

/**
 * 删除配置文件
 */
export async function deleteProfile(name: string): Promise<AppState> {
  return await invoke<AppState>("delete_profile", { name });
}

/**
 * 导出配置到文件
 */
export async function exportConfig(params: {
  profiles: ConfigProfile[];
  filePath: string;
}): Promise<string> {
  return await invoke<string>("export_config", {
    profiles: params.profiles,
    file_path: params.filePath,
  });
}

/**
 * 从文件导入配置
 */
export async function importConfig(filePath: string): Promise<ConfigExport> {
  return await invoke<ConfigExport>("import_config", { file_path: filePath });
}

/**
 * 应用导入的配置
 */
export async function applyImportedConfig(profiles: ConfigProfile[]): Promise<void> {
  await invoke("apply_imported_config", { profiles });
}

// ==================== 执行历史相关 ====================

/**
 * 获取执行历史记录（最近 20 条）
 */
export async function getExecutionHistory(): Promise<ExecutionRecord[]> {
  return await invoke<ExecutionRecord[]>("get_execution_history");
}

/**
 * 追加执行历史记录
 */
export async function addExecutionRecord(
  record: ExecutionRecord
): Promise<ExecutionRecord[]> {
  return await invoke<ExecutionRecord[]>("add_execution_record", { record });
}

/**
 * 更新执行记录对应的快照路径
 */
export async function setExecutionRecordSnapshot(
  recordId: string,
  snapshotPath: string
): Promise<ExecutionRecord[]> {
  return await invoke<ExecutionRecord[]>("set_execution_record_snapshot", {
    record_id: recordId,
    snapshot_path: snapshotPath,
  });
}

/**
 * 打开执行快照文件（优先记录路径，回退到输出目录自动解析）
 */
export async function openExecutionSnapshot(params: {
  snapshotPath?: string | null;
  outputDir?: string | null;
}): Promise<string> {
  return await invoke<string>("open_execution_snapshot", {
    snapshot_path: params.snapshotPath ?? null,
    output_dir: params.outputDir ?? null,
  });
}
