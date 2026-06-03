import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import {
  exportDiagnosticsIndexFile,
  exportExecutionHistoryFile,
} from "@/features/history/diagnosticsExportRuntime";
import type {
  DiagnosticsIndexPayload,
  ExecutionHistoryExportRow,
} from "@/features/history/diagnosticsExportPayload";

describe("diagnostics export runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports execution history through the history runtime boundary", async () => {
    const history: ExecutionHistoryExportRow[] = [
      {
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
        snapshotPath: null,
        failureSignature: null,
        fileCount: 3,
      },
    ];
    invokeMock.mockResolvedValue("/repo/history.csv");

    await expect(
      exportExecutionHistoryFile({
        history,
        filePath: "/repo/history.csv",
      })
    ).resolves.toBe("/repo/history.csv");

    expect(invokeMock).toHaveBeenCalledWith("export_execution_history", {
      history,
      filePath: "/repo/history.csv",
    });
  });

  it("exports diagnostics index through the history runtime boundary", async () => {
    const index: DiagnosticsIndexPayload = {
      generatedAt: "2026-06-03T04:05:06.789Z",
      summary: {
        historyCount: 2,
        filteredHistoryCount: 1,
        failureGroupCount: 1,
        snapshotCount: 1,
        historyExportCount: 1,
      },
      links: {
        snapshots: ["/repo/snapshot.md"],
        historyExports: ["/repo/history.csv"],
      },
    };
    invokeMock.mockResolvedValue("/repo/diagnostics-index.md");

    await expect(
      exportDiagnosticsIndexFile({
        index,
        filePath: "/repo/diagnostics-index.md",
      })
    ).resolves.toBe("/repo/diagnostics-index.md");

    expect(invokeMock).toHaveBeenCalledWith("export_diagnostics_index", {
      index,
      filePath: "/repo/diagnostics-index.md",
    });
  });
});
