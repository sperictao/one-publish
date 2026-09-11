import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openDialog: vi.fn(),
  detectRepositoryProvider: vi.fn(),
  listProviders: vi.fn(),
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
  const actual =
    await vi.importActual<typeof import("@/lib/store/api")>("@/lib/store/api");
  return {
    ...actual,
    detectRepositoryProvider: mocks.detectRepositoryProvider,
    listProviders: mocks.listProviders,
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
    mocks.listProviders.mockResolvedValue(providers);
    mocks.scanProjectCandidates.mockResolvedValue({
      rootPath: "/tmp/demo-repo",
      solutionFiles: [],
      projectFiles: [
        "/tmp/demo-repo/src/App/App.csproj",
        "/tmp/demo-repo/tests/App.Tests.csproj",
      ],
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

    expect(mocks.detectRepositoryProvider).toHaveBeenCalledWith(
      "/tmp/demo-repo"
    );
    expect(mocks.listProviders).not.toHaveBeenCalled();
    expect(mocks.scanProjectCandidates).toHaveBeenCalledWith(
      "/tmp/demo-repo",
      "dotnet"
    );
    expect(mocks.scanRepositoryBranches).toHaveBeenCalledWith(
      "/tmp/demo-repo",
      {
        refreshRemote: false,
      }
    );
    expect(mocks.addRepository).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "demo-repo",
        path: "/tmp/demo-repo",
        providerId: "dotnet",
        projectFile: "/tmp/demo-repo/src/App/App.csproj",
        currentBranch: "feature/auto-detect",
        branches: expect.arrayContaining([
          expect.objectContaining({
            name: "feature/auto-detect",
            isCurrent: true,
          }),
        ]),
      })
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("仓库已添加", {
      description: "demo-repo",
    });
  });

  it("provider 列表尚未加载但已检测到 dotnet 时仍会扫描并绑定推荐项目", async () => {
    await handleAddRepoRuntime({
      appT: {
        selectRepositoryDirectory: "选择仓库目录",
        repositoryAdded: "仓库已添加",
      },
      providers: [],
      addRepository: mocks.addRepository,
    });

    expect(mocks.detectRepositoryProvider).toHaveBeenCalledWith(
      "/tmp/demo-repo"
    );
    expect(mocks.listProviders).toHaveBeenCalledOnce();
    expect(mocks.scanProjectCandidates).toHaveBeenCalledWith(
      "/tmp/demo-repo",
      "dotnet"
    );
    expect(mocks.addRepository).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "dotnet",
        projectFile: "/tmp/demo-repo/src/App/App.csproj",
      })
    );
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

  it("没有后端推荐项目时不会从单个候选项目自行推断绑定", async () => {
    mocks.scanProjectCandidates.mockResolvedValue({
      rootPath: "/tmp/demo-repo",
      solutionFiles: [],
      projectFiles: ["/tmp/demo-repo/src/App/App.csproj"],
      recommendedProjectFile: undefined,
    });

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
        projectFile: undefined,
      })
    );
  });

  it("重复路径（repository_exists）提示仓库已存在而非原始错误", async () => {
    mocks.addRepository.mockRejectedValue({
      code: "repository_exists",
      message: "仓库已存在",
    });

    await handleAddRepoRuntime({
      appT: {
        selectRepositoryDirectory: "选择仓库目录",
        repositoryAdded: "仓库已添加",
        repositoryAlreadyExists: "仓库已存在",
      },
      providers,
      addRepository: mocks.addRepository,
    });

    expect(mocks.toastError).toHaveBeenCalledWith("仓库已存在", {
      description: "/tmp/demo-repo",
    });
    expect(mocks.toastError).not.toHaveBeenCalledWith(
      "添加仓库失败",
      expect.anything()
    );
  });

  it("添加流程检测失败使用专用文案，不引导不存在的手动入口", async () => {
    mocks.detectRepositoryProvider.mockRejectedValue(
      new Error("cannot detect provider from repository path")
    );

    await handleAddRepoRuntime({
      appT: {
        selectRepositoryDirectory: "选择仓库目录",
        addRepoProviderDetectUnsupported: "未识别到支持的 Provider",
        addRepoProviderDetectUnsupportedDesc:
          "未添加仓库。请确认所选目录包含 Provider 识别的项目文件（如 .sln、.csproj、build.gradle），然后重新添加。",
      },
      providers,
      addRepository: mocks.addRepository,
    });

    expect(mocks.toastError).toHaveBeenCalledWith("未识别到支持的 Provider", {
      description:
        "未添加仓库。请确认所选目录包含 Provider 识别的项目文件（如 .sln、.csproj、build.gradle），然后重新添加。",
    });
    expect(mocks.toastError).not.toHaveBeenCalledWith(
      "未识别到支持的 Provider",
      {
        description:
          "可手动选择 Provider，或确认项目根目录下包含可识别的构建文件。",
      }
    );
    expect(mocks.addRepository).not.toHaveBeenCalled();
  });
});
