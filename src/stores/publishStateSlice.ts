import type { StateCreator } from "zustand";
import type { AppState } from "@/lib/store/types";
import type { PublishEditStateUpdate } from "@/generated/tauri-contracts";
import {
  updatePublishEditState as apiUpdatePublishEditState,
  pushRecentPublishConfig as apiPushRecentPublishConfig,
  removeRecentPublishConfig as apiRemoveRecentPublishConfig,
  replaceRecentPublishConfigKey as apiReplaceRecentPublishConfigKey,
  reorderRecentPublishConfigs as apiReorderRecentPublishConfigs,
} from "@/lib/store/api";
import {
  mergeRecentPublishState,
  resolveScopedMutationRepoId,
} from "./appStoreMutations";
import { makeHandlePersistenceFailure } from "./appStoreHelpers";
import type { AppStore } from "./appStore";

export interface PublishStateSlice {
  /** 最近使用的仓库 ID 列表 */
  recentRepoIds: string[];
  /** 每个仓库的最近使用发布配置 key 列表 */
  recentConfigKeysByRepo: Record<string, string[]>;

  /** 设置发布状态（带防抖持久化，按仓库作用域） */
  /** 显式提交编辑状态（选择引用与/或当前作用域草稿） */
  updatePublishEditState: (update: PublishEditStateUpdate) => void;

  /** 记录最近使用的发布配置 */
  pushRecentPublishConfig: (configKey: string, repoId?: string | null) => void;
  /** 移除最近使用的发布配置 */
  removeRecentPublishConfig: (
    configKey: string,
    repoId?: string | null
  ) => void;
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
let recentMutationQueue: Promise<void> = Promise.resolve();

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
    updatePublishEditState: (update) => {
      const { selectedRepoId } = get();
      if (!selectedRepoId) return;
      void apiUpdatePublishEditState({ repoId: selectedRepoId, update })
        .then((nextState) => {
          // 回写 selection：交互后即时可用于来源构造（批次 3 的水合也依赖）。
          set((prev) => {
            const repositories = prev.repositories.map((repo) =>
              repo.id === selectedRepoId
                ? {
                    ...repo,
                    publishConfig:
                      nextState.repositories.find(
                        (r) => r.id === selectedRepoId
                      )?.publishConfig ?? repo.publishConfig,
                  }
                : repo
            );
            return { repositories };
          });
        })
        .catch((err) => {
          void handlePersistenceFailure("保存发布配置失败", err);
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
};
