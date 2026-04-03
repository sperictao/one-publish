import { useEffect, useRef } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface ShortcutHandlers {
  onRefresh?: () => void;
  onPublish?: () => void;
  onOpenSettings?: () => void;
}

const SHORTCUT_EVENTS = [
  {
    event: "shortcut-refresh",
    getHandler: (handlers: ShortcutHandlers) => handlers.onRefresh,
  },
  {
    event: "shortcut-publish",
    getHandler: (handlers: ShortcutHandlers) => handlers.onPublish,
  },
  {
    event: "shortcut-settings",
    getHandler: (handlers: ShortcutHandlers) => handlers.onOpenSettings,
  },
] as const;

export function useShortcuts(handlers: ShortcutHandlers) {
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let disposed = false;
    const unlisteners: Array<() => void> = [];

    const registerListeners = async () => {
      try {
        const registered = await Promise.all(
          SHORTCUT_EVENTS.map(async ({ event, getHandler }) =>
            listen(event, () => {
              getHandler(handlersRef.current)?.();
            })
          )
        );

        if (disposed) {
          registered.forEach((unlisten) => unlisten());
          return;
        }

        unlisteners.push(...registered);
      } catch (error) {
        console.error("Failed to register shortcut listeners:", error);
      }
    };

    void registerListeners();

    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);
}
