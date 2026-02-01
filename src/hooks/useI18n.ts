// useI18n - 国际化 Hook
// 管理应用语言切换和翻译

import { useState, useEffect, useCallback } from "react";

export type Language = "zh" | "en";

// 默认语言
const DEFAULT_LANGUAGE: Language = "zh";

// 导入翻译文件
const translations = {
  zh: () => import("@/i18n/zh.json"),
  en: () => import("@/i18n/en.json"),
};

// 缓存翻译（JSON 为嵌套结构）
let translationsCache: Record<Language, any> = {} as any;

/**
 * 加载翻译文件
 */
async function loadTranslations(lang: Language): Promise<any> {
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
  const lang = (localStorage.getItem("app-language") || DEFAULT_LANGUAGE) as Language;
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
  const [language, setLanguageState] = useState<Language>(() => {
    return (localStorage.getItem("app-language") || DEFAULT_LANGUAGE) as Language;
  });
  const [translations, setTranslations] = useState<any>({});

  // 加载翻译
  useEffect(() => {
    loadTranslations(language).then(setTranslations);
  }, [language]);

  // 切换语言
  const setLanguage = useCallback(async (lang: Language) => {
    localStorage.setItem("app-language", lang);
    setLanguageState(lang);
    const newTranslations = await loadTranslations(lang);
    setTranslations(newTranslations);

    // 重新加载页面以应用新语言
    if (window.location.pathname !== "/") {
      window.location.reload();
    }
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
