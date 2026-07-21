import { create } from "zustand";

import {
  getAppState,
  getExecutionHistory,
  addExecutionRecord,
  setExecutionRecordSnapshot,
} from "@/lib/store/api";
import type { AppState, ExecutionRecord } from "@/lib/store/types";
import {
  migrateLegacyFavorites,
  migrateNameBasedProfileFavorites,
  persistFavorites,
} from "@/stores/favoriteConfigs";

// ── Slice imports ──
import { createRepositorySlice, type RepositorySlice } from "./repositorySlice";
import { createUiStateSlice, type UiStateSlice } from "./uiStateSlice";
import { createPreferenceSlice, type PreferenceSlice } from "./preferenceSlice";
import {
  createPublishStateSlice,
  type PublishStateSlice,
} from "./publishStateSlice";
import { createFavoritesSlice, type FavoritesSlice } from "./favoritesSlice";
import { mergeBootstrapAppState } from "./appStoreMutations";

// ── Lifecycle / Execution history interface (kept in root store) ──
interface BaseSlice {
  isLoading: boolean;
  error: string | null;
  executionHistory: ExecutionRecord[];

  loadState: () => Promise<void>;
  _restoreAuthoritativeState: () => Promise<AppState>;
  loadExecutionHistory: () => Promise<void>;
  savePublishRecord: (record: ExecutionRecord) => Promise<void>;
  setExecutionSnapshotPath: (
    recordId: string,
    snapshotPath: string
  ) => Promise<void>;
}

// ── Combined store type (imported by slices for type-safe get()) ──
export type AppStore = BaseSlice &
  RepositorySlice &
  UiStateSlice &
  PreferenceSlice &
  PublishStateSlice &
  FavoritesSlice;

// ── Store ──
export const useAppStore = create<AppStore>()((...args) => {
  const [set, get] = args;

  return {
    // ── Base state ──
    isLoading: true,
    error: null,
    executionHistory: [],

    // ── Slices ──
    ...createRepositorySlice(...args),
    ...createUiStateSlice(...args),
    ...createPreferenceSlice(...args),
    ...createPublishStateSlice(...args),
    ...createFavoritesSlice(...args),

    // ── Lifecycle ──
    loadState: async () => {
      try {
        const appState = await getAppState();
        let favorites = get().favoriteConfigKeysByRepo;

        // Migrate legacy favorites into the current repo scope.
        if (appState.selectedRepoId) {
          const migrated = migrateLegacyFavorites(
            favorites,
            appState.selectedRepoId
          );
          if (migrated) {
            favorites = migrated;
          }
        }

        // The backend migrates profiles first, so its name-to-ID map is the
        // authoritative source for the one-time localStorage rewrite.
        favorites = migrateNameBasedProfileFavorites(
          favorites,
          appState.repositories
        );
        if (favorites !== get().favoriteConfigKeysByRepo) {
          persistFavorites(favorites);
          set({ favoriteConfigKeysByRepo: favorites });
        }
        set(
          (state) =>
            ({
              ...mergeBootstrapAppState(state, appState),
              isLoading: false,
              error: null,
            }) as Record<string, unknown>
        );
      } catch (err) {
        console.error("加载应用状态失败:", err);
        set({ isLoading: false, error: String(err) });
      }
    },

    _restoreAuthoritativeState: async () => {
      const authoritativeState = await getAppState();
      set(
        (state) =>
          ({
            ...mergeBootstrapAppState(state, authoritativeState),
            error: null,
          }) as Record<string, unknown>
      );
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
  };
});
