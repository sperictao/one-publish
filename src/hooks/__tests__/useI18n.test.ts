import { describe, it, expect, beforeEach } from "vitest";
import { t, __setTranslationsCacheForTest } from "../useI18n";

const zh = {
  settings: { title: "\u5e94\u7528\u8bbe\u7f6e" },
  version: { current: "\u5f53\u524d\u7248\u672c: v{}" },
};

describe("useI18n.t", () => {
  beforeEach(() => {
    localStorage.clear();
    __setTranslationsCacheForTest({} as any);
  });

  it("returns key when cache not loaded", () => {
    localStorage.setItem("app-language", "zh");
    expect(t("settings.title")).toBe("settings.title");
  });

  it("resolves dot-path keys when translations are cached", () => {
    __setTranslationsCacheForTest({ zh } as any);

    localStorage.setItem("app-language", "zh");
    expect(t("settings.title")).toBe("\u5e94\u7528\u8bbe\u7f6e");
  });

  it("resolves nested key and ignores unrelated params", () => {
    __setTranslationsCacheForTest({ zh } as any);

    localStorage.setItem("app-language", "zh");
    expect(t("version.current", { any: 123 })).toBe("\u5f53\u524d\u7248\u672c: v{}");
  });
});
