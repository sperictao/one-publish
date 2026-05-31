import type { StateCreator } from "zustand";
import type { AppState, Repository } from "@/lib/store/types";
import {
  addRepository as apiAddRepository,
  removeRepository as apiRemoveRepository,
  reorderRepositories as apiReorderRepositories,
  updateRepository as apiUpdateRepository,
} from "@/lib/store/api";
import { makeHandlePersistenceFailure } from "./appStoreHelpers";
import type { AppStore } from "./appStore";

export interface RepositorySlice {
  /** 仓库列表 */
  repositories: Repository[];
  /** 当前选中的仓库 ID */
  selectedRepoId: string | null;

  /** 添加仓库 */
  addRepository: (repo: Repository) => Promise<AppState>;
  /** 删除仓库 */
  removeRepository: (repoId: string) => Promise<AppState>;
  /** 更新仓库 */
  updateRepository: (repo: Repository) => Promise<AppState>;
  /** 重排仓库顺序 */
  reorderRepositories: (repoIds: string[]) => void;
  /** 选中仓库 */
  selectRepository: (repoId: string | null) => void;
}

// ── Module-level mutation queue (mirrors the closure pattern from appStore) ──
let repositoryMutationQueue: Promise<void> = Promise.resolve();

export const createRepositorySlice: StateCreator<
  AppStore,
  [],
  [],
  RepositorySlice
> = (set, get) => {
  const handlePersistenceFailure = makeHandlePersistenceFailure(
    set as (partial: Record<string, unknown>) => void
  );

  function enqueueRepositoryMutation(
    mutation: () => Promise<unknown>,
    errorMessage: string
  ) {
    repositoryMutationQueue = repositoryMutationQueue
      .catch(() => undefined)
      .then(async () => {
        try {
          await mutation();
        } catch (err) {
          await handlePersistenceFailure(errorMessage, err);
        }
      });
  }

  return {
    // ── State defaults ──
    repositories: [],
    selectedRepoId: null as string | null,

    // ── Repository CRUD ──
    addRepository: async (repo) => {
      const newState = await apiAddRepository(repo);
      set({ ...newState } as Record<string, unknown>);
      return newState;
    },

    removeRepository: async (repoId) => {
      const newState = await apiRemoveRepository(repoId);
      set({ ...newState } as Record<string, unknown>);
      return newState;
    },

    updateRepository: async (repo) => {
      const newState = await apiUpdateRepository(repo);
      set({ ...newState } as Record<string, unknown>);
      return newState;
    },

    reorderRepositories: (repoIds) => {
      const { repositories } = get();
      if (repositories.length === 0) return;

      const repositoryMap = new Map(repositories.map((r) => [r.id, r]));
      const nextRepositories = repoIds
        .map((id) => repositoryMap.get(id))
        .filter((r): r is Repository => Boolean(r));

      if (nextRepositories.length !== repositories.length) return;

      set({ repositories: nextRepositories } as Record<string, unknown>);

      enqueueRepositoryMutation(
        () => apiReorderRepositories(repoIds),
        "保存仓库排序失败"
      );
    },

    selectRepository: (repoId) => {
      get().setUIState(
        repoId === null
          ? { selectedRepoId: null, clearSelectedRepoId: true }
          : { selectedRepoId: repoId }
      );
    },
  };
};
