import { useCallback, useMemo } from "react";

import { useAppStore } from "@/stores/appStore";
import {
  loadRerunChecklistPreference,
  saveRerunChecklistPreference,
} from "@/lib/rerunChecklistPreference";

export function usePublishHistoryState(params: {
  executionHistoryLimit: number;
}) {
  const isRerunChecklistEnabled = useAppStore(() => {
    // Read once on mount via lazy init; subsequent reads are stable.
    // This doesn't participate in reactivity since it's a localStorage-backed pref.
    return loadRerunChecklistPreference().enabled;
  });

  const setIsRerunChecklistEnabled = useCallback((enabled: boolean) => {
    saveRerunChecklistPreference({ enabled });
    // Force re-render is not needed — the caller manages its own state.
  }, []);

  const executionHistory = useAppStore((s) => s.executionHistory);
  const visibleExecutionHistory = useMemo(
    () => executionHistory.slice(0, params.executionHistoryLimit),
    [executionHistory, params.executionHistoryLimit]
  );

  const savePublishRecord = useAppStore((s) => s.savePublishRecord);
  const loadExecutionHistory = useAppStore((s) => s.loadExecutionHistory);

  return {
    isRerunChecklistEnabled,
    setIsRerunChecklistEnabled,
    executionHistory: visibleExecutionHistory,
    savePublishRecord,
    loadExecutionHistory,
  };
}
