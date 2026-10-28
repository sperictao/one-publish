import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  askDialog: vi.fn(),
  openDialog: vi.fn(),
  detectRepositoryProvider: vi.fn(),
  listProviders: vi.fn(),
  scanProjectCandidates: vi.fn(),
  scanRepositoryBranches: vi.fn(),
  openDirectory: vi.fn(),
  addRepository: vi.fn(),
  toastLoading: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: mocks.askDialog,
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
    openDirectory: mocks.openDirectory,
  };
});

import {
  handleAddRepoRuntime,
  handleDetectRepoProviderRuntime,
  handleEditRepoRuntime,
  handleOpenRepoDirectoryRuntime,
  handleRefreshRepoBranchesRuntime,
  handleRemoveRepoRuntime,
  handleScanProjectCandidatesRuntime,
} from "@/features/repository/useRepositoryActions.runtime";
import en from "@/i18n/en.json";
import zh from "@/i18n/zh.json";
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
      translations: {},
      providers,
      repositories: [],
      addRepository: mocks.addRepository,
      ...overrides,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.openDialog.mockResolvedValue("/tmp/demo-repo");
    mocks.detectRepositoryProvider.mockResolvedValue({
      providerId: "dotnet",
      candidates: [{ providerId: "dotnet", matchedMarkers: ["*.csproj"] }],
    });
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

  it.each(["/tmp/demo-repo/.git", "/tmp/demo-repo/.git/"])(
    "选中仓库内的 .git 目录（%s）时归一化为工作区根目录",
    async (selectedPath) => {
      mocks.openDialog.mockResolvedValue(selectedPath);

      const outcome = await runAddRepo();

      expect(mocks.detectRepositoryProvider).toHaveBeenCalledWith(
        "/tmp/demo-repo"
      );
      expect(mocks.addRepository).toHaveBeenCalledWith(
        expect.objectContaining({ name: "demo-repo", path: "/tmp/demo-repo" })
      );
      expect(outcome).toMatchObject({
        status: "added",
        name: "demo-repo",
        path: "/tmp/demo-repo",
      });
    }
  );

  it("Windows 路径下的 .git 目录同样归一化，且重复目录预检按归一化后的路径判断", async () => {
    mocks.openDialog.mockResolvedValue("C:\\work\\demo-repo\\.git");

    await runAddRepo({
      repositories: [
        existingRepo({ name: "demo-repo", path: "C:\\work\\demo-repo" }),
      ],
    });

    expect(mocks.addRepository).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith(
      "添加仓库失败",
      expect.objectContaining({
        description: "该目录已添加为仓库「demo-repo」",
      })
    );
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

  it("混仓多候选时在成功反馈中附备选 Provider 与检测依据", async () => {
    mocks.detectRepositoryProvider.mockResolvedValue({
      providerId: "dotnet",
      candidates: [
        { providerId: "dotnet", matchedMarkers: ["*.csproj"] },
        {
          providerId: "tauri",
          matchedMarkers: ["src-tauri/tauri.conf.json"],
        },
      ],
    });

    await runAddRepo();

    expect(mocks.addRepository).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "dotnet" })
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("仓库已添加", {
      id: expect.any(String),
      description:
        ".NET (dotnet) · feature/auto-detect · /tmp/demo-repo\n同时检测到 tauri (src-tauri/tauri.conf.json)",
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

  it("Provider 不在本地清单也不在远端目录时跳过项目扫描", async () => {
    mocks.detectRepositoryProvider.mockResolvedValue({
      providerId: "mystery-provider",
      candidates: [],
    });
    mocks.listProviders.mockResolvedValue([providers[0]]);

    await runAddRepo({ providers: [] });

    expect(mocks.listProviders).toHaveBeenCalledOnce();
    expect(mocks.scanProjectCandidates).not.toHaveBeenCalled();
    expect(mocks.addRepository).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "mystery-provider" })
    );
  });

  it("远端 Provider 目录拉取失败时按无清单处理并跳过扫描", async () => {
    mocks.detectRepositoryProvider.mockResolvedValue({
      providerId: "mystery-provider",
      candidates: [],
    });
    mocks.listProviders.mockRejectedValue(new Error("offline"));

    await runAddRepo({ providers: [] });

    expect(mocks.scanProjectCandidates).not.toHaveBeenCalled();
    expect(mocks.addRepository).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "mystery-provider" })
    );
  });

  it("crypto.randomUUID 缺失时使用时间戳回退生成仓库 id", async () => {
    vi.stubGlobal("crypto", {});
    try {
      await runAddRepo();
    } finally {
      vi.unstubAllGlobals();
    }

    const repoId = mocks.addRepository.mock.calls[0][0].id;
    expect(repoId).toMatch(/^repo-/);
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
      translations: {},
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
      translations: {},
      path: "/tmp/demo-repo",
    });

    expect(result).toBeNull();
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(mocks.toastError.mock.calls[0][0]).toBe("未识别到支持的 Provider");
  });

  it.each([
    ["path_not_found", "仓库路径不存在"],
    ["not_directory", "Project Root 不是目录"],
    ["permission_denied", "缺少目录访问权限"],
    ["read_failed", "读取项目目录失败"],
  ])("手动检测 %s 失败时给出对应文案", async (code, title) => {
    mocks.detectRepositoryProvider.mockRejectedValue({ code });

    const result = await handleDetectRepoProviderRuntime({
      appT,
      translations: {},
      path: "/tmp/demo-repo",
    });

    expect(result).toBeNull();
    expect(mocks.toastError.mock.calls[0][0]).toBe(title);
  });

  it("无法归类的探测失败走默认文案并本地化错误描述", async () => {
    mocks.detectRepositoryProvider.mockRejectedValue({
      code: "mystery_failure",
      message: "weird backend error",
    });

    const result = await handleDetectRepoProviderRuntime({
      appT,
      translations: {},
      path: "/tmp/demo-repo",
    });

    expect(result).toBeNull();
    expect(mocks.toastError.mock.calls[0][0]).toBe("自动检测 Provider 失败");
    expect(mocks.toastError.mock.calls[0][1]).toEqual({
      description: expect.any(String),
    });
  });
});

