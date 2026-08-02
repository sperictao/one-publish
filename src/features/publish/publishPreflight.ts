import type { TranslationMap } from "@/features/publish/publishTransaction";
import {
  createEnvironmentCheckSnapshot,
  runEnvironmentCheck,
  type EnvironmentCheckSnapshot,
} from "@/features/environment/environment";
import {
  buildPublishOutputValidationDescription,
  buildPublishOutputValidationTitle,
  buildProtectedOutputAccessDescription,
  preflightPublishOutput,
  requestProtectedOutputAccess,
} from "@/features/publish/publishOutputPreflight";
import {
  type ProviderPublishSpec,
  type PublishOutputPreflightResult,
} from "@/features/publish/publishRuntime";

const loadInvokeErrors = () => import("@/lib/tauri/invokeErrors");

// ── Types ──────────────────────────────────────────────────────────

export interface PublishPreparationOptions {
  feedbackMode: "toast" | "system";
  restoreWindowOnFailure: boolean;
  trayStatusEffect: boolean;
  isCancelled: () => boolean;
}

export interface AbortPublishPreparationOptions extends PublishPreparationOptions {
  runRevision: number;
  level: "error" | "warning";
  title: string;
  description: string;
  onAfterNotify?: (notified: boolean) => void;
}

// ── Dependencies ───────────────────────────────────────────────────

export interface PublishPreflightDeps {
  appT: TranslationMap;
  notifyFeedback: (
    level: "success" | "warning" | "error",
    title: string,
    description?: string,
    mode?: "toast" | "system"
  ) => Promise<boolean>;
  syncTrayPublishStatus: (
    status: "idle" | "success" | "failure"
  ) => Promise<void>;
  restoreMainWindowIfNeeded: (shouldRestore: boolean) => Promise<void>;
  resetLogCapture: () => void;
  isCurrentPresentationRevision: (runRevision: number) => boolean;
  openEnvironmentDialog: (
    initialCheck?: EnvironmentCheckSnapshot | null,
    providerIds?: string[]
  ) => void;
  setEnvironmentLastCheck: (snapshot: EnvironmentCheckSnapshot | null) => void;
}

// ── Factory ────────────────────────────────────────────────────────

