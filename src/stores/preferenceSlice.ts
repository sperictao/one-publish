import type { StateCreator } from "zustand";
import { updatePreferences as apiUpdatePreferences } from "@/lib/store/api";
import {
  applyPreferenceStateMutation,
  type PreferenceStateMutation,
} from "./appStoreMutations";
import { makeHandlePersistenceFailure } from "./appStoreHelpers";
import type { AppStore } from "./appStore";

export interface PreferenceSlice {
  /** 界面语言 */
  language: string;
  /** 主题 */
  theme: "light" | "dark" | "auto";
  /** 关闭时最小化到托盘 */
  minimizeToTrayOnClose: boolean;
  /** 默认输出目录 */
  defaultOutputDir: string;
  /** 执行历史记录条数上限 */
  executionHistoryLimit: number;
  /** 环境提供者 ID 列表 */
  environmentProviderIds: string[];
  /** 启动通知 */
  startupNotice: string | null;

  /** 设置偏好（带防抖持久化） */
  setPreferences: (params: PreferenceStateMutation) => void;
  /** 设置语言 */
  setLanguage: (language: string) => void;
  /** 设置关闭时最小化到托盘 */
  setMinimizeToTrayOnClose: (value: boolean) => void;
  /** 设置默认输出目录 */
  setDefaultOutputDir: (dir: string) => void;
  /** 设置主题 */
  setTheme: (theme: "light" | "dark" | "auto") => void;
  /** 设置执行历史记录条数上限 */
  setExecutionHistoryLimit: (limit: number) => void;
  /** 设置环境提供者 ID 列表 */
  setEnvironmentProviderIds: (providerIds: string[]) => void;
}

// ── Module-level debounce timer ──
const DEBOUNCE_DELAY = 500;
let preferenceDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export const createPreferenceSlice: StateCreator<
  AppStore,
  [],
  [],
  PreferenceSlice
> = (set, get) => {
  const handlePersistenceFailure = makeHandlePersistenceFailure(
    set as (partial: Record<string, unknown>) => void,
    get
  );

  return {
    // ── State defaults ──
    language: "zh",
    theme: "auto",
    minimizeToTrayOnClose: true,
    defaultOutputDir: "",
    executionHistoryLimit: 20,
    environmentProviderIds: ["dotnet"],
    startupNotice: null,

    // ── Preferences ──
    setPreferences: (params) => {
      set((prev) => applyPreferenceStateMutation(prev, params));

      if (preferenceDebounceTimer) clearTimeout(preferenceDebounceTimer);
      preferenceDebounceTimer = setTimeout(() => {
        void apiUpdatePreferences(params).catch((err) => {
          void handlePersistenceFailure("保存偏好设置失败", err);
        });
      }, DEBOUNCE_DELAY);
    },

    setLanguage: (language) => {
      get().setPreferences({ language });
    },

    setMinimizeToTrayOnClose: (value) => {
      get().setPreferences({ minimizeToTrayOnClose: value });
    },

    setDefaultOutputDir: (dir) => {
      get().setPreferences({ defaultOutputDir: dir });
    },

    setTheme: (theme) => {
      get().setPreferences({ theme });
    },

    setExecutionHistoryLimit: (limit) => {
      get().setPreferences({ executionHistoryLimit: limit });
    },

    setEnvironmentProviderIds: (providerIds) => {
      get().setPreferences({ environmentProviderIds: providerIds });
    },
  };
};
