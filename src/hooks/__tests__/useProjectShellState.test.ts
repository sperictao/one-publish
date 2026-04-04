import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectInfo } from "@/types/project";

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

vi.mock("@/hooks/useProjectScanner", () => ({
  useProjectScanner: () => ({
    scanProject: mocks.scanProject,
    resolveProjectInfo: mocks.resolveProjectInfo,
  }),
}));

import { useProjectShellState } from "@/hooks/useProjectShellState";

type HookProps = {
  selectedRepoId: string | null;
  selectedRepoPath?: string;
  selectedRepoProjectFile?: string;
  activeProviderId: string;
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
          activeProviderId: "dotnet",
        },
      }
    );

    rerender({
      selectedRepoId: "repo-b",
      selectedRepoPath: "/repo-b",
      selectedRepoProjectFile: undefined,
      activeProviderId: "dotnet",
    });

    await act(async () => {
      repoB.resolve(createProjectInfo("/repo-b"));
    });

    await waitFor(() => {
      expect(result.current.projectInfo?.project_file).toBe("/repo-b/App.csproj");
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
          activeProviderId: "dotnet",
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
      expect(result.current.projectInfo?.project_file).toBe("/repo-a/App.csproj");
    });

    rerender({
      selectedRepoId: "repo-b",
      selectedRepoPath: "/repo-b",
      selectedRepoProjectFile: undefined,
      activeProviderId: "dotnet",
    });

    await waitFor(() => {
      expect(result.current.isProjectInfoRefreshing).toBe(true);
    });

    await act(async () => {
      repoB.resolve(createProjectInfo("/repo-b"));
    });

    await waitFor(() => {
      expect(result.current.isProjectInfoRefreshing).toBe(false);
      expect(result.current.projectInfo?.project_file).toBe("/repo-b/App.csproj");
    });
  });

  it("仓库被清空时会立即清除当前项目信息", async () => {
    mocks.scanProject.mockResolvedValue(createProjectInfo("/repo-a"));
    const initialProps: Omit<HookProps, "activeProviderId"> = {
      selectedRepoId: "repo-a",
      selectedRepoPath: "/repo-a",
      selectedRepoProjectFile: undefined,
    };

    const { result, rerender } = renderHook(
      (props: Omit<HookProps, "activeProviderId">) =>
        useProjectShellState({
          appT: {},
          isStateLoading: false,
          activeProviderId: "dotnet",
          ...props,
        }),
      {
        initialProps,
      }
    );

    await waitFor(() => {
      expect(result.current.projectInfo?.project_file).toBe("/repo-a/App.csproj");
    });

    rerender({
      selectedRepoId: null,
      selectedRepoPath: undefined,
      selectedRepoProjectFile: undefined,
    } satisfies Omit<HookProps, "activeProviderId">);

    expect(result.current.projectInfo).toBeNull();
  });

  it("存在显式 projectFile 绑定时优先解析绑定项目", async () => {
    mocks.resolveProjectInfo.mockResolvedValue(createProjectInfo("/repo-bound"));

    const { result } = renderHook(() =>
      useProjectShellState({
        appT: {},
        isStateLoading: false,
        selectedRepoId: "repo-a",
        selectedRepoPath: "/repo-a",
        selectedRepoProjectFile: "/repo-bound/App.csproj",
        activeProviderId: "dotnet",
      })
    );

    await waitFor(() => {
      expect(result.current.projectInfo?.project_file).toBe(
        "/repo-bound/App.csproj"
      );
    });

    expect(mocks.resolveProjectInfo).toHaveBeenCalledWith("/repo-bound/App.csproj", {
      silentFailure: true,
    });
    expect(mocks.scanProject).not.toHaveBeenCalled();
  });

  it("绑定的是 .sln 时会回退扫描真实项目文件", async () => {
    mocks.scanProject.mockResolvedValue(createProjectInfo("/repo-a"));

    const { result } = renderHook(() =>
      useProjectShellState({
        appT: {},
        isStateLoading: false,
        selectedRepoId: "repo-a",
        selectedRepoPath: "/repo-a",
        selectedRepoProjectFile: "/repo-a/App.sln",
        activeProviderId: "dotnet",
      })
    );

    await waitFor(() => {
      expect(result.current.projectInfo?.project_file).toBe("/repo-a/App.csproj");
    });

    expect(mocks.resolveProjectInfo).not.toHaveBeenCalled();
    expect(mocks.scanProject).toHaveBeenCalledWith("/repo-a", {
      silentSuccess: true,
      silentFailure: true,
    });
  });

  it("绑定项目解析失败时会回退仓库扫描", async () => {
    mocks.resolveProjectInfo.mockResolvedValue(null);
    mocks.scanProject.mockResolvedValue(createProjectInfo("/repo-fallback"));

    const { result } = renderHook(() =>
      useProjectShellState({
        appT: {},
        isStateLoading: false,
        selectedRepoId: "repo-a",
        selectedRepoPath: "/repo-a",
        selectedRepoProjectFile: "/repo-a/App.csproj",
        activeProviderId: "dotnet",
      })
    );

    await waitFor(() => {
      expect(result.current.projectInfo?.project_file).toBe(
        "/repo-fallback/App.csproj"
      );
    });

    expect(mocks.resolveProjectInfo).toHaveBeenCalledWith("/repo-a/App.csproj", {
      silentFailure: true,
    });
    expect(mocks.scanProject).toHaveBeenCalledWith("/repo-a", {
      silentSuccess: true,
      silentFailure: true,
    });
  });
});
