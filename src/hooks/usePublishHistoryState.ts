import { useCallback, useEffect, useState } from "react";

import { getExecutionHistory, addExecutionRecord, type ExecutionRecord } from "@/lib/store";
import {
  loadRerunChecklistPreference,
  saveRerunChecklistPreference,
} from "@/lib/rerunChecklistPreference";

export function usePublishHistoryState(params: {
  executionHistoryLimit: number;
}) {
  const [isRerunChecklistEnabled, setIsRerunChecklistEnabled] = useState(
    () => loadRerunChecklistPreference().enabled
  );
  const [executionHistory, setExecutionHistory] = useState<ExecutionRecord[]>([]);

  const savePublishRecord = useCallback((record: ExecutionRecord) => {
    addExecutionRecord(record)
      .then((history) => {
        setExecutionHistory(history);
      })
      .catch((err) => {
        console.error("保存执行历史失败:", err);
      });
  }, []);

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
    savePublishRecord,
  };
}
