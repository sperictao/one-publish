import { beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";

const apiMocks = vi.hoisted(() => ({
  addRepository: vi.fn(),
  removeRepository: vi.fn(),
  updateRepository: vi.fn(),
  reorderRepositories: vi.fn(),
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
  createRepositorySlice,
  type RepositorySlice,
} from "@/stores/repositorySlice";
import type { Repository } from "@/lib/store/types";
import type { UiStateMutation } from "@/stores/appStoreMutations";

interface TestStore extends RepositorySlice {
  error: string | null;
  executionHistory: unknown[];
  setUIState: (params: UiStateMutation) => void;
}

function repo(id: string): Repository {
  return { id, name: id, path: `/repos/${id}` } as Repository;
}

function createTestStore() {
  return create<TestStore>()((set, get, api) => ({
    error: null,
    executionHistory: [],
    setUIState: (params) => {
      set((prev) => ({
        ...prev,
        ...(params.clearSelectedRepoId
          ? { selectedRepoId: null }
          : params.selectedRepoId !== undefined
            ? { selectedRepoId: params.selectedRepoId }
            : {}),
      }));
    },
    ...createRepositorySlice(
      ...([set, get, api] as unknown as Parameters<
        typeof createRepositorySlice
      >)
    ),
  }));
}

async function flushQueue() {
  for (let i = 0; i < 12; i += 1) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("repository CRUD", () => {
  it("adds a repository and applies the returned state", async () => {
    const next = { repositories: [repo("a")], selectedRepoId: "a" };
    apiMocks.addRepository.mockResolvedValue(next);
    const store = createTestStore();

    const result = await store.getState().addRepository(repo("a"));

    expect(apiMocks.addRepository).toHaveBeenCalledWith(repo("a"));
    expect(result).toBe(next);
    expect(store.getState().repositories).toEqual([repo("a")]);
  });

  it("removes a repository and applies the returned state", async () => {
    apiMocks.removeRepository.mockResolvedValue({ repositories: [] });
    const store = createTestStore();

    const result = await store.getState().removeRepository("a");

    expect(apiMocks.removeRepository).toHaveBeenCalledWith("a");
    expect(result).toEqual({ repositories: [] });
    expect(store.getState().repositories).toEqual([]);
  });

  it("updates a repository and applies the returned state", async () => {
    const updated = repo("a");
    apiMocks.updateRepository.mockResolvedValue({
      repositories: [updated],
    });
    const store = createTestStore();

    await store.getState().updateRepository(updated);

    expect(apiMocks.updateRepository).toHaveBeenCalledWith(updated);
    expect(store.getState().repositories).toEqual([updated]);
  });
});

describe("reorderRepositories", () => {
  it("reorders optimistically and persists the new order", async () => {
    apiMocks.reorderRepositories.mockResolvedValue({});
    const store = createTestStore();
    store.setState({ repositories: [repo("a"), repo("b"), repo("c")] });

    store.getState().reorderRepositories(["c", "a", "b"]);

    expect(store.getState().repositories.map((r) => r.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
    await flushQueue();
    expect(apiMocks.reorderRepositories).toHaveBeenCalledWith(["c", "a", "b"]);
  });

  it("rejects a mismatched id list without touching state or the api", async () => {
    const store = createTestStore();
    store.setState({ repositories: [repo("a"), repo("b")] });

    store.getState().reorderRepositories(["a", "ghost"]);
    store.getState().reorderRepositories(["a"]);
    await flushQueue();

    expect(store.getState().repositories.map((r) => r.id)).toEqual(["a", "b"]);
    expect(apiMocks.reorderRepositories).not.toHaveBeenCalled();
  });

  it("no-ops on an empty repository list", async () => {
    const store = createTestStore();

    store.getState().reorderRepositories(["a"]);
    await flushQueue();

    expect(apiMocks.reorderRepositories).not.toHaveBeenCalled();
  });

  it("recovers through the failure handler when persistence rejects", async () => {
    apiMocks.reorderRepositories.mockRejectedValue(new Error("io"));
    apiMocks.getAppState.mockResolvedValue({
      repositories: [repo("a"), repo("b")],
      executionHistory: [],
    });
    const store = createTestStore();
    store.setState({ repositories: [repo("a"), repo("b")] });

    store.getState().reorderRepositories(["b", "a"]);
    await vi.waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    await flushQueue();

    // Authoritative reload restored the pre-reorder state.
    expect(store.getState().repositories.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("selectRepository", () => {
  it("delegates to setUIState for selection and clearing", () => {
    const store = createTestStore();

    store.getState().selectRepository("repo-1");
    expect(store.getState().selectedRepoId).toBe("repo-1");

    store.getState().selectRepository(null);
    expect(store.getState().selectedRepoId).toBeNull();
  });
});
