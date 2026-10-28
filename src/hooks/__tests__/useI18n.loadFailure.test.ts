import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// 强制 zh 翻译块加载失败：模块解析即抛错，模拟动态 import 拒绝。
vi.mock("@/i18n/zh.json", () => {
  throw new Error("simulated chunk load failure");
});
vi.mock("@/i18n/en.json", () => ({ default: {} }));

import { useI18n } from "../useI18n";

describe("useI18n translation load failure", () => {
  it("logs the failure and keeps key-fallback instead of an unhandled rejection", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.setItem("app-language", "zh");

    const { result } = renderHook(() => useI18n());

    await waitFor(() =>
      expect(warnSpy).toHaveBeenCalledWith("failed to load translations", {
        language: "zh",
        error: expect.any(Error),
      })
    );
    expect(result.current.t("settings.title")).toBe("settings.title");
    warnSpy.mockRestore();
  });
});
