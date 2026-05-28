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
  accentFocus: string;
  sidebarSelectedBg: string;
  sidebarSelectedText: string;
  cardSelectedBorder: string;
}

export const ACCENT_COLORS: Record<AccentColor, { light: AccentColorToken; dark: AccentColorToken }> = {
  blue: {
    light: {
      accent: "#0066cc",
      accentFocus: "#0071e3",
      sidebarSelectedBg: "rgba(0, 102, 204, 0.08)",
      sidebarSelectedText: "#0066cc",
      cardSelectedBorder: "rgba(0, 102, 204, 0.4)",
    },
    dark: {
      accent: "#2997ff",
      accentFocus: "#2997ff",
      sidebarSelectedBg: "rgba(41, 151, 255, 0.16)",
      sidebarSelectedText: "#2997ff",
      cardSelectedBorder: "rgba(41, 151, 255, 0.6)",
    },
  },
  brand: {
    light: {
      accent: "#2462db",
      accentFocus: "#1f54bd",
      sidebarSelectedBg: "rgba(36, 98, 219, 0.08)",
      sidebarSelectedText: "#2462db",
      cardSelectedBorder: "rgba(36, 98, 219, 0.4)",
    },
    dark: {
      accent: "#4983de",
      accentFocus: "#5d93e6",
      sidebarSelectedBg: "rgba(73, 131, 222, 0.16)",
      sidebarSelectedText: "#4983de",
      cardSelectedBorder: "rgba(73, 131, 222, 0.6)",
    },
  },
  purple: {
    light: {
      accent: "#862e9c",
      accentFocus: "#9c36b5",
      sidebarSelectedBg: "rgba(134, 46, 156, 0.08)",
      sidebarSelectedText: "#862e9c",
      cardSelectedBorder: "rgba(134, 46, 156, 0.4)",
    },
    dark: {
      accent: "#d946ef",
      accentFocus: "#e879f9",
      sidebarSelectedBg: "rgba(217, 70, 239, 0.16)",
      sidebarSelectedText: "#d946ef",
      cardSelectedBorder: "rgba(217, 70, 239, 0.6)",
    },
  },
  pink: {
    light: {
      accent: "#d6336c",
      accentFocus: "#e64980",
      sidebarSelectedBg: "rgba(214, 51, 108, 0.08)",
      sidebarSelectedText: "#d6336c",
      cardSelectedBorder: "rgba(214, 51, 108, 0.4)",
    },
    dark: {
      accent: "#f472b6",
      accentFocus: "#f472b6",
      sidebarSelectedBg: "rgba(244, 114, 182, 0.16)",
      sidebarSelectedText: "#f472b6",
      cardSelectedBorder: "rgba(244, 114, 182, 0.6)",
    },
  },
  red: {
    light: {
      accent: "#e03131",
      accentFocus: "#f03e3e",
      sidebarSelectedBg: "rgba(224, 49, 49, 0.08)",
      sidebarSelectedText: "#e03131",
      cardSelectedBorder: "rgba(224, 49, 49, 0.4)",
    },
    dark: {
      accent: "#ff453a",
      accentFocus: "#ff453a",
      sidebarSelectedBg: "rgba(255, 69, 58, 0.16)",
      sidebarSelectedText: "#ff453a",
      cardSelectedBorder: "rgba(255, 69, 58, 0.6)",
    },
  },
  orange: {
    light: {
      accent: "#e8590c",
      accentFocus: "#f76707",
      sidebarSelectedBg: "rgba(232, 89, 12, 0.08)",
      sidebarSelectedText: "#e8590c",
      cardSelectedBorder: "rgba(232, 89, 12, 0.4)",
    },
    dark: {
      accent: "#ff9f0a",
      accentFocus: "#ff9f0a",
      sidebarSelectedBg: "rgba(255, 159, 10, 0.16)",
      sidebarSelectedText: "#ff9f0a",
      cardSelectedBorder: "rgba(255, 159, 10, 0.6)",
    },
  },
  yellow: {
    light: {
      accent: "#f59f00",
      accentFocus: "#fab005",
      sidebarSelectedBg: "rgba(245, 159, 0, 0.08)",
      sidebarSelectedText: "#f59f00",
      cardSelectedBorder: "rgba(245, 159, 0, 0.4)",
    },
    dark: {
      accent: "#ffd60a",
      accentFocus: "#ffd60a",
      sidebarSelectedBg: "rgba(255, 214, 10, 0.16)",
      sidebarSelectedText: "#ffd60a",
      cardSelectedBorder: "rgba(255, 214, 10, 0.6)",
    },
  },
  green: {
    light: {
      accent: "#2f9e44",
      accentFocus: "#37b24d",
      sidebarSelectedBg: "rgba(47, 158, 68, 0.08)",
      sidebarSelectedText: "#2f9e44",
      cardSelectedBorder: "rgba(47, 158, 68, 0.4)",
    },
    dark: {
      accent: "#30d158",
      accentFocus: "#30d158",
      sidebarSelectedBg: "rgba(48, 209, 88, 0.16)",
      sidebarSelectedText: "#30d158",
      cardSelectedBorder: "rgba(48, 209, 88, 0.6)",
    },
  },
  gray: {
    light: {
      accent: "#495057",
      accentFocus: "#343a40",
      sidebarSelectedBg: "rgba(73, 80, 87, 0.08)",
      sidebarSelectedText: "#495057",
      cardSelectedBorder: "rgba(73, 80, 87, 0.4)",
    },
    dark: {
      accent: "#98989d",
      accentFocus: "#98989d",
      sidebarSelectedBg: "rgba(152, 152, 157, 0.16)",
      sidebarSelectedText: "#98989d",
      cardSelectedBorder: "rgba(152, 152, 157, 0.6)",
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
