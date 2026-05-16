/**
 * 轻量级事件总线 — pub/sub 模式，零外部依赖。
 *
 * 用法：
 *   import { on, emit } from "@/lib/eventBus";
 *   const unsub = on("publish:completed", (payload) => { ... });
 *   emit("publish:completed", { result, ... });
 */

type EventHandler<T = unknown> = (payload: T) => void;

const listeners = new Map<string, Set<EventHandler>>();

/** 发送事件，同步通知所有订阅者。 */
export function emit<T = unknown>(event: string, payload: T): void {
  const handlers = listeners.get(event);
  if (!handlers) return;
  for (const handler of handlers) {
    try {
      handler(payload);
    } catch (err) {
      console.error(`[eventBus] handler for "${event}" threw:`, err);
    }
  }
}

/** 订阅事件，返回取消订阅函数。 */
export function on<T = unknown>(
  event: string,
  handler: EventHandler<T>,
): () => void {
  let handlers = listeners.get(event);
  if (!handlers) {
    handlers = new Set();
    listeners.set(event, handlers);
  }
  handlers.add(handler as EventHandler);
  return () => {
    handlers?.delete(handler as EventHandler);
    if (handlers?.size === 0) {
      listeners.delete(event);
    }
  };
}

/** 取消订阅。 */
export function off<T = unknown>(
  event: string,
  handler: EventHandler<T>,
): void {
  listeners.get(event)?.delete(handler as EventHandler);
}
