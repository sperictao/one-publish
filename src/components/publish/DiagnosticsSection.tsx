import { Suspense, lazy, type Dispatch, type SetStateAction } from "react";
import { ExecutionHistoryCard } from "@/components/publish/ExecutionHistoryCard";
import { FailureGroupDetailCard } from "@/components/publish/FailureGroupDetailCard";
import { FailureGroupsCard } from "@/components/publish/FailureGroupsCard";
import { useDiagnosticsExports } from "@/hooks/useDiagnosticsExports";
import { useEnvironmentStatus } from "@/hooks/useEnvironmentStatus";
import { useExecutionHistoryCardProps } from "@/hooks/useExecutionHistoryCardProps";
import { useFailureGroupDetailCardProps } from "@/hooks/useFailureGroupDetailCardProps";
import { useFailureGroupSelection } from "@/hooks/useFailureGroupSelection";
import { useFailureGroupsCardProps } from "@/hooks/useFailureGroupsCardProps";
import { useHistoryActions } from "@/hooks/useHistoryActions";
import { useHistoryDiagnosticsState } from "@/hooks/useHistoryDiagnosticsState";
import { useRecoverableSpec } from "@/hooks/useRecoverableSpec";
import { useRerunFlow } from "@/hooks/useRerunFlow";
import type { ProviderPublishSpec, PublishResult } from "@/hooks/usePublishExecution";
import type { EnvironmentCheckResult } from "@/lib/environment";
import type { ExecutionRecord, PublishConfigStore } from "@/lib/store";
import type { ParameterValue } from "@/types/parameters";
import type { Repository } from "@/types/repository";

type TranslationMap = Record<string, string | undefined>;
const RerunChecklistDialog = lazy(async () => {
  const mod = await import("@/components/publish/RerunChecklistDialog");
  return { default: mod.RerunChecklistDialog };
});

export interface DiagnosticsSectionProps {
  rightPanelView: "home" | "history";
  appT: TranslationMap;
  historyT: TranslationMap;
  failureT: TranslationMap;
  rerunT: TranslationMap;
  executionHistory: ExecutionRecord[];
  executionHistoryLimit: number;
  selectedRepo: Repository;
  isPublishing: boolean;
  isRerunChecklistEnabled: boolean;
  specVersion: number;
  customConfig: PublishConfigStore;
  setCustomConfig: (config: PublishConfigStore) => void;
  setIsCustomMode: (value: boolean) => void;
  setActiveProviderId: (providerId: string) => void;
  setProviderParameters: Dispatch<
    SetStateAction<Record<string, Record<string, ParameterValue>>>
  >;
  publishResult: PublishResult | null;
  lastExecutedSpec: ProviderPublishSpec | null;
  outputLog: string;
  environmentLastResult: EnvironmentCheckResult | null;
  selectedRepoCurrentBranch?: string | null;
  currentExecutionRecordId: string | null;
  recentBundleExports: string[];
  recentHistoryExports: string[];
  setExecutionHistory: (history: ExecutionRecord[]) => void;
  trackBundleExport: (outputPath: string) => void;
  trackHistoryExport: (outputPath: string) => void;
  runPublishWithSpec: (
    spec: ProviderPublishSpec,
    recentConfigKey?: string | null
  ) => Promise<void>;
}

export function DiagnosticsSection({
  rightPanelView,
  appT,
  historyT,
  failureT,
  rerunT,
  executionHistory,
  executionHistoryLimit,
  selectedRepo,
  isPublishing,
  isRerunChecklistEnabled,
  specVersion,
  customConfig,
  setCustomConfig,
  setIsCustomMode,
  setActiveProviderId,
  setProviderParameters,
  publishResult,
  lastExecutedSpec,
  outputLog,
  environmentLastResult,
  selectedRepoCurrentBranch,
  currentExecutionRecordId,
  recentBundleExports,
  recentHistoryExports,
  setExecutionHistory,
  trackBundleExport,
  trackHistoryExport,
  runPublishWithSpec,
}: DiagnosticsSectionProps) {
  const environmentStatus = useEnvironmentStatus(environmentLastResult);
  const {
    extractSpecFromRecord,
    restoreSpecToEditor,
    getRecentConfigKeyFromSpec,
  } = useRecoverableSpec({
    specVersion,
    customConfig,
    setCustomConfig,
    setIsCustomMode,
    setActiveProviderId,
    setProviderParameters,
  });
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
    snapshotPaths,
    failureGroups,
  } = useHistoryDiagnosticsState({
    historyT,
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
    exportDailyTriageReport,
    exportDiagnosticsIndex,
  } = useDiagnosticsExports({
    historyT,
    failureT,
    publishResult,
    lastExecutedSpec,
    outputLog,
    environmentLastResult,
    currentExecutionRecordId,
    selectedFailureGroup,
    representativeFailureRecord,
    dailyTriagePreset,
    dailyTriageRecords,
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
    setHistoryFilterProvider,
    setHistoryFilterStatus,
    setHistoryFilterWindow,
    setHistoryFilterKeyword,
    setSelectedHistoryPresetId,
  });
  const {
    rerunChecklistOpen,
    setRerunChecklistOpen,
    pendingRerunRecord,
    rerunChecklistState,
    setRerunChecklistState,
    rerunFromHistory,
    closeRerunChecklistDialog,
    confirmRerunWithChecklist,
  } = useRerunFlow({
    isRerunChecklistEnabled,
    historyT,
    rerunT,
    extractSpecFromRecord,
    restoreSpecToEditor,
    getRecentConfigKeyFromSpec,
    runPublishWithSpec,
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
    selectedHistoryPresetId,
    historyFilterPresets,
    dailyTriagePreset,
    dailyTriageRecords,
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
    applyHistoryPresetToFilters,
    saveCurrentHistoryPreset,
    deleteSelectedHistoryPreset,
    setDailyTriagePreset,
    resetDailyTriagePreset,
    exportExecutionHistory,
    exportDailyTriageReport,
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
  const rerunChecklistDialog = rerunChecklistOpen ? (
    <Suspense fallback={null}>
      <RerunChecklistDialog
        open={rerunChecklistOpen}
        pendingRerunRecord={pendingRerunRecord}
        selectedRepoCurrentBranch={selectedRepoCurrentBranch}
        environmentStatus={environmentStatus}
        rerunChecklistState={rerunChecklistState}
        rerunT={rerunT}
        onOpenChange={(open) => {
          if (open) {
            setRerunChecklistOpen(true);
            return;
          }
          closeRerunChecklistDialog();
        }}
        onChecklistStateChange={setRerunChecklistState}
        onClose={closeRerunChecklistDialog}
        onConfirm={() => void confirmRerunWithChecklist()}
      />
    </Suspense>
  ) : null;

  if (rightPanelView === "history") {
    if (!hasExecutionHistory) {
      return rerunChecklistDialog;
    }

    return (
      <>
        <div className="mx-auto w-full max-w-3xl">
          <ExecutionHistoryCard {...executionHistoryCardProps} />
        </div>
        {rerunChecklistDialog}
      </>
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
      {rerunChecklistDialog}
    </>
  );
}
