import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { normalizeDotnetProjectBoundParameters } from "@/features/config/dotnetPublishConfig";
import { resolvePreferredDotnetProjectInfo } from "@/lib/dotnetProjectInfo";
import { resolveDotnetProjectProfile } from "@/lib/dotnetProjectProfile";
import { parsePublishConfigKey } from "@/features/config/publishConfigIdentity";
import { showSystemNotification } from "@/lib/systemNotification";
import {
  getProfiles,
  getRepository,
  resolveProjectInfo,
  scanProject,
  setTrayPublishStatus,
  showMainWindow,
} from "@/lib/store/api";
import { analyzeProjectScanFailure } from "@/lib/tauri/invokeErrors";
import type { ProviderPublishSpec } from "@/features/publish/publishRuntime";
import type { RunPublishOptions } from "@/features/publish/publishTransaction";
import { toSpecParameters } from "@/types/parameters";
import type { ProjectInfo } from "@/lib/store/types";
import type { Repository } from "@/lib/store/types";

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
        parameters: toSpecParameters(
          normalizeDotnetProjectBoundParameters({
            parameters: (profile.parameters || {}) as Record<string, unknown>,
            defaultOutputDir: params.defaultOutputDir,
            projectFile: projectInfo.project_file,
            projectRoot: projectInfo.root_path,
          })
        ),
      };
  }

  return {
    version: params.specVersion,
    provider_id: providerId,
    project_path: params.repo.path,
    parameters: toSpecParameters(
      (profile.parameters || {}) as Record<string, never>
    ),
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
    parameters: toSpecParameters(resolvedProfile.parameters),
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
    trayStatusEffect: true,
  };
}

export async function resolveTrayPublishRequest(params: {
  payload: TrayPublishRequestPayload;
  specVersion: number;
  defaultOutputDir: string;
}): Promise<ResolvedTrayPublishRequest> {
  const repo = await getRepository(params.payload.repoId);

  const { configKey } = params.payload;
  const identity = parsePublishConfigKey(configKey);
  if (!identity) {
    throw new Error(`invalid tray config key: ${configKey}`);
  }

  if (identity.kind === "user-profile") {
    const spec = await resolveUserProfileSpec({
      repo,
      profileName: identity.profileName,
      specVersion: params.specVersion,
      defaultOutputDir: params.defaultOutputDir,
    });
    return {
      spec,
      options: createTrayRunOptions(repo.id, configKey),
    };
  }

  if (identity.kind === "project-profile") {
    const spec = await resolvePubxmlSpec({
      repo,
      profileName: identity.profileName,
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
        await setTrayPublishStatus("failure").catch(() => {});
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
