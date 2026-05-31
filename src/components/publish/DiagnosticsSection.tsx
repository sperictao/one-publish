import { ExecutionHistoryCard } from "@/components/publish/ExecutionHistoryCard";
import { useDiagnosticsExports } from "@/hooks/useDiagnosticsExports";
import { useExecutionHistoryCardProps } from "@/features/history/useExecutionHistoryCardProps";
import { useHistoryActions } from "@/features/history/useHistoryActions";
import { useHistoryDiagnosticsState } from "@/features/history/useHistoryDiagnosticsState";
import type { ProviderPublishSpec } from "@/features/publish/publishRuntime";
import type { ExecutionRecord } from "@/lib/store/types";
import type { Repository } from "@/lib/store/types";

type TranslationMap = Record<string, string | undefined>;

export interface DiagnosticsSectionProps {
  rightPanelView: "home" | "history";
  appT: TranslationMap;
  historyT: TranslationMap;
  failureT: TranslationMap;
  executionHistory: ExecutionRecord[];
  executionHistoryLimit: number;
  selectedRepo: Repository;
  isPublishing: boolean;
  recentHistoryExports: string[];
  trackHistoryExport: (outputPath: string) => void;
  extractSpecFromRecord: (record: ExecutionRecord) => ProviderPublishSpec | null;
  rerunFromHistory: (record: ExecutionRecord) => Promise<void>;
}

export function DiagnosticsSection({
  rightPanelView,
  appT,
  historyT,
  failureT,
  executionHistory,
  executionHistoryLimit,
  selectedRepo,
  isPublishing,
  recentHistoryExports,
  trackHistoryExport,
  extractSpecFromRecord,
  rerunFromHistory,
}: DiagnosticsSectionProps) {
  const {
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
    filteredExecutionHistory,
    clearHistoryFilters,
    snapshotPaths,
    failureGroupCount,
  } = useHistoryDiagnosticsState({
    executionHistory,
    selectedRepo,
  });

  const {
    copyHandoffSnippet,
    openSnapshotFromRecord,
  } = useHistoryActions({
    appT,
    historyT,
    extractSpecFromRecord,
  });

  const {
    isExportingHistory,
    exportExecutionHistory,
  } = useDiagnosticsExports({
    historyT,
    snapshotPaths,
    recentHistoryExports,
    scopedExecutionHistory,
    filteredExecutionHistory,
    failureGroupCount,
    selectedRepoPath: selectedRepo.path,
    trackHistoryExport,
  });

  const executionHistoryCardProps = useExecutionHistoryCardProps({
    scopedExecutionHistory,
    filteredExecutionHistory,
    executionHistoryLimit,
    historyProviderOptions,
    historyFilterProvider,
    historyFilterStatus,
    historyFilterWindow,
    historyFilterKeyword,
    isExportingHistory,
    isPublishing,
    appT,
    historyT,
    failureT,
    setHistoryFilterProvider,
    setHistoryFilterStatus,
    setHistoryFilterWindow,
    setHistoryFilterKeyword,
    exportExecutionHistory,
    clearHistoryFilters,
    openSnapshotFromRecord,
    rerunFromHistory,
    copyHandoffSnippet,
  });
  const hasExecutionHistory =
    executionHistoryCardProps.scopedExecutionHistory.length > 0;

  if (rightPanelView !== "history" || !hasExecutionHistory) {
    return null;
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <ExecutionHistoryCard {...executionHistoryCardProps} />
    </div>
  );
}
