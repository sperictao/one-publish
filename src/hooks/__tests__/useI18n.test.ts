import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { t, useI18n, __setTranslationsCacheForTest } from "../useI18n";

const zh = {
  settings: { title: "应用设置" },
  version: { current: "当前版本: v{}" },
};

const en = {
  settings: { title: "App Settings" },
  version: { current: "Current Version: v{}" },
};

describe("useI18n.t", () => {
  beforeEach(() => {
    localStorage.clear();
    __setTranslationsCacheForTest({ zh, en } as any);
  });

  it("returns key when cache not loaded", () => {
    __setTranslationsCacheForTest({} as any);
    localStorage.setItem("app-language", "zh");
    expect(t("settings.title")).toBe("settings.title");
  });

  it("resolves dot-path keys when translations are cached", () => {
    localStorage.setItem("app-language", "zh");
    expect(t("settings.title")).toBe("应用设置");
  });

  it("resolves nested key and ignores unrelated params", () => {
    localStorage.setItem("app-language", "zh");
    expect(t("version.current", { any: 123 })).toBe("当前版本: v{}");
  });

  it("falls back to default language when storage value is invalid", () => {
    localStorage.setItem("app-language", "fr");
    expect(t("settings.title")).toBe("应用设置");
  });
});

describe("useI18n hook sync", () => {
  beforeEach(() => {
    localStorage.clear();
    __setTranslationsCacheForTest({ zh, en } as any);
  });

  it("syncs language across hook instances", async () => {
    localStorage.setItem("app-language", "zh");

    const primary = renderHook(() => useI18n());
    const secondary = renderHook(() => useI18n());

    expect(primary.result.current.language).toBe("zh");
    expect(secondary.result.current.language).toBe("zh");

    await act(async () => {
      await primary.result.current.setLanguage("en");
    });

    await waitFor(() => {
      expect(primary.result.current.language).toBe("en");
      expect(secondary.result.current.language).toBe("en");
      expect(localStorage.getItem("app-language")).toBe("en");
    });
  });

  it("normalizes initial language from storage", async () => {
    localStorage.setItem("app-language", "ja");

    const { result } = renderHook(() => useI18n());

    expect(result.current.language).toBe("zh");

    await waitFor(() => {
      expect(localStorage.getItem("app-language")).toBe("zh");
    });
  });
});
