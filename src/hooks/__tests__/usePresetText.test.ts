import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";

import { usePresetText } from "@/hooks/usePresetText";

describe("usePresetText", () => {
  it("returns localized preset text when translations are provided", () => {
    const { result } = renderHook(() =>
      usePresetText({
        releaseFd: "自定义 Release",
        releaseFdDesc: "自定义描述",
      })
    );

    expect(result.current.getPresetText("release-fd", "fb", "fb desc")).toEqual(
      {
        name: "自定义 Release",
        description: "自定义描述",
      }
    );
  });

  it("falls back to built-in copy for missing translation keys", () => {
    const { result } = renderHook(() => usePresetText({}));

    expect(result.current.getPresetText("debug-win-x64", "fb", "fb").name).toBe(
      "Debug - Windows x64"
    );
    expect(
      result.current.getPresetText("release-osx-arm64", "fb", "fb").description
    ).toBe("Apple Silicon");
  });

  it("getPresetText returns preset text for known ids", () => {
    const { result } = renderHook(() => usePresetText({}));

    expect(
      result.current.getPresetText("release-linux-x64", "fallback", "desc")
    ).toEqual({
      name: "Release - Linux x64",
      description: "自包含部署",
    });
  });

  it("getPresetText falls back for unknown preset ids", () => {
    const { result } = renderHook(() => usePresetText({}));

    expect(
      result.current.getPresetText("custom-preset", "My Config", "desc")
    ).toEqual({ name: "My Config", description: "desc" });
  });

  it("rebuilds the map when translations change", () => {
    const translations = { releaseFd: "第一版" };
    const { result, rerender } = renderHook(({ t }) => usePresetText(t), {
      initialProps: { t: translations },
    });

    expect(result.current.getPresetText("release-fd", "fb", "fb").name).toBe(
      "第一版"
    );

    rerender({ t: { releaseFd: "第二版" } });

    expect(result.current.getPresetText("release-fd", "fb", "fb").name).toBe(
      "第二版"
    );
  });
});
