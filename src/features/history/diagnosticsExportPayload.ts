import type { HistoryExportFormat } from "@/features/history/historyFilterPresets";
import { joinPath } from "@/lib/paths";
import type { ExecutionRecord } from "@/lib/store/types";

export interface ExecutionHistoryExportOptions {
  records: ExecutionRecord[];
  format?: HistoryExportFormat;
  filePrefix?: string;
  selectedRepoPath: string;
  now?: Date;
}

export interface ExecutionHistoryExportPlan {
  defaultPath: string;
  filters: Array<{ name: string; extensions: string[] }>;
  history: ExecutionHistoryExportRow[];
}

export interface ExecutionHistoryExportRow {
  id: string;
  repoId: string | null;
  providerId: string;
  projectPath: string;
  startedAt: string;
  finishedAt: string;
  success: boolean;
  cancelled: boolean;
  outputDir: string | null;
  error: string | null;
  commandLine: string | null;
  snapshotPath: string | null;
  failureSignature: string | null;
  fileCount: number;
}

export interface DiagnosticsIndexPayload {
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

export interface DiagnosticsIndexExportOptions {
  scopedExecutionHistory: ExecutionRecord[];
  filteredExecutionHistory: ExecutionRecord[];
  failureGroupCount: number;
  snapshotPaths: string[];
  recentHistoryExports: string[];
  selectedRepoPath: string;
  now?: Date;
}

export interface DiagnosticsIndexExportPlan {
  defaultPath: string;
  payload: DiagnosticsIndexPayload;
}

function toTimestamp(now?: Date) {
  return (now ?? new Date()).toISOString().replace(/[:]/g, "-");
}

function createHistoryFilters(format?: HistoryExportFormat) {
  if (format === "csv") {
    return [{ name: "CSV", extensions: ["csv"] }];
  }

  if (format === "json") {
    return [{ name: "JSON", extensions: ["json"] }];
  }

  return [
    { name: "CSV", extensions: ["csv"] },
    { name: "JSON", extensions: ["json"] },
  ];
}

function toExecutionHistoryExportRow(
  record: ExecutionRecord
): ExecutionHistoryExportRow {
  return {
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
  };
}

export function createExecutionHistoryExportPlan(
  options: ExecutionHistoryExportOptions
): ExecutionHistoryExportPlan {
  const extension = options.format ?? "csv";
  const prefix = options.filePrefix ?? "execution-history";
  const fileName = `${prefix}-${toTimestamp(options.now)}.${extension}`;

  return {
    defaultPath: joinPath(options.selectedRepoPath, fileName),
    filters: createHistoryFilters(options.format),
    history: options.records.map(toExecutionHistoryExportRow),
  };
}

export function createDiagnosticsIndexExportPlan(
  options: DiagnosticsIndexExportOptions
): DiagnosticsIndexExportPlan {
  const timestamp = toTimestamp(options.now);

  return {
    defaultPath: joinPath(
      options.selectedRepoPath,
      `diagnostics-index-${timestamp}.md`
    ),
    payload: {
      generatedAt: (options.now ?? new Date()).toISOString(),
      summary: {
        historyCount: options.scopedExecutionHistory.length,
        filteredHistoryCount: options.filteredExecutionHistory.length,
        failureGroupCount: options.failureGroupCount,
        snapshotCount: options.snapshotPaths.length,
        historyExportCount: options.recentHistoryExports.length,
      },
      links: {
        snapshots: options.snapshotPaths,
        historyExports: options.recentHistoryExports,
      },
    },
  };
}
