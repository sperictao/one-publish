import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

import type {
  RunPublishOptions,
  TranslationMap,
} from "@/hooks/usePublishRunnerTypes";
import { usePublishStore } from "@/store/publishStore";
import {
  createPublishExecutionRecord,
} from "@/lib/publishExecutionRecord";
import { normalizePublishResult } from "@/lib/publishFailure";
import {
  cancelProviderPublish,
  type ProviderPublishSpec,
} from "@/lib/publishRuntime";
import type { UsePublishValidateResult } from "@/hooks/usePublishValidate";
import type { SpecValue } from "@/generated/tauri-contracts";
import { emit } from "@/lib/eventBus";
import {
  type PublishCancelledEvent,
  type PublishCompletedEvent,
  type PublishFailedEvent,
} from "@/lib/publishEvents";

const loadInvokeErrors = () => import("@/lib/tauri/invokeErrors");
const loadPublishFailureFeedback = () =>
  import("@/hooks/usePublishFailureFeedback");
const loadCancelPublishFeedback = () =>
  import("@/hooks/useCancelPublishFeedback");

export interface UsePublishExecuteParams {
  appT: TranslationMap;
  publishT: TranslationMap;
  selectedRepoId: string | null;
  selectedRepo: { path: string } | null;
  activeProviderId: string;
  activeProviderUsesProjectFile: boolean;
  selectedPreset: string;
  isCustomMode: boolean;
  projectInfo: { project_file?: string } | null;
  specVersion: number;
  pushRecentConfig: (key: string, repoId?: string | null) => void;
  beginLogCapture: () => void;
  hideLogCapture: () => void;
  getOutputLogSnapshot: () => string;
  replaceCapturedOutputLog: (log: string) => void;
  validate: UsePublishValidateResult;
}

export interface UsePublishExecuteResult {
  startPublish: () => Promise<void>;
  cancelPublish: () => Promise<void>;
  runPublishSpec: (
    spec: ProviderPublishSpec,
    options?: RunPublishOptions
  ) => Promise<void>;
}

