/**
 * localStorage-backed favorites store consumed by the Zustand appStore.
 * This keeps favorites persistence an internal implementation detail —
 * consumers only interact through appStore actions, never localStorage directly.
 */
const STORAGE_KEY = "one-publish:favoriteConfigs";
const LEGACY_SCOPE = "__legacy__";

export type FavoriteConfigsByRepo = Record<string, string[]>;

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

    return Object.entries(parsed as Record<string, unknown>).reduce<
      FavoriteConfigsByRepo
    >((acc, [repoId, keys]) => {
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
