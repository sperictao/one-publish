import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { normalizeDotnetProjectBoundParameters } from "@/lib/dotnetPublishConfig";
import { resolvePreferredDotnetProjectInfo } from "@/lib/dotnetProjectInfo";
import { resolveDotnetProjectProfile } from "@/lib/dotnetProjectProfile";
import { showSystemNotification } from "@/lib/systemNotification";
import {
  getProfiles,
  getRepository,
  resolveProjectInfo,
  scanProject,
  showMainWindow,
} from "@/lib/store";
import { analyzeProjectScanFailure } from "@/lib/tauri/invokeErrors";
import type { RunPublishOptions, ProviderPublishSpec } from "@/hooks/usePublishRunner";
import type { ProjectInfo } from "@/types/project";
import type { Repository } from "@/types/repository";

interface TranslationMap {
  [key: string]: string | undefined;
}

export interface TrayPublishRequestPayload {
  repoId: string;
  configKey: string;
}

interface ResolvedTrayPublishRequest {
  spec: ProviderPublishSpec;
  options: RunPublishOptions;
}

async function resolveDotnetProjectInfo(repo: Repository): Promise<ProjectInfo> {
  try {
    const projectInfo = await resolvePreferredDotnetProjectInfo({
      repoPath: repo.path,
      projectFile: repo.projectFile,
      resolveProjectInfo: async (projectFile) => {
        try {
          return await resolveProjectInfo(projectFile);
        } catch {
          return null;
        }
      },
      scanProject: async (repoPath) => await scanProject(repoPath),
    });

    if (!projectInfo) {
      throw new Error("未能解析仓库对应的项目文件。");
    }

    return projectInfo;
  } catch (error) {
    if (analyzeProjectScanFailure(error) === "multiple_project_files_found") {
      throw new Error(
        "该仓库包含多个项目文件，请先在仓库设置中绑定明确的 Project File。"
      );
    }

    throw error;
  }
}

async function resolveUserProfileSpec(params: {
  repo: Repository;
  profileName: string;
  specVersion: number;
  defaultOutputDir: string;
}): Promise<ProviderPublishSpec> {
  const profiles = await getProfiles(params.repo.id);
  const profile = profiles.find((item) => item.name === params.profileName);
  if (!profile) {
    throw new Error(`missing user profile: ${params.profileName}`);
  }

  const providerId = profile.providerId || params.repo.providerId || "dotnet";
  if (providerId === "dotnet") {
    const projectInfo = await resolveDotnetProjectInfo(params.repo);
    return {
      version: params.specVersion,
      provider_id: "dotnet",
      project_path: projectInfo.project_file,
      parameters: normalizeDotnetProjectBoundParameters({
        parameters: (profile.parameters || {}) as Record<string, unknown>,
        defaultOutputDir: params.defaultOutputDir,
        projectFile: projectInfo.project_file,
        projectRoot: projectInfo.root_path,
      }),
    };
  }

  return {
    version: params.specVersion,
    provider_id: providerId,
    project_path: params.repo.path,
    parameters: (profile.parameters || {}) as Record<string, unknown>,
  };
}

async function resolvePubxmlSpec(params: {
  repo: Repository;
  profileName: string;
  specVersion: number;
  defaultOutputDir: string;
}): Promise<ProviderPublishSpec> {
  const projectInfo = await resolveDotnetProjectInfo(params.repo);
  const resolvedProfile = await resolveDotnetProjectProfile({
    projectInfo,
    profileName: params.profileName,
    defaultOutputDir: params.defaultOutputDir,
  });

  return {
    version: params.specVersion,
    provider_id: "dotnet",
    project_path: projectInfo.project_file,
    parameters: resolvedProfile.parameters,
  };
}

function createTrayRunOptions(
  repoId: string,
  configKey: string
): RunPublishOptions {
  return {
    repoId,
    recentConfigKey: configKey,
    openOutputDirOnSuccess: true,
    restoreWindowOnFailure: false,
    feedbackMode: "system",
  };
}

export async function resolveTrayPublishRequest(params: {
  payload: TrayPublishRequestPayload;
  specVersion: number;
  defaultOutputDir: string;
}): Promise<ResolvedTrayPublishRequest> {
  const repo = await getRepository(params.payload.repoId);

  const { configKey } = params.payload;
  const [keyType, ...rest] = configKey.split(":");
  const keyValue = rest.join(":").trim();
  if (!keyType || !keyValue) {
    throw new Error(`invalid tray config key: ${configKey}`);
  }

  if (keyType === "userprofile") {
    const spec = await resolveUserProfileSpec({
      repo,
      profileName: keyValue,
      specVersion: params.specVersion,
      defaultOutputDir: params.defaultOutputDir,
    });
    return {
      spec,
      options: createTrayRunOptions(repo.id, configKey),
    };
  }

  if (keyType === "pubxml") {
    const spec = await resolvePubxmlSpec({
      repo,
      profileName: keyValue,
      specVersion: params.specVersion,
      defaultOutputDir: params.defaultOutputDir,
    });
    return {
      spec,
      options: createTrayRunOptions(repo.id, configKey),
    };
  }

  throw new Error(`unsupported tray config key: ${configKey}`);
}

export function useTrayRecentPublish(params: {
  appT: TranslationMap;
  defaultOutputDir: string;
  specVersion: number;
  runPublishSpec: (
    spec: ProviderPublishSpec,
    options?: RunPublishOptions
  ) => Promise<void>;
}) {
  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | null = null;

    void listen<TrayPublishRequestPayload>("tray-publish-request", async (event) => {
      try {
        const resolved = await resolveTrayPublishRequest({
          payload: event.payload,
          specVersion: params.specVersion,
          defaultOutputDir: params.defaultOutputDir,
        });
        if (!disposed) {
          await params.runPublishSpec(resolved.spec, resolved.options);
        }
      } catch (error) {
        const description =
          error instanceof Error ? error.message : String(error);
        const notified = await showSystemNotification({
          title: params.appT.trayPublishFailed || "状态栏发布启动失败",
          body: description,
        });
        if (!notified) {
          await showMainWindow().catch(() => {});
        }
      }
    })
      .then((handler) => {
        unlisten = handler;
      })
      .catch((error) => {
        console.error("监听 tray-publish-request 失败:", error);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [
    params.appT,
    params.defaultOutputDir,
    params.runPublishSpec,
    params.specVersion,
  ]);
}
