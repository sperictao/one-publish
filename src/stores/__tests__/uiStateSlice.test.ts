import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";

const apiMocks = vi.hoisted(() => ({
  updateUIState: vi.fn(),
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

import { createUiStateSlice, type UiStateSlice } from "@/stores/uiStateSlice";

interface TestStore extends UiStateSlice {
  selectedRepoId: string | null;
  error: string | null;
  executionHistory: unknown[];
}

function createTestStore() {
  return create<TestStore>()((...args) => ({
    selectedRepoId: null,
    error: null,
    executionHistory: [],
    ...createUiStateSlice(
      ...(args as unknown as Parameters<typeof createUiStateSlice>)
    ),
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("setUIState", () => {
  it("applies mutations synchronously and persists after debounce", () => {
    apiMocks.updateUIState.mockResolvedValue({});
    const store = createTestStore();

    store.getState().setUIState({ leftPanelWidth: 300 });

    expect(store.getState().leftPanelWidth).toBe(300);
    expect(apiMocks.updateUIState).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(apiMocks.updateUIState).toHaveBeenCalledWith({
      leftPanelWidth: 300,
    });
  });

  it("supports selecting and clearing the repository id", () => {
    apiMocks.updateUIState.mockResolvedValue({});
    const store = createTestStore();

    store.getState().setUIState({ selectedRepoId: "repo-7" });
    expect(store.getState().selectedRepoId).toBe("repo-7");

    store.getState().setUIState({ clearSelectedRepoId: true });
    expect(store.getState().selectedRepoId).toBeNull();
  });

  it("reports persistence failures through the toast path", async () => {
    apiMocks.updateUIState.mockRejectedValue(new Error("disk"));
    apiMocks.getAppState.mockResolvedValue({
      repositories: [],
      executionHistory: [],
    });
    const store = createTestStore();

    store.getState().setUIState({ leftPanelWidth: 1 });
    vi.advanceTimersByTime(500);
    await vi.waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
  });
});

describe("panel width setters", () => {
  it("mark widths as customized and apply the new width", () => {
    apiMocks.updateUIState.mockResolvedValue({});
    const store = createTestStore();

    store.getState().setLeftPanelWidth(260);
    store.getState().setMiddlePanelWidth(320);

    expect(store.getState().leftPanelWidth).toBe(260);
    expect(store.getState().middlePanelWidth).toBe(320);
    expect(store.getState().panelWidthsCustomized).toBe(true);
  });
});
