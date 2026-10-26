import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import { isMacPlatform } from "@/lib/platform";
import { exportPreflightReport } from "@/lib/preflight";
import { showSystemNotification } from "@/lib/systemNotification";

const originalNavigator = globalThis.navigator;

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", {
    value: originalNavigator,
    configurable: true,
  });
});

describe("isMacPlatform", () => {
  function stubNavigator(ua: string, platform: string) {
    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: ua, platform },
      configurable: true,
    });
  }

  it("detects mac via userAgent or platform", () => {
    stubNavigator("Mozilla/5.0 (Macintosh; Intel Mac OS X)", "");
    expect(isMacPlatform()).toBe(true);

    stubNavigator("Mozilla/5.0", "MacIntel");
    expect(isMacPlatform()).toBe(true);

    stubNavigator("Mozilla/5.0 (X11; Linux x86_64)", "Linux x86_64");
    expect(isMacPlatform()).toBe(false);
  });
});

describe("exportPreflightReport", () => {
  it("invokes the export command with filePath and report", async () => {
    invokeMock.mockResolvedValue("/out/report.md");
    const report = { generatedAt: "t", checklist: [] };

    await expect(
      exportPreflightReport({
        filePath: "/out/report.md",
        report: report as never,
      })
    ).resolves.toBe("/out/report.md");

    expect(invokeMock).toHaveBeenCalledWith("export_preflight_report", {
      filePath: "/out/report.md",
      report,
    });
  });
});

describe("showSystemNotification", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("rejects blank titles without invoking", async () => {
    await expect(showSystemNotification({ title: "  " })).resolves.toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("trims title/body and coerces empty body to null", async () => {
    invokeMock.mockResolvedValue(true);

    await expect(
      showSystemNotification({ title: "  done  ", body: "  " })
    ).resolves.toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("show_system_notification", {
      title: "done",
      body: null,
    });
  });

  it("swallows invoke failures into false", async () => {
    invokeMock.mockRejectedValue(new Error("denied"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(showSystemNotification({ title: "done" })).resolves.toBe(
      false
    );
    errorSpy.mockRestore();
  });
});
