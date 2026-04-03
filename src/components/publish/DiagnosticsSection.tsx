import { ExecutionHistoryCard } from "@/components/publish/ExecutionHistoryCard";
import { useDiagnosticsExports } from "@/hooks/useDiagnosticsExports";
import { useExecutionHistoryCardProps } from "@/hooks/useExecutionHistoryCardProps";
import { useHistoryActions } from "@/hooks/useHistoryActions";
import { useHistoryDiagnosticsState } from "@/hooks/useHistoryDiagnosticsState";
import type { ProviderPublishSpec } from "@/hooks/usePublishRunner";
import type { ExecutionRecord } from "@/lib/store";
import type { Repository } from "@/types/repository";

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
  setExecutionHistory: (history: ExecutionRecord[]) => void;
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
  setExecutionHistory,
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
    setExecutionHistory,
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
