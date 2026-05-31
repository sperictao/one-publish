import { useCallback } from "react";
import { toast } from "sonner";

import {
  scanProject as scanProjectRequest,
  resolveProjectInfo as resolveProjectInfoRequest,
  scanProjectCandidates as scanProjectCandidatesRequest,
} from "@/lib/store/api";
import type { ProjectInfo, ProjectScanCandidates } from "@/lib/store/types";

const loadInvokeErrors = () => import("@/lib/tauri/invokeErrors");

interface TranslationMap {
  [key: string]: string | undefined;
}

export function useProjectScanner(params: {
  appT: TranslationMap;
}) {
  const { appT } = params;

  const handleProjectScanFailure = useCallback(
    async (err: unknown, silentFailure: boolean) => {
      if (silentFailure) {
        return;
      }

      const { analyzeProjectScanFailure, extractInvokeErrorMessage } =
        await loadInvokeErrors();
      const rawErrorMessage = extractInvokeErrorMessage(err);
      const failureReason = analyzeProjectScanFailure(err);

      if (failureReason === "path_not_found") {
        toast.error(appT.scanProjectPathNotFound || "Project Root 路径不存在", {
          description:
            appT.scanProjectPathNotFoundDesc ||
            "请确认 Project Root 路径存在且可访问。",
        });
        return;
      }

      if (failureReason === "project_root_not_found") {
        toast.error(appT.scanProjectRootNotFound || "未检测到项目根目录", {
          description:
            appT.scanProjectRootNotFoundDesc ||
            "未找到解决方案或项目文件，请确认当前目录包含可发布项目。",
        });
        return;
      }

      if (failureReason === "project_file_not_found") {
        toast.error(appT.scanProjectFileNotFound || "未检测到项目文件", {
          description:
            appT.scanProjectFileNotFoundDesc ||
            "未发现 .csproj/.fsproj/.vbproj 文件，请检查项目结构。",
        });
        return;
      }

      if (failureReason === "multiple_project_files_found") {
        toast.error(appT.scanProjectMultipleCandidates || "检测到多个项目文件", {
          description:
            appT.scanProjectMultipleCandidatesDesc ||
            "该仓库包含多个项目文件，请先在仓库设置里绑定明确的 Project File。",
        });
        return;
      }

      if (failureReason === "permission_denied") {
        toast.error(appT.scanProjectPermissionDenied || "缺少目录访问权限", {
          description:
            appT.scanProjectPermissionDeniedDesc ||
            "请检查当前用户对 Project Root 及其父目录的读取权限。",
        });
        return;
      }

      if (failureReason === "current_dir_failed") {
        toast.error(appT.scanProjectCurrentDirFailed || "读取当前目录失败", {
          description:
            appT.scanProjectCurrentDirFailedDesc ||
            "请确认应用运行目录有效，或手动指定 Project Root 后重试。",
        });
        return;
      }

      toast.error(appT.scanProjectFailed || "项目检测失败", {
        description: rawErrorMessage,
      });
    },
    [appT]
  );

  const scanProject = useCallback(
    async (
      path?: string,
      options?: { silentSuccess?: boolean; silentFailure?: boolean }
    ): Promise<ProjectInfo | null> => {
      const silentSuccess = options?.silentSuccess ?? false;
      const silentFailure = options?.silentFailure ?? false;

      try {
        const info = await scanProjectRequest(path);

        if (!silentSuccess) {
          toast.success(appT.scanProjectSuccess || "项目检测成功", {
            description: `${appT.foundProject || "找到项目"}: ${info.project_file}`,
          });
        }

        return info;
      } catch (err) {
        await handleProjectScanFailure(err, silentFailure);
        return null;
      }
    },
    [appT, handleProjectScanFailure]
  );

  const scanProjectCandidates = useCallback(
    async (
      path?: string,
      options?: { silentFailure?: boolean }
    ): Promise<ProjectScanCandidates | null> => {
      try {
        return await scanProjectCandidatesRequest(path);
      } catch (err) {
        await handleProjectScanFailure(err, options?.silentFailure ?? false);
        return null;
      }
    },
    [handleProjectScanFailure]
  );

  const resolveProjectInfo = useCallback(
    async (
      projectFile: string,
      options?: { silentFailure?: boolean }
    ): Promise<ProjectInfo | null> => {
      try {
        return await resolveProjectInfoRequest(projectFile);
      } catch (err) {
        await handleProjectScanFailure(err, options?.silentFailure ?? false);
        return null;
      }
    },
    [handleProjectScanFailure]
  );

  return {
    scanProject,
    scanProjectCandidates,
    resolveProjectInfo,
  };
}
