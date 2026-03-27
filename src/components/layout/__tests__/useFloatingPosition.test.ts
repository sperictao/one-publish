import { describe, expect, it } from "vitest";
import { resolvePointerFollowTopBounds } from "@/components/layout/useFloatingPosition";

describe("resolvePointerFollowTopBounds", () => {
  it("返回真实仓库行的上下边界，忽略空白区", () => {
    const bounds = resolvePointerFollowTopBounds([
      { offsetTop: 24 },
      null,
      { offsetTop: 96 },
      { offsetTop: 168 },
    ]);

    expect(bounds).toEqual({ minTop: 24, maxTop: 168 });
  });

  it("没有任何仓库行时返回 null", () => {
    expect(resolvePointerFollowTopBounds([null, undefined])).toBeNull();
  });
});
