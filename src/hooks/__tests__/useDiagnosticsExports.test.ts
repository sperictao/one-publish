import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExecutionRecord } from "@/lib/store/types";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  exportExecutionHistoryFile: vi.fn(),
  exportDiagnosticsIndexFile: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: mocks.save,
}));

vi.mock("sonner", () => ({
  toast: mocks.toast,
}));

vi.mock("@/features/history/diagnosticsExportRuntime", () => ({
  exportExecutionHistoryFile: mocks.exportExecutionHistoryFile,
  exportDiagnosticsIndexFile: mocks.exportDiagnosticsIndexFile,
}));

import { useDiagnosticsExports } from "@/hooks/useDiagnosticsExports";

function createExecutionRecord(
  overrides: Partial<ExecutionRecord> = {}
): ExecutionRecord {
  return {
    id: "record-1",
    repoId: "repo-1",
    providerId: "dotnet",
    projectPath: "/repo/App.csproj",
    startedAt: "2026-06-03T01:00:00.000Z",
    finishedAt: "2026-06-03T01:01:00.000Z",
    success: true,
    cancelled: false,
    outputDir: "/repo/publish",
    error: null,
    commandLine: "$ dotnet publish /repo/App.csproj",
    snapshotPath: "/repo/snapshot.md",
    failureSignature: null,
    outputExcerpt: null,
    spec: null,
    fileCount: 3,
    ...overrides,
  };
}

function renderDiagnosticsExports(params: {
  filteredExecutionHistory?: ExecutionRecord[];
  snapshotPaths?: string[];
  recentHistoryExports?: string[];
  trackHistoryExport?: (outputPath: string) => void;
} = {}) {
  const filteredExecutionHistory =
    params.filteredExecutionHistory ?? [createExecutionRecord()];

  return renderHook(() =>
    useDiagnosticsExports({
      historyT: {
        exportHistoryTitle: "导出执行历史",
        historyExported: "执行历史已导出",
        exportDiagnosticsIndexTitle: "导出诊断索引",
        diagnosticsIndexExported: "诊断索引已导出",
      },
      snapshotPaths: params.snapshotPaths ?? ["/repo/snapshot.md"],
      recentHistoryExports: params.recentHistoryExports ?? [],
      scopedExecutionHistory: filteredExecutionHistory,
      filteredExecutionHistory,
      failureGroupCount: 1,
      selectedRepoPath: "/repo",
      trackHistoryExport: params.trackHistoryExport ?? vi.fn(),
    })
  );
}

describe("useDiagnosticsExports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports execution history through the history runtime boundary", async () => {
    const trackHistoryExport = vi.fn();
    mocks.save.mockResolvedValue("/repo/history.csv");
    mocks.exportExecutionHistoryFile.mockResolvedValue("/repo/history.csv");

    const { result } = renderDiagnosticsExports({ trackHistoryExport });

    await act(async () => {
      await result.current.exportExecutionHistory({ format: "csv" });
    });

    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "导出执行历史",
        filters: [{ name: "CSV", extensions: ["csv"] }],
      })
    );
    expect(mocks.exportExecutionHistoryFile).toHaveBeenCalledWith({
      history: [
        expect.objectContaining({
          id: "record-1",
          repoId: "repo-1",
          providerId: "dotnet",
          fileCount: 3,
        }),
      ],
      filePath: "/repo/history.csv",
    });
    expect(trackHistoryExport).toHaveBeenCalledWith("/repo/history.csv");
    expect(mocks.toast.success).toHaveBeenCalledWith("执行历史已导出", {
      description: "/repo/history.csv",
    });
  });

  it("exports diagnostics index through the history runtime boundary", async () => {
    mocks.save.mockResolvedValue("/repo/diagnostics-index.md");
    mocks.exportDiagnosticsIndexFile.mockResolvedValue(
      "/repo/diagnostics-index.md"
    );

    const { result } = renderDiagnosticsExports({
      snapshotPaths: ["/repo/snapshot.md"],
      recentHistoryExports: ["/repo/history.csv"],
    });

    await act(async () => {
      await result.current.exportDiagnosticsIndex();
    });

    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "导出诊断索引",
        filters: [
          { name: "Markdown", extensions: ["md"] },
          { name: "HTML", extensions: ["html"] },
        ],
      })
    );
    expect(mocks.exportDiagnosticsIndexFile).toHaveBeenCalledWith({
      index: expect.objectContaining({
        summary: expect.objectContaining({
          historyCount: 1,
          filteredHistoryCount: 1,
          failureGroupCount: 1,
          snapshotCount: 1,
          historyExportCount: 1,
        }),
        links: {
          snapshots: ["/repo/snapshot.md"],
          historyExports: ["/repo/history.csv"],
        },
      }),
      filePath: "/repo/diagnostics-index.md",
    });
    expect(mocks.toast.success).toHaveBeenCalledWith("诊断索引已导出", {
      description: "/repo/diagnostics-index.md",
    });
  });
});
