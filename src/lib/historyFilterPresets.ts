export type HistoryFilterStatus = "all" | "success" | "failed" | "cancelled";
export type HistoryFilterWindow = "all" | "24h" | "7d" | "30d";

export interface HistoryFilterPreset {
  id: string;
  name: string;
  provider: string;
  status: HistoryFilterStatus;
  window: HistoryFilterWindow;
  keyword: string;
}

export type HistoryExportFormat = "csv" | "json";

export interface DailyTriagePreset {
  enabled: boolean;
  provider: string;
  status: HistoryFilterStatus;
  window: HistoryFilterWindow;
  keyword: string;
  format: HistoryExportFormat;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const HISTORY_PRESET_STORAGE_KEY = "one-publish/history-filter-presets/v1";
const DAILY_TRIAGE_STORAGE_KEY = "one-publish/daily-triage-preset/v1";
const MAX_PRESETS = 20;

const VALID_STATUS: HistoryFilterStatus[] = [
  "all",
  "success",
  "failed",
  "cancelled",
];
const VALID_WINDOW: HistoryFilterWindow[] = ["all", "24h", "7d", "30d"];
const VALID_EXPORT_FORMAT: HistoryExportFormat[] = ["csv", "json"];

export const DEFAULT_DAILY_TRIAGE_PRESET: DailyTriagePreset = {
  enabled: true,
  provider: "all",
  status: "failed",
  window: "24h",
  keyword: "",
  format: "csv",
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

function isValidPreset(value: unknown): value is HistoryFilterPreset {
  if (!value || typeof value !== "object") {
    return false;
  }

  const preset = value as Record<string, unknown>;

  return (
    typeof preset.id === "string" &&
    typeof preset.name === "string" &&
    typeof preset.provider === "string" &&
    typeof preset.keyword === "string" &&
    typeof preset.status === "string" &&
    VALID_STATUS.includes(preset.status as HistoryFilterStatus) &&
    typeof preset.window === "string" &&
    VALID_WINDOW.includes(preset.window as HistoryFilterWindow)
  );
}

function isValidDailyTriagePreset(value: unknown): value is DailyTriagePreset {
  if (!value || typeof value !== "object") {
    return false;
  }

  const preset = value as Record<string, unknown>;

  return (
    typeof preset.enabled === "boolean" &&
    typeof preset.provider === "string" &&
    typeof preset.keyword === "string" &&
    typeof preset.status === "string" &&
    VALID_STATUS.includes(preset.status as HistoryFilterStatus) &&
    typeof preset.window === "string" &&
    VALID_WINDOW.includes(preset.window as HistoryFilterWindow) &&
    typeof preset.format === "string" &&
    VALID_EXPORT_FORMAT.includes(preset.format as HistoryExportFormat)
  );
}

export function loadHistoryFilterPresets(storage?: StorageLike): HistoryFilterPreset[] {
  const target = getStorage(storage);
  if (!target) {
    return [];
  }

  try {
    const raw = target.getItem(HISTORY_PRESET_STORAGE_KEY);
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

  target.setItem(
    HISTORY_PRESET_STORAGE_KEY,
    JSON.stringify(presets.slice(0, MAX_PRESETS))
  );
}

export function loadDailyTriagePreset(storage?: StorageLike): DailyTriagePreset {
  const target = getStorage(storage);
  if (!target) {
    return { ...DEFAULT_DAILY_TRIAGE_PRESET };
  }

  try {
    const raw = target.getItem(DAILY_TRIAGE_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_DAILY_TRIAGE_PRESET };
    }

    const parsed = JSON.parse(raw);
    if (!isValidDailyTriagePreset(parsed)) {
      return { ...DEFAULT_DAILY_TRIAGE_PRESET };
    }

    return {
      enabled: parsed.enabled,
      provider: parsed.provider,
      status: parsed.status,
      window: parsed.window,
      keyword: parsed.keyword,
      format: parsed.format,
    };
  } catch {
    return { ...DEFAULT_DAILY_TRIAGE_PRESET };
  }
}

export function saveDailyTriagePreset(
  preset: DailyTriagePreset,
  storage?: StorageLike
): void {
  const target = getStorage(storage);
  if (!target) {
    return;
  }

  const normalized = isValidDailyTriagePreset(preset)
    ? preset
    : DEFAULT_DAILY_TRIAGE_PRESET;

  target.setItem(DAILY_TRIAGE_STORAGE_KEY, JSON.stringify(normalized));
}
