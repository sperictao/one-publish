import { useMemo } from "react";

import {
  DEFAULT_DAILY_TRIAGE_PRESET,
  type HistoryFilterStatus,
  type HistoryFilterWindow,
} from "@/lib/historyFilterPresets";
import { filterExecutionHistory } from "@/features/history/utils/historyFilters";
import { type ExecutionRecord } from "@/lib/store";
import { useHistoryPresets } from "@/hooks/useHistoryPresets";

interface TranslationMap {
  [key: string]: string | undefined;
}

export function useHistoryViewState(params: {
  historyT: TranslationMap;
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
  const {
    historyFilterPresets,
    dailyTriagePreset,
    setDailyTriagePreset,
    selectedHistoryPresetId,
    setSelectedHistoryPresetId,
    applyHistoryPreset,
    saveCurrentHistoryPreset,
    deleteSelectedHistoryPreset,
  } = useHistoryPresets({
    historyT: params.historyT,
    historyFilterProvider: params.historyFilterProvider,
    historyFilterStatus: params.historyFilterStatus,
    historyFilterWindow: params.historyFilterWindow,
    historyFilterKeyword: params.historyFilterKeyword,
  });

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

  const dailyTriageRecords = useMemo(
    () =>
      filterExecutionHistory(params.scopedExecutionHistory, {
        provider: dailyTriagePreset.provider,
        status: dailyTriagePreset.status,
        window: dailyTriagePreset.window,
        keyword: dailyTriagePreset.keyword,
      }),
    [params.scopedExecutionHistory, dailyTriagePreset]
  );

  const applyHistoryPresetToFilters = (presetId: string) =>
    applyHistoryPreset(presetId, {
      setHistoryFilterProvider: params.setHistoryFilterProvider,
      setHistoryFilterStatus: params.setHistoryFilterStatus,
      setHistoryFilterWindow: params.setHistoryFilterWindow,
      setHistoryFilterKeyword: params.setHistoryFilterKeyword,
    });

  const resetDailyTriagePreset = () => {
    setDailyTriagePreset(DEFAULT_DAILY_TRIAGE_PRESET);
  };

  const clearHistoryFilters = () => {
    params.setHistoryFilterProvider("all");
    params.setHistoryFilterStatus("all");
    params.setHistoryFilterWindow("all");
    params.setHistoryFilterKeyword("");
    setSelectedHistoryPresetId("none");
  };

  return {
    historyFilterPresets,
    dailyTriagePreset,
    setDailyTriagePreset,
    selectedHistoryPresetId,
    setSelectedHistoryPresetId,
    saveCurrentHistoryPreset,
    deleteSelectedHistoryPreset,
    filteredExecutionHistory,
    dailyTriageRecords,
    applyHistoryPresetToFilters,
    resetDailyTriagePreset,
    clearHistoryFilters,
  };
}
