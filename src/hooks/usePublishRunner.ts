import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

import type {
  PublishResult as TauriPublishResult,
  PublishSpec as TauriPublishSpec,
} from "@/generated/tauri-contracts";
import type { TranslationMap } from "@/hooks/usePublishRunnerTypes";
import {
  createEnvironmentCheckSnapshot,
  runEnvironmentCheck,
  type EnvironmentCheckSnapshot,
} from "@/lib/environment";
import {
  openOutputDirectory,
  setTrayPublishStatus,
  showMainWindow,
  type ExecutionRecord,
} from "@/lib/store";
import {
  buildPublishOutputValidationDescription,
  buildPublishOutputValidationTitle,
  buildProtectedOutputAccessDescription,
  preflightPublishOutput,
  type PublishOutputPreflightResult,
} from "@/lib/publishOutputPreflight";
import { showSystemNotification } from "@/lib/systemNotification";
import { useDotnetPublishSelection } from "@/hooks/useDotnetPublishSelection";
import { usePublishLogStream } from "@/hooks/usePublishLogStream";
import { usePublishSpecBuilder } from "@/hooks/usePublishSpecBuilder";
import { usePublishUiState } from "@/hooks/usePublishUiState";
import { createPublishExecutionRecord } from "@/lib/publishExecutionRecord";
import { normalizePublishResult } from "@/lib/publishFailure";
import { renderPublishCommand } from "@/lib/renderPublishCommand";
import type { PublishConfigStore } from "@/lib/store";
import type { ProjectInfo } from "@/types/project";
import type { ParameterValue } from "@/types/parameters";

const loadInvokeErrors = () => import("@/lib/tauri/invokeErrors");
const loadPublishFailureFeedback = () =>
  import("@/hooks/usePublishFailureFeedback");
const loadCancelPublishFeedback = () =>
  import("@/hooks/useCancelPublishFeedback");

export type PublishResult = TauriPublishResult;
export type ProviderPublishSpec = TauriPublishSpec;

export interface RunPublishOptions {
  repoId?: string | null;
  recentConfigKey?: string | null;
  openOutputDirOnSuccess?: boolean;
  restoreWindowOnFailure?: boolean;
  feedbackMode?: "toast" | "system";
  trayStatusEffect?: boolean;
}

interface DotnetPreset {
  id: string;
  name: string;
  description: string;
  config: {
    configuration: string;
    runtime: string;
    self_contained: boolean;
  };
}

interface UsePublishRunnerParams {
  appT: TranslationMap;
  publishT: TranslationMap;
  selectedRepoId: string | null;
  selectedRepo: { path: string } | null;
  activeProviderId: string;
  activeProviderUsesProjectFile: boolean;
  activeProviderParameters: Record<string, ParameterValue>;
  selectedPreset: string;
  isCustomMode: boolean;
  activeProfileName: string | null;
  customConfig: PublishConfigStore;
  defaultOutputDir?: string;
  projectInfo: ProjectInfo | null;
  presets: DotnetPreset[];
  specVersion: number;
  pushRecentConfig: (key: string, repoId?: string | null) => void;
  openEnvironmentDialog: (
    initialCheck?: EnvironmentCheckSnapshot | null,
    providerIds?: string[]
  ) => void;
  setEnvironmentLastCheck: (snapshot: EnvironmentCheckSnapshot | null) => void;
  savePublishRecord: (record: ExecutionRecord) => void;
}

interface PublishPreparationOptions {
  feedbackMode: "toast" | "system";
  restoreWindowOnFailure: boolean;
  trayStatusEffect: boolean;
}

interface AbortPublishPreparationOptions extends PublishPreparationOptions {
  runRevision: number;
  level: "error" | "warning";
  title: string;
  description: string;
  onAfterNotify?: (notified: boolean) => void;
}

