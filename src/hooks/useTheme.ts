// useTheme - 主题管理 Hook
// 处理亮色/暗色主题切换，支持跟随系统设置

import { useEffect, useState, useCallback } from "react";

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

// ── Accent Color (强调色) 支持 ──
// Geist color scales per DESIGN.md / design.dark.md. Values are HSL triplets
// (space-separated, no hsl() wrapper) so they compose with hsl(var(--settings-accent)).

export type AccentColor =
  | "blue"
  | "brand"
  | "purple"
  | "pink"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "gray";

export interface AccentColorToken {
  accent: string;
  accentHover: string;
  accentFocus: string;
  sidebarSelectedBg: string;
  sidebarSelectedText: string;
  cardSelectedBorder: string;
}

// Each entry uses Geist accent scales (700 solid fill, 800 hover).
// Light uses the sRGB hex-derived HSL; dark uses the dark-theme equivalents.
export const ACCENT_COLORS: Record<AccentColor, { light: AccentColorToken; dark: AccentColorToken }> = {
  blue: {
    light: {
      accent: "215 100% 50%",       // blue-700 #006bff
      accentHover: "217 100% 46%",  // blue-800 #0059ec
      accentFocus: "215 100% 50%",  // blue-700 focus ring
      sidebarSelectedBg: "215 100% 50%",
      sidebarSelectedText: "215 100% 50%",
      cardSelectedBorder: "215 100% 50%",
    },
    dark: {
      accent: "214 100% 50%",       // blue-700 dark #006efe
      accentHover: "216 100% 45%",  // blue-800 dark #005be7
      accentFocus: "208 100% 64%",  // blue-900 dark #47a8ff
      sidebarSelectedBg: "214 100% 50%",
      sidebarSelectedText: "214 100% 50%",
      cardSelectedBorder: "214 100% 50%",
    },
  },
  brand: {
    light: {
      accent: "215 100% 50%",       // brand = Geist blue-700
      accentHover: "217 100% 46%",
      accentFocus: "215 100% 50%",
      sidebarSelectedBg: "215 100% 50%",
      sidebarSelectedText: "215 100% 50%",
      cardSelectedBorder: "215 100% 50%",
    },
    dark: {
      accent: "214 100% 50%",
      accentHover: "216 100% 45%",
      accentFocus: "208 100% 64%",
      sidebarSelectedBg: "214 100% 50%",
      sidebarSelectedText: "214 100% 50%",
      cardSelectedBorder: "214 100% 50%",
    },
  },
  purple: {
    light: {
      accent: "279 100% 49%",       // purple-700 #a000f8
      accentHover: "278 100% 41%",  // purple-800 #8500d1
      accentFocus: "279 100% 49%",
      sidebarSelectedBg: "279 100% 49%",
      sidebarSelectedText: "279 100% 49%",
      cardSelectedBorder: "279 100% 49%",
    },
    dark: {
      accent: "274 64% 54%",        // purple-700 dark #9440d5
      accentHover: "274 62% 45%",   // purple-800 dark #7d2bba
      accentFocus: "274 64% 54%",
      sidebarSelectedBg: "274 64% 54%",
      sidebarSelectedText: "274 64% 54%",
      cardSelectedBorder: "274 64% 54%",
    },
  },
  pink: {
    light: {
      accent: "333 89% 55%",        // pink-700 #f22782
      accentHover: "333 87% 48%",   // pink-800 #e4106e
      accentFocus: "333 89% 55%",
      sidebarSelectedBg: "333 89% 55%",
      sidebarSelectedText: "333 89% 55%",
      cardSelectedBorder: "333 89% 55%",
    },
    dark: {
      accent: "334 88% 56%",        // pink-700 dark #f12b82
      accentHover: "332 100% 45%",  // pink-800 dark #e7006d
      accentFocus: "334 88% 56%",
      sidebarSelectedBg: "334 88% 56%",
      sidebarSelectedText: "334 88% 56%",
      cardSelectedBorder: "334 88% 56%",
    },
  },
  red: {
    light: {
      accent: "353 100% 46%",       // red-800 #ea001d
      accentHover: "353 100% 46%",
      accentFocus: "353 100% 46%",
      sidebarSelectedBg: "353 100% 46%",
      sidebarSelectedText: "353 100% 46%",
      cardSelectedBorder: "353 100% 46%",
    },
    dark: {
      accent: "355 89% 57%",        // red-600 dark #f32e40
      accentHover: "354 82% 49%",   // red-800 dark #e2162a
      accentFocus: "355 89% 57%",
      sidebarSelectedBg: "355 89% 57%",
      sidebarSelectedText: "355 89% 57%",
      cardSelectedBorder: "355 89% 57%",
    },
  },
  orange: {
    light: {
      accent: "41 100% 50%",        // amber-700 #ffae00
      accentHover: "35 100% 50%",   // amber-800 #ff9300
      accentFocus: "41 100% 50%",
      sidebarSelectedBg: "41 100% 50%",
      sidebarSelectedText: "41 100% 50%",
      cardSelectedBorder: "41 100% 50%",
    },
    dark: {
      accent: "41 100% 50%",        // amber-700 dark #ffae00
      accentHover: "35 100% 50%",
      accentFocus: "41 100% 50%",
      sidebarSelectedBg: "41 100% 50%",
      sidebarSelectedText: "41 100% 50%",
      cardSelectedBorder: "41 100% 50%",
    },
  },
  yellow: {
    light: {
      accent: "39 100% 50%",        // amber-600 #ffa600
      accentHover: "41 100% 50%",
      accentFocus: "39 100% 50%",
      sidebarSelectedBg: "39 100% 50%",
      sidebarSelectedText: "39 100% 50%",
      cardSelectedBorder: "39 100% 50%",
    },
    dark: {
      accent: "39 100% 46%",        // amber-600 dark #ed9a00
      accentHover: "35 100% 50%",
      accentFocus: "39 100% 46%",
      sidebarSelectedBg: "39 100% 46%",
      sidebarSelectedText: "39 100% 46%",
      cardSelectedBorder: "39 100% 46%",
    },
  },
  green: {
    light: {
      accent: "135 62% 41%",        // green-700 #28a948
      accentHover: "135 58% 36%",   // green-800 #279141
      accentFocus: "135 62% 41%",
      sidebarSelectedBg: "135 62% 41%",
      sidebarSelectedText: "135 62% 41%",
      cardSelectedBorder: "135 62% 41%",
    },
    dark: {
      accent: "140 100% 34%",       // green-700 dark #00ac3a
      accentHover: "140 100% 29%",  // green-800 dark #009432
      accentFocus: "140 100% 34%",
      sidebarSelectedBg: "140 100% 34%",
      sidebarSelectedText: "140 100% 34%",
      cardSelectedBorder: "140 100% 34%",
    },
  },
  gray: {
    light: {
      accent: "0 0% 30%",           // gray-900 #4d4d4d
      accentHover: "0 0% 9%",       // gray-1000 #171717
      accentFocus: "0 0% 9%",       // gray-1000 #171717
      sidebarSelectedBg: "0 0% 30%",
      sidebarSelectedText: "0 0% 30%",
      cardSelectedBorder: "0 0% 30%",
    },
    dark: {
      accent: "0 0% 63%",           // gray-900 dark #a0a0a0
      accentHover: "0 0% 93%",      // gray-1000 dark #ededed
      accentFocus: "0 0% 93%",
      sidebarSelectedBg: "0 0% 63%",
      sidebarSelectedText: "0 0% 63%",
      cardSelectedBorder: "0 0% 63%",
    },
  },
};

