// useI18n - 国际化 Hook
// 管理应用语言切换和翻译

import { useState, useEffect, useCallback } from "react";

export type Language = "zh" | "en";

// 默认语言
const DEFAULT_LANGUAGE: Language = "zh";
const LANGUAGE_STORAGE_KEY = "app-language";
const LANGUAGE_CHANGED_EVENT = "app-language-changed";

// 导入翻译文件
type TranslationTree = Record<string, any>;
type TranslationModule = { default: TranslationTree };

const translations: Record<Language, () => Promise<TranslationModule>> = {
  zh: () => import("@/i18n/zh.json"),
  en: () => import("@/i18n/en.json"),
};

// 缓存翻译（JSON 为嵌套结构）
let translationsCache: Partial<Record<Language, TranslationTree>> = {};

function normalizeLanguage(value: string | null): Language {
  return value === "en" ? "en" : DEFAULT_LANGUAGE;
}

function getStoredLanguage(): Language {
  return normalizeLanguage(localStorage.getItem(LANGUAGE_STORAGE_KEY));
}

function writeStoredLanguage(language: Language): boolean {
  const current = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (current === language) {
    return false;
  }

  localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  return true;
}

function emitLanguageChanged(language: Language) {
  window.dispatchEvent(
    new CustomEvent<Language>(LANGUAGE_CHANGED_EVENT, { detail: language })
  );
}

// test-only helper
export function __setTranslationsCacheForTest(
  cache: Partial<Record<Language, TranslationTree>>
) {
  translationsCache = cache;
}

/**
 * 加载翻译文件
 */
async function loadTranslations(lang: Language): Promise<TranslationTree> {
  if (translationsCache[lang]) {
    return translationsCache[lang];
  }

  const module = await translations[lang]();
  translationsCache[lang] = module.default;
  return module.default;
}

/**
 * 获取翻译（带参数替换）
 */
function t(key: string, params?: Record<string, string | number>): string {
  const lang = getStoredLanguage();
  const translations = translationsCache[lang];

  if (!translations) {
    return key;
  }

  let text = key;

  const value = key
    .split(".")
    .reduce<any>((acc, part) => (acc ? acc[part] : undefined), translations);

  if (typeof value === "string") {
    text = value;
  }

  // 替换参数 {{key}}
  if (params) {
    Object.keys(params).forEach((paramKey) => {
      const regex = new RegExp(`{{${paramKey}}}`, "g");
      text = text.replace(regex, String(params[paramKey]));
    });
  }

  return text;
}

/**
 * 国际化 Hook
 */
export function useI18n() {
  const [language, setLanguageState] = useState<Language>(getStoredLanguage);
  const [translations, setTranslations] = useState<TranslationTree>(() => {
    return translationsCache[getStoredLanguage()] || {};
  });

  // 加载翻译
  useEffect(() => {
    let isMounted = true;

    loadTranslations(language).then((nextTranslations) => {
      if (isMounted) {
        setTranslations(nextTranslations);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [language]);

  // 首次加载或外部同步后，统一修正本地存储中的语言值
  useEffect(() => {
    writeStoredLanguage(language);
  }, [language]);

  useEffect(() => {
    const handleLanguageChanged = (event: Event) => {
      const nextLanguage = normalizeLanguage(
        (event as CustomEvent<Language>).detail ?? getStoredLanguage()
      );

      setLanguageState(nextLanguage);
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== LANGUAGE_STORAGE_KEY) {
        return;
      }

      setLanguageState(getStoredLanguage());
    };

    window.addEventListener(
      LANGUAGE_CHANGED_EVENT,
      handleLanguageChanged as EventListener
    );
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(
        LANGUAGE_CHANGED_EVENT,
        handleLanguageChanged as EventListener
      );
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  // 切换语言
  const setLanguage = useCallback(async (lang: Language) => {
    const nextLanguage = normalizeLanguage(lang);
    const isStorageChanged = writeStoredLanguage(nextLanguage);

    if (isStorageChanged) {
      emitLanguageChanged(nextLanguage);
    }

    setLanguageState(nextLanguage);

    const newTranslations = await loadTranslations(nextLanguage);
    setTranslations(newTranslations);
  }, []);

  return {
    language,
    setLanguage,
    t,
    translations,
  };
}

// 导出翻译函数以便在组件外使用
export { t };
