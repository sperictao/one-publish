import type { StateCreator } from "zustand";
import { t } from "@/hooks/useI18n";
import { updateUIState } from "@/lib/store/api";
import {
  applyUiStateMutation,
  type UiStateMutation,
} from "./appStoreMutations";
import { makeHandlePersistenceFailure } from "./appStoreHelpers";
import type { AppStore } from "./appStore";

export interface UiStateSlice {
  /** 左侧面板宽度 */
  leftPanelWidth: number;
  /** 中间面板宽度 */
  middlePanelWidth: number;
  /** 面板宽度是否已被用户自定义过 */
  panelWidthsCustomized: boolean;

  /** 设置 UI 状态（带防抖持久化） */
  setUIState: (params: UiStateMutation) => void;
  /** 设置左侧面板宽度 */
  setLeftPanelWidth: (width: number) => void;
  /** 设置中间面板宽度 */
  setMiddlePanelWidth: (width: number) => void;
}

// ── Module-level debounce state ──
const DEBOUNCE_DELAY = 500;
let uiDebounceTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * Every UI field changed inside the current debounce window. The backend
 * `update_ui_state` applies only the fields present in its payload, so
 * persisting just the last `setUIState` params would silently drop the earlier
 * edits from disk (for example a repository selection made while a panel is
 * being resized).
 */
let pendingUiMutation: UiStateMutation | null = null;

/**
 * `selectedRepoId` and `clearSelectedRepoId` are mutually exclusive intents and
 * the backend gives the clear flag priority. When the newest params carry only
 * one of them, drop the opposite key accumulated earlier in the same window;
 * params carrying both (`selectRepository(null)`) must stay untouched.
 */
function mergePendingUiMutation(
  pending: UiStateMutation,
  params: UiStateMutation
): UiStateMutation {
  const merged: UiStateMutation = { ...pending, ...params };
  const hasSelection = params.selectedRepoId !== undefined;
  const hasClear = params.clearSelectedRepoId !== undefined;

  if (hasClear && !hasSelection) {
    delete merged.selectedRepoId;
  } else if (hasSelection && !hasClear) {
    delete merged.clearSelectedRepoId;
  }
  return merged;
}

export const createUiStateSlice: StateCreator<
  AppStore,
  [],
  [],
  UiStateSlice
> = (set, get) => {
  const handlePersistenceFailure = makeHandlePersistenceFailure(
    set as (partial: Record<string, unknown>) => void,
    get
  );

  return {
    // ── State defaults ──
    leftPanelWidth: 220,
    middlePanelWidth: 280,
    panelWidthsCustomized: false,

    // ── UI State ──
    setUIState: (params) => {
      set((prev) => applyUiStateMutation(prev, params));

      // Later writes to the same field win; distinct fields are all preserved.
      pendingUiMutation = mergePendingUiMutation(
        pendingUiMutation ?? {},
        params
      );

      if (uiDebounceTimer) clearTimeout(uiDebounceTimer);
      uiDebounceTimer = setTimeout(() => {
        uiDebounceTimer = null;
        const mutation = pendingUiMutation;
        pendingUiMutation = null;
        if (!mutation) return;
        void updateUIState(mutation).catch((err) => {
          void handlePersistenceFailure(t("app.saveUiStateFailed"), err);
        });
      }, DEBOUNCE_DELAY);
    },

    setLeftPanelWidth: (width) => {
      set({ panelWidthsCustomized: true });
      get().setUIState({ leftPanelWidth: width });
    },

    setMiddlePanelWidth: (width) => {
      set({ panelWidthsCustomized: true });
      get().setUIState({ middlePanelWidth: width });
    },
  };
};
