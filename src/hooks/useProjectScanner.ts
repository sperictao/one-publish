import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

import type { ProjectInfo } from "@/types/project";

const loadInvokeErrors = () => import("@/lib/tauri/invokeErrors");

interface TranslationMap {
  [key: string]: string | undefined;
}

export function useProjectScanner(params: {
  appT: TranslationMap;
}) {
  const { appT } = params;

  const scanProject = useCallback(
    async (
      path?: string,
      options?: { silentSuccess?: boolean; silentFailure?: boolean }
    ): Promise<ProjectInfo | null> => {
      const silentSuccess = options?.silentSuccess ?? false;
      const silentFailure = options?.silentFailure ?? false;

      try {
        const info = await invoke<ProjectInfo>("scan_project", {
          startPath: path,
        });

        if (!silentSuccess) {
          toast.success(appT.scanProjectSuccess || "项目检测成功", {
            description: `${appT.foundProject || "找到项目"}: ${info.project_file}`,
          });
        }

        return info;
      } catch (err) {
        if (silentFailure) {
          return null;
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
          return null;
        }

        if (failureReason === "project_root_not_found") {
          toast.error(appT.scanProjectRootNotFound || "未检测到项目根目录", {
            description:
              appT.scanProjectRootNotFoundDesc ||
              "未找到 .sln 文件，请确认当前目录或上级目录包含解决方案文件。",
          });
          return null;
        }

        if (failureReason === "project_file_not_found") {
          toast.error(appT.scanProjectFileNotFound || "未检测到项目文件", {
            description:
              appT.scanProjectFileNotFoundDesc ||
              "已找到解决方案，但未发现 .csproj 文件，请检查项目结构。",
          });
          return null;
        }

        if (failureReason === "permission_denied") {
          toast.error(appT.scanProjectPermissionDenied || "缺少目录访问权限", {
            description:
              appT.scanProjectPermissionDeniedDesc ||
              "请检查当前用户对 Project Root 及其父目录的读取权限。",
          });
          return null;
        }

        if (failureReason === "current_dir_failed") {
          toast.error(appT.scanProjectCurrentDirFailed || "读取当前目录失败", {
            description:
              appT.scanProjectCurrentDirFailedDesc ||
              "请确认应用运行目录有效，或手动指定 Project Root 后重试。",
          });
          return null;
        }

        toast.error(appT.scanProjectFailed || "项目检测失败", {
          description: rawErrorMessage,
        });

        return null;
      }
    },
    [appT]
  );

  return {
    scanProject,
  };
}
