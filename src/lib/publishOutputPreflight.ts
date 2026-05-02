import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import type {
  ProtectedDirectoryLocation,
  PublishOutputPreflightResult,
  PublishSpec,
} from "@/generated/tauri-contracts";

export type { PublishOutputPreflightResult } from "@/generated/tauri-contracts";

interface TranslationMap {
  [key: string]: string | undefined;
}

export interface ProtectedOutputAccessRequestResult {
  preflight: PublishOutputPreflightResult;
  selectedDirectory: string | null;
}

export async function preflightPublishOutput(
  spec: PublishSpec
): Promise<PublishOutputPreflightResult> {
  return await invoke<PublishOutputPreflightResult>(
    "preflight_publish_output",
    { spec }
  );
}

function resolveProtectedOutputRequestDirectory(
  result: PublishOutputPreflightResult
): string | undefined {
  return (
    result.access.probeDirectory ||
    result.access.protectedRoot ||
    result.outputDir ||
    undefined
  );
}

export async function requestProtectedOutputAccess(
  spec: PublishSpec,
  result: PublishOutputPreflightResult,
  appT: TranslationMap
): Promise<ProtectedOutputAccessRequestResult> {
  const defaultPath = resolveProtectedOutputRequestDirectory(result);
  const selected = await openDialog({
    directory: true,
    multiple: false,
    defaultPath,
    title:
      appT.publishProtectedDirectoryAccessRequestTitle ||
      "选择目录以授权 OnePublish 访问",
  });

  if (typeof selected !== "string" || selected.trim().length === 0) {
    return {
      preflight: result,
      selectedDirectory: null,
    };
  }

  return {
    preflight: await preflightPublishOutput(spec),
    selectedDirectory: selected,
  };
}

function getProtectedLocationLabel(
  location: ProtectedDirectoryLocation | null | undefined,
  appT: TranslationMap
): string {
  if (location === "desktop") {
    return appT.macOsProtectedDesktop || "桌面";
  }

  if (location === "documents") {
    return appT.macOsProtectedDocuments || "文稿";
  }

  if (location === "downloads") {
    return appT.macOsProtectedDownloads || "下载";
  }

  return appT.macOsProtectedFilesAndFolders || "文件与文件夹";
}

export function buildProtectedOutputAccessDescription(
  result: PublishOutputPreflightResult,
  appT: TranslationMap
): string {
  const location = getProtectedLocationLabel(
    result.access.protectedLocation ?? null,
    appT
  );
  const template =
    appT.publishProtectedDirectoryAccessDeniedDesc ||
    '当前输出目录位于 macOS 受保护位置「{{location}}」下。OnePublish 已尝试向系统申请写入权限，但仍无法访问：{{path}}。请在“系统设置 > 隐私与安全性 > 文件与文件夹”中允许 OnePublish 访问「{{location}}」后重试；如果没有出现授权弹窗，请改用非受保护目录。';

  return template
    .replace(/\{\{location\}\}/g, location)
    .replace(
      "{{path}}",
      result.access.probeDirectory ||
        result.outputDir ||
        result.access.protectedRoot ||
        "-"
    );
}

export function buildPublishOutputValidationTitle(
  result: PublishOutputPreflightResult,
  appT: TranslationMap
): string {
  if (result.validation.issue === "windows_drive_root_missing") {
    return appT.publishOutputPathInvalid || "发布目录无效";
  }

  return (
    appT.publishOutputPathIncompatible || "发布目录路径与当前系统不兼容"
  );
}

export function buildPublishOutputValidationDescription(
  result: PublishOutputPreflightResult,
  appT: TranslationMap
): string {
  const path = result.configuredOutputDir?.trim() || result.outputDir?.trim() || "-";

  if (result.validation.issue === "windows_style_path_on_posix") {
    return (
      appT.publishWindowsStyleOutputPathIncompatibleDesc ||
      `当前发布目录看起来是 Windows 风格路径：${path}。请改为当前系统可识别的路径，或使用相对路径（如 ./publish）。`
    ).replace(/\{\{path\}\}/g, path);
  }

  if (result.validation.issue === "posix_absolute_path_on_windows") {
    return (
      appT.publishPosixStyleOutputPathIncompatibleDesc ||
      `当前发布目录看起来是 Unix 风格绝对路径：${path}。请改为当前系统可识别的 Windows 路径，或使用相对路径。`
    ).replace(/\{\{path\}\}/g, path);
  }

  if (result.validation.issue === "windows_drive_root_missing") {
    return (
      appT.publishWindowsDriveRootMissingDesc ||
      `当前发布目录指向不存在的 Windows 盘符或共享根：${path}。请改为当前系统可访问的磁盘或目录后重试。`
    ).replace(/\{\{path\}\}/g, path);
  }

  return (
    appT.publishOutputPathIncompatibleDesc ||
    `当前发布目录路径与当前系统不兼容：${path}。请改为当前系统可识别的路径，或使用相对路径。`
  ).replace(/\{\{path\}\}/g, path);
}