const LOCAL_STORAGE_KEY = "one-publish-accent-color";

function applyAccentVariables(color: AccentColor, isDark: boolean) {
  const root = document.documentElement;
  const token = ACCENT_COLORS[color] || ACCENT_COLORS.blue;
  const val = isDark ? token.dark : token.light;

  root.style.setProperty("--settings-accent", val.accent);
  root.style.setProperty("--settings-accent-focus", val.accentFocus);
  root.style.setProperty("--settings-sidebar-selected-bg", val.sidebarSelectedBg);
  root.style.setProperty("--settings-sidebar-selected-text", val.sidebarSelectedText);
  root.style.setProperty("--settings-card-selected-border", val.cardSelectedBorder);
  root.style.setProperty("--interactive", val.accent);
  root.style.setProperty("--interactive-hover", val.accentHover);
  root.style.setProperty("--ring", val.accentFocus);
}

export function useAccentColor() {
  const [accentColor, setAccentColorState] = useState<AccentColor>(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    return saved && saved in ACCENT_COLORS ? (saved as AccentColor) : "blue";
  });

  const setAccentColor = useCallback((color: AccentColor) => {
    localStorage.setItem(LOCAL_STORAGE_KEY, color);
    setAccentColorState(color);
  }, []);

  useEffect(() => {
    const root = document.documentElement;

    // Apply once initially
    const isDark = root.classList.contains("dark");
    applyAccentVariables(accentColor, isDark);

    // Create a MutationObserver to watch class changes
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === "class") {
          const nowDark = root.classList.contains("dark");
          applyAccentVariables(accentColor, nowDark);
        }
      });
    });

    observer.observe(root, { attributes: true, attributeFilter: ["class"] });

    return () => {
      observer.disconnect();
    };
  }, [accentColor]);

  return { accentColor, setAccentColor };
}