describe("handleRemoveRepoRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("原生确认框使用界面语言的按钮文案，而不是系统默认的 Yes/No", async () => {
    mocks.askDialog.mockResolvedValue(false);
    const removeRepository = vi.fn();

    await handleRemoveRepoRuntime({
      appT: {
        removeRepository: "Remove repository",
        removeRepositoryConfirm: 'Remove repository "{{name}}"?',
        removeRepositoryConfirmOk: "Remove",
        removeRepositoryConfirmCancel: "Cancel",
      },
      translations: {},
      repo: existingRepo(),
      removeRepository,
    });

    expect(mocks.askDialog).toHaveBeenCalledWith(
      'Remove repository "demo-repo"?',
      {
        title: "Remove repository",
        kind: "warning",
        okLabel: "Remove",
        cancelLabel: "Cancel",
      }
    );
    expect(removeRepository).not.toHaveBeenCalled();
  });

  it("确认后移除仓库", async () => {
    mocks.askDialog.mockResolvedValue(true);
    const removeRepository = vi.fn().mockResolvedValue(undefined);

    await handleRemoveRepoRuntime({
      appT: {},
      translations: {},
      repo: existingRepo(),
      removeRepository,
    });

    expect(mocks.askDialog.mock.calls[0][1]).toMatchObject({
      okLabel: "移除",
      cancelLabel: "取消",
    });
    expect(removeRepository).toHaveBeenCalledWith("repo-existing");
  });
});

