import type { StateCreator } from "zustand";
import { updateUIState } from "@/lib/store/api";
import { applyUiStateMutation, type UiStateMutation } from "./appStoreMutations";
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

// ── Module-level debounce timer ──
const DEBOUNCE_DELAY = 500;
let uiDebounceTimer: ReturnType<typeof setTimeout> | null = null;

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

      if (uiDebounceTimer) clearTimeout(uiDebounceTimer);
      uiDebounceTimer = setTimeout(() => {
        void updateUIState(params).catch((err) => {
          void handlePersistenceFailure("保存界面状态失败", err);
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
