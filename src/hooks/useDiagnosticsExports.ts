import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";

import type { EnvironmentCheckSnapshot } from "@/lib/environment";
import type { HistoryExportFormat } from "@/lib/historyFilterPresets";
import type { FailureGroup } from "@/lib/failureGroups";
import { joinPath } from "@/lib/paths";
import {
  setExecutionRecordSnapshot,
  type ExecutionRecord,
} from "@/lib/store";

interface PublishResult {
  provider_id: string;
  success: boolean;
  cancelled: boolean;
  error: string | null;
  output_dir: string;
  file_count: number;
}

interface ProviderPublishSpec {
  version: number;
  provider_id: string;
  project_path: string;
  parameters: Record<string, unknown>;
}

interface ExecutionSnapshotPayload {
  generatedAt: string;
  providerId: string;
  spec: ProviderPublishSpec;
  command: {
    line: string;
  };
  environmentSummary: {
    providerIds: string[];
    warningCount: number;
    criticalCount: number;
  };
  result: {
    success: boolean;
    cancelled: boolean;
    error: string | null;
    outputDir: string;
    fileCount: number;
  };
  output: {
    lineCount: number;
    log: string;
  };
}

interface FailureGroupBundleRecordPayload {
  id: string;
  providerId: string;
  projectPath: string;
  startedAt: string;
  finishedAt: string;
  outputDir: string | null;
  error: string | null;
  commandLine: string | null;
  snapshotPath: string | null;
  fileCount: number;
}

interface FailureGroupBundlePayload {
  generatedAt: string;
  providerId: string;
  signature: string;
  frequency: number;
  representativeRecordId: string;
  records: FailureGroupBundleRecordPayload[];
}

interface DiagnosticsIndexPayload {
  generatedAt: string;
  summary: {
    historyCount: number;
    filteredHistoryCount: number;
    failureGroupCount: number;
    snapshotCount: number;
    bundleCount: number;
    historyExportCount: number;
  };
  links: {
    snapshots: string[];
    bundles: string[];
    historyExports: string[];
  };
}

type TranslationMap = Record<string, string | undefined>;

interface ExportHistoryOptions {
  records?: ExecutionRecord[];
  format?: HistoryExportFormat;
  title?: string;
  filePrefix?: string;
  successMessage?: string;
}

interface UseDiagnosticsExportsParams {
  historyT: TranslationMap;
  failureT: TranslationMap;
  publishResult: PublishResult | null;
  lastPublishSpec: ProviderPublishSpec | null;
  outputLog: string;
  environmentLastCheck: EnvironmentCheckSnapshot | null;
  currentPublishRecordId: string | null;
  selectedFailureGroup: FailureGroup | null;
  representativeFailureRecord: ExecutionRecord | null;
  snapshotPaths: string[];
  recentBundleExports: string[];
  recentHistoryExports: string[];
  scopedExecutionHistory: ExecutionRecord[];
  filteredExecutionHistory: ExecutionRecord[];
  failureGroupsCount: number;
  selectedRepoPath: string;
  setExecutionHistory: (history: ExecutionRecord[]) => void;
  trackBundleExport: (outputPath: string) => void;
  trackHistoryExport: (outputPath: string) => void;
}

