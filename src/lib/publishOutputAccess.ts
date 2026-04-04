import { invoke } from "@tauri-apps/api/core";

import type { PublishSpec } from "@/generated/tauri-contracts";

export type ProtectedDirectoryLocation =
  | "desktop"
  | "documents"
  | "downloads";

export type PublishOutputAccessStatus =
  | "not_applicable"
  | "granted"
  | "denied";

export type PublishOutputPathCompatibilityStatus =
  | "not_applicable"
  | "compatible"
  | "incompatible";

export type PublishOutputPathCompatibilityIssue =
  | "windows_style_path_on_posix"
  | "posix_absolute_path_on_windows";

export interface PublishOutputAccessResult {
  status: PublishOutputAccessStatus;
  outputDir: string;
  configuredOutputDir?: string | null;
  pathCompatibilityStatus?: PublishOutputPathCompatibilityStatus | null;
  pathCompatibilityIssue?: PublishOutputPathCompatibilityIssue | null;
  protectedLocation?: ProtectedDirectoryLocation | null;
  protectedRoot?: string | null;
  probeDirectory?: string | null;
  detail?: string | null;
}

interface TranslationMap {
  [key: string]: string | undefined;
}

export async function preflightPublishOutputAccess(
  spec: PublishSpec
): Promise<PublishOutputAccessResult> {
  return await invoke<PublishOutputAccessResult>(
    "preflight_publish_output_access",
    { spec }
  );
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
  result: PublishOutputAccessResult,
  appT: TranslationMap
): string {
  const location = getProtectedLocationLabel(
    result.protectedLocation ?? null,
    appT
  );
  const template =
    appT.publishProtectedDirectoryAccessDeniedDesc ||
    '当前输出目录位于 macOS 受保护位置「{{location}}」下。OnePublish 已尝试向系统申请写入权限，但仍无法访问：{{path}}。请在“系统设置 > 隐私与安全性 > 文件与文件夹”中允许 OnePublish 访问「{{location}}」后重试；如果没有出现授权弹窗，请改用非受保护目录。';

  return template
    .replace(/\{\{location\}\}/g, location)
    .replace(
      "{{path}}",
      result.probeDirectory || result.outputDir || result.protectedRoot || "-"
    );
}

export function buildIncompatibleOutputPathDescription(
  result: PublishOutputAccessResult,
  appT: TranslationMap
): string {
  const path = result.configuredOutputDir?.trim() || result.outputDir?.trim() || "-";

  if (result.pathCompatibilityIssue === "windows_style_path_on_posix") {
    return (
      appT.publishWindowsStyleOutputPathIncompatibleDesc ||
      `当前发布目录看起来是 Windows 风格路径：${path}。请改为当前系统可识别的路径，或使用相对路径（如 ./publish）。`
    ).replace(/\{\{path\}\}/g, path);
  }

  if (result.pathCompatibilityIssue === "posix_absolute_path_on_windows") {
    return (
      appT.publishPosixStyleOutputPathIncompatibleDesc ||
      `当前发布目录看起来是 Unix 风格绝对路径：${path}。请改为当前系统可识别的 Windows 路径，或使用相对路径。`
    ).replace(/\{\{path\}\}/g, path);
  }

  return (
    appT.publishOutputPathIncompatibleDesc ||
    `当前发布目录路径与当前系统不兼容：${path}。请改为当前系统可识别的路径，或使用相对路径。`
  ).replace(/\{\{path\}\}/g, path);
}
