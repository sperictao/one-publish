import { describe, expect, it } from "vitest";

import {
  DEFAULT_RERUN_CHECKLIST_PREFERENCE,
  loadRerunChecklistPreference,
  saveRerunChecklistPreference,
} from "@/lib/rerunChecklistPreference";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("rerunChecklistPreference", () => {
  it("可持久化开关设置", () => {
    const storage = new MemoryStorage();

    saveRerunChecklistPreference({ enabled: true }, storage);

    const loaded = loadRerunChecklistPreference(storage);
    expect(loaded).toEqual({ enabled: true });
  });

  it("非法结构回退默认值", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "one-publish/rerun-checklist-preference/v1",
      JSON.stringify({ enabled: "yes" })
    );

    const loaded = loadRerunChecklistPreference(storage);
    expect(loaded).toEqual(DEFAULT_RERUN_CHECKLIST_PREFERENCE);
  });
});
