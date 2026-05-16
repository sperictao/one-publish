import { useCallback, useEffect } from "react";
import { toast } from "sonner";

import type { TranslationMap } from "@/hooks/usePublishRunnerTypes";
import {
  openOutputDirectory,
  setTrayPublishStatus,
  showMainWindow,
} from "@/lib/store";
import type { ExecutionRecord } from "@/lib/store";
import { showSystemNotification } from "@/lib/systemNotification";
import { on } from "@/lib/eventBus";
import type {
  PublishCancelledEvent,
  PublishCompletedEvent,
  PublishFailedEvent,
} from "@/lib/publishEvents";

export interface UsePublishNotifyParams {
  appT: TranslationMap;
  publishT: TranslationMap;
  /** 外部提供的历史记录保存回调。 */
  savePublishRecord: (record: ExecutionRecord) => void;
}

export interface UsePublishNotifyResult {
  notifyFeedback: (
    level: "success" | "warning" | "error",
    title: string,
    description?: string,
    mode?: "toast" | "system"
  ) => Promise<boolean>;
  openOutputDirectoryIfNeeded: (
    shouldOpen: boolean,
    outputDir: string,
    feedbackMode: "toast" | "system"
  ) => Promise<void>;
  restoreMainWindowIfNeeded: (shouldRestore: boolean) => Promise<void>;
  syncTrayPublishStatus: (
    status: "idle" | "success" | "failure"
  ) => Promise<void>;
}

export function usePublishNotify({
  appT,
  publishT,
  savePublishRecord,
}: UsePublishNotifyParams): UsePublishNotifyResult {
  const restoreMainWindowIfNeeded = useCallback(
    async (shouldRestore: boolean) => {
      if (!shouldRestore) return;
      try {
        await showMainWindow();
      } catch {
        // noop
      }
    },
    []
  );

  const syncTrayPublishStatus = useCallback(
    async (status: "idle" | "success" | "failure") => {
      try {
        await setTrayPublishStatus(status);
      } catch {
        // noop
      }
    },
    []
  );

  const notifyFeedback = useCallback(
    async (
      level: "success" | "warning" | "error",
      title: string,
      description?: string,
      mode: "toast" | "system" = "toast"
    ): Promise<boolean> => {
      if (mode === "system") {
        const notified = await showSystemNotification({
          title,
          body: description,
        });
        if (notified) return true;
      }

      const payload = description ? { description } : undefined;
      if (level === "success") {
        toast.success(title, payload);
        return false;
      }
      if (level === "warning") {
        toast.warning(title, payload);
        return false;
      }
      toast.error(title, payload);
      return false;
    },
    []
  );

  const openOutputDirectoryIfNeeded = useCallback(
    async (
      shouldOpen: boolean,
      outputDir: string,
      feedbackMode: "toast" | "system"
    ) => {
      if (!shouldOpen || !outputDir.trim()) return;
      try {
        await openOutputDirectory(outputDir);
      } catch (err) {
        await notifyFeedback(
          "error",
          appT.openOutputDirectoryFailed || "打开输出目录失败",
          String(err),
          feedbackMode
        );
      }
    },
    [appT.openOutputDirectoryFailed, notifyFeedback]
  );

  // ── 事件订阅：监听发布生命周期事件，处理所有副作用 ──

  useEffect(() => {
    const unsubCompleted = on<PublishCompletedEvent>(
      "publish:completed",
      async (event) => {
        // Tray
        if (event.trayStatusEffect) {
          await syncTrayPublishStatus("success");
        }
        // Open output dir
        await openOutputDirectoryIfNeeded(
          event.shouldOpenOutputDir,
          event.outputDir,
          event.feedbackMode
        );
        // Toast / notification
        await notifyFeedback(
          "success",
          publishT.success || "发布成功!",
          event.outputDir
            ? (publishT.output || "输出目录: {{dir}}").replace(
                "{{dir}}",
                event.outputDir
              )
            : appT.commandExecuted || "命令执行成功",
          event.feedbackMode
        );
        // History
        savePublishRecord(event.record);
      }
    );

    const unsubFailed = on<PublishFailedEvent>(
      "publish:failed",
      async (event) => {
        if (event.trayStatusEffect) {
          await syncTrayPublishStatus("failure");
        }
        const notified = await notifyFeedback(
          "error",
          event.feedbackTitle,
          event.feedbackDescription,
          event.feedbackMode
        );
        await restoreMainWindowIfNeeded(
          event.restoreWindowOnFailure || !notified
        );
        savePublishRecord(event.record);
      }
    );

    const unsubCancelled = on<PublishCancelledEvent>(
      "publish:cancelled",
      async (event) => {
        if (event.trayStatusEffect) {
          await syncTrayPublishStatus("idle");
        }
        const notified = await notifyFeedback(
          "warning",
          appT.publishCancelled || "发布已取消",
          event.error ||
            appT.userCancelledTask ||
            "用户取消了执行任务",
          event.feedbackMode
        );
        await restoreMainWindowIfNeeded(
          event.restoreWindowOnFailure || !notified
        );
        savePublishRecord(event.record);
      }
    );

    return () => {
      unsubCompleted();
      unsubFailed();
      unsubCancelled();
    };
  }, [
    appT,
    publishT,
    savePublishRecord,
    syncTrayPublishStatus,
    openOutputDirectoryIfNeeded,
    notifyFeedback,
    restoreMainWindowIfNeeded,
  ]);

  return {
    notifyFeedback,
    openOutputDirectoryIfNeeded,
    restoreMainWindowIfNeeded,
    syncTrayPublishStatus,
  };
}
