import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectInfo } from "@/lib/store/types";

const mocks = vi.hoisted(() => ({
  scanProject: vi.fn(),
  resolveProjectInfo: vi.fn(),
  isTauri: vi.fn(() => false),
  getCurrentWindow: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: mocks.isTauri,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: mocks.getCurrentWindow,
}));

vi.mock("@/features/repository/useProjectScanner", () => ({
  useProjectScanner: () => ({
    scanProject: mocks.scanProject,
    resolveProjectInfo: mocks.resolveProjectInfo,
  }),
}));

import { useProjectShellState } from "@/features/repository/useProjectShellState";

type HookProps = {
  selectedRepoId: string | null;
  selectedRepoPath?: string;
  selectedRepoProjectFile?: string;
};

function createProjectInfo(rootPath: string): ProjectInfo {
  return {
    root_path: rootPath,
    project_file: `${rootPath}/App.csproj`,
    publish_profiles: ["FolderProfile"],
    target_frameworks: ["net8.0"],
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("useProjectShellState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveProjectInfo.mockResolvedValue(null);
  });

  it("会忽略旧仓库晚到的扫描结果", async () => {
    const repoA = createDeferred<ProjectInfo | null>();
    const repoB = createDeferred<ProjectInfo | null>();
    mocks.scanProject
      .mockImplementationOnce(() => repoA.promise)
      .mockImplementationOnce(() => repoB.promise);

    const { result, rerender } = renderHook(
      (props: HookProps) =>
        useProjectShellState({
          appT: {},
          isStateLoading: false,
          ...props,
        }),
      {
        initialProps: {
          selectedRepoId: "repo-a",
          selectedRepoPath: "/repo-a",
          selectedRepoProjectFile: undefined,
        },
      }
    );

    rerender({
      selectedRepoId: "repo-b",
      selectedRepoPath: "/repo-b",
      selectedRepoProjectFile: undefined,
    });

    await act(async () => {
      repoB.resolve(createProjectInfo("/repo-b"));
    });

    await waitFor(() => {
      expect(result.current.projectInfo?.project_file).toBe(
        "/repo-b/App.csproj"
      );
    });

    await act(async () => {
      repoA.resolve(createProjectInfo("/repo-a"));
    });

    expect(result.current.projectInfo?.project_file).toBe("/repo-b/App.csproj");
  });

  it("仓库切换扫描期间会暴露刷新状态，完成后再结束刷新", async () => {
    const repoA = createDeferred<ProjectInfo | null>();
    const repoB = createDeferred<ProjectInfo | null>();
    mocks.scanProject
      .mockImplementationOnce(() => repoA.promise)
      .mockImplementationOnce(() => repoB.promise);

    const { result, rerender } = renderHook(
      (props: HookProps) =>
        useProjectShellState({
          appT: {},
          isStateLoading: false,
          ...props,
        }),
      {
        initialProps: {
          selectedRepoId: "repo-a",
          selectedRepoPath: "/repo-a",
          selectedRepoProjectFile: undefined,
        },
      }
    );

    await waitFor(() => {
      expect(result.current.isProjectInfoRefreshing).toBe(true);
    });

    await act(async () => {
      repoA.resolve(createProjectInfo("/repo-a"));
    });

    await waitFor(() => {
      expect(result.current.isProjectInfoRefreshing).toBe(false);
      expect(result.current.projectInfo?.project_file).toBe(
        "/repo-a/App.csproj"
      );
    });

    rerender({
      selectedRepoId: "repo-b",
      selectedRepoPath: "/repo-b",
      selectedRepoProjectFile: undefined,
    });

    await waitFor(() => {
      expect(result.current.isProjectInfoRefreshing).toBe(true);
    });

    await act(async () => {
      repoB.resolve(createProjectInfo("/repo-b"));
    });

    await waitFor(() => {
      expect(result.current.isProjectInfoRefreshing).toBe(false);
      expect(result.current.projectInfo?.project_file).toBe(
        "/repo-b/App.csproj"
      );
    });
  });

  it("切回已访问仓库时会立即回显缓存的项目信息，再后台刷新", async () => {
    const repoAInitial = createDeferred<ProjectInfo | null>();
    const repoB = createDeferred<ProjectInfo | null>();
    const repoARefresh = createDeferred<ProjectInfo | null>();
    mocks.scanProject
      .mockImplementationOnce(() => repoAInitial.promise)
      .mockImplementationOnce(() => repoB.promise)
      .mockImplementationOnce(() => repoARefresh.promise);

    const { result, rerender } = renderHook(
      (props: HookProps) =>
        useProjectShellState({
          appT: {},
          isStateLoading: false,
          ...props,
        }),
      {
        initialProps: {
          selectedRepoId: "repo-a",
          selectedRepoPath: "/repo-a",
          selectedRepoProjectFile: undefined,
        },
      }
    );

    await act(async () => {
      repoAInitial.resolve(createProjectInfo("/repo-a"));
    });

    await waitFor(() => {
      expect(result.current.projectInfo?.project_file).toBe(
        "/repo-a/App.csproj"
      );
    });

    rerender({
      selectedRepoId: "repo-b",
      selectedRepoPath: "/repo-b",
      selectedRepoProjectFile: undefined,
    });

    await act(async () => {
      repoB.resolve(createProjectInfo("/repo-b"));
    });

    await waitFor(() => {
      expect(result.current.projectInfo?.project_file).toBe(
        "/repo-b/App.csproj"
      );
    });

    rerender({
      selectedRepoId: "repo-a",
      selectedRepoPath: "/repo-a",
      selectedRepoProjectFile: undefined,
    });

    expect(result.current.projectInfo?.project_file).toBe("/repo-a/App.csproj");
    expect(result.current.isProjectInfoRefreshing).toBe(true);

    await act(async () => {
      repoARefresh.resolve({
        ...createProjectInfo("/repo-a"),
        publish_profiles: ["FolderProfile", "ClickOnce"],
      });
    });

    await waitFor(() => {
      expect(result.current.isProjectInfoRefreshing).toBe(false);
      expect(result.current.projectInfo?.publish_profiles).toEqual([
        "FolderProfile",
        "ClickOnce",
      ]);
    });
  });

  it("切回已访问仓库时先回显缓存项目信息，新项目配置提交后随之更新", async () => {
    const repoAInitial = createDeferred<ProjectInfo | null>();
    const repoB = createDeferred<ProjectInfo | null>();
    const repoARefresh = createDeferred<ProjectInfo | null>();
    mocks.scanProject
      .mockImplementationOnce(() => repoAInitial.promise)
      .mockImplementationOnce(() => repoB.promise)
      .mockImplementationOnce(() => repoARefresh.promise);

    const { result, rerender } = renderHook(
      (props: HookProps) =>
        useProjectShellState({
          appT: {},
          isStateLoading: false,
          ...props,
        }),
      {
        initialProps: {
          selectedRepoId: "repo-a",
          selectedRepoPath: "/repo-a",
          selectedRepoProjectFile: undefined,
        },
      }
    );

    await act(async () => {
      repoAInitial.resolve(createProjectInfo("/repo-a"));
    });

    await waitFor(() => {
      expect(result.current.projectInfo?.project_file).toBe(
        "/repo-a/App.csproj"
      );
    });

    rerender({
      selectedRepoId: "repo-b",
      selectedRepoPath: "/repo-b",
      selectedRepoProjectFile: undefined,
    });

    await act(async () => {
      repoB.resolve(createProjectInfo("/repo-b"));
    });

    await waitFor(() => {
      expect(result.current.projectInfo?.project_file).toBe(
        "/repo-b/App.csproj"
      );
    });

    rerender({
      selectedRepoId: "repo-a",
      selectedRepoPath: "/repo-a",
      selectedRepoProjectFile: undefined,
    });

    expect(result.current.projectInfo?.project_file).toBe("/repo-a/App.csproj");
    expect(result.current.isProjectInfoRefreshing).toBe(true);

    await act(async () => {
      repoARefresh.resolve({
        ...createProjectInfo("/repo-a"),
        publish_profiles: ["FolderProfile", "ClickOnce"],
      });
    });

    await waitFor(() => {
      expect(result.current.projectInfo?.publish_profiles).toEqual([
        "FolderProfile",
        "ClickOnce",
      ]);
      expect(result.current.isProjectInfoRefreshing).toBe(false);
    });
  });

  it("仓库被清空时会立即清除当前项目信息", async () => {
    mocks.scanProject.mockResolvedValue(createProjectInfo("/repo-a"));
    const initialProps: HookProps = {
      selectedRepoId: "repo-a",
      selectedRepoPath: "/repo-a",
      selectedRepoProjectFile: undefined,
    };

    const { result, rerender } = renderHook(
      (props: HookProps) =>
        useProjectShellState({
          appT: {},
          isStateLoading: false,
          ...props,
        }),
      {
        initialProps,
      }
    );

    await waitFor(() => {
      expect(result.current.projectInfo?.project_file).toBe(
        "/repo-a/App.csproj"
      );
    });

    rerender({
      selectedRepoId: null,
      selectedRepoPath: undefined,
      selectedRepoProjectFile: undefined,
    } satisfies HookProps);

    expect(result.current.projectInfo).toBeNull();
  });

  it.each(["dotnet", "tauri"])(
    "%s 显式绑定优先于全仓扫描",
    async (providerId) => {
      const projectFile =
        providerId === "tauri"
          ? "/repo-bound/second/src-tauri/tauri.conf.json"
          : "/repo-bound/App.csproj";
      mocks.resolveProjectInfo.mockResolvedValue({
        ...createProjectInfo("/repo-bound"),
        project_file: projectFile,
      });

      const { result } = renderHook(() =>
        useProjectShellState({
          appT: {},
          isStateLoading: false,
          selectedRepoId: "repo-a",
          selectedRepoPath: "/repo-a",
          selectedRepoProjectFile: projectFile,
        })
      );

      await waitFor(() => {
        expect(result.current.projectInfo?.project_file).toBe(projectFile);
      });

      expect(mocks.resolveProjectInfo).toHaveBeenCalledWith(projectFile, {
        silentFailure: true,
      });
      expect(mocks.scanProject).not.toHaveBeenCalled();
    }
  );

  it("绑定的是 .sln 时会回退扫描真实项目文件", async () => {
    mocks.scanProject.mockResolvedValue(createProjectInfo("/repo-a"));

    const { result } = renderHook(() =>
      useProjectShellState({
        appT: {},
        isStateLoading: false,
        selectedRepoId: "repo-a",
        selectedRepoPath: "/repo-a",
        selectedRepoProjectFile: "/repo-a/App.sln",
      })
    );

    await waitFor(() => {
      expect(result.current.projectInfo?.project_file).toBe(
        "/repo-a/App.csproj"
      );
    });

    expect(mocks.resolveProjectInfo).not.toHaveBeenCalled();
    expect(mocks.scanProject).toHaveBeenCalledWith("/repo-a", {
      silentSuccess: true,
      silentFailure: true,
    });
  });

  it("provider 不使用项目文件时立即清空并返回 null", async () => {
    const { result } = renderHook(() =>
      useProjectShellState({
        appT: {},
        isStateLoading: false,
        selectedRepoId: "repo-a",
        selectedRepoPath: "/repo-a",
        activeProviderUsesProjectFile: false,
      })
    );

    await act(async () => {
      const data = await result.current.scanProject("/repo-a");
      expect(data).toBeNull();
    });

    expect(result.current.projectInfo).toBeNull();
    expect(result.current.isProjectInfoRefreshing).toBe(false);
    expect(mocks.resolveProjectInfo).not.toHaveBeenCalled();
    expect(mocks.scanProject).not.toHaveBeenCalled();
  });

  it("拖拽区 mousedown 驱动窗口拖动与双击最大化", () => {
    mocks.isTauri.mockReturnValue(true);
    const startDragging = vi.fn().mockResolvedValue(undefined);
    const toggleMaximize = vi.fn().mockResolvedValue(undefined);
    mocks.getCurrentWindow.mockReturnValue({ startDragging, toggleMaximize });

    const dragRegion = document.createElement("div");
    dragRegion.setAttribute("data-tauri-drag-region", "");
    const noDrag = document.createElement("button");
    noDrag.setAttribute("data-tauri-no-drag", "");
    dragRegion.appendChild(noDrag);
    document.body.appendChild(dragRegion);

    const { unmount } = renderHook(() =>
      useProjectShellState({
        appT: {},
        isStateLoading: false,
        selectedRepoId: "repo-a",
        selectedRepoPath: "/repo-a",
      })
    );

    const single = new MouseEvent("mousedown", {
      bubbles: true,
      buttons: 1,
      detail: 1,
    });
    const preventSpy = vi.spyOn(single, "preventDefault");
    dragRegion.dispatchEvent(single);
    expect(preventSpy).toHaveBeenCalled();
    expect(startDragging).toHaveBeenCalledTimes(1);

    dragRegion.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, buttons: 1, detail: 2 })
    );
    expect(toggleMaximize).toHaveBeenCalledTimes(1);
    expect(startDragging).toHaveBeenCalledTimes(1);

    noDrag.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, buttons: 1, detail: 1 })
    );
    expect(startDragging).toHaveBeenCalledTimes(1);
    expect(toggleMaximize).toHaveBeenCalledTimes(1);

    document.body.removeChild(dragRegion);
    unmount();
  });

  it("绑定项目解析失败时保留失败状态，不改选其他项目", async () => {
    mocks.resolveProjectInfo.mockResolvedValue(null);
    mocks.scanProject.mockResolvedValue(createProjectInfo("/repo-fallback"));

    const { result } = renderHook(() =>
      useProjectShellState({
        appT: {},
        isStateLoading: false,
        selectedRepoId: "repo-a",
        selectedRepoPath: "/repo-a",
        selectedRepoProjectFile: "/repo-a/App.csproj",
      })
    );

    await waitFor(() => {
      expect(result.current.isProjectInfoRefreshing).toBe(false);
    });
    expect(result.current.projectInfo).toBeNull();

    expect(mocks.resolveProjectInfo).toHaveBeenCalledWith(
      "/repo-a/App.csproj",
      {
        silentFailure: true,
      }
    );
    expect(mocks.scanProject).not.toHaveBeenCalled();
  });
});
