import { useMemo } from "react";

import { useAppStore } from "@/stores/appStore";

/**
 * Scoped config helpers that consume the unified appStore for favorites
 * and proxy through for recent configs (also managed by appStore).
 *
 * Favorites persistence (localStorage) is an internal detail of the appStore —
 * consumers never touch localStorage directly.
 */
export function useScopedConfigs(params: {
  selectedRepoId: string | null;
  recentConfigByRepo: Record<string, string[]>;
  pushRecentConfig: (key: string, repoId?: string | null) => void;
  removeRecentConfig: (key: string, repoId?: string | null) => void;
  reorderRecentConfig: (keys: string[], repoId?: string | null) => void;
}) {
  const {
    selectedRepoId,
    recentConfigByRepo,
    pushRecentConfig,
    removeRecentConfig,
    reorderRecentConfig,
  } = params;

  const favoriteConfigKeysByRepo = useAppStore((s) => s.favoriteConfigKeysByRepo);
  const toggleFavoriteConfig = useAppStore((s) => s.toggleFavoriteConfig);
  const replaceScopedConfigKey = useAppStore((s) => s.replaceScopedConfigKey);

  const recentConfigKeys = useMemo(() => {
    if (!selectedRepoId) return [];
    return recentConfigByRepo[selectedRepoId] ?? [];
  }, [recentConfigByRepo, selectedRepoId]);

  const favoriteConfigKeys = useMemo(() => {
    if (!selectedRepoId) return [];
    return favoriteConfigKeysByRepo[selectedRepoId] ?? [];
  }, [favoriteConfigKeysByRepo, selectedRepoId]);

  return {
    recentConfigKeys,
    favoriteConfigKeys,
    pushRecentConfig,
    removeRecentConfig,
    reorderRecentConfig,
    toggleFavoriteConfig,
    replaceScopedConfigKey,
  };
}
