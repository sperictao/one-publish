import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectInfo } from "@/types/project";

const mocks = vi.hoisted(() => ({
  scanProject: vi.fn(),
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
  }),
}));

import { useProjectShellState } from "@/hooks/useProjectShellState";

type HookProps = {
  selectedRepoId: string | null;
  selectedRepoPath?: string;
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
          activeProviderId: "dotnet",
        },
      }
    );

    rerender({
      selectedRepoId: "repo-b",
      selectedRepoPath: "/repo-b",
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

  it("仓库被清空时会立即清除当前项目信息", async () => {
    mocks.scanProject.mockResolvedValue(createProjectInfo("/repo-a"));
    const initialProps: Omit<HookProps, "activeProviderId"> = {
      selectedRepoId: "repo-a",
      selectedRepoPath: "/repo-a",
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
    } satisfies Omit<HookProps, "activeProviderId">);

    expect(result.current.projectInfo).toBeNull();
  });
});
