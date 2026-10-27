import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  listen: vi.fn(),
}));

// 按事件名保存最近注册的监听器，便于测试手动触发。
type SessionStartedPayload = { sessionId?: string };
type LogChunkPayload = { sessionId?: string; line?: string };

const listeners: Record<
  string,
  | ((event: { payload?: SessionStartedPayload | LogChunkPayload }) => void)
  | null
> = {};

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: mocks.isTauri,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

import { usePublishLogStream } from "@/features/publish/usePublishLogStream";

function emitSessionStarted(sessionId: string) {
  listeners["provider-publish-session-started"]?.({ payload: { sessionId } });
}

function emitLogChunk(sessionId: string, line: string) {
  listeners["provider-publish-log"]?.({ payload: { sessionId, line } });
}

describe("usePublishLogStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeners["provider-publish-session-started"] = null;
    listeners["provider-publish-log"] = null;
    mocks.listen.mockImplementation(
      async (
        eventName: string,
        callback: (event: {
          payload?: SessionStartedPayload | LogChunkPayload;
        }) => void
      ) => {
        listeners[eventName] = callback;
        return () => undefined;
      }
    );
  });

  it("会话开始事件锁定活动会话，迟到旧会话 chunk 被丢弃", () => {
    const { result } = renderHook(() => usePublishLogStream());

    // A 运行：session-started(A) -> chunk A1（接受）
    act(() => {
      emitSessionStarted("session-a");
    });
    act(() => {
      emitLogChunk("session-a", "first line\n");
    });
    expect(result.current.outputLog).toBe("first line\n");

    // B 运行：session-started(B) 会重置缓冲并锁存为 session-b
    act(() => {
      emitSessionStarted("session-b");
    });
    expect(result.current.outputLog).toBe("");

    // 迟到的 A 尾部 chunk 必须丢弃
    act(() => {
      emitLogChunk("session-a", "stale late chunk\n");
    });
    expect(result.current.outputLog).toBe("");

    // B 的真实输出被接受，缓冲恰为 B1
    act(() => {
      emitLogChunk("session-b", "fresh line\n");
    });
    expect(result.current.outputLog).toBe("fresh line\n");
  });

  it("未收到 session-started 的 chunk 一律丢弃", () => {
    const { result } = renderHook(() => usePublishLogStream());

    // 没有任何 session-started，直接来 chunk -> 丢弃
    act(() => {
      emitLogChunk("session-orphan", "orphan line\n");
    });
    expect(result.current.outputLog).toBe("");

    // 即使 beginLogCapture 已调用，未指定会话仍丢弃
    act(() => {
      result.current.beginLogCapture();
    });
    act(() => {
      emitLogChunk("session-orphan", "still orphan\n");
    });
    expect(result.current.outputLog).toBe("");
  });

  it("卸载发生在 listen Promise 解析之前时，仍会释放监听器", async () => {
    const dispose = vi.fn();
    let resolveListen: ((d: () => void) => void) | null = null;
    mocks.listen.mockImplementation(
      () =>
        new Promise<() => void>((resolve) => {
          resolveListen = resolve;
        })
    );

    const { unmount } = renderHook(() => usePublishLogStream());
    unmount();

    await act(async () => {
      resolveListen?.(dispose);
    });

    // 两个监听器（session-started + log）都会注册，dispose 至少被调用一次
    expect(dispose).toHaveBeenCalled();
  });

  it("超过可见上限时裁剪到尾部并对齐换行", () => {
    const { result } = renderHook(() => usePublishLogStream());

    act(() => {
      emitSessionStarted("s-1");
    });
    const oversized = "x".repeat(210_000) + "\ntail-line\n";
    act(() => {
      emitLogChunk("s-1", oversized);
    });

    expect(result.current.outputLog.length).toBeLessThan(oversized.length);
    expect(result.current.outputLog.startsWith("tail-line")).toBe(true);
  });

  it("裁剪块内无换行时保留原始尾部", () => {
    const { result } = renderHook(() => usePublishLogStream());

    act(() => {
      emitSessionStarted("s-1");
    });
    const oversized = "y".repeat(210_000);
    act(() => {
      emitLogChunk("s-1", oversized);
    });

    expect(result.current.outputLog.length).toBe(200_000);
    expect(result.current.outputLog.endsWith("y")).toBe(true);
  });

  it("空 chunk 与空 sessionId 分别被忽略", () => {
    const { result } = renderHook(() => usePublishLogStream());

    act(() => {
      emitSessionStarted("   ");
    });
    act(() => {
      emitLogChunk("", "no-session\n");
    });
    expect(result.current.outputLog).toBe("");

    act(() => {
      emitSessionStarted("s-1");
    });
    act(() => {
      emitLogChunk("s-1", "");
    });
    expect(result.current.outputLog).toBe("");
  });

  it("session-started 监听注册失败时静默降级", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let callCount = 0;
    mocks.listen.mockImplementation(async (eventName: string) => {
      callCount += 1;
      if (eventName === "provider-publish-session-started") {
        throw new Error("listen down");
      }
      listeners[eventName] = () => undefined;
      return () => undefined;
    });

    const { unmount } = renderHook(() => usePublishLogStream());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(errorSpy).toHaveBeenCalled();
    expect(callCount).toBeGreaterThan(0);
    unmount();
  });

  it("卸载早于 session-started 监听解析时释放监听器", async () => {
    const unlisten = vi.fn();
    let resolveListen: ((fn: () => void) => void) | null = null;
    mocks.listen.mockImplementation(async (eventName: string) => {
      if (eventName === "provider-publish-session-started") {
        return await new Promise<() => void>((resolve) => {
          resolveListen = resolve;
        });
      }
      return unlisten;
    });

    const { unmount } = renderHook(() => usePublishLogStream());
    await act(async () => {
      await Promise.resolve();
    });
    unmount();

    await act(async () => {
      resolveListen?.(unlisten);
      await Promise.resolve();
    });
    expect(unlisten).toHaveBeenCalled();
  });

  it("chunk 监听注册失败时静默降级", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.listen.mockImplementation(async (eventName: string) => {
      if (eventName === "provider-publish-log") {
        throw new Error("chunk listen down");
      }
      return () => undefined;
    });

    const { unmount } = renderHook(() => usePublishLogStream());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(errorSpy).toHaveBeenCalled();
    unmount();
  });
});
