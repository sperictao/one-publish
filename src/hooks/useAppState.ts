// useAppState - 应用状态管理 Hook
// 提供持久化的应用状态，包括仓库列表、UI 状态和发布配置

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { normalizeEnvironmentProviderIds } from "@/lib/environment";
import {
  getAppState,
  updateUIState,
  updatePublishState,
  addRepository as apiAddRepository,
  removeRepository as apiRemoveRepository,
  updateRepository as apiUpdateRepository,
  pushRecentPublishConfig as apiPushRecentPublishConfig,
  removeRecentPublishConfig as apiRemoveRecentPublishConfig,
  replaceRecentPublishConfigKey as apiReplaceRecentPublishConfigKey,
  updatePreferences,
  type AppState,
  type PublishConfigStore,
  defaultAppState,
  defaultRepoPublishConfig,
} from "@/lib/store";
import type { Repository, RepoPublishConfig } from "@/types/repository";

// 防抖延迟时间（毫秒）
const DEBOUNCE_DELAY = 500;

function mergeRecentPublishState(
  state: AppState,
  nextState: Pick<AppState, "recentRepoIds" | "recentConfigKeysByRepo">
): AppState {
  return {
    ...state,
    recentRepoIds: nextState.recentRepoIds,
    recentConfigKeysByRepo: nextState.recentConfigKeysByRepo,
  };
}

