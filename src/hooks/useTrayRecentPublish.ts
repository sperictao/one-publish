import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { parsePublishConfigKey } from "@/features/config/publishConfigIdentity";
import { showSystemNotification } from "@/lib/systemNotification";
import {
  getProfiles,
  getRepository,
  setTrayPublishStatus,
  showMainWindow,
} from "@/lib/store/api";
import type { PublishSource } from "@/features/publish/publishRuntime";
import type { RunPublishOptions } from "@/features/publish/publishTransaction";

interface TranslationMap {
  [key: string]: string | undefined;
}

export interface TrayPublishRequestPayload {
  repoId: string;
  configKey: string;
}

interface ResolvedTrayPublishRequest {
  source: PublishSource;
  options: RunPublishOptions;
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
}): Promise<ResolvedTrayPublishRequest> {
  const repo = await getRepository(params.payload.repoId);

  const { configKey } = params.payload;
  const identity = parsePublishConfigKey(configKey);
  if (!identity) {
    throw new Error(`invalid tray config key: ${configKey}`);
  }

  if (identity.kind === "user-profile") {
    const profiles = await getProfiles(repo.id);
    const profile = profiles.find((item) => item.id === identity.profileId);
    if (!profile) {
      throw new Error(`missing user profile: ${identity.profileId}`);
    }
    if (profile.blockedReason) {
      throw new Error(`配置不可执行：${profile.blockedReason}`);
    }
    if (!profile.revisionId) {
      throw new Error(`missing configuration revision: ${profile.id}`);
    }
    const source: PublishSource = {
      kind: "revision",
      configurationId: profile.id,
      revisionId: profile.revisionId,
    };
    return { source, options: createTrayRunOptions(repo.id, configKey) };
  }

  if (identity.kind === "project-profile") {
    // 项目发布配置必须显式绑定 Provider；缺失即拒绝，不做隐式回退（ADR-0044）。
    if (!repo.providerId) {
      throw new Error(`repository has no bound provider: ${repo.id}`);
    }
    return {
      source: {
        kind: "projectProfile",
        providerId: repo.providerId,
        reference: identity.profileName,
      },
      options: createTrayRunOptions(repo.id, configKey),
    };
  }

  throw new Error(`unsupported tray config key: ${configKey}`);
}

export function useTrayRecentPublish(params: {
  appT: TranslationMap;
  runPublishSpec: (
    source: PublishSource,
    options?: RunPublishOptions
  ) => Promise<void>;
}) {
  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | null = null;

    void listen<TrayPublishRequestPayload>(
      "tray-publish-request",
      async (event) => {
        try {
          const resolved = await resolveTrayPublishRequest({
            payload: event.payload,
          });
          if (!disposed) {
            await params.runPublishSpec(resolved.source, resolved.options);
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
      }
    )
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
  }, [params.appT, params.runPublishSpec]);
}