// Tauri invoke 以 AppError 对象 reject；后端 message 恒为中文，界面语言为英文时
// toast 描述应取 `errors.<code>` 的英文文案并附加语言中立的 details。
describe("invoke 失败按界面语言本地化 toast 描述", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.askDialog.mockResolvedValue(true);
  });

  it("打开仓库目录失败：directory_not_found 显示英文文案与路径", async () => {
    mocks.openDirectory.mockRejectedValue({
      kind: "export",
      message: "目录不存在",
      details: "/tmp/gone",
      code: "directory_not_found",
    });

    await handleOpenRepoDirectoryRuntime({
      appT: en.app,
      translations: en,
      repo: existingRepo({ path: "/tmp/gone" }),
    });

    expect(mocks.toastError).toHaveBeenCalledWith(
      "Failed to open repository directory",
      { description: "The directory doesn't exist. | /tmp/gone" }
    );
  });

  it("打开仓库目录失败：中文界面显示中文文案", async () => {
    mocks.openDirectory.mockRejectedValue({
      kind: "export",
      message: "路径不是文件夹",
      details: "/tmp/file.txt",
      code: "directory_not_directory",
    });

    await handleOpenRepoDirectoryRuntime({
      appT: zh.app,
      translations: zh,
      repo: existingRepo({ path: "/tmp/file.txt" }),
    });

    expect(mocks.toastError).toHaveBeenCalledWith("打开仓库目录失败", {
      description: "路径不是文件夹 | /tmp/file.txt",
    });
  });

  it("拉取分支的未分类失败（timeout）显示本地化文案", async () => {
    mocks.scanRepositoryBranches.mockRejectedValue({
      kind: "repository",
      message: "git branch timed out after 5s",
      code: "timeout",
    });

    const result = await handleRefreshRepoBranchesRuntime({
      appT: zh.app,
      translations: zh,
      path: "/tmp/demo-repo",
    });

    expect(result).toBeNull();
    expect(mocks.toastError).toHaveBeenCalledWith("拉取分支失败", {
      description: "Git 命令超时",
    });
  });

  it("添加仓库写库失败：store 错误码本地化并附加底层 IO 错误", async () => {
    mocks.openDialog.mockResolvedValue("/tmp/demo-repo");
    mocks.detectRepositoryProvider.mockResolvedValue({
      providerId: "java",
      candidates: [{ providerId: "java", matchedMarkers: ["build.gradle"] }],
    });
    mocks.listProviders.mockResolvedValue([]);
    mocks.scanProjectCandidates.mockResolvedValue(null);
    mocks.scanRepositoryBranches.mockResolvedValue({
      branches: [],
      current_branch: "main",
    });
    mocks.addRepository.mockRejectedValue({
      kind: "store",
      message: "写入临时文件失败",
      details: "No space left on device (os error 28)",
      code: "store_write_failed",
    });

    const outcome = await handleAddRepoRuntime({
      appT: en.app,
      translations: en,
      providers: [],
      repositories: [],
      addRepository: mocks.addRepository,
    });

    expect(outcome).toEqual({ status: "failed" });
    expect(mocks.toastError).toHaveBeenCalledWith("Failed to add repository", {
      id: expect.any(String),
      description:
        "Couldn't write the settings file. | No space left on device (os error 28)",
    });
  });

  it("更新仓库失败：repository_not_found 显示英文文案与仓库 id", async () => {
    const repo = existingRepo();
    const updateRepository = vi.fn().mockRejectedValue({
      kind: "validation",
      message: "未找到仓库",
      details: "repo-existing",
      code: "repository_not_found",
    });

    const updated = await handleEditRepoRuntime({
      appT: en.app,
      translations: en,
      repo,
      repositories: [repo],
      selectedRepoId: null,
      applySelectedRepositoryProvider: vi.fn(),
      updateRepository,
    });

    expect(updated).toBe(false);
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Failed to update repository",
      {
        description: "Repository not found. | repo-existing",
      }
    );
  });

  it("移除仓库失败：未登记的错误码回落到后端 message 与 details", async () => {
    const removeRepository = vi.fn().mockRejectedValue({
      kind: "store",
      message: "未知存储错误",
      details: "EIO",
      code: "unregistered_store_failure",
    });

    await handleRemoveRepoRuntime({
      appT: en.app,
      translations: en,
      repo: existingRepo(),
      removeRepository,
    });

    expect(mocks.toastError).toHaveBeenCalledWith(
      "Failed to remove repository",
      {
        description: "未知存储错误 | EIO",
      }
    );
  });
});

