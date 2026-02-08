import { describe, expect, it } from "vitest";

import {
  loadHistoryFilterPresets,
  saveHistoryFilterPresets,
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
});
