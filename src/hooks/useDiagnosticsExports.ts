import { useCallback, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";

import {
  createDiagnosticsIndexExportPlan,
  createExecutionHistoryExportPlan,
} from "@/features/history/diagnosticsExportPayload";
import {
  exportDiagnosticsIndexFile,
  exportExecutionHistoryFile,
} from "@/features/history/diagnosticsExportRuntime";
import type { HistoryExportFormat } from "@/features/history/historyFilterPresets";
import { type ExecutionRecord } from "@/lib/store/types";

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
  snapshotPaths: string[];
  recentHistoryExports: string[];
  scopedExecutionHistory: ExecutionRecord[];
  filteredExecutionHistory: ExecutionRecord[];
  failureGroupCount: number;
  selectedRepoPath: string;
  trackHistoryExport: (outputPath: string) => void;
}

export function useDiagnosticsExports({
  historyT,
  snapshotPaths,
  recentHistoryExports,
  scopedExecutionHistory,
  filteredExecutionHistory,
  failureGroupCount,
  selectedRepoPath,
  trackHistoryExport,
}: UseDiagnosticsExportsParams) {
  const [isExportingHistory, setIsExportingHistory] = useState(false);
  const [isExportingDiagnosticsIndex, setIsExportingDiagnosticsIndex] =
    useState(false);

  const exportExecutionHistory = useCallback(
    async (options?: ExportHistoryOptions) => {
      const records = options?.records ?? filteredExecutionHistory;
      if (records.length === 0) {
        toast.error(historyT.noHistoryToExport || "当前没有可导出的执行历史");
        return;
      }

      const exportPlan = createExecutionHistoryExportPlan({
        records,
        format: options?.format,
        filePrefix: options?.filePrefix,
        selectedRepoPath,
      });

      const selected = await save({
        title: options?.title ?? (historyT.exportHistoryTitle || "导出执行历史"),
        defaultPath: exportPlan.defaultPath,
        filters: exportPlan.filters,
      });

      if (!selected) {
        return;
      }

      setIsExportingHistory(true);
      try {
        const outputPath = await exportExecutionHistoryFile({
          history: exportPlan.history,
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
      snapshotPaths.length > 0 || recentHistoryExports.length > 0;
    if (!hasAnyLinks) {
      toast.error(historyT.noDiagnosticsToIndex || "暂无可索引的诊断导出记录", {
        description:
          historyT.noDiagnosticsToIndexHint || "请先导出历史或执行快照",
      });
      return;
    }

    const exportPlan = createDiagnosticsIndexExportPlan({
      scopedExecutionHistory,
      filteredExecutionHistory,
      failureGroupCount,
      snapshotPaths,
      recentHistoryExports,
      selectedRepoPath,
    });

    const selected = await save({
      title: historyT.exportDiagnosticsIndexTitle || "导出诊断索引",
      defaultPath: exportPlan.defaultPath,
      filters: [
        { name: "Markdown", extensions: ["md"] },
        { name: "HTML", extensions: ["html"] },
      ],
    });

    if (!selected) {
      return;
    }

    setIsExportingDiagnosticsIndex(true);
    try {
      const outputPath = await exportDiagnosticsIndexFile({
        index: exportPlan.payload,
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
    failureGroupCount,
    historyT,
    filteredExecutionHistory.length,
    recentHistoryExports,
    scopedExecutionHistory.length,
    selectedRepoPath,
    snapshotPaths,
  ]);

  return {
    isExportingHistory,
    isExportingDiagnosticsIndex,
    exportExecutionHistory,
    exportDiagnosticsIndex,
  };
}
