import { useCallback, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";

import {
  createDiagnosticsIndexExportPlan,
  createExecutionHistoryExportPlan,
  createFailureGroupBundleExportPlan,
} from "@/features/history/diagnosticsExportPayload";
import {
  exportDiagnosticsIndexFile,
  exportExecutionHistoryFile,
  exportFailureGroupBundleFile,
} from "@/features/history/diagnosticsExportRuntime";
import type { HistoryExportFormat } from "@/features/history/historyFilterPresets";
import { useI18n } from "@/hooks/useI18n";
import { type ExecutionRecord } from "@/lib/store/types";
import { localizeInvokeError } from "@/lib/tauri/invokeErrors";

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
  // 导出回调只作为按钮 handler 使用，不驱动 useEffect；historyT 随语言切换
  // 同步变化，translations 进依赖不会带来额外重建。
  const { translations } = useI18n();
  const [isExportingHistory, setIsExportingHistory] = useState(false);
  const [isExportingFailureGroups, setIsExportingFailureGroups] =
    useState(false);
  const [isExportingDiagnosticsIndex, setIsExportingDiagnosticsIndex] =
    useState(false);

  const exportFailureGroupBundle = useCallback(async () => {
    if (failureGroupCount === 0) {
      toast.error(
        historyT.noFailureGroupsToExport || "当前筛选下没有失败分组可导出"
      );
      return;
    }

    const exportPlan = createFailureGroupBundleExportPlan({
      records: filteredExecutionHistory,
      selectedRepoPath,
    });

    const selected = await save({
      title: historyT.exportFailureGroupsTitle || "导出失败分组",
      defaultPath: exportPlan.defaultPath,
      filters: exportPlan.filters,
    });

    if (!selected) {
      return;
    }

    setIsExportingFailureGroups(true);
    try {
      const outputPath = await exportFailureGroupBundleFile({
        bundle: exportPlan.payload,
        filePath: selected,
      });

      trackHistoryExport(outputPath);
      toast.success(historyT.failureGroupsExported || "失败分组已导出", {
        description: outputPath,
      });
    } catch (err) {
      toast.error(historyT.exportFailureGroupsFailed || "导出失败分组失败", {
        description: localizeInvokeError(err, translations),
      });
    } finally {
      setIsExportingFailureGroups(false);
    }
  }, [
    failureGroupCount,
    filteredExecutionHistory,
    historyT,
    selectedRepoPath,
    trackHistoryExport,
    translations,
  ]);

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
        title:
          options?.title ?? (historyT.exportHistoryTitle || "导出执行历史"),
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
          options?.successMessage ??
            (historyT.historyExported || "执行历史已导出"),
          {
            description: outputPath,
          }
        );
      } catch (err) {
        toast.error(historyT.exportHistoryFailed || "导出执行历史失败", {
          description: localizeInvokeError(err, translations),
        });
      } finally {
        setIsExportingHistory(false);
      }
    },
    [
      filteredExecutionHistory,
      historyT,
      selectedRepoPath,
      trackHistoryExport,
      translations,
    ]
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
        description: localizeInvokeError(err, translations),
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
    translations,
  ]);

  return {
    isExportingHistory,
    isExportingFailureGroups,
    isExportingDiagnosticsIndex,
    exportExecutionHistory,
    exportFailureGroupBundle,
    exportDiagnosticsIndex,
  };
}
