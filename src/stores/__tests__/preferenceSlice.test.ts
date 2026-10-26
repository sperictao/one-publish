import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";

const apiMocks = vi.hoisted(() => ({
  updatePreferences: vi.fn(),
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
  createPreferenceSlice,
  type PreferenceSlice,
} from "@/stores/preferenceSlice";

interface TestStore extends PreferenceSlice {
  error: string | null;
  executionHistory: unknown[];
}

function createTestStore() {
  return create<TestStore>()((...args) => ({
    error: null,
    executionHistory: [],
    ...createPreferenceSlice(
      ...(args as unknown as Parameters<typeof createPreferenceSlice>)
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

describe("setPreferences", () => {
  it("applies the mutation synchronously and persists after debounce", () => {
    apiMocks.updatePreferences.mockResolvedValue({});
    const store = createTestStore();

    store.getState().setPreferences({ theme: "dark" });

    expect(store.getState().theme).toBe("dark");
    expect(apiMocks.updatePreferences).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(apiMocks.updatePreferences).toHaveBeenCalledWith({ theme: "dark" });
  });

  it("coalesces rapid mutations into a single persist with the last params", () => {
    apiMocks.updatePreferences.mockResolvedValue({});
    const store = createTestStore();

    store.getState().setPreferences({ theme: "dark" });
    vi.advanceTimersByTime(200);
    store.getState().setPreferences({ language: "en" });
    vi.advanceTimersByTime(500);

    expect(apiMocks.updatePreferences).toHaveBeenCalledTimes(1);
    expect(apiMocks.updatePreferences).toHaveBeenCalledWith({
      language: "en",
    });
    // Both mutations still applied locally.
    expect(store.getState().theme).toBe("dark");
    expect(store.getState().language).toBe("en");
  });

  it("persists failures through the shared failure handler", async () => {
    apiMocks.updatePreferences.mockRejectedValue(new Error("io error"));
    apiMocks.getAppState.mockResolvedValue({
      repositories: [],
      executionHistory: [],
    });
    const store = createTestStore();

    store.getState().setPreferences({ theme: "dark" });
    vi.advanceTimersByTime(500);
    await vi.waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
  });
});

describe("preference setters", () => {
  it("delegate through setPreferences", () => {
    apiMocks.updatePreferences.mockResolvedValue({});
    const store = createTestStore();

    store.getState().setLanguage("en");
    store.getState().setMinimizeToTrayOnClose(false);
    store.getState().setDefaultOutputDir("/out");
    store.getState().setTheme("light");
    store.getState().setExecutionHistoryLimit(50);

    expect(store.getState().language).toBe("en");
    expect(store.getState().minimizeToTrayOnClose).toBe(false);
    expect(store.getState().defaultOutputDir).toBe("/out");
    expect(store.getState().theme).toBe("light");
    expect(store.getState().executionHistoryLimit).toBe(50);

    vi.advanceTimersByTime(500);
    // Debounce collapsed to the last mutation.
    expect(apiMocks.updatePreferences).toHaveBeenCalledTimes(1);
    expect(apiMocks.updatePreferences).toHaveBeenCalledWith({
      executionHistoryLimit: 50,
    });
  });

  it("normalizes environment provider ids on apply", () => {
    apiMocks.updatePreferences.mockResolvedValue({});
    const store = createTestStore();

    store.getState().setEnvironmentProviderIds([" dotnet ", "", "cargo"]);

    expect(store.getState().environmentProviderIds).toEqual([
      "cargo",
      "dotnet",
    ]);
  });
});
