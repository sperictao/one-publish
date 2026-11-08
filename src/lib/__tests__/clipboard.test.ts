import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { copyTextToClipboard } from "@/lib/clipboard";

const originalClipboard = navigator.clipboard;
const execCommandMock = vi.fn<(command: string) => boolean>(() => true);

function stubClipboard(clipboard: unknown) {
  Object.defineProperty(navigator, "clipboard", {
    value: clipboard,
    configurable: true,
    writable: true,
  });
}

describe("copyTextToClipboard", () => {
  beforeEach(() => {
    execCommandMock.mockClear().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      value: execCommandMock,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    stubClipboard(originalClipboard);
  });

  it("优先走 navigator.clipboard.writeText", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });

    await copyTextToClipboard("hello");

    expect(writeText).toHaveBeenCalledWith("hello");
    expect(execCommandMock).not.toHaveBeenCalled();
  });

  it("clipboard API 缺失时退回 execCommand", async () => {
    stubClipboard(undefined);

    await copyTextToClipboard("hello");

    expect(execCommandMock).toHaveBeenCalledWith("copy");
  });

  it("writeText 被拒绝时退回 execCommand", async () => {
    const writeText = vi
      .fn()
      .mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    stubClipboard({ writeText });

    await copyTextToClipboard("hello");

    expect(execCommandMock).toHaveBeenCalledWith("copy");
  });

  it("clipboard 缺失且 execCommand 失败时 reject", async () => {
    stubClipboard(undefined);
    execCommandMock.mockReturnValue(false);

    await expect(copyTextToClipboard("hello")).rejects.toThrow("copy failed");
  });

  it("writeText 与 execCommand 都失败时保留原始错误便于诊断", async () => {
    const writeText = vi
      .fn()
      .mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    stubClipboard({ writeText });
    execCommandMock.mockReturnValue(false);

    await expect(copyTextToClipboard("hello")).rejects.toThrow("denied");
  });
});
