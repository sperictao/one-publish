import { describe, expect, it } from "vitest";

import {
  DEFAULT_DAILY_TRIAGE_PRESET,
  loadDailyTriagePreset,
  loadHistoryFilterPresets,
  saveDailyTriagePreset,
  saveHistoryFilterPresets,
  type DailyTriagePreset,
  type HistoryFilterPreset,
} from "@/lib/historyFilterPresets";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("historyFilterPresets", () => {
  it("可持久化并读取合法预设", () => {
    const storage = new MemoryStorage();
    const presets: HistoryFilterPreset[] = [
      {
        id: "p1",
        name: "仅失败",
        provider: "all",
        status: "failed",
        window: "7d",
        keyword: "sdk",
      },
    ];

    saveHistoryFilterPresets(presets, storage);
    const loaded = loadHistoryFilterPresets(storage);

    expect(loaded).toEqual(presets);
  });

  it("读取非法结构时返回空数组", () => {
    const storage = new MemoryStorage();
    storage.setItem("one-publish/history-filter-presets/v1", "{bad json}");

    const loaded = loadHistoryFilterPresets(storage);
    expect(loaded).toEqual([]);
  });

  it("可持久化并读取日报预设", () => {
    const storage = new MemoryStorage();
    const preset: DailyTriagePreset = {
      enabled: true,
      provider: "dotnet",
      status: "failed",
      window: "24h",
      keyword: "sdk",
      format: "csv",
    };

    saveDailyTriagePreset(preset, storage);
    const loaded = loadDailyTriagePreset(storage);

    expect(loaded).toEqual(preset);
  });

  it("日报预设非法时回退默认值", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "one-publish/daily-triage-preset/v1",
      JSON.stringify({ enabled: "yes", status: "failed" })
    );

    const loaded = loadDailyTriagePreset(storage);
    expect(loaded).toEqual(DEFAULT_DAILY_TRIAGE_PRESET);
  });
});
