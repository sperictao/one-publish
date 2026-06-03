import { normalizeEnvironmentProviderIds } from "@/features/environment/environment";
import type { AppState, PublishConfigStore } from "@/lib/store/types";

export type UiStateMutation = {
  leftPanelWidth?: number;
  middlePanelWidth?: number;
  selectedRepoId?: string | null;
  clearSelectedRepoId?: boolean;
};

export type PreferenceStateMutation = {
  language?: string;
  minimizeToTrayOnClose?: boolean;
  defaultOutputDir?: string;
  theme?: "light" | "dark" | "auto";
  executionHistoryLimit?: number;
  environmentProviderIds?: string[];
};

export type PublishStatePatch = {
  selectedPreset?: string;
  isCustomMode?: boolean;
  customConfig?: PublishConfigStore;
};

export function applyUiStateMutation(
  state: AppState,
  mutation: UiStateMutation
): AppState {
  return {
    ...state,
    ...(mutation.leftPanelWidth !== undefined && {
      leftPanelWidth: mutation.leftPanelWidth,
    }),
    ...(mutation.middlePanelWidth !== undefined && {
      middlePanelWidth: mutation.middlePanelWidth,
    }),
    ...(mutation.clearSelectedRepoId
      ? { selectedRepoId: null as string | null }
      : mutation.selectedRepoId !== undefined
        ? { selectedRepoId: mutation.selectedRepoId }
        : {}),
  };
}

export function applyPreferenceStateMutation(
  state: AppState,
  mutation: PreferenceStateMutation
): AppState {
  return {
    ...state,
    ...(mutation.language !== undefined && { language: mutation.language }),
    ...(mutation.minimizeToTrayOnClose !== undefined && {
      minimizeToTrayOnClose: mutation.minimizeToTrayOnClose,
    }),
    ...(mutation.defaultOutputDir !== undefined && {
      defaultOutputDir: mutation.defaultOutputDir,
    }),
    ...(mutation.theme !== undefined && { theme: mutation.theme }),
    ...(mutation.executionHistoryLimit !== undefined && {
      executionHistoryLimit: mutation.executionHistoryLimit,
    }),
    ...(mutation.environmentProviderIds !== undefined && {
      environmentProviderIds: normalizeEnvironmentProviderIds(
        mutation.environmentProviderIds
      ),
    }),
  };
}

export function applyPublishStateMutation(
  state: AppState,
  repoId: string,
  patch: PublishStatePatch
): AppState {
  return {
    ...state,
    repositories: state.repositories.map((repo) => {
      if (repo.id !== repoId) {
        return repo;
      }

      return {
        ...repo,
        publishConfig: {
          ...repo.publishConfig,
          ...(patch.selectedPreset !== undefined && {
            selectedPreset: patch.selectedPreset,
          }),
          ...(patch.isCustomMode !== undefined && {
            isCustomMode: patch.isCustomMode,
          }),
          ...(patch.customConfig !== undefined && {
            customConfig: patch.customConfig,
          }),
        },
      };
    }),
  };
}

export function mergeRecentPublishState(
  state: AppState,
  nextState: Pick<AppState, "recentRepoIds" | "recentConfigKeysByRepo">
): AppState {
  return {
    ...state,
    recentRepoIds: nextState.recentRepoIds,
    recentConfigKeysByRepo: nextState.recentConfigKeysByRepo,
  };
}

export function mergeBootstrapAppState(
  state: AppState,
  nextState: AppState
): AppState {
  return {
    ...nextState,
    executionHistory: state.executionHistory,
  };
}

export function resolveScopedMutationRepoId(
  selectedRepoId: string | null,
  repoId?: string | null
) {
  return repoId ?? selectedRepoId;
}
