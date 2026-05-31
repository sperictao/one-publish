import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openDialog: vi.fn(),
  detectRepositoryProvider: vi.fn(),
  scanProjectCandidates: vi.fn(),
  scanRepositoryBranches: vi.fn(),
  addRepository: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn(),
  open: mocks.openDialog,
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

vi.mock("@/lib/store/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/store/api")>("@/lib/store/api");
  return {
    ...actual,
    detectRepositoryProvider: mocks.detectRepositoryProvider,
    scanProjectCandidates: mocks.scanProjectCandidates,
    scanRepositoryBranches: mocks.scanRepositoryBranches,
  };
});

import { handleAddRepoRuntime } from "@/features/repository/useRepositoryActions.runtime";

describe("handleAddRepoRuntime", () => {
  const providers = [
    {
      id: "dotnet",
      displayName: ".NET (dotnet)",
      version: "1.0.0",
      label: ".NET (dotnet)",
      commandExample: "dotnet publish App.csproj",
      environmentLabel: ".NET",
      environmentDescription: "dotnet SDK",
      requiresProjectBinding: true,
      projectPathKind: "project_file" as const,
      supportsCommandImport: true,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.openDialog.mockResolvedValue("/tmp/demo-repo");
    mocks.detectRepositoryProvider.mockResolvedValue("dotnet");
    mocks.scanProjectCandidates.mockResolvedValue({
      rootPath: "/tmp/demo-repo",
      solutionFiles: [],
      projectFiles: ["/tmp/demo-repo/src/App/App.csproj"],
      recommendedProjectFile: "/tmp/demo-repo/src/App/App.csproj",
    });
    mocks.scanRepositoryBranches.mockResolvedValue({
      currentBranch: "feature/auto-detect",
      branches: [
        {
          name: "main",
          isMain: true,
          isCurrent: false,
          path: "/tmp/demo-repo",
        },
        {
          name: "feature/auto-detect",
          isMain: false,
          isCurrent: true,
          path: "/tmp/demo-repo",
        },
      ],
    });
    mocks.addRepository.mockResolvedValue(undefined);
  });

  it("新增仓库时会自动写入 providerId、projectFile 和当前分支", async () => {
    await handleAddRepoRuntime({
      appT: {
        selectRepositoryDirectory: "选择仓库目录",
        repositoryAdded: "仓库已添加",
      },
      providers,
      addRepository: mocks.addRepository,
    });

    expect(mocks.detectRepositoryProvider).toHaveBeenCalledWith("/tmp/demo-repo");
    expect(mocks.scanProjectCandidates).toHaveBeenCalledWith("/tmp/demo-repo");
    expect(mocks.scanRepositoryBranches).toHaveBeenCalledWith("/tmp/demo-repo", {
      refreshRemote: false,
    });
    expect(mocks.addRepository).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "demo-repo",
        path: "/tmp/demo-repo",
        providerId: "dotnet",
        projectFile: "/tmp/demo-repo/src/App/App.csproj",
        currentBranch: "feature/auto-detect",
        branches: expect.arrayContaining([
          expect.objectContaining({ name: "feature/auto-detect", isCurrent: true }),
        ]),
      })
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("仓库已添加", {
      description: "demo-repo",
    });
  });

  it("自动识别失败时会回退到默认分支并允许继续添加", async () => {
    mocks.scanProjectCandidates.mockRejectedValue(new Error("scan failed"));
    mocks.scanRepositoryBranches.mockRejectedValue(new Error("git failed"));

    await handleAddRepoRuntime({
      appT: {
        selectRepositoryDirectory: "选择仓库目录",
        repositoryAdded: "仓库已添加",
      },
      providers,
      addRepository: mocks.addRepository,
    });

    expect(mocks.addRepository).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "demo-repo",
        path: "/tmp/demo-repo",
        providerId: "dotnet",
        projectFile: undefined,
        currentBranch: "main",
        branches: [
          {
            name: "main",
            isMain: true,
            isCurrent: true,
            path: "/tmp/demo-repo",
          },
        ],
      })
    );
  });
});