export function createPublishPreflightPipeline(deps: PublishPreflightDeps) {
  const {
    appT,
    notifyFeedback,
    syncTrayPublishStatus,
    restoreMainWindowIfNeeded,
    resetLogCapture,
    isCurrentPresentationRevision,
    openEnvironmentDialog,
    setEnvironmentLastCheck,
  } = deps;

  async function abortPublishPreparation({
    runRevision,
    feedbackMode,
    restoreWindowOnFailure,
    trayStatusEffect,
    level,
    title,
    description,
    onAfterNotify,
    isCancelled,
  }: AbortPublishPreparationOptions) {
    if (isCancelled()) {
      return;
    }
    if (trayStatusEffect) {
      await syncTrayPublishStatus(level === "error" ? "failure" : "idle");
      if (isCancelled()) {
        return;
      }
    }
    const notified = await notifyFeedback(
      level,
      title,
      description,
      feedbackMode
    );
    if (isCancelled()) {
      return;
    }
    onAfterNotify?.(notified);
    if (isCurrentPresentationRevision(runRevision)) {
      resetLogCapture();
    }
    if (isCancelled()) {
      return;
    }
    await restoreMainWindowIfNeeded(restoreWindowOnFailure || !notified);
  }

  async function requestProtectedOutputAccessWithWindow(
    spec: ProviderPublishSpec,
    outputPreflight: PublishOutputPreflightResult,
    isCancelled: () => boolean = () => false
  ) {
    if (isCancelled()) {
      return null;
    }
    await restoreMainWindowIfNeeded(true);
    if (isCancelled()) {
      return null;
    }
    return await requestProtectedOutputAccess(spec, outputPreflight, appT);
  }

  async function runPublishPreflight(
    spec: ProviderPublishSpec,
    options: PublishPreparationOptions & { runRevision: number }
  ): Promise<boolean> {
    if (options.isCancelled()) {
      return false;
    }
    // ── Environment check ──
    try {
      const env = await runEnvironmentCheck([spec.provider_id]);
      if (options.isCancelled()) {
        return false;
      }
      const environmentCheck = createEnvironmentCheckSnapshot(env, [
        spec.provider_id,
      ]);
      setEnvironmentLastCheck(environmentCheck);

      const critical = env.issues.find((item) => item.severity === "critical");
      if (critical) {
        if (options.isCancelled()) {
          return false;
        }
        await abortPublishPreparation({
          ...options,
          level: "error",
          title: appT.environmentBlocked || "环境未就绪，已阻止发布",
          description: critical.description,
          onAfterNotify: (notified) => {
            if (options.feedbackMode === "toast" || !notified) {
              openEnvironmentDialog(environmentCheck, [spec.provider_id]);
            }
          },
        });
        return false;
      }

      const warning = env.issues.find((item) => item.severity === "warning");
      if (warning) {
        if (options.isCancelled()) {
          return false;
        }
        await notifyFeedback(
          "warning",
          appT.environmentWarning || "环境存在警告",
          warning.description,
          options.feedbackMode
        );
      }
    } catch (err) {
      if (options.isCancelled()) {
        return false;
      }
      const { extractInvokeErrorMessage } = await loadInvokeErrors();
      if (options.isCancelled()) {
        return false;
      }
      await abortPublishPreparation({
        ...options,
        level: "error",
        title: appT.environmentCheckFailed || "环境检查失败",
        description: extractInvokeErrorMessage(err),
      });
      return false;
    }

    // ── Output preflight ──
    if (options.isCancelled()) {
      return false;
    }
    let outputPreflight: PublishOutputPreflightResult;
    try {
      outputPreflight = await preflightPublishOutput(spec);
      if (options.isCancelled()) {
        return false;
      }
    } catch (err) {
      if (options.isCancelled()) {
        return false;
      }
      const { extractInvokeErrorMessage } = await loadInvokeErrors();
      if (options.isCancelled()) {
        return false;
      }
      await abortPublishPreparation({
        ...options,
        level: "error",
        title: appT.publishOutputPreflightFailed || "发布目录预检失败",
        description: extractInvokeErrorMessage(err),
      });
      return false;
    }

    if (outputPreflight.validation.status === "incompatible") {
      if (options.isCancelled()) {
        return false;
      }
      await abortPublishPreparation({
        ...options,
        level: "error",
        title: buildPublishOutputValidationTitle(outputPreflight, appT),
        description: buildPublishOutputValidationDescription(
          outputPreflight,
          appT
        ),
      });
      return false;
    }

    if (outputPreflight.access.status === "denied") {
      try {
        const accessRequest = await requestProtectedOutputAccessWithWindow(
          spec,
          outputPreflight,
          options.isCancelled
        );
        if (!accessRequest || options.isCancelled()) {
          return false;
        }
        outputPreflight = accessRequest.preflight;
      } catch (err) {
        if (options.isCancelled()) {
          return false;
        }
        const { extractInvokeErrorMessage } = await loadInvokeErrors();
        if (options.isCancelled()) {
          return false;
        }
        await abortPublishPreparation({
          ...options,
          level: "error",
          title:
            appT.publishProtectedDirectoryAccessRequestFailed ||
            "申请目录访问权限失败",
          description: extractInvokeErrorMessage(err),
        });
        return false;
      }
    }

    if (outputPreflight.access.status === "denied") {
      if (options.isCancelled()) {
        return false;
      }
      await abortPublishPreparation({
        ...options,
        level: "error",
        title:
          appT.publishProtectedDirectoryAccessDenied ||
          "缺少 macOS 受保护目录访问权限",
        description: buildProtectedOutputAccessDescription(
          outputPreflight,
          appT
        ),
      });
      return false;
    }

    return !options.isCancelled();
  }

  return {
    runPublishPreflight,
  };
}
