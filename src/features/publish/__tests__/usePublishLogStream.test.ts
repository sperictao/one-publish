import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  MAX_CAPTURED_LOG_CHARS,
  retainCapturedLogTail,
  usePublishLogStream,
} from "@/features/publish/usePublishLogStream";

describe("retainCapturedLogTail", () => {
  it("returns null for logs under the capture limit", () => {
    expect(retainCapturedLogTail("short log\n")).toBeNull();
  });

  it("retains only the tail beyond the limit and aligns to newline", () => {
    // len=5,066,001 → tail 起点 66,001；'\n' 位于 70,000，距 tail 起点 3,999 < 4KB
    // → 截断对齐到该换行之后，仅保留 'z' 段。
    const log = `${"x".repeat(70_000)}\n${"z".repeat(4_996_000)}`;
    const retained = retainCapturedLogTail(log);

    expect(retained).not.toBeNull();
    expect(retained!.startsWith("z")).toBe(true);
    expect(retained!.length).toBe(4_996_000);
  });

  it("keeps the tail content when no newline is within the lookahead window", () => {
    // len=5,064,008 → tail 起点 64,008；'\n' 位于 74,001，距 tail 起点 9,993 > 4KB
    // → 对齐不生效，直接从边界保留完整尾部（含行中截断的 'x' 头）。
    const log = `${"x".repeat(74_001)}\n${"z".repeat(4_989_994)}final\n`;
    const retained = retainCapturedLogTail(log);

    expect(retained).not.toBeNull();
    expect(retained!.length).toBe(MAX_CAPTURED_LOG_CHARS);
    expect(retained!.endsWith("final\n")).toBe(true);
  });
});

describe("usePublishLogStream capture bounds", () => {
  it("marks oversized replacement snapshots with a truncation marker", () => {
    const { result } = renderHook(() => usePublishLogStream());
    const oversized = `${"y".repeat(MAX_CAPTURED_LOG_CHARS + 100_000)}\nkept\n`;

    act(() => {
      result.current.beginLogCapture();
      result.current.replaceCapturedOutputLog(oversized);
    });

    const snapshot = result.current.getOutputLogSnapshot();
    expect(snapshot.startsWith("[one-publish: earlier output truncated]")).toBe(
      true
    );
    expect(snapshot.endsWith("kept\n")).toBe(true);
  });

  it("keeps small snapshots unmarked", () => {
    const { result } = renderHook(() => usePublishLogStream());

    act(() => {
      result.current.beginLogCapture();
      result.current.replaceCapturedOutputLog("complete log\n");
    });

    expect(result.current.getOutputLogSnapshot()).toBe("complete log\n");
  });
});
