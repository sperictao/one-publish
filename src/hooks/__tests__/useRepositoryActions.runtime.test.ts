import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openDialog: vi.fn(),
  detectRepositoryProvider: vi.fn(),
  listProviders: vi.fn(),
  scanProjectCandidates: vi.fn(),
  scanRepositoryBranches: vi.fn(),
  addRepository: vi.fn(),
  toastLoading: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn(),
  open: mocks.openDialog,
}));

vi.mock("sonner", () => ({
  toast: {
    loading: mocks.toastLoading,
    success: mocks.toastSuccess,
    error: mocks.toastError,
    warning: mocks.toastWarning,
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

import {
  handleAddRepoRuntime,
  handleDetectRepoProviderRuntime,
} from "@/features/repository/useRepositoryActions.runtime";
import { defaultRepoPublishConfig } from "@/lib/store/types";
import type { Repository } from "@/lib/store/types";

type AddRepoParams = Parameters<typeof handleAddRepoRuntime>[0];

function existingRepo(overrides: Partial<Repository> = {}): Repository {
  return {
    id: "repo-existing",
    name: "demo-repo",
    path: "/tmp/demo-repo",
    currentBranch: "main",
    branches: [],
    publishConfig: { ...defaultRepoPublishConfig },
    ...overrides,
  };
}

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
    {
      id: "java",
      displayName: "java",
      version: "1",
      label: "Java (Gradle)",
      commandExample: "./gradlew build --info",
      environmentLabel: "Java (Gradle)",
      environmentDescription: "gradle / java runtime",
      requiresProjectBinding: false,
      projectPathKind: "repository_root" as const,
      supportsCommandImport: true,
    },
  ];

  const appT = {
    selectRepositoryDirectory: "选择仓库目录",
    addingRepository: "正在检测仓库…",
    addingRepositoryDesc: "正在识别 Provider 并读取分支…",
    repositoryAdded: "仓库已添加",
    repositoryAddedNeedsProvider: "已添加仓库，请手动选择 Provider",
    repositoryAddedNeedsProviderDesc:
      "未识别到支持的 Provider，已打开编辑窗口。",
    addRepositoryFailed: "添加仓库失败",
    repositoryAlreadyExists: "该目录已添加为仓库",
    repositoryAlreadyExistsNamed: "该目录已添加为仓库「{{name}}」",
    providerDetectUnsupported: "未识别到支持的 Provider",
    providerDetectUnsupportedDesc: "可手动选择 Provider。",
    providerDetectPathNotFound: "仓库路径不存在",
    providerDetectPathNotFoundDesc: "请确认 Project Root 路径存在且可访问。",
  };

  function runAddRepo(overrides: Partial<AddRepoParams> = {}) {
    return handleAddRepoRuntime({
      appT,
      providers,
      repositories: [],
      addRepository: mocks.addRepository,
      ...overrides,
    });
  }

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
    const outcome = await runAddRepo();

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
    expect(outcome).toMatchObject({ status: "added" });
  });

  it("provider 列表尚未加载但已检测到 dotnet 时仍会扫描并绑定推荐项目", async () => {
    await runAddRepo({ providers: [] });

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

    await runAddRepo();

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

    await runAddRepo();

    expect(mocks.addRepository).toHaveBeenCalledWith(
      expect.objectContaining({
        projectFile: undefined,
      })
    );
  });

  // ── H1 / M7：进行中反馈与同一条 toast 的演进 ─────────────────────────

  it("选用目录后立即给出 loading 反馈，成功时复用同一个 toast id", async () => {
    const outcome = await runAddRepo();

    expect(mocks.toastLoading).toHaveBeenCalledTimes(1);
    const loadingOptions = mocks.toastLoading.mock.calls[0][1];
    expect(typeof loadingOptions?.id).toBe("string");
    expect(loadingOptions.id.length).toBeGreaterThan(0);

    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
    expect(mocks.toastSuccess.mock.calls[0][1]?.id).toBe(loadingOptions.id);
    // 同一条 toast 演进，不会同时留下 loading 与 success 两条
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: "added" });
  });

  it("成功反馈回显 Provider 展示名、分支与完整路径", async () => {
    await runAddRepo();

    expect(mocks.toastSuccess).toHaveBeenCalledWith("仓库已添加", {
      id: expect.any(String),
      description: ".NET (dotnet) · feature/auto-detect · /tmp/demo-repo",
    });
  });

  it("取消目录选择时不产生任何 toast", async () => {
    mocks.openDialog.mockResolvedValue(null);

    const outcome = await runAddRepo();

    expect(outcome).toEqual({ status: "cancelled" });
    expect(mocks.toastLoading).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.toastWarning).not.toHaveBeenCalled();
    expect(mocks.addRepository).not.toHaveBeenCalled();
  });

  it("目录选择器自身报错时给出可读反馈而不是未处理的 rejection", async () => {
    mocks.openDialog.mockRejectedValue(new Error("dialog unavailable"));

    const outcome = await runAddRepo();

    expect(outcome).toEqual({ status: "failed" });
    expect(mocks.toastError).toHaveBeenCalledWith("无法打开目录选择器", {
      description: "dialog unavailable",
    });
    expect(mocks.addRepository).not.toHaveBeenCalled();
  });

  // ── H2：Provider 识别失败不再是死路 ────────────────────────────────

  it("未识别到 Provider 时仍然落库，并提示手动选择 Provider", async () => {
    mocks.detectRepositoryProvider.mockRejectedValue({
      kind: "provider",
      message: "cannot detect provider from repository path",
      code: "unsupported_provider",
    });

    const outcome = await runAddRepo();

    expect(mocks.addRepository).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/tmp/demo-repo",
        providerId: undefined,
      })
    );
    expect(outcome).toMatchObject({
      status: "needs-provider",
      path: "/tmp/demo-repo",
    });
    expect(mocks.toastWarning).toHaveBeenCalledWith(
      "已添加仓库，请手动选择 Provider",
      {
        id: expect.any(String),
        description: "未识别到支持的 Provider，已打开编辑窗口。",
      }
    );
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("Provider 留空时不再探测项目文件（避免无意义的 IPC 往返）", async () => {
    mocks.detectRepositoryProvider.mockRejectedValue({
      code: "unsupported_provider",
    });

    await runAddRepo();

    expect(mocks.scanProjectCandidates).not.toHaveBeenCalled();
    expect(mocks.listProviders).not.toHaveBeenCalled();
  });

  it("路径不存在这类真实失败仍然中断，不会落库", async () => {
    mocks.detectRepositoryProvider.mockRejectedValue({
      kind: "repository",
      message: "repository path does not exist",
      code: "path_not_found",
    });

    const outcome = await runAddRepo();

    expect(outcome).toEqual({ status: "failed" });
    expect(mocks.addRepository).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith("仓库路径不存在", {
      id: expect.any(String),
      description: "请确认 Project Root 路径存在且可访问。",
    });
  });

  // ── H3 / M6：写库失败不再泄漏原始错误负载 ──────────────────────────

  it("后端以 repository_exists 拒绝时给出可读文案，而不是错误负载 JSON", async () => {
    mocks.addRepository.mockRejectedValue({
      kind: "validation",
      message: "仓库已存在",
      code: "repository_exists",
    });

    const outcome = await runAddRepo();

    expect(outcome).toEqual({ status: "failed" });
    const [, errorOptions] = mocks.toastError.mock.calls[0];
    expect(errorOptions.description).toBe("该目录已添加为仓库");
    expect(errorOptions.description).not.toContain("{");
    expect(errorOptions.description).not.toContain("repository_exists");
    // 失败同样复用 loading 的那条 toast
    expect(errorOptions.id).toBe(mocks.toastLoading.mock.calls[0][1].id);
  });

  it("未知写库错误只回显后端 message，不渲染序列化负载", async () => {
    mocks.addRepository.mockRejectedValue({
      kind: "io",
      message: "failed to persist state",
      code: "persist_failed",
    });

    await runAddRepo();

    const [, errorOptions] = mocks.toastError.mock.calls[0];
    expect(errorOptions.description).toBe("failed to persist state");
  });

  it("前端预检拦截重复目录（尾部分隔符写法不同），不调用后端", async () => {
    const outcome = await runAddRepo({
      repositories: [existingRepo()],
    });

    expect(outcome).toEqual({ status: "failed" });
    expect(mocks.addRepository).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith("添加仓库失败", {
      id: expect.any(String),
      description: "该目录已添加为仓库「demo-repo」",
    });
  });

  it("同一目录用尾部分隔符重复添加时后端错误被归一化拦截", async () => {
    mocks.openDialog.mockResolvedValue("/tmp/demo-repo/");
    mocks.addRepository.mockRejectedValue({ code: "repository_exists" });

    const outcome = await runAddRepo();

    expect(outcome).toEqual({ status: "failed" });
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(mocks.toastError.mock.calls[0][1].description).toBe(
      "该目录已添加为仓库"
    );
  });

  // ── L1：仓库 id 不能在同一毫秒内碰撞 ───────────────────────────────

  it("连续添加两次不会得到相同的仓库 id", async () => {
    await runAddRepo();
    const firstRepo = mocks.addRepository.mock.calls[0][0];

    mocks.addRepository.mockClear();
    mocks.detectRepositoryProvider.mockRejectedValue({
      code: "unsupported_provider",
    });
    await runAddRepo();
    const secondRepo = mocks.addRepository.mock.calls[0][0];

    expect(firstRepo.id).toBeTruthy();
    expect(secondRepo.id).toBeTruthy();
    expect(firstRepo.id).not.toBe(secondRepo.id);
  });
});

describe("handleDetectRepoProviderRuntime", () => {
  const appT: Record<string, string> = {
    providerDetected: "已自动检测 Provider",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("自动探测（silentFailure）失败时不弹错误，只返回 null", async () => {
    mocks.detectRepositoryProvider.mockRejectedValue({
      code: "unsupported_provider",
    });

    const result = await handleDetectRepoProviderRuntime({
      appT,
      path: "/tmp/demo-repo",
      options: { silentSuccess: true, silentFailure: true },
    });

    expect(result).toBeNull();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("手动检测失败时仍然给出可读文案", async () => {
    mocks.detectRepositoryProvider.mockRejectedValue({
      code: "unsupported_provider",
    });

    const result = await handleDetectRepoProviderRuntime({
      appT,
      path: "/tmp/demo-repo",
    });

    expect(result).toBeNull();
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(mocks.toastError.mock.calls[0][0]).toBe("未识别到支持的 Provider");
  });
});