function buildPublishPresentationScopeKey(params: {
  selectedRepoId: string | null;
  selectedRepoPath: string | null;
  activeProviderId: string;
  selectionKey: string;
  projectFile: string | null;
  specVersion: number;
}) {
  return JSON.stringify({
    selectedRepoId: params.selectedRepoId ?? params.selectedRepoPath,
    activeProviderId: params.activeProviderId,
    selectionKey: params.selectionKey,
    projectFile: params.projectFile,
    specVersion: params.specVersion,
  });
}

export function usePublishRunner({
  appT,
  publishT,
  selectedRepoId,
  selectedRepo,
  activeProviderId,
  activeProviderUsesProjectFile,
  activeProviderParameters,
  selectedPreset,
  isCustomMode,
  activeProfileName,
  customConfig,
  defaultOutputDir,
  projectInfo,
  presets,
  specVersion,
  pushRecentConfig,
  openEnvironmentDialog,
  setEnvironmentLastCheck,
  savePublishRecord,
}: UsePublishRunnerParams) {
  const {
    isPublishing,
    setIsPublishing,
    isCancellingPublish,
    setIsCancellingPublish,
    publishResult,
    setPublishResult,
    lastPublishSpec,
    setLastPublishSpec,
    currentPublishRecordId,
    setCurrentPublishRecordId,
    releaseChecklistOpen,
    setReleaseChecklistOpen,
    artifactActionState,
    setArtifactActionState,
  } = usePublishUiState();
  const {
    outputLog,
    getOutputLogSnapshot,
    beginLogCapture,
    hideLogCapture,
    resetLogCapture,
    replaceCapturedOutputLog,
  } = usePublishLogStream();
  const presentationRevisionRef = useRef(0);
  const [publishPreviewCommand, setPublishPreviewCommand] = useState("");

  const {
    getCurrentConfig,
    recentConfigKeyForCurrentSelection,
    resolvedProjectProfile,
    resolveSelectedProjectProfile,
    isResolvingSelectedProjectProfile,
  } = useDotnetPublishSelection({
    activeProviderId,
    selectedPreset,
    isCustomMode,
    activeProfileName,
    customConfig,
    defaultOutputDir,
    projectInfo,
    presets,
  });

  const { buildPublishSpec } = usePublishSpecBuilder({
    activeProviderId,
    activeProviderUsesProjectFile,
    activeProviderParameters,
    projectInfo,
    selectedRepo,
    specVersion,
    getCurrentConfig,
  });

  const publishPresentationSelectionKey = useMemo(() => {
    if (activeProviderId !== "dotnet") {
      return `provider:${activeProviderId}`;
    }

    if (recentConfigKeyForCurrentSelection) {
      return recentConfigKeyForCurrentSelection;
    }

    if (isCustomMode) {
      return activeProfileName ? `userprofile:${activeProfileName}` : "custom";
    }

    return `preset:${selectedPreset}`;
  }, [
    activeProfileName,
    activeProviderId,
    isCustomMode,
    recentConfigKeyForCurrentSelection,
    selectedPreset,
  ]);

  const buildCurrentPublishSpec = useCallback((): ProviderPublishSpec | null => {
    if (!selectedRepo) {
      return null;
    }

    if (activeProviderUsesProjectFile && !projectInfo) {
      return null;
    }

    if (activeProviderId === "dotnet") {
      const resolvedProjectInfo = projectInfo;
      if (!resolvedProjectInfo) {
        return null;
      }
      if (!isCustomMode && selectedPreset.startsWith("profile-")) {
        if (resolvedProjectProfile) {
          return {
            version: specVersion,
            provider_id: "dotnet",
            project_path: resolvedProjectInfo.project_file,
            parameters: resolvedProjectProfile.parameters,
          };
        }
      }
    }

    return buildPublishSpec();
  }, [
    activeProviderId,
    activeProviderUsesProjectFile,
    buildPublishSpec,
    isCustomMode,
    projectInfo,
    resolvedProjectProfile,
    selectedPreset,
    selectedRepo,
    specVersion,
  ]);

  useEffect(() => {
    let disposed = false;
    const spec = buildCurrentPublishSpec();

    if (!spec) {
      setPublishPreviewCommand("");
      return () => {
        disposed = true;
      };
    }

    void renderPublishCommand(spec)
      .then((command) => {
        if (!disposed) {
          setPublishPreviewCommand(command.display_command);
        }
      })
      .catch(() => {
        if (!disposed) {
          setPublishPreviewCommand("");
        }
      });

    return () => {
      disposed = true;
    };
  }, [buildCurrentPublishSpec]);

  const waitForOutputLogSnapshot = useCallback(async (): Promise<string> => {
    await new Promise<void>((resolve) => {
      if (typeof window === "undefined" || typeof window.setTimeout !== "function") {
        resolve();
        return;
      }

      window.setTimeout(resolve, 0);
    });

    return getOutputLogSnapshot();
  }, [getOutputLogSnapshot]);

  const restoreMainWindowIfNeeded = useCallback(async (shouldRestore: boolean) => {
    if (!shouldRestore) {
      return;
    }

    try {
      await showMainWindow();
    } catch {
      // noop
    }
  }, []);

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
        if (notified) {
          return true;
        }
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
      if (!shouldOpen || !outputDir.trim()) {
        return;
      }

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

  const publishPresentationScopeKey = useMemo(
    () =>
      buildPublishPresentationScopeKey({
        selectedRepoId,
        selectedRepoPath: selectedRepo?.path ?? null,
        activeProviderId,
        selectionKey: publishPresentationSelectionKey,
        projectFile: projectInfo?.project_file ?? null,
        specVersion,
      }),
    [
      activeProviderId,
      projectInfo?.project_file,
      publishPresentationSelectionKey,
      selectedRepo?.path,
      selectedRepoId,
      specVersion,
    ]
  );

  useEffect(() => {
    resetPublishPresentation();
  }, [publishPresentationScopeKey, resetPublishPresentation]);

  const abortPublishPreparation = useCallback(
    async ({
      runRevision,
      feedbackMode,
      restoreWindowOnFailure,
      trayStatusEffect,
      level,
      title,
      description,
      onAfterNotify,
    }: AbortPublishPreparationOptions) => {
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
    },
    [
      isCurrentPresentationRevision,
      notifyFeedback,
      resetLogCapture,
      restoreMainWindowIfNeeded,
      syncTrayPublishStatus,
    ]
  );

  const runPublishPreflight = useCallback(
    async (
      spec: ProviderPublishSpec,
      options: PublishPreparationOptions & { runRevision: number }
    ) => {
      try {
        const env = await runEnvironmentCheck([spec.provider_id]);
        const environmentCheck = createEnvironmentCheckSnapshot(env, [
          spec.provider_id,
        ]);
        setEnvironmentLastCheck(environmentCheck);

        const critical = env.issues.find((item) => item.severity === "critical");
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

        const warning = env.issues.find((item) => item.severity === "warning");
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
    },
    [
      abortPublishPreparation,
      appT,
      notifyFeedback,
      openEnvironmentDialog,
      setEnvironmentLastCheck,
    ]
  );

  const runPublishSpec = useCallback(
    async (spec: ProviderPublishSpec, options?: RunPublishOptions) => {
      const effectiveRepoId = options?.repoId ?? selectedRepoId;
      const recentConfigKey = options?.recentConfigKey;
      const openOutputDirOnSuccess = options?.openOutputDirOnSuccess ?? false;
      const restoreWindowOnFailure = options?.restoreWindowOnFailure ?? false;
      const feedbackMode = options?.feedbackMode ?? "toast";
      const trayStatusEffect = options?.trayStatusEffect ?? false;
      const runRevision = startPublishPresentationRun();

      const preflightPassed = await runPublishPreflight(spec, {
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

        const result = await invoke<PublishResult>("execute_provider_publish", {
          spec,
        });
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

        if (resolvedResult.success) {
          if (trayStatusEffect) {
            await syncTrayPublishStatus("success");
          }
          await openOutputDirectoryIfNeeded(
            openOutputDirOnSuccess,
            resolvedResult.output_dir,
            feedbackMode
          );

          await notifyFeedback(
            "success",
            publishT.success || "发布成功!",
            resolvedResult.output_dir
              ? (publishT.output || "输出目录: {{dir}}").replace(
                  "{{dir}}",
                  resolvedResult.output_dir
                )
              : appT.commandExecuted || "命令执行成功",
            feedbackMode
          );
        } else if (resolvedResult.cancelled) {
          if (trayStatusEffect) {
            await syncTrayPublishStatus("idle");
          }
          const notified = await notifyFeedback(
            "warning",
            appT.publishCancelled || "发布已取消",
            resolvedResult.error || appT.userCancelledTask || "用户取消了执行任务",
            feedbackMode
          );
          await restoreMainWindowIfNeeded(restoreWindowOnFailure || !notified);
        } else {
          if (trayStatusEffect) {
            await syncTrayPublishStatus("failure");
          }
          const notified = await notifyFeedback(
            "error",
            publishT.failed || "发布失败",
            resolvedResult.error || appT.unknownError || "未知错误",
            feedbackMode
          );
          await restoreMainWindowIfNeeded(restoreWindowOnFailure || !notified);
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
        savePublishRecord(record);
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
        if (trayStatusEffect) {
          await syncTrayPublishStatus("failure");
        }
        const notified = await notifyFeedback(
          "error",
          feedback.title,
          failedResult.error || feedback.description,
          feedbackMode
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
        savePublishRecord(record);
        await restoreMainWindowIfNeeded(restoreWindowOnFailure || !notified);
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
      runPublishPreflight,
      savePublishRecord,
      selectedRepoId,
      setIsCancellingPublish,
      setIsPublishing,
      setLastPublishSpec,
      setCurrentPublishRecordId,
      openOutputDirectoryIfNeeded,
      replaceCapturedOutputLog,
      restoreMainWindowIfNeeded,
      startPublishPresentationRun,
      waitForOutputLogSnapshot,
      syncTrayPublishStatus,
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
        resolvedProjectProfile ?? (await resolveSelectedProjectProfile());

      if (projectProfile) {
        await runPublishSpec(
          {
            version: specVersion,
            provider_id: "dotnet",
            project_path: projectInfo.project_file,
            parameters: projectProfile.parameters,
          },
          {
            repoId: selectedRepoId,
            recentConfigKey: recentConfigKeyForCurrentSelection,
          }
        );
        return;
      }
    }

    const spec = buildPublishSpec();
    if (!spec) {
      return;
    }

    await runPublishSpec(spec, {
      repoId: selectedRepoId,
      recentConfigKey: recentConfigKeyForCurrentSelection,
    });
  }, [
    activeProviderId,
    activeProviderUsesProjectFile,
    appT,
    buildPublishSpec,
    isCustomMode,
    projectInfo,
    recentConfigKeyForCurrentSelection,
    resolveSelectedProjectProfile,
    resolvedProjectProfile,
    runPublishSpec,
    selectedRepoId,
    selectedRepo,
    selectedPreset,
    specVersion,
  ]);

  const cancelPublish = useCallback(async () => {
    if (!isPublishing || isCancellingPublish) {
      return;
    }

    setIsCancellingPublish(true);
    try {
      const cancelled = await invoke<boolean>("cancel_provider_publish");
      if (cancelled) {
        toast.message(appT.cancellingPublish || "正在取消发布...");
      } else {
        toast.message(appT.noRunningPublishTask || "当前没有运行中的发布任务");
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
  }, [appT, isCancellingPublish, isPublishing]);

  return {
    isPublishing,
    isCancellingPublish,
    publishResult,
    lastPublishSpec,
    currentPublishRecordId,
    outputLog,
    isResolvingSelectedProjectProfile,
    releaseChecklistOpen,
    setReleaseChecklistOpen,
    artifactActionState,
    setArtifactActionState,
    publishPreviewCommand,
    runPublishSpec,
    startPublish,
    cancelPublish,
  };
}
