import { afterEach, describe, expect, it, vi } from "vitest";

import { emit, on } from "@/lib/eventBus";

describe("eventBus", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("同步 handler 抛错被兜住，其余 handler 仍被调用", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const goodHandler = vi.fn();
    const badHandler = () => {
      throw new Error("boom");
    };

    const offBad = on("test:sync", badHandler);
    const offGood = on("test:sync", goodHandler);
    try {
      expect(() => emit("test:sync", { value: 1 })).not.toThrow();
      expect(goodHandler).toHaveBeenCalledWith({ value: 1 });
      expect(errorSpy).toHaveBeenCalledWith(
        '[eventBus] handler for "test:sync" threw:',
        expect.any(Error)
      );
    } finally {
      offBad();
      offGood();
    }
  });

  it("异步 handler 的 rejection 被兜住，无 unhandled rejection", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const goodHandler = vi.fn();
    const badHandler = async () => {
      await Promise.resolve();
      throw new Error("async boom");
    };

    const offBad = on("test:async", badHandler);
    const offGood = on("test:async", goodHandler);
    try {
      expect(() => emit("test:async", { value: 2 })).not.toThrow();
      expect(goodHandler).toHaveBeenCalledWith({ value: 2 });
      // 等两轮 microtask，让 async handler 的 rejection 落到 .catch 上
      await Promise.resolve();
      await Promise.resolve();
      await vi.waitFor(() => {
        expect(errorSpy).toHaveBeenCalledWith(
          '[eventBus] async handler for "test:async" rejected:',
          expect.any(Error)
        );
      });
      // vitest 默认会把 unhandled rejection 判为失败——测试通过即证明已收容
    } finally {
      offBad();
      offGood();
    }
  });

  it("返回非 promise 值的 handler 正常执行", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = vi.fn((payload: { value: number }) => {
      void payload;
      return 42;
    });

    const offHandler = on("test:plain", handler);
    try {
      emit("test:plain", { value: 3 });
      expect(handler).toHaveBeenCalledWith({ value: 3 });
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      offHandler();
    }
  });

  it("无订阅者的事件直接返回", () => {
    expect(() => emit("test:no-listeners", { value: 1 })).not.toThrow();
  });

  it("过期的退订闭包不会移除后来新建的同名事件订阅", () => {
    const laterHandler = vi.fn();
    const offFirst = on("test:stale-unsubscribe", vi.fn());
    offFirst();

    // 首个订阅集合清空后，同名事件的下一次订阅会新建一个集合。
    const offLater = on("test:stale-unsubscribe", laterHandler);
    // 模拟 React StrictMode / effect cleanup 重复调用上一代退订闭包。
    offFirst();

    emit("test:stale-unsubscribe", { value: 4 });
    expect(laterHandler).toHaveBeenCalledOnce();
    expect(laterHandler).toHaveBeenCalledWith({ value: 4 });

    offLater();
  });

  it("过期退订闭包不会影响同一代里仍然存活的其他订阅者", () => {
    const survivor = vi.fn();
    const offRemoved = on("test:stale-unsubscribe-sibling", vi.fn());
    const offSurvivor = on("test:stale-unsubscribe-sibling", survivor);

    offRemoved();
    offRemoved();

    emit("test:stale-unsubscribe-sibling", { value: 5 });
    expect(survivor).toHaveBeenCalledOnce();
    expect(survivor).toHaveBeenCalledWith({ value: 5 });

    offSurvivor();
  });
});
