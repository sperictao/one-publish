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

export interface PublishOutputAccessResult {
  status: PublishOutputAccessStatus;
  outputDir: string;
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
