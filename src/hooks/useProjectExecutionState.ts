import { useCallback, useEffect, useState } from "react";

import type { ProviderPublishSpec, PublishResult } from "@/hooks/usePublishExecution";
import { deriveFailureSignature } from "@/lib/failureSignature";
import { getExecutionHistory, addExecutionRecord, type ExecutionRecord } from "@/lib/store";
import {
  loadRerunChecklistPreference,
  saveRerunChecklistPreference,
} from "@/lib/rerunChecklistPreference";

export function useProjectExecutionState(params: {
  executionHistoryLimit: number;
  selectedPreset: string;
  setSelectedPreset: (value: string) => void;
  setIsCustomMode: (value: boolean) => void;
  setActiveProfileName: (value: string | null) => void;
  handleSelectProjectProfile: (profileName: string) => void;
}) {
  const [isRerunChecklistEnabled, setIsRerunChecklistEnabled] = useState(
    () => loadRerunChecklistPreference().enabled
  );
  const [executionHistory, setExecutionHistory] = useState<ExecutionRecord[]>([]);

  const persistExecutionRecord = useCallback((record: ExecutionRecord) => {
    addExecutionRecord(record)
      .then((history) => {
        setExecutionHistory(history);
      })
      .catch((err) => {
        console.error("保存执行历史失败:", err);
      });
  }, []);

  const buildExecutionRecord = useCallback(
    (params: {
      spec: ProviderPublishSpec;
      repoId: string | null;
      startedAt: string;
      finishedAt: string;
      result: PublishResult;
      output: string;
    }): ExecutionRecord => {
      const commandLine =
        params.output.split("\n").find((line) => line.startsWith("$ ")) || null;
      const failureSignature =
        !params.result.success && !params.result.cancelled
          ? deriveFailureSignature({
              error: params.result.error,
              output: params.output,
            })
          : null;

      return {
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        repoId: params.repoId,
        providerId: params.spec.provider_id,
        projectPath: params.spec.project_path,
        startedAt: params.startedAt,
        finishedAt: params.finishedAt,
        success: params.result.success,
        cancelled: params.result.cancelled,
        outputDir: params.result.output_dir || null,
        error: params.result.error,
        commandLine,
        snapshotPath: null,
        failureSignature,
        spec: params.spec,
        fileCount: params.result.file_count,
      };
    },
    []
  );

  const handleSelectPresetValueChange = useCallback(
    (presetValue: string) => {
      if (presetValue.startsWith("profile-")) {
        params.handleSelectProjectProfile(presetValue.slice("profile-".length));
        return;
      }

      params.setSelectedPreset(presetValue);
      params.setIsCustomMode(false);
      params.setActiveProfileName(null);
    },
    [params]
  );

  useEffect(() => {
    getExecutionHistory()
      .then((history) => {
        setExecutionHistory(history);
      })
      .catch((err) => {
        console.error("加载执行历史失败:", err);
      });
  }, []);

  useEffect(() => {
    saveRerunChecklistPreference({ enabled: isRerunChecklistEnabled });
  }, [isRerunChecklistEnabled]);

  useEffect(() => {
    setExecutionHistory((prev) => prev.slice(0, params.executionHistoryLimit));
  }, [params.executionHistoryLimit]);

  return {
    isRerunChecklistEnabled,
    setIsRerunChecklistEnabled,
    executionHistory,
    setExecutionHistory,
    persistExecutionRecord,
    buildExecutionRecord,
    handleSelectPresetValueChange,
  };
}
