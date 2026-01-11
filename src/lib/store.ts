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
