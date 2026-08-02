import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type {
  RunPublishOptions,
  TranslationMap,
} from "@/features/publish/publishTransaction";
import { usePublishStore } from "@/stores/publishStore";
import { createPublishExecutionRecord } from "@/features/history/publishExecutionRecord";
import { exportExecutionSnapshot } from "@/features/history/executionSnapshot";
import { normalizePublishResult } from "@/features/history/publishFailure";
import {
  cancelPublishRuntime,
  prepareDraftPublishRuntime,
  preparePublishRuntime,
  resumePublishRuntime,
  startPublishRuntime,
  synchronizePublishRuntime,
  type PreparedPublishRuntime,
  type ProviderPublishSpec,
  type PublishResult,
  type PublishRuntimeResult,
} from "@/features/publish/publishRuntime";
import {
  createFailedPublishTransactionResult,
  createPublishTransactionContext,
  shouldRecordRecentConfig,
} from "@/features/publish/publishTransaction";
import type { UsePublishValidateResult } from "@/features/publish/usePublishValidate";
import { emit } from "@/lib/eventBus";
import {
  type PublishCancelledEvent,
  type PublishCompletedEvent,
  type PublishFailedEvent,
} from "@/features/publish/publishEvents";

const loadInvokeErrors = () => import("@/lib/tauri/invokeErrors");
const loadPublishFailureFeedback = () =>
  import("@/features/publish/usePublishFailureFeedback");
const loadCancelPublishFeedback = () =>
  import("@/features/publish/cancelPublishFeedback");

export interface UsePublishExecuteParams {
  appT: TranslationMap;
  publishT: TranslationMap;
  selectedRepoId: string | null;
  selectedRepoPath: string | null;
  pushRecentConfig: (key: string, repoId?: string | null) => void;
  beginLogCapture: () => void;
  hideLogCapture: () => void;
  getOutputLogSnapshot: () => string;
  replaceCapturedOutputLog: (log: string) => void;
  validate: UsePublishValidateResult;
  currentConfigurationId?: string | null;
  currentConfigurationRevisionId?: string | null;
  currentConfigurationBlockedReason?: string | null;
}

export interface UsePublishExecuteResult {
  startPublish: () => Promise<void>;
  cancelPublish: () => Promise<void>;
  runPublishSpec: (
    spec: ProviderPublishSpec,
    options?: RunPublishOptions,
    preparedRuntime?: PreparedPublishRuntime
  ) => Promise<void>;
  activeRuntime: PreparedPublishRuntime | null;
  runtimeResult: PublishRuntimeResult | null;
}

type ActivePublishRun = {
  revision: number;
  phase: "preflight" | "running";
  cancelled: boolean;
  runtimeToken?: string;
  attemptId?: string;
};