export function useDiagnosticsExports({
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
  failureGroupsCount,
  selectedRepoPath,
  setExecutionHistory,
  trackBundleExport,
  trackHistoryExport,
}: UseDiagnosticsExportsParams) {
  const [isExportingSnapshot, setIsExportingSnapshot] = useState(false);
  const [isExportingFailureBundle, setIsExportingFailureBundle] =
    useState(false);
  const [isExportingHistory, setIsExportingHistory] = useState(false);
  const [isExportingDiagnosticsIndex, setIsExportingDiagnosticsIndex] =
    useState(false);

  const exportExecutionSnapshot = useCallback(async () => {
    if (!publishResult || !lastPublishSpec) {
      toast.error(historyT.noSnapshotToExport || "暂无可导出的执行快照");
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:]/g, "-");
    const defaultPath = publishResult.output_dir
      ? joinPath(publishResult.output_dir, `execution-snapshot-${timestamp}.md`)
      : `execution-snapshot-${timestamp}.md`;

    const selected = await save({
      title: historyT.exportSnapshotTitle || "导出执行快照",
      defaultPath,
      filters: [
        { name: "Markdown", extensions: ["md"] },
        { name: "JSON", extensions: ["json"] },
      ],
    });

    if (!selected) return;

    const commandLine =
      outputLog.split("\n").find((line) => line.startsWith("$ ")) ||
      "(not captured)";
    const environmentResult = environmentLastCheck?.result || null;
    const providerStatuses = environmentResult?.providers || [];
    const warningCount = (environmentResult?.issues || []).filter(
      (item) => item.severity === "warning"
    ).length;
    const criticalCount = (environmentResult?.issues || []).filter(
      (item) => item.severity === "critical"
    ).length;

    const snapshot: ExecutionSnapshotPayload = {
      generatedAt: new Date().toISOString(),
      providerId: publishResult.provider_id,
      spec: lastPublishSpec,
      command: {
        line: commandLine,
      },
      environmentSummary: {
        providerIds:
          environmentLastCheck?.providerIds ||
          providerStatuses.map((status) => status.provider_id),
        warningCount,
        criticalCount,
      },
      result: {
        success: publishResult.success,
        cancelled: publishResult.cancelled,
        error: publishResult.error,
        outputDir: publishResult.output_dir,
        fileCount: publishResult.file_count,
      },
      output: {
        lineCount: outputLog ? outputLog.split("\n").length : 0,
        log: outputLog,
      },
    };

    setIsExportingSnapshot(true);
    try {
      const outputPath = await invoke<string>("export_execution_snapshot", {
        filePath: selected,
        snapshot,
      });

      if (currentPublishRecordId) {
        const history = await setExecutionRecordSnapshot(
          currentPublishRecordId,
          outputPath
        );
        setExecutionHistory(history);
      }

      toast.success(historyT.snapshotExported || "执行快照已导出", {
        description: outputPath,
      });
    } catch (err) {
      toast.error(historyT.exportSnapshotFailed || "导出执行快照失败", {
        description: String(err),
      });
    } finally {
      setIsExportingSnapshot(false);
    }
  }, [
    currentPublishRecordId,
    environmentLastCheck,
    historyT,
    lastPublishSpec,
    outputLog,
    publishResult,
    setExecutionHistory,
  ]);

  const exportFailureGroupBundle = useCallback(async () => {
    if (!selectedFailureGroup) {
      toast.error(failureT.selectFailureGroupFirst || "请先选择失败分组");
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:]/g, "-");
    const representativeRecord = representativeFailureRecord;
    const defaultDir = selectedFailureGroup.latestRecord.outputDir || selectedRepoPath || "";
    const defaultPath = defaultDir
      ? joinPath(defaultDir, `failure-group-bundle-${timestamp}.md`)
      : `failure-group-bundle-${timestamp}.md`;

    const selected = await save({
      title: failureT.exportBundleTitle || "导出失败组诊断包",
      defaultPath,
      filters: [
        { name: "Markdown", extensions: ["md"] },
        { name: "JSON", extensions: ["json"] },
      ],
    });

    if (!selected || !representativeRecord) {
      return;
    }

    const bundle: FailureGroupBundlePayload = {
      generatedAt: new Date().toISOString(),
      providerId: selectedFailureGroup.providerId,
      signature: selectedFailureGroup.signature,
      frequency: selectedFailureGroup.count,
      representativeRecordId: representativeRecord.id,
      records: selectedFailureGroup.records.map((record) => ({
        id: record.id,
        providerId: record.providerId,
        projectPath: record.projectPath,
        startedAt: record.startedAt,
        finishedAt: record.finishedAt,
        outputDir: record.outputDir ?? null,
        error: record.error ?? null,
        commandLine: record.commandLine ?? null,
        snapshotPath: record.snapshotPath ?? null,
        fileCount: record.fileCount,
      })),
    };

    setIsExportingFailureBundle(true);
    try {
      const outputPath = await invoke<string>("export_failure_group_bundle", {
        bundle,
        filePath: selected,
      });

      trackBundleExport(outputPath);
      toast.success(failureT.bundleExported || "失败组诊断包已导出", {
        description: outputPath,
      });
    } catch (err) {
      toast.error(failureT.exportBundleFailed || "导出失败组诊断包失败", {
        description: String(err),
      });
    } finally {
      setIsExportingFailureBundle(false);
    }
  }, [
    failureT,
    representativeFailureRecord,
    selectedFailureGroup,
    selectedRepoPath,
    trackBundleExport,
  ]);

  const exportExecutionHistory = useCallback(
    async (options?: ExportHistoryOptions) => {
      const records = options?.records ?? filteredExecutionHistory;
      if (records.length === 0) {
        toast.error(historyT.noHistoryToExport || "当前没有可导出的执行历史");
        return;
      }

      const format = options?.format;
      const timestamp = new Date().toISOString().replace(/[:]/g, "-");
      const extension = format ?? "csv";
      const prefix = options?.filePrefix ?? "execution-history";
      const defaultDir = selectedRepoPath || "";
      const defaultPath = defaultDir
        ? joinPath(defaultDir, `${prefix}-${timestamp}.${extension}`)
        : `${prefix}-${timestamp}.${extension}`;

      const filters =
        format === "csv"
          ? [{ name: "CSV", extensions: ["csv"] }]
          : format === "json"
            ? [{ name: "JSON", extensions: ["json"] }]
            : [
                { name: "CSV", extensions: ["csv"] },
                { name: "JSON", extensions: ["json"] },
              ];

      const selected = await save({
        title: options?.title ?? (historyT.exportHistoryTitle || "导出执行历史"),
        defaultPath,
        filters,
      });

      if (!selected) {
        return;
      }

      const history = records.map((record) => ({
        id: record.id,
        repoId: record.repoId ?? null,
        providerId: record.providerId,
        projectPath: record.projectPath,
        startedAt: record.startedAt,
        finishedAt: record.finishedAt,
        success: record.success,
        cancelled: record.cancelled,
        outputDir: record.outputDir ?? null,
        error: record.error ?? null,
        commandLine: record.commandLine ?? null,
        snapshotPath: record.snapshotPath ?? null,
        failureSignature: record.failureSignature ?? null,
        fileCount: record.fileCount,
      }));

      setIsExportingHistory(true);
      try {
        const outputPath = await invoke<string>("export_execution_history", {
          history,
          filePath: selected,
        });

        trackHistoryExport(outputPath);
        toast.success(
          options?.successMessage ?? (historyT.historyExported || "执行历史已导出"),
          {
            description: outputPath,
          }
        );
      } catch (err) {
        toast.error(historyT.exportHistoryFailed || "导出执行历史失败", {
          description: String(err),
        });
      } finally {
        setIsExportingHistory(false);
      }
    },
    [filteredExecutionHistory, historyT, selectedRepoPath, trackHistoryExport]
  );

  const exportDiagnosticsIndex = useCallback(async () => {
    const hasAnyLinks =
      snapshotPaths.length > 0 ||
      recentBundleExports.length > 0 ||
      recentHistoryExports.length > 0;
    if (!hasAnyLinks) {
      toast.error(historyT.noDiagnosticsToIndex || "暂无可索引的诊断导出记录", {
        description:
          historyT.noDiagnosticsToIndexHint || "请先导出诊断包、历史或执行快照",
      });
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:]/g, "-");
    const defaultDir = selectedRepoPath || "";
    const defaultPath = defaultDir
      ? joinPath(defaultDir, `diagnostics-index-${timestamp}.md`)
      : `diagnostics-index-${timestamp}.md`;

    const selected = await save({
      title: historyT.exportDiagnosticsIndexTitle || "导出诊断索引",
      defaultPath,
      filters: [
        { name: "Markdown", extensions: ["md"] },
        { name: "HTML", extensions: ["html"] },
      ],
    });

    if (!selected) {
      return;
    }

    const indexPayload: DiagnosticsIndexPayload = {
      generatedAt: new Date().toISOString(),
      summary: {
        historyCount: scopedExecutionHistory.length,
        filteredHistoryCount: filteredExecutionHistory.length,
        failureGroupCount: failureGroupsCount,
        snapshotCount: snapshotPaths.length,
        bundleCount: recentBundleExports.length,
        historyExportCount: recentHistoryExports.length,
      },
      links: {
        snapshots: snapshotPaths,
        bundles: recentBundleExports,
        historyExports: recentHistoryExports,
      },
    };

    setIsExportingDiagnosticsIndex(true);
    try {
      const outputPath = await invoke<string>("export_diagnostics_index", {
        index: indexPayload,
        filePath: selected,
      });

      toast.success(historyT.diagnosticsIndexExported || "诊断索引已导出", {
        description: outputPath,
      });
    } catch (err) {
      toast.error(historyT.exportDiagnosticsIndexFailed || "导出诊断索引失败", {
        description: String(err),
      });
    } finally {
      setIsExportingDiagnosticsIndex(false);
    }
  }, [
    failureGroupsCount,
    historyT,
    filteredExecutionHistory.length,
    recentBundleExports,
    recentHistoryExports,
    scopedExecutionHistory.length,
    selectedRepoPath,
    snapshotPaths,
  ]);

  return {
    isExportingSnapshot,
    isExportingFailureBundle,
    isExportingHistory,
    isExportingDiagnosticsIndex,
    exportExecutionSnapshot,
    exportFailureGroupBundle,
    exportExecutionHistory,
    exportDiagnosticsIndex,
  };
}