export function usePublishExecute({
  appT,
  publishT,
  selectedRepoId,
  selectedRepo,
  activeProviderId,
  activeProviderUsesProjectFile,
  selectedPreset,
  isCustomMode,
  projectInfo,
  specVersion,
  pushRecentConfig,
  beginLogCapture,
  hideLogCapture,
  getOutputLogSnapshot,
  replaceCapturedOutputLog,
  validate,
}: UsePublishExecuteParams): UsePublishExecuteResult {
  const presentationRevisionRef = useRef(0);

  const setIsPublishing = usePublishStore((s) => s.setIsPublishing);
  const setIsCancellingPublish = usePublishStore(
    (s) => s.setIsCancellingPublish
  );
  const setPublishResult = usePublishStore((s) => s.setPublishResult);
  const setLastPublishSpec = usePublishStore((s) => s.setLastPublishSpec);
  const setCurrentPublishRecordId = usePublishStore(
    (s) => s.setCurrentPublishRecordId
  );
  const setReleaseChecklistOpen = usePublishStore(
    (s) => s.setReleaseChecklistOpen
  );
  const setArtifactActionState = usePublishStore(
    (s) => s.setArtifactActionState
  );

  const clearPublishPresentationState = useCallback(() => {
    setPublishResult(null);
    setLastPublishSpec(null);
    setCurrentPublishRecordId(null);
    setReleaseChecklistOpen(false);
    setArtifactActionState({ packageResult: null, signResult: null });
  }, [
    setArtifactActionState,
    setCurrentPublishRecordId,
    setLastPublishSpec,
    setPublishResult,
    setReleaseChecklistOpen,
  ]);

  const isCurrentPresentationRevision = useCallback(
    (runRevision: number) => {
      return presentationRevisionRef.current === runRevision;
    },
    []
  );

  const startPublishPresentationRun = useCallback(() => {
    const runRevision = presentationRevisionRef.current + 1;
    presentationRevisionRef.current = runRevision;
    beginLogCapture();
    clearPublishPresentationState();
    return runRevision;
  }, [beginLogCapture, clearPublishPresentationState]);

  const resetPublishPresentation = useCallback(() => {
    presentationRevisionRef.current += 1;
    hideLogCapture();
    clearPublishPresentationState();
  }, [clearPublishPresentationState, hideLogCapture]);

  const waitForOutputLogSnapshot = useCallback(async (): Promise<string> => {
    await new Promise<void>((resolve) => {
      if (
        typeof window === "undefined" ||
        typeof window.setTimeout !== "function"
      ) {
        resolve();
        return;
      }

      window.setTimeout(resolve, 0);
    });

    return getOutputLogSnapshot();
  }, [getOutputLogSnapshot]);

  // Reset presentation state when publish scope changes
  useEffect(() => {
    resetPublishPresentation();
  }, [validate.publishPresentationScopeKey, resetPublishPresentation]);

  const runPublishSpec = useCallback(
    async (spec: ProviderPublishSpec, options?: RunPublishOptions) => {
      const effectiveRepoId = options?.repoId ?? selectedRepoId;
      const recentConfigKey = options?.recentConfigKey;
      const openOutputDirOnSuccess =
        options?.openOutputDirOnSuccess ?? false;
      const restoreWindowOnFailure =
        options?.restoreWindowOnFailure ?? false;
      const feedbackMode = options?.feedbackMode ?? "toast";
      const trayStatusEffect = options?.trayStatusEffect ?? false;
      const runRevision = startPublishPresentationRun();

      const preflightPassed = await validate.runPublishPreflight(spec, {
        runRevision,
        feedbackMode,
        restoreWindowOnFailure,
        trayStatusEffect,
      });
      if (!preflightPassed) {
        return;
      }

      if (isCurrentPresentationRevision(runRevision)) {
        setLastPublishSpec(spec);
      }
      setIsPublishing(true);

      const executionStartedAt = new Date().toISOString();

      try {
        if (recentConfigKey) {
          pushRecentConfig(recentConfigKey, effectiveRepoId);
        }

        const result =
          await validate.executePublishWithProtectedAccessRecovery(spec);
        const outputLogSnapshot =
          result.output_log || (await waitForOutputLogSnapshot());
        const resolvedResult = normalizePublishResult({
          result,
          outputLog: outputLogSnapshot,
        });

        if (isCurrentPresentationRevision(runRevision)) {
          replaceCapturedOutputLog(outputLogSnapshot);
          setPublishResult(resolvedResult);
        }

        const record = createPublishExecutionRecord({
          spec,
          repoId: effectiveRepoId,
          startedAt: executionStartedAt,
          finishedAt: new Date().toISOString(),
          result: resolvedResult,
          outputLog: outputLogSnapshot,
        });
        if (isCurrentPresentationRevision(runRevision)) {
          setCurrentPublishRecordId(record.id);
        }

        if (resolvedResult.success) {
          emit<PublishCompletedEvent>("publish:completed", {
            repoId: effectiveRepoId,
            outputDir: resolvedResult.output_dir,
            outputLog: outputLogSnapshot,
            shouldOpenOutputDir: openOutputDirOnSuccess,
            feedbackMode,
            trayStatusEffect,
            restoreWindowOnFailure,
            record,
          });
        } else if (resolvedResult.cancelled) {
          emit<PublishCancelledEvent>("publish:cancelled", {
            repoId: effectiveRepoId,
            error: resolvedResult.error || "",
            outputLog: outputLogSnapshot,
            feedbackMode,
            trayStatusEffect,
            restoreWindowOnFailure,
            record,
          });
        } else {
          emit<PublishFailedEvent>("publish:failed", {
            repoId: effectiveRepoId,
            error: resolvedResult.error || "",
            outputLog: outputLogSnapshot,
            feedbackTitle: publishT.failed || "发布失败",
            feedbackDescription:
              resolvedResult.error || appT.unknownError || "未知错误",
            feedbackMode,
            trayStatusEffect,
            restoreWindowOnFailure,
            record,
          });
        }
      } catch (err) {
        const [
          { analyzePublishExecutionFailure, extractInvokeErrorMessage },
          { getPublishFailureFeedback },
        ] = await Promise.all([
          loadInvokeErrors(),
          loadPublishFailureFeedback(),
        ]);
        const rawErrorMessage = extractInvokeErrorMessage(err);
        const failureReason = analyzePublishExecutionFailure(err);
        const outputLogSnapshot = await waitForOutputLogSnapshot();

        const failedResult = normalizePublishResult({
          result: {
            provider_id: spec.provider_id,
            success: false,
            cancelled: false,
            error: rawErrorMessage,
            command: {
              program: "",
              args: [],
              working_dir: null,
              display_command: "",
            },
            output_log: "",
            output_dir: "",
            file_count: 0,
          },
          outputLog: outputLogSnapshot,
        });
        if (isCurrentPresentationRevision(runRevision)) {
          replaceCapturedOutputLog(outputLogSnapshot);
          setPublishResult(failedResult);
        }

        const feedback = getPublishFailureFeedback(
          failureReason,
          appT,
          failedResult.error ?? rawErrorMessage
        );

        const record = createPublishExecutionRecord({
          spec,
          repoId: effectiveRepoId,
          startedAt: executionStartedAt,
          finishedAt: new Date().toISOString(),
          result: failedResult,
          outputLog: outputLogSnapshot,
        });
        if (isCurrentPresentationRevision(runRevision)) {
          setCurrentPublishRecordId(record.id);
        }

        emit<PublishFailedEvent>("publish:failed", {
          repoId: effectiveRepoId,
          error: failedResult.error || rawErrorMessage || "",
          outputLog: outputLogSnapshot,
          feedbackTitle: feedback.title,
          feedbackDescription: failedResult.error || feedback.description,
          feedbackMode,
          trayStatusEffect,
          restoreWindowOnFailure,
          record,
        });
      } finally {
        setIsPublishing(false);
        setIsCancellingPublish(false);
      }
    },
    [
      appT,
      isCurrentPresentationRevision,
      publishT,
      pushRecentConfig,
      validate,
      selectedRepoId,
      setIsCancellingPublish,
      setIsPublishing,
      setLastPublishSpec,
      setCurrentPublishRecordId,
      replaceCapturedOutputLog,
      startPublishPresentationRun,
      waitForOutputLogSnapshot,
    ]
  );

  const startPublish = useCallback(async () => {
    if (!selectedRepo) {
      toast.error(appT.selectRepositoryFirst || "请先选择仓库");
      return;
    }

    if (activeProviderUsesProjectFile && !projectInfo) {
      toast.error(appT.selectDotnetProjectFirst || "请先选择 .NET 项目");
      return;
    }

    if (
      activeProviderId === "dotnet" &&
      projectInfo &&
      !isCustomMode &&
      selectedPreset.startsWith("profile-")
    ) {
      const projectProfile =
        validate.resolvedProjectProfile ??
        (await validate.resolveSelectedProjectProfile());

      if (projectProfile) {
        await runPublishSpec(
          {
            version: specVersion,
            provider_id: "dotnet",
            project_path: projectInfo.project_file!,
            parameters:
              projectProfile.parameters as Record<string, SpecValue>,
          },
          {
            repoId: selectedRepoId,
            recentConfigKey:
              validate.recentConfigKeyForCurrentSelection ?? undefined,
          }
        );
        return;
      }
    }

    const spec = validate.buildPublishSpec();
    if (!spec) {
      return;
    }

    await runPublishSpec(spec, {
      repoId: selectedRepoId,
      recentConfigKey:
        validate.recentConfigKeyForCurrentSelection ?? undefined,
    });
  }, [
    activeProviderId,
    activeProviderUsesProjectFile,
    appT,
    isCustomMode,
    projectInfo,
    runPublishSpec,
    selectedRepoId,
    selectedRepo,
    selectedPreset,
    specVersion,
    validate,
  ]);

  const cancelPublish = useCallback(async () => {
    const { isPublishing, isCancellingPublish } =
      usePublishStore.getState();
    if (!isPublishing || isCancellingPublish) {
      return;
    }

    setIsCancellingPublish(true);
    try {
      const cancelled = await cancelProviderPublish();
      if (cancelled) {
        toast.message(
          appT.cancellingPublish || "正在取消发布..."
        );
      } else {
        toast.message(
          appT.noRunningPublishTask || "当前没有运行中的发布任务"
        );
      }
    } catch (err) {
      const [
        { extractInvokeErrorCode, extractInvokeErrorMessage },
        { getCancelPublishFeedback },
      ] = await Promise.all([
        loadInvokeErrors(),
        loadCancelPublishFeedback(),
      ]);
      const errorCode = extractInvokeErrorCode(err);
      const feedback = getCancelPublishFeedback(
        appT,
        errorCode,
        extractInvokeErrorMessage(err)
      );
      toast.error(feedback.title, {
        description: feedback.description,
      });
    } finally {
      setIsCancellingPublish(false);
    }
  }, [appT, setIsCancellingPublish]);

  return {
    startPublish,
    cancelPublish,
    runPublishSpec,
  };
}