export function usePublishExecute({
  appT,
  publishT,
  selectedRepoId,
  selectedRepoPath,
  pushRecentConfig,
  beginLogCapture,
  hideLogCapture,
  getOutputLogSnapshot,
  replaceCapturedOutputLog,
  validate,
  currentConfigurationId,
  currentConfigurationRevisionId,
  currentConfigurationBlockedReason,
}: UsePublishExecuteParams): UsePublishExecuteResult {
  const presentationRevisionRef = useRef(0);
  const activeRunRef = useRef<ActivePublishRun | null>(null);
  const [activeRuntime, setActiveRuntime] =
    useState<PreparedPublishRuntime | null>(null);
  const [runtimeResult, setRuntimeResult] =
    useState<PublishRuntimeResult | null>(null);

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

  const isCurrentPresentationRevision = useCallback((runRevision: number) => {
    return presentationRevisionRef.current === runRevision;
  }, []);

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
    if (!usePublishStore.getState().isPublishing) {
      // Scope changes must synchronously retire stale local runtime state before
      // the recovery effect can expose the new scope's persisted Attempt.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveRuntime(null);
      setRuntimeResult(null);
      activeRunRef.current = null;
    }
  }, [validate.publishPresentationScopeKey, resetPublishPresentation]);

  useEffect(() => {
    if (!selectedRepoPath || !currentConfigurationRevisionId) {
      return;
    }
    let disposed = false;
    void synchronizePublishRuntime({
      repositoryPath: selectedRepoPath,
      configurationRevisionId: currentConfigurationRevisionId,
      events: [],
    })
      .then((report) => {
        const recovered = report.result;
        if (
          disposed ||
          activeRunRef.current ||
          !recovered ||
          recovered.attempt.status !== "running"
        ) {
          return;
        }
        setActiveRuntime(null);
        setRuntimeResult(recovered);
        activeRunRef.current = {
          revision: presentationRevisionRef.current,
          phase: "running",
          cancelled: false,
          attemptId: recovered.attempt.attemptId,
        };
        setIsPublishing(false);
      })
      .catch(async (error) => {
        const { extractInvokeErrorCode, extractInvokeErrorMessage } =
          await loadInvokeErrors();
        if (
          !disposed &&
          extractInvokeErrorCode(error) !== "publish_runtime_attempt_not_found"
        ) {
          toast.error(appT.publishRuntimeRecoveryFailed || "恢复发布状态失败", {
            description: extractInvokeErrorMessage(error),
          });
        }
      });
    return () => {
      disposed = true;
    };
  }, [
    appT.publishRuntimeRecoveryFailed,
    currentConfigurationRevisionId,
    selectedRepoPath,
    setIsPublishing,
  ]);

  const runPublishSpec = useCallback(
    async (
      spec: ProviderPublishSpec,
      options?: RunPublishOptions,
      preparedRuntime?: PreparedPublishRuntime
    ) => {
      if (usePublishStore.getState().isPublishing) {
        return;
      }

      const transaction = createPublishTransactionContext({
        selectedRepoId,
        options,
      });
      const runRevision = startPublishPresentationRun();
      activeRunRef.current = {
        revision: runRevision,
        phase: "preflight",
        cancelled: false,
      };
      setIsPublishing(true);

      const preflightPassed = await validate.runPublishPreflight(spec, {
        runRevision,
        feedbackMode: transaction.feedbackMode,
        restoreWindowOnFailure: transaction.restoreWindowOnFailure,
        trayStatusEffect: transaction.trayStatusEffect,
        isCancelled: () => {
          const activeRun = activeRunRef.current;
          return activeRun?.revision !== runRevision || activeRun.cancelled;
        },
      });
      const activeRun = activeRunRef.current;
      if (
        !preflightPassed ||
        activeRun?.revision !== runRevision ||
        activeRun.cancelled
      ) {
        if (activeRun?.revision === runRevision) {
          activeRunRef.current = null;
          setIsPublishing(false);
          setIsCancellingPublish(false);
        }
        return;
      }
      activeRun.phase = "running";
      setRuntimeResult(null);

      if (isCurrentPresentationRevision(runRevision)) {
        setLastPublishSpec(spec);
      }

      let runtimeAccepted = false;
      let runtimeRemainsPending = false;
      let prepared: PreparedPublishRuntime | null = null;
      try {
        // plan 033 路线 B：交互入口复用 validate 准备好的 Runtime；rerun/tray
        // 等不带 preparedRuntime 的入口在现场准备——命名配置按原修订，其余经
        // 自动草稿配置物化新修订。草稿修订参数与 spec 同源，重复准备同参数
        // 发布只会追加一个等值修订，不产生状态分叉。
        prepared =
          preparedRuntime ??
          (currentConfigurationId && currentConfigurationRevisionId
            ? await preparePublishRuntime({
                repositoryId: transaction.repoId ?? selectedRepoId!,
                repositoryPath: selectedRepoPath!,
                configurationId: currentConfigurationId,
                configurationRevisionId: currentConfigurationRevisionId,
                spec,
              })
            : await prepareDraftPublishRuntime({
                repositoryId: transaction.repoId ?? selectedRepoId!,
                repositoryPath: selectedRepoPath!,
                providerId: spec.provider_id,
                parameters: spec.parameters,
                spec,
              }));
        if (!prepared) {
          throw new Error("PublishRuntime preparation returned no result");
        }

        activeRun.runtimeToken = prepared.runtimeToken;
        setActiveRuntime(prepared);

        if (shouldRecordRecentConfig(transaction)) {
          pushRecentConfig(transaction.recentConfigKey!, transaction.repoId);
        }

        let result: PublishResult;
        {
          const completedRuntime = await startPublishRuntime({
            runtimeToken: prepared.runtimeToken,
          });
          runtimeAccepted = true;
          setRuntimeResult(completedRuntime);
          if (completedRuntime.attempt.status === "running") {
            // Submitted 等外部事实仍是非终态；等待 synchronize/resume 继续归约，
            // 不从命令级结果伪造 finishedAt、失败历史或终态事件。
            activeRun.attemptId = completedRuntime.attempt.attemptId;
            runtimeRemainsPending = true;
            return;
          }
          const providerResult = completedRuntime.publishResult;
          if (!providerResult) {
            if (completedRuntime.attempt.status !== "cancelled") {
              throw new Error(
                completedRuntime.attempt.error ||
                  "PublishRuntime completed without a provider result"
              );
            }
            result = {
              provider_id: spec.provider_id,
              success: false,
              cancelled: true,
              error: completedRuntime.attempt.error,
              command: prepared.command,
              output_log: "",
              output_dir: "",
              file_count: 0,
              warnings: completedRuntime.attempt.warnings,
            };
          } else {
            result =
              completedRuntime.attempt.status === "published"
                ? providerResult
                : {
                    ...providerResult,
                    success: false,
                    cancelled:
                      completedRuntime.attempt.status === "cancelled" ||
                      providerResult.cancelled,
                    error:
                      completedRuntime.attempt.error ||
                      providerResult.error ||
                      "PublishRuntime failed",
                  };
          }
        }
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
          repoId: transaction.repoId,
          configurationId: transaction.configurationId,
          configurationRevisionId: transaction.configurationRevisionId,
          startedAt: transaction.startedAt,
          finishedAt: new Date().toISOString(),
          result: resolvedResult,
          outputLog: outputLogSnapshot,
        });
        record.snapshotPath = await exportExecutionSnapshot(
          record,
          outputLogSnapshot
        );
        if (isCurrentPresentationRevision(runRevision)) {
          setCurrentPublishRecordId(record.id);
        }

        if (resolvedResult.success) {
          emit<PublishCompletedEvent>("publish:completed", {
            repoId: transaction.repoId,
            outputDir: resolvedResult.output_dir,
            outputLog: outputLogSnapshot,
            shouldOpenOutputDir: transaction.openOutputDirOnSuccess,
            feedbackMode: transaction.feedbackMode,
            trayStatusEffect: transaction.trayStatusEffect,
            restoreWindowOnFailure: transaction.restoreWindowOnFailure,
            record,
          });
        } else if (resolvedResult.cancelled) {
          emit<PublishCancelledEvent>("publish:cancelled", {
            repoId: transaction.repoId,
            error: resolvedResult.error || "",
            outputLog: outputLogSnapshot,
            feedbackMode: transaction.feedbackMode,
            trayStatusEffect: transaction.trayStatusEffect,
            restoreWindowOnFailure: transaction.restoreWindowOnFailure,
            record,
          });
        } else {
          emit<PublishFailedEvent>("publish:failed", {
            repoId: transaction.repoId,
            error: resolvedResult.error || "",
            outputLog: outputLogSnapshot,
            feedbackTitle: publishT.failed || "发布失败",
            feedbackDescription:
              resolvedResult.error || appT.unknownError || "未知错误",
            feedbackMode: transaction.feedbackMode,
            trayStatusEffect: transaction.trayStatusEffect,
            restoreWindowOnFailure: transaction.restoreWindowOnFailure,
            record,
          });
        }
      } catch (err) {
        const [
          {
            analyzePublishExecutionFailure,
            extractInvokeErrorCode,
            extractInvokeErrorDetails,
            extractInvokeErrorMessage,
          },
          { getPublishFailureFeedback },
        ] = await Promise.all([
          loadInvokeErrors(),
          loadPublishFailureFeedback(),
        ]);
        // 不确定 Attempt 的恢复同步：命名配置与草稿修订都用 prepared 携带的
        // 修订身份（草稿场景下 currentConfigurationRevisionId 为空）。
        if (
          prepared &&
          !runtimeAccepted &&
          extractInvokeErrorCode(err) === "publish_runtime_attempt_uncertain" &&
          selectedRepoPath
        ) {
          try {
            const synchronized = await synchronizePublishRuntime({
              repositoryPath: selectedRepoPath,
              configurationRevisionId: prepared.configurationRevisionId,
              attemptId: extractInvokeErrorDetails(err) || undefined,
              events: [],
            });
            if (
              synchronized.result &&
              activeRunRef.current?.revision === runRevision
            ) {
              runtimeAccepted = true;
              setRuntimeResult(synchronized.result);
              if (synchronized.result.attempt.status === "running") {
                activeRun.attemptId = synchronized.result.attempt.attemptId;
                runtimeRemainsPending = true;
              }
              return;
            }
          } catch (recoveryError) {
            toast.error(
              appT.publishRuntimeRecoveryFailed || "恢复发布状态失败",
              {
                description: extractInvokeErrorMessage(recoveryError),
              }
            );
          }
        }
        if (
          prepared &&
          !runtimeAccepted &&
          activeRunRef.current?.revision === runRevision
        ) {
          setActiveRuntime(null);
          setRuntimeResult(null);
        }
        const rawErrorMessage = extractInvokeErrorMessage(err);
        const failureReason = analyzePublishExecutionFailure(err);
        const outputLogSnapshot = await waitForOutputLogSnapshot();

        const failedResult = createFailedPublishTransactionResult({
          spec,
          errorMessage: rawErrorMessage,
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
          repoId: transaction.repoId,
          configurationId: transaction.configurationId,
          configurationRevisionId: transaction.configurationRevisionId,
          startedAt: transaction.startedAt,
          finishedAt: new Date().toISOString(),
          result: failedResult,
          outputLog: outputLogSnapshot,
        });
        record.snapshotPath = await exportExecutionSnapshot(
          record,
          outputLogSnapshot
        );
        if (isCurrentPresentationRevision(runRevision)) {
          setCurrentPublishRecordId(record.id);
        }

        emit<PublishFailedEvent>("publish:failed", {
          repoId: transaction.repoId,
          error: failedResult.error || rawErrorMessage || "",
          outputLog: outputLogSnapshot,
          feedbackTitle: feedback.title,
          feedbackDescription: failedResult.error || feedback.description,
          feedbackMode: transaction.feedbackMode,
          trayStatusEffect: transaction.trayStatusEffect,
          restoreWindowOnFailure: transaction.restoreWindowOnFailure,
          record,
        });
      } finally {
        if (activeRunRef.current?.revision === runRevision) {
          if (!runtimeRemainsPending) {
            activeRunRef.current = null;
          }
          setIsPublishing(false);
          setIsCancellingPublish(false);
        }
      }
    },
    [
      appT,
      isCurrentPresentationRevision,
      publishT,
      pushRecentConfig,
      validate,
      selectedRepoId,
      selectedRepoPath,
      currentConfigurationRevisionId,
      setIsCancellingPublish,
      setIsPublishing,
      setLastPublishSpec,
      setPublishResult,
      setCurrentPublishRecordId,
      replaceCapturedOutputLog,
      startPublishPresentationRun,
      waitForOutputLogSnapshot,
    ]
  );

  const resumePendingPublish = useCallback(async () => {
    const attemptId =
      runtimeResult?.attempt.status === "running"
        ? runtimeResult.attempt.attemptId
        : activeRunRef.current?.attemptId;
    if (!attemptId || usePublishStore.getState().isPublishing) {
      return;
    }
    setIsPublishing(true);
    try {
      const resumed = await resumePublishRuntime({ attemptId });
      setRuntimeResult(resumed);
      if (resumed.attempt.status === "running") {
        activeRunRef.current = {
          revision: presentationRevisionRef.current,
          phase: "running",
          cancelled: false,
          attemptId,
        };
      } else {
        activeRunRef.current = null;
      }
    } catch (error) {
      const { extractInvokeErrorMessage } = await loadInvokeErrors();
      toast.error(appT.publishRuntimeRecoveryFailed || "继续发布失败", {
        description: extractInvokeErrorMessage(error),
      });
    } finally {
      setIsPublishing(false);
    }
  }, [appT.publishRuntimeRecoveryFailed, runtimeResult, setIsPublishing]);

  const startPublish = useCallback(async () => {
    if (runtimeResult?.attempt.status === "running") {
      await resumePendingPublish();
      return;
    }
    if (currentConfigurationBlockedReason) {
      toast.error(publishT.configurationBlocked || "当前发布配置不可执行", {
        description: currentConfigurationBlockedReason,
      });
      return;
    }

    const blocker = validate.getPublishStartBlocker();

    if (blocker === "missing-repository") {
      toast.error(appT.selectRepositoryFirst || "请先选择仓库");
      return;
    }

    if (blocker === "missing-project") {
      toast.error(appT.selectDotnetProjectFirst || "请先选择 .NET 项目");
      return;
    }

    if (blocker === "runtime-not-ready") {
      toast.error(
        appT.publishRuntimeNotReady || "发布计划尚未准备完成",
        validate.runtimePreparationError
          ? { description: validate.runtimePreparationError }
          : undefined
      );
      return;
    }

    if (blocker === "runtime-blocked") {
      toast.error(publishT.configurationBlocked || "当前发布配置不可执行", {
        description:
          validate.preparedRuntime?.blockedReason ||
          appT.publishRuntimeBlocked ||
          "本地发布计划存在阻塞项",
      });
      return;
    }

    const request = await validate.resolvePublishRequest();
    if (!request) {
      return;
    }

    await runPublishSpec(
      request.spec,
      {
        repoId: selectedRepoId,
        recentConfigKey: request.recentConfigKey,
        configurationId: currentConfigurationId,
        configurationRevisionId: currentConfigurationRevisionId,
      },
      request.preparedRuntime
    );
  }, [
    appT,
    currentConfigurationBlockedReason,
    currentConfigurationId,
    currentConfigurationRevisionId,
    publishT.configurationBlocked,
    resumePendingPublish,
    runPublishSpec,
    runtimeResult,
    selectedRepoId,
    validate,
  ]);

  const cancelPublish = useCallback(async () => {
    const { isPublishing, isCancellingPublish } = usePublishStore.getState();
    const activeRun = activeRunRef.current;
    const attemptId =
      runtimeResult?.attempt.status === "running"
        ? runtimeResult.attempt.attemptId
        : activeRun?.attemptId;
    if ((!isPublishing && !attemptId) || isCancellingPublish) {
      return;
    }

    setIsCancellingPublish(true);
    if (activeRun?.phase === "preflight") {
      activeRun.cancelled = true;
      resetPublishPresentation();
      setActiveRuntime(null);
      setRuntimeResult(null);
      setIsPublishing(false);
      setIsCancellingPublish(false);
      toast.message(appT.cancellingPublish || "正在取消发布...");
      return;
    }
    try {
      // plan 033：取消只面对 Runtime（attempt 优先，未开始的 run 用 token）。
      const cancelled = attemptId
        ? await cancelPublishRuntime({ attemptId })
        : activeRun?.runtimeToken
          ? await cancelPublishRuntime({ runtimeToken: activeRun.runtimeToken })
          : false;
      if (cancelled) {
        toast.message(appT.cancellingPublish || "正在取消发布...");
        if (attemptId && selectedRepoPath && currentConfigurationRevisionId) {
          const synchronized = await synchronizePublishRuntime({
            repositoryPath: selectedRepoPath,
            configurationRevisionId: currentConfigurationRevisionId,
            attemptId,
            events: [],
          });
          if (synchronized.result) {
            setRuntimeResult(synchronized.result);
            if (synchronized.result.attempt.status !== "running") {
              activeRunRef.current = null;
            }
          }
        }
      } else {
        toast.message(appT.noRunningPublishTask || "当前没有运行中的发布任务");
      }
    } catch (err) {
      const [
        { extractInvokeErrorCode, extractInvokeErrorMessage },
        { getCancelPublishFeedback },
      ] = await Promise.all([loadInvokeErrors(), loadCancelPublishFeedback()]);
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
  }, [
    appT,
    currentConfigurationRevisionId,
    resetPublishPresentation,
    runtimeResult,
    selectedRepoPath,
    setIsCancellingPublish,
    setIsPublishing,
  ]);

  return {
    startPublish,
    cancelPublish,
    runPublishSpec,
    activeRuntime,
    runtimeResult,
  };
}
