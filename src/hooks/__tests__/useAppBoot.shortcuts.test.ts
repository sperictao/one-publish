import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 只 mock 各领域 hook，保留 useAppBoot → useAppShortcutsProps → useShortcuts
// 的真实接线，验证快捷键最终调用到真实的发布 / 刷新 / 设置回调。
const mocks = vi.hoisted(() => ({
  startPublish: vi.fn(),
  scanProject: vi.fn(),
  handleOpenSettings: vi.fn(),
  selectedRepo: {
    id: "repo-1",
    path: "/repos/demo",
    projectFile: "src/Demo/Demo.csproj",
  },
}));

vi.mock("@/lib/platform", () => ({
  isMacPlatform: () => false,
}));

vi.mock("@/hooks/useAppState", () => ({
  useAppState: () => ({
    isLoading: false,
    repositories: [],
    selectedRepoId: mocks.selectedRepo.id,
  }),
}));

vi.mock("@/hooks/useShellBoot", () => ({
  useShellBoot: () => ({
    appT: {},
    handleOpenSettings: mocks.handleOpenSettings,
    shouldLoadAppDialogsHost: false,
  }),
}));

vi.mock("@/hooks/useRepoBoot", () => ({
  useRepoBoot: () => ({
    selectedRepo: mocks.selectedRepo,
    scanProject: mocks.scanProject,
  }),
}));

vi.mock("@/hooks/usePublishBoot", () => ({
  usePublishBoot: () => ({
    startPublish: mocks.startPublish,
    diagnosticsSectionProps: null,
    quickCreateProfileOpen: false,
  }),
}));

vi.mock("@/features/provider/useProviderRuntime", () => ({
  useProviderRuntime: () => ({}),
}));

vi.mock("@/features/provider/useProviderParametersState", () => ({
  useProviderParametersState: () => ({}),
}));

vi.mock("@/features/history/usePublishHistoryState", () => ({
  usePublishHistoryState: () => ({}),
}));

vi.mock("@/features/provider/useEditorProviderState", () => ({
  useEditorProviderState: () => ({}),
}));

vi.mock("@/features/provider/useProviderPresentationState", () => ({
  useProviderPresentationState: () => ({
    activeProviderUsesProjectFile: true,
    repositoryProviders: [],
  }),
}));

vi.mock("@/hooks/useRerunFlow", () => ({
  useRerunFlow: () => ({ rerunFromHistory: vi.fn() }),
}));

vi.mock("@/hooks/useTrayRecentPublish", () => ({
  useTrayRecentPublish: () => undefined,
}));

import { useAppBoot } from "@/hooks/useAppBoot";
import { usePublishStore } from "@/stores/publishStore";

function pressCtrl(key: string) {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key, ctrlKey: true, cancelable: true })
    );
  });
}

describe("useAppBoot 快捷键接线", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    usePublishStore.setState({ isPublishing: false });
  });

  it("Ctrl+P 调用发布领域的 startPublish", () => {
    renderHook(() => useAppBoot());

    pressCtrl("p");

    expect(mocks.startPublish).toHaveBeenCalledTimes(1);
  });

  it("发布进行中时 Ctrl+P 不重复发布", () => {
    usePublishStore.setState({ isPublishing: true });
    renderHook(() => useAppBoot());

    pressCtrl("p");

    expect(mocks.startPublish).not.toHaveBeenCalled();
  });

  it("Ctrl+R 以选中仓库重新扫描项目", () => {
    renderHook(() => useAppBoot());

    pressCtrl("r");

    expect(mocks.scanProject).toHaveBeenCalledWith(mocks.selectedRepo.path, {
      projectFile: mocks.selectedRepo.projectFile,
    });
  });

  it("Ctrl+, 打开设置", () => {
    renderHook(() => useAppBoot());

    pressCtrl(",");

    expect(mocks.handleOpenSettings).toHaveBeenCalledTimes(1);
  });
});
