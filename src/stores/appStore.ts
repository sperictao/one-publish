import { create } from "zustand";
import { toast } from "sonner";

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
  getExecutionHistory,
  addExecutionRecord,
  setExecutionRecordSnapshot,
} from "@/lib/store/api";
import {
  type AppState,
  type ExecutionRecord,
  type PublishConfigStore,
  defaultAppState,
} from "@/lib/store/types";
import {
  applyPreferenceStateMutation,
  applyPublishStateMutation,
  applyUiStateMutation,
  mergeRecentPublishState,
  resolveScopedMutationRepoId,
  type PreferenceStateMutation,
  type PublishStatePatch,
  type UiStateMutation,
} from "@/stores/appStoreMutations";
import type { Repository } from "@/lib/store/types";
import {
  loadFavorites,
  migrateLegacyFavorites,
  persistFavorites,
} from "@/stores/favoriteConfigs";

// ── Store interface ──
interface AppStore extends AppState {
  // Lifecycle
  isLoading: boolean;
  error: string | null;
  loadState: () => Promise<void>;
  _restoreAuthoritativeState: () => Promise<AppState>;

  // Execution history
  executionHistory: ExecutionRecord[];
  loadExecutionHistory: () => Promise<void>;
  savePublishRecord: (record: ExecutionRecord) => Promise<void>;
  setExecutionSnapshotPath: (recordId: string, snapshotPath: string) => Promise<void>;

  // Favorites (localStorage-backed, managed through appStore)
  favoriteConfigKeysByRepo: Record<string, string[]>;
  toggleFavoriteConfig: (key: string, repoId?: string | null) => void;
  replaceScopedConfigKey: (previousKey: string, nextKey: string, repoId?: string | null) => void;

  // UI state
  setUIState: (params: UiStateMutation) => void;

  // Preferences
  setPreferences: (params: PreferenceStateMutation) => void;

  // Publish state
  setPublishState: (params: PublishStatePatch) => void;

  // Repository CRUD
  addRepository: (repo: Repository) => Promise<AppState>;
  removeRepository: (repoId: string) => Promise<AppState>;
  updateRepository: (repo: Repository) => Promise<AppState>;
  reorderRepositories: (repoIds: string[]) => void;

  // Convenience setters
  selectRepository: (repoId: string | null) => void;
  setLeftPanelWidth: (width: number) => void;
  setMiddlePanelWidth: (width: number) => void;
  setSelectedPreset: (preset: string) => void;
  setIsCustomMode: (mode: boolean) => void;
  setCustomConfig: (config: PublishConfigStore) => void;
  setLanguage: (language: string) => void;
  setMinimizeToTrayOnClose: (value: boolean) => void;
  setDefaultOutputDir: (dir: string) => void;
  setTheme: (theme: "light" | "dark" | "auto") => void;
  setExecutionHistoryLimit: (limit: number) => void;
  setEnvironmentProviderIds: (providerIds: string[]) => void;

  // Recent configs
  pushRecentPublishConfig: (configKey: string, repoId?: string | null) => void;
  removeRecentPublishConfig: (
    configKey: string,
    repoId?: string | null
  ) => void;
  replaceRecentPublishConfigKey: (
    previousKey: string,
    nextKey: string,
    repoId?: string | null
  ) => void;
  reorderRecentPublishConfigs: (
    configKeys: string[],
    repoId?: string | null
  ) => void;
}

