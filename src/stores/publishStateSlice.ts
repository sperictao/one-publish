import type { StateCreator } from "zustand";
import type { AppState, PublishConfigStore } from "@/lib/store/types";
import {
  updatePublishState as apiUpdatePublishState,
  pushRecentPublishConfig as apiPushRecentPublishConfig,
  removeRecentPublishConfig as apiRemoveRecentPublishConfig,
  replaceRecentPublishConfigKey as apiReplaceRecentPublishConfigKey,
  reorderRecentPublishConfigs as apiReorderRecentPublishConfigs,
} from "@/lib/store/api";
import {
  applyPublishStateMutation,
  mergeRecentPublishState,
  resolveScopedMutationRepoId,
  type PublishStatePatch,
} from "./appStoreMutations";
import { makeHandlePersistenceFailure } from "./appStoreHelpers";
import type { AppStore } from "./appStore";

export interface PublishStateSlice {
  /** 最近使用的仓库 ID 列表 */
  recentRepoIds: string[];
  /** 每个仓库的最近使用发布配置 key 列表 */
  recentConfigKeysByRepo: Record<string, string[]>;

  /** 设置发布状态（带防抖持久化，按仓库作用域） */
  setPublishState: (params: PublishStatePatch) => void;
  /** 设置选中的预设 */
  setSelectedPreset: (preset: string) => void;
  /** 设置自定义模式 */
  setIsCustomMode: (mode: boolean) => void;
  /** 设置自定义配置 */
  setCustomConfig: (config: PublishConfigStore) => void;

  /** 记录最近使用的发布配置 */
  pushRecentPublishConfig: (configKey: string, repoId?: string | null) => void;
  /** 移除最近使用的发布配置 */
  removeRecentPublishConfig: (configKey: string, repoId?: string | null) => void;
  /** 替换最近使用发布配置的 key */
  replaceRecentPublishConfigKey: (
    previousKey: string,
    nextKey: string,
    repoId?: string | null
  ) => void;
  /** 重排最近使用发布配置的顺序 */
  reorderRecentPublishConfigs: (
    configKeys: string[],
    repoId?: string | null
  ) => void;
}

// ── Module-level closures ──
const DEBOUNCE_DELAY = 500;
let publishDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let recentMutationQueue: Promise<void> = Promise.resolve();
const pendingPublishState = new Map<string, PublishStatePatch>();

export const createPublishStateSlice: StateCreator<
  AppStore,
  [],
  [],
  PublishStateSlice
> = (set, get) => {
  const handlePersistenceFailure = makeHandlePersistenceFailure(
    set as (partial: Record<string, unknown>) => void,
    get
  );

  function enqueueRecentMutation(
    mutation: () => Promise<AppState>,
    errorMessage: string,
    options?: { applyState?: boolean }
  ) {
    recentMutationQueue = recentMutationQueue
      .catch(() => undefined)
      .then(() => mutation())
      .then((nextState) => {
        if (options?.applyState === false) {
          return;
        }
        set((prev) => mergeRecentPublishState(prev, nextState));
      })
      .catch((err) => handlePersistenceFailure(errorMessage, err));
  }

  return {
    // ── State defaults ──
    recentRepoIds: [],
    recentConfigKeysByRepo: {},

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
            apiUpdatePublishState({ repoId, ...pendingParams }).catch((err) => {
              void handlePersistenceFailure("保存发布配置失败", err);
            })
          )
        );
      }, DEBOUNCE_DELAY);
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
};
