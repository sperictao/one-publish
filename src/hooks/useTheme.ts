// useTheme - 主题管理 Hook
// 处理亮色/暗色主题切换，支持跟随系统设置

import { useEffect } from "react";

export type Theme = "light" | "dark" | "auto";

/**
 * 应用主题到 DOM
 */
function applyTheme(theme: Theme) {
  const root = document.documentElement;

  // 移除所有主题类
  root.classList.remove("light", "dark");

  if (theme === "auto") {
    // 跟随系统设置
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.classList.add(systemDark ? "dark" : "light");
  } else {
    // 强制使用指定主题
    root.classList.add(theme);
  }
}

/**
 * 主题管理 Hook
 */
export function useTheme(theme: Theme) {
  // 应用主题
  useEffect(() => {
    applyTheme(theme);

    // 如果是 auto 模式，监听系统主题变化
    let mediaQuery: MediaQueryList | null = null;

    if (theme === "auto") {
      mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

      const handleSystemThemeChange = (e: MediaQueryListEvent) => {
        applyTheme(e.matches ? "dark" : "light");
      };

      // 现代浏览器
      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener("change", handleSystemThemeChange);
      } else {
        // 旧版浏览器兼容
        mediaQuery.addListener(handleSystemThemeChange);
      }

      return () => {
        if (mediaQuery) {
          if (mediaQuery.removeEventListener) {
            mediaQuery.removeEventListener("change", handleSystemThemeChange);
          } else {
            mediaQuery.removeListener(handleSystemThemeChange);
          }
        }
      };
    }
  }, [theme]);
}
