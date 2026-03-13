import { useCallback, useEffect, useMemo, useState } from "react";

const RECENT_CONFIGS_KEY = "one-publish:recentConfigs";
const FAVORITE_CONFIGS_KEY = "one-publish:favoriteConfigs";
const LEGACY_CONFIG_SCOPE = "__legacy__";
const MAX_RECENT = 6;

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

export function useScopedConfigs(selectedRepoId: string | null) {
  const [recentConfigByRepo, setRecentConfigByRepo] = useState<Record<string, string[]>>(() =>
    parseScopedConfigKeys(RECENT_CONFIGS_KEY)
  );
  const [favoriteConfigByRepo, setFavoriteConfigByRepo] = useState<Record<string, string[]>>(() =>
    parseScopedConfigKeys(FAVORITE_CONFIGS_KEY)
  );

  useEffect(() => {
    if (!selectedRepoId) {
      return;
    }

    setRecentConfigByRepo((prev) => {
      const legacy = prev[LEGACY_CONFIG_SCOPE];
      if (!legacy || prev[selectedRepoId]) {
        return prev;
      }

      const next = {
        ...prev,
        [selectedRepoId]: legacy,
      };
      delete next[LEGACY_CONFIG_SCOPE];
      persistScopedConfigKeys(RECENT_CONFIGS_KEY, next);
      return next;
    });

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

  const pushRecentConfig = useCallback(
    (key: string, repoId: string | null = selectedRepoId) => {
      if (!repoId) {
        return;
      }

      setRecentConfigByRepo((prev) => {
        const scoped = prev[repoId] ?? [];
        const nextScoped = [key, ...scoped.filter((item) => item !== key)].slice(
          0,
          MAX_RECENT
        );
        const next = {
          ...prev,
          [repoId]: nextScoped,
        };
        persistScopedConfigKeys(RECENT_CONFIGS_KEY, next);
        return next;
      });
    },
    [selectedRepoId]
  );

  const removeRecentConfig = useCallback(
    (key: string, repoId: string | null = selectedRepoId) => {
      if (!repoId) {
        return;
      }

      setRecentConfigByRepo((prev) => {
        const scoped = prev[repoId] ?? [];
        const next = {
          ...prev,
          [repoId]: scoped.filter((item) => item !== key),
        };
        persistScopedConfigKeys(RECENT_CONFIGS_KEY, next);
        return next;
      });
    },
    [selectedRepoId]
  );

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

  return {
    recentConfigKeys,
    favoriteConfigKeys,
    pushRecentConfig,
    removeRecentConfig,
    toggleFavoriteConfig,
  };
}
