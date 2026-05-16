import type { TranslationMap } from "@/hooks/usePublishRunnerTypes";
import {
  createEnvironmentCheckSnapshot,
  runEnvironmentCheck,
  type EnvironmentCheckSnapshot,
} from "@/lib/environment";
import {
  buildPublishOutputValidationDescription,
  buildPublishOutputValidationTitle,
  buildProtectedOutputAccessDescription,
  preflightPublishOutput,
  requestProtectedOutputAccess,
} from "@/lib/publishOutputPreflight";
import {
  executeProviderPublish,
  type ProviderPublishSpec,
  type PublishOutputPreflightResult,
  type PublishResult,
} from "@/lib/publishRuntime";
import { isProtectedOutputAccessFailure } from "@/lib/publishFailure";

const loadInvokeErrors = () => import("@/lib/tauri/invokeErrors");

// ── Types ──────────────────────────────────────────────────────────

export interface PublishPreparationOptions {
  feedbackMode: "toast" | "system";
  restoreWindowOnFailure: boolean;
  trayStatusEffect: boolean;
}

export interface AbortPublishPreparationOptions
  extends PublishPreparationOptions {
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
  setEnvironmentLastCheck: (
    snapshot: EnvironmentCheckSnapshot | null
  ) => void;
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
  }: AbortPublishPreparationOptions) {
    if (trayStatusEffect) {
      await syncTrayPublishStatus(level === "error" ? "failure" : "idle");
    }
    const notified = await notifyFeedback(
      level,
      title,
      description,
      feedbackMode
    );
    onAfterNotify?.(notified);
    if (isCurrentPresentationRevision(runRevision)) {
      resetLogCapture();
    }
    await restoreMainWindowIfNeeded(restoreWindowOnFailure || !notified);
  }

  async function requestProtectedOutputAccessWithWindow(
    spec: ProviderPublishSpec,
    outputPreflight: PublishOutputPreflightResult
  ) {
    await restoreMainWindowIfNeeded(true);
    return await requestProtectedOutputAccess(spec, outputPreflight, appT);
  }

  async function runPublishPreflight(
    spec: ProviderPublishSpec,
    options: PublishPreparationOptions & { runRevision: number }
  ): Promise<boolean> {
    // ── Environment check ──
    try {
      const env = await runEnvironmentCheck([spec.provider_id]);
      const environmentCheck = createEnvironmentCheckSnapshot(env, [
        spec.provider_id,
      ]);
      setEnvironmentLastCheck(environmentCheck);

      const critical = env.issues.find(
        (item) => item.severity === "critical"
      );
      if (critical) {
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

      const warning = env.issues.find(
        (item) => item.severity === "warning"
      );
      if (warning) {
        await notifyFeedback(
          "warning",
          appT.environmentWarning || "环境存在警告",
          warning.description,
          options.feedbackMode
        );
      }
    } catch (err) {
      const { extractInvokeErrorMessage } = await loadInvokeErrors();
      await abortPublishPreparation({
        ...options,
        level: "error",
        title: appT.environmentCheckFailed || "环境检查失败",
        description: extractInvokeErrorMessage(err),
      });
      return false;
    }

    // ── Output preflight ──
    let outputPreflight: PublishOutputPreflightResult;
    try {
      outputPreflight = await preflightPublishOutput(spec);
    } catch (err) {
      const { extractInvokeErrorMessage } = await loadInvokeErrors();
      await abortPublishPreparation({
        ...options,
        level: "error",
        title: appT.publishOutputPreflightFailed || "发布目录预检失败",
        description: extractInvokeErrorMessage(err),
      });
      return false;
    }

    if (outputPreflight.validation.status === "incompatible") {
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
          outputPreflight
        );
        outputPreflight = accessRequest.preflight;
      } catch (err) {
        const { extractInvokeErrorMessage } = await loadInvokeErrors();
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

    return true;
  }

  async function requestProtectedOutputAccessForRetry(
    spec: ProviderPublishSpec
  ): Promise<boolean> {
    const outputPreflight = await preflightPublishOutput(spec);
    if (outputPreflight.validation.status === "incompatible") {
      return false;
    }

    if (
      outputPreflight.access.status !== "granted" &&
      outputPreflight.access.status !== "denied"
    ) {
      return false;
    }

    const accessRequest = await requestProtectedOutputAccessWithWindow(
      spec,
      outputPreflight
    );
    return (
      accessRequest.selectedDirectory !== null &&
      accessRequest.preflight.access.status !== "denied"
    );
  }

  async function executePublishWithProtectedAccessRecovery(
    spec: ProviderPublishSpec
  ): Promise<PublishResult> {
    let result: PublishResult;
    try {
      result = await executeProviderPublish(spec);
    } catch (err) {
      const { analyzePublishExecutionFailure } = await loadInvokeErrors();
      if (
        analyzePublishExecutionFailure(err) !==
        "protected_directory_access_denied"
      ) {
        throw err;
      }

      let shouldRetry = false;
      try {
        shouldRetry = await requestProtectedOutputAccessForRetry(spec);
      } catch {
        throw err;
      }

      if (!shouldRetry) {
        throw err;
      }

      return await executeProviderPublish(spec);
    }

    if (
      !isProtectedOutputAccessFailure({
        error: result.error,
        outputLog: result.output_log,
      })
    ) {
      return result;
    }

    let shouldRetry = false;
    try {
      shouldRetry = await requestProtectedOutputAccessForRetry(spec);
    } catch {
      return result;
    }

    if (!shouldRetry) {
      return result;
    }

    return await executeProviderPublish(spec);
  }

  return {
    runPublishPreflight,
    executePublishWithProtectedAccessRecovery,
  };
}
