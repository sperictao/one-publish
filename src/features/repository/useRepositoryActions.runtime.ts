import { ask, open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";

import { defaultRepoPublishConfig } from "@/lib/store/types";
import {
  detectRepositoryProvider,
  listProviders,
  openDirectory,
  scanProjectCandidates,
  scanRepositoryBranches,
} from "@/lib/store/api";
import type { ProviderManifest } from "@/lib/store/types";
import { getPathBasename, isSameRepositoryPath } from "@/lib/paths";
import {
  providerRequiresProjectBinding,
  resolveProviderLabel,
} from "@/features/provider/providers";
import { remapPathPrefix } from "@/features/repository/utils/pathUtils";
import {
  analyzeBranchRefreshFailure,
  analyzeProviderDetectFailure,
  analyzeRepositoryWriteFailure,
  extractInvokeErrorMessage,
} from "@/lib/tauri/invokeErrors";
import type { ProviderDetectFailureReason } from "@/lib/tauri/invokeErrors";
import type { ProjectScanCandidates } from "@/lib/store/types";
import type { Branch, Repository } from "@/lib/store/types";
import type { RepositoryBranchScanResult } from "@/lib/store/types";

interface TranslationMap {
  [key: string]: string | undefined;
}

interface RefreshBranchesResult {
  branches: Branch[];
  currentBranch: string;
}

/**
 * 「添加仓库」的终态，供左栏决定是否需要继续引导（例如打开编辑窗口手动选 Provider）。
 */
export type AddRepositoryOutcome =
  | { status: "cancelled" }
  | { status: "failed" }
  | {
      status: "added" | "needs-provider";
      repoId: string;
      name: string;
      path: string;
    };

const DEFAULT_ADD_REPO_BRANCH = "main";

function isMainBranch(name: string): boolean {
  return name === "main" || name === "master";
}

/**
 * 仓库 id。同毫秒内连续添加不能撞 id（旧实现用 Date.now()），
 * 优先用 crypto.randomUUID，环境不支持时退化为时间戳 + 随机后缀。
 */
function createRepositoryId(): string {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef && typeof cryptoRef.randomUUID === "function") {
    return cryptoRef.randomUUID();
  }

  return `repo-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function fillTemplate(
  template: string,
  values: Record<string, string>
): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replace(`{{${key}}}`, value),
    template
  );
}

/** 统一的可读错误兜底：优先取后端 message，禁止把序列化负载直接丢进 UI。 */
function describeInvokeError(error: unknown): string {
  return extractInvokeErrorMessage(error);
}

function createFallbackBranches(path: string, currentBranch: string): Branch[] {
  return [
    {
      name: currentBranch,
      isMain: isMainBranch(currentBranch),
      isCurrent: true,
      path,
    },
  ];
}

function normalizeInitialBranchState(
  path: string,
  result: RepositoryBranchScanResult | null
): RefreshBranchesResult {
  if (!result || result.branches.length === 0) {
    return {
      currentBranch: DEFAULT_ADD_REPO_BRANCH,
      branches: createFallbackBranches(path, DEFAULT_ADD_REPO_BRANCH),
    };
  }

  const currentBranch =
    (result.current_branch ?? "").trim() ||
    result.branches.find((branch) => branch.isCurrent)?.name.trim() ||
    result.branches[0]?.name.trim() ||
    DEFAULT_ADD_REPO_BRANCH;

  return {
    currentBranch,
    branches: result.branches.map((branch) => ({
      ...branch,
      isMain: branch.isMain || isMainBranch(branch.name),
      isCurrent: branch.name === currentBranch,
    })),
  };
}

async function resolveProviderManifest(
  providerId: string,
  providers: ProviderManifest[]
): Promise<ProviderManifest | null> {
  const matchedProvider =
    providers.find((provider) => provider.id === providerId) ?? null;

  if (matchedProvider) {
    return matchedProvider;
  }

  const catalog = await listProviders().catch(() => []);
  return catalog.find((provider) => provider.id === providerId) ?? null;
}

async function shouldScanProjectCandidates(
  providerId: string,
  providers: ProviderManifest[]
): Promise<boolean> {
  // Provider 留空（未识别到）时不做项目文件扫描，避免一次无意义的 IPC 往返
  if (!providerId.trim()) {
    return false;
  }

  const provider = await resolveProviderManifest(providerId, providers);
  return providerRequiresProjectBinding(provider);
}

async function resolveInitialRepositoryMetadata(
  path: string,
  providerId: string,
  providers: ProviderManifest[]
): Promise<Pick<Repository, "branches" | "currentBranch" | "projectFile">> {
  const projectCandidatesPromise = shouldScanProjectCandidates(
    providerId,
    providers
  ).then((shouldScan) =>
    shouldScan
      ? scanProjectCandidates(path, providerId).catch(() => null)
      : Promise.resolve<ProjectScanCandidates | null>(null)
  );
  const [projectCandidates, branchResult] = await Promise.all([
    projectCandidatesPromise,
    scanRepositoryBranches(path, { refreshRemote: false }).catch(() => null),
  ]);

  const branchState = normalizeInitialBranchState(path, branchResult);
  const projectFile = projectCandidates?.recommendedProjectFile ?? undefined;

  return {
    ...branchState,
    projectFile,
  };
}

/**
 * Provider 识别失败的统一文案。detect 按钮与添加流程共用，避免两处措辞漂移
 * （旧实现里添加流程的兜底字符串与 i18n 的 providerDetectUnsupportedDesc 不一致）。
 */
function resolveProviderDetectFailureCopy(
  reason: ProviderDetectFailureReason,
  error: unknown,
  appT: TranslationMap
): { title: string; description: string } {
  switch (reason) {
    case "path_not_found":
      return {
        title: appT.providerDetectPathNotFound || "仓库路径不存在",
        description:
          appT.providerDetectPathNotFoundDesc ||
          "请确认 Project Root 路径存在且可访问。",
      };
    case "not_directory":
      return {
        title: appT.providerDetectNotDirectory || "Project Root 不是目录",
        description:
          appT.providerDetectNotDirectoryDesc ||
          "请填写项目根目录，而不是文件路径。",
      };
    case "permission_denied":
      return {
        title: appT.providerDetectPermissionDenied || "缺少目录访问权限",
        description:
          appT.providerDetectPermissionDeniedDesc ||
          "请检查当前用户对 Project Root 的读取权限后重试。",
      };
    case "unsupported_provider":
      return {
        title: appT.providerDetectUnsupported || "未识别到支持的 Provider",
        description:
          appT.providerDetectUnsupportedDesc ||
          "可手动选择 Provider；若仓库只有 pom.xml，注意当前 Java provider 仅支持 Gradle 项目。",
      };
    case "read_failed":
      return {
        title: appT.providerDetectReadFailed || "读取项目目录失败",
        description:
          appT.providerDetectReadFailedDesc ||
          "请检查磁盘状态、网络盘连接和目录可访问性后重试。",
      };
    default:
      return {
        title: appT.detectProviderFailed || "自动检测 Provider 失败",
        description: describeInvokeError(error),
      };
  }
}

/** 成功反馈里显式回显「识别到了什么」，Provider + 分支 + 完整路径。 */
function buildAddedRepositoryDescription(
  repo: Repository,
  providers: ProviderManifest[]
): string {
  const matchedProvider =
    providers.find((provider) => provider.id === repo.providerId) ?? null;
  const providerLabel = resolveProviderLabel(
    matchedProvider,
    repo.providerId ?? ""
  );

  return [providerLabel, repo.currentBranch, repo.path]
    .filter((part) => Boolean(part && part.trim()))
    .join(" · ");
}

export async function handleAddRepoRuntime(params: {
  appT: TranslationMap;
  providers: ProviderManifest[];
  repositories: Repository[];
  addRepository: (repo: Repository) => Promise<unknown>;
}): Promise<AddRepositoryOutcome> {
  const { appT, providers, repositories, addRepository } = params;

  // ── 1. 选择目录（自身失败也要有反馈，不能变成未处理的 rejection）──
  let selected: string | null;
  try {
    const picked = await open({
      directory: true,
      multiple: false,
      title: appT.selectRepositoryDirectory || "选择仓库目录",
    });
    selected = typeof picked === "string" ? picked : null;
  } catch (error) {
    toast.error(appT.selectRepositoryDirectoryFailed || "无法打开目录选择器", {
      description: describeInvokeError(error),
    });
    return { status: "failed" };
  }

  if (!selected) {
    return { status: "cancelled" };
  }

  const path = selected;
  const name = getPathBasename(path) || "Unknown";
  // 同一条 toast 随流程演进（loading → success / error），避免叠加两条互相矛盾
  const toastId = createRepositoryId();

  toast.loading(appT.addingRepository || "正在检测仓库…", {
    id: toastId,
    description: appT.addingRepositoryDesc || "正在识别 Provider 并读取分支…",
  });

  // ── 2. Provider 识别 ──
  // 「未识别到支持的 Provider」不再中断成死路：继续落库，随后由编辑窗口手动选择。
  // 其余失败（路径不存在/不是目录/无权限/读取失败）确实无法继续，按原因给出文案。
  let providerId: string | null = null;
  try {
    providerId = await detectRepositoryProvider(path);
  } catch (error) {
    const failureReason = analyzeProviderDetectFailure(error);

    if (failureReason !== "unsupported_provider") {
      const copy = resolveProviderDetectFailureCopy(failureReason, error, appT);
      toast.error(copy.title, { id: toastId, description: copy.description });
      return { status: "failed" };
    }
  }

  // ── 3. 读取初始分支 / 项目文件 ──
  const initialMetadata = await resolveInitialRepositoryMetadata(
    path,
    providerId ?? "",
    providers
  );

  // ── 4. 前端预检重复目录，避免把用户送到后端错误分支 ──
  const duplicatedRepo = repositories.find((repository) =>
    isSameRepositoryPath(repository.path, path)
  );

  if (duplicatedRepo) {
    toast.error(appT.addRepositoryFailed || "添加仓库失败", {
      id: toastId,
      description: fillTemplate(
        appT.repositoryAlreadyExistsNamed || "该目录已添加为仓库「{{name}}」",
        { name: duplicatedRepo.name }
      ),
    });
    return { status: "failed" };
  }

  const newRepo: Repository = {
    id: createRepositoryId(),
    name,
    path,
    projectFile: initialMetadata.projectFile,
    currentBranch: initialMetadata.currentBranch,
    branches: initialMetadata.branches,
    providerId: providerId ?? undefined,
    publishConfig: { ...defaultRepoPublishConfig },
  };

  try {
    await addRepository(newRepo);
  } catch (error) {
    const failureReason = analyzeRepositoryWriteFailure(error);

    if (failureReason === "repository_exists") {
      // 前端预检没拦住（路径写法/符号链接差异），后端判定命中
      toast.error(appT.addRepositoryFailed || "添加仓库失败", {
        id: toastId,
        description: appT.repositoryAlreadyExists || "该目录已添加为仓库",
      });
      return { status: "failed" };
    }

    toast.error(appT.addRepositoryFailed || "添加仓库失败", {
      id: toastId,
      description: describeInvokeError(error),
    });
    return { status: "failed" };
  }

  if (!providerId) {
    toast.warning(
      appT.repositoryAddedNeedsProvider || "已添加仓库，请手动选择 Provider",
      {
        id: toastId,
        description:
          appT.repositoryAddedNeedsProviderDesc ||
          "未识别到支持的 Provider，已打开编辑窗口。若仓库只有 pom.xml，注意当前 Java provider 仅支持 Gradle 项目。",
      }
    );
    return { status: "needs-provider", repoId: newRepo.id, name, path };
  }

  toast.success(appT.repositoryAdded || "仓库已添加", {
    id: toastId,
    description: buildAddedRepositoryDescription(newRepo, providers),
  });
  return { status: "added", repoId: newRepo.id, name, path };
}

export async function handleRemoveRepoRuntime(params: {
  appT: TranslationMap;
  repo: Repository;
  removeRepository: (repoId: string) => Promise<unknown>;
}) {
  const { appT, repo, removeRepository } = params;
  const confirmed = await ask(
    (appT.removeRepositoryConfirm || "确认移除仓库「{{name}}」？").replace(
      "{{name}}",
      repo.name
    ),
    { title: appT.removeRepository || "移除仓库", kind: "warning" }
  );

  if (!confirmed) {
    return;
  }

  try {
    await removeRepository(repo.id);
    toast.success(appT.repositoryRemoved || "仓库已移除", {
      description: repo.name,
    });
  } catch (error) {
    toast.error(appT.removeRepositoryFailed || "移除仓库失败", {
      description: describeInvokeError(error),
    });
  }
}

export async function handleOpenRepoDirectoryRuntime(params: {
  appT: TranslationMap;
  repo: Repository;
}) {
  const { appT, repo } = params;
  const repositoryPath = repo.path.trim();

  if (!repositoryPath) {
    toast.error(appT.repositoryPathRequired || "请输入 Project Root 路径");
    return;
  }

  try {
    const openedPath = await openDirectory(repositoryPath);
    toast.success(appT.repositoryDirectoryOpened || "已打开仓库目录", {
      description: openedPath,
    });
  } catch (error) {
    toast.error(appT.openRepositoryDirectoryFailed || "打开仓库目录失败", {
      description: describeInvokeError(error),
    });
  }
}

export async function handleEditRepoRuntime(params: {
  appT: TranslationMap;
  repo: Repository;
  repositories: Repository[];
  selectedRepoId: string | null;
  applySelectedRepositoryProvider: (providerId?: string | null) => void;
  updateRepository: (repo: Repository) => Promise<unknown>;
}) {
  const {
    appT,
    repo,
    repositories,
    selectedRepoId,
    applySelectedRepositoryProvider,
    updateRepository,
  } = params;
  const targetRepo = repositories.find((item) => item.id === repo.id);

  if (!targetRepo) {
    toast.error(appT.repositoryNotFound || "未找到目标仓库");
    return false;
  }

  const nextName = repo.name.trim();
  const nextPath = repo.path.trim();
  const nextProjectFile = repo.projectFile?.trim() || "";
  const nextCurrentBranch = repo.currentBranch.trim();
  const nextProviderId = repo.providerId?.trim() || "";

  if (!nextName || !nextPath) {
    toast.error(appT.repositoryInfoInvalid || "仓库名称和路径不能为空");
    return false;
  }

  const normalizedRepo: Repository = {
    ...repo,
    name: nextName,
    path: nextPath,
    projectFile:
      remapPathPrefix(nextProjectFile, targetRepo.path, nextPath) || undefined,
    currentBranch: nextCurrentBranch || targetRepo.currentBranch,
    providerId: nextProviderId || undefined,
    branches: repo.branches.map((branch) => ({
      ...branch,
      path: remapPathPrefix(branch.path, targetRepo.path, nextPath),
    })),
  };

  try {
    await updateRepository(normalizedRepo);

    if (selectedRepoId === repo.id && nextProviderId) {
      applySelectedRepositoryProvider(nextProviderId);
    }

    toast.success(appT.repositoryUpdated || "仓库信息已更新", {
      description: nextName,
    });
    return true;
  } catch (error) {
    const failureReason = analyzeRepositoryWriteFailure(error);

    toast.error(appT.updateRepositoryFailed || "更新仓库失败", {
      description:
        failureReason === "repository_exists"
          ? appT.repositoryAlreadyExists || "该目录已添加为仓库"
          : describeInvokeError(error),
    });
    return false;
  }
}

export async function handleDetectRepoProviderRuntime(params: {
  appT: TranslationMap;
  path: string;
  options?: { silentSuccess?: boolean; silentFailure?: boolean };
}) {
  const { appT, path, options } = params;
  const silentSuccess = options?.silentSuccess ?? false;
  // 自动检测（如编辑窗口打开时的首次探测）失败不必再弹一次错误：
  // 触发它的流程（添加仓库等）已经把结果告知用户了，重复弹会互相矛盾。
  const silentFailure = options?.silentFailure ?? false;
  const nextPath = path.trim();

  if (!nextPath) {
    toast.error(appT.repositoryPathRequired || "请输入 Project Root 路径");
    return null;
  }

  try {
    const providerId = await detectRepositoryProvider(nextPath);

    if (!silentSuccess) {
      toast.success(appT.providerDetected || "已自动检测 Provider", {
        description: providerId,
      });
    }

    return providerId;
  } catch (error) {
    if (silentFailure) {
      return null;
    }

    const failureReason = analyzeProviderDetectFailure(error);
    const copy = resolveProviderDetectFailureCopy(failureReason, error, appT);

    toast.error(copy.title, { description: copy.description });
    return null;
  }
}

export async function handleScanProjectCandidatesRuntime(
  path: string,
  providerId?: string
): Promise<ProjectScanCandidates | null> {
  const nextPath = path.trim();
  if (!nextPath) {
    return null;
  }

  try {
    return await scanProjectCandidates(nextPath, providerId);
  } catch {
    return null;
  }
}

export async function handleRefreshRepoBranchesRuntime(params: {
  appT: TranslationMap;
  path: string;
  options?: { silentSuccess?: boolean };
}): Promise<RefreshBranchesResult | null> {
  const { appT, path, options } = params;
  const silentSuccess = options?.silentSuccess ?? false;
  const nextPath = path.trim();

  if (!nextPath) {
    toast.error(appT.repositoryPathRequired || "请输入 Project Root 路径");
    return null;
  }

  try {
    const result = await scanRepositoryBranches(nextPath);
    const branchCountLabel = appT.branchesCountUnit || "个分支";

    if (!silentSuccess) {
      toast.success(appT.branchesRefreshed || "分支列表已刷新", {
        description: `${result.branches.length}${branchCountLabel}`,
      });
    }

    return {
      branches: result.branches,
      currentBranch: result.current_branch,
    };
  } catch (err) {
    const rawErrorMessage = extractInvokeErrorMessage(err);
    const failureReason = analyzeBranchRefreshFailure(err);

    if (failureReason === "path_not_found") {
      toast.error(appT.branchPullPathNotFound || "仓库路径不存在", {
        description:
          appT.branchPullPathNotFoundDesc || "请确认仓库路径存在且可访问。",
      });
      return null;
    }

    if (failureReason === "not_directory") {
      toast.error(appT.branchPullNotDirectory || "仓库路径不是目录", {
        description:
          appT.branchPullNotDirectoryDesc ||
          "请确认填写的是仓库目录而非文件路径。",
      });
      return null;
    }

    if (failureReason === "git_missing") {
      toast.error(appT.branchPullGitMissing || "未检测到 Git 命令", {
        description:
          appT.branchPullGitMissingDesc ||
          "请先安装 Git，并确保 git 已加入 PATH。",
      });
      return null;
    }

    if (failureReason === "cannot_connect_repo") {
      toast.error(appT.branchPullCannotConnect || "无法连接 Git 仓库", {
        description:
          appT.branchPullCannotConnectDesc ||
          "请检查网络代理、仓库地址和凭据后重试。",
      });
      return null;
    }

    if (failureReason === "not_git_repo") {
      toast.error(appT.branchPullNotGitRepo || "该目录不是 Git 仓库", {
        description:
          appT.branchPullNotGitRepoDesc ||
          "请确认目录包含 .git，或先执行 git init。",
      });
      return null;
    }

    if (failureReason === "permission_denied") {
      toast.error(appT.branchPullPermissionDenied || "缺少仓库访问权限", {
        description:
          appT.branchPullPermissionDeniedDesc ||
          "请检查当前用户对仓库目录和 .git 目录的读权限。",
      });
      return null;
    }

    if (failureReason === "dubious_ownership") {
      toast.error(appT.branchPullDubiousOwnership || "仓库所有权校验失败", {
        description:
          appT.branchPullDubiousOwnershipDesc ||
          "Git 检测到目录所有权异常，请按提示配置 safe.directory。",
      });
      return null;
    }

    if (failureReason === "no_branches") {
      toast.error(appT.branchPullNoBranches || "未读取到分支", {
        description:
          appT.branchPullNoBranchesDesc ||
          "当前仓库没有可用分支，请先创建并提交至少一个分支。",
      });
      return null;
    }

    toast.error(appT.refreshBranchesFailed || "拉取分支失败", {
      description: rawErrorMessage,
    });
    return null;
  }
}
