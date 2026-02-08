export interface HistoryFilterPreset {
  id: string;
  name: string;
  provider: string;
  status: "all" | "success" | "failed" | "cancelled";
  window: "all" | "24h" | "7d" | "30d";
  keyword: string;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = "one-publish/history-filter-presets/v1";
const MAX_PRESETS = 20;

function getStorage(storage?: StorageLike): StorageLike | null {
  if (storage) {
    return storage;
  }

  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  return window.localStorage;
}

function isValidPreset(value: unknown): value is HistoryFilterPreset {
  if (!value || typeof value !== "object") {
    return false;
  }

  const preset = value as Record<string, unknown>;
  const validStatus = ["all", "success", "failed", "cancelled"];
  const validWindow = ["all", "24h", "7d", "30d"];

  return (
    typeof preset.id === "string" &&
    typeof preset.name === "string" &&
    typeof preset.provider === "string" &&
    typeof preset.keyword === "string" &&
    typeof preset.status === "string" &&
    validStatus.includes(preset.status) &&
    typeof preset.window === "string" &&
    validWindow.includes(preset.window)
  );
}

export function loadHistoryFilterPresets(storage?: StorageLike): HistoryFilterPreset[] {
  const target = getStorage(storage);
  if (!target) {
    return [];
  }

  try {
    const raw = target.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isValidPreset).slice(0, MAX_PRESETS);
  } catch {
    return [];
  }
}

export function saveHistoryFilterPresets(
  presets: HistoryFilterPreset[],
  storage?: StorageLike
): void {
  const target = getStorage(storage);
  if (!target) {
    return;
  }

  target.setItem(STORAGE_KEY, JSON.stringify(presets.slice(0, MAX_PRESETS)));
}
