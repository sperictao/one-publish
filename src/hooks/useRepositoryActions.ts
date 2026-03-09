import { useCallback } from "react";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";

import {
  addRepository as apiAddRepository,
  defaultRepoPublishConfig,
  detectRepositoryProvider,
  scanProjectFiles,
  scanRepositoryBranches,
} from "@/lib/store";
import { remapPathPrefix } from "@/features/repository/utils/pathUtils";
import {
  analyzeBranchRefreshFailure,
  analyzeProviderDetectFailure,
  extractInvokeErrorMessage,
} from "@/lib/tauri/invokeErrors";
import type { Branch, Repository } from "@/types/repository";

interface TranslationMap {
  [key: string]: string | undefined;
}

interface UseRepositoryActionsParams {
  appT: TranslationMap;
  repositories: Repository[];
  selectedRepoId: string | null;
  addRepository: typeof apiAddRepository;
  removeRepository: (repoId: string) => Promise<unknown>;
  updateRepository: (repo: Repository) => Promise<unknown>;
  setActiveProviderId: (value: string) => void;
}

interface RefreshBranchesResult {
  branches: Branch[];
  currentBranch: string;
}

export function useRepositoryActions({
  appT,
  repositories,
  selectedRepoId,
  addRepository,
  removeRepository,
  updateRepository,
  setActiveProviderId,
}: UseRepositoryActionsParams) {
  const handleAddRepo = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: appT.selectRepositoryDirectory || "选择仓库目录",
    });

    if (!selected) {
      return;
    }

    const path = selected as string;
    const name = path.split("/").pop() || "Unknown";

    try {
      await detectRepositoryProvider(path);
    } catch {
      toast.error(appT.providerDetectUnsupported || "未识别到支持的 Provider", {
        description:
          appT.providerDetectUnsupportedDesc ||
          "可手动选择 Provider，或确认项目根目录下包含可识别的构建文件。",
      });
      return;
    }

    const newRepo: Repository = {
      id: Date.now().toString(),
      name,
      path,
      currentBranch: "main",
      branches: [{ name: "main", isMain: true, isCurrent: true, path }],
      publishConfig: { ...defaultRepoPublishConfig },
    };

    try {
      await addRepository(newRepo);
      toast.success(appT.repositoryAdded || "仓库已添加", { description: name });
    } catch (err) {
      toast.error(appT.addRepositoryFailed || "添加仓库失败", {
        description: String(err),
      });
    }
  }, [addRepository, appT]);

  const handleRemoveRepo = useCallback(
    async (repo: Repository) => {
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
      } catch (err) {
        toast.error(appT.removeRepositoryFailed || "移除仓库失败", {
          description: String(err),
        });
      }
    },
    [appT, removeRepository]
  );

  const handleEditRepo = useCallback(
    async (repo: Repository) => {
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
          setActiveProviderId(nextProviderId);
        }

        toast.success(appT.repositoryUpdated || "仓库信息已更新", {
          description: nextName,
        });
        return true;
      } catch (err) {
        toast.error(appT.updateRepositoryFailed || "更新仓库失败", {
          description: String(err),
        });
        return false;
      }
    },
    [appT, repositories, selectedRepoId, setActiveProviderId, updateRepository]
  );

  const handleDetectRepoProvider = useCallback(
    async (path: string, options?: { silentSuccess?: boolean }) => {
      const silentSuccess = options?.silentSuccess ?? false;
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
      } catch (err) {
        const rawErrorMessage = extractInvokeErrorMessage(err);
        const failureReason = analyzeProviderDetectFailure(err);

        if (failureReason === "path_not_found") {
          toast.error(appT.providerDetectPathNotFound || "仓库路径不存在", {
            description:
              appT.providerDetectPathNotFoundDesc || "请确认 Project Root 路径存在且可访问。",
          });
          return null;
        }

        if (failureReason === "not_directory") {
          toast.error(appT.providerDetectNotDirectory || "Project Root 不是目录", {
            description:
              appT.providerDetectNotDirectoryDesc || "请填写项目根目录，而不是文件路径。",
          });
          return null;
        }

        if (failureReason === "permission_denied") {
          toast.error(appT.providerDetectPermissionDenied || "缺少目录访问权限", {
            description:
              appT.providerDetectPermissionDeniedDesc ||
              "请检查当前用户对 Project Root 的读取权限后重试。",
          });
          return null;
        }

        if (failureReason === "unsupported_provider") {
          toast.error(appT.providerDetectUnsupported || "未识别到支持的 Provider", {
            description:
              appT.providerDetectUnsupportedDesc ||
              "可手动选择 Provider，或确认项目根目录下包含可识别的构建文件。",
          });
          return null;
        }

        if (failureReason === "read_failed") {
          toast.error(appT.providerDetectReadFailed || "读取项目目录失败", {
            description:
              appT.providerDetectReadFailedDesc ||
              "请检查磁盘状态、网络盘连接和目录可访问性后重试。",
          });
          return null;
        }

        toast.error(appT.detectProviderFailed || "自动检测 Provider 失败", {
          description: rawErrorMessage,
        });
        return null;
      }
    },
    [appT]
  );

  const handleScanProjectFiles = useCallback(async (path: string): Promise<string[]> => {
    const nextPath = path.trim();
    if (!nextPath) {
      return [];
    }
    try {
      return await scanProjectFiles(nextPath);
    } catch {
      return [];
    }
  }, []);

  const handleRefreshRepoBranches = useCallback(
    async (
      path: string,
      options?: { silentSuccess?: boolean }
    ): Promise<RefreshBranchesResult | null> => {
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

        return result;
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
              appT.branchPullNotDirectoryDesc || "请确认填写的是仓库目录而非文件路径。",
          });
          return null;
        }

        if (failureReason === "git_missing") {
          toast.error(appT.branchPullGitMissing || "未检测到 Git 命令", {
            description:
              appT.branchPullGitMissingDesc || "请先安装 Git，并确保 git 已加入 PATH。",
          });
          return null;
        }

        if (failureReason === "cannot_connect_repo") {
          toast.error(appT.branchPullCannotConnect || "无法连接 Git 仓库", {
            description:
              appT.branchPullCannotConnectDesc || "请检查网络代理、仓库地址和凭据后重试。",
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
    },
    [appT]
  );

  return {
    handleAddRepo,
    handleRemoveRepo,
    handleEditRepo,
    handleDetectRepoProvider,
    handleScanProjectFiles,
    handleRefreshRepoBranches,
  };
}
