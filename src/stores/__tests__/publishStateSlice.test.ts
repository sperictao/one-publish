import { beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";

const apiMocks = vi.hoisted(() => ({
  updatePublishEditState: vi.fn(),
  pushRecentPublishConfig: vi.fn(),
  removeRecentPublishConfig: vi.fn(),
  replaceRecentPublishConfigKey: vi.fn(),
  reorderRecentPublishConfigs: vi.fn(),
  getAppState: vi.fn(),
}));

vi.mock("@/lib/store/api", () => apiMocks);

vi.mock("@/hooks/useI18n", () => ({
  t: (key: string) => key,
  getCurrentTranslations: () => ({}),
  useI18n: () => ({ t: (key: string) => key, translations: {} }),
}));

const toastErrorMock = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { error: toastErrorMock },
}));

import {
  createPublishStateSlice,
  type PublishStateSlice,
} from "@/stores/publishStateSlice";
import type { Repository } from "@/lib/store/types";

interface TestStore extends PublishStateSlice {
  selectedRepoId: string | null;
  repositories: Repository[];
  error: string | null;
  executionHistory: unknown[];
}

function repo(id: string, publishConfig?: unknown): Repository {
  return { id, publishConfig } as Repository;
}

function createTestStore(initial: Partial<TestStore> = {}) {
  return create<TestStore>()((...args) => ({
    selectedRepoId: "repo-1",
    repositories: [],
    error: null,
    executionHistory: [],
    ...createPublishStateSlice(
      ...(args as unknown as Parameters<typeof createPublishStateSlice>)
    ),
    ...initial,
  }));
}

/** Flush the module-level mutation queue + microtasks until settled. */
async function flushQueue() {
  for (let i = 0; i < 12; i += 1) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recent config mutations", () => {
  it("pushes a config for the selected repo and applies returned state", async () => {
    apiMocks.pushRecentPublishConfig.mockResolvedValue({
      recentRepoIds: ["repo-1"],
      recentConfigKeysByRepo: { "repo-1": ["preset:a"] },
    });
    const store = createTestStore();

    store.getState().pushRecentPublishConfig("preset:a");
    await vi.waitFor(() =>
      expect(store.getState().recentConfigKeysByRepo["repo-1"]).toEqual([
        "preset:a",
      ])
    );

    expect(apiMocks.pushRecentPublishConfig).toHaveBeenCalledWith({
      repoId: "repo-1",
      configKey: "preset:a",
    });
    expect(store.getState().recentRepoIds).toEqual(["repo-1"]);
  });

  it("prefers an explicit repoId over the selected repository", async () => {
    apiMocks.pushRecentPublishConfig.mockResolvedValue({
      recentRepoIds: ["repo-9"],
      recentConfigKeysByRepo: { "repo-9": ["k"] },
    });
    const store = createTestStore();

    store.getState().pushRecentPublishConfig("k", "repo-9");
    await flushQueue();

    expect(apiMocks.pushRecentPublishConfig).toHaveBeenCalledWith({
      repoId: "repo-9",
      configKey: "k",
    });
  });

  it("no-ops when no repository is resolvable or the key is blank", async () => {
    const store = createTestStore({ selectedRepoId: null });

    store.getState().pushRecentPublishConfig("k");
    store.getState().removeRecentPublishConfig("k");
    store.getState().replaceRecentPublishConfigKey("a", "b");
    store.getState().reorderRecentPublishConfigs(["a"]);
    await flushQueue();

    expect(apiMocks.pushRecentPublishConfig).not.toHaveBeenCalled();
    expect(apiMocks.removeRecentPublishConfig).not.toHaveBeenCalled();
    expect(apiMocks.replaceRecentPublishConfigKey).not.toHaveBeenCalled();
    expect(apiMocks.reorderRecentPublishConfigs).not.toHaveBeenCalled();
  });

  it("serializes queued mutations so api calls land in order", async () => {
    const calls: string[] = [];
    apiMocks.pushRecentPublishConfig.mockImplementation(
      async ({ configKey }: { configKey: string }) => {
        calls.push(`push:${configKey}`);
        return {
          recentRepoIds: [],
          recentConfigKeysByRepo: { "repo-1": [configKey] },
        };
      }
    );
    apiMocks.removeRecentPublishConfig.mockImplementation(
      async ({ configKey }: { configKey: string }) => {
        calls.push(`remove:${configKey}`);
        return { recentRepoIds: [], recentConfigKeysByRepo: { "repo-1": [] } };
      }
    );
    const store = createTestStore();

    store.getState().pushRecentPublishConfig("first");
    store.getState().removeRecentPublishConfig("second");
    store.getState().pushRecentPublishConfig("third");
    await vi.waitFor(() => expect(calls).toHaveLength(3));

    expect(calls).toEqual(["push:first", "remove:second", "push:third"]);
  });

  it("applies reorder optimistically and skips the server echo", async () => {
    apiMocks.reorderRecentPublishConfigs.mockResolvedValue({
      recentRepoIds: ["stale-echo"],
      recentConfigKeysByRepo: { "repo-1": ["stale"] },
    });
    const store = createTestStore({
      recentConfigKeysByRepo: { "repo-1": ["a", "b", "c"] },
    });

    store.getState().reorderRecentPublishConfigs(["c", "b", "a"]);

    // Optimistic state lands synchronously.
    expect(store.getState().recentConfigKeysByRepo["repo-1"]).toEqual([
      "c",
      "b",
      "a",
    ]);
    await flushQueue();
    expect(apiMocks.reorderRecentPublishConfigs).toHaveBeenCalledWith({
      repoId: "repo-1",
      configKeys: ["c", "b", "a"],
    });
    // applyState:false keeps the optimistic order instead of the server echo.
    expect(store.getState().recentConfigKeysByRepo["repo-1"]).toEqual([
      "c",
      "b",
      "a",
    ]);
    expect(store.getState().recentRepoIds).toEqual([]);
  });

  it("still runs a queued mutation after the previous one rejected", async () => {
    apiMocks.pushRecentPublishConfig
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValue({
        recentRepoIds: ["repo-1"],
        recentConfigKeysByRepo: { "repo-1": ["second"] },
      });
    apiMocks.getAppState.mockResolvedValue({
      recentRepoIds: [],
      recentConfigKeysByRepo: {},
      repositories: [],
      executionHistory: [],
    });
    const store = createTestStore();

    store.getState().pushRecentPublishConfig("first");
    store.getState().pushRecentPublishConfig("second");

    await vi.waitFor(() =>
      expect(apiMocks.pushRecentPublishConfig).toHaveBeenCalledTimes(2)
    );
    await flushQueue();
    expect(store.getState().recentConfigKeysByRepo["repo-1"]).toEqual([
      "second",
    ]);
  });

  it("replaces a recent config key through the queue", async () => {
    apiMocks.replaceRecentPublishConfigKey.mockResolvedValue({
      recentRepoIds: ["repo-1"],
      recentConfigKeysByRepo: { "repo-1": ["preset:b"] },
    });
    const store = createTestStore();

    store.getState().replaceRecentPublishConfigKey("preset:a", "preset:b");

    await vi.waitFor(() =>
      expect(store.getState().recentConfigKeysByRepo["repo-1"]).toEqual([
        "preset:b",
      ])
    );
    expect(apiMocks.replaceRecentPublishConfigKey).toHaveBeenCalledWith({
      repoId: "repo-1",
      previousKey: "preset:a",
      nextKey: "preset:b",
    });
  });

  it("no-ops replace when either key is blank", async () => {
    const store = createTestStore();

    store.getState().replaceRecentPublishConfigKey(" ", "b");
    store.getState().replaceRecentPublishConfigKey("a", " ");
    await flushQueue();

    expect(apiMocks.replaceRecentPublishConfigKey).not.toHaveBeenCalled();
  });
});