export const useAppStore = create<AppStore>((set, get) => {
  // ── Debounce timers (closure-scoped, like useRef) ──
  const DEBOUNCE_DELAY = 500;

  let uiDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let publishDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let preferenceDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Mutation queues ──
  let recentMutationQueue: Promise<void> = Promise.resolve();
  let repositoryMutationQueue: Promise<void> = Promise.resolve();

  // ── Pending publish state (per repo, like useRef Map) ──
  const pendingPublishState = new Map<string, PublishStatePatch>();

  // ── Internal helpers ──

  const handlePersistenceFailure = async (title: string, err: unknown) => {
    console.error(title, err);
    let description = extractInvokeErrorMessage(err);

    try {
      const authoritativeState = await getAppState();
      set({ ...authoritativeState, error: null });
    } catch (reloadError) {
      console.error("重新加载应用状态失败:", reloadError);
      description = `${description}；${extractInvokeErrorMessage(reloadError)}`;
    }

    toast.error(title, { description });
  };

  const enqueueRecentMutation = (
    mutation: () => Promise<AppState>,
    errorMessage: string,
    options?: { applyState?: boolean }
  ) => {
    recentMutationQueue = recentMutationQueue
      .catch(() => undefined)
      .then(async () => {
        try {
          const nextState = await mutation();
          if (options?.applyState === false) {
            return;
          }
          set((prev) => mergeRecentPublishState(prev, nextState));
        } catch (err) {
          await handlePersistenceFailure(errorMessage, err);
        }
      });
  };

  const enqueueRepositoryMutation = (
    mutation: () => Promise<unknown>,
    errorMessage: string
  ) => {
    repositoryMutationQueue = repositoryMutationQueue
      .catch(() => undefined)
      .then(async () => {
        try {
          await mutation();
        } catch (err) {
          await handlePersistenceFailure(errorMessage, err);
        }
      });
  };

  // ── Store ──
  return {
    ...defaultAppState,
    isLoading: true,
    error: null,
    executionHistory: [],
    favoriteConfigKeysByRepo: loadFavorites(),

    // ── Lifecycle ──
    loadState: async () => {
      try {
        const appState = await getAppState();
        // Migrate legacy favorites into the current repo scope
        if (appState.selectedRepoId) {
          const migrated = migrateLegacyFavorites(
            get().favoriteConfigKeysByRepo,
            appState.selectedRepoId
          );
          if (migrated) {
            persistFavorites(migrated);
            set({ favoriteConfigKeysByRepo: migrated });
          }
        }
        set({ ...appState, isLoading: false, error: null });
      } catch (err) {
        console.error("加载应用状态失败:", err);
        set({ isLoading: false, error: String(err) });
      }
    },

    _restoreAuthoritativeState: async () => {
      const authoritativeState = await getAppState();
      set({ ...authoritativeState, error: null });
      return authoritativeState;
    },

    // ── Execution history ──
    loadExecutionHistory: async () => {
      try {
        const history = await getExecutionHistory();
        set({ executionHistory: history });
      } catch (err) {
        console.error("加载执行历史失败:", err);
      }
    },

    savePublishRecord: async (record) => {
      try {
        const history = await addExecutionRecord(record);
        set({ executionHistory: history });
      } catch (err) {
        console.error("保存执行历史失败:", err);
      }
    },

    setExecutionSnapshotPath: async (recordId, snapshotPath) => {
      try {
        const history = await setExecutionRecordSnapshot(
          recordId,
          snapshotPath
        );
        set({ executionHistory: history });
      } catch (err) {
        console.error("设置执行快照路径失败:", err);
      }
    },

    // ── Favorites (localStorage-backed) ──
    toggleFavoriteConfig: (key, repoId) => {
      const { selectedRepoId, favoriteConfigKeysByRepo } = get();
      const id = resolveScopedMutationRepoId(selectedRepoId, repoId);
      if (!id) return;

      const scoped = favoriteConfigKeysByRepo[id] ?? [];
      const isFavorite = scoped.includes(key);

      const nextScoped = isFavorite
        ? scoped.filter((item) => item !== key)
        : [key, ...scoped.filter((item) => item !== key)];

      const next = { ...favoriteConfigKeysByRepo, [id]: nextScoped };
      persistFavorites(next);
      set({ favoriteConfigKeysByRepo: next });

      if (!isFavorite) {
        get().pushRecentPublishConfig(key, id);
      }
    },

    replaceScopedConfigKey: (previousKey, nextKey, repoId) => {
      const { selectedRepoId, favoriteConfigKeysByRepo } = get();
      const id = resolveScopedMutationRepoId(selectedRepoId, repoId);
      if (!id || !previousKey || !nextKey) return;

      get().replaceRecentPublishConfigKey(previousKey, nextKey, id);

      const scoped = favoriteConfigKeysByRepo[id] ?? [];
      if (!scoped.includes(previousKey)) return;

      const nextScoped = Array.from(
        new Set(scoped.map((item) => (item === previousKey ? nextKey : item)))
      );
      const next = { ...favoriteConfigKeysByRepo, [id]: nextScoped };
      persistFavorites(next);
      set({ favoriteConfigKeysByRepo: next });
    },

    // ── UI State ──
    setUIState: (params) => {
      set((prev) => applyUiStateMutation(prev, params));

      if (uiDebounceTimer) clearTimeout(uiDebounceTimer);
      uiDebounceTimer = setTimeout(() => {
        void updateUIState(params).catch((err) => {
          void handlePersistenceFailure("保存界面状态失败", err);
        });
      }, DEBOUNCE_DELAY);
    },

    // ── Preferences ──
    setPreferences: (params) => {
      set((prev) => applyPreferenceStateMutation(prev, params));

      if (preferenceDebounceTimer) clearTimeout(preferenceDebounceTimer);
      preferenceDebounceTimer = setTimeout(() => {
        void updatePreferences(params).catch((err) => {
          void handlePersistenceFailure("保存偏好设置失败", err);
        });
      }, DEBOUNCE_DELAY);
    },

    // ── Publish State ──
    setPublishState: (params) => {
      const { selectedRepoId } = get();
      if (!selectedRepoId) return;

      set((prev) => applyPublishStateMutation(prev, selectedRepoId, params));

      if (publishDebounceTimer) clearTimeout(publishDebounceTimer);
      const previousPending = pendingPublishState.get(selectedRepoId) ?? {};
      pendingPublishState.set(selectedRepoId, {
        ...previousPending,
        ...params,
      });

      publishDebounceTimer = setTimeout(() => {
        const pendingEntries = Array.from(pendingPublishState.entries());
        pendingPublishState.clear();

        void Promise.all(
          pendingEntries.map(([repoId, pendingParams]) =>
            updatePublishState({ repoId, ...pendingParams }).catch((err) => {
              void handlePersistenceFailure("保存发布配置失败", err);
            })
          )
        );
      }, DEBOUNCE_DELAY);
    },

    // ── Repository CRUD ──
    addRepository: async (repo) => {
      const newState = await apiAddRepository(repo);
      set({ ...newState });
      return newState;
    },

    removeRepository: async (repoId) => {
      const newState = await apiRemoveRepository(repoId);
      set({ ...newState });
      return newState;
    },

    updateRepository: async (repo) => {
      const newState = await apiUpdateRepository(repo);
      set({ ...newState });
      return newState;
    },

    reorderRepositories: (repoIds) => {
      const { repositories } = get();
      if (repositories.length === 0) return;

      const repositoryMap = new Map(
        repositories.map((r) => [r.id, r])
      );
      const nextRepositories = repoIds
        .map((id) => repositoryMap.get(id))
        .filter((r): r is Repository => Boolean(r));

      if (nextRepositories.length !== repositories.length) return;

      set({ repositories: nextRepositories });

      enqueueRepositoryMutation(
        () => apiReorderRepositories(repoIds),
        "保存仓库排序失败"
      );
    },

    // ── Convenience setters ──
    selectRepository: (repoId) => {
      get().setUIState(
        repoId === null
          ? { selectedRepoId: null, clearSelectedRepoId: true }
          : { selectedRepoId: repoId }
      );
    },

    setLeftPanelWidth: (width) => {
      set({ panelWidthsCustomized: true });
      get().setUIState({ leftPanelWidth: width });
    },

    setMiddlePanelWidth: (width) => {
      set({ panelWidthsCustomized: true });
      get().setUIState({ middlePanelWidth: width });
    },

    setSelectedPreset: (preset) => {
      get().setPublishState({ selectedPreset: preset });
    },

    setIsCustomMode: (mode) => {
      get().setPublishState({ isCustomMode: mode });
    },

    setCustomConfig: (config) => {
      get().setPublishState({ customConfig: config });
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
      get().setPreferences({
        environmentProviderIds: providerIds,
      });
    },

    // ── Recent configs ──
    pushRecentPublishConfig: (configKey, repoId) => {
      const id = resolveScopedMutationRepoId(get().selectedRepoId, repoId);
      if (!id || !configKey.trim()) return;
      enqueueRecentMutation(
        () => apiPushRecentPublishConfig({ repoId: id, configKey }),
        "记录最近使用发布配置失败:"
      );
    },

    removeRecentPublishConfig: (configKey, repoId) => {
      const id = resolveScopedMutationRepoId(get().selectedRepoId, repoId);
      if (!id || !configKey.trim()) return;
      enqueueRecentMutation(
        () => apiRemoveRecentPublishConfig({ repoId: id, configKey }),
        "移除最近使用发布配置失败:"
      );
    },

    replaceRecentPublishConfigKey: (previousKey, nextKey, repoId) => {
      const id = resolveScopedMutationRepoId(get().selectedRepoId, repoId);
      if (!id || !previousKey.trim() || !nextKey.trim()) return;
      enqueueRecentMutation(
        () =>
          apiReplaceRecentPublishConfigKey({
            repoId: id,
            previousKey,
            nextKey,
          }),
        "替换最近使用发布配置 key 失败:"
      );
    },

    reorderRecentPublishConfigs: (configKeys, repoId) => {
      const id = resolveScopedMutationRepoId(get().selectedRepoId, repoId);
      if (!id) return;

      set((prev) =>
        mergeRecentPublishState(prev, {
          recentRepoIds: prev.recentRepoIds,
          recentConfigKeysByRepo: {
            ...prev.recentConfigKeysByRepo,
            [id]: configKeys,
          },
        })
      );

      enqueueRecentMutation(
        () => apiReorderRecentPublishConfigs({ repoId: id, configKeys }),
        "保存最近使用排序失败",
        { applyState: false }
      );
    },
  };
});
