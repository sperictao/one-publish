import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  listen: vi.fn(),
}));

let logListener:
  | ((event: { payload?: { sessionId?: string; line?: string } }) => void)
  | null = null;

type PublishLogEvent = {
  payload?: { sessionId?: string; line?: string };
};

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: mocks.isTauri,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

import { usePublishLogStream } from "@/features/publish/usePublishLogStream";

describe("usePublishLogStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    logListener = null;
    mocks.listen.mockImplementation(
      async (
        _eventName: string,
        callback: (event: PublishLogEvent) => void
      ) => {
        logListener = callback;
        return () => undefined;
      }
    );
  });

  it("重置捕获后会忽略旧会话日志，并只接收新的日志会话", () => {
    const { result } = renderHook(() => usePublishLogStream());

    act(() => {
      result.current.beginLogCapture();
    });

    act(() => {
      logListener?.({
        payload: {
          sessionId: "session-a",
          line: "first line\n",
        },
      });
    });

    expect(result.current.outputLog).toBe("first line\n");

    act(() => {
      result.current.resetLogCapture();
    });

    act(() => {
      logListener?.({
        payload: {
          sessionId: "session-a",
          line: "stale line\n",
        },
      });
    });

    expect(result.current.outputLog).toBe("");

    act(() => {
      result.current.beginLogCapture();
    });

    act(() => {
      logListener?.({
        payload: {
          sessionId: "session-b",
          line: "fresh line\n",
        },
      });
    });

    expect(result.current.outputLog).toBe("fresh line\n");
  });
});
