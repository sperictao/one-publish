import type { StateCreator } from "zustand";
import type { AppStore } from "./appStore";
import { loadFavorites, persistFavorites } from "./favoriteConfigs";
import { resolveScopedMutationRepoId } from "./appStoreMutations";

export interface FavoritesSlice {
  /** 按仓库作用域的收藏配置 key 映射 (localStorage-backed) */
  favoriteConfigKeysByRepo: Record<string, string[]>;

  /** 切换收藏配置 */
  toggleFavoriteConfig: (key: string, repoId?: string | null) => void;
}

export const createFavoritesSlice: StateCreator<
  AppStore,
  [],
  [],
  FavoritesSlice
> = (set, get) => {
  return {
    // ── State defaults (from localStorage) ──
    favoriteConfigKeysByRepo: loadFavorites(),

    // ── Favorites ──
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
  };
};
