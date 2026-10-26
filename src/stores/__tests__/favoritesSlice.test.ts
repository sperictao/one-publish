import { beforeEach, describe, expect, it } from "vitest";
import { create } from "zustand";

import {
  createFavoritesSlice,
  type FavoritesSlice,
} from "@/stores/favoritesSlice";

const STORAGE_KEY = "one-publish:favoriteConfigs";

interface TestStore extends FavoritesSlice {
  selectedRepoId: string | null;
  pushed: Array<{ key: string; repoId: string | null }>;
  replaced: Array<{
    previousKey: string;
    nextKey: string;
    repoId: string | null;
  }>;
  pushRecentPublishConfig: (key: string, repoId?: string | null) => void;
  replaceRecentPublishConfigKey: (
    previousKey: string,
    nextKey: string,
    repoId?: string | null
  ) => void;
  setSelectedRepoId: (id: string | null) => void;
}

function createTestStore(): ReturnType<typeof createStore> {
  function createStore() {
    return create<TestStore>()((...args) => {
      const [set] = args;
      return {
        selectedRepoId: "repo-1",
        pushed: [],
        replaced: [],
        pushRecentPublishConfig: (key, repoId) => {
          set((state) => ({
            pushed: [...state.pushed, { key, repoId: repoId ?? null }],
          }));
        },
        replaceRecentPublishConfigKey: (previousKey, nextKey, repoId) => {
          set((state) => ({
            replaced: [
              ...state.replaced,
              { previousKey, nextKey, repoId: repoId ?? null },
            ],
          }));
        },
        setSelectedRepoId: (id) => set({ selectedRepoId: id }),
        ...createFavoritesSlice(
          ...(args as unknown as Parameters<typeof createFavoritesSlice>)
        ),
      };
    });
  }
  return createStore();
}

beforeEach(() => {
  localStorage.clear();
});

describe("toggleFavoriteConfig", () => {
  it("adds a config key to the selected repo scope and persists it", () => {
    const store = createTestStore();

    store.getState().toggleFavoriteConfig("preset:beta");

    expect(store.getState().favoriteConfigKeysByRepo).toEqual({
      "repo-1": ["preset:beta"],
    });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")).toEqual({
      "repo-1": ["preset:beta"],
    });
  });

  it("removes the key on a second toggle and does not push recent entries", () => {
    const store = createTestStore();
    store.getState().toggleFavoriteConfig("preset:beta");
    const pushedAfterAdd = store.getState().pushed.length;

    store.getState().toggleFavoriteConfig("preset:beta");

    expect(store.getState().favoriteConfigKeysByRepo["repo-1"]).toEqual([]);
    expect(store.getState().pushed.length).toBe(pushedAfterAdd);
  });

  it("pushes a recent publish config only when favoriting", () => {
    const store = createTestStore();

    store.getState().toggleFavoriteConfig("preset:beta");

    expect(store.getState().pushed).toEqual([
      { key: "preset:beta", repoId: "repo-1" },
    ]);
  });

  it("moves a re-favorited key to the front of the scope", () => {
    const store = createTestStore();
    store.getState().toggleFavoriteConfig("a");
    store.getState().toggleFavoriteConfig("b");

    store.getState().toggleFavoriteConfig("a");
    store.getState().toggleFavoriteConfig("a");

    expect(store.getState().favoriteConfigKeysByRepo["repo-1"]).toEqual([
      "a",
      "b",
    ]);
  });

  it("is a no-op when no repository can be resolved", () => {
    const store = createTestStore();
    store.getState().setSelectedRepoId(null);

    store.getState().toggleFavoriteConfig("preset:beta");

    expect(store.getState().favoriteConfigKeysByRepo).toEqual({});
    expect(store.getState().pushed).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("uses an explicit repoId over the selected repository", () => {
    const store = createTestStore();

    store.getState().toggleFavoriteConfig("preset:beta", "repo-9");

    expect(store.getState().favoriteConfigKeysByRepo).toEqual({
      "repo-9": ["preset:beta"],
    });
    expect(store.getState().pushed).toEqual([
      { key: "preset:beta", repoId: "repo-9" },
    ]);
  });
});

describe("replaceScopedConfigKey", () => {
  it("renames a favorite key inside the scope and persists", () => {
    const store = createTestStore();
    store.getState().toggleFavoriteConfig("old-key");
    store.getState().toggleFavoriteConfig("other");

    store.getState().replaceScopedConfigKey("old-key", "new-key");

    expect(store.getState().favoriteConfigKeysByRepo["repo-1"]).toEqual([
      "other",
      "new-key",
    ]);
    expect(
      JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")["repo-1"]
    ).toEqual(["other", "new-key"]);
    expect(store.getState().replaced).toEqual([
      { previousKey: "old-key", nextKey: "new-key", repoId: "repo-1" },
    ]);
  });

  it("deduplicates when the rename collides with an existing key", () => {
    const store = createTestStore();
    store.getState().toggleFavoriteConfig("dup");
    store.getState().toggleFavoriteConfig("old-key");

    store.getState().replaceScopedConfigKey("old-key", "dup");

    expect(store.getState().favoriteConfigKeysByRepo["repo-1"]).toEqual([
      "dup",
    ]);
  });

  it("still delegates to recents but keeps favorites when the key is absent", () => {
    const store = createTestStore();
    store.getState().toggleFavoriteConfig("other");

    store.getState().replaceScopedConfigKey("missing", "new-key");

    expect(store.getState().replaced).toEqual([
      { previousKey: "missing", nextKey: "new-key", repoId: "repo-1" },
    ]);
    expect(store.getState().favoriteConfigKeysByRepo["repo-1"]).toEqual([
      "other",
    ]);
  });

  it("is a no-op for empty keys or missing scope", () => {
    const store = createTestStore();
    store.getState().toggleFavoriteConfig("a");

    store.getState().replaceScopedConfigKey("", "new-key");
    store.getState().replaceScopedConfigKey("a", "");
    store.getState().setSelectedRepoId(null);
    store.getState().replaceScopedConfigKey("a", "b");

    expect(store.getState().favoriteConfigKeysByRepo["repo-1"]).toEqual(["a"]);
    expect(store.getState().replaced.length).toBe(0);
  });
});
