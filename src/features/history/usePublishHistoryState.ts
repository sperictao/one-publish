import { useEffect, useMemo, useRef } from "react";

import { useAppStore } from "@/stores/appStore";

export function usePublishHistoryState(params: {
  executionHistoryLimit: number;
  isStateLoading: boolean;
}) {
  const executionHistory = useAppStore((s) => s.executionHistory);
  const visibleExecutionHistory = useMemo(
    () => executionHistory.slice(0, params.executionHistoryLimit),
    [executionHistory, params.executionHistoryLimit]
  );

  const savePublishRecord = useAppStore((s) => s.savePublishRecord);
  const loadExecutionHistory = useAppStore((s) => s.loadExecutionHistory);
  const hasLoadedExecutionHistoryRef = useRef(false);

  useEffect(() => {
    if (params.isStateLoading || hasLoadedExecutionHistoryRef.current) {
      return;
    }

    hasLoadedExecutionHistoryRef.current = true;
    void loadExecutionHistory();
  }, [loadExecutionHistory, params.isStateLoading]);

  return {
    executionHistory: visibleExecutionHistory,
    savePublishRecord,
    loadExecutionHistory,
  };
}
