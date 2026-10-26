import { describe, expect, it } from "vitest";

import { toSpecValue } from "@/types/parameters";

describe("toSpecValue", () => {
  it("passes primitives through unchanged", () => {
    expect(toSpecValue(null)).toBeNull();
    expect(toSpecValue("Release")).toBe("Release");
    expect(toSpecValue(42)).toBe(42);
    expect(toSpecValue(true)).toBe(true);
  });

  it("normalizes array items recursively", () => {
    expect(toSpecValue(["a", 1, null])).toEqual(["a", 1, null]);
  });

  it("normalizes object values recursively", () => {
    expect(toSpecValue({ configuration: "Debug", framework: null })).toEqual({
      configuration: "Debug",
      framework: null,
    });
  });

  it("handles deeply nested mixed structures", () => {
    const input = {
      targets: ["x64", { arch: "arm64", flags: ["--neon", null] }],
      nested: { deep: { value: 7 } },
    };

    expect(toSpecValue(input)).toEqual({
      targets: ["x64", { arch: "arm64", flags: ["--neon", null] }],
      nested: { deep: { value: 7 } },
    });
  });

  it("preserves empty containers", () => {
    expect(toSpecValue([])).toEqual([]);
    expect(toSpecValue({})).toEqual({});
  });
});
