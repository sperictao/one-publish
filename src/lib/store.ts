// Store API - 与 Rust 后端持久化模块交互

import { invoke } from "@tauri-apps/api/core";
import type { Repository } from "@/types/repository";

// 发布配置存储类型
export interface PublishConfigStore {
  configuration: string;
  runtime: string;
  selfContained: boolean;
  outputDir: string;
  useProfile: boolean;
  profileName: string;
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
}): Promise<AppState> {
  return await invoke<AppState>("update_preferences", {
    ...params,
    default_output_dir: params.defaultOutputDir,
  });
}

// ==================== 版本更新相关 ====================

export interface UpdateInfo {
  currentVersion: string;
  availableVersion: string | null;
  hasUpdate: boolean;
  releaseNotes: string | null;
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
  }>("check_update");

  return {
    currentVersion: result.current_version,
    availableVersion: result.available_version,
    hasUpdate: result.has_update,
    releaseNotes: result.release_notes,
  };
}

/**
 * 安装更新
 */
export async function installUpdate(): Promise<string> {
  return await invoke<string>("install_update");
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
