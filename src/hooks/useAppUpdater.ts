import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useI18n, t } from "@/hooks/useI18n";
import {
  checkUpdate,
  getCurrentVersion,
  getUpdaterConfigHealth,
  getUpdaterHelpPaths,
  installUpdate,
  openUpdaterHelp,
  type UpdateInfo,
  type UpdaterConfigHealth,
  type UpdaterHelpPaths,
} from "@/lib/store";

function formatMessage(template: string, ...args: Array<string | number>) {
  let output = template;
  args.forEach((arg) => {
    output = output.replace("{}", String(arg));
  });
  return output;
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

interface RefreshOptions {
  silent?: boolean;
  notifyIfAvailable?: boolean;
}

export interface AppUpdaterState {
  currentVersion: string | null;
  updateInfo: UpdateInfo | null;
  updaterHelpPaths: UpdaterHelpPaths | null;
  updaterConfigHealth: UpdaterConfigHealth | null;
  isCheckingUpdate: boolean;
  isInstallingUpdate: boolean;
  isOpeningUpdaterHelp: boolean;
}

const INITIAL_STATE: AppUpdaterState = {
  currentVersion: null,
  updateInfo: null,
  updaterHelpPaths: null,
  updaterConfigHealth: null,
  isCheckingUpdate: false,
  isInstallingUpdate: false,
  isOpeningUpdaterHelp: false,
};

export function useAppUpdater() {
  const [state, setState] = useState<AppUpdaterState>(INITIAL_STATE);
  const autoCheckStartedRef = useRef(false);
  const lastNotifiedVersionRef = useRef<string | null>(null);
  const { translations } = useI18n();

  const resolveUpdaterHelpPaths = useCallback(
    async (
      message: string | null | undefined,
      health: UpdaterConfigHealth | null
    ) => {
      const needsHelp =
        Boolean(health && !health.configured) ||
        Boolean(
          message &&
            (message.includes("更新源未配置") ||
              message.toLowerCase().includes("updater"))
        );

      if (!isTauri() || !needsHelp) {
        return null;
      }

      try {
        return await getUpdaterHelpPaths();
      } catch (error) {
        console.error("获取 updater 帮助路径失败:", error);
        return null;
      }
    },
    []
  );

  const checkForUpdates = useCallback(
    async ({ silent = false, notifyIfAvailable = false }: RefreshOptions = {}) => {
      if (!isTauri()) {
        return null;
      }

      setState((prev) => ({ ...prev, isCheckingUpdate: true }));

      let resolvedCurrentVersion: string | null = null;

      try {
        try {
          resolvedCurrentVersion = await getCurrentVersion();
          setState((prev) => ({
            ...prev,
            currentVersion: resolvedCurrentVersion ?? prev.currentVersion,
          }));
        } catch (error) {
          console.error("获取当前版本失败:", error);
        }

        const info = await checkUpdate();
        const health = await getUpdaterConfigHealth();
        const helpPaths = await resolveUpdaterHelpPaths(info.message, health);

        setState((prev) => ({
          ...prev,
          currentVersion:
            resolvedCurrentVersion ?? info.currentVersion ?? prev.currentVersion,
          updateInfo: info,
          updaterConfigHealth: health,
          updaterHelpPaths: helpPaths,
        }));

        if (
          notifyIfAvailable &&
          info.hasUpdate &&
          info.availableVersion &&
          lastNotifiedVersionRef.current !== info.availableVersion
        ) {
          lastNotifiedVersionRef.current = info.availableVersion;
          toast.success(formatMessage(t("version.new"), info.availableVersion), {
            description:
              translations.version?.autoCheckDescription ||
              "发现新版本，可前往设置 > 关于安装更新。",
          });
        }

        return info;
      } catch (error) {
        const errorMessage = toErrorMessage(error);
        console.error("检查更新失败:", error);

        if (!silent) {
          setState((prev) => ({
            ...prev,
            currentVersion: resolvedCurrentVersion ?? prev.currentVersion,
            updateInfo: {
              currentVersion:
                prev.updateInfo?.currentVersion ||
                resolvedCurrentVersion ||
                prev.currentVersion ||
                "",
              availableVersion: prev.updateInfo?.availableVersion || null,
              hasUpdate: false,
              releaseNotes: prev.updateInfo?.releaseNotes || null,
              message: errorMessage,
            },
          }));
        }

        return null;
      } finally {
        setState((prev) => ({ ...prev, isCheckingUpdate: false }));
      }
    },
    [resolveUpdaterHelpPaths, translations.version?.autoCheckDescription]
  );

  const installAvailableUpdate = useCallback(async () => {
    if (!isTauri()) {
      return;
    }

    setState((prev) => ({ ...prev, isInstallingUpdate: true }));

    try {
      const installMessage = await installUpdate();
      const latestInfo = await checkForUpdates({ silent: true });

      setState((prev) => ({
        ...prev,
        updateInfo: {
          currentVersion:
            latestInfo?.currentVersion ||
            prev.updateInfo?.currentVersion ||
            prev.currentVersion ||
            "",
          availableVersion:
            latestInfo?.availableVersion || prev.updateInfo?.availableVersion || null,
          hasUpdate: false,
          releaseNotes:
            latestInfo?.releaseNotes || prev.updateInfo?.releaseNotes || null,
          message: installMessage || latestInfo?.message || null,
        },
      }));
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      console.error("安装更新失败:", error);

      setState((prev) => ({
        ...prev,
        updateInfo: {
          currentVersion:
            prev.updateInfo?.currentVersion || prev.currentVersion || "",
          availableVersion: prev.updateInfo?.availableVersion || null,
          hasUpdate: prev.updateInfo?.hasUpdate || false,
          releaseNotes: prev.updateInfo?.releaseNotes || null,
          message: errorMessage,
        },
      }));
    } finally {
      setState((prev) => ({ ...prev, isInstallingUpdate: false }));
    }
  }, [checkForUpdates]);

  const openUpdaterHelpTarget = useCallback(
    async (target: "docs" | "template") => {
      if (!isTauri()) {
        return;
      }

      setState((prev) => ({ ...prev, isOpeningUpdaterHelp: true }));

      try {
        await openUpdaterHelp(target);
      } catch (error) {
        console.error("打开 updater 帮助失败:", error);
      } finally {
        setState((prev) => ({ ...prev, isOpeningUpdaterHelp: false }));
      }
    },
    []
  );

  useEffect(() => {
    if (!isTauri() || autoCheckStartedRef.current) {
      return;
    }

    autoCheckStartedRef.current = true;
    void checkForUpdates({ silent: true, notifyIfAvailable: true });
  }, [checkForUpdates]);

  return {
    updaterState: state,
    checkForUpdates,
    installAvailableUpdate,
    openUpdaterHelpTarget,
  };
}
