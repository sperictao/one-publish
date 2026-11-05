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
      const result = handler(payload) as unknown;
      if (result instanceof Promise) {
        result.catch((err) =>
          console.error(
            `[eventBus] async handler for "${event}" rejected:`,
            err
          )
        );
      }
    } catch (err) {
      console.error(`[eventBus] handler for "${event}" threw:`, err);
    }
  }
}

/** 订阅事件，返回取消订阅函数。 */
export function on<T = unknown>(
  event: string,
  handler: EventHandler<T>
): () => void {
  let handlers = listeners.get(event);
  if (!handlers) {
    handlers = new Set();
    listeners.set(event, handlers);
  }
  const subscribedHandlers = handlers;
  subscribedHandlers.add(handler as EventHandler);
  return () => {
    subscribedHandlers.delete(handler as EventHandler);
    // 仅当捕获的集合仍是该事件当前注册的集合时才移除 map 条目。
    // 过期闭包（StrictMode / effect cleanup 重复调用）不得删除后来
    // 新建的同名事件订阅集合，否则新订阅者会被静默移除。
    if (
      subscribedHandlers.size === 0 &&
      listeners.get(event) === subscribedHandlers
    ) {
      listeners.delete(event);
    }
  };
}
