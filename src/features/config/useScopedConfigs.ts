import { useCallback, useEffect, useMemo, useState } from "react";

const FAVORITE_CONFIGS_KEY = "one-publish:favoriteConfigs";
const LEGACY_CONFIG_SCOPE = "__legacy__";

function parseScopedConfigKeys(storageKey: string) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return {} as Record<string, string[]>;
    }

    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      const legacy = parsed.filter((item): item is string => typeof item === "string");
      if (legacy.length === 0) {
        return {} as Record<string, string[]>;
      }
      return { [LEGACY_CONFIG_SCOPE]: legacy };
    }

    if (!parsed || typeof parsed !== "object") {
      return {} as Record<string, string[]>;
    }

    return Object.entries(parsed as Record<string, unknown>).reduce<Record<string, string[]>>(
      (acc, [repoId, keys]) => {
        if (!Array.isArray(keys)) {
          return acc;
        }

        const normalized = keys.filter(
          (item): item is string => typeof item === "string"
        );

        if (normalized.length > 0) {
          acc[repoId] = normalized;
        }

        return acc;
      },
      {}
    );
  } catch {
    return {} as Record<string, string[]>;
  }
}

function persistScopedConfigKeys(
  storageKey: string,
  data: Record<string, string[]>
) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(data));
  } catch {
    // noop
  }
}

export function useScopedConfigs(params: {
  selectedRepoId: string | null;
  recentConfigByRepo: Record<string, string[]>;
  pushRecentConfig: (key: string, repoId?: string | null) => void;
  removeRecentConfig: (key: string, repoId?: string | null) => void;
  reorderRecentConfig: (keys: string[], repoId?: string | null) => void;
  replaceRecentConfigKey: (
    previousKey: string,
    nextKey: string,
    repoId?: string | null
  ) => void;
}) {
  const {
    selectedRepoId,
    recentConfigByRepo,
    pushRecentConfig,
    removeRecentConfig,
    reorderRecentConfig,
    replaceRecentConfigKey,
  } = params;
  const [favoriteConfigByRepo, setFavoriteConfigByRepo] = useState<
    Record<string, string[]>
  >(() => parseScopedConfigKeys(FAVORITE_CONFIGS_KEY));

  useEffect(() => {
    if (!selectedRepoId) {
      return;
    }

    setFavoriteConfigByRepo((prev) => {
      const legacy = prev[LEGACY_CONFIG_SCOPE];
      if (!legacy || prev[selectedRepoId]) {
        return prev;
      }

      const next = {
        ...prev,
        [selectedRepoId]: legacy,
      };
      delete next[LEGACY_CONFIG_SCOPE];
      persistScopedConfigKeys(FAVORITE_CONFIGS_KEY, next);
      return next;
    });
  }, [selectedRepoId]);

  const recentConfigKeys = useMemo(() => {
    if (!selectedRepoId) {
      return [];
    }
    return recentConfigByRepo[selectedRepoId] ?? [];
  }, [recentConfigByRepo, selectedRepoId]);

  const favoriteConfigKeys = useMemo(() => {
    if (!selectedRepoId) {
      return [];
    }
    return favoriteConfigByRepo[selectedRepoId] ?? [];
  }, [favoriteConfigByRepo, selectedRepoId]);

  const toggleFavoriteConfig = useCallback(
    (key: string, repoId: string | null = selectedRepoId) => {
      if (!repoId) {
        return;
      }

      const scoped = favoriteConfigByRepo[repoId] ?? [];
      const isFavorite = scoped.includes(key);

      setFavoriteConfigByRepo((prev) => {
        const current = prev[repoId] ?? [];
        const nextScoped = isFavorite
          ? current.filter((item) => item !== key)
          : [key, ...current.filter((item) => item !== key)];

        const next = {
          ...prev,
          [repoId]: nextScoped,
        };
        persistScopedConfigKeys(FAVORITE_CONFIGS_KEY, next);
        return next;
      });

      if (!isFavorite) {
        pushRecentConfig(key, repoId);
      }
    },
    [favoriteConfigByRepo, pushRecentConfig, selectedRepoId]
  );

  const replaceScopedConfigKey = useCallback(
    (previousKey: string, nextKey: string, repoId: string | null = selectedRepoId) => {
      if (!repoId || !previousKey || !nextKey) {
        return;
      }

      replaceRecentConfigKey(previousKey, nextKey, repoId);

      setFavoriteConfigByRepo((prev) => {
        const scoped = prev[repoId] ?? [];
        if (!scoped.includes(previousKey)) {
          return prev;
        }

        const nextScoped = Array.from(
          new Set(scoped.map((item) => (item === previousKey ? nextKey : item)))
        );
        const next = {
          ...prev,
          [repoId]: nextScoped,
        };
        persistScopedConfigKeys(FAVORITE_CONFIGS_KEY, next);
        return next;
      });
    },
    [replaceRecentConfigKey, selectedRepoId]
  );

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
