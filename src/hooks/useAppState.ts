// useAppState - 应用状态管理 Hook
// 提供持久化的应用状态，包括仓库列表、UI 状态和发布配置

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { toast } from "sonner";
import { normalizeEnvironmentProviderIds } from "@/lib/environment";
import { extractInvokeErrorMessage } from "@/lib/tauri/invokeErrors";
import {
  getAppState,
  updateUIState,
  updatePublishState,
  addRepository as apiAddRepository,
  removeRepository as apiRemoveRepository,
  reorderRepositories as apiReorderRepositories,
  reorderRecentPublishConfigs as apiReorderRecentPublishConfigs,
  updateRepository as apiUpdateRepository,
  pushRecentPublishConfig as apiPushRecentPublishConfig,
  removeRecentPublishConfig as apiRemoveRecentPublishConfig,
  replaceRecentPublishConfigKey as apiReplaceRecentPublishConfigKey,
  updatePreferences,
  type AppState,
  type PublishConfigStore,
  defaultAppState,
  defaultPublishConfigStore,
  defaultRepoPublishConfig,
} from "@/lib/store";
import type { Repository, RepoPublishConfig } from "@/types/repository";

// 防抖延迟时间（毫秒）
const DEBOUNCE_DELAY = 500;

type PublishStatePatch = {
  selectedPreset?: string;
  isCustomMode?: boolean;
  customConfig?: PublishConfigStore;
};

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
  const pendingPublishStateRef = useRef<Map<string, PublishStatePatch>>(new Map());
  const recentMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const repositoryMutationQueueRef = useRef<Promise<void>>(Promise.resolve());

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
      pendingPublishStateRef.current.clear();
    };
  }, []);

  // 从当前选中仓库派生发布配置
  const currentRepo = useMemo(
    () =>
      state.repositories.find((r) => r.id === state.selectedRepoId) ?? null,
    [state.repositories, state.selectedRepoId]
  );

  const currentPublishConfig: RepoPublishConfig = useMemo(
    () =>
      currentRepo?.publishConfig ?? {
        ...defaultRepoPublishConfig,
        customConfig: { ...defaultPublishConfigStore },
      },
    [currentRepo]
  );

  const restoreAuthoritativeState = useCallback(async () => {
    const authoritativeState = await getAppState();
    setState(authoritativeState);
    setError(null);
    return authoritativeState;
  }, []);

  const handlePersistenceFailure = useCallback(
    async (title: string, err: unknown) => {
      console.error(title, err);
      let description = extractInvokeErrorMessage(err);

      try {
        await restoreAuthoritativeState();
      } catch (reloadError) {
        console.error("重新加载应用状态失败:", reloadError);
        description = `${description}；${extractInvokeErrorMessage(reloadError)}`;
      }

      toast.error(title, {
        description,
      });
    },
    [restoreAuthoritativeState]
  );

  // 更新 UI 状态（带防抖）
  const setUIState = useCallback(
    (params: {
      leftPanelWidth?: number;
      middlePanelWidth?: number;
      selectedRepoId?: string | null;
      clearSelectedRepoId?: boolean;
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
        ...(params.clearSelectedRepoId
          ? { selectedRepoId: null }
          : params.selectedRepoId !== undefined
            ? { selectedRepoId: params.selectedRepoId }
            : {}),
      }));

      // 防抖保存到后端
      if (uiDebounceRef.current) {
        clearTimeout(uiDebounceRef.current);
      }
      uiDebounceRef.current = setTimeout(() => {
        void updateUIState(params).catch((err) => {
          void handlePersistenceFailure("保存界面状态失败", err);
        });
      }, DEBOUNCE_DELAY);
    },
    [handlePersistenceFailure]
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
        void updatePreferences(params).catch((err) => {
          void handlePersistenceFailure("保存偏好设置失败", err);
        });
      }, DEBOUNCE_DELAY);
    },
    [handlePersistenceFailure]
  );

  // 更新发布配置状态（按仓库隔离，带防抖）
  const setPublishState = useCallback(
    (params: PublishStatePatch) => {
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
      const repoId = state.selectedRepoId;
      if (!repoId) {
        return;
      }

      const previousPendingParams =
        pendingPublishStateRef.current.get(repoId) ?? {};
      pendingPublishStateRef.current.set(repoId, {
        ...previousPendingParams,
        ...params,
      });

      publishDebounceRef.current = setTimeout(() => {
        const pendingEntries = Array.from(pendingPublishStateRef.current.entries());
        pendingPublishStateRef.current.clear();

        void Promise.all(
          pendingEntries.map(([pendingRepoId, pendingParams]) =>
            updatePublishState({ repoId: pendingRepoId, ...pendingParams }).catch((err) => {
              void handlePersistenceFailure("保存发布配置失败", err);
            })
          )
        );
      }, DEBOUNCE_DELAY);
    },
    [handlePersistenceFailure, state.selectedRepoId]
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

  const enqueueRepositoryMutation = useCallback(
    (mutation: () => Promise<unknown>, errorMessage: string) => {
      repositoryMutationQueueRef.current = repositoryMutationQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          try {
            await mutation();
          } catch (err) {
            await handlePersistenceFailure(errorMessage, err);
          }
        });
    },
    [handlePersistenceFailure]
  );

  const reorderRepositories = useCallback(
    (repoIds: string[]) => {
      setState((prev) => {
        if (prev.repositories.length === 0) {
          return prev;
        }

        const repositoryMap = new Map(
          prev.repositories.map((repository) => [repository.id, repository])
        );
        const nextRepositories = repoIds
          .map((repoId) => repositoryMap.get(repoId))
          .filter((repository): repository is Repository => Boolean(repository));

        if (nextRepositories.length !== prev.repositories.length) {
          return prev;
        }

        return {
          ...prev,
          repositories: nextRepositories,
        };
      });

      enqueueRepositoryMutation(
        () => apiReorderRepositories(repoIds),
        "保存仓库排序失败"
      );
    },
    [enqueueRepositoryMutation]
  );

  // 选中仓库的便捷方法
  const selectRepository = useCallback(
    (repoId: string | null) => {
      setUIState(
        repoId === null
          ? { selectedRepoId: null, clearSelectedRepoId: true }
          : { selectedRepoId: repoId }
      );
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
      errorMessage: string,
      options?: { applyState?: boolean }
    ) => {
      // recent 由后端持久化状态做真相源；前端串行消费返回值，避免本地镜像规则再漂移。
      recentMutationQueueRef.current = recentMutationQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          try {
            const nextState = await mutation();
            if (options?.applyState === false) {
              return;
            }
            setState((prev) => mergeRecentPublishState(prev, nextState));
          } catch (err) {
            await handlePersistenceFailure(errorMessage, err);
          }
        });
    },
    [handlePersistenceFailure]
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

  const reorderRecentPublishConfigs = useCallback(
    (
      configKeys: string[],
      repoId: string | null = state.selectedRepoId
    ) => {
      if (!repoId) {
        return;
      }

      setState((prev) =>
        mergeRecentPublishState(prev, {
          recentRepoIds: prev.recentRepoIds,
          recentConfigKeysByRepo: {
            ...prev.recentConfigKeysByRepo,
            [repoId]: configKeys,
          },
        })
      );

      enqueueRecentMutation(
        () => apiReorderRecentPublishConfigs({ repoId, configKeys }),
        "保存最近使用排序失败",
        { applyState: false }
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
    reorderRepositories,
    selectRepository,
    pushRecentPublishConfig,
    removeRecentPublishConfig,
    reorderRecentPublishConfigs,
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
    startupNotice: state.startupNotice,
    setLanguage,
    setMinimizeToTrayOnClose,
    setDefaultOutputDir,
    setTheme,
    setExecutionHistoryLimit,
    setEnvironmentProviderIds,
  };
}
