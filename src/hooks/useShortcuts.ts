import { useEffect, useRef } from "react";
import { isMacPlatform } from "@/lib/platform";

export interface ShortcutHandlers {
  onRefresh?: () => void;
  onPublish?: () => void;
  onOpenSettings?: () => void;
}

// 窗口内快捷键（Cmd/Ctrl + 键）：仅在 OnePublish 窗口聚焦时生效，不抢占其他应用的按键。
const SHORTCUT_KEYS = new Map<string, keyof ShortcutHandlers>([
  ["r", "onRefresh"],
  ["p", "onPublish"],
  [",", "onOpenSettings"],
]);

function hasOnlyPrimaryModifier(event: KeyboardEvent, isMac: boolean) {
  if (event.altKey || event.shiftKey) {
    return false;
  }
  return isMac
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

export function useShortcuts(handlers: ShortcutHandlers) {
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    const isMac = isMacPlatform();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || !hasOnlyPrimaryModifier(event, isMac)) {
        return;
      }

      const handlerName = SHORTCUT_KEYS.get(event.key.toLowerCase());
      if (!handlerName) {
        return;
      }

      // 屏蔽 webview 默认行为（Ctrl+R 重新加载、Ctrl+P 打印）；长按时不重复触发。
      event.preventDefault();
      if (!event.repeat) {
        handlersRef.current[handlerName]?.();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);
}
