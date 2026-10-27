import { describe, expect, it } from "vitest";

import {
  hasSameProfileOrder,
  hasSameStringOrder,
} from "@/components/layout/publishConfigPanel/listOrderComparisons";
import type { ConfigProfile } from "@/lib/store/types";

function makeProfile(name: string, profileGroup?: string): ConfigProfile {
  return {
    name,
    profileGroup,
  } as unknown as ConfigProfile;
}

describe("hasSameStringOrder", () => {
  it("长度或元素不一致时返回 false", () => {
    expect(hasSameStringOrder(["a", "b"], ["a"])).toBe(false);
    expect(hasSameStringOrder(["a", "b"], ["b", "a"])).toBe(false);
    expect(hasSameStringOrder(["a", "b"], ["a", "b"])).toBe(true);
  });
});

describe("hasSameProfileOrder", () => {
  it("长度不同或名称顺序不同时返回 false", () => {
    const left = [makeProfile("a"), makeProfile("b")];

    expect(hasSameProfileOrder(left, [makeProfile("a")])).toBe(false);
    expect(
      hasSameProfileOrder(left, [makeProfile("b"), makeProfile("a")])
    ).toBe(false);
    expect(
      hasSameProfileOrder(left, [makeProfile("a"), makeProfile("b")])
    ).toBe(true);
  });

  it("分组差异按归一化后的空串比较", () => {
    const ungrouped = [makeProfile("a")];
    const emptyGroup = [makeProfile("a", "")];
    const grouped = [makeProfile("a", "core")];

    expect(hasSameProfileOrder(ungrouped, emptyGroup)).toBe(true);
    expect(hasSameProfileOrder(grouped, ungrouped)).toBe(false);
    expect(hasSameProfileOrder(grouped, [makeProfile("a", "core")])).toBe(true);
  });
});