describe("handleOpenRepoDirectoryRuntime", () => {
  it("rejects an empty repository path", async () => {
    const result = await handleOpenRepoDirectoryRuntime({
      appT: en.app,
      translations: en,
      repo: existingRepo({ path: "   " }),
    });

    expect(result).toBeUndefined();
    expect(mocks.openDirectory).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Project root path is required"
    );
  });

  it("opens the trimmed path and toasts the resolved location", async () => {
    mocks.openDirectory.mockResolvedValue("/tmp/demo-repo");

    await handleOpenRepoDirectoryRuntime({
      appT: en.app,
      translations: en,
      repo: existingRepo({ path: "  /tmp/demo-repo  " }),
    });

    expect(mocks.openDirectory).toHaveBeenCalledWith("/tmp/demo-repo");
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Repository directory opened",
      { description: "/tmp/demo-repo" }
    );
  });

  it("toasts the localized failure when opening fails", async () => {
    mocks.openDirectory.mockRejectedValue({
      code: "denied",
      message: "denied io",
    });

    await handleOpenRepoDirectoryRuntime({
      appT: en.app,
      translations: en,
      repo: existingRepo(),
    });

    expect(mocks.toastError).toHaveBeenCalledWith(
      "Failed to open repository directory",
      { description: expect.stringContaining("denied io") }
    );
  });
});

describe("handleEditRepoRuntime", () => {
  const baseParams = () => ({
    appT: en.app,
    translations: en,
    repo: existingRepo(),
    repositories: [existingRepo()],
    selectedRepoId: null as string | null,
    applySelectedRepositoryProvider: vi.fn(),
    updateRepository: vi.fn().mockResolvedValue(undefined),
  });

  it("errors when the edited repo is not in the store", async () => {
    const params = baseParams();
    params.repositories = [];

    const result = await handleEditRepoRuntime(params);

    expect(result).toBe(false);
    expect(mocks.toastError).toHaveBeenCalledWith("Repository not found");
  });

  it("rejects blank name or path", async () => {
    const params = baseParams();
    params.repo = existingRepo({ name: "  " });
    params.repositories = [params.repo];

    const result = await handleEditRepoRuntime(params);

    expect(result).toBe(false);
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Repository name and path are required"
    );
    expect(params.updateRepository).not.toHaveBeenCalled();
  });

  it("normalizes fields, remaps the project file, and applies a selected provider", async () => {
    const params = baseParams();
    params.repo = existingRepo({
      name: " renamed ",
      path: " /tmp/moved ",
      projectFile: "/tmp/demo-repo/src/App.csproj",
      providerId: " dotnet ",
    });
    params.repositories = [existingRepo()];
    params.selectedRepoId = "repo-existing";

    const result = await handleEditRepoRuntime(params);

    expect(result).toBe(true);
    expect(params.updateRepository).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "renamed",
        path: "/tmp/moved",
        projectFile: "/tmp/moved/src/App.csproj",
        providerId: "dotnet",
      })
    );
    expect(params.applySelectedRepositoryProvider).toHaveBeenCalledWith(
      "dotnet"
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Repository info updated", {
      description: "renamed",
    });
  });

  it("skips provider application when the repo is not selected", async () => {
    const params = baseParams();

    await handleEditRepoRuntime(params);

    expect(params.applySelectedRepositoryProvider).not.toHaveBeenCalled();
  });

  it("maps a repository_exists failure to the dedicated copy", async () => {
    const params = baseParams();
    params.updateRepository.mockRejectedValue({
      code: "repository_exists",
      message: "dup",
    });

    const result = await handleEditRepoRuntime(params);

    expect(result).toBe(false);
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Failed to update repository",
      { description: "This directory is already a repository" }
    );
  });

  it("空白项目文件归一化为 undefined", async () => {
    const params = baseParams();
    params.repo = existingRepo({ projectFile: "   " });
    params.repositories = [params.repo];

    const result = await handleEditRepoRuntime(params);

    expect(result).toBe(true);
    expect(params.updateRepository).toHaveBeenCalledWith(
      expect.objectContaining({ projectFile: undefined })
    );
  });

  it("仓库路径变更时分支路径同步重映射", async () => {
    const params = baseParams();
    params.repo = existingRepo({
      path: "/tmp/moved",
      branches: [
        { name: "main", isMain: true, isCurrent: true, path: "/tmp/demo-repo" },
      ],
    });
    params.repositories = [existingRepo()];

    const result = await handleEditRepoRuntime(params);

    expect(result).toBe(true);
    expect(params.updateRepository).toHaveBeenCalledWith(
      expect.objectContaining({
        branches: [
          expect.objectContaining({ name: "main", path: "/tmp/moved" }),
        ],
      })
    );
  });
});

