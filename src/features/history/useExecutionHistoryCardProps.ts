import { useMemo } from "react";

import type { ExecutionHistoryCardProps } from "@/components/publish/ExecutionHistoryCard";
import type { ExecutionRecord } from "@/lib/store/types";
import type {
  HistoryFilterStatus,
  HistoryFilterWindow,
} from "@/features/history/historyFilterPresets";
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
  isExportingHistory: boolean;
  isPublishing: boolean;
  appT: TranslationMap;
  historyT: TranslationMap;
  failureT: TranslationMap;
  setHistoryFilterProvider: (value: string) => void;
  setHistoryFilterStatus: (value: HistoryFilterStatus) => void;
  setHistoryFilterWindow: (value: HistoryFilterWindow) => void;
  setHistoryFilterKeyword: (value: string) => void;
  exportExecutionHistory: () => Promise<void>;
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
      isExportingHistory: params.isExportingHistory,
      isPublishing: params.isPublishing,
      appT: params.appT,
      historyT: params.historyT,
      failureT: params.failureT,
      onHistoryFilterProviderChange: params.setHistoryFilterProvider,
      onHistoryFilterStatusChange: params.setHistoryFilterStatus,
      onHistoryFilterWindowChange: params.setHistoryFilterWindow,
      onHistoryFilterKeywordChange: params.setHistoryFilterKeyword,
      onExportExecutionHistory: params.exportExecutionHistory,
      onClearFilters: params.clearHistoryFilters,
      onOpenSnapshotFromRecord: params.openSnapshotFromRecord,
      onRerunFromHistory: params.rerunFromHistory,
      onCopyHandoffSnippet: params.copyHandoffSnippet,
    }),
    [params]
  );
}
