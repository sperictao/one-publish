export interface RerunChecklistPreference {
  enabled: boolean;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = "one-publish/rerun-checklist-preference/v1";

export const DEFAULT_RERUN_CHECKLIST_PREFERENCE: RerunChecklistPreference = {
  enabled: false,
};

function getStorage(storage?: StorageLike): StorageLike | null {
  if (storage) {
    return storage;
  }

  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  return window.localStorage;
}

function isValidPreference(value: unknown): value is RerunChecklistPreference {
  if (!value || typeof value !== "object") {
    return false;
  }

  const preference = value as Record<string, unknown>;
  return typeof preference.enabled === "boolean";
}

export function loadRerunChecklistPreference(
  storage?: StorageLike
): RerunChecklistPreference {
  const target = getStorage(storage);
  if (!target) {
    return { ...DEFAULT_RERUN_CHECKLIST_PREFERENCE };
  }

  try {
    const raw = target.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_RERUN_CHECKLIST_PREFERENCE };
    }

    const parsed = JSON.parse(raw);
    if (!isValidPreference(parsed)) {
      return { ...DEFAULT_RERUN_CHECKLIST_PREFERENCE };
    }

    return {
      enabled: parsed.enabled,
    };
  } catch {
    return { ...DEFAULT_RERUN_CHECKLIST_PREFERENCE };
  }
}

export function saveRerunChecklistPreference(
  preference: RerunChecklistPreference,
  storage?: StorageLike
): void {
  const target = getStorage(storage);
  if (!target) {
    return;
  }

  const normalized = isValidPreference(preference)
    ? preference
    : DEFAULT_RERUN_CHECKLIST_PREFERENCE;

  target.setItem(STORAGE_KEY, JSON.stringify(normalized));
}
