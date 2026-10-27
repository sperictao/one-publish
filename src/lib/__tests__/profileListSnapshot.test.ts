import { describe, expect, it } from "vitest";

import {
  buildCopiedProfileName,
  createProfileListSnapshot,
  EMPTY_PROFILE_LIST_SNAPSHOT,
} from "@/lib/profileListSnapshot";
import type { ConfigProfile } from "@/lib/store/types";

function makeProfile(name: string): ConfigProfile {
  return { name } as unknown as ConfigProfile;
}

describe("createProfileListSnapshot", () => {
  it("内容不变时沿用既有 revision", () => {
    const first = createProfileListSnapshot([makeProfile("a")]);
    const second = createProfileListSnapshot([makeProfile("a")], first);

    expect(second.revision).toBe(first.revision);
  });

  it("内容变化时递增 revision，空基线保持 0", () => {
    const first = createProfileListSnapshot([makeProfile("a")]);
    const changed = createProfileListSnapshot([makeProfile("b")], first);

    expect(changed.revision).toBe(first.revision + 1);
    expect(
      createProfileListSnapshot([], EMPTY_PROFILE_LIST_SNAPSHOT).revision
    ).toBe(0);
    expect(
      createProfileListSnapshot([], {
        profiles: [],
        revision: 0,
        fingerprint: "stale",
      }).revision
    ).toBe(0);
  });
});

describe("buildCopiedProfileName", () => {
  it("基名未被占用时直接返回", () => {
    expect(buildCopiedProfileName("Release", new Set(["other"]))).toBe(
      "Release-copy"
    );
  });

  it("基名占用时递增后缀直到唯一", () => {
    expect(
      buildCopiedProfileName(
        "Release",
        new Set(["Release-copy", "Release-copy2", "Release-copy3"])
      )
    ).toBe("Release-copy4");
  });

  it("源名为空时回落到 Profile 前缀", () => {
    expect(buildCopiedProfileName("   ", new Set())).toBe("Profile-copy");
  });
});
