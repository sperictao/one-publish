import { useMemo } from "react";

import type { ExecutionHistoryCardProps } from "@/components/publish/ExecutionHistoryCard";
import type { ExecutionRecord } from "@/lib/store";
import type {
  DailyTriagePreset,
  HistoryFilterPreset,
  HistoryFilterStatus,
  HistoryFilterWindow,
} from "@/lib/historyFilterPresets";
import type { HandoffSnippetFormat } from "@/lib/handoffSnippet";

interface TranslationMap {
  [key: string]: string | undefined;
}

interface UseExecutionHistoryCardPropsParams {
  scopedExecutionHistory: ExecutionRecord[];
  filteredExecutionHistory: ExecutionRecord[];
  executionHistoryLimit: number;
  historyProviderOptions: string[];
  historyFilterProvider: string;
  historyFilterStatus: HistoryFilterStatus;
  historyFilterWindow: HistoryFilterWindow;
  historyFilterKeyword: string;
  selectedHistoryPresetId: string;
  historyFilterPresets: HistoryFilterPreset[];
  dailyTriagePreset: DailyTriagePreset;
  dailyTriageRecords: ExecutionRecord[];
  isExportingHistory: boolean;
  isExportingDiagnosticsIndex: boolean;
  isPublishing: boolean;
  appT: TranslationMap;
  historyT: TranslationMap;
  failureT: TranslationMap;
  setHistoryFilterProvider: (value: string) => void;
  setHistoryFilterStatus: (value: HistoryFilterStatus) => void;
  setHistoryFilterWindow: (value: HistoryFilterWindow) => void;
  setHistoryFilterKeyword: (value: string) => void;
  applyHistoryPresetToFilters: (value: string) => void;
  saveCurrentHistoryPreset: () => void;
  deleteSelectedHistoryPreset: () => void;
  setDailyTriagePreset: (updater: (prev: DailyTriagePreset) => DailyTriagePreset) => void;
  resetDailyTriagePreset: () => void;
  exportExecutionHistory: () => Promise<void>;
  exportDailyTriageReport: () => void;
  exportDiagnosticsIndex: () => void;
  clearHistoryFilters: () => void;
  openSnapshotFromRecord: (record: ExecutionRecord) => Promise<void>;
  rerunFromHistory: (record: ExecutionRecord) => Promise<void>;
  copyHandoffSnippet: (record: ExecutionRecord, format: HandoffSnippetFormat) => Promise<void>;
}

export function useExecutionHistoryCardProps(
  params: UseExecutionHistoryCardPropsParams
): ExecutionHistoryCardProps {
  return useMemo(
    () => ({
      scopedExecutionHistory: params.scopedExecutionHistory,
      filteredExecutionHistory: params.filteredExecutionHistory,
      executionHistoryLimit: params.executionHistoryLimit,
      historyProviderOptions: params.historyProviderOptions,
      historyFilterProvider: params.historyFilterProvider,
      historyFilterStatus: params.historyFilterStatus,
      historyFilterWindow: params.historyFilterWindow,
      historyFilterKeyword: params.historyFilterKeyword,
      selectedHistoryPresetId: params.selectedHistoryPresetId,
      historyFilterPresets: params.historyFilterPresets,
      dailyTriagePreset: params.dailyTriagePreset,
      dailyTriageRecords: params.dailyTriageRecords,
      isExportingHistory: params.isExportingHistory,
      isExportingDiagnosticsIndex: params.isExportingDiagnosticsIndex,
      isPublishing: params.isPublishing,
      appT: params.appT,
      historyT: params.historyT,
      failureT: params.failureT,
      onHistoryFilterProviderChange: params.setHistoryFilterProvider,
      onHistoryFilterStatusChange: params.setHistoryFilterStatus,
      onHistoryFilterWindowChange: params.setHistoryFilterWindow,
      onHistoryFilterKeywordChange: params.setHistoryFilterKeyword,
      onApplyHistoryPreset: params.applyHistoryPresetToFilters,
      onSaveCurrentHistoryPreset: params.saveCurrentHistoryPreset,
      onDeleteSelectedHistoryPreset: params.deleteSelectedHistoryPreset,
      onDailyTriagePresetChange: params.setDailyTriagePreset,
      onResetDailyTriagePreset: params.resetDailyTriagePreset,
      onExportExecutionHistory: params.exportExecutionHistory,
      onExportDailyTriageReport: params.exportDailyTriageReport,
      onExportDiagnosticsIndex: params.exportDiagnosticsIndex,
      onClearFilters: params.clearHistoryFilters,
      onOpenSnapshotFromRecord: params.openSnapshotFromRecord,
      onRerunFromHistory: params.rerunFromHistory,
      onCopyHandoffSnippet: params.copyHandoffSnippet,
    }),
    [params]
  );
}
