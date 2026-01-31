// useShortcuts - 快捷键事件监听和处理

import { useEffect } from "react";

export interface ShortcutHandlers {
  onRefresh?: () => void;
  onPublish?: () => void;
  onOpenSettings?: () => void;
}

/**
 * 快捷键管理 Hook
 * 监听全局快捷键事件并触发相应的处理函数
 * 注意：当前快捷键已在后端注册，事件监听功能待实现
 */
export function useShortcuts(handlers: ShortcutHandlers) {
  useEffect(() => {
    if (window.__TAURI__) {
      const { listen } = window.__TAURI__.event;

      const unlisteners: (() => void)[] = [];

      // 监听刷新快捷键
      if (handlers.onRefresh) {
        listen('global-shortcut-cmd-r', () => {
          console.log('Refresh shortcut triggered');
          handlers.onRefresh?.();
        }).then((unlisten) => {
          unlisteners.push(unlisten);
        }).catch(() => {
          // 事件可能尚未实现，忽略错误
        });
      }

      // 监听发布快捷键
      if (handlers.onPublish) {
        listen('global-shortcut-cmd-p', () => {
          console.log('Publish shortcut triggered');
          handlers.onPublish?.();
        }).then((unlisten) => {
          unlisteners.push(unlisten);
        }).catch(() => {
          // 事件可能尚未实现，忽略错误
        });
      }

      // 监听设置快捷键
      if (handlers.onOpenSettings) {
        listen('global-shortcut-cmd-comma', () => {
          console.log('Settings shortcut triggered');
          handlers.onOpenSettings?.();
        }).then((unlisten) => {
          unlisteners.push(unlisten);
        }).catch(() => {
          // 事件可能尚未实现，忽略错误
        });
      }

      // 清理函数
      return () => {
        unlisteners.forEach((unlisten) => unlisten());
      };
    }
  }, [handlers]);
}

// 为 window 添加 __TAURI__ 类型声明
declare global {
  interface Window {
    __TAURI__?: {
      event: {
        listen: (event: string, handler: () => void) => Promise<() => void>;
      };
    };
  }
}
