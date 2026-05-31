import { useMemo, useState } from "react";

import { groupExecutionFailures } from "@/features/history/failureGroups";
import {
  type HistoryFilterStatus,
  type HistoryFilterWindow,
} from "@/features/history/historyFilterPresets";
import { type ExecutionRecord } from "@/lib/store/types";
import type { Repository } from "@/lib/store/types";
import { isRecordInRepository } from "@/features/history/utils/historyFilters";
import { useHistoryViewState } from "@/features/history/useHistoryViewState";

export function useHistoryDiagnosticsState(params: {
  executionHistory: ExecutionRecord[];
  selectedRepo: Repository | null;
}) {
  const [historyFilterProvider, setHistoryFilterProvider] = useState("all");
  const [historyFilterStatus, setHistoryFilterStatus] =
    useState<HistoryFilterStatus>("all");
  const [historyFilterWindow, setHistoryFilterWindow] =
    useState<HistoryFilterWindow>("all");
  const [historyFilterKeyword, setHistoryFilterKeyword] = useState("");

  const scopedExecutionHistory = useMemo(() => {
    if (!params.selectedRepo) {
      return [];
    }

    const selectedRepo = params.selectedRepo;

    return params.executionHistory.filter((record) =>
      isRecordInRepository(record, selectedRepo)
    );
  }, [params.executionHistory, params.selectedRepo]);

  const historyProviderOptions = useMemo(
    () =>
      Array.from(
        new Set(scopedExecutionHistory.map((record) => record.providerId))
      ).sort(),
    [scopedExecutionHistory]
  );

  const historyViewState = useHistoryViewState({
    scopedExecutionHistory,
    historyFilterProvider,
    historyFilterStatus,
    historyFilterWindow,
    historyFilterKeyword,
    setHistoryFilterProvider,
    setHistoryFilterStatus,
    setHistoryFilterWindow,
    setHistoryFilterKeyword,
  });

  const snapshotPaths = useMemo(
    () =>
      Array.from(
        new Set(
          scopedExecutionHistory
            .map((record) => record.snapshotPath?.trim())
            .filter((value): value is string => Boolean(value))
        )
      ),
    [scopedExecutionHistory]
  );

  const failureGroupCount = useMemo(
    () => groupExecutionFailures(historyViewState.filteredExecutionHistory).length,
    [historyViewState.filteredExecutionHistory]
  );

  return {
    historyFilterProvider,
    setHistoryFilterProvider,
    historyFilterStatus,
    setHistoryFilterStatus,
    historyFilterWindow,
    setHistoryFilterWindow,
    historyFilterKeyword,
    setHistoryFilterKeyword,
    scopedExecutionHistory,
    historyProviderOptions,
    snapshotPaths,
    failureGroupCount,
    ...historyViewState,
  };
}