describe("updatePublishEditState", () => {
  it("writes the returned publishConfig back into the selected repository", async () => {
    const publishConfig = { providerId: "dotnet", spec: { version: 1 } };
    apiMocks.updatePublishEditState.mockResolvedValue({
      repositories: [repo("repo-1", publishConfig)],
      recentRepoIds: [],
      recentConfigKeysByRepo: {},
    });
    const store = createTestStore({
      repositories: [repo("repo-1", null), repo("repo-2", "keep")],
    });

    store.getState().updatePublishEditState({
      draft: { providerId: "dotnet", parameters: {} },
    });
    await vi.waitFor(() =>
      expect(
        store.getState().repositories.find((r) => r.id === "repo-1")
          ?.publishConfig
      ).toEqual(publishConfig)
    );

    expect(apiMocks.updatePublishEditState).toHaveBeenCalledWith({
      repoId: "repo-1",
      update: { draft: { providerId: "dotnet", parameters: {} } },
    });
    expect(
      store.getState().repositories.find((r) => r.id === "repo-2")
        ?.publishConfig
    ).toBe("keep");
  });

  it("does nothing when no repository is selected", async () => {
    const store = createTestStore({ selectedRepoId: null });

    store.getState().updatePublishEditState({
      draft: { providerId: "dotnet", parameters: {} },
    });
    await flushQueue();

    expect(apiMocks.updatePublishEditState).not.toHaveBeenCalled();
  });

  it("keeps the local publishConfig when the response omits the repo", async () => {
    apiMocks.updatePublishEditState.mockResolvedValue({
      repositories: [repo("repo-2", "other")],
      recentRepoIds: [],
      recentConfigKeysByRepo: {},
    });
    const store = createTestStore({
      repositories: [repo("repo-1", "local-config")],
    });

    store.getState().updatePublishEditState({
      draft: { providerId: "dotnet", parameters: {} },
    });
    await flushQueue();

    expect(
      store.getState().repositories.find((r) => r.id === "repo-1")
        ?.publishConfig
    ).toBe("local-config");
  });

  it("surfaces a toast when the edit-state save rejects", async () => {
    apiMocks.updatePublishEditState.mockRejectedValue(new Error("io"));
    apiMocks.getAppState.mockResolvedValue({
      recentRepoIds: [],
      recentConfigKeysByRepo: {},
      repositories: [],
      executionHistory: [],
    });
    const store = createTestStore();

    store.getState().updatePublishEditState({
      draft: { providerId: "dotnet", parameters: {} },
    });
    await vi.waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
  });
});

describe("persistence failure handling", () => {
  it("surfaces a toast and reloads authoritative state when a mutation rejects", async () => {
    apiMocks.pushRecentPublishConfig.mockRejectedValue(new Error("disk full"));
    apiMocks.getAppState.mockResolvedValue({
      recentRepoIds: ["repo-1"],
      recentConfigKeysByRepo: { "repo-1": ["authoritative"] },
      repositories: [],
      executionHistory: ["kept"],
    });
    const store = createTestStore({ executionHistory: ["local-history"] });

    store.getState().pushRecentPublishConfig("k");
    await vi.waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    await flushQueue();

    expect(apiMocks.getAppState).toHaveBeenCalled();
    expect(store.getState().recentConfigKeysByRepo["repo-1"]).toEqual([
      "authoritative",
    ]);
    expect(store.getState().error).toBeNull();
    expect(store.getState().executionHistory).toEqual(["local-history"]);
  });
});