export function useAppState() {
  const [state, setState] = useState<AppState>(defaultAppState);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 用于防抖的 timer refs
  const uiDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const publishDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preferenceDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const recentMutationQueueRef = useRef<Promise<void>>(Promise.resolve());

  // 初始化加载状态
  useEffect(() => {
    async function loadState() {
      try {
        const appState = await getAppState();
        setState(appState);
        setError(null);
      } catch (err) {
        console.error("加载应用状态失败:", err);
        setError(String(err));
      } finally {
        setIsLoading(false);
      }
    }

    loadState();

    // 清理防抖 timers
    return () => {
      if (uiDebounceRef.current) clearTimeout(uiDebounceRef.current);
      if (publishDebounceRef.current) clearTimeout(publishDebounceRef.current);
      if (preferenceDebounceRef.current)
        clearTimeout(preferenceDebounceRef.current);
    };
  }, []);

  // 从当前选中仓库派生发布配置
  const currentRepo = useMemo(
    () =>
      state.repositories.find((r) => r.id === state.selectedRepoId) ?? null,
    [state.repositories, state.selectedRepoId]
  );

  const currentPublishConfig: RepoPublishConfig = useMemo(
    () => currentRepo?.publishConfig ?? defaultRepoPublishConfig,
    [currentRepo]
  );

  // 更新 UI 状态（带防抖）
  const setUIState = useCallback(
    (params: {
      leftPanelWidth?: number;
      middlePanelWidth?: number;
      selectedRepoId?: string | null;
    }) => {
      // 立即更新本地状态
      setState((prev) => ({
        ...prev,
        ...(params.leftPanelWidth !== undefined && {
          leftPanelWidth: params.leftPanelWidth,
        }),
        ...(params.middlePanelWidth !== undefined && {
          middlePanelWidth: params.middlePanelWidth,
        }),
        ...(params.selectedRepoId !== undefined && {
          selectedRepoId: params.selectedRepoId,
        }),
      }));

      // 防抖保存到后端
      if (uiDebounceRef.current) {
        clearTimeout(uiDebounceRef.current);
      }
      uiDebounceRef.current = setTimeout(() => {
        updateUIState(params).catch(console.error);
      }, DEBOUNCE_DELAY);
    },
    []
  );

  // 更新通用偏好（语言、托盘行为、主题等）
  const setPreferences = useCallback(
    (params: {
      language?: string;
      minimizeToTrayOnClose?: boolean;
      defaultOutputDir?: string;
      theme?: "light" | "dark" | "auto";
      executionHistoryLimit?: number;
      environmentProviderIds?: string[];
    }) => {
      setState((prev) => ({
        ...prev,
        ...(params.language !== undefined && { language: params.language }),
        ...(params.minimizeToTrayOnClose !== undefined && {
          minimizeToTrayOnClose: params.minimizeToTrayOnClose,
        }),
        ...(params.defaultOutputDir !== undefined && {
          defaultOutputDir: params.defaultOutputDir,
        }),
        ...(params.theme !== undefined && { theme: params.theme }),
        ...(params.executionHistoryLimit !== undefined && {
          executionHistoryLimit: params.executionHistoryLimit,
        }),
        ...(params.environmentProviderIds !== undefined && {
          environmentProviderIds: normalizeEnvironmentProviderIds(
            params.environmentProviderIds
          ),
        }),
      }));

      if (preferenceDebounceRef.current) {
        clearTimeout(preferenceDebounceRef.current);
      }
      preferenceDebounceRef.current = setTimeout(() => {
        updatePreferences(params).catch(console.error);
      }, DEBOUNCE_DELAY);
    },
    []
  );

  // 更新发布配置状态（按仓库隔离，带防抖）
  const setPublishState = useCallback(
    (params: {
      selectedPreset?: string;
      isCustomMode?: boolean;
      customConfig?: PublishConfigStore;
    }) => {
      // 乐观更新本地状态：更新 repositories 数组中对应仓库的 publishConfig
      setState((prev) => {
        const repoId = prev.selectedRepoId;
        if (!repoId) return prev;

        return {
          ...prev,
          repositories: prev.repositories.map((repo) => {
            if (repo.id !== repoId) return repo;
            return {
              ...repo,
              publishConfig: {
                ...repo.publishConfig,
                ...(params.selectedPreset !== undefined && {
                  selectedPreset: params.selectedPreset,
                }),
                ...(params.isCustomMode !== undefined && {
                  isCustomMode: params.isCustomMode,
                }),
                ...(params.customConfig !== undefined && {
                  customConfig: params.customConfig,
                }),
              },
            };
          }),
        };
      });

      // 防抖保存到后端
      if (publishDebounceRef.current) {
        clearTimeout(publishDebounceRef.current);
      }
      publishDebounceRef.current = setTimeout(() => {
        const currentState = state;
        const repoId = currentState.selectedRepoId;
        if (!repoId) return;
        updatePublishState({ repoId, ...params }).catch(console.error);
      }, DEBOUNCE_DELAY);
    },
    [state.selectedRepoId]
  );

  // 添加仓库
  const addRepository = useCallback(async (repo: Repository) => {
    try {
      const newState = await apiAddRepository(repo);
      setState(newState);
      return newState;
    } catch (err) {
      console.error("添加仓库失败:", err);
      throw err;
    }
  }, []);

  // 删除仓库
  const removeRepository = useCallback(async (repoId: string) => {
    try {
      const newState = await apiRemoveRepository(repoId);
      setState(newState);
      return newState;
    } catch (err) {
      console.error("删除仓库失败:", err);
      throw err;
    }
  }, []);

  // 更新仓库
  const updateRepository = useCallback(async (repo: Repository) => {
    try {
      const newState = await apiUpdateRepository(repo);
      setState(newState);
      return newState;
    } catch (err) {
      console.error("更新仓库失败:", err);
      throw err;
    }
  }, []);

  // 选中仓库的便捷方法
  const selectRepository = useCallback(
    (repoId: string | null) => {
      setUIState({ selectedRepoId: repoId });
    },
    [setUIState]
  );

  // 更新面板宽度的便捷方法（同时标记为已自定义）
  const setLeftPanelWidth = useCallback(
    (width: number) => {
      setState((prev) => ({ ...prev, panelWidthsCustomized: true }));
      setUIState({ leftPanelWidth: width });
    },
    [setUIState]
  );

  const setMiddlePanelWidth = useCallback(
    (width: number) => {
      setState((prev) => ({ ...prev, panelWidthsCustomized: true }));
      setUIState({ middlePanelWidth: width });
    },
    [setUIState]
  );

  // 更新预设的便捷方法
  const setSelectedPreset = useCallback(
    (preset: string) => {
      setPublishState({ selectedPreset: preset });
    },
    [setPublishState]
  );

  // 更新自定义模式的便捷方法
  const setIsCustomMode = useCallback(
    (mode: boolean) => {
      setPublishState({ isCustomMode: mode });
    },
    [setPublishState]
  );

  // 更新自定义配置的便捷方法
  const setCustomConfig = useCallback(
    (config: PublishConfigStore) => {
      setPublishState({ customConfig: config });
    },
    [setPublishState]
  );

  // 更新语言
  const setLanguage = useCallback(
    (language: string) => {
      setPreferences({ language });
    },
    [setPreferences]
  );

  // 更新最小化到托盘
  const setMinimizeToTrayOnClose = useCallback(
    (value: boolean) => {
      setPreferences({ minimizeToTrayOnClose: value });
    },
    [setPreferences]
  );

  // 更新默认发布目录
  const setDefaultOutputDir = useCallback(
    (dir: string) => {
      setPreferences({ defaultOutputDir: dir });
    },
    [setPreferences]
  );

  // 更新主题
  const setTheme = useCallback(
    (theme: "light" | "dark" | "auto") => {
      setPreferences({ theme });
    },
    [setPreferences]
  );

  // 更新历史保留数量
  const setExecutionHistoryLimit = useCallback(
    (limit: number) => {
      setPreferences({ executionHistoryLimit: limit });
    },
    [setPreferences]
  );

  const setEnvironmentProviderIds = useCallback(
    (providerIds: string[]) => {
      setPreferences({
        environmentProviderIds: normalizeEnvironmentProviderIds(providerIds),
      });
    },
    [setPreferences]
  );

  const enqueueRecentMutation = useCallback(
    (
      mutation: () => Promise<AppState>,
      errorMessage: string
    ) => {
      // recent 由后端持久化状态做真相源；前端串行消费返回值，避免本地镜像规则再漂移。
      recentMutationQueueRef.current = recentMutationQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          try {
            const nextState = await mutation();
            setState((prev) => mergeRecentPublishState(prev, nextState));
          } catch (err) {
            console.error(errorMessage, err);
          }
        });
    },
    []
  );

  const pushRecentPublishConfig = useCallback(
    (configKey: string, repoId: string | null = state.selectedRepoId) => {
      if (!repoId || !configKey.trim()) {
        return;
      }

      enqueueRecentMutation(
        () => apiPushRecentPublishConfig({ repoId, configKey }),
        "记录最近使用发布配置失败:"
      );
    },
    [enqueueRecentMutation, state.selectedRepoId]
  );

  const removeRecentPublishConfig = useCallback(
    (configKey: string, repoId: string | null = state.selectedRepoId) => {
      if (!repoId || !configKey.trim()) {
        return;
      }

      enqueueRecentMutation(
        () => apiRemoveRecentPublishConfig({ repoId, configKey }),
        "移除最近使用发布配置失败:"
      );
    },
    [enqueueRecentMutation, state.selectedRepoId]
  );

  const replaceRecentPublishConfigKey = useCallback(
    (
      previousKey: string,
      nextKey: string,
      repoId: string | null = state.selectedRepoId
    ) => {
      if (!repoId || !previousKey.trim() || !nextKey.trim()) {
        return;
      }

      enqueueRecentMutation(
        () =>
          apiReplaceRecentPublishConfigKey({
            repoId,
            previousKey,
            nextKey,
          }),
        "替换最近使用发布配置 key 失败:"
      );
    },
    [enqueueRecentMutation, state.selectedRepoId]
  );

  return {
    // 状态
    state,
    isLoading,
    error,

    // 仓库操作
    repositories: state.repositories,
    selectedRepoId: state.selectedRepoId,
    recentRepoIds: state.recentRepoIds,
    recentConfigKeysByRepo: state.recentConfigKeysByRepo,
    addRepository,
    removeRepository,
    updateRepository,
    selectRepository,
    pushRecentPublishConfig,
    removeRecentPublishConfig,
    replaceRecentPublishConfigKey,

    // UI 状态
    leftPanelWidth: state.leftPanelWidth,
    middlePanelWidth: state.middlePanelWidth,
    panelWidthsCustomized: state.panelWidthsCustomized,
    setLeftPanelWidth,
    setMiddlePanelWidth,

    // 发布配置（从当前仓库的 publishConfig 派生）
    selectedPreset: currentPublishConfig.selectedPreset,
    isCustomMode: currentPublishConfig.isCustomMode,
    customConfig: currentPublishConfig.customConfig,
    setSelectedPreset,
    setIsCustomMode,
    setCustomConfig,

    // 偏好设置
    language: state.language,
    minimizeToTrayOnClose: state.minimizeToTrayOnClose,
    defaultOutputDir: state.defaultOutputDir,
    theme: state.theme,
    executionHistoryLimit: state.executionHistoryLimit,
    environmentProviderIds: state.environmentProviderIds,
    setLanguage,
    setMinimizeToTrayOnClose,
    setDefaultOutputDir,
    setTheme,
    setExecutionHistoryLimit,
    setEnvironmentProviderIds,
  };
}
