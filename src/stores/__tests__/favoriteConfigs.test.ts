import { beforeEach, describe, expect, it } from "vitest";

import {
  loadFavorites,
  migrateLegacyFavorites,
  persistFavorites,
  type FavoriteConfigsByRepo,
} from "@/stores/favoriteConfigs";

const STORAGE_KEY = "one-publish:favoriteConfigs";

function seed(raw: string): void {
  localStorage.setItem(STORAGE_KEY, raw);
}

beforeEach(() => {
  localStorage.clear();
});

describe("loadFavorites", () => {
  it("returns an empty map when the storage key is missing", () => {
    expect(loadFavorites()).toEqual({});
  });

  it("wraps a legacy top-level array into the legacy scope", () => {
    seed(JSON.stringify(["a", "b"]));

    expect(loadFavorites()).toEqual({ __legacy__: ["a", "b"] });
  });

  it("filters non-string entries out of legacy arrays", () => {
    seed(JSON.stringify(["a", 1, null]));

    expect(loadFavorites()).toEqual({ __legacy__: ["a"] });
  });

  it("returns an empty map when a legacy array has no string entries", () => {
    seed(JSON.stringify([1, null, false]));

    expect(loadFavorites()).toEqual({});
  });

  it("returns a well-formed scoped map as stored", () => {
    const scoped: FavoriteConfigsByRepo = {
      "repo-1": ["userprofile:alpha", "preset:beta"],
      "repo-2": ["userprofile:gamma"],
    };
    seed(JSON.stringify(scoped));

    expect(loadFavorites()).toEqual(scoped);
  });

  it("drops scoped entries that are not non-empty string arrays", () => {
    seed(
      JSON.stringify({
        "repo-1": ["userprofile:alpha"],
        "repo-2": "not-an-array",
        "repo-3": [],
        "repo-4": [42],
      })
    );

    expect(loadFavorites()).toEqual({
      "repo-1": ["userprofile:alpha"],
    });
  });

  it("returns an empty map without throwing when the stored JSON is corrupt", () => {
    seed("{oops");

    expect(() => loadFavorites()).not.toThrow();
    expect(loadFavorites()).toEqual({});
  });

  it("returns an empty map for non-object JSON payloads", () => {
    seed("5");
    expect(loadFavorites()).toEqual({});

    seed('"str"');
    expect(loadFavorites()).toEqual({});
  });
});

describe("migrateLegacyFavorites", () => {
  it("moves legacy favorites into the target repo scope", () => {
    const next = migrateLegacyFavorites({ __legacy__: ["a"] }, "r1");

    expect(next).toEqual({ r1: ["a"] });
    expect(next).not.toHaveProperty("__legacy__");
  });

  it("returns null when the target repo already has favorites", () => {
    const current: FavoriteConfigsByRepo = {
      __legacy__: ["a"],
      r1: ["existing"],
    };

    expect(migrateLegacyFavorites(current, "r1")).toBeNull();
  });

  it("returns null when there is no legacy scope", () => {
    expect(migrateLegacyFavorites({ r1: ["a"] }, "r2")).toBeNull();
    expect(migrateLegacyFavorites({}, "r2")).toBeNull();
  });

  it("does not mutate the input map", () => {
    const current: FavoriteConfigsByRepo = {
      __legacy__: ["a"],
      r2: ["b"],
    };
    const snapshot = structuredClone(current);

    const next = migrateLegacyFavorites(current, "r1");

    expect(current).toEqual(snapshot);
    expect(next).not.toBe(current);
  });
});

describe("persistFavorites", () => {
  it("round-trips through loadFavorites", () => {
    const data: FavoriteConfigsByRepo = {
      "repo-1": ["userprofile:alpha"],
      "repo-2": ["preset:beta", "userprofile:gamma"],
    };

    persistFavorites(data);

    expect(loadFavorites()).toEqual(data);
  });
});
