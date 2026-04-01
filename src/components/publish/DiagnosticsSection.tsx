import { ExecutionHistoryCard } from "@/components/publish/ExecutionHistoryCard";
import { FailureGroupDetailCard } from "@/components/publish/FailureGroupDetailCard";
import { FailureGroupsCard } from "@/components/publish/FailureGroupsCard";
import { useDiagnosticsExports } from "@/hooks/useDiagnosticsExports";
import { useExecutionHistoryCardProps } from "@/hooks/useExecutionHistoryCardProps";
import { useFailureGroupDetailCardProps } from "@/hooks/useFailureGroupDetailCardProps";
import { useFailureGroupSelection } from "@/hooks/useFailureGroupSelection";
import { useFailureGroupsCardProps } from "@/hooks/useFailureGroupsCardProps";
import { useHistoryActions } from "@/hooks/useHistoryActions";
import { useHistoryDiagnosticsState } from "@/hooks/useHistoryDiagnosticsState";
import type { ProviderPublishSpec, PublishResult } from "@/hooks/usePublishRunner";
import type { EnvironmentCheckSnapshot } from "@/lib/environment";
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
  publishResult: PublishResult | null;
  lastPublishSpec: ProviderPublishSpec | null;
  outputLog: string;
  environmentLastCheck: EnvironmentCheckSnapshot | null;
  currentPublishRecordId: string | null;
  recentBundleExports: string[];
  recentHistoryExports: string[];
  setExecutionHistory: (history: ExecutionRecord[]) => void;
  trackBundleExport: (outputPath: string) => void;
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
  publishResult,
  lastPublishSpec,
  outputLog,
  environmentLastCheck,
  currentPublishRecordId,
  recentBundleExports,
  recentHistoryExports,
  setExecutionHistory,
  trackBundleExport,
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
    issueDraftTemplate,
    setIssueDraftTemplate,
    issueDraftSections,
    setIssueDraftSections,
    scopedExecutionHistory,
    historyProviderOptions,
    filteredExecutionHistory,
    clearHistoryFilters,
    snapshotPaths,
    failureGroups,
  } = useHistoryDiagnosticsState({
    executionHistory,
    selectedRepo,
  });

  const {
    selectedFailureGroupKey,
    setSelectedFailureGroupKey,
    selectedFailureGroup,
    representativeFailureRecord,
  } = useFailureGroupSelection(failureGroups);

  const {
    copyGroupSignature,
    copyFailureIssueDraft,
    copyRecordCommand,
    copyHandoffSnippet,
    openSnapshotFromRecord,
  } = useHistoryActions({
    appT,
    historyT,
    failureT,
    issueDraftTemplate,
    issueDraftSections,
    extractSpecFromRecord,
    setExecutionHistory,
  });

  const {
    isExportingFailureBundle,
    isExportingHistory,
    isExportingDiagnosticsIndex,
    exportFailureGroupBundle,
    exportExecutionHistory,
    exportDiagnosticsIndex,
  } = useDiagnosticsExports({
    historyT,
    failureT,
    publishResult,
    lastPublishSpec,
    outputLog,
    environmentLastCheck,
    currentPublishRecordId,
    selectedFailureGroup,
    representativeFailureRecord,
    snapshotPaths,
    recentBundleExports,
    recentHistoryExports,
    scopedExecutionHistory,
    filteredExecutionHistory,
    failureGroupsCount: failureGroups.length,
    selectedRepoPath: selectedRepo.path,
    setExecutionHistory,
    trackBundleExport,
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
    isExportingDiagnosticsIndex,
    isPublishing,
    appT,
    historyT,
    failureT,
    setHistoryFilterProvider,
    setHistoryFilterStatus,
    setHistoryFilterWindow,
    setHistoryFilterKeyword,
    exportExecutionHistory,
    exportDiagnosticsIndex,
    clearHistoryFilters,
    openSnapshotFromRecord,
    rerunFromHistory,
    copyHandoffSnippet,
  });

  const failureGroupsCardProps = useFailureGroupsCardProps({
    failureGroups,
    selectedFailureGroupKey,
    failureT,
    isPublishing,
    setSelectedFailureGroupKey,
    copyGroupSignature,
    openSnapshotFromRecord,
    rerunFromHistory,
  });

  const failureGroupDetailCardProps = useFailureGroupDetailCardProps({
    selectedFailureGroup,
    representativeFailureRecord,
    issueDraftTemplate,
    issueDraftSections,
    failureT,
    appT,
    isExportingFailureBundle,
    isPublishing,
    setIssueDraftTemplate,
    setIssueDraftSections,
    copyGroupSignature,
    copyRecordCommand,
    copyFailureIssueDraft,
    exportFailureGroupBundle,
    openSnapshotFromRecord,
    rerunFromHistory,
  });

  const hasFailureGroups = failureGroupsCardProps.failureGroups.length > 0;
  const hasFailureGroupDetail =
    failureGroupDetailCardProps.selectedFailureGroup !== null;
  const hasExecutionHistory =
    executionHistoryCardProps.scopedExecutionHistory.length > 0;

  if (rightPanelView === "history") {
    if (!hasExecutionHistory) {
      return null;
    }

    return (
      <div className="mx-auto w-full max-w-3xl">
        <ExecutionHistoryCard {...executionHistoryCardProps} />
      </div>
    );
  }

  return (
    <>
      {hasFailureGroups && (
        <div className="mx-auto w-full max-w-3xl">
          <FailureGroupsCard {...failureGroupsCardProps} />
        </div>
      )}
      {hasFailureGroupDetail && (
        <div className="mx-auto w-full max-w-3xl">
          <FailureGroupDetailCard {...failureGroupDetailCardProps} />
        </div>
      )}
    </>
  );
}
