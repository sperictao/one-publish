import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";

import type { HistoryExportFormat } from "@/features/history/historyFilterPresets";
import { joinPath } from "@/lib/paths";
import { type ExecutionRecord } from "@/lib/store/types";

interface DiagnosticsIndexPayload {
  generatedAt: string;
  summary: {
    historyCount: number;
    filteredHistoryCount: number;
    failureGroupCount: number;
    snapshotCount: number;
    historyExportCount: number;
  };
  links: {
    snapshots: string[];
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
      snapshotPaths.length > 0 || recentHistoryExports.length > 0;
    if (!hasAnyLinks) {
      toast.error(historyT.noDiagnosticsToIndex || "暂无可索引的诊断导出记录", {
        description:
          historyT.noDiagnosticsToIndexHint || "请先导出历史或执行快照",
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
        failureGroupCount,
        snapshotCount: snapshotPaths.length,
        historyExportCount: recentHistoryExports.length,
      },
      links: {
        snapshots: snapshotPaths,
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
