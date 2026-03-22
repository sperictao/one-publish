// useShortcuts - 快捷键事件监听和处理

import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface ShortcutHandlers {
  onRefresh?: () => void;
  onPublish?: () => void;
  onOpenSettings?: () => void;
}

/**
 * 快捷键管理 Hook
 * 监听全局快捷键事件并触发相应的处理函数
 */
export function useShortcuts(handlers: ShortcutHandlers) {
  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    const unlisteners: (() => void)[] = [];

    // 监听刷新快捷键
    if (handlers.onRefresh) {
      listen("shortcut-refresh", () => {
        console.log("Refresh shortcut triggered");
        handlers.onRefresh?.();
      })
        .then((unlisten) => {
          unlisteners.push(unlisten);
        })
        .catch((err) => {
          console.error("Failed to listen for refresh shortcut:", err);
        });
    }

    // 监听发布快捷键
    if (handlers.onPublish) {
      listen("shortcut-publish", () => {
        console.log("Publish shortcut triggered");
        handlers.onPublish?.();
      })
        .then((unlisten) => {
          unlisteners.push(unlisten);
        })
        .catch((err) => {
          console.error("Failed to listen for publish shortcut:", err);
        });
    }

    // 监听设置快捷键
    if (handlers.onOpenSettings) {
      listen("shortcut-settings", () => {
        console.log("Settings shortcut triggered");
        handlers.onOpenSettings?.();
      })
        .then((unlisten) => {
          unlisteners.push(unlisten);
        })
        .catch((err) => {
          console.error("Failed to listen for settings shortcut:", err);
        });
    }

    return () => {
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [handlers]);
}
