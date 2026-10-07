import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  getLanguageLocale,
  t,
  useI18n,
  __setTranslationsCacheForTest,
} from "../useI18n";

const zh = {
  settings: {
    title: "应用设置",
    general: {
      executionHistoryLimitLabel: "执行历史保留上限",
    },
  },
  version: { current: "当前版本: v{}" },
};

const en = {
  settings: {
    title: "App Settings",
    general: {
      executionHistoryLimitLabel: "Execution History Retention Limit",
    },
  },
  version: { current: "Current Version: v{}" },
};

type TestTranslationCache = Parameters<typeof __setTranslationsCacheForTest>[0];

describe("useI18n.t", () => {
  beforeEach(() => {
    localStorage.clear();
    __setTranslationsCacheForTest({ zh, en } as TestTranslationCache);
  });

  it("returns key when cache not loaded", () => {
    __setTranslationsCacheForTest({} as TestTranslationCache);
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

  it("resolves deeper nested translation keys", () => {
    localStorage.setItem("app-language", "zh");
    expect(t("settings.general.executionHistoryLimitLabel")).toBe(
      "执行历史保留上限"
    );
  });

  it("falls back to default language when storage value is invalid", () => {
    localStorage.setItem("app-language", "fr");
    expect(t("settings.title")).toBe("应用设置");
  });
});

describe("useI18n hook sync", () => {
  beforeEach(() => {
    localStorage.clear();
    __setTranslationsCacheForTest({ zh, en } as TestTranslationCache);
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

describe("useI18n document language", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = "zh-CN";
    __setTranslationsCacheForTest({ zh, en } as TestTranslationCache);
  });

  it("maps app languages to BCP 47 locale tags", () => {
    expect(getLanguageLocale("zh")).toBe("zh-CN");
    expect(getLanguageLocale("en")).toBe("en-US");
  });

  it("applies the stored language to <html lang> on mount", async () => {
    localStorage.setItem("app-language", "en");

    renderHook(() => useI18n());

    await waitFor(() => {
      expect(document.documentElement.lang).toBe("en-US");
    });
  });

  it("updates <html lang> when switching language and back", async () => {
    localStorage.setItem("app-language", "zh");
    const { result } = renderHook(() => useI18n());

    await waitFor(() => {
      expect(document.documentElement.lang).toBe("zh-CN");
    });

    await act(async () => {
      await result.current.setLanguage("en");
    });
    await waitFor(() => {
      expect(document.documentElement.lang).toBe("en-US");
    });

    await act(async () => {
      await result.current.setLanguage("zh");
    });
    await waitFor(() => {
      expect(document.documentElement.lang).toBe("zh-CN");
    });
  });

  it("follows language changes made in another window", async () => {
    localStorage.setItem("app-language", "zh");
    renderHook(() => useI18n());

    act(() => {
      localStorage.setItem("app-language", "en");
      window.dispatchEvent(
        new StorageEvent("storage", { key: "app-language", newValue: "en" })
      );
    });

    await waitFor(() => {
      expect(document.documentElement.lang).toBe("en-US");
    });
  });
});
