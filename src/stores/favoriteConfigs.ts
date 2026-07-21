/**
 * localStorage-backed favorites store consumed by the Zustand appStore.
 * This keeps favorites persistence an internal implementation detail —
 * consumers only interact through appStore actions, never localStorage directly.
 */
const STORAGE_KEY = "one-publish:favoriteConfigs";
const LEGACY_SCOPE = "__legacy__";

export type FavoriteConfigsByRepo = Record<string, string[]>;

interface FavoriteMigrationRepository {
  id: string;
  publishConfig: {
    profiles: Array<{ id: string; name: string }>;
  };
}

export function loadFavorites(): FavoriteConfigsByRepo {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw);

    // Legacy format: top-level array → migrate to scoped map
    if (Array.isArray(parsed)) {
      const legacy = parsed.filter(
        (item): item is string => typeof item === "string"
      );
      if (legacy.length === 0) return {};
      return { [LEGACY_SCOPE]: legacy };
    }

    if (!parsed || typeof parsed !== "object") return {};

    return Object.entries(
      parsed as Record<string, unknown>
    ).reduce<FavoriteConfigsByRepo>((acc, [repoId, keys]) => {
      if (!Array.isArray(keys)) return acc;
      const normalized = keys.filter(
        (item): item is string => typeof item === "string"
      );
      if (normalized.length > 0) {
        acc[repoId] = normalized;
      }
      return acc;
    }, {});
  } catch {
    return {};
  }
}

export function persistFavorites(data: FavoriteConfigsByRepo): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // noop — storage full or unavailable
  }
}

/** Migrate legacy unscoped favorites into the current repo scope. */
export function migrateLegacyFavorites(
  current: FavoriteConfigsByRepo,
  repoId: string
): FavoriteConfigsByRepo | null {
  const legacy = current[LEGACY_SCOPE];
  if (!legacy || current[repoId]) return null;

  const next = { ...current, [repoId]: legacy };
  delete next[LEGACY_SCOPE];
  return next;
}

/**
 * Rewrites the pre-immutable-identity `userprofile:<name>` favorites once the
 * backend has migrated repository profiles and supplied their IDs.
 */
export function migrateNameBasedProfileFavorites(
  current: FavoriteConfigsByRepo,
  repositories: readonly FavoriteMigrationRepository[]
): FavoriteConfigsByRepo {
  let changed = false;
  const next = { ...current };

  for (const repository of repositories) {
    const scoped = current[repository.id];
    if (!scoped) {
      continue;
    }

    const profileIds = new Set<string>();
    const profileIdByName = new Map<string, string>();
    for (const profile of repository.publishConfig.profiles) {
      const profileId = profile.id.trim();
      if (!profileId) {
        continue;
      }
      profileIds.add(profileId);
      profileIdByName.set(profile.name, profileId);
    }

    const migrated = scoped.map((configKey) => {
      if (!configKey.startsWith("userprofile:")) {
        return configKey;
      }

      const value = configKey.slice("userprofile:".length).trim();
      if (!value || profileIds.has(value)) {
        return configKey;
      }

      const profileId = profileIdByName.get(value);
      if (!profileId) {
        return configKey;
      }

      changed = true;
      return `userprofile:${profileId}`;
    });
    const uniqueMigrated = Array.from(new Set(migrated));
    if (uniqueMigrated.length !== migrated.length) {
      changed = true;
    }
    next[repository.id] = uniqueMigrated;
  }

  return changed ? next : current;
}
