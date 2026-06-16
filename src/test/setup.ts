import "@testing-library/jest-dom";

// Vitest needs React's development build so that testing-library `act()` is
// available. Some environments export `NODE_ENV=production`; force test mode
// before React is imported by any spec.
process.env.NODE_ENV = "development";

// jsdom 在部分 node/jsdom 版本组合下（opaque origin）不暴露 localStorage，
// 这里提供一个最小内存实现，保证依赖 localStorage 的代码在测试中可运行。
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => {
      store.clear();
    },
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };

  Object.defineProperty(globalThis, "localStorage", {
    value: memoryStorage,
    configurable: true,
    writable: true,
  });
}
