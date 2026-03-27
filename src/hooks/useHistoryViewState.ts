import { useMemo } from "react";

import type {
  HistoryFilterStatus,
  HistoryFilterWindow,
} from "@/lib/historyFilterPresets";
import { filterExecutionHistory } from "@/features/history/utils/historyFilters";
import { type ExecutionRecord } from "@/lib/store";

export function useHistoryViewState(params: {
  scopedExecutionHistory: ExecutionRecord[];
  historyFilterProvider: string;
  historyFilterStatus: HistoryFilterStatus;
  historyFilterWindow: HistoryFilterWindow;
  historyFilterKeyword: string;
  setHistoryFilterProvider: (value: string) => void;
  setHistoryFilterStatus: (value: HistoryFilterStatus) => void;
  setHistoryFilterWindow: (value: HistoryFilterWindow) => void;
  setHistoryFilterKeyword: (value: string) => void;
}) {
  const filteredExecutionHistory = useMemo(
    () =>
      filterExecutionHistory(params.scopedExecutionHistory, {
        provider: params.historyFilterProvider,
        status: params.historyFilterStatus,
        window: params.historyFilterWindow,
        keyword: params.historyFilterKeyword,
      }),
    [
      params.scopedExecutionHistory,
      params.historyFilterKeyword,
      params.historyFilterProvider,
      params.historyFilterStatus,
      params.historyFilterWindow,
    ]
  );

  const clearHistoryFilters = () => {
    params.setHistoryFilterProvider("all");
    params.setHistoryFilterStatus("all");
    params.setHistoryFilterWindow("all");
    params.setHistoryFilterKeyword("");
  };

  return {
    filteredExecutionHistory,
    clearHistoryFilters,
  };
}