describe("handleDetectRepoProviderRuntime", () => {
  it("rejects an empty path", async () => {
    const result = await handleDetectRepoProviderRuntime({
      appT: en.app,
      translations: en,
      path: "  ",
    });

    expect(result).toBeNull();
    expect(mocks.detectRepositoryProvider).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Project root path is required"
    );
  });

  it("toasts the detected provider plus alternatives on success", async () => {
    mocks.detectRepositoryProvider.mockResolvedValue({
      providerId: "dotnet",
      candidates: [
        { providerId: "dotnet", matchedMarkers: ["*.csproj"] },
        { providerId: "java", matchedMarkers: ["build.gradle"] },
      ],
    });

    const result = await handleDetectRepoProviderRuntime({
      appT: en.app,
      translations: en,
      path: "/tmp/repo",
    });

    expect(result).toBe("dotnet");
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Provider detected", {
      description: expect.stringContaining("dotnet"),
    });
  });

  it("suppresses the success toast when silentSuccess is set", async () => {
    mocks.detectRepositoryProvider.mockResolvedValue({
      providerId: "dotnet",
      candidates: [],
    });

    const result = await handleDetectRepoProviderRuntime({
      appT: en.app,
      translations: en,
      path: "/tmp/repo",
      options: { silentSuccess: true },
    });

    expect(result).toBe("dotnet");
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("swallows failures when silentFailure is set", async () => {
    mocks.detectRepositoryProvider.mockRejectedValue(new Error("boom"));

    const result = await handleDetectRepoProviderRuntime({
      appT: en.app,
      translations: en,
      path: "/tmp/repo",
      options: { silentFailure: true },
    });

    expect(result).toBeNull();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("resolves a typed failure to dedicated copy", async () => {
    mocks.detectRepositoryProvider.mockRejectedValue({
      code: "path_not_found",
      message: "gone",
    });

    const result = await handleDetectRepoProviderRuntime({
      appT: en.app,
      translations: en,
      path: "/tmp/repo",
    });

    expect(result).toBeNull();
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Project root path not found",
      {
        description: "Ensure the project root path exists and is accessible.",
      }
    );
  });
});

describe("handleScanProjectCandidatesRuntime", () => {
  it("returns null for empty paths, scan failures, and passes results through", async () => {
    expect(await handleScanProjectCandidatesRuntime("   ")).toBeNull();
    expect(mocks.scanProjectCandidates).not.toHaveBeenCalled();

    mocks.scanProjectCandidates.mockRejectedValue(new Error("io"));
    expect(await handleScanProjectCandidatesRuntime("/tmp/repo")).toBeNull();

    const candidates = { rootPath: "/tmp/repo", projectFiles: [] };
    mocks.scanProjectCandidates.mockResolvedValue(candidates);
    expect(
      await handleScanProjectCandidatesRuntime("/tmp/repo", "dotnet")
    ).toBe(candidates);
    expect(mocks.scanProjectCandidates).toHaveBeenLastCalledWith(
      "/tmp/repo",
      "dotnet"
    );
  });
});

describe("handleRefreshRepoBranchesRuntime", () => {
  const runRefresh = (overrides = {}) =>
    handleRefreshRepoBranchesRuntime({
      appT: en.app,
      translations: en,
      path: "/tmp/repo",
      ...overrides,
    });

  it("rejects an empty path", async () => {
    expect(await runRefresh({ path: " " })).toBeNull();
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Project root path is required"
    );
  });

  it("returns the refreshed branches and toasts the count", async () => {
    mocks.scanRepositoryBranches.mockResolvedValue({
      current_branch: "main",
      branches: [
        {
          name: "main",
          isMain: true,
          isCurrent: true,
          path: "/tmp/repo",
          commitCount: 12,
        },
      ],
    });

    const result = await runRefresh();

    expect(result).toEqual({
      currentBranch: "main",
      branches: [expect.objectContaining({ name: "main", commitCount: 12 })],
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Branches refreshed", {
      description: "1 branches",
    });
  });

  it("suppresses the success toast when silentSuccess is set", async () => {
    mocks.scanRepositoryBranches.mockResolvedValue({
      current_branch: "main",
      branches: [],
    });

    await runRefresh({ options: { silentSuccess: true } });

    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it.each([
    ["path_not_found", "Repository path not found"],
    ["not_directory", "Repository path is not a directory"],
    ["git_missing", "Git command is not available"],
    ["cannot_connect_repo", "Unable to connect to Git repository"],
    ["not_git_repo", "Target path is not a Git repository"],
    ["permission_denied", "Insufficient repository permissions"],
    ["dubious_ownership", "Git ownership validation failed"],
    ["no_branches", "No branches were found"],
  ])("maps %s failures to dedicated copy", async (code, title) => {
    mocks.scanRepositoryBranches.mockRejectedValue({ code, message: "x" });

    expect(await runRefresh()).toBeNull();
    expect(mocks.toastError).toHaveBeenCalledWith(title, {
      description: expect.any(String),
    });
  });

  it("falls back to localized copy for unknown failures", async () => {
    mocks.scanRepositoryBranches.mockRejectedValue(
      new Error("network exploded")
    );

    expect(await runRefresh()).toBeNull();
    expect(mocks.toastError).toHaveBeenCalledWith("Failed to pull branches", {
      description: expect.stringContaining("network exploded"),
    });
  });

  it.each([
    ["path_not_found", "仓库路径不存在"],
    ["not_directory", "仓库路径不是目录"],
    ["git_missing", "未检测到 Git 命令"],
    ["cannot_connect_repo", "无法连接 Git 仓库"],
    ["not_git_repo", "该目录不是 Git 仓库"],
    ["permission_denied", "缺少仓库访问权限"],
    ["dubious_ownership", "仓库所有权校验失败"],
    ["no_branches", "未读取到分支"],
  ])("i18n 键缺失时 %s 回落到内置中文文案", async (code, title) => {
    mocks.scanRepositoryBranches.mockRejectedValue({ code, message: "x" });

    expect(await runRefresh({ appT: {} })).toBeNull();
    expect(mocks.toastError).toHaveBeenCalledWith(title, {
      description: expect.any(String),
    });
  });

  it("i18n 键缺失时未知失败回落到默认中文文案", async () => {
    mocks.scanRepositoryBranches.mockRejectedValue(
      new Error("network exploded")
    );

    expect(await runRefresh({ appT: {} })).toBeNull();
    expect(mocks.toastError).toHaveBeenCalledWith("拉取分支失败", {
      description: expect.any(String),
    });
  });

  it("i18n 键缺失时空路径与成功反馈回落到内置中文文案", async () => {
    expect(await runRefresh({ appT: {}, path: " " })).toBeNull();
    expect(mocks.toastError).toHaveBeenCalledWith("请输入 Project Root 路径");

    mocks.scanRepositoryBranches.mockResolvedValue({
      current_branch: "main",
      branches: [
        { name: "main", isMain: true, isCurrent: true, path: "/tmp/repo" },
        { name: "dev", isMain: false, isCurrent: false, path: "/tmp/repo" },
      ],
    });

    expect(await runRefresh({ appT: {} })).not.toBeNull();
    expect(mocks.toastSuccess).toHaveBeenCalledWith("分支列表已刷新", {
      description: "2个分支",
    });
  });
});
